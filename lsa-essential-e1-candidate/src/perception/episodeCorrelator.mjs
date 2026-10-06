import { randomUUID } from 'node:crypto';

const EVENT = Object.freeze({
  firing: ['firing_burst', 'routine', 'firing'],
  damage: ['injury', 'danger', 'injured'],
  injury_state: ['injury', 'danger', 'injured'],
  vehicle_damage: ['vehicle_impact', 'danger', 'injured'],
  death: ['death_seen', 'critical', 'dead'],
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
const CAP = Object.freeze({ episodes: 256, dedupe: 1024, dedupeTtlMs: 10*60*1000, perEpisodeClaims: 8, perObservationClaims: 4, episodeMs: 30000, radioEpisodeMs: 120000, continuationMs: 5000 });

export class EpisodeCorrelator {
  constructor({ episodes, observations, now = () => Math.floor(performance.now()), current = () => false, anchor = () => null, utc = () => new Date().toISOString() } = {}) {
    this.episodes = episodes; this.observations = observations; this.now = now; this.current = current; this.anchor = anchor; this.utc = utc;
    this.seen = new Map(); this.latest = new Map(); this.radioCurrent = new Map(); this.dropped = 0; this.duplicates = 0;
  }

  ingest({ nativeRun, signal, witnessReceipts = [] }) {
    if (!nativeRun || !signal?.signalId || !Array.isArray(witnessReceipts) || witnessReceipts.length > 16) return { accepted: false, reason: 'invalid_input' };
    this.expire();
    const eventKey = `${nativeRun}:${signal.signalId}`;
    if (this.seen.has(eventKey)) { this.duplicates++; return { accepted: true, duplicate: true, episodeId: this.seen.get(eventKey).episodeId, observations: [] }; }
    if(this.seen.size>=CAP.dedupe) {this.dropped++;return {accepted:false,reason:'dedupe_capacity'};}
    if(signal.kind==='radio_stopped') return this.stopRadio(signal,eventKey);
    const event = EVENT[signal.kind];
    if (!event) return { accepted: false, reason: 'unsupported_event' };

    const qualified = witnessReceipts.filter(r => r && (r.status === 'witnessed' || r.status === 'reported') && r.evidence && this.current(r.observer?.captureRef));
    let removedObservationIds=[];
    if(signal.kind==='radio_changed' && signal.target) {
      const currentEpisode=this.radioCurrent.get(signal.target);
      if(currentEpisode) removedObservationIds=this.observations.retainEpisodeObservers(currentEpisode,new Set(qualified.map(r=>r.observer.captureRef)));
      if(!qualified.length) {
        const closed=this.closeRadioVehicle(signal.target);removedObservationIds=[...new Set([...removedObservationIds,...closed.removedObservationIds])];
        this.remember(eventKey,{episodeId:closed.episodeId});return {accepted:true,duplicate:false,episodeId:closed.episodeId,observations:[],removedObservationIds};
      }
    }
    if (!qualified.length) { this.remember(eventKey, { episodeId: null }); return { accepted: true, duplicate: false, episodeId: null, observations: [] }; }
    const participants = [signal.source && { captureRef: signal.source, kind: this.anchor(signal.source)?.kind }, signal.target && { captureRef: signal.target, kind: this.anchor(signal.target)?.kind }]
      .filter(r => r && r.kind && this.current(r.captureRef));
    const family = ['damage', 'injury_state', 'death'].includes(signal.kind) ? 'harm' : signal.kind==='radio_changed' ? 'radio' : event[0];
    const incidentKey = signal.incidentKey || defaultIncidentKey(signal, family);
    const matchParticipants = family === 'harm' && signal.target ? participants.filter(p => p.captureRef === signal.target) : participants;
    const radioEpisodeId = family==='radio' && signal.target ? this.radioCurrent.get(signal.target) : null;
    const existing = radioEpisodeId ? this.episodes.entries.get(radioEpisodeId) : this.findContinuation(nativeRun, family, incidentKey, matchParticipants, signal.gameTick);
    const episodeId = existing?.episodeId || randomUUID();
    const now = this.now(); const expiresAtMonotonicMs = family==='radio' ? now + CAP.radioEpisodeMs : Math.min(now + CAP.episodeMs, existing?.expiresAtMonotonicMs || now + CAP.episodeMs);
    const episodeClaims = family==='radio' ? [] : existing ? [...existing.claims] : [];
    const sourceRef = participants.find(p => p.captureRef === signal.source);
    const targetRef = participants.find(p => p.captureRef === signal.target);
    const episodeClaim = { claimId: randomUUID(), kind: event[2], certainty: 'supported', evidence: { channel: 'self', basis: 'sampled_state', sampledGameTick: signal.gameTick }, ...(sourceRef ? { source: sourceRef } : {}), ...(targetRef ? { target: targetRef } : {}) };
    if (episodeClaims.length < CAP.perEpisodeClaims) episodeClaims.push(episodeClaim);
    else { this.dropped++; this.remember(eventKey, { episodeId }); return { accepted: true, episodeId, observations: [], dropped: true }; }
    const producerSequence = { producer: signal.producer, sequence: signal.producerSequence };
    const producerSequences = existing ? [...existing.producerSequences.filter(p => p.producer !== producerSequence.producer), producerSequence].slice(-7) : [producerSequence];
    const episodeParticipants = uniqueRefs([...(existing?.participants || []), ...participants]).slice(0, 4);
    const episode = { version: 1, episodeId, revision: (existing?.revision || 0) + 1, nativeRun, gameTick: signal.gameTick, expiresAtMonotonicMs, status: 'open', participants: episodeParticipants, claims: episodeClaims.slice(-CAP.perEpisodeClaims), producerSequences };
    if (!this.episodes.put(episode)) { this.dropped++; this.remember(eventKey, { episodeId }); return { accepted: false, reason: 'episode_rejected' }; }
    this.latest.set(episodeMatchKey(nativeRun, family, incidentKey, matchParticipants), { episodeId, gameTick: signal.gameTick });

    const emitted = [];
    for (const receipt of qualified) {
      const observerRef = receipt.observer.captureRef;
      const observationKey = `${observerRef}:${episodeId}`;
      const old = this.observations.entries.get(observationKey)?.value;
      if (old?.claims.some(c => c.details?.eventSignalId === signal.signalId)) continue;
      if (old && old.claims.length >= CAP.perObservationClaims) { this.dropped++; continue; }
      const mappedKind = receipt.evidence.channel === 'report' ? 'report' : event[2];
      const radio = signal.kind==='radio_changed' ? signal.radio : null;
      const details = radio ? {
        eventSignalId: signal.signalId, reason: receipt.reason, soundType: 'radio', station: radio.station, trackKnown: radio.trackKnown,
        ...(radio.stationName ? { stationName: radio.stationName } : {}),
        ...(radio.trackKnown ? { artist: radio.artist, title: radio.title, contentKind: radio.contentKind } : {}),
      } : { eventSignalId: signal.signalId, reason: receipt.reason };
      const claim = { claimId: randomUUID(), kind: mappedKind, certainty: receipt.certainty === 'uncertain' ? 'uncertain' : 'supported', evidence: { ...receipt.evidence }, ...(receipt.knowsSource && sourceRef ? { source: sourceRef } : {}), ...(receipt.knowsTarget && targetRef ? { target: targetRef } : {}), details };
      const observation = {
        version: 1, observationId: old?.observationId || randomUUID(), episodeId, revision: (old?.revision || 0) + 1,
        observer: { captureRef: observerRef, kind: 'ped' }, observedAt: { nativeRun, gameTick: receipt.evidence.sampledGameTick, receivedUtc: this.utc() },
        expiresAtMonotonicMs: Math.min(now + 120000, expiresAtMonotonicMs + 90000), eventType: event[0], severity: event[1],
        claims: [...(family==='radio' ? [] : (old?.claims || [])), claim], recognizedCharacterIds: [],
      };
      if (this.observations.put(observation)) emitted.push(observation);
      else this.dropped++;
    }
    if(family==='radio' && signal.target) this.radioCurrent.set(signal.target,episodeId);
    this.remember(eventKey, { episodeId });
    return { accepted: true, duplicate: false, episodeId, observations: emitted, removedObservationIds };
  }

  closeRadioVehicle(vehicle) {
    const episodeId=vehicle ? this.radioCurrent.get(vehicle) : null;
    let removedObservationIds=[];
    if(episodeId) {
      removedObservationIds=this.observations.removeEpisode(episodeId);
      this.episodes.remove(episodeId);
      this.radioCurrent.delete(vehicle);
      for(const [key,value] of this.latest) if(value.episodeId===episodeId) this.latest.delete(key);
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
  remember(key, value) { this.seen.set(key, { ...value, expires: this.now() + CAP.dedupeTtlMs }); }
  expire() { for (const [key, value] of this.seen) if (value.expires <= this.now()) this.seen.delete(key); for (const [key, value] of this.latest) if (!this.episodes.entries.has(value.episodeId)) this.latest.delete(key); for(const [vehicle,episodeId] of this.radioCurrent) if(!this.episodes.entries.has(episodeId)) {this.observations.removeEpisode(episodeId);this.radioCurrent.delete(vehicle);} }
  clear() { this.seen.clear(); this.latest.clear(); this.radioCurrent.clear(); this.dropped = 0; this.duplicates = 0; }
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
