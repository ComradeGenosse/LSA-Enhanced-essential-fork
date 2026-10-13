// WS-6a/6b: one P2-authorized read and M5 dispatch before PS4 builds the
// model frame. This module does not write prompts or open another database.
import {randomUUID} from 'node:crypto';
import {recallMemory,toPs4RecallContribution} from '../../../lsa-shared-brain/src/memory/recallEngine.mjs';
import {createP2IntegratedRecallAdapter} from '../../../lsa-shared-brain/src/memory/integrationPorts.mjs';
import {createM5SqliteServices} from '../../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';
import {createM5RuntimeCoordinator} from '../../../lsa-shared-brain/src/memory/m5RuntimeCoordinator.mjs';
import {detectExplicitMemoryCommands} from '../../../lsa-shared-brain/src/memory/explicitCommands.mjs';
import {createRecallEvidencePolicy} from '../../../lsa-shared-brain/src/memory/recallEvidencePolicy.mjs';
import {createP2M8ProductionReader} from './p2M8ProductionRead.mjs';

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
    let rows=await store.readDialogueLines({characterId,timelineId:scope.timelineId,limit:200});
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
    // Use the M5 parser as the authority for explicit commands. Only possible
    // clarification replies need a separate fast path; ordinary dialogue stays read-only.
    const trimmed=input.trim();
    const possibleCommand=detectExplicitMemoryCommands(input)!==null ||
      /^(?:the\s+)?(?:first|second|one|two|1|2)(?:\s+one)?(?:\s*[:,-]\s*.+)?[.!]?$/i.test(trimmed) ||
      /^(?:no[,]?\s*)?(?:i\s+(?:actually\s+)?(?:said|meant)|it\s+was|the\s+correct(?:ed)?\s+(?:wording|text)\s+is)\s+.+$/i.test(trimmed);
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
    const hidden=async()=>{
      const ids=await store.listSuppressedMemoryIds(scope);
      if(!current())throw Error('memory_source_revoked');
      const corrections=await store.readCorrectionOverlays?.(scope)??[];
      if(!current())throw Error('memory_source_revoked');
      return [...new Set([...ids,...corrections.filter(x=>x.supersedesTarget!==false).map(x=>x.targetId)])].sort();
    };
    const suppressed=await hidden();
    if(!current())return empty;
    // M5 may have corrected a line. Assemble only after its durable transaction.
    rows=await store.readDialogueLines({characterId,timelineId:scope.timelineId,limit:200});
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
    let recallReadArgs=null;
    const {bundle}=await recallMemory({query,
      // A question must never retrieve itself as if it were an earlier memory.
      // The accepted current line belongs in CONVERSE.current only.
      readAdapter:{read:async args=>{
        recallReadArgs=args;
        const result=await sourceReader.read(args);
        return {...result,rows:result.rows.filter(r=>r.recordId!==line.recordId)};
      }},
      protagonistKey:scope.protagonistKey,nowUtc});
    if(!current())return empty;
    let contribution=toPs4RecallContribution(bundle,{maxBytes:4096});
    const authority=turn.m2Capture.memoryIdentity?.()??null;
    const policy=authority?createRecallEvidencePolicy({store,isCurrent:current}):null;
    let labels=null,labelArgs=null;
    if(policy){
      labelArgs={scope,source:authority,
        terms:recallReadArgs?.terms??[],sourceKind:recallReadArgs?.sourceKind??null,
        recordIds:contribution.items.map(x=>x.recordId),maxBytes:8192};
      labels=await policy.labelledEvidence(labelArgs);
      if(!current())return empty;
      contribution=Object.freeze({...contribution,items:Object.freeze(contribution.items.map(item=>{
        const label=labels.items?.find(x=>x.recordId===item.recordId);
        return label?Object.freeze({...item,category:label.category,sourceAvatar:label.sourceAvatar,
          sourceEvidenceIds:label.sourceEvidenceIds}):item;
      }))});
    }
    // Only a conservative explicit literal query has exhaustive semantics.
    // Unsupported semantic/event/implicit totals always abstain.
    const countQuestion=/\b(how many|first time|last time)\b/i.test(input);
    const literal=input.match(/^\s*(?:how many times did (I|you) say|when (?:was|is) the (first|last) time (I|you) said)\s+"([^"\r\n]{1,512})"\s*[?.]?\s*$/i);
    const predicate=literal?{speaker:(literal[1]??literal[3]).toLowerCase()==='i'?'player':'npc',containsText:literal[4]}:null;
    const countArgs={scope,source:authority,predicate,excludeRecordIds:[line.recordId]};
    const count=countQuestion&&policy&&predicate?await policy.countDialogue(countArgs):
      countQuestion?{status:'incomplete',reason:'unsupported_query',exactCount:null,first:null,last:null}:null;
    if(!current())return empty;
    let witness=null,witnessArgs=null;
    if(/\b(?:witness|see|saw|hear|heard)\b/i.test(input)&&policy){
      // Only persisted event identities may enter G5. A freeform question or
      // empty candidate page never supplies an event-specific negative proof.
      const item=contribution.items.find(x=>x.sourceKind==='journal_event');
      const proof=item?await store.readVerifiedEventEvidence({characterId,timelineId:scope.timelineId,recordId:item.recordId}):null;
      if(!current())return empty;
      if(proof?.event){
        const e=proof.event;
        witnessArgs={scope,source:authority,eventRecordId:e.recordId,observationId:e.observationId,
          fromUtc:e.receivedAtUtc,toUtc:new Date(Date.parse(e.receivedAtUtc)+1).toISOString()};
        witness=await policy.witness(witnessArgs);
      }else witness={status:'unknown',reason:'no_event_specific_proof',evidenceIds:[]};
    }
    if(!current())return empty;
    const answerEvidence=count||witness?Object.freeze({
      ...(count?{dialogueCount:{...count,predicate}}:{}),...(witness?{witness}:{}),
      completeness:'bounded_recall_page',negativeWitnessing:'unavailable'}):null;
    let m8Reader=null,preparedM8=null;
    if(authority&&typeof store.withP2SqliteRead==='function')try{
      m8Reader=createP2M8ProductionReader({store,originalCurrent:current,
        currentIdentity:()=>current()?turn.m2Capture.memoryIdentity():null});
      preparedM8=await m8Reader.prepare({scope,authority,nowUtc,maxBytes:2048});
    }catch{}
    if(!current())return empty;
    const stamp=Object.freeze({...scope,hostRunId:host.hostRunId,
      worldEpoch:host.worldEpoch,recordId:line.recordId});
    const preparedRecall=Object.freeze({status:'ready',stamp,contribution,answerEvidence});
    // PS4 immutableSnapshot clones the private stamp. Compare its exact
    // allowlisted values, not object identity, after every snapshot/prune.
    const recallCurrent=(_references,seen)=>!!seen&&
      Object.keys(stamp).length===Object.keys(seen).length&&
      Object.keys(stamp).every(k=>seen[k]===stamp[k])&&current();
    let verifiedFence=null,memoryValid=true,opinionValid=preparedM8?.status==='ready';
    const journalSeal=JSON.stringify(conversationJournal);
    // Awaited on EVERY model attempt and again at the request boundary. The
    // synchronous connection fence closes the gap from last read to fetch.
    async function verifyPrepared(){
      const fence=store.memoryReadFence;
      memoryValid=false;opinionValid=false;
      if(!current()||fence===null||fence===undefined||!policy)return false;
      try{
        const freshHidden=await hidden();
        const freshRows=await store.readDialogueLines({characterId,timelineId:scope.timelineId,limit:200});
        if(!current())return false;
        if(JSON.stringify(freshRows.find(row=>row.recordId===line.recordId))!==JSON.stringify(line))return false;
        const freshJournal=assembleJournalConversation({rows:freshRows,accepted:line,scope,suppressed:freshHidden,nowUtc});
        // The bounded M4 query is re-read too, so a changed source chain or
        // corrected derivative cannot survive merely because its ID exists.
        const fresh=await recallMemory({query,readAdapter:{read:async args=>{
          const result=await sourceReader.read(args);
          return {...result,rows:result.rows.filter(r=>r.recordId!==line.recordId)};
        }},protagonistKey:scope.protagonistKey,nowUtc});
        // M4's freshly verified projection checks derived source chains and
        // correction overlays. Claim IDs in event sidecars are not journal IDs;
        // a transcript overlay may legitimately reference its superseded line.
        const visible=await policy.verifyReferenceVisibility({scope,source:authority,recordIds:[line.recordId]});
        const freshLabels=labelArgs?await policy.labelledEvidence(labelArgs):labels;
        const freshCount=count&&predicate?await policy.countDialogue(countArgs):count;
        const freshWitness=witnessArgs?await policy.witness(witnessArgs):witness;
        const m8Ok=preparedM8?.status==='ready'&&await m8Reader.verifyPrepared(preparedM8);
        if(!current()||store.memoryReadFence!==fence)return false;
        memoryValid=visible&&JSON.stringify(freshJournal)===journalSeal&&
          JSON.stringify(freshLabels)===JSON.stringify(labels)&&
          JSON.stringify(toPs4RecallContribution(fresh.bundle,{maxBytes:4096}))===
            JSON.stringify(toPs4RecallContribution(bundle,{maxBytes:4096}))&&
          JSON.stringify(freshCount)===JSON.stringify(count)&&JSON.stringify(freshWitness)===JSON.stringify(witness);
        opinionValid=m8Ok===true;
        verifiedFence=fence;
        return memoryValid;
      }catch{return false;}
    }
    const sendCurrent=()=>memoryValid&&current()&&verifiedFence!==null&&store.memoryReadFence===verifiedFence;
    const opinionCurrent=(_refs,seen)=>opinionValid&&sendCurrent()&&!!seen&&
      Object.keys(preparedM8.stamp).every(k=>seen[k]===preparedM8.stamp[k]);
    return Object.freeze({status:'ready',preparedRecall,preparedM8,conversationJournal,
      memoryAction,recallCurrent,verifyPrepared,sendCurrent,opinionCurrent});
  }catch{return empty;}
}
