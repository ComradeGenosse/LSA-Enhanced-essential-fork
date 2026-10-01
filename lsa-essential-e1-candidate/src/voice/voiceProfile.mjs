import { createHash } from 'node:crypto';

const VOICE_ID = /^[a-z][a-z0-9_-]{0,31}$/;
const INSTRUCTIONS_MAX = 512;

export function isVoiceSupportedByModel(model, voice) {
  const id = String(voice || '').trim().toLowerCase();
  if (!VOICE_ID.test(id)) return false;
  if (model === 'tts-1' || model === 'tts-1-hd') {
    return ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'].includes(id);
  }
  if (/^gpt-4o-mini-tts(?:-|$)/.test(String(model || ''))) {
    return ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'].includes(id);
  }
  return false;
}

export function buildVoiceInstructions(enabled) {
  if (!enabled) return '';
  const instructions = 'Speak naturally and conversationally as a grounded character. Match emotion implied by the dialogue without exaggeration. Say only the supplied words: do not add, omit, paraphrase, or repeat them.';
  if (instructions.length > INSTRUCTIONS_MAX) throw new Error('Speech acting instructions exceed the configured limit.');
  return instructions;
}

function identityBytes(identity) {
  const ped = Buffer.from(String(identity.pedId), 'utf8');
  if (!ped.length || ped.length > 256) throw new TypeError('Voice assignment requires a bounded pedId.');
  if (!Number.isSafeInteger(identity.sessionNonce) || identity.sessionNonce < 1) throw new TypeError('Voice assignment requires a positive sessionNonce.');
  const prefix = Buffer.from('lsa-session-voice\0v1\0', 'utf8');
  const pedLength = Buffer.allocUnsafe(4);
  pedLength.writeUInt32BE(ped.length);
  const nonce = Buffer.allocUnsafe(8);
  nonce.writeBigUInt64BE(BigInt(identity.sessionNonce));
  return Buffer.concat([prefix, pedLength, ped, nonce]);
}

export function resolveVoiceProfile({ identity, config }) {
  if (!identity || typeof identity !== 'object') throw new TypeError('A native session identity is required for voice assignment.');
  const voices = config.speechVoices;
  if (!Array.isArray(voices) || voices.length === 0 || voices.some(voice => typeof voice !== 'string' || !voice.trim() || voice.length > 128)) {
    throw new TypeError('The configured speech voice pool is invalid.');
  }
  if (voices.length > 1 && voices.some(voice => !VOICE_ID.test(voice) || !isVoiceSupportedByModel(config.ttsModel, voice))) {
    throw new TypeError('The configured TTS model does not support every voice in speechVoices.');
  }
  const digest = createHash('sha256').update(identityBytes(identity)).digest();
  const voice = voices.length === 1 ? voices[0] : voices[digest.readUInt32BE(0) % voices.length];
  const instructions = buildVoiceInstructions(config.actingEnabled === true);
  if (instructions && config.speechInstructionsSupported !== true) throw new TypeError('The configured TTS model does not support speech instructions.');
  return Object.freeze({
    profileId: `vp_${digest.subarray(0, 10).toString('hex')}`,
    provider: 'openai',
    model: config.ttsModel,
    voice,
    speed: config.ttsSpeed,
    instructions,
    assignmentVersion: 1,
  });
}
