// M3 event recorder. M2 injects its synchronous durable journal port later.
// withTimelineWrite MUST be the M1 serialized write fence; never call a port
// outside that fence. Authorization is rechecked at commit time.
import { immutableSnapshot } from '../util/identity.mjs';
import { normalizeWitnessedObservation, samePhysicalOwner, validatePs2MemoryInput, verifyM3DerivedEvent } from './journalEventNormalizer.mjs';

const MAX_GRACE=128, GRACE_MS=120000, MAX_SEEN=1024;
const isPromise=x=>x && typeof x.then==='function';
function sync(value) {
  if(isPromise(value)) throw new Error('async_commit_refused');
  return value;
}
const matchesCandidate=(proof,candidate)=>!!proof && !!candidate &&
  proof.characterId===candidate.characterId &&
  proof.worldProfileId===candidate.worldProfileId &&
  proof.timelineId===candidate.timelineId &&
  proof.adapterEpoch===candidate.adapterEpoch &&
  samePhysicalOwner(proof.ownerProof,candidate.ownerProof);
const accepted = result => result?.inserted===true || result?.duplicate===true;
export class WitnessedEventRecorder {
  #authorize; #authorizeCoverage; #withTimelineWrite; #port; #now; #grace=[]; #seen=new Map();
  constructor({authorize,authorizeCoverage=null,withTimelineWrite,journalPort,now=()=>Math.floor(performance.now())}={}) {
    if(typeof authorize!=='function' || typeof withTimelineWrite!=='function' ||
       typeof journalPort?.append!=='function' || typeof now!=='function')
      throw new TypeError('m3_requires_authoritative_source_and_journal_ports');
    this.#authorize=authorize;this.#authorizeCoverage=authorizeCoverage;
    this.#withTimelineWrite=withTimelineWrite;
    this.#port=journalPort;this.#now=now;
  }
  graceDiagnostics={evicted:0,expired:0,duplicates:0,retired:0};
  reset(){this.graceDiagnostics.retired+=this.#grace.length;this.#grace=[];this.#seen.clear();}
  get bufferedCount(){return this.#grace.length;}
  #trim(){
    const now=this.#now();
    const before=this.#grace.length;
    this.#grace=this.#grace.filter(e=>now>=e.capturedAt && now-e.capturedAt<=GRACE_MS);
    this.graceDiagnostics.expired+=before-this.#grace.length;
    if(this.#grace.length>MAX_GRACE){
      const overflow=this.#grace.length-MAX_GRACE;
      this.graceDiagnostics.evicted+=overflow;
      this.#grace.splice(0,overflow);
    }
    for(const [key,value] of this.#seen) if(now-value>GRACE_MS)this.#seen.delete(key);
    while(this.#seen.size>MAX_SEEN)this.#seen.delete(this.#seen.keys().next().value);
  }
  // Authenticated PS2 intake only: allow source-qualified observations made
  // before promotion, but do not persist them or call the character promoted.
  bufferBeforePromotion({observation,candidate}={}) {
    this.#trim();
    const stamp=sync(this.#authorize({observation,candidate,stage:'prepromotion'}));
    if(!stamp || !matchesCandidate(stamp,candidate) || stamp.promoted!==false || !stamp.current || !Number.isSafeInteger(this.#now()) ||
       !stamp.ownerProof || !stamp.adapterEpoch) return {accepted:false,reason:'prepromotion_proof_missing'};
    const reason=validatePs2MemoryInput(observation,{...stamp,promoted:true});
    if(reason) return {accepted:false,reason};
    const key=[stamp.adapterEpoch,stamp.ownerProof.worldEpoch,stamp.ownerProof.observerCaptureRef,
      stamp.ownerProof.incarnationId,observation.observationId,observation.revision].join(':');
    if(this.#seen.has(key)){this.graceDiagnostics.duplicates++;return {accepted:false,reason:'duplicate_buffer'};}
    this.#seen.set(key,this.#now());
    while(this.#seen.size>MAX_SEEN)this.#seen.delete(this.#seen.keys().next().value);
    this.#grace.push(immutableSnapshot({observation,prePromotionProof:stamp.ownerProof,
      prePromotionCharacterId:stamp.characterId,
      adapterEpoch:stamp.adapterEpoch,capturedAt:this.#now()}));
    this.#trim();
    return {accepted:true,buffered:true};
  }
  // A future M2 journal implementation supplies append({event,sourceEvidence},db,snapshot)
  // synchronously; the DB must dedupe by character/timeline/observation/revision.
  async capture({observation,candidate}={}) {
    if(!candidate?.timelineId) return {accepted:false,reason:'timeline_not_selected'};
    return await this.#withTimelineWrite(candidate.timelineId,(db,snapshot)=>{
      const identity=sync(this.#authorize({observation,candidate,stage:'commit'}));
      if(!identity || !matchesCandidate(identity,candidate) || identity.promoted!==true)
        return {accepted:false,reason:'owner_not_current'};
      const result=normalizeWitnessedObservation({observation,identity,participantProofs:identity.participantProofs??[]});
      if(!result.accepted)return result;
      if(!verifyM3DerivedEvent(result.event,result.sourceEvidence).valid)
        throw new Error('m3_source_derivation_mismatch');
      const committed=sync(this.#port.append({event:result.event,sourceEvidence:result.sourceEvidence},db,snapshot));
      if(!accepted(committed)) throw new Error('m3_journal_commit_unconfirmed');
      return {accepted:true,inserted:committed.inserted===true,duplicate:committed.duplicate===true,
        recordId:result.event.recordId};
    });
  }
  // Promotion grace is bounded to same physical actor, native run, world
  // epoch and last two minutes. Failed/rejected entries cannot leak into a
  // different promoted actor, even if a ped handle was recycled.
  async importOnPromotion({candidate}={}) {
    this.#trim();
    if(!candidate?.timelineId)return {accepted:false,reason:'timeline_not_selected',imported:0};
    let imported=0,duplicates=0,rejected=0;
    const completed=new Set();
    // Multiple observers can be waiting for separate promotions. Importing A
    // must not consume B's pre-promotion evidence.
    const batch=this.#grace.filter(entry=>
      samePhysicalOwner(entry.prePromotionProof,candidate.ownerProof)&&
      entry.prePromotionCharacterId===candidate.characterId&&
      entry.adapterEpoch===candidate.adapterEpoch);
    // Snapshot because another native intake could retire/replace this buffer.
    for(const entry of batch){
      if(this.#now()<entry.capturedAt || this.#now()-entry.capturedAt>GRACE_MS)continue;
      const outcome=await this.#withTimelineWrite(candidate.timelineId,(db,snapshot)=>{
        const identity=sync(this.#authorize({observation:entry.observation,candidate,stage:'promotion_commit',prePromotionProof:entry.prePromotionProof}));
        if(!identity || !matchesCandidate(identity,candidate) || !identity.promoted ||
           !samePhysicalOwner(identity.ownerProof,entry.prePromotionProof) ||
           identity.adapterEpoch!==entry.adapterEpoch) return {accepted:false,reason:'grace_owner_mismatch'};
        const normalized=normalizeWitnessedObservation({
          observation:entry.observation,identity,participantProofs:identity.participantProofs??[],prePromotionProof:entry.prePromotionProof
        });
        if(!normalized.accepted)return normalized;
        if(!verifyM3DerivedEvent(normalized.event,normalized.sourceEvidence).valid)
          throw new Error('m3_source_derivation_mismatch');
        const status=sync(this.#port.append({event:normalized.event,sourceEvidence:normalized.sourceEvidence},db,snapshot));
        if(!accepted(status))throw new Error('m3_journal_commit_unconfirmed');
        return {accepted:true,inserted:status.inserted===true,duplicate:status.duplicate===true};
      });
      if(outcome.accepted){completed.add(entry);imported+=Number(outcome.inserted);duplicates+=Number(outcome.duplicate);}
      else rejected++;
    }
    // Remove only this native owner after a completed attempt. Failed SQL
    // raises before here and remains retryable until the two-minute TTL.
    const handled=new Set(batch.filter(entry=>{
      // Successful append/dedupe is drained; unresolved native proof stays
      // eligible for a later verified retry until the bounded grace expires.
      // Failure to resolve must not fabricate an import.
      return completed.has(entry);
    }));
    this.#grace=this.#grace.filter(entry=>!handled.has(entry));
    return {accepted:true,imported,duplicates,rejected};
  }
  // Authenticated observer-coverage windows/gaps (K-13). Not derived from any
  // PS2 observation: the caller passes only records built from authenticated
  // native owner frames. The port re-checks host/epoch/timeline/profile inside
  // the writer fence and reports stale ops instead of writing them.
  async recordObserverCoverage({timelineId,ops}={}) {
    if(typeof this.#port.recordObserverCoverage!=='function'||!timelineId||
       !Array.isArray(ops)||ops.length<1)
      return {accepted:false,reason:'observer_coverage_not_supported',staleIndexes:[]};
    return await this.#withTimelineWrite(timelineId,(db,snapshot)=>{
      const result=sync(this.#port.recordObserverCoverage(ops,db,snapshot));
      return {accepted:true,applied:result.applied,staleIndexes:result.staleIndexes??[]};
    });
  }
  // Negative coverage has its own durable SQL table; never transform it into a
  // journalEvent. Only a separately verified native coverage receipt may
  // establish did_not_witness, and missing data is unavailable, never negative.
  async recordNegativeCoverage({candidate,observationId,status,reason='',coverageReceipt=null}={}){
    if(!['did_not_witness','unknown','unavailable'].includes(status)||
       typeof reason!=='string'||reason.length>80||
       !candidate?.timelineId||!this.#port.recordCoverage||
       typeof this.#authorizeCoverage!=='function')
      return {accepted:false,reason:'negative_coverage_not_supported'};
    return await this.#withTimelineWrite(candidate.timelineId,(db,snapshot)=>{
      const identity=sync(this.#authorizeCoverage({candidate,coverageReceipt,status,observationId}));
      if(!identity?.promoted||!matchesCandidate(identity,candidate))
        return {accepted:false,reason:'coverage_owner_not_current'};
      if(status==='did_not_witness'&&!identity.nativeCoverage?.certified)
        return {accepted:false,reason:'native_negative_not_certified'};
      const record=immutableSnapshot({
        characterId:identity.characterId,worldProfileId:identity.worldProfileId,
        timelineId:identity.timelineId,observationId,status,reason,
        adapterEpoch:identity.adapterEpoch,ownerProof:identity.ownerProof,
        nativeCoverage:identity.nativeCoverage??null
      });
      const receipt=sync(this.#port.recordCoverage(record,db,snapshot));
      if(!accepted(receipt))throw new Error('m3_coverage_commit_unconfirmed');
      return {accepted:true,status,inserted:receipt.inserted===true,duplicate:receipt.duplicate===true};
    });
  }
}
export const PROMOTION_GRACE_LIMITS=Object.freeze({maxObservations:MAX_GRACE,maxAgeMs:GRACE_MS});
