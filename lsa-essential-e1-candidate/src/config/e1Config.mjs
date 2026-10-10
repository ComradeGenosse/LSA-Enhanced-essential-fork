import {normalizeDialogueKnowledge} from './dialogueKnowledge.mjs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeIdentityConfig } from '../identity/identityContract.mjs';
import { normalizeCharacterConfig } from '../characters/characterService.mjs';
import { normalizePerceptionConfig } from '../perception/contracts.mjs';
import { normalizeActivityConfig } from '../activities/contracts.mjs';
import { normalizeDialogueLoggingConfig } from '../observability/dialogueTrace.mjs';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultConfigPath = path.resolve(moduleDirectory, '../../e1.config.json');

const VOICE_PROFILE_GENDERS = new Set(['male', 'female', 'any']);
const VOICE_PROFILE_AGE_BANDS = new Set(['young', 'adult', 'mature', 'older', 'senior', 'any']);

function supportedVoicesForModel(ttsModel, speechInstructionsSupported) {
  if (speechInstructionsSupported) return ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'];
  if (['tts-1', 'tts-1-hd'].includes(ttsModel)) return ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'];
  return null;
}

function normalizeProfileValues(value, allowed, fallback, name) {
  const list = value === undefined ? fallback : value;
  if (!Array.isArray(list) || list.length === 0) throw new TypeError(`${name} must be a nonempty array.`);
  const normalized = list.map(item => String(item).trim().toLowerCase());
  if (normalized.some(item => !allowed.has(item))) throw new TypeError(`${name} contains an unsupported value.`);
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${name} cannot contain duplicates.`);
  if (normalized.includes('any') && normalized.length > 1) throw new TypeError(`${name} cannot combine "any" with specific values.`);
  return Object.freeze(normalized);
}

function normalizeSpeechVoiceProfiles(input, { speechVoices, supportedVoices, voiceAssignment }) {
  if (input === undefined || input === null) {
    if (voiceAssignment === 'character-aware-session') throw new TypeError('character-aware-session requires speechVoiceProfiles.');
    return Object.freeze({});
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('speechVoiceProfiles must be an object.');
  if (!supportedVoices) throw new TypeError('Cannot validate speechVoiceProfiles for the configured TTS model.');

  const normalized = {};
  for (const [rawVoice, rawProfile] of Object.entries(input)) {
    const voice = String(rawVoice).trim().toLowerCase();
    if (!voice || normalized[voice]) throw new TypeError('speechVoiceProfiles contains an invalid or duplicate voice key.');
    if (!speechVoices.includes(voice)) throw new TypeError(`speechVoiceProfiles.${voice} is not present in speechVoices.`);
    if (!supportedVoices.includes(voice)) throw new TypeError(`speechVoiceProfiles.${voice} is unsupported by the configured TTS model.`);
    if (!rawProfile || typeof rawProfile !== 'object' || Array.isArray(rawProfile)) throw new TypeError(`speechVoiceProfiles.${voice} must be an object.`);
    normalized[voice] = Object.freeze({
      voice,
      genders: normalizeProfileValues(rawProfile.genders, VOICE_PROFILE_GENDERS, ['any'], `speechVoiceProfiles.${voice}.genders`),
      ageBands: normalizeProfileValues(rawProfile.ageBands, VOICE_PROFILE_AGE_BANDS, ['any'], `speechVoiceProfiles.${voice}.ageBands`),
    });
  }

  if (voiceAssignment === 'character-aware-session') {
    const keys = Object.keys(normalized);
    if (keys.length !== speechVoices.length || speechVoices.some(voice => !normalized[voice])) {
      throw new TypeError('character-aware-session requires one speechVoiceProfiles entry for every configured speech voice.');
    }
    const profiles = Object.values(normalized);
    const maleCovered = profiles.some(profile => profile.genders.includes('male') || profile.genders.includes('any'));
    const femaleCovered = profiles.some(profile => profile.genders.includes('female') || profile.genders.includes('any'));
    if (!maleCovered || !femaleCovered) throw new TypeError('character-aware-session requires voice coverage for both male and female NPCs (or an any-gender profile).');
  }

  return Object.freeze(normalized);
}

function boundedInteger(value, fallback, min, max, name) {
  const number = Number(value ?? fallback);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new TypeError(`${name} must be an integer from ${min} to ${max}.`);
  }
  return number;
}

function baseUrl(value, fallback, name) {
  const raw = String(value ?? fallback).trim();
  let parsed;
  try { parsed = new URL(raw); } catch { throw new TypeError(`${name} must be an absolute HTTP(S) URL.`); }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError(`${name} must be an HTTP(S) base URL without credentials, query, or fragment.`);
  }
  return raw.replace(/\/+$/, '');
}

export function normalizeConfig(input = {}, env = process.env) {
  // Phase 13a is opt-in and independent of PS observation collection. The
  // experimental setting requests production speech, but never bypasses the
  // separately verified native/Essential runtime capability gate.
  const speechInput=input.spontaneousSpeech===undefined ? {} : input.spontaneousSpeech;
  if(!speechInput || typeof speechInput!=='object' || Array.isArray(speechInput) ||
     Object.keys(speechInput).some(key=>key!=='mode'))
    throw new TypeError('spontaneousSpeech must contain only a mode.');
  const speechMode=speechInput.mode ?? 'off';
  if(!['off','shadow','experimental'].includes(speechMode))
    throw new TypeError('spontaneousSpeech.mode must be off, shadow, or experimental.');
  if(speechMode!=='off' && input.intelligence?.mode!=='shadow')
    throw new TypeError('spontaneousSpeech requires intelligence.mode=shadow.');
  const selectedProvider = String(input.provider ?? env.AI_PROVIDER ?? 'openai').trim().toLowerCase();
  if (!['openai', 'gemini'].includes(selectedProvider)) throw new TypeError('E1 provider must be openai or gemini.');
  const defaults = {
    reasoningModel: 'gpt-6-luna', reasoningEffort: 'low', transcriptionModel: 'gpt-transcribe',
    ttsModel: 'gpt-4o-mini-tts', ttsVoice: 'nova', maxOutputTokens: 300,
    turnDeadlineMs: 45_000, maxMicDurationMs: 30_000, maxHistoryMessages: 12,
    structuredStreamingEnabled: false, earlyTtsEnabled: false,
    streamingMaxOutputTokens: 600, streamingMaxSegments: 6,
    streamingMaxSegmentChars: 240, streamingMaxDialogueChars: 1200, streamingMaxPcmBytes: 6_291_456,
    retry: { enabled: true, maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 3_000, honorRetryAfter: true, jitter: 'bounded', minAttemptBudgetMs: 1_000, attemptTimeoutMs: null },
    observabilityEnabled: true, observabilityMaxFileBytes: 10 * 1024 * 1024,
    observabilityMaxTotalBytes: 100 * 1024 * 1024, observabilityMaxFiles: 5,
    dialogueLogging: { enabled: false, maxFileBytes: 10 * 1024 * 1024, maxTotalBytes: 50 * 1024 * 1024, maxFiles: 5, maxPayloadBytes: 256 * 1024 },
  };
  const reasoningModel = String(input.reasoningModel ?? env.OPENAI_REASONING_MODEL ?? defaults.reasoningModel).trim();
  const transcriptionModel = String(input.transcriptionModel ?? env.OPENAI_TRANSCRIPTION_MODEL ?? defaults.transcriptionModel).trim();
  const ttsModel = String(input.ttsModel ?? env.OPENAI_TTS_MODEL ?? defaults.ttsModel).trim();
  const ttsVoice = String(input.ttsVoice ?? env.OPENAI_TTS_VOICE ?? defaults.ttsVoice).trim();
  const reasoningEffort = String(input.reasoningEffort ?? env.OPENAI_REASONING_EFFORT ?? defaults.reasoningEffort).trim().toLowerCase();
  if (input.observabilityEnabled !== undefined && typeof input.observabilityEnabled !== 'boolean') throw new TypeError('observabilityEnabled must be a boolean.');
  if (input.actingEnabled !== undefined && typeof input.actingEnabled !== 'boolean') throw new TypeError('actingEnabled must be a boolean.');
  if (input.structuredStreamingEnabled !== undefined && typeof input.structuredStreamingEnabled !== 'boolean') throw new TypeError('structuredStreamingEnabled must be a boolean.');
  if (input.earlyTtsEnabled !== undefined && typeof input.earlyTtsEnabled !== 'boolean') throw new TypeError('earlyTtsEnabled must be a boolean.');
  const structuredStreamingEnabled = input.structuredStreamingEnabled ?? defaults.structuredStreamingEnabled;
  const earlyTtsEnabled = input.earlyTtsEnabled ?? defaults.earlyTtsEnabled;
  if (earlyTtsEnabled && !structuredStreamingEnabled) throw new TypeError('earlyTtsEnabled requires structuredStreamingEnabled.');
  if ((structuredStreamingEnabled || earlyTtsEnabled) && selectedProvider !== 'openai') throw new TypeError('Structured streaming is supported only by the OpenAI provider.');
  for (const [name, value] of Object.entries({ reasoningModel, transcriptionModel, ttsModel, ttsVoice })) {
    if (!value || value.length > 128) throw new TypeError(`${name} must contain 1 to 128 characters.`);
  }
  if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)) throw new TypeError('reasoningEffort is unsupported.');

  const explicitVoicePool = input.speechVoices !== undefined && input.speechVoices !== null;
  const voiceInput = explicitVoicePool ? input.speechVoices : [ttsVoice];
  if (!Array.isArray(voiceInput) || voiceInput.length === 0 || voiceInput.length > 32 || voiceInput.some(voice => typeof voice !== 'string')) {
    throw new TypeError('speechVoices must be a nonempty array of at most 32 voice names.');
  }
  const speechVoices = voiceInput.map(voice => explicitVoicePool ? voice.trim().toLowerCase() : voice.trim());
  if (speechVoices.some(voice => !voice || voice.length > 128 || (explicitVoicePool && !/^[a-z][a-z0-9_-]{0,31}$/.test(voice)))) throw new TypeError('speechVoices contains an invalid voice name.');
  if (new Set(speechVoices).size !== speechVoices.length) throw new TypeError('speechVoices cannot contain duplicates.');
  const ttsSpeed = Number(input.ttsSpeed ?? 1);
  if (!Number.isFinite(ttsSpeed) || ttsSpeed < 0.25 || ttsSpeed > 4) throw new TypeError('ttsSpeed must be between 0.25 and 4.0.');
  const speechInstructionsSupported = /^gpt-4o-mini-tts(?:-|$)/.test(ttsModel);
  const actingEnabled = input.actingEnabled ?? false;
  if (actingEnabled && !speechInstructionsSupported) throw new TypeError('actingEnabled requires a TTS model that supports speech instructions.');
  const supportedVoices = supportedVoicesForModel(ttsModel, speechInstructionsSupported);
  if (explicitVoicePool && speechVoices.length > 1) {
    if (!supportedVoices) throw new TypeError('Cannot validate a multi-voice pool for the configured TTS model.');
    if (speechVoices.some(voice => !supportedVoices.includes(voice))) throw new TypeError('speechVoices contains a voice unsupported by the configured TTS model.');
  }
  const voiceAssignment = String(input.voiceAssignment ?? 'deterministic-session').trim().toLowerCase();
  if (!['deterministic-session', 'character-aware-session'].includes(voiceAssignment)) {
    throw new TypeError('voiceAssignment must be deterministic-session or character-aware-session.');
  }
  const speechVoiceProfiles = normalizeSpeechVoiceProfiles(input.speechVoiceProfiles, { speechVoices, supportedVoices, voiceAssignment });

  const providerWorkDeadlineMs = boundedInteger(input.providerWorkDeadlineMs ?? input.turnDeadlineMs, defaults.turnDeadlineMs, 5_000, 120_000, 'providerWorkDeadlineMs');
  const retryInput = input.retry ?? defaults.retry;
  if (!retryInput || typeof retryInput !== 'object' || Array.isArray(retryInput)) throw new TypeError('retry must be an object.');
  const retry = Object.freeze({
    enabled: retryInput.enabled ?? defaults.retry.enabled,
    maxAttempts: boundedInteger(retryInput.maxAttempts, defaults.retry.maxAttempts, 1, 2, 'retry.maxAttempts'),
    baseDelayMs: boundedInteger(retryInput.baseDelayMs, defaults.retry.baseDelayMs, 0, 10_000, 'retry.baseDelayMs'),
    maxDelayMs: boundedInteger(retryInput.maxDelayMs, defaults.retry.maxDelayMs, 0, 30_000, 'retry.maxDelayMs'),
    honorRetryAfter: retryInput.honorRetryAfter ?? defaults.retry.honorRetryAfter,
    jitter: retryInput.jitter ?? defaults.retry.jitter,
    minAttemptBudgetMs: boundedInteger(retryInput.minAttemptBudgetMs, defaults.retry.minAttemptBudgetMs, 1, 30_000, 'retry.minAttemptBudgetMs'),
    attemptTimeoutMs: retryInput.attemptTimeoutMs === undefined || retryInput.attemptTimeoutMs === null
      ? null : boundedInteger(retryInput.attemptTimeoutMs, null, 1_000, 120_000, 'retry.attemptTimeoutMs'),
  });
  if (typeof retry.enabled !== 'boolean' || typeof retry.honorRetryAfter !== 'boolean' || retry.jitter !== 'bounded' || retry.maxDelayMs < retry.baseDelayMs) throw new TypeError('retry configuration is invalid.');
  const playbackCompletionGraceMs = boundedInteger(input.playbackCompletionGraceMs, 30_000, 5_000, 120_000, 'playbackCompletionGraceMs');
  const playbackCompletionMinMs = boundedInteger(input.playbackCompletionMinMs, 60_000, 1_000, 600_000, 'playbackCompletionMinMs');
  const playbackCompletionMaxMs = boundedInteger(input.playbackCompletionMaxMs, 600_000, 60_000, 1_800_000, 'playbackCompletionMaxMs');
  if (playbackCompletionMaxMs < playbackCompletionMinMs) throw new TypeError('playbackCompletionMaxMs must be greater than or equal to playbackCompletionMinMs.');

  return Object.freeze({
    provider: selectedProvider,
    persistentIdentity: normalizeIdentityConfig(input.persistentIdentity),
    promotedCharacters: normalizeCharacterConfig(input.promotedCharacters),
    intelligence: normalizePerceptionConfig(input.intelligence),
    spontaneousSpeech: Object.freeze({mode:speechMode}),
    dialogueKnowledge: normalizeDialogueKnowledge(input.dialogueKnowledge),
    activities: normalizeActivityConfig(input.activities),
    dialogueLogging: normalizeDialogueLoggingConfig(input.dialogueLogging, boundedInteger),
    reasoningModel, reasoningEffort, transcriptionModel, ttsModel, ttsVoice,
    speechVoices: Object.freeze(speechVoices), speechVoiceProfiles, voiceAssignment, ttsSpeed, actingEnabled, speechInstructionsSupported,
    reasoningBaseUrl: baseUrl(input.reasoningBaseUrl ?? env.OPENAI_REASONING_BASE_URL, 'https://api.openai.com/v1', 'reasoningBaseUrl'),
    transcriptionBaseUrl: baseUrl(input.transcriptionBaseUrl ?? env.OPENAI_TRANSCRIPTION_BASE_URL, 'https://api.openai.com/v1', 'transcriptionBaseUrl'),
    ttsBaseUrl: baseUrl(input.ttsBaseUrl ?? env.OPENAI_TTS_BASE_URL, 'https://api.openai.com/v1', 'ttsBaseUrl'),
    reasoningKey: env.OPENAI_REASONING_API_KEY ?? env.OPENAI_API_KEY ?? '',
    transcriptionKey: env.OPENAI_TRANSCRIPTION_API_KEY ?? env.OPENAI_API_KEY ?? '',
    ttsKey: env.OPENAI_TTS_API_KEY ?? env.OPENAI_API_KEY ?? '',
    maxOutputTokens: boundedInteger(input.maxOutputTokens, defaults.maxOutputTokens, 32, 2048, 'maxOutputTokens'),
    structuredStreamingEnabled, earlyTtsEnabled,
    streamingMaxOutputTokens: boundedInteger(input.streamingMaxOutputTokens, defaults.streamingMaxOutputTokens, 64, 2048, 'streamingMaxOutputTokens'),
    streamingMaxSegments: boundedInteger(input.streamingMaxSegments, defaults.streamingMaxSegments, 1, 8, 'streamingMaxSegments'),
    streamingMaxSegmentChars: boundedInteger(input.streamingMaxSegmentChars, defaults.streamingMaxSegmentChars, 40, 500, 'streamingMaxSegmentChars'),
    streamingMaxDialogueChars: boundedInteger(input.streamingMaxDialogueChars, defaults.streamingMaxDialogueChars, 100, 3000, 'streamingMaxDialogueChars'),
    streamingMaxPcmBytes: boundedInteger(input.streamingMaxPcmBytes, defaults.streamingMaxPcmBytes, 48_000, 24_000_000, 'streamingMaxPcmBytes'),
    providerWorkDeadlineMs,
    retry,
    // Retain the previous setting as a compatibility alias; it no longer includes playback.
    turnDeadlineMs: providerWorkDeadlineMs,
    playbackCompletionGraceMs,
    playbackCompletionMinMs,
    playbackCompletionMaxMs,
    maxMicDurationMs: boundedInteger(input.maxMicDurationMs, defaults.maxMicDurationMs, 1_000, 30_000, 'maxMicDurationMs'),
    maxMicPcmBytes: Math.floor(boundedInteger(input.maxMicDurationMs, defaults.maxMicDurationMs, 1_000, 30_000, 'maxMicDurationMs') * 16_000 * 2 / 1_000),
    maxHistoryMessages: boundedInteger(input.maxHistoryMessages, defaults.maxHistoryMessages, 2, 40, 'maxHistoryMessages'),
    observabilityEnabled: input.observabilityEnabled === undefined ? defaults.observabilityEnabled : input.observabilityEnabled === true,
    observabilityMaxFileBytes: boundedInteger(input.observabilityMaxFileBytes, defaults.observabilityMaxFileBytes, 64 * 1024, 100 * 1024 * 1024, 'observabilityMaxFileBytes'),
    observabilityMaxTotalBytes: boundedInteger(input.observabilityMaxTotalBytes, defaults.observabilityMaxTotalBytes, 256 * 1024, 1024 * 1024 * 1024, 'observabilityMaxTotalBytes'),
    observabilityMaxFiles: boundedInteger(input.observabilityMaxFiles, defaults.observabilityMaxFiles, 1, 50, 'observabilityMaxFiles'),
  });
}

export async function loadConfig({ configPath = process.env.LSA_E1_CONFIG || defaultConfigPath, env = process.env } = {}) {
  let file = {};
  try {
    file = JSON.parse(await readFile(configPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw new Error(`Unable to read E1 configuration (${error.code || 'invalid JSON'}).`);
  }
  return normalizeConfig(file, env);
}
