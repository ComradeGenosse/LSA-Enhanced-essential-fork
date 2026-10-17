import {M7_NATIVE_CORE_QUIET_FIELDS} from '../perception/contracts.mjs';
import {M7_IDLE_PROOF_KIND,M7_PRIORITY_QUIET_FIELDS} from '../../../lsa-shared-brain/src/memory/m7Consent.mjs';
// W07: the ONLY producer of verified_native_idle_v1.
//
// A proof exists only while two independent sources agree, continuously:
//  * NATIVE: the authenticated C-13 `memory_m7_idle_diagnostic` stream (21 C-06
//    negatives for one exact owned NPC + the local player), sampled by the native
//    owner fiber and admitted by the existing post-authentication intake;
//  * BACKEND: the original Essential turn stores/lifecycle timeline (mic, typed/STT
//    turn, session opens, output owners, recoveries), whose revision advances at every
//    stock turn entrypoint. The four "global turn" fields are derived ONLY from it.
// Neither silence, a timer, a PS3 ticket/receipt, a Director grant nor any caller
// flag contributes. Every disagreement, gap, identity change or backend activity
// drops the streak and synchronously notifies invalidation subscribers.
//
// This module mints, never accepts, proofs: verifyAuthenticatedSource() is true only
// for a still-current object this module created (identity in a private WeakMap).
const SAFE_CODE=/^[a-z][a-z0-9_]{0,79}$/;
const COUNTERS=Object.freeze(['liveTurns','activeTurnMappings','pendingSessionOpens',
  'pendingOutputOwners','retiringOutputOwners','activeOutputOwners','pendingPlayerContext',
  'pendingConversationContext','playerTurnRecoveries','micBufferedChunks']);
const IN_FLIGHT=Object.freeze(['liveTurns','activeTurnMappings','pendingSessionOpens',
  'pendingOutputOwners','retiringOutputOwners','activeOutputOwners']);
const PLAYER_TURN=Object.freeze(['pendingPlayerContext','pendingConversationContext',
  'playerTurnRecoveries','micBufferedChunks']);
export const M7_IDLE_SOURCE_DEFAULTS=Object.freeze({
  minIdleMs:1600,        // observed quiet span; scheduler also demands >= 1500
  maxNativeAgeMs:2500,   // < the 3000 ms proof freshness bound
  minGameTimeRatio:0.5,  // game clock must advance with real time or we call it paused
  watchdogMs:500,
});

export function createM7IdleProofSource({intelligence,backend,resolveOwner,store,
  directorBusy=()=>false,monotonicNow=null,wallNow=Date.now,
  setIntervalFn=setInterval,clearIntervalFn=clearInterval,...overrides}={}){
  const {minIdleMs,maxNativeAgeMs,minGameTimeRatio,watchdogMs}={...M7_IDLE_SOURCE_DEFAULTS,...overrides};
  const runtime=intelligence?.runtime;
  if(typeof intelligence?.subscribeAuthenticatedNativeM7Diagnostic!=='function'||
     typeof intelligence.subscribeWorldBoundary!=='function'||!runtime||
     typeof backend?.sample!=='function'||typeof backend.observe!=='function'||
     typeof resolveOwner!=='function'||typeof directorBusy!=='function'||
     typeof store?.get!=='function'||typeof wallNow!=='function')
    throw new TypeError('m7_idle_source_ports_required');
  const mono=monotonicNow??(()=>runtime.now());

  let streaks=new Map(),selectedRef=null,lastSelectedRef=null,generation=0,
    reason='native_diagnostic_missing',disposed=false,watchdog=null;
  const listeners=new Set();
  const minted=new WeakMap();
  const unsubscribers=[];

  function notify(){for(const listener of [...listeners])try{listener();}catch{}}
  /** Any loss of continuity: forget the streak and abort in-flight cloud work NOW. */
  function invalidate(code){
    generation++;streaks.clear();selectedRef=null;
    reason=SAFE_CODE.test(code)?code:'idle_invalidated';
    notify();
  }
  // An unrelated owner's bad sample must not abort a valid selected owner's
  // cloud operation. A selected-owner interruption still cancels immediately.
  function dropCandidate(ref,code){
    if(ref===selectedRef)return invalidate(code);
    streaks.delete(ref);
    if(selectedRef===null)reason=SAFE_CODE.test(code)?code:'idle_invalidated';
  }

  // Original backend: quiet AND source-current, from a fresh synchronous read.
  function readBackend(){
    let sample;
    try{sample=backend.sample();}catch{sample=null;}
    const e=sample?.evidence;
    if(!sample||sample.source!=='original_essential_backend_lifecycle'||
       sample.grantsNativeAdmission!==false||typeof sample.sourceRun!=='string'||
       !sample.sourceRun||!Number.isSafeInteger(sample.revision)||sample.revision<1||
       !e||e.source!=='original_essential_server_turn_stores'||
       !COUNTERS.every(k=>Number.isSafeInteger(e[k])&&e[k]>=0))
      return {reason:'backend_sample_unavailable'};
    if(backend.leaseActive?.()===true)return {reason:'director_reservation_active'};
    try{if(directorBusy()!==false)return {reason:'director_busy'};}
    catch{return {reason:'director_state_unknown'};}
    const playerTurnIdle=e.micStatus==='idle'&&e.micActiveTurn===false&&
      e.micReleasedBeforeContextReady===false&&PLAYER_TURN.every(k=>e[k]===0);
    const essentialTurnIdle=IN_FLIGHT.every(k=>e[k]===0);
    if(!playerTurnIdle)return {reason:'backend_player_turn_active'};
    if(!essentialTurnIdle)return {reason:'backend_essential_turn_active'};
    if(sample.quiet!==true)return {reason:'backend_not_quiet'};
    return {sourceRun:sample.sourceRun,revision:sample.revision,
      fields:Object.freeze({playerTurnSourceCurrent:true,playerTurnIdle:true,
        essentialTurnKnown:true,essentialTurnIdle:true})};
  }

  // Re-derive the exact native observer from the authenticated runtime.
  function identityFor(p){
    const host=runtime.hostContext;
    if(!host||p.hostRunId!==host.hostRunId||p.worldEpoch!==host.worldEpoch)return null;
    const verified=store.verifiedHostContext;
    if(!verified||verified.hostRunId!==host.hostRunId||verified.worldEpoch!==host.worldEpoch)return null;
    const row=runtime.observerIndex.get(p.observerCaptureRef);
    if(!runtime.current(p.observerCaptureRef)||row?.kind!=='ped'||row.owned!==true||
       row.incarnationId!==p.incarnationId||row.encounterId!==p.encounterId)return null;
    let owner;
    try{owner=resolveOwner({hostRunId:host.hostRunId,worldEpoch:host.worldEpoch,
      adapterEpoch:runtime.epoch,observerCaptureRef:p.observerCaptureRef,observerIndex:row});}
    catch{owner=null;}
    if(!owner||owner.nativeVerified!==true||owner.current!==true||typeof owner.characterId!=='string'||
       owner.ownerProof?.incarnationId!==p.incarnationId||
       owner.ownerProof?.encounterId!==p.encounterId||
       owner.ownerProof?.observerCaptureRef!==p.observerCaptureRef)return null;
    return {host,characterId:owner.characterId};
  }

  const sameStream=(s,f,p)=>s.streamId===f.streamId&&s.adapterEpoch===f.adapterEpoch&&
    s.hostRunId===p.hostRunId&&s.worldEpoch===p.worldEpoch&&
    s.observerCaptureRef===p.observerCaptureRef&&s.incarnationId===p.incarnationId&&
    s.encounterId===p.encounterId;

  function onNativeDiagnostic(receipt){
    if(disposed)return;
    const f=receipt?.frame,p=f?.payload;
    if(f?.type!=='memory_m7_idle_diagnostic'||!p||f.streamId!==runtime.stream||
       f.adapterEpoch!==runtime.epoch)return invalidate('native_frame_not_current');
    const ref=p.observerCaptureRef;
    const owner=identityFor(p);
    if(!owner)return dropCandidate(ref,'native_identity_unverified');
    if(!M7_NATIVE_CORE_QUIET_FIELDS.every(k=>p.priorityEvidence?.[k]===true))
      return dropCandidate(ref,'native_not_quiet');
    const backendView=readBackend();
    if(backendView.reason)return invalidate(backendView.reason);
    const t=mono();
    let s=streaks.get(ref);
    if(s&&(!sameStream(s,f,p)||s.characterId!==owner.characterId||f.sequence<=s.sequence||
       backendView.sourceRun!==s.sourceRun||backendView.revision!==s.revision||
       p.sampledGameTick<=s.lastTick||t<s.lastNativeAt||
       t-s.lastNativeAt>maxNativeAgeMs)){
      dropCandidate(ref,'continuity_lost');
      s=null;
    }
    if(!s){
      s={streamId:f.streamId,adapterEpoch:f.adapterEpoch,hostRunId:p.hostRunId,
        worldEpoch:p.worldEpoch,observerCaptureRef:ref,
        incarnationId:p.incarnationId,encounterId:p.encounterId,characterId:owner.characterId,
        sourceRun:backendView.sourceRun,
        revision:backendView.revision,startedAt:t,firstTick:p.sampledGameTick,samples:0};
      streaks.set(ref,s);
      reason='idle_window_not_elapsed';
    }
    s.samples++;
    s.sequence=f.sequence;s.lastTick=p.sampledGameTick;
    s.lastNativeAt=t;s.lastWallMs=wallNow();s.evidence=p.priorityEvidence;
  }

  function candidateReady(s,t,backendView){
    if(!s||!Number.isFinite(t)||t<s.lastNativeAt||
       t-s.lastNativeAt>maxNativeAgeMs)return 'native_sample_stale';
    if(s.samples<3||s.lastNativeAt-s.startedAt<minIdleMs)return 'idle_window_not_elapsed';
    if(s.lastTick-s.firstTick<(s.lastNativeAt-s.startedAt)*minGameTimeRatio)
      return 'game_clock_stalled';
    if(backendView.sourceRun!==s.sourceRun||backendView.revision!==s.revision)
      return 'backend_activity';
    const who=identityFor(s);
    if(!who||who.characterId!==s.characterId||who.host.hostRunId!==s.hostRunId||runtime.stream!==s.streamId||
       runtime.epoch!==s.adapterEpoch)return 'native_identity_unverified';
    return null;
  }

  /** Synchronous. Select one eligible NPC and hold that choice throughout a
   * checkpoint. All NPCs maintain independent native streaks, so sampling another
   * owner cannot inadvertently revoke the selected owner's proof. */
  function snapshot(){
    if(disposed||streaks.size===0)return null;
    const t=mono(),backendView=readBackend();
    if(backendView.reason){invalidate(backendView.reason);return null;}
    if(typeof store.worldProfileId!=='string'||typeof store.activeTimelineId!=='string'||
       !store.activeTimelineId)return null;
    if(selectedRef===null){
      const refs=[...streaks.keys()].sort();
      const previous=refs.indexOf(lastSelectedRef),offset=previous<0?-1:previous;
      for(let i=1;i<=refs.length;i++){
        const ref=refs[(offset+i)%refs.length],s=streaks.get(ref);
        const problem=candidateReady(s,t,backendView);
        if(problem){
          if(problem!=='idle_window_not_elapsed')dropCandidate(ref,problem);
          else reason=problem;
          continue;
        }
        selectedRef=ref;lastSelectedRef=ref;break;
      }
    }
    if(selectedRef===null)return null;
    const s=streaks.get(selectedRef),problem=candidateReady(s,t,backendView);
    if(problem){invalidate(problem);return null;}
    const idleForMs=s.lastNativeAt-s.startedAt;
    const priorityEvidence=Object.freeze(Object.fromEntries(M7_PRIORITY_QUIET_FIELDS.map(k=>[k,
      M7_NATIVE_CORE_QUIET_FIELDS.includes(k)?s.evidence[k]===true:backendView.fields[k]===true])));
    const proof=Object.freeze({kind:M7_IDLE_PROOF_KIND,nativeVerified:true,
      hostRunId:s.hostRunId,worldEpoch:s.worldEpoch,sessionId:s.streamId,
      incarnationId:s.incarnationId,encounterId:s.encounterId,
      observerIndex:runtime.observerIndexVersion??0,characterId:s.characterId,
      worldProfileId:store.worldProfileId,timelineId:store.activeTimelineId,
      priorityEvidence,idle:true,micActive:false,playerSpeechActive:false,
      directorBusy:false,gamePaused:false,idleForMs,
      observedAtUtc:new Date(s.lastWallMs).toISOString()});
    minted.set(proof,generation);
    reason=null;
    return proof;
  }
  /** True only for a proof minted in the selected, still-current streak. */
  function verifyAuthenticatedSource(proof){
    const s=selectedRef===null?null:streaks.get(selectedRef);
    if(disposed||!s||!proof||typeof proof!=='object'||minted.get(proof)!==generation)return false;
    const t=mono();
    return Number.isFinite(t)&&t>=s.lastNativeAt&&t-s.lastNativeAt<=maxNativeAgeMs;
  }
  /** Called only after the current scheduler checkpoint has settled. Fairly
   * rotate the next checkpoint to another continuously sampled NPC. */
  function advanceSelection(){
    if(disposed)return;
    selectedRef=null;
    generation++; // retire the previous checkpoint's proofs
  }
  function stopWatchdog(){if(watchdog!==null){clearIntervalFn(watchdog);watchdog=null;}}
  /** While cloud work is in flight (subscribed), lost native frames abort it. */
  function subscribeInvalidation(listener){
    if(typeof listener!=='function')throw new TypeError('m7_invalidation_listener_required');
    listeners.add(listener);
    if(watchdog===null){
      watchdog=setIntervalFn(()=>{
        const s=selectedRef===null?null:streaks.get(selectedRef);
        if(s&&mono()-s.lastNativeAt>maxNativeAgeMs)invalidate('native_sample_stale');
      },watchdogMs);
      watchdog?.unref?.();
    }
    return ()=>{listeners.delete(listener);if(listeners.size===0)stopWatchdog();};
  }

  unsubscribers.push(intelligence.subscribeAuthenticatedNativeM7Diagnostic(onNativeDiagnostic,
    ()=>invalidate('native_source_retired')));
  unsubscribers.push(intelligence.subscribeWorldBoundary(()=>invalidate('world_boundary')));
  // Every stock turn entrypoint (mic, typed/STT intake, session open/retire, output
  // owner changes) is a synchronous busy edge, between the 1 Hz native samples.
  unsubscribers.push(backend.observe(()=>invalidate('backend_activity')));

  function diagnostics(){
    const s=selectedRef===null?null:streaks.get(selectedRef);
    return Object.freeze({state:disposed?'stopped':streaks.size?'tracking':'waiting',
      reason:disposed?'source_stopped':reason,
      observedIdleMs:s?s.lastNativeAt-s.startedAt:0});
  }
  function dispose(){
    if(disposed)return;
    invalidate('source_stopped');disposed=true;
    stopWatchdog();listeners.clear();
    for(const off of unsubscribers.splice(0))try{off?.();}catch{}
  }
  return Object.freeze({snapshot,verifyAuthenticatedSource,advanceSelection,subscribeInvalidation,diagnostics,dispose});
}
