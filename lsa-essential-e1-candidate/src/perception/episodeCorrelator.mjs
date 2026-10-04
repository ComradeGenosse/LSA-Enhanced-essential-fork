import { randomUUID } from 'node:crypto';

const EVENT = Object.freeze({
  firing: ['firing_burst', 'routine', 'firing'],
  damage: ['injury', 'danger', 'injured'],
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
});
const CAP = Object.freeze({ episodes: 256, dedupe: 1024, dedupeTtlMs: 10*60*1000, perEpisodeClaims: 8, perObservationClaims: 4, episodeMs: 30000, continuationMs: 5000 });

export class EpisodeCorrelator {
  constructor({ episodes, observations, now = () => Math.floor(performance.now()), current = () => false, anchor = () => null, utc = () => new Date().toISOString() } = {}) {
    this.episodes = episodes; this.observations = observations; this.now = now; this.current = current; this.anchor = anchor; this.utc = utc;
    this.seen = new Map(); this.latest = new Map(); this.dropped = 0; this.duplicates = 0;
  }

  ingest({ nativeRun, signal, witnessReceipts = [] }) {
    if (!nativeRun || !signal?.signalId || !Array.isArray(witnessReceipts) || witnessReceipts.length > 16) return { accepted: false, reason: 'invalid_input' };
    this.expire();
    const event = EVENT[signal.kind];
    if (!event) return { accepted: false, reason: 'unsupported_event' };
    const eventKey = `${nativeRun}:${signal.signalId}`;
    if (this.seen.has(eventKey)) { this.duplicates++; return { accepted: true, duplicate: true, episodeId: this.seen.get(eventKey).episodeId, observations: [] }; }
    if(this.seen.size>=CAP.dedupe) {this.dropped++;return {accepted:false,reason:'dedupe_capacity'};}

    const qualified = witnessReceipts.filter(r => r && r.status === 'witnessed' && r.evidence && this.current(r.observer?.captureRef));
    if (!qualified.length) { this.remember(eventKey, { episodeId: null }); return { accepted: true, duplicate: false, episodeId: null, observations: [] }; }
    const participants = [signal.source && { captureRef: signal.source, kind: this.anchor(signal.source)?.kind }, signal.target && { captureRef: signal.target, kind: this.anchor(signal.target)?.kind }]
      .filter(r => r && r.kind && this.current(r.captureRef));
    const incidentKey = signal.incidentKey || (signal.source || signal.target ? `${signal.kind}:${signal.source||''}:${signal.target||''}` : null);
    const existing = this.findContinuation(nativeRun, event[0], incidentKey, participants, signal.gameTick);
    const episodeId = existing?.episodeId || randomUUID();
    const now = this.now(); const expiresAtMonotonicMs = Math.min(now + CAP.episodeMs, existing?.expiresAtMonotonicMs || now + CAP.episodeMs);
    const episodeClaims = existing ? [...existing.claims] : [];
    const episodeClaim = { claimId: randomUUID(), kind: event[2], certainty: 'supported', evidence: { channel: 'self', basis: 'sampled_state', sampledGameTick: signal.gameTick }, ...(participants[0] ? { source: participants[0] } : {}), ...(participants[1] ? { target: participants[1] } : {}) };
    if (episodeClaims.length < CAP.perEpisodeClaims) episodeClaims.push(episodeClaim);
    else { this.dropped++; this.remember(eventKey, { episodeId }); return { accepted: true, episodeId, observations: [], dropped: true }; }
    const producerSequence = { producer: signal.producer, sequence: signal.producerSequence };
    const producerSequences = existing ? [...existing.producerSequences.filter(p => p.producer !== producerSequence.producer), producerSequence].slice(-7) : [producerSequence];
    const episode = { version: 1, episodeId, revision: (existing?.revision || 0) + 1, nativeRun, gameTick: signal.gameTick, expiresAtMonotonicMs, status: 'open', participants: uniqueRefs(participants).slice(0, 4), claims: episodeClaims.slice(-CAP.perEpisodeClaims), producerSequences };
    if (!this.episodes.put(episode)) { this.dropped++; this.remember(eventKey, { episodeId }); return { accepted: false, reason: 'episode_rejected' }; }
    this.latest.set(episodeMatchKey(nativeRun, event[0], incidentKey, participants), { episodeId, gameTick: signal.gameTick });

    const emitted = [];
    for (const receipt of qualified) {
      const observerRef = receipt.observer.captureRef;
      const observationKey = `${observerRef}:${episodeId}`;
      const old = this.observations.entries.get(observationKey)?.value;
      if (old?.claims.some(c => c.details?.eventSignalId === signal.signalId)) continue;
      if (old && old.claims.length >= CAP.perObservationClaims) { this.dropped++; continue; }
      const mappedKind = receipt.evidence.channel === 'report' ? 'report' : event[2];
      const sourceRef=participants.find(p=>p.captureRef===signal.source),targetRef=participants.find(p=>p.captureRef===signal.target);
      const claim = { claimId: randomUUID(), kind: mappedKind, certainty: receipt.certainty === 'uncertain' ? 'uncertain' : 'supported', evidence: { ...receipt.evidence }, ...(receipt.knowsSource && sourceRef ? { source: sourceRef } : {}), ...(receipt.knowsTarget && targetRef ? { target: targetRef } : {}), details: { eventSignalId: signal.signalId, reason: receipt.reason } };
      const observation = {
        version: 1, observationId: old?.observationId || randomUUID(), episodeId, revision: (old?.revision || 0) + 1,
        observer: { captureRef: observerRef, kind: 'ped' }, observedAt: { nativeRun, gameTick: receipt.evidence.sampledGameTick, receivedUtc: this.utc() },
        expiresAtMonotonicMs: Math.min(now + 120000, expiresAtMonotonicMs + 90000), eventType: event[0], severity: event[1],
        claims: [...(old?.claims || []), claim], recognizedCharacterIds: [],
      };
      if (this.observations.put(observation)) emitted.push(observation);
      else this.dropped++;
    }
    this.remember(eventKey, { episodeId });
    return { accepted: true, duplicate: false, episodeId, observations: emitted };
  }

  findContinuation(nativeRun, eventType, incidentKey, participants, gameTick) {
    if (!incidentKey) return null;
    const value = this.latest.get(episodeMatchKey(nativeRun, eventType, incidentKey, participants));
    if (!value || tickDelta(gameTick, value.gameTick) > CAP.continuationMs) return null;
    const episode = this.episodes.entries.get(value.episodeId);
    return episode && episode.claims.length < CAP.perEpisodeClaims ? episode : null;
  }
  remember(key, value) { this.seen.set(key, { ...value, expires: this.now() + CAP.dedupeTtlMs }); }
  expire() { for (const [key, value] of this.seen) if (value.expires <= this.now()) this.seen.delete(key); for (const [key, value] of this.latest) if (!this.episodes.entries.has(value.episodeId)) this.latest.delete(key); }
  clear() { this.seen.clear(); this.latest.clear(); this.dropped = 0; this.duplicates = 0; }
}

function uniqueRefs(values) { return [...new Map(values.map(v => [v.captureRef, v])).values()]; }
function episodeMatchKey(run, type, incidentKey, participants) { return `${run}:${type}:${incidentKey || ''}:${uniqueRefs(participants).map(p => p.captureRef).sort().join(',')}`; }
function tickDelta(a, b) { return (a - b) >>> 0; }

export const EPISODE_CORRELATION_BOUNDS = CAP;
