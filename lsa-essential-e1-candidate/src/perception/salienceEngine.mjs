import {readPrimaryBehaviorOwner} from '../context/primaryBehaviorOwner.mjs';
import { immutableSnapshot } from '../context/turnSnapshot.mjs';
import { isUuid } from '../identity/identityContract.mjs';
import { validateObservation } from './contracts.mjs';

// Local ranker only. urgent is a priority label, not permission to speak,
// interrupt playback, write memory, or override native reflex.
export const REASON_CODES = Object.freeze([
  'evidence_expired', 'evidence_lifetime_ended', 'evidence_channel_unhealthy', 'evidence_unsupported', 'evidence_uncertain',
  'revision_stale', 'repetition_suppressed', 'suppression_capacity',
  'safety_self_danger', 'safety_player_harm', 'safety_nearby_threat',
  'involvement_self', 'involvement_player',
  'relationship_close', 'relationship_conflict',
  'prior_memory', 'novelty_escalation', 'novelty_material',
  'situation_occupied', 'situation_conversation', 'trait_policy', 'environment_requested', 'routine_low_relevance',
]);
export const TRAIT_POLICIES = Object.freeze(['protective', 'cautious', 'loyal', 'bold']);
export const SALIENCE_POLICY_VERSION = 1;
export const SALIENCE_BOUNDS = Object.freeze({
  decisions: 256, perObserver: 32, suppression: 1024, suppressionTtlMs: 10 * 60 * 1000, reasons: 4,
});
const REASON_SET = new Set(REASON_CODES);
const RELATIONSHIPS = new Set(['associate', 'friend', 'trusted', 'strained', 'neutral']);
const ACTIVITIES = new Set(['unknown', 'idle', 'driving', 'passenger', 'in_vehicle', 'conversation', 'following', 'waiting']);
const CLOSE = new Set(['friend', 'trusted']);
const OCCUPIED = new Set(['driving', 'passenger', 'in_vehicle']);
const ROUTINE_EVENTS = new Set(['character_present', 'location_changed', 'activity_changed', 'speech_heard', 'radio_heard', 'action_observed', 'vehicle_transition']);
const HARM_EVENTS = new Set(['injury', 'death_seen', 'body_found', 'vehicle_impact', 'threat']);
const SEVERITY = Object.freeze({ routine: 0, notable: 1, danger: 2, critical: 3 });
const RESPONSE_RANK = Object.freeze({ none: 0, eligible: 1, urgent: 2 });
const DECISION_KEYS = ['observationId', 'revision', 'decisionKey', 'policyVersion', 'context', 'memory', 'response', 'reasons', 'expiresAtMonotonicMs'];

const integer = value => Number.isSafeInteger(value) && value >= 0;

function participantRefs(observation) {
  const refs = [];
  for (const claim of observation.claims) {
    if (claim.source?.captureRef) refs.push(claim.source.captureRef);
    if (claim.target?.captureRef) refs.push(claim.target.captureRef);
  }
  return refs;
}
function recognizedHit(recognized, ref) {
  if (!isUuid(ref) || !recognized) return null;
  const hit = recognized instanceof Map ? recognized.get(ref) : recognized[ref];
  // Social relevance is authority-bearing input: omission is not consent.
  if (!hit || hit.recognized !== true || !isUuid(hit.characterId)) return null;
  return { characterId: hit.characterId, relationship: RELATIONSHIPS.has(hit.relationship) ? hit.relationship : 'neutral', recognized: true };
}
function familyKey(observation) {
  const family = HARM_EVENTS.has(observation.eventType) ? 'harm' : observation.eventType === 'firing_burst' ? 'firing' : observation.eventType;
  return `${observation.observer.captureRef}|${family}|${participantRefs(observation).sort().join(',')}`;
}
function samePrimaryBehaviorOwner(a,b) {
  return (!a && !b) || (!!a && !!b &&
    a.owner===b.owner && a.mode===b.mode && a.since===b.since);
}

// Compare policy-relevant state without equating a fresh native sample with
// new PS3 authority. The original response key/TTL is never renewed here.
export function sameSalienceSituationPolicy(sealed,live,observation) {
  return !!sealed && !!live && !!observation &&
    sealed.profileRevision===live.profileRevision &&
    sealed.ownerProofRevision===live.ownerProofRevision &&
    samePrimaryBehaviorOwner(sealed.primaryOwner,live.primaryOwner) &&
    sealed.playerCaptureRef===live.playerCaptureRef &&
    sealed.lifetimeCurrent===true && live.lifetimeCurrent===true &&
    sealed.channelHealthy===true && live.channelHealthy===true &&
    sealed.perceptionSupported===true && live.perceptionSupported===true &&
    policyFingerprint(sealed,observation)===policyFingerprint(live,observation);
}

function policyFingerprint(situation, observation) {
  const recognized = participantRefs(observation).map(ref => {
    const hit = recognizedHit(situation.recognized, ref);
    return hit ? `${ref}:${hit.characterId}:${hit.relationship}` : `${ref}:backend`;
  }).sort();
  const memories = situation.memories.map(memory => `${memory.memoryId}:${memory.importance}:${[...memory.relatedCharacterIds].sort().join('.')}`).sort();
  const player = situation.playerRelationship?.state || 'none';
  // The ranker only distinguishes occupied vehicles, conversations, and
  // ordinary unoccupied activity. Following/walking/idle sampling changes
  // cannot alter classification and must not retire a pending PS3 grant.
  const activity=OCCUPIED.has(situation.activity)?'occupied':
    situation.activity==='conversation'?'conversation':'unoccupied';
  return [activity, player, recognized.join('|'), memories.join('|'), situation.traitPolicies.join(',')].join('~');
}
function selectReasons(reasons) {
  const present = new Set(reasons.filter(code => REASON_SET.has(code)));
  return REASON_CODES.filter(code => present.has(code)).slice(0, SALIENCE_BOUNDS.reasons);
}
function decisionKey(observation, policy, grantEpoch = 0) {
  const input = `${observation.observationId}|${observation.revision}|${SALIENCE_POLICY_VERSION}|${grantEpoch}|${policy || 'closed'}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${observation.observationId}:${observation.revision}:${SALIENCE_POLICY_VERSION}:${grantEpoch}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
function blank(observation, now, draft) {
  const expiresAtMonotonicMs = Math.min(observation.expiresAtMonotonicMs, now + SALIENCE_BOUNDS.suppressionTtlMs);
  return Object.freeze({
    observationId: observation.observationId,
    revision: observation.revision,
    decisionKey: decisionKey(observation, draft.policy, draft.grantEpoch || 0),
    policyVersion: SALIENCE_POLICY_VERSION,
    context: draft.context,
    memory: draft.memory,
    response: draft.response,
    reasons: Object.freeze(selectReasons(draft.reasons)),
    expiresAtMonotonicMs,
  });
}
export function normalizeSalienceSituation(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  const traitPolicies = [];
  for (const tag of Array.isArray(source.traitPolicies) ? source.traitPolicies : []) {
    const token = typeof tag === 'string' ? tag.trim().toLowerCase() : '';
    if (TRAIT_POLICIES.includes(token) && !traitPolicies.includes(token)) traitPolicies.push(token);
  }
  const recognized = {};
  const entries = source.recognized instanceof Map ? [...source.recognized.entries()] : Object.entries(source.recognized && typeof source.recognized === 'object' ? source.recognized : {});
  for (const [ref, hit] of entries.slice(0, 32)) {
    const normalized = recognizedHit(new Map([[ref, hit]]), ref);
    if (normalized) recognized[ref] = normalized;
  }
  const memories = [];
  for (const memory of (Array.isArray(source.memories) ? source.memories : []).slice(0, 16)) {
    if (!memory || !integer(memory.importance) || memory.importance < 50 || !Array.isArray(memory.relatedCharacterIds)) continue;
    const relatedCharacterIds = memory.relatedCharacterIds.filter(isUuid).slice(0, 8);
    if (relatedCharacterIds.length) memories.push({ memoryId: typeof memory.memoryId === 'string' ? memory.memoryId : '', importance: memory.importance, relatedCharacterIds });
  }
  const relationship = source.playerRelationship;
  const playerRelationship = relationship && RELATIONSHIPS.has(relationship.state)
    ? { state: relationship.state, revision: integer(relationship.revision) ? relationship.revision : 0 }
    : null;
  return Object.freeze({
    nowMonotonicMs: integer(source.nowMonotonicMs) ? source.nowMonotonicMs : 0,
    lifetimeCurrent: source.lifetimeCurrent !== false,
    channelHealthy: source.channelHealthy !== false,
    perceptionSupported: source.perceptionSupported !== false,
    playerCaptureRef: isUuid(source.playerCaptureRef) ? source.playerCaptureRef : null,
    recognized: Object.freeze(recognized),
    playerRelationship: playerRelationship ? Object.freeze(playerRelationship) : null,
    situationRevision: integer(source.situationRevision) ? source.situationRevision : 0,
    profileRevision: integer(source.profileRevision) ? source.profileRevision : 0,
    // Native P2 owner revision is a lifetime/ABA fence, not the continuously
    // incrementing perception situationRevision. Keep it on the sealed pair.
    ownerProofRevision: integer(source.ownerProofRevision) ? source.ownerProofRevision : 0,
    primaryOwner:readPrimaryBehaviorOwner(source.primaryOwner),
    activity: ACTIVITIES.has(source.activity) ? source.activity : 'unknown',
    memories: Object.freeze(memories),
    traitPolicies: Object.freeze(traitPolicies),
    distanceBand: [0, 1, 2, 3].includes(source.distanceBand) ? source.distanceBand : 0,
  });
}
export function situationFromCharacterView(view = {}) {
  const profile = view.profile && typeof view.profile === 'object' ? view.profile : null;
  const traits = Array.isArray(profile?.personality?.traits) ? profile.personality.traits : [];
  const traitPolicies = [];
  for (const trait of traits) {
    const token = typeof trait === 'string' ? trait.trim().toLowerCase() : '';
    if (TRAIT_POLICIES.includes(token) && !traitPolicies.includes(token)) traitPolicies.push(token);
  }
  const recognized = {};
  for (const binding of (Array.isArray(view.bindings) ? view.bindings : []).slice(0, 32)) {
    if (!binding || binding.recognized !== true) continue;
    const hit = recognizedHit(new Map([[binding.captureRef, binding]]), binding.captureRef);
    if (hit) recognized[binding.captureRef] = hit;
  }
  const profileMemories = Array.isArray(view.memories) ? view.memories : profile?.memories;
  const relationship = profile?.relationship;
  return normalizeSalienceSituation({
    nowMonotonicMs: view.nowMonotonicMs,
    lifetimeCurrent: view.lifetimeCurrent,
    channelHealthy: view.channelHealthy,
    perceptionSupported: view.perceptionSupported,
    playerCaptureRef: view.playerCaptureRef,
    recognized,
    playerRelationship: relationship && RELATIONSHIPS.has(relationship.state)
      ? { state: relationship.state, revision: integer(view.relationshipRevision) ? view.relationshipRevision : (integer(profile?.revision) ? profile.revision : 0) }
      : null,
    profileRevision: integer(profile?.revision) ? profile.revision : view.profileRevision,
    activity: view.activity,
    primaryOwner:view.primaryOwner,
    ownerProofRevision:view.ownerProofRevision,
    situationRevision: view.situationRevision,
    memories: profileMemories,
    traitPolicies,
    distanceBand: view.distanceBand,
  });
}

function classify(observation, situation) {
  const reasons = [];
  if (!situation.lifetimeCurrent) reasons.push('evidence_lifetime_ended');
  if (!situation.channelHealthy) reasons.push('evidence_channel_unhealthy');
  if (!situation.perceptionSupported) reasons.push('evidence_unsupported');
  if (observation.expiresAtMonotonicMs <= situation.nowMonotonicMs) reasons.push('evidence_expired');
  if (reasons.length) return { context: 'omit', memory: 'none', response: 'none', reasons, closed: true };

  const supported = observation.claims.filter(claim => claim.certainty === 'supported' && claim.evidence.channel !== 'report');
  if (!supported.length) return { context: 'candidate', memory: 'none', response: 'none', reasons: ['evidence_uncertain'], closed: true };

  // Radio is a low-priority factual candidate only. PS4's frozen, direct-question
  // selector determines visibility; no automatic memory or speech entitlement.
  if(observation.eventType==='radio_heard' && supported.some(claim=>claim.kind==='sound'&&claim.evidence.channel==='auditory'&&claim.details?.soundType==='radio')) {
    return {context:'candidate',memory:'none',response:'none',reasons:['routine_low_relevance'],closed:false};
  }
  const selfRef = observation.observer.captureRef;
  const playerRef = situation.playerCaptureRef;
  const kindOf = kind => supported.some(claim => claim.kind === kind);
  const selfHarm = supported.some(claim => claim.evidence.channel === 'self' && ['injured', 'dead', 'attack'].includes(claim.kind));
  const selfInvolved = selfHarm || supported.some(claim => claim.evidence.channel === 'self');
  const involves = (claim, ref) => Boolean(ref && (claim.target?.captureRef === ref || claim.source?.captureRef === ref));
  const playerHarm = Boolean(playerRef) && supported.some(claim => ['injured', 'dead', 'attack'].includes(claim.kind) && involves(claim, playerRef) && !involves(claim, selfRef));
  const playerInvolved = Boolean(playerRef) && supported.some(claim => involves(claim, playerRef));
  const hits = [...new Set(participantRefs(observation))].map(ref => recognizedHit(situation.recognized, ref)).filter(Boolean);
  const close = hits.filter(hit => CLOSE.has(hit.relationship));
  const conflict = hits.filter(hit => hit.relationship === 'strained');
  const playerClose = CLOSE.has(situation.playerRelationship?.state);
  const playerConflict = situation.playerRelationship?.state === 'strained';
  const death = observation.eventType === 'death_seen' || observation.eventType === 'body_found' || kindOf('dead');
  const injury = observation.eventType === 'injury' || observation.eventType === 'vehicle_impact' || kindOf('injured') || kindOf('attack');
  const firing = observation.eventType === 'firing_burst' || kindOf('firing');
  const routineEvent = ROUTINE_EVENTS.has(observation.eventType) && !selfHarm && !playerHarm && !death && !injury && !firing;
  const remembered = situation.memories.some(memory => memory.relatedCharacterIds.some(id => hits.some(hit => hit.characterId === id)));
  let context = 'omit', memory = 'none', response = 'none';

  if (selfHarm) {
    context = 'must_include'; memory = 'stage'; response = 'urgent';
    reasons.push('safety_self_danger', 'involvement_self');
  } else if (playerHarm) {
    context = 'must_include'; memory = 'stage'; response = 'eligible';
    reasons.push('safety_player_harm', 'involvement_player');
    if (playerClose) reasons.push('relationship_close');
    else if (playerConflict) reasons.push('relationship_conflict');
  } else if (death && close.length) {
    context = 'must_include'; memory = 'stage'; response = 'eligible';
    reasons.push('relationship_close', 'safety_nearby_threat');
  } else if ((death || injury) && conflict.length) {
    context = 'must_include'; memory = 'stage'; response = 'eligible';
    reasons.push('relationship_conflict', 'safety_nearby_threat');
  } else if (death) {
    context = 'must_include'; response = 'eligible';
    reasons.push('safety_nearby_threat');
  } else if (injury && close.length) {
    context = 'must_include'; memory = 'stage'; response = 'eligible';
    reasons.push('relationship_close', 'safety_nearby_threat');
  } else if (injury || firing) {
    // Any independently witnessed nearby gunfire or injury can merit one
    // brief, in-character reaction. A stranger getting shot is alarming even
    // when no character relationship/recognition binding exists. The source
    // witness receipt, supported non-report claim, native Director admission
    // and exact one-shot PS3 ledger still fence actual speech.
    // PS4 context ranking remains candidate unless the existing close/
    // self/player danger branches require must_include. Speech eligibility is
    // independent of PS4's separate safety-byte reservation.
    context = 'candidate';
    response = 'eligible';
    reasons.push('safety_nearby_threat');
    if (close.length) reasons.push('relationship_close');
    else if (conflict.length) reasons.push('relationship_conflict');
  } else if (playerInvolved) {
    context = 'candidate';
    reasons.push('involvement_player');
    if (playerClose) reasons.push('relationship_close');
    else if (playerConflict) reasons.push('relationship_conflict');
  } else if (close.length && !routineEvent) {
    context = 'candidate';
    reasons.push('relationship_close');
  } else if (conflict.length && !routineEvent) {
    context = 'candidate';
    reasons.push('relationship_conflict');
  }

  if (selfInvolved && !reasons.includes('involvement_self')) reasons.push('involvement_self');
  if (remembered) {
    if (context === 'omit') context = 'candidate';
    else if (context === 'candidate' && (close.length || conflict.length)) context = 'must_include';
    reasons.push('prior_memory');
  }
  if (OCCUPIED.has(situation.activity) && observation.eventType === 'vehicle_impact' && !selfHarm) {
    context = 'must_include';
    if (response === 'none') response = 'eligible';
    reasons.push('safety_nearby_threat');
  } else if (OCCUPIED.has(situation.activity) && routineEvent) {
    context = remembered ? 'candidate' : 'omit';
    response = 'none'; memory = 'none';
    reasons.push('situation_occupied');
  }
  if (situation.activity === 'conversation' && (observation.eventType === 'speech_heard' || observation.eventType === 'report') && response !== 'urgent') {
    if (context === 'omit') context = 'candidate';
    response = 'none';
    reasons.push('situation_conversation');
  }
  if ((situation.traitPolicies.includes('protective') || situation.traitPolicies.includes('loyal')) && close.length && context === 'omit') {
    context = 'candidate';
    reasons.push('trait_policy');
  }
  if (context === 'omit' && !reasons.length) reasons.push('routine_low_relevance');
  return { context, memory, response, reasons, closed: false };
}

function applyLedger(draft, observation, situation, cache) {
  if (!cache || draft.closed) return draft;
  cache.expire(situation.nowMonotonicMs);
  const policy = policyFingerprint(situation, observation);
  const existing = cache.ledger.get(observation.observationId);
  const family = cache.families.get(familyKey(observation));
  const severity = SEVERITY[observation.severity] ?? 0;
  const kinds = new Set(observation.claims.map(claim => claim.kind));
  const escalated = Boolean(existing && observation.revision > existing.revision && (
    severity > existing.severity || (kinds.has('dead') && !existing.kinds.has('dead')) || (kinds.has('attack') && !existing.kinds.has('attack'))
  ));
  const familyEscalated = Boolean(!existing && family && severity > family.severity);
  let { context, memory, response, reasons } = draft;
  const alreadyGranted = existing?.granted || 'none';
  if (existing && observation.revision < existing.revision) {
    response = 'none'; memory = 'none'; reasons = [...reasons, 'revision_stale'];
  } else if (escalated || familyEscalated) {
    reasons = [...reasons, 'novelty_escalation'];
  } else if (existing?.consumed && RESPONSE_RANK[response] <= RESPONSE_RANK[alreadyGranted]) {
    response = 'none';
    if (existing.memoryStaged) memory = 'none';
    reasons = [...reasons, 'repetition_suppressed'];
  } else if (existing && !existing.consumed && existing.granted !== 'none' && existing.policy === policy) {
    response = 'none'; memory = 'none';
    reasons = [...reasons, 'repetition_suppressed'];
  } else if (!existing && family?.consumed && severity <= family.severity) {
    response = 'none';
    if (family.memoryStaged) memory = 'none';
    reasons = [...reasons, 'repetition_suppressed'];
  } else if (!existing && (response !== 'none' || context !== 'omit')) {
    reasons = [...reasons, 'novelty_material'];
  }
  const known = cache.ledger.has(observation.observationId);
  // Never grant an entitlement that cannot be remembered. Under pressure the
  // ranker fails closed (context can remain useful) rather than evicting an old
  // grant and making a replay eligible again.
  const capacityFull = !known && (
    cache.ledger.size >= SALIENCE_BOUNDS.suppression ||
    (!family && cache.families.size >= SALIENCE_BOUNDS.suppression)
  );
  if (capacityFull && (response !== 'none' || memory === 'stage')) {
    response = 'none'; memory = 'none'; reasons = [...reasons, 'suppression_capacity'];
  }
  let grantEpoch = existing?.grantEpoch || 0;
  if ((response === 'eligible' || response === 'urgent') && (
    !existing || existing.granted === 'none' || existing.policy !== policy || escalated || familyEscalated
  )) grantEpoch += 1;
  return { context, memory, response, reasons, closed: false, policy, existing, family, severity, kinds, grantEpoch, escalated: escalated || familyEscalated };
}

export function evaluateSalience(observation, situationInput = {}, cache = null) {
  if (!validateObservation(observation)) return null;
  const situation = situationInput?.nowMonotonicMs !== undefined && Object.isFrozen(situationInput) && situationInput.traitPolicies
    ? situationInput
    : normalizeSalienceSituation(situationInput);
  const draft = applyLedger(classify(observation, situation), observation, situation, cache);
  const decision = blank(observation, situation.nowMonotonicMs, draft);
  if (cache && !draft.closed) cache.remember(observation, situation, decision, draft);
  else if (cache && draft.closed) cache.rememberClosed(observation, situation, decision);
  return decision;
}

export function salienceSortKey(entry) {
  const decision = entry.decision;
  const situation = entry.situation || {};
  const observation = entry.observation || {};
  const reasons = new Set(decision.reasons);
  const safety = decision.response === 'urgent' ? 5
    : reasons.has('safety_self_danger') || reasons.has('safety_player_harm') ? 4
    : decision.context === 'must_include' ? 3
    : reasons.has('safety_nearby_threat') ? 2
    : decision.context === 'candidate' ? 1 : 0;
  const involvement = reasons.has('involvement_self') ? 2 : reasons.has('involvement_player') ? 1 : 0;
  const relationship = reasons.has('relationship_close') ? 2 : reasons.has('relationship_conflict') ? 1 : 0;
  const novelty = reasons.has('novelty_escalation') ? 2 : reasons.has('novelty_material') ? 1 : 0;
  const traits = situation.traitPolicies || [];
  return [
    safety, involvement, relationship, novelty,
    Math.min(situation.distanceBand || 0, 2),
    observation.observedAt?.gameTick || 0,
    traits.includes('loyal') || traits.includes('protective') ? 1 : 0,
  ];
}
export function orderSalienceDecisions(entries) {
  return [...entries].sort((left, right) => {
    const a = salienceSortKey(left), b = salienceSortKey(right);
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return b[index] - a[index];
    return left.decision.observationId < right.decision.observationId ? -1 : left.decision.observationId > right.decision.observationId ? 1 : left.decision.revision - right.decision.revision;
  });
}

export class SalienceCache {
  constructor({ now = () => 0 } = {}) {
    this.now = now;
    this.decisions = new Map();
    this.order = [];
    this.ledger = new Map();
    this.families = new Map();
    this.latestById = new Map();
  }
  evaluate(observation, situation) { return evaluateSalience(observation, situation, this); }
  needsSituationRefresh(observation,situation) {
    const pair=this.decisions.get(observation.observationId)?.pair??this.ledger.get(observation.observationId)?.pair;
    if(!pair || pair.observation.revision!==observation.revision)return false;
    return pair.situation.profileRevision!==situation.profileRevision ||
      pair.situation.ownerProofRevision!==situation.ownerProofRevision ||
      !samePrimaryBehaviorOwner(pair.situation.primaryOwner,situation.primaryOwner) ||
      pair.situation.lifetimeCurrent!==situation.lifetimeCurrent ||
      pair.situation.channelHealthy!==situation.channelHealthy ||
      pair.situation.perceptionSupported!==situation.perceptionSupported ||
      pair.situation.playerCaptureRef!==situation.playerCaptureRef ||
      policyFingerprint(pair.situation,observation)!==policyFingerprint(situation,observation);
  }
  trimPairMetadata() {
    const pairs=new Map([...this.decisions.values(),...this.ledger.values(),...this.latestById.values()].filter(entry=>entry.pair).map(entry=>[entry.pair,entry.pairBytes]));
    let bytes=[...pairs.values()].reduce((sum,size)=>sum+size,0);
    for(const pair of orderSalienceDecisions([...pairs.keys()]).reverse()) {
      if(bytes<=2*1024*1024) break;
      for(const entry of [...this.decisions.values(),...this.ledger.values()]) if(entry.pair===pair) {delete entry.pair;delete entry.pairBytes;delete entry.observation;delete entry.situation;}
      const latest=this.latestById.get(pair.observation.observationId);if(latest?.pair===pair) this.latestById.set(pair.observation.observationId,Object.freeze({decision:latest.decision,profileRevision:latest.profileRevision,policy:latest.policy}));
      bytes-=pairs.get(pair);
    }
  }
  forgetObservation(observationId) {
    if(!isUuid(observationId))return false;
    const found=this.decisions.has(observationId)||this.ledger.has(observationId)||this.latestById.has(observationId);
    this.decisions.delete(observationId);this.ledger.delete(observationId);this.latestById.delete(observationId);
    return found;
  }
  snapshotForObserver(observerRef,observations,now=this.now(),diagnostics=null) {
    this.expire(now);const result=[],counts={observations:0,observationExpired:0,noMatchingSalience:0,revisionMismatch:0};
    for(const entry of observations.entries.values()) {
      const observation=entry.value;if(observation.observer.captureRef!==observerRef)continue;counts.observations++;if(observation.expiresAtMonotonicMs<=now){counts.observationExpired++;continue;}
      const pair=this.decisions.get(observation.observationId)?.pair ?? this.ledger.get(observation.observationId)?.pair;
      if(!pair){counts.noMatchingSalience++;continue;}
      if(pair.observation.revision!==observation.revision || pair.observation.observedAt.nativeRun!==observation.observedAt.nativeRun || pair.decision.revision!==observation.revision || pair.decision.expiresAtMonotonicMs<=now){counts.revisionMismatch++;continue;}
      result.push(pair);if(result.length>=128) break;
    }
    if(diagnostics)Object.assign(diagnostics,counts);
    return Object.freeze(orderSalienceDecisions(result));
  }
  // PS4's P0 frame is immutable, while PS3 may legitimately recalculate its
  // current decision key before the model finishes. The caller has just
  // revalidated the frozen frame, owner, refs and channel at model completion.
  // Reconcile only the exact same live observation; never borrow a later
  // revision/actor or a retired payload, and never change PS6 grant semantics.
  acknowledgeFrozenContext(decisionKeyValue, frozenPair, outcome) {
    const original = frozenPair?.observation, decision = frozenPair?.decision;
    if (typeof decisionKeyValue !== 'string' ||
        !['delivered', 'rejected', 'expired'].includes(outcome) ||
        !original || !decision ||
        decision.decisionKey !== decisionKeyValue ||
        decision.observationId !== original.observationId ||
        decision.revision !== original.revision ||
        decision.policyVersion !== SALIENCE_POLICY_VERSION) return false;
    const entry = this.ledger.get(original.observationId);
    const currentPair = entry?.pair, now = this.now();
    if (!currentPair ||
        entry.expires <= now ||
        entry.revision !== original.revision ||
        entry.decisionKey !== currentPair.decision.decisionKey ||
        currentPair.decision.revision !== original.revision ||
        original.expiresAtMonotonicMs <= now ||
        decision.expiresAtMonotonicMs <= now ||
        currentPair.observation.expiresAtMonotonicMs <= now ||
        currentPair.decision.expiresAtMonotonicMs <= now ||
        JSON.stringify(currentPair.observation) !== JSON.stringify(original)) return false;
    // Consumption remains scoped to PS4 context; the current PS6 key/grant
    // never becomes usable through the frozen key.
    return this.acknowledge(entry.decisionKey, 'ps4_context', outcome);
  }
  acknowledge(decisionKeyValue, consumer, outcome) {
    if (typeof decisionKeyValue !== 'string' || !['ps4_context', 'ps6_ticket', 'ps5_memory'].includes(consumer) || !['delivered', 'rejected', 'expired'].includes(outcome)) return false;
    const hit = [...this.ledger.entries()].find(([, entry]) => entry.decisionKey === decisionKeyValue);
    if (!hit) return false;
    const [, entry] = hit;
    if (!(entry.consumedBy instanceof Set)) entry.consumedBy = new Set(entry.consumedBy || []);
    if (outcome === 'delivered') {
      entry.consumedBy.add(consumer);
      if (consumer === 'ps6_ticket') {
        entry.consumed = true;
        const family = this.families.get(entry.familyKey);
        if (family) family.consumed = true;
      }
      return true;
    }
    if (consumer === 'ps6_ticket' && !entry.consumed) entry.granted = 'none';
    return true;
  }
  releaseReference(ref) {
    const uses=pair=>pair.observation.observer.captureRef===ref || pair.observation.claims.some(claim=>claim.source?.captureRef===ref || claim.target?.captureRef===ref || claim.details?.vehicle===ref);
    for(const entry of [...this.decisions.values(),...this.ledger.values()])if(entry.pair && uses(entry.pair)){delete entry.pair;delete entry.pairBytes;delete entry.observation;delete entry.situation;}
    for(const [id,entry] of this.latestById)if(entry.pair && uses(entry.pair))this.latestById.set(id,Object.freeze({decision:entry.decision,profileRevision:entry.profileRevision,policy:entry.policy}));
  }
  clear() { this.decisions.clear(); this.order = []; this.ledger.clear(); this.families.clear(); this.latestById.clear(); }
  expire(now = this.now()) {
    for (const [id, entry] of this.ledger) {
      if(entry.expires<=now)this.ledger.delete(id);
      else if(entry.pair && (entry.pair.observation.expiresAtMonotonicMs<=now || entry.pair.decision.expiresAtMonotonicMs<=now)){delete entry.pair;delete entry.pairBytes;delete entry.observation;delete entry.situation;}
    }
    for (const [key, entry] of this.families) if (entry.expires <= now) this.families.delete(key);
    for (const [id, entry] of this.decisions) if (entry.decision.expiresAtMonotonicMs <= now) this.forgetDecision(id);
    for (const [id, entry] of this.latestById) if (entry.decision.expiresAtMonotonicMs <= now) this.latestById.delete(id);
  }
  rememberLatest(id, entry) {
    this.latestById.delete(id);
    this.latestById.set(id, entry);
    while (this.latestById.size > SALIENCE_BOUNDS.decisions) {
      const oldest = this.latestById.keys().next().value;
      if (!oldest) break;
      this.latestById.delete(oldest);
    }
  }
  forgetDecision(id) {
    this.decisions.delete(id);
    this.latestById.delete(id);
    this.order = this.order.filter(key => key !== id);
  }
  evictDecisions(observer) {
    const observers = id => this.decisions.get(id)?.observer === observer;
    while ([...this.decisions.values()].filter(entry => entry.observer === observer).length > SALIENCE_BOUNDS.perObserver) {
      const oldest = this.order.find(observers);
      if (!oldest) break;
      this.forgetDecision(oldest);
    }
    while (this.decisions.size > SALIENCE_BOUNDS.decisions) {
      const oldest = this.order[0];
      if (!oldest) break;
      this.forgetDecision(oldest);
    }
  }
  rememberClosed(observation, situation, decision) {
    this.rememberLatest(observation.observationId, Object.freeze({ decision, profileRevision: situation.profileRevision, policy: null }));
  }
  remember(observation, situation, decision, draft) {
    const pair=immutableSnapshot({observation,situation,decision});
    const pairBytes=Buffer.byteLength(JSON.stringify(pair));
    const now = situation.nowMonotonicMs;
    const expires = now + SALIENCE_BOUNDS.suppressionTtlMs;
    const grant = decision.response === 'eligible' || decision.response === 'urgent';
    const existing = draft.existing;
    if (this.ledger.has(observation.observationId) || this.ledger.size < SALIENCE_BOUNDS.suppression) {
      const kinds = new Set([...(existing?.kinds || []), ...draft.kinds]);
      this.ledger.set(observation.observationId, {
        revision: Math.max(observation.revision, existing?.revision || 0),
        severity: Math.max(draft.severity, existing?.severity || 0),
        kinds,
        policy: draft.policy,
        granted: grant ? (RESPONSE_RANK[decision.response] >= RESPONSE_RANK[existing?.granted || 'none'] ? decision.response : existing.granted) : (existing?.granted || 'none'),
        consumed: Boolean(existing?.consumed),
        consumedBy: new Set(existing?.consumedBy || []),
        pair,pairBytes,
        decisionKey: decision.decisionKey,
        grantEpoch: draft.grantEpoch || existing?.grantEpoch || 0,
        familyKey: familyKey(observation),
        memoryStaged: Boolean(existing?.memoryStaged) || decision.memory === 'stage',
        expires,
      });
    }
    const key = familyKey(observation);
    const family = this.families.get(key);
    const trackFamily = grant || decision.memory === 'stage' || Boolean(existing?.consumed) || Boolean(existing?.memoryStaged) || Boolean(family?.consumed) || Boolean(family?.memoryStaged);
    if (trackFamily && (family || this.families.size < SALIENCE_BOUNDS.suppression)) {
      this.families.set(key, {
        severity: Math.max(draft.severity, family?.severity || 0),
        consumed: Boolean(family?.consumed) || Boolean(existing?.consumed),
        memoryStaged: Boolean(family?.memoryStaged) || decision.memory === 'stage',
        expires,
      });
    }
    this.forgetDecision(observation.observationId);
    this.decisions.set(observation.observationId, { observer: observation.observer.captureRef, ...pair, pair,pairBytes, at: now });
    this.order.push(observation.observationId);
    this.rememberLatest(observation.observationId, Object.freeze({ ...pair, pair,pairBytes, profileRevision: situation.profileRevision, policy: draft.policy }));
    this.evictDecisions(observation.observer.captureRef);
    this.trimPairMetadata();
    if (!DECISION_KEYS.every(field => Object.hasOwn(decision, field))) throw new Error('salience_decision_shape');
  }
}
