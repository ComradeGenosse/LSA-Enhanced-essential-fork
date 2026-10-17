import {randomUUID} from 'node:crypto';
import {createEssentialM7Scheduler} from './lunaCurationBridge.mjs';
import {createDurableCurationAdapters} from '../../../lsa-shared-brain/src/memory/integrationPorts.mjs';
import {validateM7Consent,validateM7ProductionPricing} from '../../../lsa-shared-brain/src/memory/m7Consent.mjs';
// Memory K: production runtime activation of the EXISTING M7 Luna cloud curation.
// This module is wiring only. It constructs no memory system, database, queue,
// scheduler engine or provider client. It composes
//   createEssentialM7Scheduler (lunaCurationBridge) -> createIdleCurationScheduler
//   -> processIdleCuration / lunaCurator -> the single P2 store's durable queue,
//      budget ledger and persisted consent (already privacy/pause fenced)
// and decides only WHEN the scheduler's one bounded checkpoint may run.
//
// Safety properties (each covered by tests/memory-m7-runtime-curation.test.mjs):
//  * Default off: bootstrap constructs this only for memory.cloudCuration='on'.
//    Nothing here runs on import or construction; the first network request can
//    only follow persisted consent + supported Luna pricing + a native idle proof.
//  * Independent: it needs P2 SQLite only. No M2/M3/M4/H1/M8 capability and no
//    active M6 pass is required; it consumes whatever the durable queue holds.
//  * Consent is read back from P2 on every tick and at every awaited boundary
//    inside the scheduler; claim/reserve/complete additionally carry the approval
//    revision INTO their SQLite transaction, so a withdrawal that commits first
//    makes the stale operation fail instead of committing a late result.
//  * Interruptions (turn start, host/world change, pause, consent change, source
//    loss) call the scheduler's synchronous cancel, which aborts in-flight fetch.
//  * The native idle proof is NEVER synthesized here. If no authenticated native
//    producer is registered the state is blocked:native_idle_source_unavailable.
const SAFE_CODE=/^[a-z][a-z0-9_]{0,79}$/;
const codeOf=(error,fallback)=>SAFE_CODE.test(error?.code??'')?error.code:
  SAFE_CODE.test(error?.message??'')?error.message:fallback;

export const M7_RUNTIME_DEFAULTS=Object.freeze({
  intervalMs:60_000,        // one unref'd tick timer per runtime
  startupDelayMs:10_000,    // first tick, so recovery does not wait a full interval
  foregroundQuietMs:30_000, // no checkpoint within this long of foreground memory activity
});
const LUNA_MODEL='gpt-6-luna';

/** Maps a persisted P2 readback to the validated scheduler policy, or a reason. */
export function m7PolicyFromPersisted(record,{model}={}){
  if(!record)return {reason:'consent_not_granted'};
  if(record.mode!=='experimental'||record.cloudOptIn!==true)return {reason:'consent_withdrawn'};
  if(record.model!==model)return {reason:'consent_model_mismatch'};
  try{
    const policy=validateM7Consent({mode:'experimental',cloudOptIn:true,
      consentSource:'explicit_player_settings',
      offTurnEvidenceUploadAccepted:record.offTurnEvidenceUploadAccepted,
      consentedAtUtc:record.consentedAtUtc,dailyUsd:record.dailyUsd,monthlyUsd:record.monthlyUsd,
      maxBatchUsd:record.maxBatchUsd,consentRevision:record.consentRevision,approvalId:record.approvalId});
    return {policy};
  }catch{return {reason:'consent_invalid'};}
}

export function createM7RuntimeCuration({config,store,isPaused=()=>false,subscribePause=()=>()=>{},
  nativeIdleSource=()=>null,fetchImpl=globalThis.fetch,now=Date.now,ownerId=randomUUID(),
  setIntervalFn=setInterval,clearIntervalFn=clearInterval,
  setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout,
  createScheduler=createEssentialM7Scheduler,...overrides}={}){
  const {intervalMs,startupDelayMs,foregroundQuietMs,...schedulerOptions}={...M7_RUNTIME_DEFAULTS,...overrides};
  if(typeof store?.readM7Consent!=='function'||typeof store?.subscribeM7ConsentInvalidation!=='function'||
     typeof store?.reconcileCurationBudget!=='function'||typeof now!=='function'||typeof nativeIdleSource!=='function')
    throw new TypeError('m7_runtime_store_required');
  const startedAtUtc=new Date(now()).toISOString();
  const cloud=config?.memoryK?.cloudCuration??{};
  // The ONLY Luna transport is the existing Essential OpenAI Responses client,
  // configured by the same provider settings. No local model, no second key.
  const lunaConfig=Object.freeze({provider:config?.provider,reasoningModel:config?.reasoningModel,
    reasoningBaseUrl:config?.reasoningBaseUrl,reasoningKey:config?.reasoningKey,
    curatorPricing:cloud.pricing,
    ...(cloud.maxOutputTokens!==undefined?{curatorMaxOutputTokens:cloud.maxOutputTokens}:{})});

  let closed=false,started=false,timer=null,startTimer=null,running=null,checkpointing=false;
  let current=null;             // {policy,scheduler,key}
  let lastForegroundMs=-Infinity,recoveredKey=null;
  let status={state:'starting',reason:'startup_check_pending'};
  let consentView={state:'unknown',revision:null};
  let queueView=null;
  const stats={ticks:0,checkpoints:0,curated:0,lastCheckpoint:null,lastErrorCode:null,consecutiveFailures:0};
  const invalidationListeners=new Set();
  const unsubscribers=[];

  const set=(state,reason=null)=>{status={state,reason};};
  const foregroundBusy=()=>now()-lastForegroundMs<foregroundQuietMs;
  const sourceAvailable=()=>{
    try{return typeof nativeIdleSource()?.snapshot==='function';}catch{return false;}
  };

  // The scheduler's native seam. The source object is OPTIONAL and must come
  // from an authenticated native producer; absent => snapshot null => no cloud.
  const idlePort=Object.freeze({
    snapshot:()=>{const source=nativeIdleSource();return source?.snapshot?.()??null;},
    verifyAuthenticatedSource:proof=>nativeIdleSource()?.verifyAuthenticatedSource?.(proof)===true,
    subscribeInvalidation:listener=>{
      if(typeof listener!=='function')throw new TypeError('m7_invalidation_listener_required');
      invalidationListeners.add(listener);
      let native=null;
      try{native=nativeIdleSource()?.subscribeInvalidation?.(listener)??null;}catch{}
      return ()=>{invalidationListeners.delete(listener);try{native?.();}catch{}};
    }});

  /** Synchronous interruption: any activity, source or authority change. */
  function invalidate(){
    try{current?.scheduler.cancel();}catch{}
    for(const listener of [...invalidationListeners])try{listener();}catch{}
  }
  function noteForeground(){lastForegroundMs=now();invalidate();}

  function lunaSupport(){
    if(config?.provider!=='openai')return 'curation_requires_existing_openai_provider';
    if(config.reasoningModel!==LUNA_MODEL)return 'curation_requires_luna_model';
    if(!String(config.reasoningKey??'').trim())return 'luna_credential_missing';
    if(!cloud.pricing)return 'luna_pricing_missing';
    try{validateM7ProductionPricing(lunaConfig,{nowUtc:new Date(now()).toISOString()});}
    catch(error){return codeOf(error,'luna_pricing_unsupported');}
    return null;
  }

  async function dropScheduler(){
    const old=current;current=null;
    if(old){try{await old.scheduler.stop();}catch{}}
  }
  function buildScheduler(policy){
    const {queue:base,ledger:baseLedger}=createDurableCurationAdapters(store,
      {dailyUsd:policy.dailyUsd,monthlyUsd:policy.monthlyUsd});
    // The approval revision rides into each SQLite transaction (atomic fence).
    const expectedConsent=Object.freeze({approvalId:policy.approvalId,consentRevision:policy.consentRevision});
    const queue=Object.freeze({...base,
      claimDue:args=>base.claimDue({...args,expectedConsent}),
      // Lease expiry is judged by the same injected clock that issued the lease.
      completeLeased:args=>base.completeLeased({nowUtc:new Date(now()).toISOString(),...args,expectedConsent})});
    const ledger=Object.freeze({...baseLedger,
      budgetLimits:Object.freeze({dailyUsd:policy.dailyUsd,monthlyUsd:policy.monthlyUsd}),
      reserve:args=>baseLedger.reserve({...args,expectedConsent}),
      reconcile:args=>store.reconcileCurationBudget(args)});
    const scheduler=createScheduler({config:lunaConfig,store,queue,ledger,consent:policy,
      nativeIdle:idlePort,fetchImpl,ownerId,now,
      onError:code=>{stats.lastErrorCode=SAFE_CODE.test(code)?code:'m7_scheduler_failure';},
      ...schedulerOptions});
    return {policy,scheduler,key:policy.approvalId+':'+policy.consentRevision};
  }

  /** Re-reads persisted consent; (re)builds or drops the scheduler to match. */
  async function reconcileAuthority(){
    if(closed){await dropScheduler();set('stopped','runtime_stopped');return false;}
    if(isPaused()){await dropScheduler();set('paused','learned_memory_paused');return false;}
    const unsupported=lunaSupport();
    if(unsupported){await dropScheduler();consentView={state:'unknown',revision:null};set('blocked',unsupported);return false;}
    const worldProfileId=store.worldProfileId,timelineId=store.activeTimelineId;
    if(typeof worldProfileId!=='string'||typeof timelineId!=='string'||!timelineId){
      await dropScheduler();set('blocked','timeline_confirmation_required');return false;
    }
    let record;
    try{record=await store.readM7Consent({worldProfileId,timelineId});}
    catch(error){await dropScheduler();set('blocked',codeOf(error,'m7_consent_unreadable'));return false;}
    const {policy,reason}=m7PolicyFromPersisted(record,{model:lunaConfig.reasoningModel});
    if(!policy){
      await dropScheduler();
      consentView={state:reason==='consent_withdrawn'?'withdrawn':reason==='consent_not_granted'?'not_granted':'invalid',
        revision:record?.consentRevision??null};
      set('awaiting_consent',reason);return false;
    }
    consentView={state:'granted',revision:policy.consentRevision};
    if(!current||current.key!==policy.approvalId+':'+policy.consentRevision){
      await dropScheduler();
      try{current=buildScheduler(policy);}
      catch(error){set('blocked',codeOf(error,'m7_scheduler_unavailable'));return false;}
    }
    return true;
  }

  /** Crash/restart recovery: unresolved reservations from an earlier process stay
   * charged at their ceiling. Local bookkeeping only, never a network request. */
  async function recoverOnce(){
    const key=store.worldProfileId+':'+store.activeTimelineId;
    if(recoveredKey===key||store.timelineWritable!==true)return;
    try{
      await store.reconcileCurationBudget({beforeUtc:startedAtUtc,worldProfileId:store.worldProfileId});
      recoveredKey=key;
    }catch(error){stats.lastErrorCode=codeOf(error,'m7_recovery_failed');}
  }
  async function refreshQueueView(){
    try{
      const view=await store.readCurationStatus({nowUtc:new Date(now()).toISOString()});
      queueView=view;
    }catch{/* diagnostics are best effort */}
  }

  const serialized=work=>{
    const next=(running??Promise.resolve()).catch(()=>{}).then(work);
    running=next;
    void next.finally(()=>{if(running===next)running=null;}).catch(()=>{});
    return next;
  };

  function tick(){
    return serialized(async()=>{
      if(closed)return {skipped:'stopped'};
      stats.ticks++;
      if(!await reconcileAuthority()){await refreshQueueView();return {skipped:status.reason};}
      await recoverOnce();
      if(store.timelineWritable!==true){set('blocked','timeline_confirmation_required');return {skipped:status.reason};}
      if(!sourceAvailable()){set('blocked','native_idle_source_unavailable');await refreshQueueView();return {skipped:status.reason};}
      if(foregroundBusy()){set('idle','foreground_active');return {skipped:status.reason};}
      const active=current;
      checkpointing=true;set('processing',null);
      let outcome;
      try{outcome=await active.scheduler.checkpoint();}
      catch(error){outcome={status:'failed_closed',processed:0};stats.lastErrorCode=codeOf(error,'m7_checkpoint_failed');}
      finally{
        checkpointing=false;
        // Rotate only when checkpoint has finished, never mid-request.
        try{nativeIdleSource()?.advanceSelection?.();}catch{}
      }
      stats.checkpoints++;stats.lastCheckpoint=outcome.status;
      if(outcome.status==='failed_closed')stats.consecutiveFailures++;else stats.consecutiveFailures=0;
      stats.curated+=Number.isSafeInteger(outcome.processed)?outcome.processed:0;
      applyOutcome(outcome);
      await refreshQueueView();
      return {status:outcome.status,processed:outcome.processed??0};
    });
  }
  function applyOutcome({status:result}){
    if(closed){set('stopped','runtime_stopped');return;}
    if(isPaused()){set('paused','learned_memory_paused');return;}
    switch(result){
      // A rejected/expired native proof or revoked authority is NOT an
      // operational idle worker. Keep effectiveMode unknown until reverified.
      case 'source_unverified':return set('blocked','awaiting_verified_native_idle');
      case 'consent_or_source_unverified':return set('blocked','authority_revalidating');
      case 'cancelled':return set('blocked','interrupted_by_activity');
      case 'empty':return set('idle','queue_empty');
      case 'busy':case 'throttled':return set('idle',result);
      case 'completed':case 'partially_completed':return set('idle','batch_completed');
      case 'retry_scheduled':return set('idle','cloud_unavailable_retry_scheduled');
      case 'failed_closed':return set('idle',stats.lastErrorCode??'m7_checkpoint_failed');
      case 'budget_blocked':return set('blocked','budget_exhausted');
      case 'budget_estimate_exceeded':return set('blocked','batch_budget_too_small');
      case 'cost_overrun':case 'settlement_pending':case 'cost_suspended':return set('blocked','cost_suspended');
      case 'disabled':case 'shadow':return set('awaiting_consent','consent_not_granted');
      default:return set('blocked',SAFE_CODE.test(result)?result:'m7_unavailable');
    }
  }

  function start(){
    if(closed||started)return;
    started=true;
    // Consent changes (grant/withdraw/revise) abort in-flight work immediately.
    try{
      unsubscribers.push(store.subscribeM7ConsentInvalidation(()=>{invalidate();}));
    }catch{}
    try{unsubscribers.push(subscribePause(()=>{invalidate();}));}catch{}
    timer=setIntervalFn(()=>{void tick().catch(()=>{});},intervalMs);
    timer?.unref?.();
    startTimer=setTimeoutFn(()=>{startTimer=null;void tick().catch(()=>{});},startupDelayMs);
    startTimer?.unref?.();
  }
  async function dispose(){
    closed=true;
    if(timer){clearIntervalFn(timer);timer=null;}
    if(startTimer){clearTimeoutFn(startTimer);startTimer=null;}
    for(const off of unsubscribers.splice(0))try{off?.();}catch{}
    invalidate();
    try{await running;}catch{}
    await dropScheduler();
    set('stopped','runtime_stopped');
  }
  function diagnostics(){
    const state=closed?'stopped':isPaused()?'paused':status.state;
    const reason=closed?'runtime_stopped':isPaused()?'learned_memory_paused':status.reason;
    const policy=current?.policy??null;
    return Object.freeze({
      state,reason,running:started&&!closed,processing:checkpointing,
      consent:Object.freeze({...consentView}),
      budget:policy?Object.freeze({dailyUsd:policy.dailyUsd,monthlyUsd:policy.monthlyUsd,
        maxBatchUsd:policy.maxBatchUsd,
        spentTodayUsd:queueView?.spend.dayUsd??null,spentMonthUsd:queueView?.spend.monthUsd??null,
        unresolvedReservations:queueView?.spend.unresolvedReservations??null}):null,
      queue:queueView?Object.freeze({pending:queueView.jobs.pending,leased:queueView.jobs.leased,
        completed:queueView.jobs.completed,deadLetter:queueView.jobs.dead_letter,dueNow:queueView.dueNow,
        curatedAppraisals:queueView.appraisals}):null,
      nativeIdle:sourceAvailable()?'source_registered':'source_unavailable',
      // Content-free reason code from the idle source (e.g. backend_activity).
      idleProof:(()=>{try{const r=nativeIdleSource()?.diagnostics?.()?.reason;return SAFE_CODE.test(r??'')?r:null;}catch{return null;}})(),
      curatedThisRun:stats.curated,checkpoints:stats.checkpoints,lastCheckpoint:stats.lastCheckpoint,
      lastErrorCode:stats.lastErrorCode,consecutiveFailures:stats.consecutiveFailures,
      recovered:recoveredKey!==null});
  }
  return Object.freeze({tick,start,dispose,noteForeground,invalidate,diagnostics});
}
