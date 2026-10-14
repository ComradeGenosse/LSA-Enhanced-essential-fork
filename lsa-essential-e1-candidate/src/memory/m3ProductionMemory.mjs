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
    adapterOptions={}}={}) {
  if(typeof intelligence?.subscribeAuthenticatedNativeMemoryAuthority!=='function'||
     typeof intelligence.subscribeVerifiedHostContext!=='function'||
     typeof intelligence.subscribeWorldBoundary!=='function'||!intelligence.runtime||
     typeof memoryStore?.withTimelineWrite!=='function')
    throw new TypeError('m3_production_ports_required');
  const emit=(event,data)=>{try{telemetry?.emit?.(event,null,'internal',data,'internal');}catch{}};
  let adapter=null;
  const ownsAuthority=nativeAuthority===null;
  const authority=nativeAuthority??createNativeMemoryAuthority({
    subscribeAuthenticatedNativeFrames:(onFrame,onRetire)=>
      intelligence.subscribeAuthenticatedNativeMemoryAuthority(onFrame,onRetire),
    // K-03(f): the shared resolver. The previous inline predicate compared a
    // `worldProfileId` that P2 profiles do not have, so no owner ever resolved.
    profileForAlias:alias=>resolveLivePromotedProfile(memoryStore,alias),
    coverage:Object.freeze({
      sample:s=>adapter?.coverageSample(s),
      retire:r=>adapter?.coverageRetire(r),
    }),
    ...authorityOptions,
  });
  let unsubHost=null,unsubBoundary=null;
  try {
  adapter=createM3Ps2ObserverAdapter({
    ps2:intelligence.runtime,p2:memoryStore,store:memoryStore,nativeAuthority:authority,attribution,
    coverage:ownsAuthority?{resolveCharacter:alias=>resolveLivePromotedProfile(memoryStore,alias),...coverage}:null,
    onLoss:(stage,detail)=>{
      if(typeof stage==='string'&&stage.startsWith('coverage_')){
        emit('memory_m3_coverage',{stage:stage.slice('coverage_'.length),
          ...(typeof detail?.reason==='string'?{nativeReason:detail.reason}:{})});
      }else emit('memory_m3_intake_loss',{stage});
    },
    ...adapterOptions,
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
    async close() {
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
