// EA2 integration adapter. Only the locally injected, trusted selector may request acting.
import { createDelivery, isDelivery } from './deliveryContract.mjs';
// This module never writes to canonical dialogue, history or the memory journal.
const MODES = new Set(['shadow', 'experimental']);
const VALUES = new Set(['neutral','whisper','excited','fearful','angry','amused','sad','sarcastic','concerned']);
const SOURCES = new Set(['verified_scene','luna_hint','dialogue_cue','neutral']);
const TAGGABLE = new Set(['whisper','excited','angry','amused','sad','sarcastic']);
const CONFIDENCES = new Set(['supported','soft']);
const INTENSITIES = new Set(['subtle','normal','expressive']);
const NOOP = Object.freeze({
  forSegment: () => null, synthesized: () => {}, retire: () => {},
});

function normalizeHint(candidate, intensity) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
      candidate.version !== 1 || !VALUES.has(candidate.value) ||
      !SOURCES.has(candidate.source) || !CONFIDENCES.has(candidate.confidence) ||
      !INTENSITIES.has(candidate.intensity) ||
      (candidate.evidenceRef !== null &&
       (typeof candidate.evidenceRef !== 'string' || candidate.evidenceRef.length > 128)))
    return null;
  // No extra vendor tags, display strings or private fields can pass this seam.
  if (Object.keys(candidate).some(key =>
      !['version','value','source','confidence','intensity','evidenceRef'].includes(key))) return null;
  // EA0's renderer accepts only locally branded, validated intents. The
  // injected selector is an internal trust boundary, never raw Luna JSON.
  try { return isDelivery(candidate) ? candidate : createDelivery(candidate); }
  catch { return null; }
}

function safeTelemetry(telemetry, data) {
  try { telemetry?.event?.('acting_decision', data); }
  catch { /* Telemetry must not break speech. */ }
}

/**
 * Create one resolver per native-bound turn, NOT per process/actor.
 *
 * integration's services.emotionalActing:
 *   resolveDelivery({identity,segmentText,sequence,source,nowMonotonicMs,
 *     currentSceneEvidence,actorTraits,priorEphemeralMood,config,lunaHint})
 *   getSceneEvidence({identity,turn,source})   // verified bounded PS projection
 *   getActorTraits({identity,turn})            // existing P2 personality snapshot
 *   readMood({identity,turn})                  // EA4 optional, identity-fenced
 *   onSpeechCompleted({identity,turn,delivery}) // EA4 optional
 *   retireTurn({identity,turn})                // EA4 optional
 *
 * With no injected EA1 resolver, this is neutral even if EA3 proposes a hint.
 * No asynchronous calls, ownership widening, extra Luna requests or native IO.
 */
export function createSpeechDeliveryResolver({
  config, identity, source, turn, adapter, telemetry, isActive,
  clock = () => performance.now(),
} = {}) {
  const settings = config?.expressiveDelivery;
  if (config?.speechProvider !== 'elevenlabs' || !MODES.has(settings?.mode) ||
      typeof adapter?.resolveDelivery !== 'function')
    return NOOP;
  const mode = settings.mode;
  const max = Number.isInteger(settings.maxTaggedSegmentsPerTurn)
    ? Math.max(0, Math.min(8, settings.maxTaggedSegmentsPerTurn)) : 2;
  const intensity = INTENSITIES.has(settings.intensity) ? settings.intensity : 'subtle';
  let taggedCount = 0;
  let retired = false;
  let lastSequence = 0;
  const active = () => !retired && isActive?.() === true;
  return Object.freeze({
    forSegment({ text, sequence, lunaHint = null } = {}) {
      if (!active() || typeof text !== 'string' || !text.trim()) return null;
      // A specific positive ordinal prevents replaying or double charging a hint
      // after the early stream has started. Buffered utterances use ordinal 1.
      if (!Number.isSafeInteger(sequence) || sequence <= lastSequence || sequence > 256) return null;
      lastSequence = sequence;
      let candidate = null;
      try {
        const currentSceneEvidence = adapter.getSceneEvidence?.({identity,turn,source}) ?? null;
        candidate = adapter.resolveDelivery({
          identity: currentSceneEvidence?.identity ?? identity, segmentText: text, sequence, source,
          nowMonotonicMs: Math.floor(clock()),
          currentSceneEvidence,
          actorTraits: adapter.getActorTraits?.({identity,turn}) ?? null,
          priorEphemeralMood: adapter.readMood?.({identity,turn}) ?? null,
          config: settings,
          // Unverified model hint is only a proposal to EA1. Never send it
          // to ElevenLabs without the selector's normalized decision.
          lunaHint: VALUES.has(lunaHint) ? lunaHint : null,
        });
      } catch { /* A resolver failure always falls back to neutral speech. */ }
      const normalized = normalizeHint(candidate, intensity);
      const isTag = normalized && TAGGABLE.has(normalized.value) &&
        normalized.value !== 'neutral' && taggedCount < max;
      const delivery = isTag ? normalized : null;
      if (delivery) taggedCount++;
      // Strict categorical telemetry only. Never include raw dialogue, owner,
      // evidenceRef, prompts, transcript, conversation text or mood contents.
      safeTelemetry(telemetry, {
        mode, selected: normalized?.value ?? 'neutral',
        source: normalized?.source ?? 'neutral',
        confidence: normalized?.confidence ?? 'soft',
        acted: mode === 'experimental' && !!delivery,
        segmentSequence: sequence,
        evidenceCategory: 'unknown', evidenceAge: 'unknown',
      });
      return delivery;
    },
    synthesized(delivery, receipt) {
      if (!active() || !delivery || !receipt || receipt.ok !== true ||
          receipt.type !== 'playback_ended' || receipt.wasInterrupted !== false ||
          receipt.hadAudio !== true || receipt.playbackStarted !== true) return;
      try { adapter.onSpeechCompleted?.({identity,turn,delivery,receipt}); }
      catch { /* Ephemeral mood may never interrupt PCM forwarding. */ }
    },
    retire() {
      if (retired) return;
      retired = true;
      try { adapter.retireTurn?.({identity,turn}); }
      catch { /* No process-global mood may outlive a failed/retired turn. */ }
    },
  });
}
