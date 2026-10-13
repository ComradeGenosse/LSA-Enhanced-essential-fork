import {selectDirectorIntent,DIRECTOR_SPEECH_LIMITS} from './sceneDirector.mjs';
import {traceCode} from '../observability/traceCode.mjs';

// A decision key is selectable for at most routineCandidateTtlMs after its
// observation revision was stored (selectDirectorIntent enforces the age), so
// remembering an attempted key for 6x that window is exact replay protection.
// The former ten-minute memory let 128 attempts fail-close the pump for up to
// ten minutes. The native and companion admission ledgers stay authoritative.
export const DIRECTOR_PUMP_SEEN_TTL_MS=DIRECTOR_SPEECH_LIMITS.routineCandidateTtlMs*6;
// Pure pacing vetoes are retried while the original evidence is still fresh;
// they never consume the original PS3 decision. Every other outcome is final.
const PACING_DEFERRALS=new Set(['ticket_already_active','rate_limited','scene_or_speaker_cooldown']);
// One-way correlation code of the original native event signal behind a
// proposal; the same code is logged by perception_trace and the native log.
export function proposalTraceCode(proposal,candidates) {
  const candidate=(candidates||[]).find(c=>c?.observation?.observationId===proposal?.observationId &&
    c.observation.revision===proposal.observationRevision);
  const signalId=candidate?.observation?.claims?.find(c=>c?.certainty==='supported' &&
    c.evidence?.channel!=='report' && typeof c.details?.eventSignalId==='string')?.details?.eventSignalId;
  return traceCode(signalId)??null;
}

// Bounded companion-side source adapter. Runs only when the authenticated PS
// pipeline changes; it never scans GTA, drives kb, creates turns, or fabricates
// source receipts. The coordinator owns all native and stock admission gates.
export class DirectorObservationPump {
  constructor({client,coordinator,now=()=>client.runtime.now(),stampFor=()=>null,onResult=()=>{},onDiagnostic=()=>{}}={}) {
    if(!client?.runtime || typeof coordinator?.attempt!=='function' ||
       typeof now!=='function' || typeof stampFor!=='function' ||
       typeof onResult!=='function' || typeof onDiagnostic!=='function')throw new TypeError('director_pump_dependencies');
    this.client=client;this.coordinator=coordinator;
    this.now=now;this.stampFor=stampFor;this.onResult=onResult;this.onDiagnostic=onDiagnostic;this.lastDiagnostic=null;
    this.seen=new Map();this.epoch=null;this.world=null;this.inFlight=false;this.stopped=false;
  }
  stop() {this.stopped=true;this.seen.clear();}
  diagnose(reason) {
    const at=this.now();
    if(this.lastDiagnostic?.reason===reason &&
       Number.isFinite(at) && at>=this.lastDiagnostic.at &&
       at-this.lastDiagnostic.at<10000)return;
    this.lastDiagnostic={reason,at};
    try{this.onDiagnostic(Object.freeze({reason}));}catch{}
  }
  // Diagnostic-only read of the existing current native source proofs.
  stampVetoReason(proposal) {
    const runtime=this.client.runtime, owner=runtime.directorOwnerProofFor(proposal.speakerCaptureRef);
    if(!owner)return 'owner_proof_unavailable';
    const priority=runtime.directorPriority,now=this.now();
    if(!priority)return 'player_priority_missing';
    if(!priority.experimentalEnabled)return 'native_director_not_enabled';
    if(!Number.isSafeInteger(priority.playerTurnVersion) ||
       priority.playerTurnVersion<0 || !Number.isSafeInteger(priority.receivedAt))
      return 'player_priority_invalid';
    if(now<priority.receivedAt || now-priority.receivedAt>1500)return 'player_priority_stale';
    if(priority.hostRunId!==owner.hostRunId ||
       priority.worldEpoch!==owner.worldEpoch)return 'player_priority_host_mismatch';
    if(!runtime.current(proposal.playerCaptureRef))return 'player_anchor_unavailable';
    return null;
  }
  // The original P2 source supplies ownership; the native Core read supplies
  // the actual current player-turn revision. No JS zero/quiet fallback.
  currentStamp(proposal) {
    if(this.stampVetoReason(proposal))return null;
    const runtime=this.client.runtime,priority=runtime.directorPriority;
    const owner=runtime.directorOwnerProofFor(proposal.speakerCaptureRef);
    return Object.freeze({...owner,
      playerCaptureRef:proposal.playerCaptureRef,
      playerTurnVersion:priority.playerTurnVersion,
      policyVersion:proposal.policyVersion});
  }
  async tick() {
    if(this.stopped || this.inFlight)return null;
    const runtime=this.client.runtime,epoch=runtime.epoch;
    const world=runtime.hostContext?.worldEpoch??null;
    if(epoch!==this.epoch || world!==this.world){
      this.seen.clear();this.epoch=epoch;this.world=world;
    }
    if(!epoch || runtime.directorRequestVersion!==1){this.diagnose('channel_or_protocol_unavailable');return null;}
    // A silent native owner fiber (text entry, pause) can still hold leases,
    // but it can never be the basis of NEW speech authority.
    if(typeof runtime.stalled==='function' && runtime.stalled()){this.diagnose('native_owner_stalled');return null;}
    const players=[...runtime.anchors.values()].filter(a=>a.kind==='player' && runtime.current(a.captureRef));
    if(players.length!==1){this.diagnose('player_anchor_unavailable');return null;}
    const player=players[0].captureRef,now=this.now();
    if(!Number.isSafeInteger(now) || now<0)return null;
    // Expire old attempted decisions; extended sessions must not permanently
    // exhaust a bounded 128-entry de-duplication table.
    for(const [key,at] of this.seen)if(at<=now-DIRECTOR_PUMP_SEEN_TTL_MS)this.seen.delete(key);
    // Native observer membership and P2 owner lifetime are prerequisite
    // evidence. Never infer ownership from the latest conversation target.
    const eligible=[];
    let owned=0,sourceOwners=0,ps3Candidates=0;
    for(const [speaker,index] of runtime.observerIndex) {
      if(eligible.length>=16)break;
      if(!index?.owned || index.kind!=='ped' || !runtime.current(speaker))continue;
      owned++;
      if(!runtime.directorOwnerProofFor(speaker))continue;
      sourceOwners++;
      const candidates=runtime.directorCandidatesFor(speaker);
      ps3Candidates+=candidates.length;
      const facts={speakerCaptureRef:speaker,playerCaptureRef:player,nowMonotonicMs:now};
      const proposal=selectDirectorIntent(candidates,facts);
      if(!proposal || this.seen.has(proposal.decisionKey))continue;
      eligible.push({speaker,candidates,facts,proposal});
    }
    eligible.sort((a,b)=>(b.proposal.urgency==='urgent')-(a.proposal.urgency==='urgent') ||
      a.proposal.expiresAtMonotonicMs-b.proposal.expiresAtMonotonicMs ||
      a.proposal.observationId.localeCompare(b.proposal.observationId));
    // Read-only pacing pre-check (identical to reserve()'s synchronous pacing
    // gates). A cooldown/rate/active-ticket veto defers the proposal without
    // spending its key; previously the key was burned before the attempt.
    let selected=null,deferred=null;
    for(const item of eligible){
      let pacing=null;
      try {pacing=this.coordinator.pacingVeto?.(item.proposal)??null;}catch{pacing=null;}
      if(pacing==='decision_already_attempted'){this.seen.set(item.proposal.decisionKey,now);continue;}
      if(PACING_DEFERRALS.has(pacing)){deferred??=pacing;continue;}
      selected=item;break;
    }
    if(!selected){
      this.diagnose(deferred?'deferred_'+deferred:!owned?'no_owned_observer':!sourceOwners?'owner_proof_unavailable':
        !ps3Candidates?'no_ps3_response_candidate':'candidate_filtered');
      return null;
    }
    // An attempted original decision key is spent for this producer epoch.
    // Capacity exhaustion is a veto, never implicit eviction/retry.
    if(this.seen.size>=128){this.diagnose('dedupe_capacity');return null;}
    this.seen.set(selected.proposal.decisionKey,now);
    this.inFlight=true;
    const trace=proposalTraceCode(selected.proposal,selected.candidates);
    try {
      let stamp=null;
      try {stamp=this.stampFor(selected.proposal,selected.facts);}catch{}
      if(!stamp)this.diagnose(this.stampVetoReason(selected.proposal)??'stamp_provider_unavailable');
      const outcome=await this.coordinator.attempt({
        candidates:selected.candidates,facts:selected.facts,stamp,
      });
      // A missing stamp previously appeared as a misleading PS3 grant failure.
      // Preserve the coordinator's status and execution behavior.
      const diagnosticReason=outcome?.status==='original_ps3_unavailable' ?
        (stamp?'original_ps3_entitlement_unverified':'stamp_unavailable'):null;
      try {this.onResult(Object.freeze({...outcome,...(diagnosticReason?{diagnosticReason}:{}),
        traceCode:trace,urgency:selected.proposal.urgency}));}catch{}
      return outcome;
    } catch {
      const result=Object.freeze({status:'producer_failed',traceCode:trace});
      try {this.onResult(result);}catch{}
      return result;
    } finally {this.inFlight=false;}
  }
}
