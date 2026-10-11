import { readFile, stat } from 'node:fs/promises';
import { createSpeechPcmProvider } from './speechProvider.mjs';
import { createFasterQwenSpeechProvider } from './qwenSpeechProvider.mjs';
import { createSpeechRouter, parseVoiceAssignments } from './speechContract.mjs';

const VOICE = /^[a-z][a-z0-9_-]{0,31}$/;
const parsePool = (text, fallback) => {
  const list = text ? text.split(',').map(v => v.trim()) : [fallback];
  if (!list.length || list.length > 32 || list.some(v => !VOICE.test(v)) ||
      new Set(list).size !== list.length)
    throw new Error('invalid_configured_speech_voices');
  return list;
};

// Env values are operator-supplied only, never generated model commands.
// Persistent assignments are inert unless an *independently proven* native
// stable-character binding resolver is supplied by a future integration.
export async function createConfiguredSpeechRouter(
  env = process.env, { fetchImpl = globalThis.fetch, resolveVerifiedCharacter = null } = {}
) {
  const primary = env.LSA_STANDALONE_TTS_PROVIDER ?? 'openai';
  const voice = env.LSA_STANDALONE_TTS_VOICE;
  if (!VOICE.test(voice ?? '')) throw new Error('speech_provider_configuration_missing');

  const providers = {};
  if (env.OPENAI_API_KEY && env.LSA_STANDALONE_TTS_MODEL) {
    providers.openai = createSpeechPcmProvider({
      apiKey: env.OPENAI_API_KEY, model: env.LSA_STANDALONE_TTS_MODEL,
      voice, fetchImpl
    });
  }
  const qwenVoices = primary === 'faster-qwen3-tts' ||
    env.LSA_STANDALONE_QWEN_VOICES
    ? parsePool(env.LSA_STANDALONE_QWEN_VOICES, voice) : null;
  if (qwenVoices) {
    providers['faster-qwen3-tts'] = createFasterQwenSpeechProvider({
      baseUrl: env.LSA_STANDALONE_QWEN_URL,
      voices: qwenVoices, fetchImpl
    });
  }

  let assignments = null;
  const filename = env.LSA_STANDALONE_VOICE_ASSIGNMENTS;
  if (filename) {
    if (typeof filename !== 'string' || filename.length > 512)
      throw new Error('invalid_voice_assignment_path');
    const info = await stat(filename);
    if (!info.isFile() || info.size > 65536)
      throw new Error('invalid_voice_assignment_file');
    assignments = parseVoiceAssignments(JSON.parse(
      await readFile(filename, 'utf8')
    ));
  }
  const sessionVoices = parsePool(env.LSA_STANDALONE_TTS_SESSION_VOICES, voice);
  if (primary === 'faster-qwen3-tts' &&
      sessionVoices.some(v => !qwenVoices.includes(v)))
    throw new Error('qwen_session_voice_not_registered');

  return createSpeechRouter({
    providers, defaultProfile: {
      provider: primary, voice,
      ...(env.LSA_STANDALONE_TTS_INSTRUCTIONS
        ? { instructions: env.LSA_STANDALONE_TTS_INSTRUCTIONS } : {})
    },
    sessionVoices, assignments, resolveVerifiedCharacter
  });
}
