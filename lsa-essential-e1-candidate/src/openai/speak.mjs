import { endpoint, ProviderRequestError, requestBytes } from './request.mjs';

export async function speak({ config, dialogue, speechProfile, signal, timeoutMs = config.providerWorkDeadlineMs ?? config.turnDeadlineMs, fetchImpl = globalThis.fetch, onPcm, telemetry }) {
  if (!String(dialogue || '').trim()) throw new TypeError('TTS received empty dialogue.');
  const profile = speechProfile || { voice: config.ttsVoice, speed: 1, instructions: '' };
  if (String(speechProfile?.model || config.ttsModel) !== config.ttsModel) throw new TypeError('Speech profile model does not match the configured TTS model.');
  let tail = null;
  let totalBytes = 0;
  let pcmChunks = 0;
  const started = performance.now();
  await requestBytes({
    fetchImpl,
    url: endpoint(config.ttsBaseUrl, 'audio/speech'),
    key: config.ttsKey,
    signal,
    timeoutMs,
    telemetry,
    model: config.ttsModel,
    body: {
      model: config.ttsModel,
      voice: profile.voice,
      input: dialogue,
      response_format: 'pcm',
      ...(profile.speed !== 1 ? { speed: profile.speed } : {}),
      ...(profile.instructions ? { instructions: profile.instructions } : {}),
    },
    onChunk: async bytes => {
      signal?.throwIfAborted();
      let chunk = Buffer.from(bytes);
      if (tail !== null) {
        chunk = Buffer.concat([Buffer.from([tail]), chunk]);
        tail = null;
      }
      if (chunk.length % 2) tail = chunk[chunk.length - 1];
      const usable = chunk.length - (chunk.length % 2);
      if (usable > 0) {
        const pcm = chunk.subarray(0, usable);
        totalBytes += pcm.length;
        pcmChunks++;
        if (pcmChunks === 1) telemetry?.event('pcm_first_ready', { pcmBytes: pcm.length, sampleRate: 24_000, channels: 1, durationMs: performance.now() - started });
        await onPcm(new Uint8Array(pcm));
        signal?.throwIfAborted();
      }
    },
  });
  signal?.throwIfAborted();
  if (totalBytes === 0) throw new ProviderRequestError('OpenAI returned no usable PCM audio.', { code: 'empty_audio' });
  telemetry?.event('pcm_delivery_summary', { pcmBytes: totalBytes, chunks: pcmChunks, audioDurationMs: totalBytes / 48_000 * 1_000, sampleRate: 24_000, channels: 1 });
  return { bytes: totalBytes, chunks: pcmChunks, discardedTrailingByte: tail !== null, sampleRate: 24_000, channels: 1 };
}
