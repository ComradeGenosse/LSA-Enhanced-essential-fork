// Production transport for raw PCM16LE mono 24 kHz. Native buffer credits
// indicate accepted bytes passed to an output sink, never physical audibility.
export const PCM_RATE = 24000;
export const MAX_PCM_BYTES = 1_440_000; // 30 seconds per authenticated turn
export const MAX_CHUNK_BYTES = 3000;
export const MAX_CHUNKS = 480;
export const MAX_PENDING_BYTES = 192000; // at most 4s resident on native
const CREDIT_TIMEOUT_MS = 2200;

export async function stageNativePcm(client, nativeTurn, pcm16, { signal } = {}) {
  if (!client || !nativeTurn || !Buffer.isBuffer(pcm16))
    throw new Error('invalid_pcm_transfer');
  if (pcm16.length < 2 || pcm16.length > MAX_PCM_BYTES || pcm16.length % 2)
    throw new Error('invalid_pcm_length');
  async function* source() { yield pcm16; }
  return stageNativePcmStream(client, nativeTurn, source(), { signal });
}

const pause = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new Error('pcm_transfer_cancelled')); return; }
  const finish = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', aborted);
    resolve();
  };
  const aborted = () => {
    clearTimeout(timer);
    signal?.removeEventListener('abort', aborted);
    reject(new Error('pcm_transfer_cancelled'));
  };
  const timer = setTimeout(finish, ms);
  signal?.addEventListener('abort', aborted, { once: true });
});

// A streaming producer (e.g., OpenAI PCM HTTP response). Never materializes
// all TTS bytes in RAM; preserves 16-bit sample alignment across arbitrary
// HTTP chunk boundaries. No audio source is treated as already played.
export async function stageNativePcmStream(client, nativeTurn, source, { signal } = {}) {
  if (!client || typeof client.request !== 'function' || !nativeTurn ||
      !source || typeof source[Symbol.asyncIterator] !== 'function')
    throw new Error('invalid_pcm_stream');
  if (signal?.aborted) throw new Error('pcm_transfer_cancelled');
  const { turnId, actorIncarnationId, leaseId, generation } = nativeTurn;
  const opened = await client.request('audio.open', {
    turnId, actorIncarnationId, leaseId, generation, sampleRate: PCM_RATE
  });
  if (opened.status !== 'audio_authorized_not_playing')
    throw new Error('pcm_lease_not_authorized');
  const claims = {
    streamId: opened.streamId, audioLeaseId: opened.audioLeaseId,
    audioGeneration: opened.audioGeneration, turnId, actorIncarnationId
  };
  let index = 0, total = 0, carry = null;
  const push = async bytes => {
    if (signal?.aborted) throw new Error('pcm_transfer_cancelled');
    if (index >= MAX_CHUNKS || total + bytes.length > MAX_PCM_BYTES)
      throw new Error('pcm_stream_capacity');
    const packet = { ...claims, chunkIndex: index,
      pcmBase64: bytes.toString('base64') };
    const deadline = Date.now() + CREDIT_TIMEOUT_MS;
    while (true) {
      if (signal?.aborted) throw new Error('pcm_transfer_cancelled');
      try {
        const response = await client.request('audio.chunk', packet);
        if (response.status !== 'buffered_not_played')
          throw new Error('pcm_not_buffered');
        total += bytes.length;
        index++;
        return;
      } catch (error) {
        if (error.message !== 'native_rejected_audio_backpressure') throw error;
        if (Date.now() >= deadline)
          throw new Error('pcm_no_native_output_credit');
        const credit = await client.request('audio.status', claims);
        if (credit.status !== 'not_played' || credit.sealed)
          throw new Error('pcm_invalid_output_state');
        if (credit.creditsBytes < bytes.length)
          await pause(40, signal);
        // The same chunkIndex is retried only if native explicitly rejected
        // it for lack of room; never replay a write after an unknown timeout.
      }
    }
  };
  try {
    for await (const frame of source) {
      if (signal?.aborted) throw new Error('pcm_transfer_cancelled');
      if (!(frame instanceof Uint8Array)) throw new Error('invalid_pcm_frame');
      if (frame.length === 0) continue;
      let bytes = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
      if (carry !== null) {
        bytes = Buffer.concat([Buffer.from([carry]), bytes]);
        carry = null;
      }
      const usable = bytes.length & ~1;
      for (let offset = 0; offset < usable; offset += MAX_CHUNK_BYTES) {
        const part = bytes.subarray(offset, Math.min(usable, offset + MAX_CHUNK_BYTES));
        if (part.length < 2 || part.length % 2) throw new Error('invalid_pcm_frame');
        await push(part);
      }
      if (usable !== bytes.length) carry = bytes[bytes.length - 1];
    }
    if (signal?.aborted) throw new Error('pcm_transfer_cancelled');
    if (carry !== null || total < 2) throw new Error('invalid_pcm_length');
    const response = await client.request('audio.end', {
      ...claims, chunkCount: index, totalBytes: total
    });
    if (response.status !== 'sealed_not_played') throw new Error('pcm_not_sealed');
    return { status: 'sealed_not_played', streamId: claims.streamId,
      bufferedBytes: total, chunkCount: index, playback: false };
  } catch (error) {
    try { await client.request('audio.cancel', claims); } catch {}
    throw error;
  }
}
