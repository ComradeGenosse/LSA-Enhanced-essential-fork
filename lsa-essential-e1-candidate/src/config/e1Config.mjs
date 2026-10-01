import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultConfigPath = path.resolve(moduleDirectory, '../../e1.config.json');

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
  const selectedProvider = String(input.provider ?? env.AI_PROVIDER ?? 'openai').trim().toLowerCase();
  if (!['openai', 'gemini'].includes(selectedProvider)) throw new TypeError('E1 provider must be openai or gemini.');
  const defaults = {
    reasoningModel: 'gpt-6-luna', reasoningEffort: 'low', transcriptionModel: 'gpt-transcribe',
    ttsModel: 'gpt-4o-mini-tts', ttsVoice: 'nova', maxOutputTokens: 300,
    turnDeadlineMs: 45_000, maxMicDurationMs: 30_000, maxHistoryMessages: 12,
    observabilityEnabled: true, observabilityMaxFileBytes: 10 * 1024 * 1024,
    observabilityMaxTotalBytes: 100 * 1024 * 1024, observabilityMaxFiles: 5,
  };
  const reasoningModel = String(input.reasoningModel ?? env.OPENAI_REASONING_MODEL ?? defaults.reasoningModel).trim();
  const transcriptionModel = String(input.transcriptionModel ?? env.OPENAI_TRANSCRIPTION_MODEL ?? defaults.transcriptionModel).trim();
  const ttsModel = String(input.ttsModel ?? env.OPENAI_TTS_MODEL ?? defaults.ttsModel).trim();
  const ttsVoice = String(input.ttsVoice ?? env.OPENAI_TTS_VOICE ?? defaults.ttsVoice).trim();
  const reasoningEffort = String(input.reasoningEffort ?? env.OPENAI_REASONING_EFFORT ?? defaults.reasoningEffort).trim().toLowerCase();
  if (input.observabilityEnabled !== undefined && typeof input.observabilityEnabled !== 'boolean') throw new TypeError('observabilityEnabled must be a boolean.');
  for (const [name, value] of Object.entries({ reasoningModel, transcriptionModel, ttsModel, ttsVoice })) {
    if (!value || value.length > 128) throw new TypeError(`${name} must contain 1 to 128 characters.`);
  }
  if (!['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)) throw new TypeError('reasoningEffort is unsupported.');

  const providerWorkDeadlineMs = boundedInteger(input.providerWorkDeadlineMs ?? input.turnDeadlineMs, defaults.turnDeadlineMs, 5_000, 120_000, 'providerWorkDeadlineMs');
  const playbackCompletionGraceMs = boundedInteger(input.playbackCompletionGraceMs, 30_000, 5_000, 120_000, 'playbackCompletionGraceMs');
  const playbackCompletionMinMs = boundedInteger(input.playbackCompletionMinMs, 60_000, 1_000, 600_000, 'playbackCompletionMinMs');
  const playbackCompletionMaxMs = boundedInteger(input.playbackCompletionMaxMs, 600_000, 60_000, 1_800_000, 'playbackCompletionMaxMs');
  if (playbackCompletionMaxMs < playbackCompletionMinMs) throw new TypeError('playbackCompletionMaxMs must be greater than or equal to playbackCompletionMinMs.');

  return Object.freeze({
    provider: selectedProvider,
    reasoningModel, reasoningEffort, transcriptionModel, ttsModel, ttsVoice,
    reasoningBaseUrl: baseUrl(input.reasoningBaseUrl ?? env.OPENAI_REASONING_BASE_URL, 'https://api.openai.com/v1', 'reasoningBaseUrl'),
    transcriptionBaseUrl: baseUrl(input.transcriptionBaseUrl ?? env.OPENAI_TRANSCRIPTION_BASE_URL, 'https://api.openai.com/v1', 'transcriptionBaseUrl'),
    ttsBaseUrl: baseUrl(input.ttsBaseUrl ?? env.OPENAI_TTS_BASE_URL, 'https://api.openai.com/v1', 'ttsBaseUrl'),
    reasoningKey: env.OPENAI_REASONING_API_KEY ?? env.OPENAI_API_KEY ?? '',
    transcriptionKey: env.OPENAI_TRANSCRIPTION_API_KEY ?? env.OPENAI_API_KEY ?? '',
    ttsKey: env.OPENAI_TTS_API_KEY ?? env.OPENAI_API_KEY ?? '',
    maxOutputTokens: boundedInteger(input.maxOutputTokens, defaults.maxOutputTokens, 32, 2048, 'maxOutputTokens'),
    providerWorkDeadlineMs,
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
