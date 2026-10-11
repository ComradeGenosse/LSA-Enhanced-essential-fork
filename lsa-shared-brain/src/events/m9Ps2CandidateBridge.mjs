// M9 -> PS2, never M9 -> M3/SQLite: this bridge only proposes an
// explicitly versioned native event for PS2's separately source-proven
// observer qualification. Current PS2 wire v1 does NOT admit this payload.
// K must install a compatible native producer + strict correlator first.
import {isUuid,immutableSnapshot} from '../util/identity.mjs';

const EVENTS=new Set(['vehicle_crash','vehicle_rollover','airborne_stunt',
  'vehicle_entered_water','vehicle_submerged','wanted_level_changed',
  'wasted','busted']);
const valid=c=>c?.kind==='m9_candidate' && isUuid(c.eventId) &&
  EVENTS.has(c.eventType) && isUuid(c.nativeEvidenceId)===false &&
  typeof c.nativeEvidenceId==='string' && c.nativeEvidenceId.length>0 &&
  c.nativeEvidenceId.length<=80 && isUuid(c.nativeRun) &&
  isUuid(c.hostRunId) && isUuid(c.playerCaptureRef) &&
  (c.participantCaptureRef===null || isUuid(c.participantCaptureRef)) &&
  Number.isSafeInteger(c.worldEpoch) && c.worldEpoch>=0 &&
  Number.isSafeInteger(c.gameTick) && c.gameTick>=0 &&
  Number.isSafeInteger(c.observedAtMonotonicMs) &&
  c.observedAtMonotonicMs>=0 && c.requiresPs2WitnessReceipt===true;

// The bridge requires a synchronous native authority and an explicitly
// installed PS2 M9 admission port. It NEVER manufactures a PS2 Observation,
// a witness receipt, a journal record, a no-witness outcome or a memory.
export class M9Ps2CandidateBridge {
  #verify;#submit;#now;#scope=null;#seen=new Set();#order=[];
  constructor({verifyNativeCandidate,submitForPs2Qualification,now}={}) {
    if(typeof verifyNativeCandidate!=='function' ||
       typeof submitForPs2Qualification!=='function' ||
       typeof now!=='function')throw new TypeError('m9_ps2_authority_ports_required');
    this.#verify=verifyNativeCandidate;this.#submit=submitForPs2Qualification;
    this.#now=now;
  }
  reset(){this.#seen.clear();this.#order=[];this.#scope=null;}
  submit({candidate,nativeReceipt}={}) {
    const now=this.#now();
    if(!valid(candidate) || !Number.isSafeInteger(now) ||
      now<candidate.observedAtMonotonicMs ||
      now-candidate.observedAtMonotonicMs>3000)
      return {accepted:false,reason:'invalid_or_stale_candidate'};
    // An independent current native ledger must verify exact event receipt
    // and run/world/player capture, not just the candidate's own UUIDs.
    let verified=false;
    try {verified=this.#verify({candidate,nativeReceipt})===true;}
    catch {}
    if(!verified)return {accepted:false,reason:'native_event_unverified'};
    const scope=[candidate.nativeRun,candidate.hostRunId,
      candidate.worldEpoch,candidate.playerCaptureRef].join(':');
    if(this.#scope!==null && this.#scope!==scope)this.reset();
    this.#scope=scope;
    const key=scope+':'+candidate.eventId;
    if(this.#seen.has(key))return {accepted:false,reason:'duplicate_candidate'};
    const envelope=immutableSnapshot({
      type:'m9.ps2_qualification_request',version:1,
      candidateEventId:candidate.eventId,eventType:candidate.eventType,
      nativeEvidenceId:candidate.nativeEvidenceId,
      nativeRun:candidate.nativeRun,hostRunId:candidate.hostRunId,
      worldEpoch:candidate.worldEpoch,gameTick:candidate.gameTick,
      observedAtMonotonicMs:candidate.observedAtMonotonicMs,
      playerCaptureRef:candidate.playerCaptureRef,
      participantCaptureRef:candidate.participantCaptureRef,
      evidence:candidate.evidence,
      // PS2 must independently prove each promoted observer; no claims here.
      observers:null,coverage:'unknown',memoryCommitted:false
    });
    let receipt;
    try {receipt=this.#submit(envelope);}
    catch {return {accepted:false,reason:'ps2_qualification_port_failed'};}
    if(receipt?.status!=='accepted_for_qualification' ||
       receipt.candidateEventId!==candidate.eventId ||
       receipt.grantsWitness===true || receipt.memoryCommitted===true)
      return {accepted:false,reason:'ps2_qualification_unavailable'};
    this.#seen.add(key);this.#order.push(key);
    while(this.#order.length>512)this.#seen.delete(this.#order.shift());
    return {accepted:true,status:'pending_ps2_witness_qualification',
      candidateEventId:candidate.eventId};
  }
}
