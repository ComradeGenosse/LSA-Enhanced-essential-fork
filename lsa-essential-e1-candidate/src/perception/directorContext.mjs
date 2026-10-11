// A short, immutable PS2/PS3 event rendering for Essential's existing
// SpecialGeminiTurnRequest.Content field (160 UTF-16 code units maximum).
// Never put arbitrary NPC dialogue, player transcript or report text here.
// Stock Essential retains its original character/personality/knowledge context.
const EVENT={
  firing_burst:'gunfire',injury:'someone injured',death_seen:'a witnessed death',
  body_found:'a body found',threat:'a nearby threat',
  vehicle_impact:'a vehicle impact',action_observed:'an observed action',
  location_changed:'a location change',activity_changed:'an activity change',
  vehicle_transition:'a vehicle movement',character_present:'someone nearby',
  speech_heard:'speech overheard',report:'a reported event',
};
const CLAIM=new Set(['sound','firing','injured','dead','attack','location','action','presence']);
const CHANNEL=new Set(['self','visual','auditory']);
const SEVERITY=new Set(['routine','notable','danger','critical']);

export function renderDirectorEventContext(proposal,candidates,verifiedPlayerCaptureRef=null) {
  if(!proposal || !Array.isArray(candidates))return null;
  const pair=candidates.find(c=>c?.observation?.observationId===proposal.observationId &&
    c.observation.revision===proposal.observationRevision &&
    c.decision?.decisionKey===proposal.decisionKey &&
    c.decision.policyVersion===proposal.policyVersion);
  const observation=pair?.observation;
  if(!observation || !Object.hasOwn(EVENT,observation.eventType) ||
     !SEVERITY.has(observation.severity) ||
     !Array.isArray(observation.claims))return null;
  const claim=observation.claims.find(c=>c?.certainty==='supported' &&
    CLAIM.has(c.kind) && CHANNEL.has(c.evidence?.channel));
  if(!claim)return null;
  const playerFired=observation.eventType==='firing_burst' &&
    claim.kind==='firing' && claim.evidence.channel==='visual' &&
    claim.source?.kind==='player' && claim.source.captureRef===verifiedPlayerCaptureRef;
  const event=playerFired?'the player firing a gun':EVENT[observation.eventType];
  const source=claim.evidence.channel==='self'?'personally experienced':
    claim.evidence.channel==='visual'?'seen':'heard';
  const detail=claim.kind==='action' && ['followtarget','waithere'].includes(claim.details?.action)
    ? ', action '+claim.details.action :
    claim.kind==='location' && /^[A-Z0-9_]{1,16}$/.test(claim.details?.location)
      ? ', location '+claim.details.location : '';
  const context=`${playerFired?'You saw':'You '+source} ${event} (${observation.severity}, ${claim.kind}${detail}). React briefly in character to this event; dialogue only, no actions.`;
  return context.length<=160 && !/[\r\n\t\0]/.test(context)?context:null;
}
