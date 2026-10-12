import { isUuid } from '../../identity/identityContract.mjs';
import { createDelivery, NEUTRAL_DELIVERY } from './deliveryContract.mjs';
import { validateObservation } from '../../perception/contracts.mjs';

// EA1 is a pure intent selector. No TTS tags, network calls, storage, native
// effects, player-facing claims, or extra Luna inference may occur here.
export const SCENE_DELIVERY_BOUNDS = Object.freeze({
  maxObservations: 32,
  maxSegmentChars: 3000,
  maxEvidenceAgeMs: 12000,
  dangerAgeMs: 6000,
  impactAgeMs: 8000,
  repeatedValueCooldownMs: 6500,
  defaultMaxTaggedSegmentsPerTurn: 2,
});

const NEUTRAL = NEUTRAL_DELIVERY;
const SOURCE = new Set(['player_text', 'player_mic', 'special_event', 'scene_director', 'director', 'internal']);
const INTENSITIES = new Set(['subtle', 'normal', 'expressive']);
const IDENTITY_KEYS = Object.freeze([
  'characterId', 'observerCaptureRef', 'incarnationId', 'ownerProofRevision',
  'hostRunId', 'worldEpoch', 'nativeRun', 'pedId', 'sessionNonce',
  'turnId', 'generationId',
]);
const UUID_KEYS = new Set(['characterId', 'observerCaptureRef', 'incarnationId', 'hostRunId', 'nativeRun']);
const DIRECT = new Set(['self', 'visual', 'auditory']);
const LUNA_SOFT = new Set(['amused', 'sad', 'sarcastic', 'whisper', 'excited']);
const PRIORITIES = Object.freeze({ danger: 5, death: 4, injury: 3, impact: 2 });
const AGE = Object.freeze({ danger: 6000, death: 12000, injury: 12000, impact: 8000 });

function boundedToken(value) {
  return (typeof value === 'string' && value.length > 0 && value.length <= 128 &&
    !/[\u0000-\u001f\u007f]/.test(value)) ||
    (Number.isSafeInteger(value) && value >= 0);
}

function validIdentity(identity) {
  return !!identity && typeof identity === 'object' &&
    IDENTITY_KEYS.every(key => Object.hasOwn(identity, key) &&
      (UUID_KEYS.has(key) ? isUuid(identity[key]) :
        ['ownerProofRevision', 'worldEpoch'].includes(key)
          ? Number.isSafeInteger(identity[key]) && identity[key] > 0
          : boundedToken(identity[key]))) &&
    (!Object.hasOwn(identity, 'timelineId') ||
      identity.timelineId === null || isUuid(identity.timelineId));
}

function sameIdentity(a, b) {
  return validIdentity(a) && validIdentity(b) &&
    IDENTITY_KEYS.every(key => a[key] === b[key]) &&
    (a.timelineId ?? null) === (b.timelineId ?? null);
}

// This projection MUST be constructed by the current owner/PS runtime from an
// authenticated P1/P2 native owner binding and PS2 observation-store entries.
// Matching strings and verifiedOwner=true are not substitutes for that proof.
// A missing host/epoch/native-run/Essential turn fence always fails closed.
function eligibleProjection(identity, evidence) {
  return !!evidence && Object.isFrozen(evidence) &&
    evidence.verifiedOwner === true && evidence.lifetimeCurrent === true &&
    evidence.channelHealthy === true &&
    Object.isFrozen(evidence.identity) && sameIdentity(identity, evidence.identity) &&
    Array.isArray(evidence.observations) &&
    Object.isFrozen(evidence.observations) &&
    evidence.observations.length <= SCENE_DELIVERY_BOUNDS.maxObservations;
}

function traitsForOwner(identity, actorTraits) {
  if (!actorTraits || actorTraits.characterId !== identity.characterId) return new Set();
  const raw = actorTraits.personality?.traits ?? actorTraits.traits;
  if (!Array.isArray(raw) || raw.length > 12) return new Set();
  return new Set(raw.filter(item => typeof item === 'string' && item.length <= 80)
    .map(item => item.trim().toLowerCase()));
}

function classify(observation, claim, traits) {
  const kind = claim.kind;
  if (observation.eventType === 'firing_burst' && kind === 'firing' ||
      observation.eventType === 'threat' && kind === 'attack') {
    return { family: 'danger', value: traits.has('bold') && !traits.has('cautious')
      ? 'excited' : 'fearful' };
  }
  if ((observation.eventType === 'death_seen' || observation.eventType === 'body_found') &&
      kind === 'dead') return { family: 'death', value: 'sad' };
  if (observation.eventType === 'injury' && kind === 'injured')
    return { family: 'injury', value: 'concerned' };
  // A PS2 vehicle_damage event can establish impact/damage but not rollover,
  // injury to a person, a cause, or what other observers know.
  if (observation.eventType === 'vehicle_impact' && kind === 'injured')
    return { family: 'impact', value: traits.has('bold') ? 'excited' : 'concerned' };
  return null;
}

function bestVerifiedScene(identity, evidence, now, traits) {
  let best = null;
  for (const row of evidence.observations) {
    const observation = row?.observation;
    const observedAt = row?.observedAtMonotonicMs;
    // The PS validator is a closed schema validator, but malformed nested
    // detail objects may throw instead of returning false. This hot-path
    // caller must never let corrupt/untrusted evidence interrupt TTS.
    let schemaValid = false;
    try { schemaValid = validateObservation(observation); } catch { /* fail neutral */ }
    if (!row || !Object.isFrozen(row) || !schemaValid ||
        observation.observer.captureRef !== identity.observerCaptureRef ||
        observation.observedAt.nativeRun !== identity.nativeRun ||
        !Number.isSafeInteger(observedAt) || observedAt < 0 || observedAt > now ||
        observation.expiresAtMonotonicMs <= now) continue;
    const age = now - observedAt;
    if (age > SCENE_DELIVERY_BOUNDS.maxEvidenceAgeMs) continue;
    for (const claim of observation.claims) {
      if (claim.certainty !== 'supported' || !DIRECT.has(claim.evidence.channel) ||
          claim.evidence.sampledGameTick !== observation.observedAt.gameTick) continue;
      // Validated PS2 'self' claims require native self evidence; reports and
      // mere world incidents never establish what this observer perceived.
      const decision = classify(observation, claim, traits);
      if (!decision || age > AGE[decision.family]) continue;
      const candidate = { ...decision, age, evidenceRef: observation.observationId,
        priority: PRIORITIES[decision.family] };
      if (!best || candidate.priority > best.priority ||
          candidate.priority === best.priority && candidate.age < best.age)
        best = candidate;
    }
  }
  return best;
}

function conversationalCue(text, traits) {
  // Cue means acting style, never a claim that a world event occurred.
  // Tight anchors avoid making neutral text emotional because it mentions
  // another person's laughter, anger, danger or sadness.
  if (/^\s*(?:ha(?:ha)+[!,.\s]|heh[!,.\s]|lol[!.,\s])/i.test(text) ||
      /\b(?:that's hilarious|you crack me up)\b/i.test(text))
    return { value: 'amused', source: 'dialogue_cue', confidence: 'soft' };
  if (traits.has('sarcastic') || traits.has('wry')) {
    if (/\b(?:yeah,\s*right|oh,\s*sure|as if)\b/i.test(text))
      return { value: 'sarcastic', source: 'dialogue_cue', confidence: 'soft' };
  }
  if (/^\s*(?:are you (?:all )?okay\?|are you hurt\?|i'm sorry for your loss\b)/i.test(text))
    return { value: 'concerned', source: 'dialogue_cue', confidence: 'soft' };
  return null;
}

function currentDialogueResetsMood(text) {
  // An NPC's own clear, present-tense denial of a previous feeling defeats
  // soft carry. This is NOT native evidence and does not claim a scene event.
  // Keep the anchors conservative; ordinary topic changes may retain mood.
  return /^\s*(?:(?:i['’]m|i am)\s+(?:fine|okay|alright|all right|calm)(?:\s+now)?|(?:i['’]m|i am)\s+not\s+(?:sad|scared|afraid|upset)(?:\s+(?:now|anymore))?|(?:there['’]s|there is)\s+nothing\s+to\s+worry\s+about)[.!?]?\s*$/i.test(text);
}

function priorForIdentity(identity, prior, now) {
  if (!prior || !Object.isFrozen(prior) || !Object.isFrozen(prior.identity) ||
      !sameIdentity(identity, prior.identity)) return null;
  const count = prior.taggedSegmentsInTurn;
  if (!Number.isSafeInteger(count) || count < 0 || count > 256) return null;
  const lastAt = prior.lastTaggedAtMonotonicMs;
  if (lastAt !== null && lastAt !== undefined &&
      (!Number.isSafeInteger(lastAt) || lastAt < 0 || lastAt > now)) return null;
  return { count, lastAt, lastValue: prior.lastValue };
}

function delivery(value, source, confidence, intensity, evidenceRef = null) {
  return createDelivery({ version: 1, value, source, confidence, intensity, evidenceRef });
}

/**
 * Resolve one immutable normalized EA0 delivery intent for one complete NPC
 * speech segment. The caller supplies a current, owner-verified, deeply frozen
 * snapshot; this function never reads global state. The original text is never
 * modified or returned. See docs/handoffs/EA1.md for the exact input contract.
 */
export function resolveDelivery({
  identity, segmentText, source, nowMonotonicMs,
  currentSceneEvidence, actorTraits, priorEphemeralMood, priorCooldown = null,
  config, lunaHint = null,
} = {}) {
  if (config?.mode !== 'shadow' && config?.mode !== 'experimental') return NEUTRAL;
  if (!validIdentity(identity) || !SOURCE.has(source) ||
      !Number.isSafeInteger(nowMonotonicMs) || nowMonotonicMs < 0 ||
      typeof segmentText !== 'string' || !segmentText.trim() ||
      segmentText.length > SCENE_DELIVERY_BOUNDS.maxSegmentChars ||
      /^\s*\[[^\]\r\n]{1,48}\]\s*$/.test(segmentText) ||
      !eligibleProjection(identity, currentSceneEvidence)) return NEUTRAL;

  const intensitySetting = INTENSITIES.has(config.intensity) ? config.intensity : 'subtle';
  const budget = config.maxTaggedSegmentsPerTurn === undefined
    ? SCENE_DELIVERY_BOUNDS.defaultMaxTaggedSegmentsPerTurn
    : config.maxTaggedSegmentsPerTurn;
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 8) return NEUTRAL;
  // The ephemeral mood remains a soft style cue. A separately authenticated
  // playback timestamp supplies cooldown without changing that mood's shape.
  const prior = priorForIdentity(identity, priorCooldown ?? priorEphemeralMood, nowMonotonicMs);
  if (prior && prior.count >= budget || budget === 0) return NEUTRAL;

  const traits = traitsForOwner(identity, actorTraits);
  const scene = bestVerifiedScene(identity, currentSceneEvidence, nowMonotonicMs, traits);
  // A soft mood is style-only; it is NEVER promoted to scene evidence, and
  // freshly witnessed danger or the speaker's current words outrank it.
  const mood = priorEphemeralMood && Object.isFrozen(priorEphemeralMood) &&
    ['amused','sad','concerned','fearful','whisper'].includes(priorEphemeralMood.value)
    ? {value:priorEphemeralMood.value,source:'ephemeral_mood',confidence:'soft'} : null;
  const candidate = scene
    ? { value: scene.value, source: 'verified_scene', confidence: 'supported',
        evidenceRef: scene.evidenceRef }
    : conversationalCue(segmentText, traits) ??
      (currentDialogueResetsMood(segmentText) ? null : (LUNA_SOFT.has(lunaHint)
        ? {value:lunaHint, source:'luna_hint', confidence:'soft'} : mood));
  if (!candidate) return NEUTRAL;
  // Suppress repeated performance, never carrying a scene event over into a
  // future segment/turn without freshly verified evidence. Agent EA4 owns mood.
  if (prior?.lastValue === candidate.value && prior.lastAt !== null &&
      prior.lastAt !== undefined &&
      nowMonotonicMs - prior.lastAt < SCENE_DELIVERY_BOUNDS.repeatedValueCooldownMs)
    return NEUTRAL;
  const intensity = traits.has('stoic') || traits.has('reserved')
    ? 'subtle' : intensitySetting;
  return delivery(candidate.value, candidate.source, candidate.confidence,
    intensity, candidate.evidenceRef ?? null);
}
