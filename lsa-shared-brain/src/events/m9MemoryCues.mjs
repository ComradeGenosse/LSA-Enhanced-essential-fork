// M9 -> future PS6: inert, typed memory-cue proposals only.
// A source candidate alone is NEVER witnessed, remembered or speech-eligible.
// The authoritative M3/PS2 binder supplies authorizeWitness, the sole proof port.
// Even an emitted cue still needs PS6 C-06/C-11 admission at use time.
import { createHash } from 'node:crypto';
import { isUuid, immutableSnapshot } from '../util/identity.mjs';

const FAMILIES=Object.freeze({
  vehicle_crash:'vehicle_mishap',vehicle_rollover:'vehicle_mishap',
  airborne_stunt:'vehicle_mishap',vehicle_entered_water:'vehicle_mishap',
  vehicle_submerged:'vehicle_mishap',wanted_level_changed:'police_attention',
  wasted:'player_outcome',busted:'player_outcome'
});
export const M9_CUE_LIMITS=Object.freeze({
  maxCandidateAgeMs:30000,perCharacterCooldownMs:600000,
  perFamilyCooldownMs:600000,maxDedupe:256
});
const validPriority=p=>p?.known===true && p.playerIdle===true &&
  p.micIdle===true && p.interruptionFree===true &&
  p.directorAvailable===true && p.ownerCurrent===true &&
  p.timelineWritable===true;
const validCandidate=c=>c?.kind==='m9_candidate' &&
  isUuid(c.eventId) && Object.hasOwn(FAMILIES,c.eventType) &&
  isUuid(c.nativeRun) && isUuid(c.hostRunId) &&
  Number.isSafeInteger(c.worldEpoch) && c.worldEpoch>=0 &&
  isUuid(c.playerCaptureRef) &&
  Number.isSafeInteger(c.observedAtMonotonicMs) &&
  c.observedAtMonotonicMs>=0 && c.requiresPs2WitnessReceipt===true;
const validWitness=(c,w)=>w?.status==='witnessed' &&
  ['self','visual','auditory'].includes(w.modality) && w.certainty==='direct' &&
  isUuid(w.observationId) && isUuid(w.witnessReceiptId) &&
  isUuid(w.journalRecordId) && isUuid(w.characterId) &&
  isUuid(w.worldProfileId) && isUuid(w.timelineId) &&
  isUuid(w.observerCaptureRef) && w.playerCaptureRef===c.playerCaptureRef &&
  ['franklin','michael','trevor','unknown'].includes(w.protagonistKey) &&
  w.candidateEventId===c.eventId &&
  w.nativeRun===c.nativeRun && w.hostRunId===c.hostRunId &&
  w.worldEpoch===c.worldEpoch;
function id(parts) {
  const b=Buffer.from(createHash('sha256').update(JSON.stringify(parts))
    .digest().subarray(0,16));
  b[6]=b[6]&15|64;b[8]=b[8]&63|128;
  const h=b.toString('hex');
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),
    h.slice(16,20),h.slice(20)].join('-');
}
export class M9MemoryCueCandidates {
  #authorize;
  #now;
  #characterCooldown=new Map();
  #familyCooldown=new Map();
  #seen=new Set();
  #order=[];
  #scope=null;
  constructor({authorizeWitness,now=()=>Math.floor(performance.now())}={}) {
    if(typeof authorizeWitness!=='function'||typeof now!=='function')
      throw new TypeError('m9_cue_requires_authoritative_witness_port');
    this.#authorize=authorizeWitness;this.#now=now;
  }
  reset() {
    this.#characterCooldown.clear();this.#familyCooldown.clear();
    this.#seen.clear();this.#order=[];this.#scope=null;
  }
  propose({candidate,witness,priority}={}) {
    const now=this.#now();
    if(!Number.isSafeInteger(now) || !validCandidate(candidate) ||
       !validWitness(candidate,witness))
      return {accepted:false,reason:'missing_qualified_witness'};
    const scope=[candidate.nativeRun,candidate.hostRunId,candidate.worldEpoch,
      candidate.playerCaptureRef,witness.protagonistKey,
      witness.worldProfileId,witness.timelineId].join(':');
    if(candidate.observedAtMonotonicMs>now ||
       now-candidate.observedAtMonotonicMs>M9_CUE_LIMITS.maxCandidateAgeMs)
      return {accepted:false,reason:'stale_candidate'};
    // This MUST be a synchronous current PS2/P2/M3 provenance check. A
    // JSON flag, narrative or unverified observation ID is insufficient.
    let authorized=false;
    try {authorized=this.#authorize({candidate,witness})===true;}catch{}
    if(!authorized)return {accepted:false,reason:'witness_not_authorized'};
    if(!validPriority(priority))
      return {accepted:false,reason:'player_priority_or_director_veto'};
    // Rejected/forged scopes never flush genuine cooldown or dedupe state.
    if(this.#scope!==null && this.#scope!==scope)this.reset();
    this.#scope=scope;
    const dedupe=[scope,witness.characterId,candidate.eventId].join(':');
    if(this.#seen.has(dedupe))
      return {accepted:false,reason:'duplicate_candidate'};
    const family=FAMILIES[candidate.eventType];
    const familyKey=[scope,witness.characterId,family].join(':');
    const characterKey=[scope,witness.characterId].join(':');
    if(now<(this.#characterCooldown.get(characterKey)??0) ||
       now<(this.#familyCooldown.get(familyKey)??0))
      return {accepted:false,reason:'cooldown'};
    const cue=immutableSnapshot({
      kind:'m9_memory_cue_candidate',version:1,
      cueId:id(['M9-CUE',dedupe,witness.journalRecordId]),
      eventId:candidate.eventId,eventType:candidate.eventType,
      family,characterId:witness.characterId,
      protagonistKey:witness.protagonistKey,
      worldProfileId:witness.worldProfileId,timelineId:witness.timelineId,
      hostRunId:candidate.hostRunId,nativeRun:candidate.nativeRun,
      worldEpoch:candidate.worldEpoch,playerCaptureRef:candidate.playerCaptureRef,
      observationId:witness.observationId,
      witnessReceiptId:witness.witnessReceiptId,
      journalRecordId:witness.journalRecordId,
      observerCaptureRef:witness.observerCaptureRef,
      proposedAtMonotonicMs:now,
      expiresAtMonotonicMs:Math.min(Number.MAX_SAFE_INTEGER,now+2000),
      requiresDirectorAdmission:true,
      // Nothing here authorizes spontaneous speech or materializes a fact.
      spokenText:null
    });
    this.#seen.add(dedupe);this.#order.push(dedupe);
    while(this.#order.length>M9_CUE_LIMITS.maxDedupe)
      this.#seen.delete(this.#order.shift());
    this.#characterCooldown.set(characterKey,now+M9_CUE_LIMITS.perCharacterCooldownMs);
    this.#familyCooldown.set(familyKey,now+M9_CUE_LIMITS.perFamilyCooldownMs);
    // Expired cooldown entries are trimmed to bound memory on long sessions.
    for(const map of [this.#characterCooldown,this.#familyCooldown])
      for(const [key,until] of map)if(until<=now)map.delete(key);
    return {accepted:true,cue};
  }
}
