// WS-6a/6b: one P2-authorized read and M5 dispatch before PS4 builds the
// model frame. This module does not write prompts or open another database.
import {randomUUID} from 'node:crypto';
import {recallMemory,toPs4RecallContribution} from '../../../lsa-shared-brain/src/memory/recallEngine.mjs';
import {createP2IntegratedRecallAdapter} from '../../../lsa-shared-brain/src/memory/integrationPorts.mjs';
import {createM5SqliteServices} from '../../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';
import {createM5RuntimeCoordinator} from '../../../lsa-shared-brain/src/memory/m5RuntimeCoordinator.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const avatar=new Set(['franklin','michael','trevor','unknown']);
const playerSource=new Set(['player_text','player_mic']);
const bytes=v=>Buffer.byteLength(JSON.stringify(v),'utf8');
const MAX_AGE=5*60*1000;
const validLine=e=>e?.kind==='dialogue_line'&&uuid.test(e.recordId)&&
  typeof e.content==='string'&&e.content.length>0&&e.content.length<=12000&&
  Number.isFinite(Date.parse(e.committedAtUtc))&&(
    e.speaker==='player'&&e.delivery==='accepted'&&['typed','stt'].includes(e.source)||
    e.speaker==='npc'&&e.delivery==='completed'&&uuid.test(e.deliveryReceiptId));
const matchesScope=(e,s)=>e.characterId===s.characterId&&
  e.worldProfileId===s.worldProfileId&&e.timelineId===s.timelineId;
const noMemory=()=>Object.freeze({status:'unavailable',reason:'no_verified_memory_source',
  preparedRecall:null,conversationJournal:null,memoryAction:null,recallCurrent:()=>false});
const sameHost=(a,b)=>!!a&&!!b&&a.hostRunId===b.hostRunId&&a.worldEpoch===b.worldEpoch;

/** A journal history only. The accepted line is NOT reinserted as history.
 * Previous NPC speech that was interrupted/failed is never treated as heard.
 * Archived speech is explicitly labelled, never passed off as a live turn.
 */
export function assembleJournalConversation({rows,accepted,scope,suppressed=[],nowUtc}={}){
  if(!Array.isArray(rows)||!accepted||!scope||!Array.isArray(suppressed))return null;
  const hidden=new Set(suppressed);
  if(hidden.has(accepted.recordId)||!validLine(accepted)||accepted.speaker!=='player'||
     !matchesScope(accepted,scope)||!uuid.test(accepted.attribution?.sessionId))return null;
  const end=Date.parse(accepted.committedAtUtc);
  if(!Number.isFinite(end)||end>Date.parse(nowUtc)+60000)return null;
  const unique=new Map();
  for(const row of rows){
    if(!validLine(row)||!matchesScope(row,scope)||hidden.has(row.recordId)||
       row.recordId===accepted.recordId||!uuid.test(row.attribution?.sessionId)||
       Date.parse(row.committedAtUtc)>end)continue;
    if(!unique.has(row.recordId))unique.set(row.recordId,row);
  }
  const ordered=[...unique.values()].sort((a,b)=>
    Date.parse(b.committedAtUtc)-Date.parse(a.committedAtUtc)||
    b.recordId.localeCompare(a.recordId));
  const recent=[];
  let last=end;
  for(const row of ordered){
    const at=Date.parse(row.committedAtUtc);
    if(last-at>MAX_AGE)break;
    const item={role:row.speaker==='player'?'user':'assistant',content:row.content};
    if(recent.length>=20||bytes([item,...recent])>12*1024)break;
    recent.unshift(item);last=at;
  }
  // A limited labelled earlier block, never an invented summary. PS4 allocates
  // these only inside the same character/timeline, at lower priority than canon.
  const earlier=[];
  for(const row of ordered.slice(recent.length)){
    if(earlier.length>=4)break;
    const item={role:row.speaker==='player'?'user':'assistant',content:row.content,
      atUtc:row.committedAtUtc,status:'archived'};
    if(bytes([...earlier,item])>2048)break;
    earlier.push(item);
  }
  return Object.freeze({recent:Object.freeze(recent),earlier:Object.freeze(earlier)});
}

export async function prepareLiveTurnMemory({store,turn,acceptedReceipt,input,source,isCurrent,
  nowUtc=new Date().toISOString()}={}){
  const empty=noMemory();
  try{
    if(!playerSource.has(source)||typeof input!=='string'||typeof isCurrent!=='function'||
       !store||typeof store.readDialogueLines!=='function'||
       typeof store.readIntegratedRecall!=='function'||
       typeof store.listSuppressedMemoryIds!=='function'||
       !['stored','duplicate'].includes(acceptedReceipt?.status)||
       acceptedReceipt?.durable!==true||!uuid.test(acceptedReceipt.recordId)||
       !avatar.has(acceptedReceipt.protagonistKey))return empty;
    const characterId=turn?.characterProjection?.profile?.characterId;
    const profile=turn?.characterProjection?.profile;
    const scope={characterId,worldProfileId:store.worldProfileId,
      timelineId:store.activeTimelineId,protagonistKey:acceptedReceipt.protagonistKey};
    const host=store.verifiedHostContext;
    const alias=profile?.promotion?.ownerAlias;
    const current=()=>isCurrent()===true&&
      turn.characterProjection?.persistent===true&&
      turn.characterInputs?.profile?.characterId===characterId&&
      uuid.test(characterId)&&uuid.test(scope.worldProfileId)&&
      uuid.test(scope.timelineId)&&store.activeTimelineId===scope.timelineId&&
      store.timelineWritable===true&&sameHost(store.verifiedHostContext,host)&&
      store.get(characterId)?.promotion?.ownerAlias===alias&&
      turn.m2Capture?.verifyMemoryCurrent?.()===true;
    if(!alias||typeof turn.m2Capture?.openMemoryCurrent!=='function'||
       await turn.m2Capture.openMemoryCurrent()!==true||!current())return empty;
    // Readback from the original SQLite journal, never synthesize an accepted
    // line from the client input or a model-provided acceptance receipt.
    const rows=await store.readDialogueLines({characterId,timelineId:scope.timelineId,limit:200});
    if(!current())return empty;
    const line=rows.find(row=>row.recordId===acceptedReceipt.recordId);
    const expectedSource=source==='player_mic'?'stt':'typed';
    if(!line||!validLine(line)||line.speaker!=='player'||line.source!==expectedSource||
       line.content!==input||!matchesScope(line,scope)||
       line.attribution?.protagonist!==scope.protagonistKey||
       !sameHost(line.attribution,host)||!uuid.test(line.attribution.sessionId)||
       !/^[0-9a-f]{64}$/.test(line.turnIdentityHash))return empty;
    // Ordinary conversation never invokes a memory writer. Only an explicit
    // player command (or a possible reply to an existing durable clarification)
    // may enter M5, always subject to the coordinator's own source checks.
    let memoryAction=null;
    const possibleCommand=/^(?:\s*(?:(?:hey|yo|please|nathan|buddy)[\s,]+)*)(?:remember\b|never forget\b|don't forget\b|forget\b|erase\b|delete\b|i meant\b|no,? i said\b|correct that\b|first\b|second\b|one\b|two\b|1\b|2\b|it was\b|show\b|inspect\b|export\b)/i.test(input);
    if(possibleCommand)try{
      const m5=createM5SqliteServices({store,filePath:store.filePath,
        authorize:()=>current()});
      const coordinator=createM5RuntimeCoordinator({
        commandStore:m5.bindCommands(),
        authority:{assertCurrent:()=>current()}
      });
      const result=await coordinator.acceptAcceptedPlayerLine({
        line,scope,sourceProof:acceptedReceipt});
      if(!current())return empty;
      if(result?.handled===true&&result.route==='command'){
        // Only the coordinator's verified durable statuses, not claimed text.
        memoryAction=Object.freeze((result.acknowledgements||[]).map(x=>({
          outcome:x.outcome,durableCommit:x.durableCommit===true})));
      }
    }catch{memoryAction=Object.freeze([{outcome:'failed',durableCommit:false}]);}
    if(!current())return empty;
    const suppressed=await store.listSuppressedMemoryIds(scope);
    if(!current())return empty;
    const conversationJournal=assembleJournalConversation({
      rows,accepted:line,scope,suppressed,nowUtc});
    // The stored accepted line may have been forgotten by the M5 command.
    if(!conversationJournal)return Object.freeze({...empty,memoryAction});
    const query={version:1,kind:'recall_query',queryId:randomUUID(),
      characterId,worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,
      turnIdentityHash:line.turnIdentityHash,
      question:input,intent:/\b(quote|exact words|word for word)\b/i.test(input)
        ?'exact_quote':'open_recall',maxBytes:4096};
    const sourceReader=createP2IntegratedRecallAdapter(store);
    const {bundle}=await recallMemory({query,
      // A question must never retrieve itself as if it were an earlier memory.
      // The accepted current line belongs in CONVERSE.current only.
      readAdapter:{read:async args=>{
        const result=await sourceReader.read(args);
        return {...result,rows:result.rows.filter(r=>r.recordId!==line.recordId)};
      }},
      protagonistKey:scope.protagonistKey,nowUtc});
    if(!current())return empty;
    const contribution=toPs4RecallContribution(bundle,{maxBytes:4096});
    const stamp=Object.freeze({...scope,hostRunId:host.hostRunId,
      worldEpoch:host.worldEpoch,recordId:line.recordId});
    const preparedRecall=Object.freeze({status:'ready',stamp,contribution});
    // PS4 immutableSnapshot clones the private stamp. Compare its exact
    // allowlisted values, not object identity, after every snapshot/prune.
    const recallCurrent=(_references,seen)=>!!seen&&
      Object.keys(stamp).length===Object.keys(seen).length&&
      Object.keys(stamp).every(k=>seen[k]===stamp[k])&&current();
    return Object.freeze({status:'ready',preparedRecall,conversationJournal,
      memoryAction,recallCurrent});
  }catch{return empty;}
}
