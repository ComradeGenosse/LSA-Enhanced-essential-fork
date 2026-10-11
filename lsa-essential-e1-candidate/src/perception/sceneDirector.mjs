// PS6/13a selection only. This module never admits a native turn, writes a
// memory, acknowledges a salience grant, constructs a prompt or issues effects.
// The C-11 admission shell must independently revalidate every selected fact.
export const DIRECTOR_SPEECH_LIMITS = Object.freeze({
  globalInFlight: 1,
  sceneReservations: 1,
  attemptsPerMinute: 4,
  attemptWindowMs: 60_000,
  routineSpeakerCooldownMs: 20_000,
  urgentSpeakerCooldownMs: 5_000,
  sceneGapMs: 8_000,
  routineCandidateTtlMs: 10_000,
  urgentCandidateTtlMs: 2_000,
  pendingTickets: 32,
  ticketTtlMs: 2_000,
});

// Experimental testing changes pacing and the bounded attempt budget,
// not PS3 evidence freshness, dedupe, or native C-06 admission.
// Native runtime independently requires its own matching testing preset.
// Deliberately fixed presets: do not accept arbitrary user-supplied limits.
export const DIRECTOR_TESTING_LIMITS = Object.freeze({
  ...DIRECTOR_SPEECH_LIMITS,
  routineSpeakerCooldownMs: 5_000,
  urgentSpeakerCooldownMs: 2_000,
  sceneGapMs: 2_000,
  attemptsPerMinute: 12,
});
export function directorSpeechLimitsForPreset(preset='normal') {
  if(preset==='normal')return DIRECTOR_SPEECH_LIMITS;
  if(preset==='testing')return DIRECTOR_TESTING_LIMITS;
  throw new TypeError('unsupported_director_speech_preset');
}

const positive = n => Number.isSafeInteger(n) && n >= 0;
const ref = n => typeof n === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(n);
const responseRank = value => value === 'urgent' ? 2 : value === 'eligible' ? 1 : 0;

/**
 * Selects a single unprivileged proposal from a bounded, already observer-
 * qualified PS2/PS3 candidate slice. A proposal is not permission to speak.
 *
 * Each candidate must carry a source-time monotonic observation timestamp and
 * a current-entitlement proof furnished by the existing PS3 ledger. No guess
 * from the observation TTL, latest actor, game tick or freeform text is made.
 */
export function selectDirectorIntent(candidates, facts = {}) {
  if (!Array.isArray(candidates) || candidates.length > 128 ||
      !ref(facts.speakerCaptureRef) || !ref(facts.playerCaptureRef) ||
      !positive(facts.nowMonotonicMs)) return null;

  const eligible = [];
  for (const candidate of candidates) {
    const { observation: o, decision: d, situation: s } = candidate ?? {};
    if (!o || !d || !s || candidate.entitlementCurrent !== true ||
        o.observer?.captureRef !== facts.speakerCaptureRef ||
        o.observer?.kind !== 'ped' ||
        s.lifetimeCurrent !== true || s.channelHealthy !== true ||
        s.perceptionSupported !== true ||
        s.playerCaptureRef !== facts.playerCaptureRef ||
        !ref(o.observationId) || !positive(o.revision) || o.revision === 0 ||
        d.observationId !== o.observationId || d.revision !== o.revision ||
        typeof d.decisionKey !== 'string' || d.decisionKey.length > 160 ||
        d.decisionKey.length === 0 || d.policyVersion !== 1 ||
        responseRank(d.response) === 0 ||
        !positive(o.expiresAtMonotonicMs) ||
        !positive(d.expiresAtMonotonicMs) ||
        !positive(candidate.observedAtMonotonicMs)) continue;
    const age = facts.nowMonotonicMs - candidate.observedAtMonotonicMs;
    const ttl = d.response === 'urgent'
      ? DIRECTOR_SPEECH_LIMITS.urgentCandidateTtlMs
      : DIRECTOR_SPEECH_LIMITS.routineCandidateTtlMs;
    if (age < 0 || age >= ttl ||
        o.expiresAtMonotonicMs <= facts.nowMonotonicMs ||
        d.expiresAtMonotonicMs <= facts.nowMonotonicMs ||
        !Array.isArray(o.claims) ||
        !o.claims.some(c => c?.certainty === 'supported' && c.evidence?.channel !== 'report')) continue;
    eligible.push({o,d,ttl,at:candidate.observedAtMonotonicMs});
  }

  // Deterministic, independent of Map insertion or candidate arrival order.
  eligible.sort((a,b) => responseRank(b.d.response) - responseRank(a.d.response)
    || b.at - a.at
    || a.o.observationId.localeCompare(b.o.observationId)
    || a.o.revision - b.o.revision);
  const chosen = eligible[0];
  if (!chosen) return null;
  return Object.freeze({
    kind: 'speech',
    speakerCaptureRef: facts.speakerCaptureRef,
    playerCaptureRef: facts.playerCaptureRef,
    observationId: chosen.o.observationId,
    observationRevision: chosen.o.revision,
    decisionKey: chosen.d.decisionKey,
    policyVersion: chosen.d.policyVersion,
    urgency: chosen.d.response === 'urgent' ? 'urgent' : 'routine',
    expiresAtMonotonicMs: Math.min(
      chosen.at + chosen.ttl,
      chosen.o.expiresAtMonotonicMs,
      chosen.d.expiresAtMonotonicMs,
    ),
  });
}
