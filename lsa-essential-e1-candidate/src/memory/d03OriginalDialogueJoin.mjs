import {isNativeActorId} from '../identity/nativeActorId.mjs';
// D03 sole-P2 writer. This module NEVER issues acceptance receipts or native
// owner credentials. It joins (D01) a receipt minted by the backend's own
// accepted-input decision, (D02) authenticated current native owner/player
// corroboration from a lease bound before acceptance, (ledger) the native ped
// the original backend bound to the turn at creation and (P1) the verified
// session owner claim, then commits one exact player line atomically through
// the existing P2 SQLite writer. On the stock Gemini source D01 is
// denial-only, so begin() is inert and nothing is written.
//
// WS-5a: the SAME sole writer also records the NPC side of the exchange
// (recordNpcOutcome). An NPC line is journaled only as the reply to this turn's
// durably stored player line (reply_to), only from the runtime's own
// speech-delivery ledger (never from caller arguments), only while a FRESH D02
// lease proves the same native owner incarnation/encounter, controlled player,
// avatar and stream as the player line, and only while the D01 source run that
// accepted the player line is still live. completed/interrupted/failed are
// classified by the ledger, not by the caller. A status of `not_stored` means
// "no durable receipt": the line may not be used as an M5 acknowledgement.
import {createHash} from 'node:crypto';
import {appendDialogue} from '../../../lsa-shared-brain/src/memory/journalSqlite.mjs';
import {journalIdentityUuid,journalTurnIdentityHash} from '../../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {digestExactUtf8,ORIGINAL_BACKEND_ACCEPTED_INPUT_V1} from './originalBackendAcceptedInput.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID=['pedId','turnId','generationId','sessionNonce'];
// Closed set of acceptance transitions D03 understands. The verifier's pin
// selects exactly one; a receipt must carry that exact source string.
const RECEIPT_SOURCES=new Set([ORIGINAL_BACKEND_ACCEPTED_INPUT_V1.source,
  'essential_openai_runtime_commit_decision']);
const same=(a,b,keys)=>!!a&&!!b&&keys.every(k=>a[k]===b[k]);
const utcOk=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const denied=reason=>Object.freeze({status:'not_stored',reason});
const stop=reason=>{throw new Error(reason)};
const NATIVE_LOST='d03_native_corroboration_lost';
const NATIVE_KEYS=['characterId','ownerAlias','nativeActorPedId','observerCaptureRef',
  'incarnationId','encounterId','playerCaptureRef','avatarKey','hostRunId',
  'worldEpoch','streamId','adapterEpoch'];
const RECEIPT_KEYS=[...ID,'sourceRunId','sourceRevision','originalBundleSha256',
  'inputMode','finalAcceptedInputRevision','acceptedUtf8Sha256',
  'acceptedUtf8ByteLength','sourceTimestamp'];
const DDL='CREATE TABLE IF NOT EXISTS memory_d03_accepted_sources(record_id TEXT PRIMARY KEY REFERENCES dialogue_journal(record_id) ON DELETE CASCADE,source_json TEXT NOT NULL,source_sha256 TEXT NOT NULL)';
// Provenance of an NPC line: speech-delivery evidence digest, reply_to and the
// native continuity proof. Written in the same transaction as the line.
const NPC_DDL='CREATE TABLE IF NOT EXISTS memory_d03_npc_delivery_sources(record_id TEXT PRIMARY KEY REFERENCES dialogue_journal(record_id) ON DELETE CASCADE,source_json TEXT NOT NULL,source_sha256 TEXT NOT NULL)';
const NPC_STATUS=Object.freeze(['completed','interrupted','failed']);
const defaultClock=Object.freeze({now:()=>performance.now(),
  sleep:ms=>new Promise(resolve=>setTimeout(resolve,ms))});
function authenticBackend(r,b,identity,text,source){
 const bytes=digestExactUtf8(text),pin=b.source;
 const expectedSource=pin?.receiptSource??ORIGINAL_BACKEND_ACCEPTED_INPUT_V1.source;
 return !!bytes&&r?.kind==='OriginalBackendAcceptedInputV1'&&
   RECEIPT_SOURCES.has(expectedSource)&&r.source===expectedSource&&
   r.lifecycleStatus==='accepted'&&r.inputMode===source&&
   same(r,identity,ID)&&r.sourceRevision===pin?.sourceRevision&&
   r.originalBundleSha256===pin?.originalBundleSha256&&
   r.acceptedUtf8Sha256===bytes.sha256&&r.acceptedUtf8ByteLength===bytes.byteLength&&
   Number.isSafeInteger(r.finalAcceptedInputRevision)&&r.finalAcceptedInputRevision>=1&&
   typeof r.sourceRunId==='string'&&r.sourceRunId.length>0&&
   typeof r.sourceTimestamp==='string'&&Number.isFinite(Date.parse(r.sourceTimestamp))&&
   !!r.retirementIdentity&&typeof r.retirementIdentity==='object';
}
function authenticNative(n,identity,scope,alias,host,ped){
 return n?.kind==='NativeCurrentPlayerAndOwnerV1'&&
 n.nativeCurrentOwnerVerified===true&&n.originalBackendAccepted===false&&
 same(n.identity,identity,ID)&&n.nativeActorPedId===ped&&
 n.characterId===scope.characterId&&n.ownerAlias===alias&&
 same(n,host,['hostRunId','worldEpoch'])&&
 n.humanPlayerScope==='single_local_human'&&
 ['franklin','michael','trevor'].includes(n.avatarKey)&&
 ['observerCaptureRef','incarnationId','encounterId','playerCaptureRef',
  'streamId','adapterEpoch'].every(k=>UUID.test(n[k]))&&
 Number.isSafeInteger(n.sequence)&&n.sequence>0;
}
export function createD03OriginalDialogueJoin({store,backend,d02,originalActor,
  npcCompletedOnly=false,onDiagnostic=null,
  clock=defaultClock,corroborationWaitMs=750,corroborationPollMs=20,
  totalWaitMs=1500}={}){
 if(!store||typeof backend?.hasAuthenticatedSource!=='function'||
    typeof backend?.verifyAccepted!=='function'||
    typeof clock?.now!=='function'||typeof clock?.sleep!=='function'||
    !Number.isSafeInteger(corroborationWaitMs)||corroborationWaitMs<0||
    corroborationWaitMs>5000||!Number.isSafeInteger(corroborationPollMs)||
    corroborationPollMs<1||corroborationPollMs>1000||
    !Number.isSafeInteger(totalWaitMs)||totalWaitMs<corroborationWaitMs||totalWaitMs>10000)
  throw new TypeError('d03_original_p2_and_backend_ports_required');
 const sourceReady=()=>backend.source?.acceptedSourceHookAvailable===true&&
   backend.hasAuthenticatedSource()===true;
 // `isCurrent` is the turn's currency BEFORE acceptance; the D01 receipt is
 // issued only while it holds. `p1Binding`, when supplied, reads the live P1
 // runtime binding of this exact session (fresh native owner proof of this
 // ped at turn preparation); its claim incarnation must equal D02's.
 function begin({identity,characterId,ownerAlias,isCurrent,p1Binding=null,speech=null}={}){
  const refuse=reason=>{try{onDiagnostic?.(reason);}catch{}return null;};
  // Do not even request a preturn lease without a live acceptance source AND
  // the original-backend actor association recorded at turn creation.
  if(!sourceReady())return refuse('d03_acceptance_source_unavailable');
  if(!d02||typeof d02.bindActorAtTurnStart!=='function'||
     typeof d02.verifyCurrentOwnerAndPlayer!=='function')return refuse('d03_native_authority_unavailable');
  if(!originalActor||typeof originalActor.resolveAtTurnStart!=='function')return refuse('d03_actor_ledger_unavailable');
  if(typeof isCurrent!=='function'||!isCurrent()||
     !UUID.test(characterId)||typeof ownerAlias!=='string'||
     !ID.every(k=>identity?.[k]!==undefined)||!store.timelineWritable)
    return refuse(!store.timelineWritable?'d03_'+(store.timelinePendingReason??'timeline_write_suspended'):'d03_admission_unavailable');
  const host=store.verifiedHostContext;
  const scope=Object.freeze({characterId,worldProfileId:store.worldProfileId,
     timelineId:store.activeTimelineId});
  if(!host||!UUID.test(host.hostRunId)||!Number.isSafeInteger(host.worldEpoch)||
     !UUID.test(scope.worldProfileId)||!UUID.test(scope.timelineId)||
     store.get(characterId)?.promotion?.ownerAlias!==ownerAlias)return refuse('d03_host_or_profile_unavailable');
  let p1=null;
  if(p1Binding!==null){
   if(typeof p1Binding!=='function')return refuse('d03_p1_binding_unavailable');
   try{p1=p1Binding();}catch{return refuse('d03_p1_binding_unavailable');}
   if(!p1||p1.characterId!==characterId||p1.claim?.sourceKey!==ownerAlias||
      !UUID.test(p1.claim?.incarnationId)||p1.pedId!==identity.pedId||
      p1.sessionNonce!==identity.sessionNonce||typeof p1.bindingId!=='string')
    return refuse('d03_p1_binding_mismatch');
  }
  let actor;
  try{actor=originalActor.resolveAtTurnStart({identity,characterId,ownerAlias});}
  catch{return refuse('d03_original_actor_unavailable');}
  if(actor?.source!=='original_core_actor_at_turn_start'||
     !same(actor.identity,identity,ID)||actor.characterId!==characterId||
     actor.ownerAlias!==ownerAlias||actor.nativeActorPedId!==identity.pedId||
     !isNativeActorId(actor.nativeActorPedId))return refuse('d03_original_actor_unavailable');
  let lease;
  try{lease=d02.bindActorAtTurnStart({pedId:actor.nativeActorPedId,characterId,ownerAlias});}
  catch{return refuse('d03_native_owner_lease_unavailable');}
  if(!lease)return refuse('d03_native_owner_lease_unavailable');
  let retired=false,player=null,memoryLease=null;
  const close=()=>{
    retired=true;
    if(memoryLease)try{d02.revokeLease?.(memoryLease);}catch{}
    memoryLease=null;
    try{d02.revokeLease?.(lease)}catch{}
  };
  // After acceptance the receipt, not the turn, governs (memory plan §5.5:
  // an accepted line stands even if the turn is later interrupted). Session,
  // source-run, actor/player, timeline, world and host changes still fence.
  const current=()=>!retired&&store.timelineWritable===true&&
    store.worldProfileId===scope.worldProfileId&&store.activeTimelineId===scope.timelineId&&
    same(store.verifiedHostContext,host,['hostRunId','worldEpoch'])&&
    store.get(characterId)?.promotion?.ownerAlias===ownerAlias;
  // Returns {b,n} when D01 + D02 (+P1) agree right now, else {lost:reason}.
  const read=(text,source,useLease=lease)=>{
    if(!current()||!sourceReady())return {lost:'state'};
    let b,n;
    try{b=backend.verifyAccepted({identity,source,text,host});}catch{return {lost:'backend'};}
    if(!authenticBackend(b,backend,identity,text,source))return {lost:'backend'};
    try{n=d02.verifyCurrentOwnerAndPlayer({lease:useLease,identity,characterId,ownerAlias});}
    catch{return {lost:'native'};}
    if(!authenticNative(n,identity,scope,ownerAlias,host,actor.nativeActorPedId))
      return {lost:'native'};
    if(p1){
     let live;
     try{live=p1Binding();}catch{return {lost:'p1'};}
     if(!live||live.bindingId!==p1.bindingId||n.incarnationId!==p1.claim.incarnationId)
      return {lost:'p1'};
    }
    return {b,n};
  };
  // D02 proof needs an authenticated owner sample NEWER than the lease bind;
  // native publishes one every 250 ms. Wait for it (bounded) instead of
  // weakening D02; stop at once if D01 (read first), P1, store or session
  // state fails. Without a D01 receipt this returns null without waiting.
  async function corroborate(text,source,deadline,useLease=lease){
   for(;;){
    if(retired||!current()||!sourceReady())return null;
    const x=read(text,source,useLease);
    if(x.b)return x;
    if(x.lost!=='native')return null;
    let connected=true;
    try{connected=typeof d02.status!=='function'||d02.status()?.connected===true;}
    catch{connected=false;}
    if(!connected||clock.now()>=deadline)return null;
    await clock.sleep(corroborationPollMs);
   }
  }
  async function acceptPlayer({source,text,transcription=null}={}){
    if(!['typed','stt'].includes(source))return denied('d03_invalid_input_mode');
    // ONE shared budget bounds every wait before the model call: the first
    // corroboration, the post-rollback retries and the durable readback.
    const budgetEnd=clock.now()+totalWaitMs;
    const deadline=Math.min(clock.now()+corroborationWaitMs,budgetEnd);
    const first=await corroborate(text,source,deadline);
    if(!first)return denied('d03_original_or_native_source_unverified');
    const origin=Object.freeze({sessionId:journalIdentityUuid([
      'session',host.hostRunId,identity.sessionNonce,identity.pedId]),
      protagonist:first.n.avatarKey,hostRunId:host.hostRunId,worldEpoch:host.worldEpoch});
    const turnHash=journalTurnIdentityHash({characterId,timelineId:scope.timelineId,
      speaker:'player',sessionId:origin.sessionId,hostRunId:origin.hostRunId,identity});
    const line={
      version:1,...scope,kind:'dialogue_line',
      recordId:journalIdentityUuid(['player',turnHash]),speaker:'player',source,
      content:text,delivery:'accepted',committedAtUtc:first.b.sourceTimestamp,
      turnIdentityHash:turnHash,utteranceId:null,
      transcription:source==='stt'?(transcription??{
        provider:'unknown',model:'unknown',confidence:null}):null,
      deliveryReceiptId:null
    };
    const consistent=x=>same(x.b,first.b,RECEIPT_KEYS)&&
       JSON.stringify(x.b.retirementIdentity)===JSON.stringify(first.b.retirementIdentity)&&
       same(x.n,first.n,NATIVE_KEYS);
    const proof=()=> {
      const x=read(text,source);
      if(x.lost==='native')stop(NATIVE_LOST);
      if(!x.b||!consistent(x))stop('d03_source_changed_or_retired');
      return x;
    };
    let persisted=null;
    for(let attempt=0;!persisted;attempt++){
    try {
      // All source reads are synchronous INSIDE the existing P2 serialized
      // transaction. The outer transaction includes both dialogue and source.
      persisted=await store.withP2SqliteTransaction(scope,db=>{
        const x=proof();
        const evidence=JSON.stringify({
          kind:'original_d01_plus_authenticated_d02_v1',
          identity:Object.fromEntries(ID.map(k=>[k,identity[k]])),
          worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,
          characterId,ownerAlias,humanPlayerScope:'single_local_human',
          receiptSource:x.b.source,
          sourceRunId:x.b.sourceRunId,sourceRevision:x.b.sourceRevision,
          originalBundleSha256:x.b.originalBundleSha256,
          inputMode:source,finalAcceptedInputRevision:x.b.finalAcceptedInputRevision,
          acceptedUtf8Sha256:x.b.acceptedUtf8Sha256,
          acceptedUtf8ByteLength:x.b.acceptedUtf8ByteLength,
          sourceTimestamp:x.b.sourceTimestamp,
          retirementIdentity:x.b.retirementIdentity,
          observerCaptureRef:x.n.observerCaptureRef,
          incarnationId:x.n.incarnationId,encounterId:x.n.encounterId,
          playerCaptureRef:x.n.playerCaptureRef,avatarKey:x.n.avatarKey,
          hostRunId:x.n.hostRunId,worldEpoch:x.n.worldEpoch,
          streamId:x.n.streamId,adapterEpoch:x.n.adapterEpoch
        });
        db.exec(DDL);
        const receipt=appendDialogue(db,line,origin,scope.worldProfileId);
        const saved=db.prepare('SELECT source_json,source_sha256 FROM memory_d03_accepted_sources WHERE record_id=?').get(receipt.recordId);
        if(saved){
          if(saved.source_json!==evidence||saved.source_sha256!==sha(evidence))
            stop('d03_replay_or_revision_conflict');
        }else db.prepare('INSERT INTO memory_d03_accepted_sources(record_id,source_json,source_sha256) VALUES(?,?,?)')
          .run(receipt.recordId,evidence,sha(evidence));
        proof(); // second independent D01 + D02 read-through at COMMIT
        return {recordId:receipt.recordId,inserted:receipt.inserted,
          sourceSha256:sha(evidence)};
      });
    }catch(error){
      // Only a lost native corroboration (e.g. a roster frame interleaved
      // before the queued COMMIT) is retried, with a full fresh corroboration
      // against the SAME receipt and owner record. Everything rolled back.
      if(error?.message!==NATIVE_LOST||attempt>=2)return denied('d03_transaction_rejected');
      const again=await corroborate(text,source,deadline);
      if(!again||!consistent(again))return denied('d03_transaction_rejected');
    }
    }
    try{
      // Independent P2 readback after transaction; an INSERT return value
      // by itself is not a durable M5-command authorization.
      const row=await store.withP2SqliteRead(scope,db=>{
        const lineRow=db.prepare('SELECT content,content_sha256,source,delivery FROM dialogue_journal WHERE record_id=?').get(persisted.recordId);
        const sourceRow=db.prepare('SELECT source_json,source_sha256 FROM memory_d03_accepted_sources WHERE record_id=?').get(persisted.recordId);
        return {lineRow,sourceRow};
      });
      // The readback is another queued P2 hop, still inside the shared budget.
      const settled=await corroborate(text,source,
        Math.min(clock.now()+corroborationWaitMs,budgetEnd));
      if(!settled||!consistent(settled)||row?.lineRow?.content!==text||
         row.lineRow.content_sha256!==sha(text)||
         row.lineRow.source!==source||row.lineRow.delivery!=='accepted'||
         row.sourceRow?.source_sha256!==persisted.sourceSha256||
         sha(row.sourceRow.source_json)!==row.sourceRow.source_sha256)
        return denied('d03_durable_readback_unverified');
      // The NPC reply (recordNpcOutcome) binds to exactly this durable line.
      player=Object.freeze({recordId:persisted.recordId,
        sourceSha256:persisted.sourceSha256,text,source,first,origin,
        committedAtUtc:first.b.sourceTimestamp});
      return Object.freeze({status:persisted.inserted?'stored':'duplicate',
        durable:true,recordId:persisted.recordId,scope,
        sourceSha256:persisted.sourceSha256,
        // Provenance is actor metadata, not an independent human identity.
        protagonistKey:first.n.avatarKey,humanPlayerScope:'single_local_human'});
    }catch{return denied('d03_durable_readback_unverified');}
  }
  // NPC reply of THIS turn. No argument can supply text, status, receipts or
  // byte counts: the outcome is whatever the runtime's own speech-delivery
  // ledger (`speech`) proves right now, re-read synchronously inside the P2
  // transaction. The player line (reply_to) must already be durable.
  async function recordNpcOutcome({waitMs=corroborationWaitMs}={}){
    if(retired)return denied('d03_turn_retired');
    const evidenceNow=()=>{
      let e=null;
      try{e=typeof speech?.evaluate==='function'?speech.evaluate():null;}catch{e=null;}
      return e&&e.kind==='NpcSpeechDeliveryEvidenceV1'&&same(e.identity,identity,ID)&&
        NPC_STATUS.includes(e.delivery)&&(!npcCompletedOnly||e.delivery==='completed')&&typeof e.text==='string'&&
        typeof e.evidenceSha256==='string'&&utcOk(e.observedAtUtc)?e:null;
    };
    const ev=evidenceNow();
    if(!ev)return denied('d03_npc_no_outcome');
    if(!player)return denied('d03_no_durable_player_line');
    // A reply that is itself unrecordable must not outlive the player line's
    // authority: the SAME D01 source run and a FRESH D02 lease (the original
    // lease is only a turn-scale backstop; speech may outlast it) must still
    // agree on the native owner/player the player line was written under.
    let lease2=null;
    try{lease2=d02.bindActorAtTurnStart({pedId:actor.nativeActorPedId,characterId,ownerAlias});}
    catch{lease2=null;}
    if(!lease2)return denied('d03_native_corroboration_lost');
    try{
      const budgetEnd=clock.now()+Math.max(waitMs,0)*2;
      const deadline=Math.min(clock.now()+waitMs,budgetEnd);
      const readNpc=()=>read(player.text,player.source,lease2);
      const continuous=x=>same(x.b,player.first.b,RECEIPT_KEYS)&&
        JSON.stringify(x.b.retirementIdentity)===JSON.stringify(player.first.b.retirementIdentity)&&
        same(x.n,player.first.n,NATIVE_KEYS);
      const corroborateNpc=async until=>{
        for(;;){
          if(retired||!current()||!sourceReady())return null;
          const x=readNpc();
          if(x.b)return x;
          if(x.lost!=='native')return null;
          let connected=true;
          try{connected=typeof d02.status!=='function'||d02.status()?.connected===true;}
          catch{connected=false;}
          if(!connected||clock.now()>=until)return null;
          await clock.sleep(corroborationPollMs);
        }
      };
      const start=await corroborateNpc(deadline);
      if(!start)return denied('d03_original_or_native_source_unverified');
      if(!continuous(start))return denied('d03_npc_continuity_lost');
      const turnHash=journalTurnIdentityHash({characterId,timelineId:scope.timelineId,
        speaker:'npc',sessionId:player.origin.sessionId,hostRunId:player.origin.hostRunId,identity});
      const line={
        version:1,...scope,kind:'dialogue_line',
        recordId:journalIdentityUuid(['npc',turnHash]),speaker:'npc',source:'npc_generated',
        content:ev.text,delivery:ev.delivery,
        // The reply can never precede the line it answers on the timeline.
        committedAtUtc:Date.parse(ev.observedAtUtc)>=Date.parse(player.committedAtUtc)
          ?ev.observedAtUtc:player.committedAtUtc,
        turnIdentityHash:turnHash,utteranceId:null,transcription:null,
        deliveryReceiptId:ev.delivery==='failed'?null
          :journalIdentityUuid([ev.delivery==='completed'?'native-completed':'native-interrupted',turnHash]),
        replyTo:player.recordId
      };
      const {text:ignoredText,...speechBody}=ev;
      const proof=()=>{
        const x=readNpc();
        if(x.lost==='native')stop(NATIVE_LOST);
        if(!x.b||!continuous(x))stop('d03_source_changed_or_retired');
        const live=evidenceNow();
        if(!live||live.evidenceSha256!==ev.evidenceSha256)stop('d03_npc_evidence_changed');
        return x;
      };
      let persisted=null;
      for(let attempt=0;!persisted;attempt++){
        try{
          persisted=await store.withP2SqliteTransaction(scope,db=>{
            const x=proof();
            const evidence=JSON.stringify({
              kind:'original_d03_npc_delivery_v1',
              identity:Object.fromEntries(ID.map(k=>[k,identity[k]])),
              worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,
              characterId,ownerAlias,humanPlayerScope:'single_local_human',
              replyTo:player.recordId,playerSourceSha256:player.sourceSha256,
              delivery:ev.delivery,contentSha256:sha(ev.text),
              speechEvidenceSha256:ev.evidenceSha256,speech:speechBody,
              native:Object.fromEntries(NATIVE_KEYS.map(k=>[k,x.n[k]]))
            });
            db.exec(NPC_DDL);
            const receipt=appendDialogue(db,line,player.origin,scope.worldProfileId);
            const saved=db.prepare('SELECT source_json,source_sha256 FROM memory_d03_npc_delivery_sources WHERE record_id=?').get(receipt.recordId);
            if(saved){
              if(saved.source_json!==evidence||saved.source_sha256!==sha(evidence))
                stop('d03_replay_or_revision_conflict');
            }else db.prepare('INSERT INTO memory_d03_npc_delivery_sources(record_id,source_json,source_sha256) VALUES(?,?,?)')
              .run(receipt.recordId,evidence,sha(evidence));
            proof(); // second independent D01 + D02 + ledger read-through at COMMIT
            return {recordId:receipt.recordId,inserted:receipt.inserted,sourceSha256:sha(evidence)};
          });
        }catch(error){
          if(error?.message!==NATIVE_LOST||attempt>=2)return denied('d03_transaction_rejected');
          const again=await corroborateNpc(Math.min(clock.now()+waitMs,budgetEnd));
          if(!again||!continuous(again))return denied('d03_transaction_rejected');
        }
      }
      try{
        const row=await store.withP2SqliteRead(scope,db=>({
          lineRow:db.prepare('SELECT content,content_sha256,source,speaker,delivery,envelope_json FROM dialogue_journal WHERE record_id=?').get(persisted.recordId),
          sourceRow:db.prepare('SELECT source_json,source_sha256 FROM memory_d03_npc_delivery_sources WHERE record_id=?').get(persisted.recordId)
        }));
        let envelope=null;
        try{envelope=JSON.parse(row?.lineRow?.envelope_json);}catch{envelope=null;}
        const settled=await corroborateNpc(Math.min(clock.now()+waitMs,budgetEnd));
        if(!settled||!continuous(settled)||row?.lineRow?.content!==ev.text||
           row.lineRow.content_sha256!==sha(ev.text)||row.lineRow.source!=='npc_generated'||
           row.lineRow.speaker!=='npc'||row.lineRow.delivery!==ev.delivery||
           envelope?.replyTo!==player.recordId||envelope.delivery!==ev.delivery||
           row.sourceRow?.source_sha256!==persisted.sourceSha256||
           sha(row.sourceRow.source_json)!==row.sourceRow.source_sha256)
          return denied('d03_durable_readback_unverified');
        return Object.freeze({status:persisted.inserted?'stored':'duplicate',
          durable:true,recordId:persisted.recordId,scope,replyTo:player.recordId,
          delivery:ev.delivery,sourceSha256:persisted.sourceSha256,
          protagonistKey:player.first.n.avatarKey,humanPlayerScope:'single_local_human'});
      }catch{return denied('d03_durable_readback_unverified');}
    }finally{try{d02.revokeLease?.(lease2);}catch{}}
  }
  // WS-6: the source requires a native frame *newer* than the new lease.
  // First corroborate asynchronously with the same strict D01/D02 continuity
  // rules as D03, then keep this lease for synchronous pre-send rechecks.
  // A missing/expired/recycled owner always disables memory; never downgrade.
  const memoryProof=x=>!!player&&!!x.b&&
    same(x.b,player.first.b,RECEIPT_KEYS)&&
    JSON.stringify(x.b.retirementIdentity)===JSON.stringify(player.first.b.retirementIdentity)&&
    same(x.n,player.first.n,NATIVE_KEYS);
  async function openMemoryCurrent(){
    if(!player||retired||!current()||!sourceReady())return false;
    if(memoryLease)return verifyMemoryCurrent();
    let pending=null;
    try{
      pending=d02.bindActorAtTurnStart({pedId:actor.nativeActorPedId,characterId,ownerAlias});
      if(!pending)return false;
      const evidence=await corroborate(player.text,player.source,
        clock.now()+corroborationWaitMs,pending);
      if(!evidence||!memoryProof(evidence)||!current())return false;
      memoryLease=pending;pending=null;
      return verifyMemoryCurrent();
    }catch{return false;}
    finally{if(pending)try{d02.revokeLease?.(pending);}catch{}}
  }
  function verifyMemoryCurrent(){
    if(!memoryLease||!player||retired||!current()||!sourceReady())return false;
    try{return memoryProof(read(player.text,player.source,memoryLease));}
    catch{return false;}
  }
  // Read-only identity issued only by this accepted D01/D02 join. Consumers
  // cannot supply their own nativeVerified flag or historical owner identity.
  function memoryIdentity(){
    if(!verifyMemoryCurrent())return null;
    const x=read(player.text,player.source,memoryLease);
    if(!memoryProof(x))return null;
    return Object.freeze({...scope,...Object.fromEntries(NATIVE_KEYS.map(k=>[k,x.n[k]])),
      protagonistKey:player.first.n.avatarKey,
      turnId:journalIdentityUuid(['original-turn',...ID.map(k=>identity[k])]),
      turnIdentityHash:journalTurnIdentityHash({characterId,timelineId:scope.timelineId,
        speaker:'player',sessionId:player.origin.sessionId,hostRunId:player.origin.hostRunId,identity}),
      nativeVerified:true,timelineWritable:true});
  }
  return Object.freeze({acceptPlayer,recordNpcOutcome,openMemoryCurrent,verifyMemoryCurrent,memoryIdentity,retire:close});
 }
 return Object.freeze({begin,sourceReady});
}
