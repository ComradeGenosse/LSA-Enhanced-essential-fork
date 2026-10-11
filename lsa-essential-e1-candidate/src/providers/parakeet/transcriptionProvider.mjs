import { assertOperationInput } from '../providerContract.mjs';
import { ProviderRequestError } from '../../openai/request.mjs';

// Post-release PTT only. Local sidecar receives PCM, never identity or API keys.
export function createParakeetTranscriptionProvider({ config, fetchImpl = globalThis.fetch, fallbackProvider }) {
  const local = config.parakeetStt;
  return Object.freeze({
    id: 'parakeet.transcription',
    capabilities: Object.freeze({ cancellation: true, immutableInput: true, pcm16MonoInput: true }),
    async transcribe(input) {
      assertOperationInput(input, 'transcription');
      const { pcm, sampleRate = 16000, signal, telemetry } = input;
      if (!(pcm instanceof Uint8Array) || pcm.byteLength === 0 ||
          pcm.byteLength % 2 || pcm.byteLength > 960000 || sampleRate !== 16000)
        throw new TypeError('Parakeet requires up to 30 seconds of 16-kHz mono PCM16.');
      if (typeof fetchImpl !== 'function') throw new TypeError('Parakeet requires fetch.');
      signal?.throwIfAborted();

      const started = performance.now();
      const controller = new AbortController();
      const cancel = () => controller.abort(signal?.reason || new Error('turn_cancelled'));
      if (signal?.aborted) cancel();
      else signal?.addEventListener('abort', cancel, { once: true });

      // Leave headroom for the cloud backup within the E1 attempt deadline.
      const attemptMs = Math.max(250, input.timeoutMs ?? config.providerWorkDeadlineMs ?? 45000);
      const localMs = Math.min(local.timeoutMs, Math.max(200,
        attemptMs - (local.fallback === 'openai' ? 1500 : 0)));
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort(new Error('local_timeout'));
      }, localMs);

      const spanDone = telemetry?.startSpan?.('stt', {
        model: 'moondream/parakeet-ultra', bytes: pcm.byteLength, sampleRate,
      });
      let failure;
      try {
        controller.signal.throwIfAborted();
        telemetry?.event?.('stt_route', { provider: 'parakeet-ultra', phase: 'primary' });
        const response = await fetchImpl(local.baseUrl + '/audio/transcriptions', {
          method: 'POST',
          signal: controller.signal,
          headers: { 'content-type': 'application/octet-stream', 'x-lsa-sample-rate': '16000' },
          body: Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength),
        });
        controller.signal.throwIfAborted();
        if (!response.ok) throw new ProviderRequestError('Local STT service unavailable.', {
          code: response.status === 429 || response.status >= 500
            ? 'local_stt_unavailable' : 'local_stt_bad_request',
          status: response.status,
        });
        const size = Number(response.headers?.get?.('content-length') || 0);
        if (!Number.isSafeInteger(size) || size > 16384)
          throw new ProviderRequestError('Local STT response exceeded limit.', { code: 'invalid_transcript' });
        let decoded;
        try { decoded = await response.json(); }
        catch { throw new ProviderRequestError('Local STT returned malformed JSON.', { code: 'invalid_transcript' }); }
        controller.signal.throwIfAborted();
        const text = typeof decoded?.text === 'string' ? decoded.text.trim() : '';
        if (!text || text.length > 8000)
          throw new ProviderRequestError('Local STT returned empty or invalid text.', { code: 'invalid_transcript' });
        spanDone?.('finished', { inputChars: text.length, durationMs: performance.now() - started });
        telemetry?.event?.('stt_local_result', { outcome: 'success', durationMs: performance.now() - started });
        return text;
      } catch (error) {
        if (signal?.aborted) {
          spanDone?.('failed', { code: 'cancelled' });
          throw new ProviderRequestError('Transcription cancelled.', { code: 'cancelled' });
        }
        failure = error instanceof ProviderRequestError ? error
          : new ProviderRequestError('Local transcription failed.', {
            code: timedOut ? 'local_stt_timeout' : 'local_stt_unavailable',
          });
        spanDone?.('failed', { code: failure.code, httpStatus: failure.status || 0 });
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', cancel);
      }

      const recoverable = ['local_stt_unavailable', 'local_stt_timeout', 'invalid_transcript']
        .includes(failure.code);
      telemetry?.event?.('stt_local_result', {
        outcome: 'failed', code: failure.code, durationMs: performance.now() - started,
        fallback: recoverable && local.fallback === 'openai',
      });
      if (!recoverable || local.fallback !== 'openai' || !fallbackProvider) throw failure;
      signal?.throwIfAborted();
      telemetry?.event?.('stt_fallback', {
        from: 'parakeet-ultra', to: 'openai', reason: failure.code,
      });
      // The local request's abort is not reused. The parent generation/attempt
      // signal stays authoritative for OpenAI (and for rejecting stale results).
      return fallbackProvider.transcribe(input);
    },
  });
}
