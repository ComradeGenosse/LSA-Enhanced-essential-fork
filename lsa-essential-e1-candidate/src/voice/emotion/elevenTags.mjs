import { isDelivery } from './deliveryContract.mjs';

// EA0's original six-value map remains compatible with its frozen contract.
// EA8's additional verified v4 mapping is intentionally separate until the
// shared EA2 resolver is updated by the final integration owner.
export const ELEVEN_TAG_FOR_DELIVERY = Object.freeze({
  whisper: '[whispers]',
  excited: '[excited]',
  angry: '[angry]',
  amused: '[laughs]',
  sad: '[sad]',
  sarcastic: '[sarcastic]',
});

// ElevenLabs' September 30, 2026 official Eleven v4 audio-tag guide includes
// [scared], explicitly supported on v4 Turbo. "concerned" remains untagged:
// substituting [anxious] or [thoughtful] would change its intended emotion.
export const ELEVEN_V4_VERIFIED_TAG_FOR_DELIVERY = Object.freeze({
  ...ELEVEN_TAG_FOR_DELIVERY,
  fearful: '[scared]',
});
// Selector and provider must use the same exact opt-in model gate.
export function verifiedElevenTagForDelivery(value, modelId) {
  if (modelId !== 'eleven_v4_turbo' || typeof value !== 'string' ||
      !Object.hasOwn(ELEVEN_V4_VERIFIED_TAG_FOR_DELIVERY, value)) return null;
  return ELEVEN_V4_VERIFIED_TAG_FOR_DELIVERY[value];
}
export const ELEVEN_SPEECH_MAX_CHARS = 3000;

const BRACKET_TO_QUOTE = Object.freeze({
  '[': '\u201c', ']': '\u201d',
  '\uff3b': '\u201c', '\uff3d': '\u201d',
  '\u3010': '\u201c', '\u3011': '\u201d',
  '\ufe5d': '\u201c', '\ufe5e': '\u201d',
  '\u27e6': '\u201c', '\u27e7': '\u201d',
  '\u2772': '\u201c', '\u2773': '\u201d',
  '\u3016': '\u201c', '\u3017': '\u201d',
  '\u3018': '\u201c', '\u3019': '\u201d',
  '\u3014': '\u201c', '\u3015': '\u201d',
});
const BRACKET_PATTERN = /[\[\]\uff3b\uff3d\u3010\u3011\ufe5d\ufe5e\u27e6\u27e7\u2772\u2773\u3016\u3017\u3018\u3019\u3014\u3015]/g;

// The conservative 3000 limit is counted in UTF-16 code units: a surrogate
// pair costs two units, never less than the vendor's Unicode character count.
// Reject malformed UTF-16 instead of silently sending replacement glyphs.
export function validateElevenSpeechDialogue(dialogue) {
  if (typeof dialogue !== 'string' || !dialogue.trim())
    throw new TypeError('ElevenLabs dialogue must be nonempty text.');
  if (dialogue.length > ELEVEN_SPEECH_MAX_CHARS)
    throw new RangeError('ElevenLabs dialogue exceeds 3000 characters.');
  for (let i = 0; i < dialogue.length; i++) {
    const unit = dialogue.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = dialogue.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new TypeError('ElevenLabs dialogue contains invalid Unicode.');
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new TypeError('ElevenLabs dialogue contains invalid Unicode.');
    }
  }
  return dialogue;
}

// Raw dialogue can contain arbitrary [audio tags]. Only a validated internal
// intent is permitted to introduce bracket syntax into the temporary TTS copy.
// Never normalize canonical dialogue, early segments, histories, or memory.
export function sanitizeElevenSpeechDialogue(dialogue) {
  return validateElevenSpeechDialogue(dialogue).replace(BRACKET_PATTERN,
    bracket => BRACKET_TO_QUOTE[bracket]);
}

export function renderElevenSpeech({ dialogue, delivery = null, enabled = false, modelId = null } = {}) {
  validateElevenSpeechDialogue(dialogue);
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean.');
  if (!enabled) return dialogue; // off/shadow: exact original provider bytes
  const safeText = sanitizeElevenSpeechDialogue(dialogue);
  // Unspecified models retain EA0's frozen six-value behavior. The new
  // fearful tag is enabled only with an explicit verified v4 Turbo model.
  // Pure EA0 stand-alone calls with no explicit model retain the original
  // six-tag renderer contract. A specified unsupported model fails neutral.
  // Actual provider and resolver paths ALWAYS pass an explicit model ID.
  const tag = isDelivery(delivery)
    ? (modelId === null && Object.hasOwn(ELEVEN_TAG_FOR_DELIVERY, delivery.value)
      ? ELEVEN_TAG_FOR_DELIVERY[delivery.value]
      : verifiedElevenTagForDelivery(delivery.value, modelId))
    : null;
  return tag && tag.length + 1 + safeText.length <= ELEVEN_SPEECH_MAX_CHARS
    ? tag + ' ' + safeText : safeText;
}
