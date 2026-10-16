// Memory K J-B: production runtime activation of the EXISTING M6 deterministic
// retention. This module is wiring only: it constructs no memory system,
// database, queue, scheduler engine or provider client. It composes
//   createM6SelectionCoordinator -> createM6P2ReplayAdapter -> the single P2
//   store (already privacy/pause fenced by the caller)
// and decides only WHEN the coordinator's three existing hooks fire:
//   recover      first writable timeline of a run (startup / reload recovery)
//   onSceneClose a promoted NPC's native session ended (conversation over)
//   onIdle       a long quiet period with no foreground memory activity
//
// Safety properties (each covered by tests/memory-m6-runtime-retention.test.mjs):
//  * Default off: bootstrap constructs this only for memory.deterministic='on'.
//  * M7/Luna is never reachable: cloudQueueEnabled is false and the store
//    handed to the coordinator throws if enqueueCurationJob is ever called.
//  * Foreground first: no work starts while a turn happened within the grace
//    window, every scope yields to the event loop, scans are page-bounded, and
//    hooks never run on the caller's turn/detach path (deferred, errors swallowed).
//  * Privacy: coordinator suppression checks, P2 cursor CAS and the pause fence
//    on the supplied store are unchanged; pause/close stop all work.
//  * Retention is idempotent: replay after a crash yields identical proposals.
import {createM6SelectionCoordinator} from '../../../lsa-shared-brain/src/memory/m6Coordinator.mjs';
import {createM6P2ReplayAdapter} from '../../../lsa-shared-brain/src/memory/m6P2ReplayAdapter.mjs';

export const M6_RUNTIME_DEFAULTS=Object.freeze({
  quietMs:90_000,        // M6 coordinator quiet window for idle/recovery cutoffs
  idleGraceMs:90_000,    // no tick work within this long of foreground activity
  intervalMs:60_000,     // idle tick cadence (one unref'd timer per runtime)
  startupDelayMs:5_000,  // first tick, so startup recovery does not wait a full interval
  pageSize:100,maxRows:400,maxPages:4, // small bounded scans; backlog resumes next tick
  maxConsecutiveFailures:5,
});
const SAFE_CODE=/^[a-z][a-z0-9_]{0,79}$/;
const codeOf=error=>SAFE_CODE.test(error?.message??'')?error.message:'m6_runtime_failure';
const yieldToLoop=()=>new Promise(resolve=>setImmediate(resolve));

export function createM6RuntimeRetention({store,now=Date.now,
  isPaused=()=>false,setIntervalFn=setInterval,clearIntervalFn=clearInterval,
  setTimeoutFn=setTimeout,clearTimeoutFn=clearTimeout,...overrides}={}){
  const opts={...M6_RUNTIME_DEFAULTS,...overrides};
  if(typeof store?.list!=='function'||typeof now!=='function')
    throw new TypeError('m6_runtime_store_required');
  const adapter=createM6P2ReplayAdapter(store);
  const coordinator=createM6SelectionCoordinator({
    store:Object.freeze({
      // Live getters: the coordinator re-checks the timeline before every write.
      get worldProfileId(){return store.worldProfileId;},
      get activeTimelineId(){return store.activeTimelineId;},
      get timelineWritable(){return store.timelineWritable;},
      get:(...args)=>adapter.get(...args),
      readM6Checkpoint:args=>adapter.readM6Checkpoint(args),
      readM6JournalPage:args=>adapter.readM6JournalPage(args),
      ackM6Checkpoint:args=>adapter.ackM6Checkpoint(args),
      saveDeterministicMemory:args=>adapter.saveDeterministicMemory(args),
      listSuppressedMemoryIds:args=>adapter.listSuppressedMemoryIds(args),
      readCorrectionOverlays:args=>adapter.readCorrectionOverlays(args),
      readVerifiedEventEvidence:args=>adapter.readVerifiedEventEvidence(args),
      // M7/Luna cloud curation is independent and stays unreachable from here.
      enqueueCurationJob:()=>{throw new Error('m6_runtime_cloud_queue_forbidden');},
    }),
    now:()=>new Date(now()).toISOString(),
    cloudQueueEnabled:false,quietMs:opts.quietMs,
    pageSize:opts.pageSize,maxRows:opts.maxRows,maxPages:opts.maxPages,
  });

  const dirty=new Set();            // characterIds with committed evidence not yet fully processed
  const sessions=new Map();         // `${pedId}:${sessionNonce}` -> Set<characterId>
  let lastForegroundMs=-Infinity,recoveredKey=null,wasWritable=false;
  let closed=false,timer=null,startTimer=null,running=null,failures=0;
  const stats={runs:0,saved:0,rejected:0,lastPhase:null,lastStatus:'idle',lastReason:null};

  const foregroundBusy=()=>now()-lastForegroundMs<opts.idleGraceMs;
  const scopeFor=characterId=>{
    const worldProfileId=store.worldProfileId,timelineId=store.activeTimelineId;
    return typeof worldProfileId==='string'&&typeof timelineId==='string'&&timelineId
      ?{characterId,worldProfileId,timelineId}:null;
  };
  const usable=()=>!closed&&!isPaused()&&store.timelineWritable===true;

  async function runScope(characterId,phase){
    const scope=scopeFor(characterId);
    if(!scope||!usable())return false;
    const hook=phase==='scene_close'?'onSceneClose':phase==='recovery'?'recover':'onIdle';
    try{
      const result=await coordinator[hook]({scope});
      stats.runs++;stats.saved+=result.saved.filter(s=>s.inserted).length;
      stats.rejected+=result.rejected.length;
      stats.lastPhase=phase;stats.lastStatus=result.status;stats.lastReason=null;
      failures=0;
      // Fully drained -> clean. Backlog or quiet-blocked evidence stays dirty
      // so a later idle tick resumes after the durable cursor.
      if(result.archiveComplete&&!result.blockedByQuiet)dirty.delete(characterId);
      else dirty.add(characterId);
      return true;
    }catch(error){
      failures++;
      stats.lastPhase=phase;stats.lastStatus='failed';stats.lastReason=codeOf(error);
      dirty.add(characterId);
      return false;
    }
  }
  const promotedIds=()=>store.list().map(profile=>profile.characterId).filter(Boolean);
  const serialized=work=>{
    // One pass at a time; later requests chain behind it and never overlap.
    const next=(running??Promise.resolve()).catch(()=>{}).then(work);
    running=next;
    void next.finally(()=>{if(running===next)running=null;}).catch(()=>{});
    return next;
  };

  /** Idle tick: startup recovery first (once per writable timeline), then dirty scopes. */
  function tick(){
    return serialized(async()=>{
      if(closed||isPaused())return {skipped:'unavailable'};
      const writable=store.timelineWritable===true;
      if(!writable){wasWritable=false;return {skipped:'timeline_not_writable'};}
      if(foregroundBusy())return {skipped:'foreground_active'};
      if(failures>=opts.maxConsecutiveFailures)return {skipped:'degraded'};
      const key=`${store.worldProfileId}:${store.activeTimelineId}`;
      const recovering=!wasWritable||recoveredKey!==key;
      let processed=0,failed=0;
      const ids=recovering?promotedIds():[...dirty];
      for(const characterId of ids){
        if(!usable()||foregroundBusy())return {processed,skipped:'foreground_active'};
        if(await runScope(characterId,recovering?'recovery':'idle'))processed++;else failed++;
        await yieldToLoop();
      }
      // Recovery is complete only when every promoted scope drained without error;
      // otherwise the next tick retries it (cursor CAS makes replay idempotent).
      if(recovering&&failed===0){recoveredKey=key;wasWritable=true;}
      return {processed,recovered:recovering&&failed===0};
    });
  }

  /** Foreground activity marker. Synchronous, allocation-free, never throws. */
  function noteForeground(){lastForegroundMs=now();}
  /** A durable M2 line was committed for this promoted NPC in this native session. */
  function noteCommitted({characterId,identity}={}){
    if(closed||typeof characterId!=='string')return;
    lastForegroundMs=now();
    dirty.add(characterId);
    if(identity?.pedId!==undefined){
      const key=`${identity.pedId}:${identity.sessionNonce}`;
      if(!sessions.has(key))sessions.set(key,new Set());
      sessions.get(key).add(characterId);
    }
  }
  /** Native session ended: the conversation is over. Deferred off the detach path. */
  function sceneClosed(identity){
    if(closed)return;
    const key=`${identity?.pedId}:${identity?.sessionNonce}`;
    const ids=sessions.get(key);
    sessions.delete(key);
    if(!ids?.size)return;
    setImmediate(()=>{
      void serialized(async()=>{
        for(const characterId of ids){
          if(!usable())return;
          await runScope(characterId,'scene_close');
          await yieldToLoop();
        }
      }).catch(()=>{});
    });
  }

  function start(){
    if(closed||timer)return;
    timer=setIntervalFn(()=>{void tick().catch(()=>{});},opts.intervalMs);
    timer?.unref?.();
    startTimer=setTimeoutFn(()=>{startTimer=null;void tick().catch(()=>{});},opts.startupDelayMs);
    startTimer?.unref?.();
  }
  async function dispose(){
    closed=true;
    if(timer){clearIntervalFn(timer);timer=null;}
    if(startTimer){clearTimeoutFn(startTimer);startTimer=null;}
    try{await running;}catch{}
    dirty.clear();sessions.clear();
  }
  function diagnostics(){
    return Object.freeze({
      state:closed?'stopped':isPaused()?'paused':failures>=opts.maxConsecutiveFailures?'degraded':
        store.timelineWritable!==true?'waiting':'ready',
      pendingScopes:dirty.size,runs:stats.runs,retained:stats.saved,rejected:stats.rejected,
      lastPhase:stats.lastPhase,lastStatus:stats.lastStatus,lastReason:stats.lastReason,
      recovered:recoveredKey!==null,cloudCuration:'off'});
  }
  return Object.freeze({tick,noteForeground,noteCommitted,sceneClosed,start,dispose,diagnostics});
}
