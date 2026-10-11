import { assertOperationInput } from '../providerContract.mjs';

// Qwen sidecar contract: 24 kHz mono signed PCM16 LE (48 bytes/ms).
// Native receives only aligned PCM. Adaptive mode never changes native owner,
// identity, authorization, or playback completion semantics.
const PCM_BYTES_PER_MS = 48;
const FORWARD_FRAME_BYTES = 24000;
const SLOW_RECEIVE_GAP_MS = 350;
const SLOW_FORWARD_MS = 250;
const UNDERRUN_GRACE_MS = 150;

function safeClock(clock) {
  const value = clock();
  if (!Number.isFinite(value)) throw new TypeError('Qwen requires a monotonic clock.');
  return value;
}
function clamp(min, max, value) { return Math.max(min, Math.min(max, value)); }

export function createFasterQwenSpeechProvider({ config, fetchImpl = globalThis.fetch,
  clock = () => performance.now() }) {
  // One provider stack is held for the LSA runtime. A suspect voice is pinned
  // to full buffering until companion restart; no automatic repeated glitch.
  const fullBufferVoices = new Set();

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

      const requestedMode = config.qwenTts.playbackBufferMode ?? 'adaptive';
      const bufferMode = requestedMode === 'adaptive' && fullBufferVoices.has(voice)
        ? 'complete-utterance' : requestedMode;
      const adaptive = config.qwenTts;
      const maxBytes = Math.min(config.streamingMaxPcmBytes ?? 6291456, 24000000);
      const controller = new AbortController();
      const abort = () => controller.abort(signal?.reason ?? new Error('tts_cancelled'));
      if (signal?.aborted) abort();
      else signal?.addEventListener('abort', abort, { once: true });
      const timeoutMs = Math.min(input.timeoutMs ?? config.providerWorkDeadlineMs ?? 45000, 120000);
      const timer = setTimeout(() => controller.abort(new Error('tts_timeout')), timeoutMs);
      const started = safeClock(clock);
      let reader, fullyRead = false, tail = null, requestId = null;
      let headersAt = null, generationFinishedAt = null;
      let receivedBytes = 0, receivedChunks = 0, forwardedBytes = 0, forwardedChunks = 0;
      let firstPcmAt = null, lastPcmAt = null, slowGaps = 0, maxGap = 0, maxForwardWait = 0;
      let forwardMs = 0, slowForwards = 0, firstForwardAt = null;
      const gaps = [];
      const pending = [];
      let pendingBytes = 0, generationDone = false, pumpTask = null, pumpError = null, waking = null;
      let underrunEstimate = false, adaptiveStarted = false, fallbackRecorded = false;

      const record = (event, data) => telemetry?.event(event, { requestId, playbackBufferMode: bufferMode, ...data });
      if (requestedMode === 'adaptive' && bufferMode !== 'adaptive') {
        record('qwen_tts_adaptive_fallback', { code: 'voice_latched', bufferedBytes: 0 });
      }
      const now = () => safeClock(clock);
      const wake = () => { const resume = waking; waking = null; resume?.(); };
      const suppliedAudioMs = () => forwardedBytes / PCM_BYTES_PER_MS;
      const nativePlaybackElapsedMs = () => {
        const nativeStarted = typeof input.playbackStartedAt === 'function'
          ? input.playbackStartedAt() : null;
        return Number.isFinite(nativeStarted) && nativeStarted >= 0
          ? Math.max(0, now() - nativeStarted) : null;
      };
      const checkUnderrunRisk = () => {
        if (!adaptiveStarted || generationDone || underrunEstimate || !forwardedBytes) return;
        const elapsed = nativePlaybackElapsedMs();
        // A *supply-side estimate*, not proof of an actual native audio-device
        // underrun. The native playback start is authoritative, queue depth isn't.
        if (elapsed === null || elapsed <= suppliedAudioMs() + UNDERRUN_GRACE_MS) return;
        underrunEstimate = true;
        fullBufferVoices.add(voice);
        record('qwen_tts_underrun_risk', {
          code: 'estimated_underrun', audioDurationMs: suppliedAudioMs(),
          durationMs: elapsed, bufferedBytes: pendingBytes, underRealtime: true,
        });
        record('qwen_tts_adaptive_fallback', { code: 'estimated_underrun',
          bufferedBytes: pendingBytes });
      };
      const send = async chunk => {
        controller.signal.throwIfAborted();
        if (firstForwardAt === null) firstForwardAt = now();
        const before = now();
        await onPcm(new Uint8Array(chunk));
        const elapsed = Math.max(0, now() - before);
        forwardMs += elapsed;
        maxForwardWait = Math.max(maxForwardWait, elapsed);
        forwardedBytes += chunk.length;
        forwardedChunks++;
        if (elapsed > SLOW_FORWARD_MS && ++slowForwards <= 12)
          record('qwen_pcm_forward_slow', { durationMs: elapsed, chunks: forwardedChunks,
            bufferedBytes: pendingBytes });
        controller.signal.throwIfAborted();
      };
      const add = bytes => {
        pending.push(bytes);
        pendingBytes += bytes.length;
        wake();
      };
      const pump = async () => {
        for (;;) {
          controller.signal.throwIfAborted();
          if (!pending.length) {
            if (generationDone) return;
            await new Promise(resolve => { waking = resolve; });
            continue;
          }
          const chunk = pending.shift();
          pendingBytes -= chunk.length;
          for (let offset = 0; offset < chunk.length; offset += FORWARD_FRAME_BYTES) {
            controller.signal.throwIfAborted();
            await send(chunk.subarray(offset, Math.min(chunk.length, offset + FORWARD_FRAME_BYTES)));
          }
        }
      };
      const startPump = () => {
        if (pumpTask) return;
        adaptiveStarted = bufferMode === 'adaptive' && !generationDone;
        pumpTask = pump().catch(error => {
          pumpError = error;
          if (!controller.signal.aborted) controller.abort(error);
          throw error;
        });
        // Prevent unhandled rejections if native rejects while reader.read waits.
        pumpTask.catch(() => {});
      };
      const considerAdaptiveStart = () => {
        if (bufferMode !== 'adaptive' || pumpTask || receivedChunks < 3) return;
        const audioMs = receivedBytes / PCM_BYTES_PER_MS;
        if (audioMs < adaptive.adaptiveMinBufferMs) return;
        const observationMs = Math.max(1, now() - firstPcmAt);
        const overallRate = audioMs / observationMs;
        const recentRates = gaps.slice(-4).map(({gap, audio}) => audio / Math.max(1, gap));
        const conservativeRate = Math.min(overallRate, ...recentRates);
        // Conservative speech-duration estimate; no text is included in logs.
        // If the estimated buffer is too large, wait for the complete reply.
        const expectedAudioMs = Math.max(audioMs + 500, dialogue.length / 13 * 1000);
        const remainingMs = Math.max(0, expectedAudioMs - audioMs);
        const deficit = Math.max(0, 1 / Math.max(0.35, conservativeRate) - 1);
        const targetMs = Math.max(adaptive.adaptiveMinBufferMs,
          adaptive.adaptiveSafetyMs + maxGap * 1.35,
          adaptive.adaptiveSafetyMs + remainingMs * deficit);
        if (targetMs > adaptive.adaptiveMaxBufferMs || audioMs < targetMs) return;
        record('qwen_tts_adaptive_start', {
          bufferedBytes: receivedBytes, audioDurationMs: audioMs,
          streamRate: conservativeRate, maxChunkGapMs: maxGap,
          generationDurationMs: now() - started,
        });
        startPump();
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
        headersAt = now();
        requestId = response.headers?.get?.('x-lsa-request-id') || null;
        if (requestId && !/^rid_[a-f0-9]{16}$/.test(requestId)) requestId = null;
        if (!response.ok) throw Object.assign(new Error('Qwen TTS request failed.'), {
          code: response.status === 429 || response.status >= 500 ? 'provider_unavailable' : 'invalid_tts_request',
          status: response.status,
        });
        if (response.headers?.get('x-lsa-sample-rate') &&
            response.headers.get('x-lsa-sample-rate') !== '24000')
          throw Object.assign(new Error('Qwen TTS sample rate mismatch.'), { code: 'invalid_pcm_format' });
        if (!response.body?.getReader) throw Object.assign(
          new Error('Qwen TTS returned no readable PCM stream.'), { code: 'invalid_pcm_format' });
        reader = response.body.getReader();

        while (true) {
          controller.signal.throwIfAborted();
          checkUnderrunRisk();
          const { done, value } = await reader.read();
          if (pumpError) throw pumpError;
          controller.signal.throwIfAborted();
          if (done) { fullyRead = true; break; }
          if (!value?.length) continue;
          telemetry?.audioRaw?.(value.length);
          let chunk = Buffer.from(value);
          if (tail !== null) { chunk = Buffer.concat([Buffer.from([tail]), chunk]); tail = null; }
          if (chunk.length % 2) { tail = chunk[chunk.length - 1]; chunk = chunk.subarray(0, -1); }
          if (!chunk.length) continue;
          checkUnderrunRisk();
          const current = now();
          if (firstPcmAt === null) {
            firstPcmAt = current;
            telemetry?.event('provider_first_byte', { operation:'tts', durationMs:current-started, rawBytes:chunk.length });
            telemetry?.event('pcm_first_ready', { pcmBytes:chunk.length, sampleRate:24000, channels:1, durationMs:current-started });
          } else {
            const gap = Math.max(0, current - lastPcmAt);
            gaps.push({ gap, audio: chunk.length / PCM_BYTES_PER_MS });
            if (gaps.length > 32) gaps.shift();
            maxGap = Math.max(maxGap, gap);
            if (gap > SLOW_RECEIVE_GAP_MS && ++slowGaps <= 12)
              record('qwen_tts_chunk_gap', { durationMs:gap, chunks:receivedChunks,
                bufferedBytes:pendingBytes });
          }
          lastPcmAt = current;
          receivedChunks++;
          receivedBytes += chunk.length;
          if (receivedBytes > maxBytes)
            throw Object.assign(new Error('Qwen PCM exceeds configured budget.'), { code:'tts_pcm_limit' });

          add(chunk);
          if (bufferMode === 'streaming' && !pumpTask) startPump();
          considerAdaptiveStart();
        }
        if (tail !== null || !receivedBytes)
          throw Object.assign(new Error('Qwen returned malformed or empty PCM.'), { code:'invalid_pcm_format' });
        const generatedAt = now();
        generationFinishedAt = generatedAt;
        generationDone = true;
        wake();

        if (bufferMode === 'adaptive' && !pumpTask) {
          fallbackRecorded = true;
          record('qwen_tts_adaptive_fallback', {
            code:'insufficient_headroom', bufferedBytes:receivedBytes,
            generationDurationMs:generatedAt-started });
        }
        if (bufferMode === 'complete-utterance' || bufferMode === 'adaptive') {
          record('qwen_tts_buffer_ready', { bufferedBytes: pendingBytes,
            audioDurationMs: receivedBytes / PCM_BYTES_PER_MS,
            generationDurationMs: generatedAt - started });
        }
        if (!pumpTask) {
          // Preserve the original full-buffer PCM coalescing contract: split
          // native frames at 500 ms, not at arbitrary HTTP read boundaries.
          // In particular, an odd-byte network split must never become two
          // tiny native frames when a complete utterance is buffered.
          if (bufferMode !== 'streaming' && pending.length > 1) {
            const joined = Buffer.concat(pending, pendingBytes);
            pending.length = 0;
            pendingBytes = 0;
            add(joined);
          }
          startPump();
        }
        // The generation deadline should not stop a completed result while
        // native authorization/forwarding is completing. Outer turn checks
        // retain their independent deadline and cancellation enforcement.
        clearTimeout(timer);
        await pumpTask;

        const sorted = gaps.map(item=>item.gap).sort((a,b)=>a-b);
        const p95 = sorted.length ? sorted[Math.ceil(sorted.length*.95)-1] : 0;
        const receiveMs = Math.max(0, (lastPcmAt ?? started)-(firstPcmAt ?? started));
        const rate = receiveMs > 0 ? (receivedBytes/PCM_BYTES_PER_MS)/receiveMs : 0;
        record('qwen_tts_timing_summary', {
          receivedChunks, chunks:forwardedChunks, pcmBytes:receivedBytes,
          audioDurationMs: receivedBytes/PCM_BYTES_PER_MS, generationDurationMs:generatedAt-started,
          forwardDurationMs:forwardMs, maxChunkGapMs:maxGap, p95ChunkGapMs:p95,
          headersLatencyMs: headersAt === null ? null : headersAt-started,
          firstReadLatencyMs: firstPcmAt === null ? null : firstPcmAt-started,
          firstForwardLatencyMs: firstForwardAt === null ? null : firstForwardAt-started,
          bufferedBeforeForwardMs: firstPcmAt === null || firstForwardAt === null ? null : firstForwardAt-firstPcmAt,
          readCompletionLatencyMs: generatedAt-started,
          deliveryCompletionLatencyMs: now()-started,
          slowChunkCount:slowGaps, forwardWaitMaxMs:maxForwardWait,
          streamRate:rate, underRealtime:rate > 0 && rate < 1,
          playbackBufferMode:bufferMode, outcome:'finished',
          underrunRiskCount:underrunEstimate ? 1 : 0,
          fallbackUsed: fallbackRecorded || bufferMode === 'complete-utterance',
        });
        telemetry?.event('pcm_delivery_summary', { pcmBytes:forwardedBytes, chunks:forwardedChunks,
          audioDurationMs:forwardedBytes/PCM_BYTES_PER_MS, sampleRate:24000, channels:1 });
        return { bytes:forwardedBytes, chunks:forwardedChunks, sampleRate:24000, channels:1 };
      } catch (error) {
        generationDone = true;
        wake();
        if (pumpTask && !controller.signal.aborted) controller.abort(error);
        if (pumpTask) await pumpTask.catch(()=>{});
        const code = pumpError?.code || (signal?.aborted ? 'cancelled' :
          controller.signal.aborted && !pumpError ? 'timeout' :
          /^[a-z][a-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'tts_generation_or_delivery_failed');
        record('qwen_tts_timing_summary', {
          receivedChunks, chunks:forwardedChunks, pcmBytes:receivedBytes,
          generationDurationMs:now()-started, forwardDurationMs:forwardMs,
          headersLatencyMs: headersAt === null ? null : headersAt-started,
          firstReadLatencyMs: firstPcmAt === null ? null : firstPcmAt-started,
          firstForwardLatencyMs: firstForwardAt === null ? null : firstForwardAt-started,
          readCompletionLatencyMs: generationFinishedAt === null ? null : generationFinishedAt-started,
          maxChunkGapMs:maxGap, slowChunkCount:slowGaps, forwardWaitMaxMs:maxForwardWait,
          underrunRiskCount:underrunEstimate ? 1 : 0, code, outcome:'failed',
        });
        if (signal?.aborted) throw Object.assign(new Error('Qwen TTS cancelled.'),{code:'cancelled'});
        if (pumpError) throw pumpError;
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
