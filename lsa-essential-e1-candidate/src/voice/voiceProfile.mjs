import { createHash } from 'node:crypto';
import { AGE_BANDS, actorVoiceTraits } from './actorVoiceTraits.mjs';

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

function ageDistance(a, b) {
  const ai = AGE_BANDS.indexOf(a);
  const bi = AGE_BANDS.indexOf(b);
  if (ai < 0 || bi < 0) return Number.POSITIVE_INFINITY;
  return Math.abs(ai - bi);
}

function describeAgeInstruction(ageBand) {
  switch (ageBand) {
    case 'young': return 'Use a natural young-adult vocal quality and cadence.';
    case 'adult': return 'Use a natural adult vocal quality and cadence.';
    case 'mature': return 'Use a mature adult vocal quality and cadence without exaggerating age.';
    case 'older': return 'Use a natural older-adult vocal quality and cadence without caricaturing age.';
    case 'senior': return 'Use a natural senior-adult vocal quality and cadence without sounding frail unless the dialogue itself implies it.';
    default: return '';
  }
}

export function buildVoiceInstructions(options, legacyTraits = {}) {
  const enabled = typeof options === 'boolean' ? options : options?.enabled === true;
  const traits = typeof options === 'boolean' ? legacyTraits : (options?.traits || {});
  if (!enabled) return '';

  const parts = ['Speak naturally and conversationally as a grounded character.'];
  if (traits.gender === 'male') parts.push('Use a naturally masculine vocal presentation.');
  else if (traits.gender === 'female') parts.push('Use a naturally feminine vocal presentation.');
  const ageInstruction = describeAgeInstruction(traits.ageBand);
  if (ageInstruction) parts.push(ageInstruction);
  parts.push('Match emotion implied by the dialogue without exaggeration.');
  parts.push('Say only the supplied words: do not add, omit, paraphrase, or repeat them.');
  const instructions = parts.join(' ');
  if (instructions.length > INSTRUCTIONS_MAX) throw new Error('Speech acting instructions exceed the configured limit.');
  return instructions;
}

function identityBytes(identity, assignmentVersion = 1) {
  const ped = Buffer.from(String(identity.pedId), 'utf8');
  if (!ped.length || ped.length > 256) throw new TypeError('Voice assignment requires a bounded pedId.');
  if (!Number.isSafeInteger(identity.sessionNonce) || identity.sessionNonce < 1) throw new TypeError('Voice assignment requires a positive sessionNonce.');
  const prefix = Buffer.from(`lsa-session-voice\0v${assignmentVersion}\0`, 'utf8');
  const pedLength = Buffer.allocUnsafe(4);
  pedLength.writeUInt32BE(ped.length);
  const nonce = Buffer.allocUnsafe(8);
  nonce.writeBigUInt64BE(BigInt(identity.sessionNonce));
  return Buffer.concat([prefix, pedLength, ped, nonce]);
}

function digestFor(identity, assignmentVersion) {
  return createHash('sha256').update(identityBytes(identity, assignmentVersion)).digest();
}

function selectLegacyVoice(identity, config) {
  const voices = config.speechVoices;
  const digest = digestFor(identity, 1);
  return Object.freeze({
    voice: voices.length === 1 ? voices[0] : voices[digest.readUInt32BE(0) % voices.length],
    matchReason: 'deterministic-session',
  });
}

function scoreProfile(profile, traits) {
  let score = 0;

  if (traits.gender !== 'unknown') {
    if (profile.genders.includes(traits.gender)) score += 100;
    else if (profile.genders.includes('any')) score += 40;
    else return Number.NEGATIVE_INFINITY;
  } else {
    score += profile.genders.includes('any') ? 10 : 5;
  }

  if (traits.ageBand !== 'unknown') {
    if (profile.ageBands.includes(traits.ageBand)) score += 50;
    else if (profile.ageBands.includes('any')) score += 15;
    else {
      const distances = profile.ageBands
        .filter(value => value !== 'any')
        .map(value => ageDistance(value, traits.ageBand));
      const nearest = distances.length ? Math.min(...distances) : Number.POSITIVE_INFINITY;
      if (nearest === 1) score += 20;
      else if (nearest === 2) score += 5;
      else score -= 20;
    }
  }

  return score;
}

function matchReason(profile, traits) {
  const genderExact = traits.gender === 'unknown' || profile.genders.includes(traits.gender);
  const ageExact = traits.ageBand === 'unknown' || profile.ageBands.includes(traits.ageBand);
  if (genderExact && ageExact) return 'character-aware-exact';
  if (genderExact) return 'character-aware-nearest-age';
  return 'character-aware-compatible';
}

function selectCharacterVoice(identity, traits, config) {
  const profiles = config.speechVoices
    .map(voice => config.speechVoiceProfiles?.[voice])
    .filter(Boolean);
  const scored = profiles
    .map(profile => ({ profile, score: scoreProfile(profile, traits) }))
    .filter(item => Number.isFinite(item.score));

  if (!scored.length) {
    const fallback = selectLegacyVoice(identity, config);
    return Object.freeze({ ...fallback, matchReason: 'fallback-no-compatible-profile' });
  }

  const highest = Math.max(...scored.map(item => item.score));
  const finalists = scored.filter(item => item.score === highest).map(item => item.profile);
  const digest = digestFor(identity, 2);
  const selected = finalists[digest.readUInt32BE(0) % finalists.length];
  return Object.freeze({ voice: selected.voice, matchReason: matchReason(selected, traits) });
}

export function resolveVoiceProfile({ identity, actor = {}, config }) {
  if (!identity || typeof identity !== 'object') throw new TypeError('A native session identity is required for voice assignment.');
  const voices = config.speechVoices;
  if (!Array.isArray(voices) || voices.length === 0 || voices.some(voice => typeof voice !== 'string' || !voice.trim() || voice.length > 128)) {
    throw new TypeError('The configured speech voice pool is invalid.');
  }
  if (voices.length > 1 && voices.some(voice => !VOICE_ID.test(voice) || !isVoiceSupportedByModel(config.ttsModel, voice))) {
    throw new TypeError('The configured TTS model does not support every voice in speechVoices.');
  }

  const traits = actorVoiceTraits(actor);
  const characterAware = config.voiceAssignment === 'character-aware-session';
  const assignmentVersion = characterAware ? 2 : 1;
  const selection = characterAware
    ? selectCharacterVoice(identity, traits, config)
    : selectLegacyVoice(identity, config);
  const digest = digestFor(identity, assignmentVersion);
  const instructionTraits = characterAware ? traits : {};
  const instructions = buildVoiceInstructions({ enabled: config.actingEnabled === true, traits: instructionTraits });
  if (instructions && config.speechInstructionsSupported !== true) throw new TypeError('The configured TTS model does not support speech instructions.');

  return Object.freeze({
    profileId: `vp_${digest.subarray(0, 10).toString('hex')}`,
    provider: 'openai',
    model: config.ttsModel,
    voice: selection.voice,
    speed: config.ttsSpeed,
    instructions,
    assignmentVersion,
    selectionMode: characterAware ? 'character-aware-session' : 'deterministic-session',
    gender: traits.gender,
    ageBand: traits.ageBand,
    matchReason: selection.matchReason,
  });
}
