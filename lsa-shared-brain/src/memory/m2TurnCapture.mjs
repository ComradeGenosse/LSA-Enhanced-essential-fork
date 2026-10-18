// M2 production integration boundary. This is an adapter for verified host hooks,
// not a second dialogue recorder, SQLite store, or native playback observer.
import {createConversationJournalRecorder} from './conversationRecorder.mjs';
import {isUuid} from '../util/identity.mjs';
import {createHash} from 'node:crypto';

const fail = code => { throw new Error(code); };
const protagonists = new Set(['franklin','michael','trevor','unknown']);
const identityKeys = ['pedId','turnId','generationId','sessionNonce'];
const sameIdentity=(a,b)=>validIdentity(a)&&validIdentity(b)&&
  identityKeys.every(k=>a[k]===b[k]);
const fullNativeProof=(p,{identity,characterId,ownerAlias,host,protagonist})=>
  p?.nativeVerified===true&&p.current===true&&
  p.characterId===characterId&&p.ownerAlias===ownerAlias&&
  p.hostRunId===host.hostRunId&&p.worldEpoch===host.worldEpoch&&
  p.protagonistKey===protagonist&&sameIdentity(p.identity,identity)&&
  isUuid(p.incarnationId)&&isUuid(p.encounterId)&&
  Number.isSafeInteger(p.observerIndex)&&p.observerIndex>=0;
const validSpeechProof=(p,mode,text,spokenSegments,identity)=>{
  if(!p||p.sealed!==true||p.mode!==mode||!sameIdentity(p.identity,identity)||
     !Array.isArray(p.segments)||p.segments.length<1||p.segments.length>128)return false;
  if(mode==='buffered'&&p.segments.length!==1)return false;
  if(mode==='early_streamed'&&
     (!Array.isArray(spokenSegments)||spokenSegments.length!==p.segments.length))return false;
  let content='';
  for(let i=0;i<p.segments.length;i++){
    const segment=p.segments[i];
    if(segment.sequence!==i||typeof segment.text!=='string'||!segment.text||
       segment.providerCompleted!==true||
       !Number.isSafeInteger(segment.audioBytes)||segment.audioBytes<=0||
       segment.forwardedBytes!==segment.audioBytes||
       (mode==='early_streamed'&&segment.text!==spokenSegments[i]))return false;
    content+=segment.text;
  }
  return content===text;
};
const validIdentity = identity => !!identity && identityKeys.every(k =>
  identity[k] !== null && identity[k] !== undefined &&
  String(identity[k]).length > 0 && String(identity[k]).length <= 128);
const safeReason = error => {
  const code = String(error?.message || '');
  return /^(m2_|journal_|timeline_|profile_store_)[a-z0-9_]{1,80}$/.test(code)
    ? code : 'm2_storage_failed';
};
const capture = async operation => {
  try {
    const receipt = await operation();
    if (!receipt || typeof receipt.inserted !== 'boolean' || !isUuid(receipt.recordId))
      fail('m2_commit_not_verified');
    return Object.freeze({status:receipt.inserted?'stored':'duplicate',
      inserted:receipt.inserted,recordId:receipt.recordId});
  } catch(error) {
    // No raw dialogue or underlying SQLite exception is exposed to telemetry.
    return Object.freeze({status:'not_stored',reason:safeReason(error)});
  }
};

/**
 * Bind once to the accepted live native turn, BEFORE awaiting STT/TTS/SQLite.
 * Caller must implement isCurrent using authoritative turn/ped incarnation and
 * owner lifetime, and currentProtagonist from verified C-01/host evidence.
 *
 * Neither the callback nor a source snapshot is authority on its own:
 * both are rechecked inside M1's serialized withTimelineWrite callback.
 * This prevents a queued/delayed receipt from acquiring a new host epoch,
 * protagonist, owner, or save lineage by accident.
 */
export function createM2TurnCapture({
  store, characterId, identity, ownerAlias, protagonist='unknown',
  isCurrent, currentProtagonist, verifyNative, verifyAcceptedPlayer,
  verifyCompletedPlayback, sessionId=null,
}={}) {
  if (!store || typeof store.withTimelineWrite !== 'function' ||
      typeof store.get !== 'function' || typeof store.appendDialogueLine !== 'function')
    throw new TypeError('m2_shared_store_required');
  if (!isUuid(characterId) || !validIdentity(identity) ||
      typeof isCurrent !== 'function' || typeof currentProtagonist !== 'function' ||
      typeof verifyNative !== 'function' ||
      typeof verifyAcceptedPlayer !== 'function' ||
      typeof verifyCompletedPlayback !== 'function' ||
      !protagonists.has(protagonist) || (sessionId !== null && !isUuid(sessionId)))
    throw new TypeError('m2_verified_turn_required');
  const frozenIdentity = Object.freeze(Object.fromEntries(identityKeys.map(k => [k, identity[k]])));
  const timelineId = store.activeTimelineId;
  const worldProfileId = store.worldProfileId;
  const host = store.verifiedHostContext;
  const profile = store.get(characterId);
  const boundAlias = ownerAlias ?? profile?.promotion?.ownerAlias;
  if (!isUuid(timelineId) || !isUuid(worldProfileId) || !host ||
      !isUuid(host.hostRunId) || !Number.isSafeInteger(host.worldEpoch) ||
      host.worldEpoch < 0 || typeof boundAlias !== 'string' || !boundAlias ||
      profile?.promotion?.ownerAlias !== boundAlias)
    throw new Error('m2_source_unconfirmed');
  const origin = Object.freeze({hostRunId:host.hostRunId,worldEpoch:host.worldEpoch});
  const scope=Object.freeze({worldProfileId,timelineId,characterId});
  const sha256=text=>createHash('sha256').update(text,'utf8').digest('hex');
  const verifiedArgs={identity:frozenIdentity,characterId,ownerAlias:boundAlias,
    host:origin,protagonist};
  // Native proof must be synchronous and source-qualified. A caller's isCurrent
  // Boolean (even if true) has no recording authority without this proof.
  function readNativeProof(){
    let proof;
    try{proof=verifyNative();}catch{fail('m2_native_owner_unverified');}
    if(proof&&typeof proof.then==='function')fail('m2_native_owner_unverified');
    if(!fullNativeProof(proof,verifiedArgs))fail('m2_native_owner_unverified');
    return proof;
  }
  const initial=readNativeProof();
  const nativeLifetime=Object.freeze({incarnationId:initial.incarnationId,
    encounterId:initial.encounterId,observerIndex:initial.observerIndex});
  function verifyAcceptedLine(line){
    let accepted;
    try{accepted=verifyAcceptedPlayer({identity:frozenIdentity,source:line.source,
      text:line.content});}catch{fail('m2_player_source_unverified');}
    if(!accepted||typeof accepted.then==='function'||
       accepted.accepted!==true||accepted.final!==true||
       accepted.source!==line.source||accepted.text!==line.content||
       !sameIdentity(accepted.identity,frozenIdentity))
      fail('m2_player_source_unverified');
  }
  function verifyPlayedLine(line,receipt,speechProof){
    let played;
    try{played=verifyCompletedPlayback({identity:frozenIdentity,receipt,
      speechProof,text:line.content});}catch{fail('m2_playback_source_unverified');}
    if(!played||typeof played.then==='function'||played.nativeVerified!==true||
       played.historyAccepted!==true||played.speechVerified!==true||
       !sameIdentity(played.identity,frozenIdentity)||
       played.receipt!==receipt)
      fail('m2_playback_source_unverified');
  }
  let retired = false;

  function assertBoundTurn() {
    if (retired) fail('m2_turn_retired');
    if (!isCurrent()) {retired=true;fail('m2_turn_retired');}
    if (currentProtagonist() !== protagonist) {retired=true;fail('m2_protagonist_changed');}
    if (store.worldProfileId !== worldProfileId ||
        store.activeTimelineId !== timelineId ||
        store.timelineWritable !== true) {retired=true;fail('timeline_write_suspended');}
    const currentHost = store.verifiedHostContext;
    if (!currentHost || currentHost.hostRunId !== origin.hostRunId ||
        currentHost.worldEpoch !== origin.worldEpoch) {retired=true;fail('m2_host_epoch_changed');}
    if (store.get(characterId)?.promotion?.ownerAlias !== boundAlias) {
      retired=true;fail('m2_owner_retired');
    }
    let now;
    try {now=readNativeProof();} catch(error) {retired=true;throw error;}
    if(now.incarnationId!==nativeLifetime.incarnationId||
       now.encounterId!==nativeLifetime.encounterId||
       now.observerIndex!==nativeLifetime.observerIndex){
      retired=true;fail('m2_native_lifetime_changed');
    }
  }

  // The wrapper is intentionally limited to the recorder's existing interface.
  // It calls the same shared foundation writer under M1's *one* queue/transaction,
  // with an additional native-turn lifetime check at the real commit boundary.
  // The P2 writer returning a record ID is not itself a durable M5 receipt.
  // Verify the committed row through P2's serialized SQLite reader after the
  // transaction has resolved, and preserve the precise original C-01 scope.
  async function verifyDurablePlayerReceipt(receipt,{text,source}) {
    if(receipt.status!=='stored'&&receipt.status!=='duplicate')return receipt;
    try {
      assertBoundTurn();
      if(typeof store.findExactQuote!=='function')fail('m2_commit_readback_unverified');
      const rows=await store.findExactQuote({...scope,quote:text,limit:20});
      assertBoundTurn();
      const row=Array.isArray(rows)&&rows.find(r=>r.recordId===receipt.recordId);
      if(!row||row.kind!=='dialogue_line'||row.speaker!=='player'||
         row.delivery!=='accepted'||row.source!==source||row.content!==text||
         row.characterId!==characterId||row.timelineId!==timelineId||
         row.worldProfileId!==worldProfileId||
         row.attribution?.hostRunId!==origin.hostRunId||
         row.attribution?.worldEpoch!==origin.worldEpoch||
         row.attribution?.protagonist!==protagonist)
        fail('m2_commit_readback_unverified');
      // proof is a scoped durable receipt for M5, not a transferable native
      // capability. K must recheck current native turn before M5 dispatch.
      const proof=Object.freeze({kind:'original_c01_accepted_turn',
        identity:frozenIdentity,ownerAlias:boundAlias,protagonistKey:protagonist,
        hostRunId:origin.hostRunId,worldEpoch:origin.worldEpoch,
        incarnationId:nativeLifetime.incarnationId,
        encounterId:nativeLifetime.encounterId,
        observerIndex:nativeLifetime.observerIndex,
        contentSha256:sha256(text),source});
      return Object.freeze({...receipt,durable:true,scope,proof});
    }catch(error){return Object.freeze({status:'not_stored',reason:safeReason(error)});}
  }

  const boundStore = {
    worldProfileId, activeTimelineId:timelineId,
    verifiedHostContext:origin,
    get: id => id === characterId ? profile : null,
    appendDialogueLine(line, attribution,proofContext) {
      assertBoundTurn();
      if (line?.characterId !== characterId ||
          line.worldProfileId !== worldProfileId ||
          line.timelineId !== timelineId ||
          attribution?.hostRunId !== origin.hostRunId ||
          attribution?.worldEpoch !== origin.worldEpoch ||
          attribution?.protagonist !== protagonist) fail('m2_binding_mismatch');
      return store.withTimelineWrite(timelineId, foundation => {
        assertBoundTurn();
        if(line.speaker==='player')verifyAcceptedLine(line);
        else if(line.speaker==='npc')verifyPlayedLine(line,proofContext?.receipt,proofContext?.speechProof);
        else fail('m2_binding_mismatch');
        if (typeof foundation.appendDialogueLine !== 'function')
          fail('m2_journal_writer_missing');
        return foundation.appendDialogueLine(line,attribution);
      });
    },
  };
  // Recorder writes flow through this same boundStore. Per-call context cannot
  // be kept in mutable shared state because M1 may delay queued callbacks.
  const recorder = createConversationJournalRecorder(boundStore);
  const attribution = Object.freeze({
    protagonist,hostRunId:origin.hostRunId,worldEpoch:origin.worldEpoch,
    ...(sessionId === null ? {} : {sessionId}),
  });

  return Object.freeze({
    async recordPlayerAccepted({accepted=false,text,source,utteranceId=null,
      transcription=null,committedAtUtc}={}) {
      // H must call this only after accepted typed/STT intake, not interim STT
      // or speculative text. Preserve the original string, including whitespace.
      const receipt=await capture(() => {
        if (accepted !== true) fail('m2_player_not_accepted');
        assertBoundTurn();
        verifyAcceptedLine({source,content:text});
        return recorder.recordPlayerAccepted({characterId,identity:frozenIdentity,
          text,source,utteranceId,transcription:transcription===null ? null :
            {...transcription},committedAtUtc,attribution});
      });
      return verifyDurablePlayerReceipt(receipt,{text,source});
    },
    recordNpcCompleted({historyAccepted=false,text,receipt,mode='buffered',
      spokenSegments=null,speechProof=null,committedAtUtc}={}) {
      // For early streamed audio, H must pass the exact ordered text actually
      // submitted to TTS. Final Luna output is not independently playback proof.
      return capture(() => {
        if (historyAccepted !== true) fail('m2_history_not_accepted');
        if (mode !== 'buffered' && mode !== 'early_streamed')
          fail('m2_unknown_audio_mode');
        if (mode === 'early_streamed' &&
            (!Array.isArray(spokenSegments) || spokenSegments.length < 1 ||
             !spokenSegments.every(s=>typeof s==='string') ||
             spokenSegments.join('') !== text)) fail('m2_stream_text_mismatch');
        if(!validSpeechProof(speechProof,mode,text,spokenSegments,frozenIdentity))
          fail('m2_speech_proof_incomplete');
        verifyPlayedLine({content:text},receipt,speechProof);
        assertBoundTurn();
        // The recorder's direct writer must bind the proof to the queued
        // insert, not a mutable "current speech" on the capture instance.
        const verifiedStore=Object.create(boundStore);
        verifiedStore.appendDialogueLine=(line,attrs)=>boundStore.appendDialogueLine(line,attrs,{receipt,speechProof});
        return createConversationJournalRecorder(verifiedStore).recordNpcCompleted({
          characterId,identity:frozenIdentity,text,receipt,attribution,committedAtUtc});
      });
    },
    assertSourceCurrent() {assertBoundTurn();return true;},
    // H must retire on owner loss, supersession, abort, protagonist change,
    // connection replacement or native session close. Never retro-authorize.
    retire() { retired = true; },
  });
}
