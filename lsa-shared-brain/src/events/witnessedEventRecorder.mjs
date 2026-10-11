// M3 event recorder. M2 injects its synchronous durable journal port later.
// withTimelineWrite MUST be the M1 serialized write fence; never call a port
// outside that fence. Authorization is rechecked at commit time.
import { immutableSnapshot } from '../util/identity.mjs';
import { normalizeWitnessedObservation, samePhysicalOwner, validatePs2MemoryInput } from './journalEventNormalizer.mjs';

const MAX_GRACE=128, GRACE_MS=120000;
const isPromise=x=>x && typeof x.then==='function';
function sync(value) {
  if(isPromise(value)) throw new Error('async_commit_refused');
  return value;
}
const accepted = result => result?.inserted===true || result?.duplicate===true;
export class WitnessedEventRecorder {
  #authorize; #withTimelineWrite; #port; #now; #grace=[]; #seen=new Map();
  constructor({authorize,withTimelineWrite,journalPort,now=()=>Math.floor(performance.now())}={}) {
    if(typeof authorize!=='function' || typeof withTimelineWrite!=='function' ||
       typeof journalPort?.append!=='function' || typeof now!=='function')
      throw new TypeError('m3_requires_authoritative_source_and_journal_ports');
    this.#authorize=authorize; this.#withTimelineWrite=withTimelineWrite;
    this.#port=journalPort;this.#now=now;
  }
  reset(){this.#grace=[];this.#seen.clear();}
  get bufferedCount(){return this.#grace.length;}
  #trim(){
    const now=this.#now();
    this.#grace=this.#grace.filter(e=>now>=e.capturedAt && now-e.capturedAt<=GRACE_MS);
    if(this.#grace.length>MAX_GRACE)this.#grace.splice(0,this.#grace.length-MAX_GRACE);
    for(const [key,value] of this.#seen) if(now-value>GRACE_MS)this.#seen.delete(key);
  }
  // Authenticated PS2 intake only: allow source-qualified observations made
  // before promotion, but do not persist them or call the character promoted.
  bufferBeforePromotion({observation,candidate}={}) {
    this.#trim();
    const stamp=sync(this.#authorize({observation,candidate,stage:'prepromotion'}));
    if(!stamp || stamp.promoted!==false || !stamp.current || !Number.isSafeInteger(this.#now()) ||
       !stamp.ownerProof || !stamp.adapterEpoch) return {accepted:false,reason:'prepromotion_proof_missing'};
    const reason=validatePs2MemoryInput(observation,{...stamp,promoted:true});
    if(reason) return {accepted:false,reason};
    const key=[stamp.adapterEpoch,stamp.ownerProof.worldEpoch,stamp.ownerProof.observerCaptureRef,
      stamp.ownerProof.incarnationId,observation.observationId,observation.revision].join(':');
    if(this.#seen.has(key))return {accepted:false,reason:'duplicate_buffer'};
    this.#seen.set(key,this.#now());
    this.#grace.push(immutableSnapshot({observation,prePromotionProof:stamp.ownerProof,
      adapterEpoch:stamp.adapterEpoch,capturedAt:this.#now()}));
    this.#trim();
    return {accepted:true,buffered:true};
  }
  // A future M2 journal implementation supplies append({event,sourceEvidence},db,snapshot)
  // synchronously; the DB must dedupe by character/timeline/observation/revision.
  async capture({observation,candidate,participantProofs=[]}={}) {
    if(!candidate?.timelineId) return {accepted:false,reason:'timeline_not_selected'};
    return await this.#withTimelineWrite(candidate.timelineId,(db,snapshot)=>{
      const identity=sync(this.#authorize({observation,candidate,stage:'commit'}));
      if(!identity || identity.promoted!==true || identity.timelineId!==candidate.timelineId)
        return {accepted:false,reason:'owner_not_current'};
      const result=normalizeWitnessedObservation({observation,identity,participantProofs});
      if(!result.accepted)return result;
      const committed=sync(this.#port.append({event:result.event,sourceEvidence:result.sourceEvidence},db,snapshot));
      if(!accepted(committed)) throw new Error('m3_journal_commit_unconfirmed');
      return {accepted:true,inserted:committed.inserted===true,duplicate:committed.duplicate===true,
        recordId:result.event.recordId};
    });
  }
  // Promotion grace is bounded to same physical actor, native run, world
  // epoch and last two minutes. Failed/rejected entries cannot leak into a
  // different promoted actor, even if a ped handle was recycled.
  async importOnPromotion({candidate,participantProofs=[]}={}) {
    this.#trim();
    if(!candidate?.timelineId)return {accepted:false,reason:'timeline_not_selected',imported:0};
    let imported=0,duplicates=0,rejected=0;
    // Snapshot because another native intake could retire/replace this buffer.
    for(const entry of [...this.#grace]){
      if(this.#now()<entry.capturedAt || this.#now()-entry.capturedAt>GRACE_MS)continue;
      const outcome=await this.#withTimelineWrite(candidate.timelineId,(db,snapshot)=>{
        const identity=sync(this.#authorize({observation:entry.observation,candidate,stage:'promotion_commit'}));
        if(!identity || !identity.promoted || identity.timelineId!==candidate.timelineId ||
           !samePhysicalOwner(identity.ownerProof,entry.prePromotionProof) ||
           identity.adapterEpoch!==entry.adapterEpoch) return {accepted:false,reason:'grace_owner_mismatch'};
        const normalized=normalizeWitnessedObservation({
          observation:entry.observation,identity,participantProofs,prePromotionProof:entry.prePromotionProof
        });
        if(!normalized.accepted)return normalized;
        const status=sync(this.#port.append({event:normalized.event,sourceEvidence:normalized.sourceEvidence},db,snapshot));
        if(!accepted(status))throw new Error('m3_journal_commit_unconfirmed');
        return {accepted:true,inserted:status.inserted===true,duplicate:status.duplicate===true};
      });
      if(outcome.accepted){imported+=Number(outcome.inserted);duplicates+=Number(outcome.duplicate);}
      else rejected++;
    }
    // Zeroize after one cutover attempt: do not rebind old NPC histories later.
    this.#grace=[];
    return {accepted:true,imported,duplicates,rejected};
  }
  // Negative witness coverage is not a journalEvent and can NEVER be recalled
  // as a positive witness assertion. M2 can persist it through a separate port.
  async recordNegativeCoverage({candidate,observationId,status,reason}={}) {
    if(!['did_not_witness','unknown','unavailable'].includes(status) || typeof reason!=='string' ||
       !candidate?.timelineId || typeof this.#port.recordCoverage!=='function')
      return {accepted:false,reason:'negative_coverage_not_supported'};
    return await this.#withTimelineWrite(candidate.timelineId,(db,snapshot)=>{
      const identity=sync(this.#authorize({observation:null,candidate,stage:'coverage_commit'}));
      if(!identity?.promoted || identity.timelineId!==candidate.timelineId)
        return {accepted:false,reason:'owner_not_current'};
      const record=immutableSnapshot({
        characterId:identity.characterId,worldProfileId:identity.worldProfileId,
        timelineId:identity.timelineId,observationId:observationId??null,
        status,reason:reason.slice(0,80),ownerProof:identity.ownerProof
      });
      sync(this.#port.recordCoverage(record,db,snapshot));
      return {accepted:true,status};
    });
  }
}
export const PROMOTION_GRACE_LIMITS=Object.freeze({maxObservations:MAX_GRACE,maxAgeMs:GRACE_MS});
