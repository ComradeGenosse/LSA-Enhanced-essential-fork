import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { VoiceResolver } from '../src/voice/voiceResolver.mjs';
import { isVoiceSupportedByModel } from '../src/voice/voiceProfile.mjs';

function identity(pedId = '17', sessionNonce = 9) { return { pedId, turnId: 'ignored-turn', generationId: 1, sessionNonce }; }

test('voice profile is deterministic per ped and native session, independent of turn identity', () => {
  const config = normalizeConfig({ speechVoices: ['nova', 'ash', 'onyx', 'shimmer'] }, {});
  const resolver = new VoiceResolver(config);
  const first = resolver.resolve(identity());
  const repeat = resolver.resolve({ ...identity(), turnId: 'next-turn', generationId: 99 });
  assert.deepEqual(first, repeat);
  assert.match(first.profileId, /^vp_[a-f0-9]{20}$/);
  assert.equal(first.assignmentVersion, 1);
  assert.equal(Object.isFrozen(first), true);
});

test('session voice assignments use the configured voice pool with varied deterministic profiles', () => {
  const config = normalizeConfig({ speechVoices: ['nova', 'ash', 'onyx', 'shimmer'] }, {});
  const resolver = new VoiceResolver(config);
  const assignments = Array.from({ length: 48 }, (_, sessionNonce) => resolver.resolve(identity('17', sessionNonce + 1)).voice);
  assert.ok(new Set(assignments).size > 1);
  assert.ok(assignments.every(voice => config.speechVoices.includes(voice)));
});

test('legacy fixed voice becomes a singleton pool and retains existing TTS defaults', () => {
  const config = normalizeConfig({ ttsVoice: 'echo' }, {});
  assert.deepEqual(config.speechVoices, ['echo']);
  assert.equal(new VoiceResolver(config).resolve(identity()).voice, 'echo');
  assert.equal(config.ttsSpeed, 1);
  assert.equal(config.voiceAssignment, 'deterministic-session');
  assert.equal(config.actingEnabled, false);
});

test('multi-voice pool validates duplicates and model-specific support', () => {
  assert.throws(() => normalizeConfig({ speechVoices: [] }, {}), /nonempty array/);
  assert.throws(() => normalizeConfig({ speechVoices: ['nova', 'nova'] }, {}), /duplicates/);
  assert.throws(() => normalizeConfig({ ttsModel: 'tts-1', speechVoices: ['nova', 'marin'] }, {}), /unsupported/);
  assert.throws(() => normalizeConfig({ ttsModel: 'custom-tts', speechVoices: ['nova', 'ash'] }, {}), /Cannot validate/);
  assert.equal(isVoiceSupportedByModel('tts-1', 'nova'), true);
  assert.equal(isVoiceSupportedByModel('tts-1', 'marin'), false);
  assert.equal(isVoiceSupportedByModel('gpt-4o-mini-tts', 'cedar'), true);
});

test('speed and acting capability fail clearly when unsupported', () => {
  for (const speed of [0.249, 4.001, Infinity, NaN]) assert.throws(() => normalizeConfig({ ttsSpeed: speed }, {}), /ttsSpeed/);
  assert.equal(normalizeConfig({ ttsSpeed: 4 }, {}).ttsSpeed, 4);
  assert.throws(() => normalizeConfig({ ttsModel: 'tts-1', actingEnabled: true }, {}), /requires a TTS model/);
  assert.equal(normalizeConfig({ actingEnabled: true }, {}).speechInstructionsSupported, true);
});

test('profile instructions are bounded trusted templates and preserve the chosen model', () => {
  const config = normalizeConfig({ actingEnabled: true }, {});
  const profile = new VoiceResolver(config).resolve(identity());
  assert.equal(profile.model, 'gpt-4o-mini-tts');
  assert.match(profile.instructions, /do not add, omit, paraphrase, or repeat/);
  assert.ok(profile.instructions.length <= 512);
  assert.equal(JSON.stringify(profile).includes('question'), false);
});
