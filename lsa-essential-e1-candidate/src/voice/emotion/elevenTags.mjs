import { isDelivery } from './deliveryContract.mjs';

export const ELEVEN_TAG_FOR_DELIVERY = Object.freeze({
  whisper: '[whispers]',
  excited: '[excited]',
  angry: '[angry]',
  amused: '[laughs]',
  sad: '[sad]',
  sarcastic: '[sarcastic]',
});
export const ELEVEN_SPEECH_MAX_CHARS = 3000;

// Only this pure renderer can add trusted vendor syntax. A Luna/user-authored
// bracket span is *always* neutralized in the experimental TTS-only copy, even
// for unsupported or neutral intents. Off/shadow must call with enabled=false
// and remain byte-identical to the original provider input.
export function renderElevenSpeech({ dialogue, delivery = null, enabled = false } = {}) {
  if (typeof dialogue !== 'string' || !dialogue.trim())
    throw new TypeError('ElevenLabs dialogue must be nonempty text.');
  if (dialogue.length > ELEVEN_SPEECH_MAX_CHARS)
    throw new RangeError('ElevenLabs dialogue exceeds 3000 characters.');
  if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean.');
  if (!enabled) return dialogue;
  // Quoted bracket contents survive verbatim; only punctuation changes in this
  // temporary speech copy. Prevents arbitrary [sfx]/[whispers] injection.
  const safeText = dialogue.replaceAll('[', '\u201c').replaceAll(']', '\u201d');
  const tag = isDelivery(delivery) && Object.hasOwn(ELEVEN_TAG_FOR_DELIVERY, delivery.value)
    ? ELEVEN_TAG_FOR_DELIVERY[delivery.value] : null;
  return tag && tag.length + 1 + safeText.length <= ELEVEN_SPEECH_MAX_CHARS
    ? tag + ' ' + safeText : safeText;
}
