import { validateSignal, validateWitnessReceipt } from './contracts.mjs';
import { isUuid } from '../identity/identityContract.mjs';
import { randomUUID } from 'node:crypto';
import {witnessedBulletAttribution} from './contextualBallistics.mjs';

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
});
const CAP = Object.freeze({ episodes: 256, dedupe: 1024, dedupeTtlMs: 10*60*1000, perEpisodeClaims: 8, perObservationClaims: 4, episodeMs: 30000, continuationMs: 5000 });

export class EpisodeCorrelator {
  constructor({ episodes, observations, now = () => Math.floor(performance.now()), current = () => false, anchor = () => null, utc = () => new Date().toISOString() } = {}) {
    this.episodes = episodes; this.observations = observations; this.now = now; this.current = current; this.anchor = anchor; this.utc = utc;
    this.seen = new Map(); this.latest = new Map(); this.visualShots = new Map(); this.dropped = 0; this.duplicates = 0;
  }

  ingest({ nativeRun, signal, witnessReceipts = [] }) {
    if (!isUuid(nativeRun) || !validateSignal(signal) || !Array.isArray(witnessReceipts) || witnessReceipts.length > 16 || !witnessReceipts.every(validateWitnessReceipt)) return { accepted: false, reason: 'invalid_input' };
    this.expire();
    const event = EVENT[signal.kind];
    if (!event) return { accepted: false, reason: 'unsupported_event' };
    const eventKey = `${nativeRun}:${signal.signalId}`;
    if (this.seen.has(eventKey)) { this.duplicates++; return { accepted: true, duplicate: true, episodeId: this.seen.get(eventKey).episodeId, observations: [] }; }
    if(this.seen.size>=CAP.dedupe) {this.dropped++;return {accepted:false,reason:'dedupe_capacity'};}
    // A state change is not necessarily injury, impact or a qualified sound.
    if(signal.kind==='vehicle_state' || signal.kind==='injury_state' && signal.facts.injured!==true) {
      this.remember(eventKey,{episodeId:null});return {accepted:true,observations:[],reason:'unsupported_claim_detail'};
    }

    const qualified = witnessReceipts.filter(r => r && (r.status === 'witnessed' || r.status === 'reported') && r.evidence && this.current(r.observer?.captureRef) && this.anchor(r.observer.captureRef)?.kind==='ped');
    if (!qualified.length) { this.remember(eventKey, { episodeId: null }); return { accepted: true, duplicate: false, episodeId: null, observations: [] }; }
    // A native shooting signal carries the shooter anchor, but only visually
    // source-qualified observers acquire that fact. Keep at most 64 short-lived
    // proofs; losing a proof is safer than widening a callback association.
    if(signal.kind==='firing' && signal.source) for(const receipt of qualified) {
      if(receipt.evidence.channel!=='visual' || receipt.knowsSource!==true)continue;
      const key=`${nativeRun}:${receipt.observer.captureRef}:${signal.source}`;
      if(!this.visualShots.has(key) && this.visualShots.size>=64)continue;
      this.visualShots.set(key,{nativeRun,observer:receipt.observer.captureRef,
        shooter:signal.source,gameTick:signal.gameTick,monotonicMs:this.now()});
    }
    const participants = [signal.source && { captureRef: signal.source, kind: this.anchor(signal.source)?.kind }, signal.target && { captureRef: signal.target, kind: this.anchor(signal.target)?.kind }]
      .filter(r => r && r.kind && this.current(r.captureRef));
    const family = ['damage', 'injury_state', 'death'].includes(signal.kind) ? 'harm' : event[0];
    const incidentKey = signal.incidentKey || defaultIncidentKey(signal, family);
    const matchParticipants = family === 'harm' && signal.target ? participants.filter(p => p.captureRef === signal.target) : participants;
    const existing = this.findContinuation(nativeRun, family, incidentKey, matchParticipants, signal.gameTick);
    const episodeId = existing?.episodeId || randomUUID();
    const now = this.now(); const expiresAtMonotonicMs = Math.min(now + CAP.episodeMs, existing?.expiresAtMonotonicMs || now + CAP.episodeMs);
    const episodeClaims = existing ? [...existing.claims] : [];
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
      const priorFiring=this.visualShots.get(`${nativeRun}:${observerRef}:${signal.source}`);
      const joined=witnessedBulletAttribution({signal,receipt,priorFiring,
        nativeRun,nowMonotonicMs:this.now()});
      const knowsSource=receipt.knowsSource===true || joined;
      const details=qualifiedDetails(signal,receipt,this.anchor);
      if(joined) details.classification='bullet';
      const claim = { claimId: randomUUID(), kind: mappedKind, certainty: receipt.certainty === 'uncertain' ? 'uncertain' : 'supported', evidence: { ...receipt.evidence }, ...(knowsSource && sourceRef ? { source: sourceRef } : {}), ...(receipt.knowsTarget && targetRef ? { target: targetRef } : {}), details };
      const observation = {
        version: 1, observationId: old?.observationId || randomUUID(), episodeId, revision: (old?.revision || 0) + 1,
        observer: { captureRef: observerRef, kind: 'ped' }, observedAt: { nativeRun, gameTick: receipt.evidence.sampledGameTick, receivedUtc: this.utc() },
        expiresAtMonotonicMs: Math.min(now + 120000, expiresAtMonotonicMs + 90000), eventType: event[0], severity: event[1],
        claims: [...(old?.claims || []), claim], recognizedCharacterIds: [],
      };
      if (this.observations.put(observation,{sourceAgeMs:signal.ageMs})) emitted.push(observation);
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
  expire() { for(const [key,value] of this.visualShots)if(this.now()-value.monotonicMs>750 || !this.current(value.observer) || !this.current(value.shooter))this.visualShots.delete(key); for (const [key, value] of this.seen) if (value.expires <= this.now()) this.seen.delete(key); for (const [key, value] of this.latest) if (!this.episodes.entries.has(value.episodeId)) this.latest.delete(key); }
  clear() { this.seen.clear(); this.latest.clear(); this.visualShots.clear(); this.dropped = 0; this.duplicates = 0; }
}

function defaultIncidentKey(signal, family) {
  if (family === 'harm') return signal.target ? `harm:${signal.target}` : null;
  if (family === 'firing_burst') return signal.source ? `firing:${signal.source}` : null;
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
