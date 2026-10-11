import { assertOperationInput } from '../providerContract.mjs';

// The sidecar speaks signed 16-bit, little-endian, mono PCM at 24 kHz.
// No OpenAI credentials, arbitrary paths or unchecked model IDs reach it.
// Buffered mode is deliberate: a local GPU generating below real-time speed
// must not starve the native audio player between streaming chunks.
const PCM_BYTES_PER_SECOND = 48000;
const FORWARD_FRAME_BYTES = 24000; // 500 ms per native handoff
const SLOW_RECEIVE_GAP_MS = 350;
const SLOW_FORWARD_MS = 250;

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
      const bufferMode = config.qwenTts.playbackBufferMode ?? 'complete-utterance';
      const maxBytes = Math.min(config.streamingMaxPcmBytes ?? 6291456, 24000000);
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason ?? new Error('tts_cancelled'));
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
      const timeoutMs = Math.min(input.timeoutMs ?? config.providerWorkDeadlineMs ?? 45000, 120000);
      const timer = setTimeout(() => controller.abort(new Error('tts_timeout')), timeoutMs);
      const started = performance.now();
      let reader, fullyRead = false, tail = null, requestId = null;
      let receivedBytes = 0, receivedChunks = 0, forwardedBytes = 0, forwardedChunks = 0;
      let firstPcmAt = null, lastPcmAt = null, slowGaps = 0, maxGap = 0, maxForwardWait = 0;
      const gaps = [], stored = [];
      let forwardMs = 0, slowForwards = 0;

      const send = async chunk => {
        controller.signal.throwIfAborted();
        const forwardStart = performance.now();
        await onPcm(new Uint8Array(chunk));
        const waitMs = performance.now() - forwardStart;
        forwardMs += waitMs;
        maxForwardWait = Math.max(maxForwardWait, waitMs);
        forwardedBytes += chunk.length;
        forwardedChunks += 1;
        if (waitMs > SLOW_FORWARD_MS && ++slowForwards <= 12)
          telemetry?.event('qwen_pcm_forward_slow', { durationMs: waitMs, chunks: forwardedChunks,
            bufferedBytes: Math.max(0, receivedBytes - forwardedBytes), playbackBufferMode: bufferMode });
        controller.signal.throwIfAborted();
      };
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
        requestId = response.headers?.get?.('x-lsa-request-id') || null;
        if (requestId && !/^rid_[a-f0-9]{16}$/.test(requestId)) requestId = null;
        if (!response.ok) throw Object.assign(new Error('Qwen TTS request failed.'), {
          code: response.status === 429 || response.status >= 500 ? 'provider_unavailable' : 'invalid_tts_request',
          status: response.status,
        });
        if (response.headers?.get('x-lsa-sample-rate') &&
            response.headers.get('x-lsa-sample-rate') !== '24000')
          throw Object.assign(new Error('Qwen TTS sample rate mismatch.'), {code:'invalid_pcm_format'});
        if (!response.body?.getReader) throw Object.assign(new Error('Qwen TTS returned no readable PCM stream.'), {code:'invalid_pcm_format'});
        reader = response.body.getReader();
        while (true) {
          controller.signal.throwIfAborted();
          const { done, value } = await reader.read();
          controller.signal.throwIfAborted();
          if (done) { fullyRead = true; break; }
          if (!value?.length) continue;
          telemetry?.audioRaw?.(value.length);
          let chunk = Buffer.from(value);
          if (tail !== null) { chunk = Buffer.concat([Buffer.from([tail]), chunk]); tail = null; }
          if (chunk.length % 2) { tail = chunk[chunk.length - 1]; chunk = chunk.subarray(0, -1); }
          if (!chunk.length) continue;
          const now = performance.now();
          if (firstPcmAt === null) {
            firstPcmAt = now;
            telemetry?.event('provider_first_byte', {operation:'tts',durationMs:now-started,rawBytes:chunk.length});
            telemetry?.event('pcm_first_ready', {pcmBytes:chunk.length,sampleRate:24000,channels:1,durationMs:now-started});
          } else {
            const gap = now - lastPcmAt;
            gaps.push(gap);
            maxGap = Math.max(maxGap, gap);
            if (gap > SLOW_RECEIVE_GAP_MS && ++slowGaps <= 12)
              telemetry?.event('qwen_tts_chunk_gap', {durationMs:gap, chunks:receivedChunks,
                bufferedBytes:Math.max(0, receivedBytes-forwardedBytes),playbackBufferMode:bufferMode});
          }
          lastPcmAt = now;
          receivedChunks++;
          receivedBytes += chunk.length;
          if (receivedBytes > maxBytes)
            throw Object.assign(new Error('Qwen PCM exceeds configured memory/stream budget.'),{code:'tts_pcm_limit'});
          if (bufferMode === 'complete-utterance') stored.push(chunk);
          else await send(chunk);
        }
        if (tail !== null || !receivedBytes)
          throw Object.assign(new Error('Qwen returned malformed or empty PCM.'), {code:'invalid_pcm_format'});

        const generatedAt = performance.now();
        // No audio is handed to native until the entire, strictly aligned
        // utterance has arrived. Avoids audible underruns on sub-1x GPUs.
        if (bufferMode === 'complete-utterance') {
          telemetry?.event('qwen_tts_buffer_ready', {bufferedBytes:receivedBytes,
            audioDurationMs:receivedBytes/PCM_BYTES_PER_SECOND, generationDurationMs:generatedAt-started});
          clearTimeout(timer); // generation deadline; handoff follows native playback gates
          const all = Buffer.concat(stored, receivedBytes);
          for (let offset=0;offset<all.length;offset+=FORWARD_FRAME_BYTES)
            await send(all.subarray(offset, Math.min(all.length, offset+FORWARD_FRAME_BYTES)));
        }
        const sorted = gaps.slice().sort((a,b)=>a-b);
        const p95 = sorted.length ? sorted[Math.ceil(sorted.length*.95)-1] : 0;
        const receiveTimeMs = Math.max(0, (lastPcmAt ?? started) - (firstPcmAt ?? started));
        const rate = receiveTimeMs>0 ? (receivedBytes/PCM_BYTES_PER_SECOND)/(receiveTimeMs/1000) : 0;
        telemetry?.event('qwen_tts_timing_summary', {
          requestId,playbackBufferMode:bufferMode, receivedChunks, chunks:forwardedChunks,
          pcmBytes:receivedBytes, audioDurationMs:receivedBytes/PCM_BYTES_PER_SECOND,
          generationDurationMs:generatedAt-started, forwardDurationMs:forwardMs,
          maxChunkGapMs:maxGap, p95ChunkGapMs:p95, slowChunkCount:slowGaps,
          forwardWaitMaxMs:maxForwardWait, streamRate:rate, underRealtime:rate>0 && rate<1,
          outcome:'finished',
        });
        telemetry?.event('pcm_delivery_summary', {pcmBytes:forwardedBytes,chunks:forwardedChunks,
          audioDurationMs:forwardedBytes/PCM_BYTES_PER_SECOND,sampleRate:24000,channels:1});
        return { bytes:forwardedBytes, chunks:forwardedChunks, sampleRate:24000, channels:1 };
      } catch (error) {
        const code = signal?.aborted ? 'cancelled' :
          controller.signal.aborted ? 'timeout' :
          /^[a-z][a-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'tts_generation_or_delivery_failed';
        telemetry?.event('qwen_tts_timing_summary', {requestId,playbackBufferMode:bufferMode,
          receivedChunks,chunks:forwardedChunks,pcmBytes:receivedBytes,
          generationDurationMs:performance.now()-started,forwardDurationMs:forwardMs,
          maxChunkGapMs:maxGap,slowChunkCount:slowGaps,forwardWaitMaxMs:maxForwardWait,
          code,outcome:'failed'});
        if (signal?.aborted) throw Object.assign(new Error('Qwen TTS cancelled.'),{code:'cancelled'});
        if (controller.signal.aborted) throw Object.assign(new Error('Qwen TTS timed out.'),{code:'timeout'});
        throw error;
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (reader && !fullyRead) try { await reader.cancel(); } catch {}
        reader?.releaseLock?.();
      }
    },
  });
}
