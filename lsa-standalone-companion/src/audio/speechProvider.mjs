import { PCM_FORMAT } from './speechContract.mjs';

// Standalone OpenAI speech source. Raw output is PCM16LE mono at 24 kHz,
// NOT WAV and NOT confirmation that a physical NPC spoke.
// The provider is optional and never runs until locally enabled by the user.
export function createSpeechPcmProvider({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.LSA_STANDALONE_TTS_MODEL,
  voice = process.env.LSA_STANDALONE_TTS_VOICE,
  instructions = process.env.LSA_STANDALONE_TTS_INSTRUCTIONS,
  fetchImpl = globalThis.fetch,
  endpoint = 'https://api.openai.com/v1/audio/speech'
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim() ||
      typeof model !== 'string' || !/^[a-zA-Z0-9._:-]{2,100}$/.test(model) ||
      typeof voice !== 'string' || !/^[a-zA-Z0-9._:-]{2,80}$/.test(voice) ||
      typeof fetchImpl !== 'function')
    throw new Error('speech_provider_configuration_missing');
  if (instructions !== undefined &&
      (typeof instructions !== 'string' || instructions.length > 1024))
    throw new Error('speech_provider_instructions_invalid');

  return {
    id: 'openai',
    capabilities: Object.freeze({
      cancellation: true, streaming: true, outputFormat: PCM_FORMAT
    }),
    async *streamPcm({ text, voice: requestedVoice, instructions: requestedInstructions, signal }) {
      if (typeof text !== 'string' || !text.trim() || text.length > 2048 ||
          /[\u0000-\u0008\u000b-\u001f\u007f]/.test(text))
        throw new Error('invalid_speech_text');
      const activeVoice = requestedVoice ?? voice;
      const activeInstructions = requestedInstructions ?? instructions;
      if (typeof activeVoice !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(activeVoice) ||
          (activeInstructions !== undefined &&
            (typeof activeInstructions !== 'string' || activeInstructions.length > 1024 ||
             /[\u0000-\u0008\u000b-\u001f\u007f]/.test(activeInstructions))))
        throw new Error('invalid_speech_profile');
      const timeout = AbortSignal.timeout(25000);
      const bound = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/octet-stream'
          },
          body: JSON.stringify({
            model, voice: activeVoice, input: text, response_format: 'pcm',
            ...(activeInstructions ? { instructions: activeInstructions } : {})
          }),
          signal: bound
        });
      } catch { throw new Error('speech_transport_failure'); }
      if (!response?.ok) throw new Error('speech_http_failure');
      if (!response.body || typeof response.body.getReader !== 'function')
        throw new Error('speech_stream_unavailable');

      const reader = response.body.getReader();
      let observed = 0;
      try {
        while (true) {
          if (bound.aborted) throw new Error('speech_cancelled');
          let frame;
          try { frame = await reader.read(); }
          catch { throw new Error('speech_stream_failure'); }
          if (frame.done) break;
          if (!(frame.value instanceof Uint8Array) || frame.value.length === 0)
            continue;
          observed += frame.value.length;
          // Total wire budget (30 seconds); native escrow may impose stricter
          // limits until an accepted audio-output drain is installed.
          if (observed > 1_440_000) throw new Error('speech_too_long');
          yield Buffer.from(frame.value);
        }
        if (observed < 2 || observed % 2 !== 0)
          throw new Error('speech_invalid_pcm_length');
      } finally {
        try { await reader.cancel(); } catch {}
        try { reader.releaseLock(); } catch {}
      }
    }
  };
}
