// D03 sole-P2 writer. This module NEVER issues original acceptance or native
// owner credentials. On pinned original Essential D01 has no positive source,
// so begin() is inert and writes nothing. Unit fixtures are not GTA receipts.
import {createHash} from 'node:crypto';
import {appendDialogue} from '../../../lsa-shared-brain/src/memory/journalSqlite.mjs';
import {journalIdentityUuid} from '../../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {digestExactUtf8} from './originalBackendAcceptedInput.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ID=['pedId','turnId','generationId','sessionNonce'];
const same=(a,b,keys)=>!!a&&!!b&&keys.every(k=>a[k]===b[k]);
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const denied=reason=>Object.freeze({status:'not_stored',reason});
const stop=reason=>{throw new Error(reason)};
const DDL='CREATE TABLE IF NOT EXISTS memory_d03_accepted_sources(record_id TEXT PRIMARY KEY REFERENCES dialogue_journal(record_id) ON DELETE CASCADE,source_json TEXT NOT NULL,source_sha256 TEXT NOT NULL)';
function authenticBackend(r,b,identity,text,source){
 const bytes=digestExactUtf8(text),pin=b.source;
 return !!bytes&&r?.kind==='OriginalBackendAcceptedInputV1'&&
   r.source==='original_essential_backend_post_acceptance'&&
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
export function createD03OriginalDialogueJoin({store,backend,d02,originalActor}={}){
 if(!store||typeof backend?.hasAuthenticatedSource!=='function'||
    typeof backend?.verifyAccepted!=='function')
  throw new TypeError('d03_original_p2_and_backend_ports_required');
 const sourceReady=()=>backend.source?.acceptedSourceHookAvailable===true&&
   backend.hasAuthenticatedSource()===true;
 function begin({identity,characterId,ownerAlias,isCurrent}={}){
  // Do not even request a preturn lease without a real original backend ACK
  // capability AND original Core actor binding. Neither is present in pin.
  if(!sourceReady()||!d02||!originalActor||
     typeof originalActor.resolveAtTurnStart!=='function'||
     typeof d02.bindActorAtTurnStart!=='function'||
     typeof d02.verifyCurrentOwnerAndPlayer!=='function'||
     typeof isCurrent!=='function'||!isCurrent()||
     !UUID.test(characterId)||typeof ownerAlias!=='string'||
     !ID.every(k=>identity?.[k]!==undefined)||!store.timelineWritable)
    return null;
  const host=store.verifiedHostContext;
  const scope=Object.freeze({characterId,worldProfileId:store.worldProfileId,
     timelineId:store.activeTimelineId});
  if(!host||!UUID.test(host.hostRunId)||!Number.isSafeInteger(host.worldEpoch)||
     !UUID.test(scope.worldProfileId)||!UUID.test(scope.timelineId)||
     store.get(characterId)?.promotion?.ownerAlias!==ownerAlias)return null;
  let actor;
  try{actor=originalActor.resolveAtTurnStart({identity,characterId,ownerAlias});}
  catch{return null;}
  if(actor?.source!=='original_core_actor_at_turn_start'||
     !same(actor.identity,identity,ID)||actor.characterId!==characterId||
     actor.ownerAlias!==ownerAlias||
     !/^[1-9][0-9]{0,9}$/.test(actor.nativeActorPedId))return null;
  let lease;
  try{lease=d02.bindActorAtTurnStart({pedId:actor.nativeActorPedId,characterId,ownerAlias});}
  catch{return null;}
  if(!lease)return null;
  let retired=false;
  const close=()=>{retired=true;try{d02.revokeLease?.(lease)}catch{}};
  const current=()=>!retired&&isCurrent()&&store.timelineWritable===true&&
    store.worldProfileId===scope.worldProfileId&&store.activeTimelineId===scope.timelineId&&
    same(store.verifiedHostContext,host,['hostRunId','worldEpoch'])&&
    store.get(characterId)?.promotion?.ownerAlias===ownerAlias;
  const verify=(text,source)=>{
    if(!current()||!sourceReady())return null;
    let b,n;
    try{
      b=backend.verifyAccepted({identity,source,text,host});
      n=d02.verifyCurrentOwnerAndPlayer({lease,identity,characterId,ownerAlias});
    }catch{return null;}
    if(!authenticBackend(b,backend,identity,text,source)||
       !authenticNative(n,identity,scope,ownerAlias,host,actor.nativeActorPedId))
      return null;
    return {b,n};
  };
  async function acceptPlayer({source,text,transcription=null}={}){
    if(!['typed','stt'].includes(source))return denied('d03_invalid_input_mode');
    const first=verify(text,source);
    if(!first)return denied('d03_original_or_native_source_unverified');
    const origin=Object.freeze({sessionId:journalIdentityUuid([
      'session',host.hostRunId,identity.sessionNonce,identity.pedId]),
      protagonist:first.n.avatarKey,hostRunId:host.hostRunId,worldEpoch:host.worldEpoch});
    const turnHash=sha(JSON.stringify(['memory.turn.v1',characterId,
      scope.timelineId,'player',origin.sessionId,origin.hostRunId,
      identity.pedId,identity.turnId,identity.generationId,identity.sessionNonce]));
    const line={
      version:1,...scope,kind:'dialogue_line',
      recordId:journalIdentityUuid(['player',turnHash]),speaker:'player',source,
      content:text,delivery:'accepted',committedAtUtc:first.b.sourceTimestamp,
      turnIdentityHash:turnHash,utteranceId:null,
      transcription:source==='stt'?(transcription??{
        provider:'unknown',model:'unknown',confidence:null}):null,
      deliveryReceiptId:null
    };
    const proof=()=> {
      const x=verify(text,source);
      if(!x||!same(x.b,first.b,[...ID,'sourceRunId','sourceRevision',
       'originalBundleSha256','inputMode','finalAcceptedInputRevision',
       'acceptedUtf8Sha256','acceptedUtf8ByteLength','sourceTimestamp'])||
       JSON.stringify(x.b.retirementIdentity)!==
       JSON.stringify(first.b.retirementIdentity)||
       !same(x.n,first.n,['characterId','ownerAlias','nativeActorPedId',
         'observerCaptureRef','incarnationId','encounterId','playerCaptureRef',
         'avatarKey','hostRunId','worldEpoch','streamId','adapterEpoch']))
       stop('d03_source_changed_or_retired');
      return x;
    };
    let persisted;
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
    }catch{ return denied('d03_transaction_rejected');}
    try{
      // Independent P2 readback after transaction; an INSERT return value
      // by itself is not a durable M5-command authorization.
      const row=await store.withP2SqliteRead(scope,db=>{
        const lineRow=db.prepare('SELECT content,content_sha256,source,delivery FROM dialogue_journal WHERE record_id=?').get(persisted.recordId);
        const sourceRow=db.prepare('SELECT source_json,source_sha256 FROM memory_d03_accepted_sources WHERE record_id=?').get(persisted.recordId);
        return {lineRow,sourceRow};
      });
      if(!current()||!proof()||row?.lineRow?.content!==text||
         row.lineRow.content_sha256!==sha(text)||
         row.lineRow.source!==source||row.lineRow.delivery!=='accepted'||
         row.sourceRow?.source_sha256!==persisted.sourceSha256||
         sha(row.sourceRow.source_json)!==row.sourceRow.source_sha256)
        return denied('d03_durable_readback_unverified');
      return Object.freeze({status:persisted.inserted?'stored':'duplicate',
        durable:true,recordId:persisted.recordId,scope,
        sourceSha256:persisted.sourceSha256,
        // Provenance is actor metadata, not an independent human identity.
        protagonistKey:first.n.avatarKey,humanPlayerScope:'single_local_human'});
    }catch{return denied('d03_durable_readback_unverified');}
  }
  return Object.freeze({acceptPlayer,retire:close});
 }
 return Object.freeze({begin,sourceReady});
}
