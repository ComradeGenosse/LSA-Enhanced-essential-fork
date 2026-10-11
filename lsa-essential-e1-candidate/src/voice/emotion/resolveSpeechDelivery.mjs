// EA2 integration adapter. Only the locally injected, trusted selector may request acting.
import { createDelivery, isDelivery } from './deliveryContract.mjs';
import { ELEVEN_SPEECH_MAX_CHARS, validateElevenSpeechDialogue,
  verifiedElevenTagForDelivery } from './elevenTags.mjs';
import { wasElevenTagApplied } from '../../providers/elevenlabs/speechProvider.mjs';
// This module never writes to canonical dialogue, history or the memory journal.
const MODES = new Set(['shadow', 'experimental']);
const VALUES = new Set(['neutral','whisper','excited','fearful','angry','amused','sad','sarcastic','concerned']);
const SOURCES = new Set(['verified_scene','luna_hint','dialogue_cue','ephemeral_mood','neutral']);
const CONFIDENCES = new Set(['supported','soft']);
const INTENSITIES = new Set(['subtle','normal','expressive']);
const MOOD_SOURCES = new Set(['verified_scene','dialogue_cue','luna_hint']);
const MOOD_VALUES = new Set(['amused','sad','concerned','fearful','whisper']);
const NOOP = Object.freeze({
  forSegment: () => null, synthesized: () => false,
  complete: () => false, retire: () => {},
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

function receiptKeysMismatch(receipt, identity) {
  // The authoritative MoodRuntime requires every identity receipt field.
  // This seam additionally rejects *explicitly conflicting* fields, while
  // preserving legacy adapter tests that supply partial mocked receipts.
  return ['pedId','sessionNonce','turnId','generationId'].some(key =>
    Object.hasOwn(receipt,key) && receipt[key] !== identity?.[key]);
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
// Native playback proof is separate from successful provider text emission.
// A missing field, interrupted stream, superseded reason or cross-owner tuple
// must fail neutral, even if PCM was synthesized or a tag was selected.
function isFullNativePlaybackReceipt(receipt, identity) {
  try {
    return receipt?.type === 'playback_ended' && receipt.ok === true &&
      receipt.reason === 'completed' && receipt.wasInterrupted === false &&
      receipt.hadAudio === true && receipt.playbackStarted === true &&
      ['pedId','sessionNonce','turnId','generationId'].every(
        key => receipt[key] === identity?.[key] && identity?.[key] !== undefined);
  } catch { return false; }
}

export function createSpeechDeliveryResolver({
  config, identity, source, turn, adapter, telemetry, isActive,
  clock = () => performance.now(),
} = {}) {
  const settings = config?.expressiveDelivery;
  if (config?.speechProvider !== 'elevenlabs' || !MODES.has(settings?.mode) ||
      typeof adapter?.resolveDelivery !== 'function') return NOOP;
  const mode = settings.mode;
  const modelId = config?.elevenLabs?.modelId;
  const max = Number.isInteger(settings.maxTaggedSegmentsPerTurn)
    ? Math.max(0, Math.min(8, settings.maxTaggedSegmentsPerTurn)) : 2;
  const intensity = INTENSITIES.has(settings.intensity) ? settings.intensity : 'subtle';
  let selectedCount = 0;
  let retired = false;
  let lastSequence = 0;
  let completedReceiptUsed = false;
  const byDelivery = new WeakMap(); // segment-scoped, not a shared Luna object
  const acknowledgments = new Map(); // only real provider-completed tags
  const active = () => !retired && isActive?.() === true;
  return Object.freeze({
    forSegment({ text, sequence, lunaHint = null } = {}) {
      if (!active() || typeof text !== 'string' || !text.trim()) return null;
      // Each early or buffered speech segment owns a unique positive ordinal.
      if (!Number.isSafeInteger(sequence) || sequence <= lastSequence || sequence > 256) return null;
      lastSequence = sequence;
      try { validateElevenSpeechDialogue(text); } catch { return null; }
      let candidate = null;
      try {
        const currentSceneEvidence = adapter.getSceneEvidence?.({identity,turn,source}) ?? null;
        candidate = adapter.resolveDelivery({
          identity: currentSceneEvidence?.identity ?? identity,
          segmentText:text, sequence, source,
          nowMonotonicMs:Math.floor(clock()),
          currentSceneEvidence,
          actorTraits:adapter.getActorTraits?.({identity,turn}) ?? null,
          priorEphemeralMood:adapter.readMood?.({identity,turn}) ?? null,
          config:settings,
          lunaHint:VALUES.has(lunaHint) ? lunaHint : null,
        });
      } catch { /* never interrupt ordinary speech on a selector exception */ }
      const normalized = normalizeHint(candidate, intensity);
      // Shared with the actual provider renderer: fearful is legal ONLY on
      // verified Turbo, concerned remains unsupported on every model.
      const tag = normalized
        ? verifiedElevenTagForDelivery(normalized.value, modelId) : null;
      const eligible = typeof tag === 'string' && selectedCount < max &&
        text.length + tag.length + 1 <= ELEVEN_SPEECH_MAX_CHARS;
      // Mint a fresh, branded intent per segment. A selector may reuse the
      // SAME frozen object, but duplicate/late callbacks must not impersonate
      // a different segment or overwrite the actual final audible choice.
      let delivery = null;
      if (eligible) {
        try {
          delivery = createDelivery({
            version:normalized.version, value:normalized.value,
            source:normalized.source, confidence:normalized.confidence,
            intensity:normalized.intensity, evidenceRef:normalized.evidenceRef,
          });
        } catch { delivery = null; }
      }
      if (delivery) {
        selectedCount++;
        byDelivery.set(delivery,sequence);
      }
      safeTelemetry(telemetry,{
        mode, selected:normalized?.value ?? 'neutral',
        source:normalized?.source ?? 'neutral',
        confidence:normalized?.confidence ?? 'soft',
        eligible:!!delivery, acted:false, tagApplied:false,
        segmentSequence:sequence,
        evidenceCategory:'unknown', evidenceAge:'unknown',
      });
      return delivery;
    },
    // Agent F calls this only AFTER stock accepted native playback/history,
    // once for EACH rendered segment with its own real speak() return object.
    // No applied-result proof means no mood, even for a valid native receipt.
    synthesized(delivery, receipt, providerResult) {
      if (!active() || mode !== 'experimental' || completedReceiptUsed ||
          !delivery || !byDelivery.has(delivery) ||
          !isFullNativePlaybackReceipt(receipt, identity) ||
          !wasElevenTagApplied(providerResult,{delivery,identity}) ||
          acknowledgments.has(delivery)) return false;
      const sequence = byDelivery.get(delivery);
      acknowledgments.set(delivery,{sequence,providerResult});
      safeTelemetry(telemetry,{
        mode, tagApplied:true, segmentSequence:sequence,
        selected:delivery.value,
      });
      return true;
    },
    // Agent F MUST call this exactly once only after the complete
    // history.acceptPlaybackResult result was true and all segment callbacks
    // were submitted. Select by ORIGINAL speech ordinal, not callback arrival.
    complete(receipt,{historyAccepted=false}={}) {
      if (!active() || mode !== 'experimental' || completedReceiptUsed ||
          historyAccepted !== true ||
          !isFullNativePlaybackReceipt(receipt,identity)) return false;
      completedReceiptUsed = true; // prevents replay even if adapter throws
      let selected = null;
      for (const [delivery,ack] of acknowledgments) {
        if (!MOOD_VALUES.has(delivery.value) || !MOOD_SOURCES.has(delivery.source))
          continue; // ephemeral_mood can NEVER re-seed itself
        if (!selected || ack.sequence > selected.sequence)
          selected = {delivery,providerResult:ack.providerResult,sequence:ack.sequence};
      }
      if (!selected) return false;
      try {
        return adapter.onSpeechCompleted?.({
          identity,turn,delivery:selected.delivery,receipt,
          providerResult:selected.providerResult,historyAccepted:true,
        }) === true;
      } catch { return false; } // no PCM/history failure from soft continuity
    },
    retire(completed=false) {
      if (retired) return;
      retired = true;
      acknowledgments.clear();
      try {adapter.retireTurn?.({identity,turn,completed:completed===true});}
      catch { /* cancellation never alters stock audio or history */ }
    },
  });
}
