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

  let streak=null,generation=0,reason='native_diagnostic_missing',disposed=false,watchdog=null;
  const listeners=new Set();
  const minted=new WeakMap();
  const unsubscribers=[];

  function notify(){for(const listener of [...listeners])try{listener();}catch{}}
  /** Any loss of continuity: forget the streak and abort in-flight cloud work NOW. */
  function invalidate(code){
    generation++;streak=null;
    reason=SAFE_CODE.test(code)?code:'idle_invalidated';
    notify();
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
    if(!identityFor(p))return invalidate('native_identity_unverified');
    // A frame that is not entirely quiet is a busy edge: drop and abort at once.
    if(!M7_NATIVE_CORE_QUIET_FIELDS.every(k=>p.priorityEvidence?.[k]===true))
      return invalidate('native_not_quiet');
    const backendView=readBackend();
    if(backendView.reason)return invalidate(backendView.reason);
    const t=mono();
    if(streak&&(!sameStream(streak,f,p)||f.sequence<=streak.sequence||
       backendView.sourceRun!==streak.sourceRun||backendView.revision!==streak.revision||
       p.sampledGameTick<=streak.lastTick||t<streak.lastNativeAt||
       t-streak.lastNativeAt>maxNativeAgeMs)){
      invalidate('continuity_lost'); // aborts work bound to the old streak; restart below
    }
    if(!streak){
      streak={streamId:f.streamId,adapterEpoch:f.adapterEpoch,hostRunId:p.hostRunId,
        worldEpoch:p.worldEpoch,observerCaptureRef:p.observerCaptureRef,
        incarnationId:p.incarnationId,encounterId:p.encounterId,sourceRun:backendView.sourceRun,
        revision:backendView.revision,startedAt:t,firstTick:p.sampledGameTick};
      reason='idle_window_not_elapsed';
    }
    streak.sequence=f.sequence;streak.lastTick=p.sampledGameTick;
    streak.lastNativeAt=t;streak.lastWallMs=wallNow();streak.evidence=p.priorityEvidence;
  }

  /** Synchronous. Null unless every gate below holds right now. */
  function snapshot(){
    if(disposed||!streak)return null;
    const s=streak,t=mono();
    if(!Number.isFinite(t)||t<s.lastNativeAt||t-s.lastNativeAt>maxNativeAgeMs){
      invalidate('native_sample_stale');return null;
    }
    const idleForMs=s.lastNativeAt-s.startedAt;
    if(idleForMs<minIdleMs){reason='idle_window_not_elapsed';return null;}
    // The game clock must have advanced with real time over the observed span.
    if(s.lastTick-s.firstTick<idleForMs*minGameTimeRatio){invalidate('game_clock_stalled');return null;}
    const backendView=readBackend();
    if(backendView.reason){invalidate(backendView.reason);return null;}
    if(backendView.sourceRun!==s.sourceRun||backendView.revision!==s.revision){
      invalidate('backend_activity');return null;
    }
    const payloadLike={hostRunId:s.hostRunId,worldEpoch:s.worldEpoch,
      observerCaptureRef:s.observerCaptureRef,incarnationId:s.incarnationId,encounterId:s.encounterId};
    const who=identityFor(payloadLike);
    if(!who||who.host.hostRunId!==s.hostRunId||runtime.stream!==s.streamId||
       runtime.epoch!==s.adapterEpoch){invalidate('native_identity_unverified');return null;}
    if(typeof store.worldProfileId!=='string'||typeof store.activeTimelineId!=='string'||
       !store.activeTimelineId)return null;
    const priorityEvidence=Object.freeze(Object.fromEntries(M7_PRIORITY_QUIET_FIELDS.map(k=>[k,
      M7_NATIVE_CORE_QUIET_FIELDS.includes(k)?s.evidence[k]===true:backendView.fields[k]===true])));
    const proof=Object.freeze({kind:M7_IDLE_PROOF_KIND,nativeVerified:true,
      hostRunId:s.hostRunId,worldEpoch:s.worldEpoch,sessionId:s.streamId,
      incarnationId:s.incarnationId,encounterId:s.encounterId,
      observerIndex:runtime.observerIndexVersion??0,characterId:who.characterId,
      worldProfileId:store.worldProfileId,timelineId:store.activeTimelineId,
      priorityEvidence,idle:true,micActive:false,playerSpeechActive:false,
      directorBusy:false,gamePaused:false,idleForMs,
      observedAtUtc:new Date(s.lastWallMs).toISOString()});
    minted.set(proof,generation);
    reason=null;
    return proof;
  }
  /** True only for a proof minted by THIS module in the current, unbroken streak. */
  function verifyAuthenticatedSource(proof){
    if(disposed||!streak||!proof||typeof proof!=='object'||minted.get(proof)!==generation)return false;
    const t=mono();
    return Number.isFinite(t)&&t>=streak.lastNativeAt&&t-streak.lastNativeAt<=maxNativeAgeMs;
  }
  function stopWatchdog(){if(watchdog!==null){clearIntervalFn(watchdog);watchdog=null;}}
  /** While cloud work is in flight (subscribed), lost native frames abort it. */
  function subscribeInvalidation(listener){
    if(typeof listener!=='function')throw new TypeError('m7_invalidation_listener_required');
    listeners.add(listener);
    if(watchdog===null){
      watchdog=setIntervalFn(()=>{
        if(streak&&mono()-streak.lastNativeAt>maxNativeAgeMs)invalidate('native_sample_stale');
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
    return Object.freeze({state:disposed?'stopped':streak?'tracking':'waiting',
      reason:disposed?'source_stopped':reason,
      observedIdleMs:streak?streak.lastNativeAt-streak.startedAt:0});
  }
  function dispose(){
    if(disposed)return;
    invalidate('source_stopped');disposed=true;
    stopWatchdog();listeners.clear();
    for(const off of unsubscribers.splice(0))try{off?.();}catch{}
  }
  return Object.freeze({snapshot,verifyAuthenticatedSource,subscribeInvalidation,diagnostics,dispose});
}
