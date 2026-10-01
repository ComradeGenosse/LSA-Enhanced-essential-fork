import { endpoint, ProviderRequestError, responseFailure, safeRequestId } from './request.mjs';

export function pcm16Wav(pcm, sampleRate = 16_000) {
  const bytes = Buffer.from(pcm);
  if (!Number.isSafeInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) throw new TypeError('Unsupported microphone sample rate.');
  if (bytes.length === 0 || bytes.length % 2 !== 0) throw new TypeError('Microphone PCM must contain complete 16-bit samples.');
  const wav = Buffer.allocUnsafe(44 + bytes.length);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + bytes.length, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write('data', 36); wav.writeUInt32LE(bytes.length, 40); bytes.copy(wav, 44);
  return wav;
}

export async function transcribePcm({ pcm, sampleRate = 16_000, config, signal, timeoutMs = config?.providerWorkDeadlineMs ?? config?.turnDeadlineMs ?? 45_000, fetchImpl = globalThis.fetch, telemetry }) {
  if (!config?.transcriptionKey) throw new ProviderRequestError('The selected OpenAI transcription credential is missing.', { code: 'missing_credential' });
  signal?.throwIfAborted();
  const form = new FormData();
  form.append('model', config.transcriptionModel);
  const wav = pcm16Wav(pcm, sampleRate);
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'player-input.wav');
  const started = performance.now();
  const spanDone = telemetry?.startSpan('stt', { model: config.transcriptionModel, bytes: pcm.byteLength, wavBytes: wav.byteLength, sampleRate });
  let requestId;
  try {
    const response = await fetchImpl(endpoint(config.transcriptionBaseUrl, 'audio/transcriptions'), {
      method: 'POST', headers: { authorization: `Bearer ${config.transcriptionKey}` }, body: form, signal,
    });
    requestId = safeRequestId(response.headers?.get?.('x-request-id'));
    telemetry?.event('provider_headers', { operation: 'stt', httpStatus: response.status, durationMs: performance.now() - started, requestId });
    signal?.throwIfAborted();
    if (!response.ok) throw await responseFailure(response, 'OpenAI transcription');
    let json;
    try { json = await response.json(); }
    catch { throw new ProviderRequestError('OpenAI transcription returned invalid JSON.', { code: 'invalid_response' }); }
    signal?.throwIfAborted();
    const text = String(json?.text || '').trim();
    if (!text || text.length > 8000) throw new ProviderRequestError('OpenAI transcription was empty or too long.', { code: 'invalid_transcript' });
    spanDone?.('finished', { httpStatus: response.status, inputChars: text.length, requestId });
    return text;
  } catch (error) {
    spanDone?.('failed', { code: /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'provider_request_failed', httpStatus: Number.isInteger(error?.status) ? error.status : 0 });
    if (error instanceof ProviderRequestError) throw error;
    if (signal?.aborted) throw new ProviderRequestError('OpenAI transcription was cancelled.', { code: 'cancelled' });
    throw new ProviderRequestError('OpenAI transcription could not be completed.', { code: 'network_error' });
  }
}
