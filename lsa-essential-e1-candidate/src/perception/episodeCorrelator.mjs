import { validateSignal, validateWitnessReceipt, M9_EVENT_TYPES } from './contracts.mjs';
import { isUuid } from '../identity/identityContract.mjs';
import { randomUUID, createHash } from 'node:crypto';
import { witnessedBulletAttribution } from './contextualBallistics.mjs';

const EVENT = Object.freeze({
  firing: ['firing_burst', 'routine', 'firing'],
  damage: ['injury', 'danger', 'injured'],
  injury_state: ['injury', 'danger', 'injured'],
  vehicle_damage: ['vehicle_impact', 'danger', 'injured'],
  death: ['death_seen', 'critical', 'dead'],
  body_discovered: ['body_found', 'critical', 'dead'],
  action_callback: ['action_observed', 'routine', 'action'],
  location_changed: ['location_changed', 'routine', 'location'],
  activity_changed: ['activity_changed', 'routine', 'presence'],
  vehicle_transition: ['vehicle_transition', 'routine', 'presence'],
  presence_changed: ['character_present', 'routine', 'presence'],
  vehicle_state: ['vehicle_impact', 'notable', 'sound'],
  playback_started: ['speech_heard', 'routine', 'sound'],
  playback_ended: ['speech_heard', 'routine', 'sound'],
  radio_changed: ['radio_heard', 'routine', 'sound'],
});
// The replay ledger is defence in depth only: ShadowRuntime already rejects a
// repeated frame sequence, a non-increasing producer sequence and any signal
// older than BOUNDS.signalTtlMs (30 s). A ledger entry older than twice that
// window can never match an admissible input, so it ages out instead of
// accumulating for ten minutes. Capacity pressure evicts the OLDEST replay key;
// it must never reject the newest (possibly safety-relevant) native signal.
// October 10/11 GTA logs proved the former 1024-entry/10-minute fail-closed
// ledger silently dropped every signal after ~1024 per connection.
const CAP = Object.freeze({ episodes: 256, dedupe: 2048, dedupeTtlMs: 60*1000, perEpisodeClaims: 8, perObservationClaims: 4, episodeMs: 30000, radioEpisodeMs: 120000, continuationMs: 5000 });
export const PS2_DROP_REASONS = Object.freeze(['invalid_input','radio_derived_identity_mismatch','unsupported_event','episode_claim_capacity','episode_rejected','observation_claim_capacity','observation_rejected']);

export class EpisodeCorrelator {
  constructor({ episodes, observations, now = () => Math.floor(performance.now()), current = () => false, anchor = () => null, utc = () => new Date().toISOString() } = {}) {
    this.episodes = episodes; this.observations = observations; this.now = now; this.current = current; this.anchor = anchor; this.utc = utc;
    this.seen = new Map(); this.latest = new Map(); this.visualShots = new Map(); this.radioCurrent = new Map(); this.radioSignature = new Map(); this.dropped = 0; this.duplicates = 0;
    // Process-cumulative, bounded diagnostics. Never cleared by a channel
    // reset so a session log can attribute every PS2 loss to one reason.
    this.dedupeEvicted = 0;
    this.dropReasons = Object.fromEntries(PS2_DROP_REASONS.map(reason=>[reason,0]));
  }
  noteDrop(reason) {
    if(Object.hasOwn(this.dropReasons,reason)) this.dropReasons[reason]=Math.min(2147483647,this.dropReasons[reason]+1);
    this.dropped=Math.min(2147483647,this.dropped+1);
  }

  ingest({ nativeRun, signal, witnessReceipts = [], radio = null }) {
    if (!isUuid(nativeRun) || !validateSignal(signal) || !Array.isArray(witnessReceipts) || witnessReceipts.length > 16 || !witnessReceipts.every(validateWitnessReceipt)) { this.noteDrop('invalid_input'); return { accepted: false, reason: 'invalid_input' }; }
    // Catalog details are locally derived, never appended to the authenticated wire.
    if(signal.kind==='radio_changed' && (!radio || radio.eventSignalId!==signal.signalId ||
       radio.sourceVehicleCaptureRef!==signal.target || radio.gameTick!==signal.gameTick ||
       radio.station!==signal.facts.station || radio.soundHash!==signal.facts.soundHash ||
       radio.trackTextId!==signal.facts.trackTextId || typeof radio.trackKnown!=='boolean')) {
      this.noteDrop('radio_derived_identity_mismatch');
      return {accepted:false,reason:'radio_derived_identity_mismatch'};
    }
    this.expire();
    const eventKey = `${nativeRun}:${signal.signalId}`;
    if (this.seen.has(eventKey)) { this.duplicates++; return { accepted: true, duplicate: true, episodeId: this.seen.get(eventKey).episodeId, observations: [] }; }
    if(signal.kind==='radio_stopped') return this.stopRadio(signal,eventKey);
    const event=EVENT[signal.kind];
    if(!event) { this.noteDrop('unsupported_event'); return {accepted:false,reason:'unsupported_event'}; }
    // A state change is not necessarily injury, impact or a qualified sound.
    // Vehicle fire or bullets are not a witnessed collision. Require the
    // actual native DamageTracker collision class and finite contact point.
    if(signal.kind==='vehicle_state' || signal.kind==='injury_state' && signal.facts.injured!==true ||
       signal.kind==='vehicle_damage' &&
       (signal.facts.classification!=='collision'||!signal.facts.collision)) {
      this.remember(eventKey,{episodeId:null});return {accepted:true,observations:[],reason:'unsupported_claim_detail'};
    }

    const qualified = witnessReceipts.filter(r => r && (r.status === 'witnessed' || r.status === 'reported') && r.evidence && this.current(r.observer?.captureRef) && this.anchor(r.observer.captureRef)?.kind==='ped');
    let removedObservationIds=[];
    if(signal.kind==='radio_changed' && signal.target) {
      const signature=signal.facts.station+'|'+signal.facts.trackTextId+'|'+signal.facts.soundHash;
      if(this.radioSignature.get(signal.target)!==signature) this.closeRadioVehicle(signal.target);
      if(!qualified.length) {
        // There is no fresh hearing proof. End current playback, but retain
        // old independently witnessed facts for their original TTL.
        this.closeRadioVehicle(signal.target);
        this.remember(eventKey,{episodeId:null});
        return {accepted:true,duplicate:false,episodeId:null,observations:[],removedObservationIds};
      }
    }
    if (!qualified.length) { this.remember(eventKey, { episodeId: null }); return { accepted: true, duplicate: false, episodeId: null, observations: [] }; }
    // Store bounded, observer-specific source sight, never inferred from hearing.
    if(signal.kind==='firing' && signal.producer==='shooting' && signal.source &&
       this.current(signal.source) && this.anchor(signal.source)) for(const receipt of qualified) {
      if(receipt.status!=='witnessed'||receipt.evidence.channel!=='visual'||receipt.knowsSource!==true||receipt.sampledGameTick!==signal.gameTick)continue;
      const key=`${nativeRun}:${receipt.observer.captureRef}:${signal.source}`;
      if(!this.visualShots.has(key) && this.visualShots.size>=64)continue;
      this.visualShots.set(key,{nativeRun,observer:receipt.observer.captureRef,shooter:signal.source,gameTick:signal.gameTick,monotonicMs:this.now()});
    }
    const participants = [signal.source && { captureRef: signal.source, kind: this.anchor(signal.source)?.kind }, signal.target && { captureRef: signal.target, kind: this.anchor(signal.target)?.kind }]
      .filter(r => r && r.kind && this.current(r.captureRef));
    const family = ['damage', 'injury_state', 'death', 'body_discovered'].includes(signal.kind) ? 'harm' : signal.kind==='radio_changed' ? 'radio' : event[0];
    const incidentKey = signal.incidentKey || defaultIncidentKey(signal, family);
    const matchParticipants = family === 'harm' && signal.target ? participants.filter(p => p.captureRef === signal.target) : participants;
    const radioEpisodeId = family==='radio' && signal.target ? this.radioCurrent.get(signal.target) : null;
    const existing = family==='radio' ? (radioEpisodeId ? this.episodes.entries.get(radioEpisodeId) : null) :
      this.findContinuation(nativeRun, family, incidentKey, matchParticipants, signal.gameTick);
    const episodeId = existing?.episodeId || randomUUID();
    const now = this.now(); const expiresAtMonotonicMs = family==='radio' ? now + CAP.radioEpisodeMs : Math.min(now + CAP.episodeMs, existing?.expiresAtMonotonicMs || now + CAP.episodeMs);
    const episodeClaims = family==='radio' ? [] : existing ? [...existing.claims] : [];
    const sourceRef = participants.find(p => p.captureRef === signal.source);
    const targetRef = participants.find(p => p.captureRef === signal.target);
    const episodeClaim = { claimId: randomUUID(), kind: event[2], certainty: 'supported', evidence: { channel: 'self', basis: 'sampled_state', sampledGameTick: signal.gameTick }, ...(sourceRef ? { source: sourceRef } : {}), ...(targetRef ? { target: targetRef } : {}) };
    if (episodeClaims.length < CAP.perEpisodeClaims) episodeClaims.push(episodeClaim);
    else { this.noteDrop('episode_claim_capacity'); this.remember(eventKey, { episodeId }); return { accepted: true, episodeId, observations: [], dropped: true, reason: 'episode_claim_capacity', qualified: qualified.length }; }
    const producerSequence = { producer: signal.producer, sequence: signal.producerSequence };
    const producerSequences = existing ? [...existing.producerSequences.filter(p => p.producer !== producerSequence.producer), producerSequence].slice(-7) : [producerSequence];
    const episodeParticipants = uniqueRefs([...(existing?.participants || []), ...participants]).slice(0, 4);
    const episode = { version: 1, episodeId, revision: (existing?.revision || 0) + 1, nativeRun, gameTick: signal.gameTick, expiresAtMonotonicMs, status: 'open', participants: episodeParticipants, claims: episodeClaims.slice(-CAP.perEpisodeClaims), producerSequences };
    if (!this.episodes.put(episode)) { this.noteDrop('episode_rejected'); this.remember(eventKey, { episodeId }); return { accepted: false, reason: 'episode_rejected', qualified: qualified.length }; }
    this.latest.set(episodeMatchKey(nativeRun, family, incidentKey, matchParticipants), { episodeId, gameTick: signal.gameTick });

    const emitted = [];let rejected = 0;
    for (const receipt of qualified) {
      const observerRef = receipt.observer.captureRef;
      const observationKey = `${observerRef}:${episodeId}`;
      const old = this.observations.entries.get(observationKey)?.value;
      if (old?.claims.some(c => c.details?.eventSignalId === signal.signalId)) continue;
      if (old && old.claims.length >= CAP.perObservationClaims) { this.noteDrop('observation_claim_capacity'); rejected++; continue; }
      const mappedKind = receipt.evidence.channel === 'report' ? 'report' : event[2];
      const priorFiring=this.visualShots.get(`${nativeRun}:${observerRef}:${signal.source}`);
      const joined=witnessedBulletAttribution({signal,receipt,priorFiring,nativeRun,nowMonotonicMs:this.now()});
      const knowsSource=receipt.knowsSource===true || joined;
      const details=signal.kind==='radio_changed'&&radio?{eventSignalId:signal.signalId,reason:receipt.reason,soundType:'radio',station:radio.station,trackKnown:radio.trackKnown,...(radio.stationName?{stationName:radio.stationName}:{}),...(radio.trackKnown?{artist:radio.artist,title:radio.title,contentKind:radio.contentKind}:{})}:qualifiedDetails(signal,receipt,this.anchor);
      if(joined)details.classification='bullet';
      const claim = { claimId: randomUUID(), kind: mappedKind, certainty: receipt.certainty === 'uncertain' ? 'uncertain' : 'supported', evidence: { ...receipt.evidence }, ...(knowsSource && sourceRef ? { source: sourceRef } : {}), ...(receipt.knowsTarget && targetRef && family!=='radio' ? { target: targetRef } : {}), details };
      const observation = {
        version: 1, observationId: old?.observationId || randomUUID(), episodeId, revision: (old?.revision || 0) + 1,
        observer: { captureRef: observerRef, kind: 'ped' }, observedAt: { nativeRun, gameTick: receipt.evidence.sampledGameTick, receivedUtc: this.utc() },
        expiresAtMonotonicMs: Math.min(now + 120000, expiresAtMonotonicMs + 90000), eventType: event[0], severity: event[1],
        claims: [...(family==='radio' ? [] : (old?.claims || [])), claim], recognizedCharacterIds: [],
      };
      if (this.observations.put(observation,{sourceAgeMs:signal.ageMs})) emitted.push(observation);
      else { this.noteDrop('observation_rejected'); rejected++; }
    }
    if(family==='radio' && signal.target) {
      this.radioCurrent.set(signal.target,episodeId);
      this.radioSignature.set(signal.target,signal.facts.station+'|'+signal.facts.trackTextId+'|'+signal.facts.soundHash);
    }
    this.remember(eventKey, { episodeId });
    return { accepted: true, duplicate: false, episodeId, observations: emitted, removedObservationIds, qualified: qualified.length, observationRejected: rejected };
  }

  // M9 source-qualified incident. The candidate has already been classified by
  // M9NativeEventProducer from an authenticated native sample, and the witness
  // receipts are the native WitnessPolicy results for that SAME sample tick.
  // Only firsthand receipts at the candidate tick qualify an observer; a
  // missing receipt is "unknown", never "did not witness".
  ingestM9({ nativeRun, candidate, witnessReceipts = [], sourceAgeMs = 0 }) {
    if (!isUuid(nativeRun) || candidate?.kind !== 'm9_candidate' || candidate.nativeRun !== nativeRun ||
        !M9_EVENT_TYPES.includes(candidate.eventType) || !isUuid(candidate.eventId) ||
        !isUuid(candidate.playerCaptureRef) || !Array.isArray(witnessReceipts) ||
        witnessReceipts.length > 16 || !witnessReceipts.every(validateWitnessReceipt))
      return { accepted: false, reason: 'invalid_input' };
    this.expire();
    const signalId = m9SignalId(candidate);
    const eventKey = `${nativeRun}:m9:${signalId}`;
    if (this.seen.has(eventKey)) { this.duplicates++; return { accepted: true, duplicate: true, episodeId: this.seen.get(eventKey).episodeId, observations: [] }; }
    if (this.seen.size >= CAP.dedupe) { this.dropped++; return { accepted: false, reason: 'dedupe_capacity' }; }
    const playerAnchor = this.anchor(candidate.playerCaptureRef);
    if (playerAnchor?.kind !== 'player' || !this.current(candidate.playerCaptureRef))
      return { accepted: false, reason: 'player_anchor_not_current' };
    const qualified = witnessReceipts.filter(r => r.status === 'witnessed' &&
      ['self', 'visual', 'auditory'].includes(r.evidence.channel) &&
      r.evidence.sampledGameTick === candidate.gameTick &&
      this.current(r.observer.captureRef) && this.anchor(r.observer.captureRef)?.kind === 'ped');
    if (!qualified.length) { this.remember(eventKey, { episodeId: null }); return { accepted: true, duplicate: false, episodeId: null, observations: [] }; }
    const now = this.now();
    const expiresAtMonotonicMs = now + CAP.episodeMs;
    const player = { captureRef: candidate.playerCaptureRef, kind: 'player' };
    const episodeId = randomUUID();
    const episodeClaim = { claimId: randomUUID(), kind: 'incident', certainty: 'supported', evidence: { channel: 'self', basis: 'sampled_state', sampledGameTick: candidate.gameTick }, source: player, details: { eventSignalId: signalId, reason: `m9_${candidate.eventType}` } };
    const episode = { version: 1, episodeId, revision: 1, nativeRun, gameTick: candidate.gameTick, expiresAtMonotonicMs, status: 'open', participants: [player], claims: [episodeClaim], producerSequences: [] };
    if (!this.episodes.put(episode)) { this.dropped++; this.remember(eventKey, { episodeId }); return { accepted: false, reason: 'episode_rejected' }; }
    const emitted = [];
    for (const receipt of qualified) {
      const observerRef = receipt.observer.captureRef;
      const claim = { claimId: randomUUID(), kind: 'incident', certainty: receipt.certainty === 'uncertain' ? 'uncertain' : 'supported', evidence: { ...receipt.evidence }, source: player, details: { eventSignalId: signalId, reason: `m9_${candidate.eventType}` } };
      const observation = {
        version: 1, observationId: randomUUID(), episodeId, revision: 1,
        observer: { captureRef: observerRef, kind: 'ped' }, observedAt: { nativeRun, gameTick: receipt.evidence.sampledGameTick, receivedUtc: this.utc() },
        expiresAtMonotonicMs: Math.min(now + 120000, expiresAtMonotonicMs + 90000), eventType: candidate.eventType, severity: 'notable',
        claims: [claim], recognizedCharacterIds: [],
      };
      if (this.observations.put(observation, { sourceAgeMs })) emitted.push(observation);
      else this.dropped++;
    }
    this.remember(eventKey, { episodeId });
    return { accepted: true, duplicate: false, episodeId, observations: emitted, removedObservationIds: [] };
  }

  closeRadioVehicle(vehicle) {
    const episodeId=vehicle ? this.radioCurrent.get(vehicle) : null;
    let removedObservationIds=[];
    if(episodeId) {
      // A stop is not an eraser for a previously heard song.
      this.radioCurrent.delete(vehicle);
      this.radioSignature.delete(vehicle);
    }
    return {episodeId:episodeId||null,removedObservationIds};
  }
  stopRadio(signal,eventKey) {
    const closed=this.closeRadioVehicle(signal.target);
    this.remember(eventKey,{episodeId:closed.episodeId});
    return {accepted:true,duplicate:false,episodeId:closed.episodeId,observations:[],removedObservationIds:closed.removedObservationIds};
  }
  findContinuation(nativeRun, eventType, incidentKey, participants, gameTick) {
    if (!incidentKey) return null;
    const value = this.latest.get(episodeMatchKey(nativeRun, eventType, incidentKey, participants));
    if (!value || tickDelta(gameTick, value.gameTick) > CAP.continuationMs) return null;
    const episode = this.episodes.entries.get(value.episodeId);
    return episode && episode.claims.length < CAP.perEpisodeClaims ? episode : null;
  }
  remember(key, value) {
    // Insertion order is expiry order (constant TTL): evicting the first key
    // removes the oldest replay record, never a fresh incoming signal.
    this.seen.delete(key);
    while (this.seen.size >= CAP.dedupe) { this.seen.delete(this.seen.keys().next().value); this.dedupeEvicted = Math.min(2147483647, this.dedupeEvicted + 1); }
    this.seen.set(key, { ...value, expires: this.now() + CAP.dedupeTtlMs });
  }
  expire() {
    const now=this.now();
    for (const [key, value] of this.seen) { if (value.expires > now) break; this.seen.delete(key); }
    for (const [key, value] of this.visualShots) if(now-value.monotonicMs>750 || !this.current(value.observer) || !this.current(value.shooter)) this.visualShots.delete(key);
    for (const [key, value] of this.latest) if (!this.episodes.entries.has(value.episodeId)) this.latest.delete(key); for(const [vehicle,episodeId] of this.radioCurrent) if(!this.episodes.entries.has(episodeId)) {this.radioCurrent.delete(vehicle);this.radioSignature.delete(vehicle);}
  }
  // A channel reset discards correlation state; loss diagnostics stay cumulative.
  clear() { this.seen.clear(); this.latest.clear(); this.visualShots.clear(); this.radioCurrent.clear(); this.radioSignature.clear(); this.duplicates = 0; }
}

// P2's native-receipt replay fence keys on this id. It deliberately EXCLUDES the
// companion adapterEpoch, so a pipe reconnect that re-delivers the same native
// incident (same host run / world epoch / player / evidence) keeps one identity.
export function m9SignalId(candidate) {
  const h = Buffer.from(createHash('sha256').update(JSON.stringify(['M9-SIGNAL', candidate.hostRunId, candidate.worldEpoch, candidate.playerCaptureRef, candidate.eventType, candidate.nativeEvidenceId])).digest().subarray(0, 16));
  h[6] = h[6] & 15 | 64; h[8] = h[8] & 63 | 128;
  const x = h.toString('hex');
  return [x.slice(0, 8), x.slice(8, 12), x.slice(12, 16), x.slice(16, 20), x.slice(20)].join('-');
}

function defaultIncidentKey(signal, family) {
  if (family === 'harm') return signal.target ? `harm:${signal.target}` : null;
  if (family === 'firing_burst') return signal.source ? `firing:${signal.source}` : null;
  if (family === 'radio') return signal.target ? `radio:${signal.target}` : null;
  return signal.source || signal.target ? `${family}:${signal.source || ''}:${signal.target || ''}` : null;
}
function uniqueRefs(values) { return [...new Map(values.map(v => [v.captureRef, v])).values()]; }
function episodeMatchKey(run, type, incidentKey, participants) { return `${run}:${type}:${incidentKey || ''}:${uniqueRefs(participants).map(p => p.captureRef).sort().join(',')}`; }
function tickDelta(a, b) { return (a - b) >>> 0; }

export const EPISODE_CORRELATION_BOUNDS = CAP;

function qualifiedDetails(signal,receipt,anchor) {
  const details={eventSignalId:signal.signalId,reason:receipt.reason};
  const self=receipt.evidence.channel==='self' && receipt.observer.captureRef===signal.target && receipt.knowsTarget===true;
  if(!self || receipt.evidence.sampledGameTick!==signal.gameTick) return details;
  if(receipt.evidence.basis==='native_callback') {
    if(signal.kind==='damage') return {...details,damageDelta:signal.facts.damage,armourDelta:signal.facts.armour};
    if(signal.kind==='action_callback' && ['followtarget','waithere'].includes(signal.facts.action)) return {...details,action:signal.facts.action,succeeded:signal.facts.succeeded};
  }
  if(receipt.evidence.basis==='sampled_state') {
    if(signal.kind==='location_changed' && signal.facts.location!=='UNKNOWN') return {...details,location:signal.facts.location};
    if(signal.kind==='activity_changed' && ['in_vehicle','running','walking','stationary'].includes(signal.facts.activity)) return {...details,activity:signal.facts.activity};
    if(signal.kind==='vehicle_transition' && (signal.facts.vehicle===null ? signal.facts.driver===false : anchor(signal.facts.vehicle)?.kind==='vehicle')) return {...details,vehicle:signal.facts.vehicle,driver:signal.facts.driver};
  }
  return details;
}
