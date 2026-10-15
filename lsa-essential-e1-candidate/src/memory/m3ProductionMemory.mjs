// Production wiring for witnessed-event memory (WS-5b): authenticated native
// owner frames + verified PS2 accepted observations -> the one P2 SQLite store.
//
// Shared by bootstrap and the integration tests so both exercise the same code
// (same pattern as createMemoryD02Port). Nothing here trusts a caller flag:
//  * the authority sees only post-authentication frames from the real pipe,
//  * the adapter attributes at the synchronous PS2 tap (decision D-023),
//  * coverage is derived only from the authority's accepted owner frames.
//
// An injected `nativeAuthority` (tests that script the native side) is used for
// attribution but yields NO coverage: coverage needs authenticated frames.
import {createNativeMemoryAuthority} from './nativeMemoryAuthority.mjs';
import {resolveLivePromotedProfile} from './livePromotedProfile.mjs';
import {createM3Ps2ObserverAdapter} from '../../../lsa-shared-brain/src/events/m3Ps2ObserverAdapter.mjs';

export function createM3ProductionMemory({intelligence,memoryStore,nativeAuthority=null,
    telemetry=null,attribution='observation_time',coverage={},authorityOptions={},
    adapterOptions={},eventMode='on',coverageMode=coverage===null?'off':'on'}={}) {
  if(!['off','shadow','on'].includes(eventMode)||!['off','shadow','on'].includes(coverageMode))
    throw new TypeError('m3_invalid_mode');
  if(typeof intelligence?.subscribeAuthenticatedNativeMemoryAuthority!=='function'||
     typeof intelligence.subscribeVerifiedHostContext!=='function'||
     typeof intelligence.subscribeWorldBoundary!=='function'||!intelligence.runtime||
     typeof memoryStore?.withTimelineWrite!=='function')
    throw new TypeError('m3_production_ports_required');
  const emit=(event,data)=>{try{telemetry?.emit?.(event,null,'internal',data,'internal');}catch{}};
  let adapter=null,closed=false;
  const ownsAuthority=nativeAuthority===null;
  const authority=nativeAuthority??createNativeMemoryAuthority({
    ...authorityOptions,
    subscribeAuthenticatedNativeFrames:(onFrame,onRetire)=>
      intelligence.subscribeAuthenticatedNativeMemoryAuthority(onFrame,onRetire),
    // K-03(f): the shared resolver. The previous inline predicate compared a
    // `worldProfileId` that P2 profiles do not have, so no owner ever resolved.
    profileForAlias:alias=>resolveLivePromotedProfile(memoryStore,alias),
    coverage:coverageMode==='off'?null:Object.freeze({
      sample:s=>adapter?.coverageSample(s),
      retire:r=>adapter?.coverageRetire(r),
    }),
  });
  let unsubHost=null,unsubBoundary=null;
  try {
  adapter=createM3Ps2ObserverAdapter({
    ...adapterOptions,
    ps2:intelligence.runtime,p2:memoryStore,store:memoryStore,nativeAuthority:authority,attribution,
    coverage:ownsAuthority&&coverageMode!=='off'?
      {...coverage,resolveCharacter:alias=>resolveLivePromotedProfile(memoryStore,alias)}:null,
    onLoss:(stage,detail)=>{
      if(typeof stage==='string'&&stage.startsWith('coverage_')){
        emit('memory_m3_coverage',{stage:stage.slice('coverage_'.length),
          ...(typeof detail?.reason==='string'?{nativeReason:detail.reason}:{})});
      }else emit('memory_m3_intake_loss',{stage});
    },
    // These gates cannot be replaced by adapterOptions or a test authority.
    eventMode,coverageMode,
  });
  // Any change of native host run / world epoch (or its loss) retires queued
  // work; in-flight work is independently fenced inside the P2 write.
  let epoch=null;
  unsubHost=intelligence.subscribeVerifiedHostContext(host=>{
    const stamp=host?host.hostRunId+':'+host.worldEpoch:null;
    if(stamp!==epoch){adapter.retire();epoch=stamp;}
  });
  unsubBoundary=intelligence.subscribeWorldBoundary(()=>{adapter.retire();});
  return Object.freeze({
    authority:ownsAuthority?authority:null,
    adapter,
    tap:receipt=>adapter.acceptedObservationTap(receipt),
    snapshot:()=>adapter.snapshot(),
    operationalStates:()=>{
      const s=adapter.snapshot(),sourceReady=ownsAuthority&&authority.status().connected;
      const dependencyReady=sourceReady&&memoryStore.timelineWritable===true&&
        !!memoryStore.verifiedHostContext;
      const counters=keys=>Object.freeze(Object.fromEntries(keys.map(k=>[k,s[k]??0])));
      const eventCounters=eventMode==='shadow'?s.shadow:counters([
        'offered','queued','committed','duplicate','stale','rejected','unattributed',
        'overflow','tooLarge','failed','retired','highWater','waiting','qualified','lost','dropped']);
      const c=s.coverage;
      const coverageCounters=Object.freeze(Object.fromEntries([
        'samples','windowsOpened','windowsClosed','gapsRecorded','gapsUnattributed',
        'checkpoints','persistFailures','persistRejectedStale','pending','unpersistedGaps'
      ].map(k=>[k,c?.[k]??0])));
      const row=(mode,ready,confirmed,counts,reason,failure=null)=>{
        const state=closed||mode==='off'?'stopped':!ready||failure?'blocked':confirmed?'operational':'waiting';
        return Object.freeze({requestedMode:mode,effectiveMode:closed?'off':mode,
          state,operationalState:state,sourceReady,dependencyReady:ready,
          reason:closed?'runtime_stopped':mode==='off'?'optional_consumer_stopped':
            !ready?reason:failure??(confirmed?null:'operation_receipt_pending'),
          counters:counts,restartRequired:true});
      };
      return Object.freeze({
        'memory.events':row(eventMode,dependencyReady&&!!intelligence.runtime?.correlator,
          eventMode==='shadow'?s.shadow.qualified>0:s.lastOutcome?.state==='durable',
          eventCounters,!sourceReady?'authenticated_native_source_unavailable':'ps2_or_timeline_unavailable',
          s.lastOutcome?.state==='blocked'?s.lastOutcome.reason:null),
        'memory.coverage':row(coverageMode,dependencyReady&&!!c&&!c.degraded,
          coverageMode==='shadow'?c?.open>0:c?.windows.some(w=>w.persistedEndTick!==null),coverageCounters,
          !ownsAuthority?'injected_authority_has_no_production_coverage':
            c?.degraded?'coverage_ledger_degraded':!sourceReady?
              'authenticated_native_source_unavailable':'timeline_unavailable'),
      });
    },
    async close() {
      closed=true;
      try{unsubHost?.();unsubBoundary?.();}catch{}
      try{await adapter.shutdown();}
      finally{if(ownsAuthority)authority.close();}
    },
  });
  } catch(error) {
    unsubHost?.();unsubBoundary?.();
    adapter?.close();
    if(ownsAuthority)authority.close();
    throw error;
  }
}
