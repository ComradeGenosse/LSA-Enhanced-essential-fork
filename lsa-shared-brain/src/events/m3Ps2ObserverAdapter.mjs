// M3 source-qualified PS2 intake wiring, host neutral. This module never
// invents an observer, submits an M9 candidate to PS2, or opens SQLite.
// The injected store is the *existing* P2 single-writer timeline store.
//
// Attribution (decision D-023, default): observation time. See
// M3ObserverOwnerBinder. Pass attribution:'source_time' to demand the strict
// native source-time ledger instead.
//
// Coverage (K-13, optional): when `coverage` is supplied, authenticated owner
// samples fed to `coverageSample` become durable coverage windows, and every
// intake outcome (queued / committed / lost) keeps those windows honest: a
// window never claims a moment whose event is still queued or was lost.
import {M3ObserverOwnerBinder} from './m3ObserverOwnerBinder.mjs';
import {M3BoundedIntake} from './m3BoundedIntake.mjs';
import {createM3ObserverCoverageTracker} from './m3ObserverCoverageTracker.mjs';
import {createM3WitnessRecorder} from '../memory/integrationPorts.mjs';

export function createM3Ps2ObserverAdapter({ps2,p2,store=p2,nativeAuthority,
    limit=512,maxBytes=1024*1024,scheduler,onLoss=()=>{},now,
    attribution='observation_time',coverage=null}={}) {
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
    attribution});
  const recorder=createM3WitnessRecorder({store,
    authorize:args=>binder.authorize(args),
    authorizeCoverage:args=>binder.authorizeCoverage(args),now});

  // ------------------------------------------------------------ coverage
  let tracker=null;
  if(coverage){
    const active=()=>store.timelineWritable===true&&store.verifiedHostContext?store.activeTimelineId:null;
    tracker=createM3ObserverCoverageTracker({
      worldProfileId:store.worldProfileId,
      resolveCharacter:coverage.resolveCharacter,
      activeTimeline:active,
      monotonicNow:coverage.monotonicNow,utcNow:coverage.utcNow,
      processId:coverage.processId,options:coverage.options,
      onEvent:(kind,detail)=>{try{onLoss('coverage_'+kind,detail);}catch{}},
      persist:async ops=>{
        const timelineId=active();
        // Not writable (boundary awaiting confirmation, suspended timeline):
        // retryable. Nothing is dropped; the persisted end simply stays put.
        if(!timelineId)throw new Error('timeline_write_suspended');
        const indexes=[],batch=[],stale=[];
        ops.forEach((op,index)=>{
          if(op.seal||op.record.timelineId===timelineId){indexes.push(index);batch.push(op);}
          else stale.push(index);
        });
        if(batch.length===0)return {staleIndexes:stale};
        const result=await recorder.recordObserverCoverage({timelineId,ops:batch});
        if(result?.accepted!==true)throw new Error('timeline_write_suspended');
        for(const local of result.staleIndexes??[])stale.push(indexes[local]);
        return {staleIndexes:stale};
      },
    });
  }
  const outcome=o=>{
    if(!tracker)return;
    switch(o.type){
      case 'queued':
        tracker.noteQueued({key:String(o.entryId),characterId:o.characterId,tick:o.tick});break;
      case 'settled':
        tracker.noteSettled(String(o.entryId));break;
      case 'lost':
        tracker.noteLoss({characterId:o.characterId,observerCaptureRef:o.observerCaptureRef,
          observationId:o.observationId,tick:o.tick,receivedUtc:o.receivedUtc,reason:o.reason});
        if(o.entryId!==undefined)tracker.noteSettled(String(o.entryId));
        break;
      case 'refused':
        // An owned observer's accepted PS2 observation that was NOT admitted is
        // a known miss for that NPC (if it currently has a window).
        tracker.noteLoss({observerCaptureRef:o.observerCaptureRef,observationId:o.observationId,
          tick:o.tick,receivedUtc:o.receivedUtc,reason:o.reason});
        break;
      default:
    }
  };

  const intake=new M3BoundedIntake({binder,recorder,limit,maxBytes,
    ...(scheduler?{scheduler}:{}),onOutcome:outcome,onFailure:(stage,detail)=>{
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
    // Authenticated owner samples (already validated by the native authority).
    coverageSample:sample=>tracker?tracker.sample(sample):{accepted:false,reason:'coverage_disabled'},
    coverageRetire:reason=>{tracker?.retire(reason);},
    coverageIdle:()=>tracker?tracker.idle():Promise.resolve(null),
    // These are C-13 / PS2 retire / P2 timeline boundaries, not invented events.
    retire:()=>{boundaries++;intake.retire();binder.reset();},
    close:()=>{boundaries++;intake.close();binder.reset();},
    // Full shutdown: stop intake, then seal and flush coverage while the store is open.
    shutdown:async()=>{
      boundaries++;
      await intake.idle();
      intake.close();binder.reset();
      await tracker?.close();
    },
    idle:()=>intake.idle(),
    snapshot:()=>Object.freeze({...intake.snapshot(),boundaries,attribution:binder.attribution,
      coverage:tracker?tracker.snapshot():null,
      // A process restart cannot replay unpersisted JavaScript callbacks.
      // Only native-proven redelivery is eligible for a new offer() and P2
      // journal idempotence; there is NO negative coverage inference here.
      recovery:'committed_sqlite_only_uncommitted_callbacks_unknown'}),
  });
}
