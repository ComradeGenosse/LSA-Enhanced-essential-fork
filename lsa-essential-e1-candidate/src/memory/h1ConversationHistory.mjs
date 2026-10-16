// H1-A: source-authorized, read-only P2 CONVERSE preparation.
// The module creates no SQLite connection, writer, model frame or native proof.
// The caller must supply the existing D03/M2 accepted-line and owner authority.
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
const sameHost=(a,b)=>!!a&&!!b&&a.hostRunId===b.hostRunId&&a.worldEpoch===b.worldEpoch;


const unavailable=reason=>Object.freeze({status:'unavailable',reason,conversationJournal:null});
const invalidated=reason=>Object.freeze({status:'invalidated',reason});
const readyVerification=Object.freeze({status:'ready'});
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
  // PS4 may retain this snapshot across awaited source checks. A caller must
  // not mutate model-visible bytes while the original journal seal still passes.
  return Object.freeze({recent:Object.freeze(recent.map(item=>Object.freeze(item))),
    earlier:Object.freeze(earlier.map(item=>Object.freeze(item)))});
}


/** Open the same authenticated accepted-player source as WS6, without invoking
 * M4, M5 or M8. Open once before optional commands, then prepare() afterwards.
 * No caller may fabricate M2 authority; openMemoryCurrent/verifyMemoryCurrent
 * and the durable P2 accepted-line readback are mandatory.
 */
export async function openH1ConversationSource({store,turn,acceptedReceipt,input,source,isCurrent,
  nowUtc=new Date().toISOString()}={}){
  if(!playerSource.has(source)||typeof input!=='string'||typeof isCurrent!=='function'||
     !store||typeof store.readDialogueLines!=='function'||
     typeof store.listSuppressedMemoryIds!=='function'||
     !['stored','duplicate'].includes(acceptedReceipt?.status)||
     acceptedReceipt?.durable!==true||!uuid.test(acceptedReceipt.recordId)||
     !avatar.has(acceptedReceipt.protagonistKey))return unavailable('source_authority_missing');
  try{
    const characterId=turn?.characterProjection?.profile?.characterId;
    const profile=turn?.characterProjection?.profile;
    const scope=Object.freeze({characterId,worldProfileId:store.worldProfileId,
      timelineId:store.activeTimelineId,protagonistKey:acceptedReceipt.protagonistKey});
    const host=store.verifiedHostContext;
    const alias=profile?.promotion?.ownerAlias;
    const current=()=>isCurrent()===true&&
      turn.characterProjection?.persistent===true&&
      turn.characterProjection?.profile?.characterId===characterId&&
      turn.characterProjection?.profile?.promotion?.ownerAlias===alias&&
      turn.characterInputs?.profile?.characterId===characterId&&
      uuid.test(characterId)&&uuid.test(scope.worldProfileId)&&
      uuid.test(scope.timelineId)&&store.activeTimelineId===scope.timelineId&&
      store.timelineWritable===true&&sameHost(store.verifiedHostContext,host)&&
      store.get(characterId)?.promotion?.ownerAlias===alias&&
      turn.m2Capture?.verifyMemoryCurrent?.()===true;
    if(!alias||typeof turn.m2Capture?.openMemoryCurrent!=='function'||
       await turn.m2Capture.openMemoryCurrent()!==true||!current())
      return unavailable('source_authority_missing');
    // The current line MUST exist in durable P2; never reconstruct from input.
    const rows=await store.readDialogueLines({characterId,timelineId:scope.timelineId,limit:200});
    if(!current())return unavailable('source_authority_missing');
    const line=rows.find(row=>row.recordId===acceptedReceipt.recordId);
    const expectedSource=source==='player_mic'?'stt':'typed';
    if(!line||!validLine(line)||line.speaker!=='player'||line.source!==expectedSource||
       line.content!==input||!matchesScope(line,scope)||
       line.attribution?.protagonist!==scope.protagonistKey||
       !sameHost(line.attribution,host)||!uuid.test(line.attribution.sessionId)||
       !/^[0-9a-f]{64}$/.test(line.turnIdentityHash))
      return unavailable('source_authority_missing');
    const acceptedSeal=JSON.stringify(line);
    const stamp=Object.freeze({...scope,hostRunId:host.hostRunId,
      worldEpoch:host.worldEpoch,recordId:line.recordId});
    const hidden=async()=>{
      // The canonical P2 privacy reader expands inspector fact revisions to
      // their original dialogue sources and dependent records. M4 may be off.
      const ids=await store.listSuppressedMemoryIds(scope,{includeCorrections:true});
      if(!current())throw Error('memory_source_revoked');
      const corrections=await store.readCorrectionOverlays?.(scope)??[];
      if(!current())throw Error('memory_source_revoked');
      return [...new Set([...ids,...corrections.filter(x=>x.supersedesTarget!==false)
        .map(x=>x.targetId)])].sort();
    };
    // This read-only method is intentionally callable after any existing M5
    // durable command transaction, so correction/forget cannot leak stale text.
    async function prepare(){
      if(!current())return unavailable('source_authority_missing');
      try{
        // Bind suppression, correction overlays and journal readback to one
        // stable P2 generation. A change during either awaited read is denied.
        const fence=store.memoryReadFence;
        if(fence===null||fence===undefined)return unavailable('history_unavailable');
        const suppressed=await hidden();
        const freshRows=await store.readDialogueLines({
          characterId,timelineId:scope.timelineId,limit:200});
        if(!current())return unavailable('source_authority_missing');
        if(store.memoryReadFence!==fence||
           JSON.stringify(freshRows.find(row=>row.recordId===line.recordId))!==acceptedSeal)
          return unavailable('history_unavailable');
        const conversationJournal=assembleJournalConversation({
          rows:freshRows,accepted:line,scope,suppressed,nowUtc});
        if(!conversationJournal)return unavailable('history_unavailable');
        const journalSeal=JSON.stringify(conversationJournal);
        let verifiedFence=null,verifiedRequestFence=null;
        // Mandatory on every model attempt and before the final send boundary.
        // Snapshot comparisons are read-only and never grant native/source proof.
        async function verifyPrepared(){
          verifiedFence=null;
          const fence=store.memoryReadFence;
          if(!current()||fence===null||fence===undefined)
            return invalidated('source_authority_revoked');
          try{
            const freshHidden=await hidden();
            const checkRows=await store.readDialogueLines({
              characterId,timelineId:scope.timelineId,limit:200});
            if(!current()||store.memoryReadFence!==fence)
              return invalidated('source_authority_revoked');
            if(JSON.stringify(checkRows.find(row=>row.recordId===line.recordId))!==acceptedSeal)
              return invalidated('accepted_line_changed');
            const checkJournal=assembleJournalConversation({
              rows:checkRows,accepted:line,scope,suppressed:freshHidden,nowUtc});
            if(JSON.stringify(checkJournal)!==journalSeal)
              return invalidated('history_changed');
            verifiedFence=fence;
            verifiedRequestFence=store.memoryRequestFence??fence;
            return readyVerification;
          }catch{return invalidated('history_read_failed');}
        }
        const sendCurrent=()=>verifiedFence!==null&&current()&&
          store.memoryReadFence===verifiedFence;
        const sendCurrentInFlight=()=>verifiedFence!==null&&current()&&
          (store.memoryRequestFence??store.memoryReadFence)===verifiedRequestFence;
        const invalidationReason=()=>!current()?'authority_revoked':
          verifiedFence===null?'not_verified':
          store.memoryRequestFenceFailure?.(verifiedRequestFence)??
          (sendCurrentInFlight()?null:'source_changed');
        return Object.freeze({status:'ready',conversationJournal,stamp,
          verifyPrepared,sendCurrent,sendCurrentInFlight,invalidationReason});
      }catch{return unavailable('history_unavailable');}
    }
    return Object.freeze({status:'ready',scope,line,characterId,stamp,current,prepare});
  }catch{return unavailable('source_authority_missing');}
}

/** Independent one-call H1 API for H1-B/H1-C. Neither M4 recall nor M5
 * commands nor M8 personality is instantiated or required here.
 */
export async function prepareH1ConversationHistory(args={}){
  const source=await openH1ConversationSource(args);
  return source.status==='ready'?source.prepare():source;
}
