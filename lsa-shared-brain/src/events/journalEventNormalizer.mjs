// M3: host-neutral normalization of authenticated PS2 observations.
// The recorder owns authorization. This pure mapper NEVER upgrades an unverified
// observation, guessed subject or native candidate into remembered world fact.
import { createHash } from 'node:crypto';
import { isUuid, immutableSnapshot } from '../util/identity.mjs';

const UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const CHANNELS = new Set(['self','visual','auditory','report']);
const BASES = {
  self: new Set(['native_callback','sampled_state']),
  visual: new Set(['sampled_state','native_awareness']),
  auditory: new Set(['native_awareness','audibility_model']),
  report: new Set(['dialogue_report']),
};
const TYPES = new Set(['firing_burst','injury','death_seen','body_found','threat',
  'vehicle_impact','action_observed','location_changed','activity_changed',
  'vehicle_transition','character_present','speech_heard','radio_heard','report']);
const CLAIMS = new Set(['sound','firing','injured','dead','attack','location','action','presence','report']);
const nonNegative = value => Number.isSafeInteger(value) && value >= 0;
const uuidV4FromHash = hash => {
  const b = Buffer.from(hash.slice(0,32),'hex');
  b[6] = b[6] & 0x0f | 0x40;
  b[8] = b[8] & 0x3f | 0x80;
  const h=b.toString('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
function canonical(value) {
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export const evidenceHash = value => createHash('sha256').update(JSON.stringify(canonical(value)),'utf8').digest('hex');
const validUtc = x => typeof x==='string' && UTC.test(x) && Number.isFinite(Date.parse(x));
const ref = x => x && typeof x==='object' && isUuid(x.captureRef) && ['ped','player','vehicle'].includes(x.kind);
const isClaim = c => {
  if(!c || !isUuid(c.claimId) || !CLAIMS.has(c.kind) || !['supported','uncertain'].includes(c.certainty) ||
     !c.evidence || !CHANNELS.has(c.evidence.channel) || !BASES[c.evidence.channel].has(c.evidence.basis) ||
     !nonNegative(c.evidence.sampledGameTick) || c.evidence.sampledGameTick>0xffffffff ||
     (c.source!==undefined && !ref(c.source)) || (c.target!==undefined && !ref(c.target))) return false;
  if(c.evidence.channel==='report') return isUuid(c.evidence.reportRef);
  return c.evidence.reportRef===undefined;
};
const sameProof = (a,b) => a && b && a.ownerAlias===b.ownerAlias &&
  a.incarnationId===b.incarnationId && a.encounterId===b.encounterId &&
  a.hostRunId===b.hostRunId && a.worldEpoch===b.worldEpoch &&
  a.observerCaptureRef===b.observerCaptureRef;
export function validOwnerProof(value) {
  return !!value && typeof value.ownerAlias==='string' && value.ownerAlias.length>0 && value.ownerAlias.length<=100 &&
    ['incarnationId','encounterId','hostRunId','observerCaptureRef'].every(k=>isUuid(value[k])) &&
    nonNegative(value.worldEpoch);
}
export function samePhysicalOwner(a,b) { return validOwnerProof(a) && validOwnerProof(b) && sameProof(a,b); }
export function validatePs2MemoryInput(observation, identity) {
  if(!identity || !identity.promoted || !identity.current || !isUuid(identity.characterId) ||
     !isUuid(identity.worldProfileId) || !isUuid(identity.timelineId) ||
     !isUuid(identity.adapterEpoch) || !validOwnerProof(identity.ownerProof)) return 'unverified_owner';
  if(!observation || observation.version!==1 || !isUuid(observation.observationId) ||
     !isUuid(observation.episodeId) || !nonNegative(observation.revision) || observation.revision<1 ||
     !TYPES.has(observation.eventType) || !observation.observer ||
     observation.observer.kind!=='ped' || observation.observer.captureRef!==identity.ownerProof.observerCaptureRef ||
     !observation.observedAt || observation.observedAt.nativeRun!==identity.adapterEpoch ||
     !nonNegative(observation.observedAt.gameTick) || observation.observedAt.gameTick>0xffffffff ||
     !validUtc(observation.observedAt.receivedUtc) ||
     !Array.isArray(observation.claims) || !observation.claims.length || observation.claims.length>4 ||
     !observation.claims.every(isClaim) || new Set(observation.claims.map(c=>c.claimId)).size!==observation.claims.length)
    return 'invalid_ps2_observation';
  // An uncertain claim stays uncertain; a report can NEVER turn into firsthand evidence.
  if(observation.eventType==='report' && observation.claims.some(c=>c.evidence.channel!=='report')) return 'report_modality_mismatch';
  return null;
}
function subjectFor(claim, identity, participantProofs) {
  const observer=identity.ownerProof.observerCaptureRef;
  if(claim.evidence.channel==='self' && [claim.source?.captureRef,claim.target?.captureRef].includes(observer))
    return `character:${identity.characterId}`;
  for(const actor of [claim.target,claim.source]) {
    if(!actor) continue;
    if(actor.captureRef===observer) return `character:${identity.characterId}`;
    const verified=participantProofs.find(p=>p?.captureRef===actor.captureRef && p.verified===true &&
      p.hostRunId===identity.ownerProof.hostRunId && p.worldEpoch===identity.ownerProof.worldEpoch &&
      p.adapterEpoch===identity.adapterEpoch);
    if(!verified) continue;
    if(verified.subjectKind==='character' && isUuid(verified.subjectKey)) return `character:${verified.subjectKey}`;
    if(verified.subjectKind==='protagonist' && ['franklin','michael','trevor'].includes(verified.subjectKey))
      return `protagonist:${verified.subjectKey}`;
  }
  // A scene-local unresolved marker is NOT a durable ped/player identity.
  return `unresolved:${claim.claimId}`;
}
export function normalizeWitnessedObservation({observation,identity,participantProofs=[],prePromotionProof=null}={}) {
  const reason=validatePs2MemoryInput(observation,identity);
  if(reason) return Object.freeze({accepted:false,reason});
  if(!Array.isArray(participantProofs) || participantProofs.length>16 ||
     new Set(participantProofs.map(p=>p?.captureRef)).size!==participantProofs.length ||
     participantProofs.some(p=>!p || !isUuid(p.captureRef) || p.verified!==true ||
       p.hostRunId!==identity.ownerProof.hostRunId || p.worldEpoch!==identity.ownerProof.worldEpoch ||
       p.adapterEpoch!==identity.adapterEpoch ||
       !(['character','protagonist'].includes(p.subjectKind)) ||
       (p.subjectKind==='character'?!isUuid(p.subjectKey):!['franklin','michael','trevor'].includes(p.subjectKey))) ||
     prePromotionProof!==null && !samePhysicalOwner(identity.ownerProof,prePromotionProof))
    return Object.freeze({accepted:false,reason:'provenance_mismatch'});
  const claims=observation.claims.map(c=>Object.freeze({
    kind:c.kind,
    modality:c.evidence.channel,
    certainty:c.evidence.channel==='report' ? 'reported' : c.certainty==='supported' ? 'direct':'unknown',
    durableSubject:subjectFor(c,identity,participantProofs),
    sourceEvidenceId:c.claimId,
  }));
  const material={
    observation, identity:{
      characterId:identity.characterId, worldProfileId:identity.worldProfileId,
      timelineId:identity.timelineId, ownerProof:identity.ownerProof, adapterEpoch:identity.adapterEpoch
    },participantProofs,prePromotionProof
  };
  const sourceHash=evidenceHash(material);
  const recordId=uuidV4FromHash(evidenceHash(['M3',identity.worldProfileId,identity.timelineId,
    identity.characterId,observation.observationId,observation.revision]));
  const event=immutableSnapshot({
    version:1,characterId:identity.characterId,worldProfileId:identity.worldProfileId,
    timelineId:identity.timelineId,kind:'journal_event',recordId,
    observationId:observation.observationId,revision:observation.revision,
    eventType:observation.eventType,receivedAtUtc:observation.observedAt.receivedUtc,
    sourceHash,ownerProof:identity.ownerProof,
    receiptStatus:claims.every(c=>c.modality==='report')?'reported':'witnessed',claims,
  });
  // Store this sidecar atomically with event in M2's journal API. No fields may
  // be added to memory.v1.json's strict journalEvent top-level.
  const sourceEvidence=immutableSnapshot({
    format:'ps2-observation-v1',sourceHash,observation,
    nativeAdapterEpoch:identity.adapterEpoch,ownerProof:identity.ownerProof,
    participantProofs,prePromotionProof,coverage:{status:'matched',returnedCount:claims.length,matchedCount:claims.length},
  });
  return Object.freeze({accepted:true,event,sourceEvidence});
}

// Strict bidirectional parity: the event must be EXACTLY the interpretation
// deterministically derived from the immutable PS2 source evidence, including
// type, receipt status, every claim, modality, actor and original timestamp.
// Used on fresh intake and by M3-specific read/verification adapters. M2's
// database-side source hash remains an independent tamper check.
export function verifyM3DerivedEvent(event,sourceEvidence) {
  if(!event||!sourceEvidence||sourceEvidence.format!=='ps2-observation-v1')
    return Object.freeze({valid:false,reason:'m3_evidence_missing'});
  const identity={
    promoted:true,current:true,characterId:event.characterId,
    worldProfileId:event.worldProfileId,timelineId:event.timelineId,
    adapterEpoch:sourceEvidence.nativeAdapterEpoch,ownerProof:sourceEvidence.ownerProof,
  };
  const derived=normalizeWitnessedObservation({
    observation:sourceEvidence.observation,identity,
    participantProofs:sourceEvidence.participantProofs,
    prePromotionProof:sourceEvidence.prePromotionProof??null
  });
  if(!derived.accepted)return Object.freeze({valid:false,reason:derived.reason});
  if(JSON.stringify(event)!==JSON.stringify(derived.event)||
     JSON.stringify(sourceEvidence)!==JSON.stringify(derived.sourceEvidence))
    return Object.freeze({valid:false,reason:'m3_derived_claim_mismatch'});
  return Object.freeze({valid:true});
}
