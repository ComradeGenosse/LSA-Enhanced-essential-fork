// M9 independent producer groundwork: accepts source-qualified native snapshots.
// OUTPUTS CANDIDATES, NOT journalEvents or witnessed facts. The native PS2 owner
// must add authenticated wire types, witness receipts and current-epoch identity
// proof before M3 is allowed to persist any of these.
import { isUuid, immutableSnapshot } from '../util/identity.mjs';

const finite=n=>typeof n==='number' && Number.isFinite(n);
const tick=n=>Number.isSafeInteger(n) && n>=0 && n<=0xffffffff;
const epoch=n=>Number.isSafeInteger(n) && n>=0;
const LIMITS=Object.freeze({maxAgeMs:3000,maxAirborneMs:30000,minStuntMs:650,
  crashDeltaKph:18,rollAngleDegrees:140,maxRetainedIds:512,maxActors:64});
export const M9_PRODUCER_LIMITS=LIMITS;
const validSource=(s,v)=>s?.authenticated===true && isUuid(s.adapterEpoch) &&
  isUuid(s.hostRunId) && epoch(s.worldEpoch) && v.nativeRun===s.adapterEpoch &&
  v.hostRunId===s.hostRunId && v.worldEpoch===s.worldEpoch;
const validSnap=s=>s && isUuid(s.nativeRun) && isUuid(s.hostRunId) &&
  epoch(s.worldEpoch) && isUuid(s.playerCaptureRef) &&
  (s.vehicleCaptureRef===null || isUuid(s.vehicleCaptureRef)) &&
  tick(s.gameTick) && Number.isSafeInteger(s.sampledAtMs) && s.sampledAtMs>=0 &&
  (s.wantedLevel===null || Number.isSafeInteger(s.wantedLevel) && s.wantedLevel>=0 && s.wantedLevel<=5) &&
  (s.vehicle===null || s.vehicle===undefined || (
    s.vehicleCaptureRef!==null && s.vehicle && typeof s.vehicle==='object' &&
    typeof s.vehicle.airborne==='boolean' && typeof s.vehicle.inWater==='boolean' &&
    typeof s.vehicle.submerged==='boolean' && typeof s.vehicle.grounded==='boolean' &&
    finite(s.vehicle.rollDegrees) && s.vehicle.rollDegrees>=0 && s.vehicle.rollDegrees<=180 &&
    finite(s.vehicle.speedKph) && s.vehicle.speedKph>=0 &&
    (s.vehicle.collision===null || s.vehicle.collision===undefined ||
      isUuid(s.vehicle.collision.nativeReceiptId) && finite(s.vehicle.collision.speedDeltaKph) &&
      s.vehicle.collision.speedDeltaKph>=0))) &&
  (s.outcome===null || s.outcome===undefined || (
    ['wasted','busted'].includes(s.outcome.kind) && isUuid(s.outcome.nativeReceiptId)));
function snapshotKey(s) {return [s.nativeRun,s.hostRunId,s.worldEpoch,s.playerCaptureRef].join(':');}
export class M9NativeEventProducer {
  #last=null; #seen=new Set(); #seenOrder=[]; #now;
  constructor({now=()=>Math.floor(performance.now())}={}) {this.#now=now;}
  reset(){this.#last=null;this.#seen.clear();this.#seenOrder=[];}
  ingest({snapshot,source}={}) {
    if(!validSnap(snapshot) || !validSource(source,snapshot) ||
       !Number.isSafeInteger(this.#now()) || snapshot.sampledAtMs>this.#now() ||
       this.#now()-snapshot.sampledAtMs>LIMITS.maxAgeMs)
      return {accepted:false,reason:'invalid_or_stale_native_sample',candidates:[]};
    const previous=this.#last;
    if(previous && snapshotKey(previous.sample)!==snapshotKey(snapshot))this.reset();
    const before=this.#last;
    if(before && (snapshot.sampledAtMs<=before.sample.sampledAtMs ||
       ((snapshot.gameTick-before.sample.gameTick)>>>0)>30000))
      return {accepted:false,reason:'non_monotonic_native_sample',candidates:[]};
    const state=before?.state || {airborneStart:null,rollHigh:false,water:false,submerged:false};
    const next={...state};
    const emitted=[];
    const emit=(kind,evidenceId,details,participant=snapshot.vehicleCaptureRef)=>{
      const key=`${snapshotKey(snapshot)}:${kind}:${evidenceId}`;
      if(this.#seen.has(key))return;
      this.#seen.add(key);this.#seenOrder.push(key);
      while(this.#seenOrder.length>LIMITS.maxRetainedIds)this.#seen.delete(this.#seenOrder.shift());
      emitted.push(immutableSnapshot({
        kind:'m9_candidate',eventType:kind,nativeEvidenceId:evidenceId,
        nativeRun:snapshot.nativeRun,hostRunId:snapshot.hostRunId,
        worldEpoch:snapshot.worldEpoch,gameTick:snapshot.gameTick,
        observedAtMonotonicMs:snapshot.sampledAtMs,
        playerCaptureRef:snapshot.playerCaptureRef,participantCaptureRef:participant,
        evidence:details,requiresPs2WitnessReceipt:true
      }));
    };
    const v=snapshot.vehicle;
    const old=before?.sample.vehicle;
    if(v && snapshot.vehicleCaptureRef) {
      const collision=v.collision;
      if(collision && collision.speedDeltaKph>=LIMITS.crashDeltaKph)
        emit('vehicle_crash',collision.nativeReceiptId,{
          basis:'native_collision_callback',speedDeltaKph:collision.speedDeltaKph});
      if(!before || snapshot.vehicleCaptureRef!==before.sample.vehicleCaptureRef){
        next.airborneStart=v.airborne?snapshot.sampledAtMs:null;
        next.rollHigh=v.rollDegrees>=LIMITS.rollAngleDegrees;
        next.water=v.inWater;next.submerged=v.submerged;
      } else {
        if(v.rollDegrees>=LIMITS.rollAngleDegrees && !next.rollHigh) {
          next.rollHigh=true;
          emit('vehicle_rollover',`roll:${snapshot.gameTick}`,{
            basis:'native_orientation_samples',priorDegrees:old.rollDegrees,
            currentDegrees:v.rollDegrees});
        }
        if(v.rollDegrees<50)next.rollHigh=false;
        if(v.airborne && !old.airborne)next.airborneStart=snapshot.sampledAtMs;
        if(!v.airborne && old.airborne){
          const ms=next.airborneStart===null?null:snapshot.sampledAtMs-next.airborneStart;
          if(ms!==null && ms>=LIMITS.minStuntMs && ms<=LIMITS.maxAirborneMs && v.grounded)
            emit('airborne_stunt',`landing:${snapshot.gameTick}`,{
              basis:'native_airborne_and_ground_contact',airborneMs:ms,
              landingSpeedKph:v.speedKph});
          next.airborneStart=null;
        }
        if(v.inWater && !next.water)
          emit('vehicle_entered_water',`water:${snapshot.gameTick}`,{basis:'native_water_state_edge'});
        if(v.submerged && !next.submerged)
          emit('vehicle_submerged',`submerged:${snapshot.gameTick}`,{basis:'native_submersion_state_edge'});
        next.water=v.inWater;next.submerged=v.submerged;
      }
    } else {
      next.airborneStart=null;next.rollHigh=false;next.water=false;next.submerged=false;
    }
    if(before && snapshot.wantedLevel!==null && before.sample.wantedLevel!==null &&
       snapshot.wantedLevel!==before.sample.wantedLevel)
      emit('wanted_level_changed',`wanted:${snapshot.gameTick}`,{
        basis:'native_wanted_level_edge',from:before.sample.wantedLevel,to:snapshot.wantedLevel
      },snapshot.playerCaptureRef);
    if(snapshot.outcome && before?.sample.outcome?.nativeReceiptId!==snapshot.outcome.nativeReceiptId)
      emit(snapshot.outcome.kind,snapshot.outcome.nativeReceiptId,{
        basis:'native_outcome_receipt',outcome:snapshot.outcome.kind
      },snapshot.playerCaptureRef);
    this.#last={sample:immutableSnapshot(snapshot),state:next};
    return {accepted:true,candidates:emitted};
  }
}
