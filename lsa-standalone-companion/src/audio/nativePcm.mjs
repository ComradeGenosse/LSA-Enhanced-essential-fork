// Phase 4: a bounded native-authorized PCM transfer.
// The only successful final state here is sealed_not_played. Device playback,
// spatial audibility, lip-sync, and history commitment require a future native
// output adapter with real completion callbacks. Never call them "complete".
export const PCM_RATE = 24000;
export const MAX_PCM_BYTES = 192000;
export const MAX_CHUNK_BYTES = 3000;
export const MAX_CHUNKS = 64;

export async function stageNativePcm(client, nativeTurn, pcm16, { signal } = {}) {
  if (!client || typeof client.request !== 'function' ||
      !nativeTurn || !Buffer.isBuffer(pcm16))
    throw new Error('invalid_pcm_transfer');
  if (pcm16.length < 2 || pcm16.length > MAX_PCM_BYTES || pcm16.length % 2)
    throw new Error('invalid_pcm_length');
  if (signal?.aborted) throw new Error('pcm_transfer_cancelled');

  const { turnId, actorIncarnationId, leaseId, generation } = nativeTurn;
  const audio = await client.request('audio.open', {
    turnId, actorIncarnationId, leaseId, generation, sampleRate: PCM_RATE
  });
  if (audio.status !== 'audio_authorized_not_playing')
    throw new Error('pcm_lease_not_authorized');

  const claims = {
    streamId: audio.streamId, audioLeaseId: audio.audioLeaseId,
    audioGeneration: audio.audioGeneration, turnId, actorIncarnationId
  };
  let index = 0;
  try {
    for (let offset = 0; offset < pcm16.length; offset += MAX_CHUNK_BYTES) {
      if (signal?.aborted) throw new Error('pcm_transfer_cancelled');
      const part = pcm16.subarray(offset, offset + MAX_CHUNK_BYTES);
      const ack = await client.request('audio.chunk', {
        ...claims, chunkIndex: index, pcmBase64: part.toString('base64')
      });
      if (ack.status !== 'buffered_not_played')
        throw new Error('pcm_not_buffered');
      index++;
      if (index > MAX_CHUNKS) throw new Error('pcm_chunk_capacity');
    }
    if (signal?.aborted) throw new Error('pcm_transfer_cancelled');
    const result = await client.request('audio.end', {
      ...claims, chunkCount: index, totalBytes: pcm16.length
    });
    if (result.status !== 'sealed_not_played')
      throw new Error('pcm_not_sealed');
    return { status: 'sealed_not_played', streamId: audio.streamId,
      bufferedBytes: pcm16.length, chunkCount: index, playback: false };
  } catch (error) {
    try { await client.request('audio.cancel', claims); } catch {}
    throw error;
  }
}


// True incremental PCM transfer: does not materialize all TTS audio in Node.
// Handles odd byte boundaries from arbitrary HTTP chunks and propagates
// bounded native backpressure. Deliberately refuses streams longer than the
// four-second native escrow while no physical output consumer is installed.
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
      throw new Error('pcm_buffer_capacity');
    const result = await client.request('audio.chunk', {
      ...claims, chunkIndex: index, pcmBase64: bytes.toString('base64')
    });
    if (result.status !== 'buffered_not_played') throw new Error('pcm_not_buffered');
    total += bytes.length;
    index++;
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
    const result = await client.request('audio.end', {
      ...claims, chunkCount: index, totalBytes: total
    });
    if (result.status !== 'sealed_not_played') throw new Error('pcm_not_sealed');
    return { status: 'sealed_not_played', streamId: claims.streamId,
      bufferedBytes: total, chunkCount: index, playback: false };
  } catch (error) {
    try { await client.request('audio.cancel', claims); } catch {}
    throw error;
  }
}
