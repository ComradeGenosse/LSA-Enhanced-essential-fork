// M3 source-qualified PS2 intake wiring, host neutral. This module never
// invents an observer, submits an M9 candidate to PS2, or opens SQLite.
// The injected store is the *existing* P2 single-writer timeline store.
import {M3ObserverOwnerBinder} from './m3ObserverOwnerBinder.mjs';
import {M3BoundedIntake} from './m3BoundedIntake.mjs';
import {createM3WitnessRecorder} from '../memory/integrationPorts.mjs';

export function createM3Ps2ObserverAdapter({ps2,p2,store=p2,nativeAuthority,
    limit=512,maxBytes=1024*1024,scheduler,onLoss=()=>{},now}={}) {
  if(!nativeAuthority||typeof nativeAuthority.resolveNativeOwner!=='function' ||
     typeof onLoss!=='function'||!store||typeof store.withTimelineWrite!=='function')
    throw new TypeError('m3_source_authority_and_p2_writer_required');
  // Native resolvers MUST be synchronous. A call returning a Promise is not a
  // usable source-time proof and cannot hold a PS2 callback open.
  const syncNative=(method)=>typeof nativeAuthority[method]==='function' ? input=>{
    const value=nativeAuthority[method](input);
    if(value?.then)throw new Error('m3_async_native_authority_refused');
    return value;
  }:null;
  const binder=new M3ObserverOwnerBinder({ps2,p2,
    resolveNativeOwner:syncNative('resolveNativeOwner'),
    resolveParticipants:syncNative('resolveParticipants'),
    resolvePrepromotion:syncNative('resolvePrepromotion'),
    verifyNativeCoverage:syncNative('verifyNativeCoverage'),
    requireSourceTimeProof:true});
  const recorder=createM3WitnessRecorder({store,
    authorize:args=>binder.authorize(args),
    authorizeCoverage:args=>binder.authorizeCoverage(args),now});
  const intake=new M3BoundedIntake({binder,recorder,limit,maxBytes,
    ...(scheduler?{scheduler}:{}),onFailure:(stage,detail)=>{
      try{onLoss(stage,detail);}catch{}
    }});
  let boundaries=0;
  return Object.freeze({
    // Supply to IntelligenceClient.acceptedObservationTap. The PS2 host calls
    // only for *already accepted* correlated PS2 observations (not PS3 salience).
    acceptedObservationTap:receipt=>intake.offer(receipt),
    // Optional, separately authorized native-reserved owner before promotion.
    prepromotionAcceptedTap:receipt=>intake.offer(receipt,{prepromotion:true}),
    importOnPromotion:({candidate})=>recorder.importOnPromotion({candidate}),
    recordNegativeCoverage:input=>recorder.recordNegativeCoverage(input),
    // These are C-13 / PS2 retire / P2 timeline boundaries, not invented events.
    retire:()=>{boundaries++;intake.retire();binder.reset();},
    close:()=>{boundaries++;intake.close();binder.reset();},
    idle:()=>intake.idle(),
    snapshot:()=>Object.freeze({...intake.snapshot(),boundaries,
      // A process restart cannot replay unpersisted JavaScript callbacks.
      // Only native-proven redelivery is eligible for a new offer() and P2
      // journal idempotence; there is NO negative coverage inference here.
      recovery:'committed_sqlite_only_uncommitted_callbacks_unknown'}),
  });
}
