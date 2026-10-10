import {readPrimaryBehaviorOwner} from '../context/primaryBehaviorOwner.mjs';
import { isUuid } from '../identity/identityContract.mjs';
import { validateHostEnvelope, validateWorldEpoch } from '../context/hostContext.mjs';

export const BOUNDS = Object.freeze({ observers:16, anchors:256, rawSignals:256, criticalReserve:64, nativeFrames:64, companionFrames:256, frameBytes:8192, observationsPerObserver:128, observations:2048, observationBytes:2*1024*1024, signalTtlMs:30000, anchorLeaseMs:3000 });
export const CAPABILITIES = Object.freeze(['snapshot','pedDamage','playerDamage','vehicleDamage','shooting','state','action','playback','witness','awareness','playerSpeech']);
export const PRODUCERS = new Set(['ped_damage','player_damage','vehicle_damage','shooting','state','action','playback']);
export function normalizePerceptionConfig(value = {}) {
  // Future modes cannot enable anything beyond this implementation.
  const valid = value && typeof value === 'object' && !Array.isArray(value);
  const mode = valid && value.mode === 'shadow' ? 'shadow' : 'off';
  const pipeName = valid && typeof value.pipeName === 'string' ? value.pipeName : 'LSA.Intelligence.v1';
  return Object.freeze({ mode, pipeName: /^[A-Za-z0-9_.-]{1,80}$/.test(pipeName) ? pipeName : 'LSA.Intelligence.v1' });
}
const integer = (v, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const optionalRef = v => v === null || isUuid(v);
const keys = (v, required, optional=[]) => v!==null && typeof v==='object' && !Array.isArray(v) && required.every(k=>Object.hasOwn(v,k)) && Object.keys(v).every(k=>required.includes(k)||optional.includes(k));
const label = v => typeof v === 'string' && /^[a-z][a-z0-9_]{0,47}$/.test(v);
const position = v => keys(v,['x','y','z']) && Object.values(v).every(n=>Number.isFinite(n) && Math.abs(n)<=100000);
export function validateSignal(s) {
  if (!keys(s,['signalId','producer','producerSequence','kind','target','source','gameTick','ageMs','facts'],['witnessReceipts','incidentKey']) || !isUuid(s.signalId) || !PRODUCERS.has(s.producer) || !integer(s.producerSequence) || s.producerSequence===0 || !optionalRef(s.target) || !optionalRef(s.source) || !integer(s.gameTick,0xffffffff) || !integer(s.ageMs,30000) || s.incidentKey!==undefined && !isUuid(s.incidentKey) || s.witnessReceipts!==undefined && (!Array.isArray(s.witnessReceipts) || s.witnessReceipts.length>16 || !s.witnessReceipts.every(validateWitnessReceipt) || new Set(s.witnessReceipts.map(r=>r.observer.captureRef)).size!==s.witnessReceipts.length)) return false;
  const f = s.facts;
  if (s.kind==='damage' || s.kind==='vehicle_damage') return (s.kind==='vehicle_damage' ? s.producer==='vehicle_damage' : ['ped_damage','player_damage'].includes(s.producer)) && keys(f,['damage','armour','classification'],['collision']) && integer(f.damage,100000) && integer(f.armour,100000) && ['unknown','bullet','melee','stun','explosion','collision','fire'].includes(f.classification) && (!Object.hasOwn(f,'collision') || s.kind==='vehicle_damage' && position(f.collision));
  if (s.kind==='firing') return s.producer==='shooting' && isUuid(s.source) && keys(f,[]);
  if (s.kind==='death') return s.producer==='state' && isUuid(s.target) && keys(f,[]);
  if (s.kind==='injury_state') return s.producer==='state' && isUuid(s.target) && keys(f,['health','armour','injured']) && integer(f.health,100000) && integer(f.armour,100000) && typeof f.injured==='boolean';
  if (s.kind==='vehicle_transition') return s.producer==='state' && isUuid(s.target) && keys(f,['vehicle','driver']) && optionalRef(f.vehicle) && typeof f.driver==='boolean';
  if (s.kind==='vehicle_state') return s.producer==='state' && isUuid(s.target) && keys(f,['engine','healthBand','speedBand','driver']) && typeof f.engine==='boolean' && integer(f.healthBand,10) && integer(f.speedBand,10) && optionalRef(f.driver);
  if (['activity_changed','presence_changed','location_changed'].includes(s.kind)) {
    const field = s.kind.split('_')[0];
    return s.producer==='state' && isUuid(s.target) && keys(f,[field]) && (field==='location' ? typeof f[field]==='string' && /^[A-Z0-9_]{1,16}$/.test(f[field]) : label(f[field]));
  }
  if (s.kind==='action_callback') return s.producer==='action' && isUuid(s.target) && keys(f,['action','succeeded']) && ['followtarget','waithere','other'].includes(f.action) && typeof f.succeeded==='boolean';
  if (s.kind==='playback_started' || s.kind==='playback_ended') return s.producer==='playback' && keys(f,['interrupted','hadAudio']) && typeof f.interrupted==='boolean' && typeof f.hadAudio==='boolean';
  return false;
}
export function validateWitnessReceipt(r) {
  return keys(r,['observer','sampledGameTick','status','reason','evidence'],['knowsSource','knowsTarget']) && keys(r.observer,['captureRef','kind']) && isUuid(r.observer.captureRef) && r.observer.kind==='ped' && integer(r.sampledGameTick,0xffffffff) && ['witnessed','did_not_witness','reported','unknown'].includes(r.status) && label(r.reason) && keys(r.evidence,['channel','basis','sampledGameTick'],['reportRef']) && ['self','visual','auditory','report'].includes(r.evidence.channel) && ['native_callback','sampled_state','native_awareness','audibility_model','dialogue_report'].includes(r.evidence.basis) && integer(r.evidence.sampledGameTick,0xffffffff) && r.evidence.sampledGameTick===r.sampledGameTick && (r.evidence.reportRef===undefined || r.evidence.channel==='report' && isUuid(r.evidence.reportRef)) && ['knowsSource','knowsTarget'].every(k=>r[k]===undefined||typeof r[k]==='boolean') && ((r.status==='witnessed' && r.evidence.channel!=='report' && r.evidence.reportRef===undefined) || (r.status==='reported' && r.evidence.channel==='report' && isUuid(r.evidence.reportRef)) || (r.status!=='witnessed' && r.status!=='reported' && r.evidence.channel!=='report' && r.evidence.reportRef===undefined));
}
export function validateObserverIndex(row) {
  return keys(row,['captureRef','kind','owned'],['encounterId','incarnationId']) && isUuid(row.captureRef) && ['ped','player','vehicle'].includes(row.kind) && typeof row.owned==='boolean' &&
    (Object.hasOwn(row,'encounterId')===Object.hasOwn(row,'incarnationId')) &&
    (!Object.hasOwn(row,'encounterId') || row.owned && row.kind==='ped' && isUuid(row.encounterId) && isUuid(row.incarnationId));
}
export function validateFrame(v) {
  if (!v || Buffer.byteLength(JSON.stringify(v))>BOUNDS.frameBytes) return false;
  if (v.type==='hello') return validateHostEnvelope(v,['version','type','adapterEpoch','streamId','capabilities',...(Object.hasOwn(v,'observerIndexVersion') ? ['observerIndexVersion'] : []),...(Object.hasOwn(v,'observerSituationVersion') ? ['observerSituationVersion'] : []),...(Object.hasOwn(v,'primaryBehaviorOwnerVersion') ? ['primaryBehaviorOwnerVersion'] : []),...(Object.hasOwn(v,'directorRequestVersion') ? ['directorRequestVersion'] : [])]) && (!Object.hasOwn(v,'observerIndexVersion') || v.hostContextVersion===1 && v.observerIndexVersion===1) && (!Object.hasOwn(v,'observerSituationVersion') || v.hostContextVersion===1 && v.observerIndexVersion===1 && v.observerSituationVersion===1) && (!Object.hasOwn(v,'primaryBehaviorOwnerVersion') || v.observerSituationVersion===1 && v.primaryBehaviorOwnerVersion===1) && (!Object.hasOwn(v,'directorRequestVersion') || v.hostContextVersion===1 && v.directorRequestVersion===1) && v.version===1 && isUuid(v.adapterEpoch) && isUuid(v.streamId) && keys(v.capabilities,CAPABILITIES) && Object.values(v.capabilities).every(x=>typeof x==='boolean');
  if (!keys(v,['version','type','adapterEpoch','streamId','sequence','payload']) || v.version!==1 || !isUuid(v.adapterEpoch) || !isUuid(v.streamId) || !integer(v.sequence) || v.sequence===0) return false;
  if (v.type==='anchors') return Array.isArray(v.payload) && v.payload.length<=32 && v.payload.every(a=>keys(a,['captureRef','kind','observer'],['owned','conversation']) && isUuid(a.captureRef) && ['ped','player','vehicle'].includes(a.kind) && typeof a.observer==='boolean' && (!a.observer || a.kind==='ped') && ['owned','conversation'].every(k=>a[k]===undefined || typeof a[k]==='boolean' && (!a[k] || a.kind==='ped'))) && new Set(v.payload.map(a=>a.captureRef)).size===v.payload.length;
  if (v.type==='retire') return keys(v.payload,['captureRef']) && isUuid(v.payload.captureRef);
  if (v.type==='retire_batch') return Array.isArray(v.payload) && v.payload.length<=32 && v.payload.every(isUuid) && new Set(v.payload).size===v.payload.length;
  if (v.type==='observer_situation') return Array.isArray(v.payload) && v.payload.length<=32 && v.payload.every(row=>keys(row,['captureRef','sampledGameTick','activity','situationRevision'],['primaryOwner','ownerProofRevision','ps3Challenge']) && (row.ps3Challenge===undefined || row.ps3Challenge===null || isUuid(row.ps3Challenge) && row.ownerProofRevision>0) && (row.primaryOwner===undefined || row.primaryOwner===null || readPrimaryBehaviorOwner(row.primaryOwner)!==null) && (row.ownerProofRevision===undefined || row.ownerProofRevision===null || integer(row.ownerProofRevision,2147483647) && row.ownerProofRevision>0 && readPrimaryBehaviorOwner(row.primaryOwner)!==null) && isUuid(row.captureRef) && integer(row.sampledGameTick,0xffffffff) && integer(row.situationRevision) && row.situationRevision>0 && ['idle','driving','passenger','in_vehicle','conversation','following','waiting','unknown'].includes(row.activity)) && new Set(v.payload.map(row=>row.captureRef)).size===v.payload.length;
  if (v.type==='observer_index') return Array.isArray(v.payload) && v.payload.length<=32 && v.payload.every(validateObserverIndex) && new Set(v.payload.map(row=>row.captureRef)).size===v.payload.length;
  if (v.type==='world_epoch') return validateWorldEpoch(v.payload);
  if(v.type==='director_priority') return keys(v.payload,['playerTurnVersion','experimentalEnabled']) &&
    integer(v.payload.playerTurnVersion,2147483647) &&
    typeof v.payload.experimentalEnabled==='boolean';
  if(v.type==='director_response') return keys(v.payload,['directorRequestVersion','ticketId','status']) &&
    v.payload.directorRequestVersion===1 && isUuid(v.payload.ticketId) &&
    ['invalid','busy','unsafe','stale','cancelled','not_found','reserved','submitted','bound','started','completed','failed'].includes(v.payload.status);
  if (v.type==='signal') return validateSignal(v.payload);
  if (v.type==='diagnostics') return keys(v.payload,['anchors','observers','snapshotAgeMs','snapshotCadenceMs','dropped','staleRejected','retiredAnchors','deferredDiscovery','updateMicros','capabilities','signals','damageCallbacks','witnessDeferred','witnessUnknown','witnessRejected','playerSpeechGate']) && integer(v.payload.anchors,256) && integer(v.payload.observers,16) && ['snapshotAgeMs','snapshotCadenceMs','dropped','staleRejected','retiredAnchors','deferredDiscovery','updateMicros','witnessDeferred','witnessUnknown','witnessRejected'].every(k=>integer(v.payload[k],2147483647)) && v.payload.playerSpeechGate==='unsupported_capture_receipt' && keys(v.payload.capabilities,CAPABILITIES) && Object.values(v.payload.capabilities).every(x=>typeof x==='boolean') && v.payload.capabilities.playerSpeech===false && v.payload.signals && typeof v.payload.signals==='object' && !Array.isArray(v.payload.signals) && Object.entries(v.payload.signals).every(([k,n])=>['damage','vehicle_damage','firing','death','injury_state','vehicle_transition','vehicle_state','activity_changed','presence_changed','location_changed','action_callback','playback_started','playback_ended'].includes(k) && integer(n,2147483647)) && keys(v.payload.damageCallbacks,['ped_damage','player_damage','vehicle_damage']) && Object.values(v.payload.damageCallbacks).every(n=>integer(n,2147483647));
  return false;
}

// PS0 immutable observer contract. No producer promotes a backend signal to witness knowledge in PS1.
export function validateObservation(o) {
  if (!keys(o,['version','observationId','episodeId','revision','observer','observedAt','expiresAtMonotonicMs','eventType','severity','claims','recognizedCharacterIds'],['position']) || o.version!==1 || !isUuid(o.observationId) || !isUuid(o.episodeId) || !integer(o.revision) || o.revision===0 || !keys(o.observer,['captureRef','kind']) || !isUuid(o.observer.captureRef) || o.observer.kind!=='ped') return false;
  if (!keys(o.observedAt,['nativeRun','gameTick','receivedUtc']) || !isUuid(o.observedAt.nativeRun) || !integer(o.observedAt.gameTick,0xffffffff) || typeof o.observedAt.receivedUtc!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(o.observedAt.receivedUtc) || !Number.isFinite(Date.parse(o.observedAt.receivedUtc)) || !integer(o.expiresAtMonotonicMs) || !['firing_burst','injury','death_seen','body_found','threat','vehicle_impact','action_observed','location_changed','activity_changed','vehicle_transition','character_present','speech_heard','report'].includes(o.eventType) || !['routine','notable','danger','critical'].includes(o.severity) || !Array.isArray(o.claims) || o.claims.length<1 || o.claims.length>4 || !Array.isArray(o.recognizedCharacterIds) || o.recognizedCharacterIds.length!==0 || o.position!==undefined && !position(o.position)) return false;
  return o.claims.every(validateClaim);
}
export function validateClaim(c) {
  if (!keys(c,['claimId','kind','certainty','evidence'],['source','target','details']) || !isUuid(c.claimId) || !['sound','firing','injured','dead','attack','location','action','presence','report'].includes(c.kind) || !['supported','uncertain'].includes(c.certainty) || !['source','target'].every(k=>c[k]===undefined || keys(c[k],['captureRef','kind']) && isUuid(c[k].captureRef) && ['ped','player','vehicle'].includes(c[k].kind)) || !keys(c.evidence,['channel','basis','sampledGameTick'],['reportRef']) || !['self','visual','auditory','report'].includes(c.evidence.channel) || !['native_callback','sampled_state','native_awareness','audibility_model','dialogue_report'].includes(c.evidence.basis) || !integer(c.evidence.sampledGameTick,0xffffffff) || c.evidence.reportRef!==undefined && (c.evidence.channel!=='report' || !isUuid(c.evidence.reportRef))) return false;
  if (c.evidence.channel==='self' && (!['native_callback','sampled_state'].includes(c.evidence.basis) || c.evidence.reportRef!==undefined) || c.evidence.channel==='visual' && (!['sampled_state','native_awareness'].includes(c.evidence.basis) || c.evidence.reportRef!==undefined) || c.evidence.channel==='auditory' && (!['native_awareness','audibility_model'].includes(c.evidence.basis) || c.evidence.reportRef!==undefined) || c.evidence.channel==='report' && (c.evidence.basis!=='dialogue_report' || !isUuid(c.evidence.reportRef))) return false;
  if (c.details===undefined) return true;
  if (c.kind==='injured' && keys(c.details,['damageDelta','armourDelta']) && integer(c.details.damageDelta,100000) && integer(c.details.armourDelta,100000)) return true;
  const provenance=['eventSignalId','reason'];
  if (!isUuid(c.details.eventSignalId) || !label(c.details.reason)) return false;
  if (keys(c.details,provenance)) return true;
  const self=c.evidence.channel==='self',sampled=self && c.evidence.basis==='sampled_state';
  if(c.kind==='injured' && self && c.evidence.basis==='native_callback' && keys(c.details,[...provenance,'damageDelta','armourDelta'])) return integer(c.details.damageDelta,100000) && integer(c.details.armourDelta,100000);
  if(c.kind==='action' && self && c.evidence.basis==='native_callback' && keys(c.details,[...provenance,'action','succeeded'])) return ['followtarget','waithere'].includes(c.details.action) && typeof c.details.succeeded==='boolean';
  if(c.kind==='location' && sampled && keys(c.details,[...provenance,'location'])) return typeof c.details.location==='string' && /^[A-Z0-9_]{1,16}$/.test(c.details.location) && c.details.location!=='UNKNOWN';
  if(c.kind==='presence' && sampled && keys(c.details,[...provenance,'activity'])) return ['in_vehicle','running','walking','stationary'].includes(c.details.activity);
  if(c.kind==='presence' && sampled && keys(c.details,[...provenance,'vehicle','driver'])) return optionalRef(c.details.vehicle) && typeof c.details.driver==='boolean' && (c.details.vehicle!==null || c.details.driver===false);
  return false;
}
