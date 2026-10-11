import { PCM_FORMAT } from './speechContract.mjs';

// Adapted from the independent provider in PR #39, without any Essential
// controller/identity dependence. No OpenAI token is sent to the sidecar.
// Only a literal loopback IP may be used, never a caller-selected URL.
const VOICE = /^[a-z][a-z0-9_-]{0,31}$/;
const CTRL = /[\u0000-\u0008\u000b-\u001f\u007f]/;
const MAX_PCM_BYTES = 1_440_000;

export function createFasterQwenSpeechProvider({
  baseUrl = process.env.LSA_STANDALONE_QWEN_URL ?? 'http://127.0.0.1:8000/v1',
  voices, fetchImpl = globalThis.fetch, deadlineMs = 90000
} = {}) {
  let target;
  try { target = new URL(baseUrl); } catch { throw new Error('qwen_invalid_loopback_url'); }
  if (target.protocol !== 'http:' ||
      !['127.0.0.1', '[::1]'].includes(target.hostname) ||
      target.username || target.password || target.search || target.hash ||
      !['/v1', '/v1/'].includes(target.pathname) ||
      !Number.isSafeInteger(deadlineMs) || deadlineMs < 1000 ||
      deadlineMs > 120000 || typeof fetchImpl !== 'function')
    throw new Error('qwen_invalid_loopback_url');
  if (!Array.isArray(voices) || !voices.length || voices.length > 32 ||
      voices.some(v => typeof v !== 'string' || !VOICE.test(v)) ||
      new Set(voices).size !== voices.length)
    throw new Error('qwen_invalid_voice_registry');
  const approved = new Set(voices);
  const url = target.origin + '/v1/audio/speech';

  return Object.freeze({
    id: 'faster-qwen3-tts',
    capabilities: Object.freeze({
      cancellation: true, streaming: true, outputFormat: PCM_FORMAT,
      localOnly: true, voiceRegistry: true
    }),
    async *streamPcm({ text, voice, instructions, signal }) {
      if (typeof text !== 'string' || !text.trim() || text.length > 2048 ||
          CTRL.test(text) || !approved.has(voice) ||
          (instructions !== undefined && (typeof instructions !== 'string' ||
            instructions.length > 1024 || CTRL.test(instructions))))
        throw new Error('qwen_invalid_speech_request');
      const timeout = AbortSignal.timeout(deadlineMs);
      const bound = signal ? AbortSignal.any([signal, timeout]) : timeout;
      if (bound.aborted) throw new Error('speech_cancelled');
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen3-tts', input: text, voice,
            response_format: 'pcm',
            ...(instructions ? { instructions } : {})
          }),
          signal: bound
        });
      } catch { throw new Error(bound.aborted ? 'speech_cancelled' : 'qwen_transport_failure'); }
      if (!response?.ok) throw new Error('qwen_http_failure');
      if (response.headers?.get?.('x-lsa-sample-rate') !== '24000')
        throw new Error('qwen_pcm_format_mismatch');
      if (!response.body?.getReader) throw new Error('qwen_stream_unavailable');

      const reader = response.body.getReader();
      let bytes = 0;
      try {
        while (true) {
          if (bound.aborted) throw new Error('speech_cancelled');
          let frame;
          try { frame = await reader.read(); }
          catch { throw new Error(bound.aborted ? 'speech_cancelled' : 'qwen_stream_failure'); }
          if (bound.aborted) throw new Error('speech_cancelled');
          if (frame.done) break;
          if (!(frame.value instanceof Uint8Array)) throw new Error('qwen_pcm_format_mismatch');
          if (!frame.value.length) continue;
          bytes += frame.value.length;
          if (bytes > MAX_PCM_BYTES) throw new Error('speech_too_long');
          yield Buffer.from(frame.value);
        }
        if (bytes < 2 || bytes % 2 !== 0) throw new Error('qwen_pcm_format_mismatch');
      } finally {
        try { await reader.cancel(); } catch {}
        try { reader.releaseLock(); } catch {}
      }
    }
  });
}
