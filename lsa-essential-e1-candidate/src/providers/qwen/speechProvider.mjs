import { assertOperationInput } from '../providerContract.mjs';

// The sidecar speaks raw signed 16-bit, little-endian, mono PCM at 24 kHz.
// Never forward OpenAI credentials, URLs, arbitrary file paths or model IDs.
export function createFasterQwenSpeechProvider({ config, fetchImpl = globalThis.fetch }) {
  return Object.freeze({
    id: 'qwen.speech',
    capabilities: Object.freeze({
      cancellation: true, immutableInput: true, awaitedPcmCallback: true,
      outputFormat: 'pcm_s16le_mono_24000', voices: config.speechVoices,
      instructions: true, speed: false,
    }),
    async synthesize(input) {
      assertOperationInput(input, 'speech');
      const { identity, dialogue, speechProfile, signal, onPcm, telemetry } = input;
      if (!identity || typeof onPcm !== 'function') throw new TypeError('Qwen requires onPcm.');
      if (!String(dialogue || '').trim() || dialogue.length > 3000) throw new TypeError('Qwen dialogue must be bounded.');
      const voice = speechProfile?.voice ?? config.ttsVoice;
      if (!config.speechVoices.includes(voice)) throw new TypeError('Qwen voice is not configured.');
      if (speechProfile?.provider && speechProfile.provider !== 'faster-qwen3-tts')
        throw new TypeError('Qwen voice provider mismatch.');
      if (typeof fetchImpl !== 'function') throw new TypeError('Qwen requires fetch.');
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason ?? new Error('tts_cancelled'));
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
      const timeoutMs = Math.min(input.timeoutMs ?? config.providerWorkDeadlineMs ?? 45000, 120000);
      const timer = setTimeout(() => controller.abort(new Error('tts_timeout')), timeoutMs);
      let reader, tail = null, bytes = 0, chunks = 0;
      const started = performance.now();
      try {
        controller.signal.throwIfAborted();
        const response = await fetchImpl(config.qwenTts.baseUrl + '/audio/speech', {
          method: 'POST', signal: controller.signal,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'qwen3-tts', input: dialogue, voice, response_format: 'pcm',
            ...(speechProfile?.instructions ? { instructions: speechProfile.instructions.slice(0, 1024) } : {}),
          }),
        });
        controller.signal.throwIfAborted();
        if (!response.ok) throw Object.assign(new Error('Qwen TTS request failed.'), {
          code: response.status === 429 || response.status >= 500 ? 'provider_unavailable' : 'invalid_tts_request',
          status: response.status,
        });
        if (response.headers?.get('x-lsa-sample-rate') &&
            response.headers.get('x-lsa-sample-rate') !== '24000')
          throw new Error('Qwen TTS sample rate mismatch.');
        if (!response.body?.getReader) throw new Error('Qwen TTS returned no readable PCM stream.');
        reader = response.body.getReader();
        while (true) {
          controller.signal.throwIfAborted();
          const { done, value } = await reader.read();
          if (done) break;
          if (!value?.length) continue;
          telemetry?.audioRaw?.(value.length);
          let chunk = Buffer.from(value);
          if (tail !== null) { chunk = Buffer.concat([Buffer.from([tail]), chunk]); tail = null; }
          if (chunk.length % 2) { tail = chunk[chunk.length - 1]; chunk = chunk.subarray(0,-1); }
          if (!chunk.length) continue;
          if (++chunks === 1) {
            telemetry?.event('provider_first_byte',{operation:'tts',durationMs:performance.now()-started,rawBytes:chunk.length});
            telemetry?.event('pcm_first_ready',{pcmBytes:chunk.length,sampleRate:24000,channels:1,durationMs:performance.now()-started});
          }
          await onPcm(new Uint8Array(chunk));
          bytes += chunk.length;
          controller.signal.throwIfAborted();
        }
        if (tail !== null || bytes === 0) throw new Error('Qwen returned malformed or empty PCM.');
        telemetry?.event('pcm_delivery_summary',{pcmBytes:bytes,chunks,audioDurationMs:bytes/48, sampleRate:24000,channels:1});
        return { bytes, chunks, sampleRate:24000, channels:1 };
      } catch (error) {
        if (signal?.aborted) throw Object.assign(new Error('Qwen TTS cancelled.'),{code:'cancelled'});
        if (controller.signal.aborted) throw Object.assign(new Error('Qwen TTS timed out.'),{code:'timeout'});
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (reader && (controller.signal.aborted || tail !== null)) try { await reader.cancel(); } catch {}
        reader?.releaseLock?.();
      }
    },
  });
}
