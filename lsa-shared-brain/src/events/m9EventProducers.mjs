// M9 source-qualified GTA event CANDIDATES. Nothing here is PS2 witness proof,
// a journal event, a factual NPC memory, or permission for spontaneous speech.
// Native input must come from an authenticated and owner-fenced H registration.
import { createHash } from 'node:crypto';
import { isUuid, immutableSnapshot } from '../util/identity.mjs';

const finite = n => typeof n === 'number' && Number.isFinite(n);
const tick = n => Number.isSafeInteger(n) && n >= 0 && n <= 0xffffffff;
const epoch = n => Number.isSafeInteger(n) && n >= 0;
export const M9_PRODUCER_LIMITS = Object.freeze({
  maxAgeMs: 3000, maxSampleGapMs: 1500, maxTickGapMs: 30000,
  maxAirborneMs: 30000, minStuntMs: 650,
  crashDeltaKph: 18, minCollisionDamage: 35, rollAngleDegrees: 140,
  maxRetainedIds: 512
});
const LIMITS = M9_PRODUCER_LIMITS;
const nativeSource = (s,v) => s?.authenticated === true &&
  isUuid(s.adapterEpoch) && isUuid(s.hostRunId) && epoch(s.worldEpoch) &&
  v.nativeRun === s.adapterEpoch && v.hostRunId === s.hostRunId &&
  v.worldEpoch === s.worldEpoch &&
  (s.playerCaptureRef === undefined || s.playerCaptureRef === v.playerCaptureRef);
const validCollision = c => c === null || c === undefined || (
  isUuid(c?.nativeReceiptId) && (
    // A source-pinned collision callback with an actual measured speed delta.
    (finite(c.speedDeltaKph) && c.speedDeltaKph >= 0 &&
      c.speedDeltaKph <= 500 && c.damage === undefined) ||
    // DamageTrackerLib classifies an actual vehicle-damage callback as
    // collision. It does NOT prove a speed delta, vehicle velocity, or cause.
    (c.sourceType === 'damage_tracker_vehicle_collision' &&
      Number.isSafeInteger(c.damage) && c.damage >= 0 && c.damage <= 100000 &&
      c.speedDeltaKph === undefined)
  )
);
const validSnap = s => !!s && isUuid(s.nativeRun) && isUuid(s.hostRunId) &&
  epoch(s.worldEpoch) && isUuid(s.playerCaptureRef) &&
  (s.vehicleCaptureRef === null || isUuid(s.vehicleCaptureRef)) &&
  tick(s.gameTick) && Number.isSafeInteger(s.sampledAtMs) && s.sampledAtMs >= 0 &&
  (s.wantedLevel === null || Number.isSafeInteger(s.wantedLevel) &&
    s.wantedLevel >= 0 && s.wantedLevel <= 5) &&
  (s.vehicle === null || s.vehicle === undefined || (
    s.vehicleCaptureRef !== null && s.vehicle && typeof s.vehicle === 'object' &&
    typeof s.vehicle.airborne === 'boolean' &&
    typeof s.vehicle.inWater === 'boolean' &&
    typeof s.vehicle.submerged === 'boolean' &&
    typeof s.vehicle.grounded === 'boolean' &&
    finite(s.vehicle.rollDegrees) && s.vehicle.rollDegrees >= 0 &&
    s.vehicle.rollDegrees <= 180 &&
    finite(s.vehicle.speedKph) && s.vehicle.speedKph >= 0 &&
    s.vehicle.speedKph <= 500 && validCollision(s.vehicle.collision))) &&
  (s.outcome === null || s.outcome === undefined ||
    (['wasted','busted'].includes(s.outcome.kind) &&
      isUuid(s.outcome.nativeReceiptId)));
function scope(s) {
  return [s.nativeRun,s.hostRunId,s.worldEpoch,s.playerCaptureRef].join(':');
}
function stableId(parts) {
  const h = Buffer.from(createHash('sha256').update(JSON.stringify(parts)).digest().subarray(0,16));
  h[6] = h[6] & 15 | 64;
  h[8] = h[8] & 63 | 128;
  const x=h.toString('hex');
  return [x.slice(0,8),x.slice(8,12),x.slice(12,16),x.slice(16,20),x.slice(20)].join('-');
}
const emptyState = () => ({
  airborneStart: null, rollHigh: false, water: false, submerged: false
});
export class M9NativeEventProducer {
  #last = null;
  #seen = new Set();
  #seenOrder = [];
  #now;
  #verify;
  // verifySource is an OPTIONAL additional native-host authority seam.
  // Without trusted H registration, "authenticated" is data, not security.
  constructor({now=()=>Math.floor(performance.now()),verifySource=null}={}) {
    if (typeof now !== 'function' || verifySource !== null &&
      typeof verifySource !== 'function') throw new TypeError('m9_invalid_ports');
    this.#now=now;
    this.#verify=verifySource;
  }
  reset() { this.#last=null;this.#seen.clear();this.#seenOrder=[]; }
  ingest({snapshot,source}={}) {
    const now=this.#now();
    if (!Number.isSafeInteger(now) || !validSnap(snapshot) ||
        !nativeSource(source,snapshot) ||
        snapshot.sampledAtMs > now || now-snapshot.sampledAtMs > LIMITS.maxAgeMs ||
        (this.#verify && this.#verify({snapshot,source}) !== true))
      return {accepted:false,reason:'invalid_or_stale_native_sample',candidates:[]};
    if (this.#last && scope(this.#last.sample)!==scope(snapshot)) this.reset();
    const last=this.#last;
    if (last && (snapshot.sampledAtMs <= last.sample.sampledAtMs ||
        ((snapshot.gameTick-last.sample.gameTick)>>>0)>LIMITS.maxTickGapMs))
      return {accepted:false,reason:'non_monotonic_native_sample',candidates:[]};
    // Missing intermediate frames must NEVER be interpreted as a continuous
    // airborne trip, rollover, wanted edge, or water transition.
    const contiguous=!!last &&
      snapshot.sampledAtMs-last.sample.sampledAtMs<=LIMITS.maxSampleGapMs &&
      ((snapshot.gameTick-last.sample.gameTick)>>>0)<=LIMITS.maxSampleGapMs+250;
    const previous=contiguous?last:null;
    const prior=previous?.sample;
    const state=previous?.state || emptyState();
    const next={...state};
    const candidates=[];
    const emit=(eventType,evidenceId,evidence,participantCaptureRef=snapshot.vehicleCaptureRef)=>{
      const dedupe=[scope(snapshot),eventType,evidenceId];
      const key=JSON.stringify(dedupe);
      if(this.#seen.has(key)) return;
      this.#seen.add(key);this.#seenOrder.push(key);
      while(this.#seenOrder.length>LIMITS.maxRetainedIds)
        this.#seen.delete(this.#seenOrder.shift());
      candidates.push(immutableSnapshot({
        kind:'m9_candidate',eventId:stableId(['M9',...dedupe]),
        eventType,nativeEvidenceId:evidenceId,
        nativeRun:snapshot.nativeRun,hostRunId:snapshot.hostRunId,
        worldEpoch:snapshot.worldEpoch,gameTick:snapshot.gameTick,
        observedAtMonotonicMs:snapshot.sampledAtMs,
        playerCaptureRef:snapshot.playerCaptureRef,participantCaptureRef,
        evidence,requiresPs2WitnessReceipt:true
      }));
    };
    const v=snapshot.vehicle;
    const old=prior?.vehicle;
    if(v && snapshot.vehicleCaptureRef) {
      const collision=v.collision;
      if(collision?.sourceType==='damage_tracker_vehicle_collision' &&
          collision.damage>=LIMITS.minCollisionDamage)
        emit('vehicle_crash',collision.nativeReceiptId,{
          basis:'native_damage_tracker_collision',impactDamage:collision.damage,
          speedDeltaKph:null});
      else if(collision?.speedDeltaKph>=LIMITS.crashDeltaKph)
        emit('vehicle_crash',collision.nativeReceiptId,{
          basis:'native_collision_callback',speedDeltaKph:collision.speedDeltaKph});
      if(!prior || !old || snapshot.vehicleCaptureRef!==prior.vehicleCaptureRef) {
        next.airborneStart=v.airborne?snapshot.sampledAtMs:null;
        next.rollHigh=v.rollDegrees>=LIMITS.rollAngleDegrees;
        next.water=v.inWater;
        next.submerged=v.submerged;
      } else {
        if(v.rollDegrees>=LIMITS.rollAngleDegrees && !next.rollHigh) {
          next.rollHigh=true;
          emit('vehicle_rollover','roll:'+snapshot.gameTick,{
            basis:'native_orientation_samples',priorDegrees:old.rollDegrees,
            currentDegrees:v.rollDegrees
          });
        }
        if(v.rollDegrees<50) next.rollHigh=false;
        if(v.airborne&&!old.airborne) next.airborneStart=snapshot.sampledAtMs;
        if(!v.airborne&&old.airborne) {
          const duration=next.airborneStart===null?null:
            snapshot.sampledAtMs-next.airborneStart;
          if(duration!==null && duration>=LIMITS.minStuntMs &&
             duration<=LIMITS.maxAirborneMs && v.grounded)
            emit('airborne_stunt','landing:'+snapshot.gameTick,{
              basis:'native_airborne_and_ground_contact',airborneMs:duration,
              landingSpeedKph:v.speedKph
            });
          next.airborneStart=null;
        }
        if(v.inWater&&!next.water)
          emit('vehicle_entered_water','water:'+snapshot.gameTick,{
            basis:'native_water_state_edge'
          });
        if(v.submerged&&!next.submerged)
          emit('vehicle_submerged','submerged:'+snapshot.gameTick,{
            basis:'native_submersion_state_edge'
          });
        next.water=v.inWater;
        next.submerged=v.submerged;
      }
    } else {
      Object.assign(next,emptyState());
    }
    if(prior && snapshot.wantedLevel!==null && prior.wantedLevel!==null &&
       snapshot.wantedLevel!==prior.wantedLevel)
      emit('wanted_level_changed','wanted:'+snapshot.gameTick,{
        basis:'native_wanted_level_edge',from:prior.wantedLevel,to:snapshot.wantedLevel
      },snapshot.playerCaptureRef);
    if(snapshot.outcome &&
       snapshot.outcome.nativeReceiptId!==prior?.outcome?.nativeReceiptId)
      emit(snapshot.outcome.kind,snapshot.outcome.nativeReceiptId,{
        basis:'native_outcome_receipt',outcome:snapshot.outcome.kind
      },snapshot.playerCaptureRef);
    this.#last={sample:immutableSnapshot(snapshot),state:next};
    return {accepted:true,candidates};
  }
}
