import {selectDirectorIntent,DIRECTOR_SPEECH_LIMITS,PS6_13A_EVENTS} from './sceneDirector.mjs';

const speechTypes=new Set(PS6_13A_EVENTS);
// Pure diagnostic classification only. Never creates witness evidence or a
// Director grant; selection remains exclusively selectDirectorIntent().
export function directorCandidateBlockReason(candidates,facts) {
  if(!Array.isArray(candidates)||!candidates.length)return 'no_ps3_response_candidate';
  const threat=candidates.filter(c=>speechTypes.has(c?.observation?.eventType));
  if(!threat.length)return 'non_13a_event';
  if(threat.every(c=>c.entitlementCurrent!==true))return 'ps3_entitlement_stale';
  const granted=threat.filter(c=>c.entitlementCurrent===true &&
    ['eligible','urgent'].includes(c?.decision?.response));
  if(!granted.length)return 'ps3_response_ineligible';
  if(granted.every(c=>!c.observation?.claims?.some(claim=>
    claim.certainty==='supported'&&['self','visual','auditory'].includes(claim.evidence?.channel))))
    return 'direct_witness_unavailable';
  if(granted.every(c=>!Number.isSafeInteger(c.observedAtMonotonicMs)||
     c.observedAtMonotonicMs>facts?.nowMonotonicMs ||
     c.observation?.expiresAtMonotonicMs<=facts?.nowMonotonicMs ||
     c.decision?.expiresAtMonotonicMs<=facts?.nowMonotonicMs))
    return 'ps3_evidence_expired';
  return 'candidate_filtered';
}
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
    this.seen=new Map();this.socialRetry=new Map();this.epoch=null;this.world=null;this.inFlight=false;this.stopped=false;
  }
  stop() {this.stopped=true;this.seen.clear();this.socialRetry.clear();}
  diagnose(reason,eventType=null) {
    const at=this.now();
    if(this.lastDiagnostic?.reason===reason &&
       this.lastDiagnostic?.eventType===eventType &&
       Number.isFinite(at) && at>=this.lastDiagnostic.at &&
       at-this.lastDiagnostic.at<10000)return;
    this.lastDiagnostic={reason,eventType,at};
    try{this.onDiagnostic(Object.freeze({reason,...(speechTypes.has(eventType)?{eventType}:{})}));}catch{}
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
      this.seen.clear();this.socialRetry.clear();this.lastDiagnostic=null;this.epoch=epoch;this.world=world;
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
    for(const [key,row] of this.socialRetry)
      if(row.at<=now-DIRECTOR_PUMP_SEEN_TTL_MS)this.socialRetry.delete(key);
    // Native observer membership and P2 owner lifetime are prerequisite
    // evidence. Never infer ownership from the latest conversation target.
    const eligible=[];
    let owned=0,sourceOwners=0,ps3Candidates=0,filteredReason=null;
    for(const [speaker,index] of runtime.observerIndex) {
      if(eligible.length>=16)break;
      if(!index?.owned || index.kind!=='ped' || !runtime.current(speaker))continue;
      owned++;
      if(!runtime.directorOwnerProofFor(speaker))continue;
      sourceOwners++;
      const candidates=runtime.directorCandidatesFor(speaker);
      ps3Candidates+=candidates.length;
      // A spent decision must not hide a second, independently granted
      // event for the same speaker. Pass exactly the unattempted slice to
      // both selection and the coordinator's mandatory re-selection.
      const unattempted=candidates.filter(c=>!this.seen.has(c?.decision?.decisionKey));
      if(!unattempted.length)continue;
      const facts={speakerCaptureRef:speaker,playerCaptureRef:player,nowMonotonicMs:now};
      const proposal=selectDirectorIntent(unattempted,facts);
      if(!proposal) {
        // Prefer a concrete PS3 selection reason over generic candidate_filtered.
        // This is diagnostic, never an admission or authority calculation.
        const reason=directorCandidateBlockReason(unattempted,facts);
        if(filteredReason===null || filteredReason==='non_13a_event')filteredReason=reason;
        continue;
      }
      if(this.seen.has(proposal.decisionKey))continue;
      eligible.push({speaker,candidates:unattempted,facts,proposal});
    }
    // Social opportunities originate from authenticated native owner-fiber
    // scene observations. They never need or manufacture a PS3 candidate.
    // Reuse the same owner, player, priority, C-06 and stock speech gates.
    for(const [speaker,index] of runtime.observerIndex) {
      if(eligible.length>=32)break;
      if(!index?.owned || index.kind!=='ped' ||
         !runtime.current(speaker) || !runtime.directorOwnerProofFor(speaker))continue;
      const proposal=runtime.directorSocialFor?.(speaker);
      if(!proposal || proposal.playerCaptureRef!==player ||
         (this.seen.has(proposal.decisionKey) ||
         (this.socialRetry.get(proposal.decisionKey)?.nextAt??0)>now))continue;
      eligible.push({speaker,candidates:[],facts:{
        speakerCaptureRef:speaker,playerCaptureRef:player,nowMonotonicMs:now
      },proposal,social:true});
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
        !ps3Candidates?'no_ps3_response_candidate':filteredReason??'candidate_filtered');
      return null;
    }
    // Event category is a closed, non-identifying diagnostic dimension.
    const eventType=selected.candidates.find(c=>c?.observation?.observationId===
      selected.proposal.observationId && c?.decision?.decisionKey===selected.proposal.decisionKey)
      ?.observation?.eventType;
    // An attempted original decision key is spent for this producer epoch.
    // Capacity exhaustion is a veto, never implicit eviction/retry.
    if(this.seen.size>=128){this.diagnose('dedupe_capacity',eventType);return null;}
    // Missing native player-priority/owner proof is NOT a PS6 attempt.
    // Do not burn a fleeting PS3 entitlement before C-06 can even be asked.
    // Shadow mode stays strictly non-executing and needs no native stamp.
    let stamp=null;
    try {stamp=this.stampFor(selected.proposal,selected.facts);}catch{}
    if(!stamp && this.coordinator.mode!=='shadow') {
      const reason=this.stampVetoReason(selected.proposal)??'stamp_provider_unavailable';
      this.diagnose(reason,eventType);
      const blocked=Object.freeze({status:'not_admitted',diagnosticReason:reason,
        ...(speechTypes.has(eventType)?{eventType}:{})});
      try{this.onResult(blocked);}catch{}
      return blocked;
    }
    // Only now is this original decision considered attempted. All subsequent
    // native/PS3/turn vetoes retain the existing one-shot no-replay behavior.
    this.seen.set(selected.proposal.decisionKey,now);
    this.inFlight=true;
    const trace=proposalTraceCode(selected.proposal,selected.candidates);
    try {
      const outcome=await this.coordinator.attempt({
        candidates:selected.candidates,facts:selected.facts,stamp,
        ...(selected.social?{socialProposal:selected.proposal}:{}),
      });
      // Native BUSY did not claim a source. Permit one delayed recheck while
      // the SAME native scene is still fresh; never retry unsafe or spent
      // native tickets. Source/safety vetoes are also bounded, not spun.
      if(selected.social && (outcome?.status==='native_rejected' && outcome.nativeReason==='busy' ||
          outcome?.status==='not_admitted' &&
          outcome.diagnosticReason==='source_or_safety_veto')) {
        const key=selected.proposal.decisionKey;
        const prior=this.socialRetry.get(key);
        if(!prior || prior.count<1) {
          this.seen.delete(key);
          this.socialRetry.set(key,{count:(prior?.count??0)+1,at:now,nextAt:now+3000});
        }
      }
      // A missing stamp previously appeared as a misleading PS3 grant failure.
      // Preserve the coordinator's status and execution behavior.
      const diagnosticReason=outcome?.status==='original_ps3_unavailable' ?
        (stamp?'original_ps3_entitlement_unverified':'stamp_unavailable'):null;
      try {this.onResult(Object.freeze({...outcome,...(diagnosticReason?{diagnosticReason}:{}),
        traceCode:trace,urgency:selected.proposal.urgency,
        ...(selected.social?{sceneType:selected.proposal.sceneType,source:'social'}:{}),
         ...(speechTypes.has(eventType)?{eventType}:{})}));}catch{}
      return outcome;
    } catch {
      const result=Object.freeze({status:'producer_failed',traceCode:trace,
        ...(speechTypes.has(eventType)?{eventType}:{})});
      try {this.onResult(result);}catch{}
      return result;
    } finally {this.inFlight=false;}
  }
}
