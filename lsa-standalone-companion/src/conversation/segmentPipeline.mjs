import {
  PCM_RATE, MAX_CHUNK_BYTES, MAX_CHUNKS, MAX_PCM_BYTES
} from '../audio/nativePcm.mjs';
import { awaitNativePhysicalPlayback } from '../audio/physicalPlayback.mjs';

// S2 uses ONE native stream for a whole AI turn, with explicit audio segment
// boundaries. TTS produces segment N before the model must finish the entire
// response. No native/audio/history "played" receipt is inferred from EOS.
const nap = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(new Error('typed_turn_cancelled')); return; }
  const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
  const cancel = () => { cleanup(); reject(new Error('typed_turn_cancelled')); };
  const timer = setTimeout(() => { cleanup(); resolve(); }, ms);
  signal?.addEventListener('abort', cancel, { once: true });
});
export async function stageNativeSpeechSegments({
  client, offer, claims, modelSegments, tts, signal,
  confirmPlayback = false, onPlaybackProgress
}) {
  if (!client?.request || !offer?.turnId || !tts?.streamPcm ||
      !modelSegments?.[Symbol.asyncIterator])
    throw new Error('invalid_segment_pipeline');
  let audio = null, index = 0, chunkIndex = 0, bytes = 0;
  const text = [];
  const exact = {
    turnId: claims.turnId,
    actorIncarnationId: claims.actorIncarnationId,
    leaseId: claims.leaseId, generation: claims.generation
  };
  const writeChunk = async data => {
    if (signal?.aborted) throw new Error('typed_turn_cancelled');
    if (chunkIndex >= MAX_CHUNKS || bytes + data.length > MAX_PCM_BYTES)
      throw new Error('pcm_stream_capacity');
    const envelope = {
      streamId: audio.streamId, audioLeaseId: audio.audioLeaseId,
      audioGeneration: audio.audioGeneration,
      turnId: exact.turnId, actorIncarnationId: exact.actorIncarnationId
    };
    const absoluteDeadline = Date.now() + 90000;
    let lastProgressAt = Date.now(), lastForwarded = -1;
    for (;;) {
      try {
        const result = await client.request('audio.chunk', {
          ...envelope, chunkIndex, pcmBase64: data.toString('base64')
        });
        if (result.status !== 'buffered_not_played')
          throw new Error('segment_pcm_not_buffered');
        bytes += data.length; chunkIndex++;
        return;
      } catch (error) {
        if (error.message !== 'native_rejected_audio_backpressure') throw error;
        const progress = await client.request('audio.status', envelope);
        if (progress.status !== 'not_played' || progress.sealed)
          throw new Error('pcm_invalid_output_state');
        const now = Date.now();
        if (progress.forwardedBytes > lastForwarded) {
          lastForwarded = progress.forwardedBytes;
          lastProgressAt = now;
        }
        if (now >= absoluteDeadline || now - lastProgressAt > 6500)
          throw new Error('pcm_no_native_output_credit');
        if (progress.creditsBytes < data.length) await nap(40, signal);
      }
    }
  };
  try {
    for await (const segment of modelSegments) {
      if (signal?.aborted) throw new Error('typed_turn_cancelled');
      if (typeof segment !== 'string' || !segment.trim() ||
          segment.length > 500 || index >= 12)
        throw new Error('invalid_speech_segment');
      const stage = await client.request('turn.segment', {
        ...exact, segmentIndex: index, segmentText: segment
      });
      if (stage.status !== 'segment_staged_not_played')
        throw new Error('native_segment_not_authorized');
      text.push(segment);
      if (!audio) {
        audio = await client.request('audio.open', { ...exact, sampleRate: PCM_RATE });
        if (audio.status !== 'audio_authorized_not_playing')
          throw new Error('native_audio_not_authorized');
      }
      let carry = null, segmentBytes = 0;
      for await (const frame of tts.streamPcm({ text: segment, identity: offer, signal })) {
        if (signal?.aborted) throw new Error('typed_turn_cancelled');
        if (!(frame instanceof Uint8Array)) throw new Error('invalid_pcm_frame');
        if (!frame.length) continue;
        let data = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
        if (carry !== null) { data = Buffer.concat([Buffer.from([carry]), data]); carry = null; }
        const usable = data.length & ~1;
        for (let offset = 0; offset < usable; offset += MAX_CHUNK_BYTES) {
          const part = data.subarray(offset, Math.min(offset + MAX_CHUNK_BYTES, usable));
          await writeChunk(part);
          segmentBytes += part.length;
        }
        if (usable !== data.length) carry = data[usable];
      }
      if (carry !== null || segmentBytes < 2) throw new Error('invalid_pcm_length');
      const mark = await client.request('audio.segment', {
        streamId: audio.streamId, audioLeaseId: audio.audioLeaseId,
        audioGeneration: audio.audioGeneration,
        turnId: exact.turnId, actorIncarnationId: exact.actorIncarnationId,
        segmentIndex: index, totalBytes: bytes
      });
      if (mark.status !== 'segment_audio_buffered_not_played')
        throw new Error('invalid_segment_pcm_boundary');
      index++;
    }
    if (index < 1) throw new Error('empty_speech_stream');
    const finish = await client.request('turn.segments.end', {
      ...exact, segmentCount: index
    });
    if (finish.status !== 'segments_final_not_played')
      throw new Error('native_speech_final_rejected');
    const end = await client.request('audio.end', {
      streamId: audio.streamId, audioLeaseId: audio.audioLeaseId,
      audioGeneration: audio.audioGeneration,
      turnId: exact.turnId, actorIncarnationId: exact.actorIncarnationId,
      chunkCount: chunkIndex, totalBytes: bytes
    });
    if (end.status !== 'sealed_not_played') throw new Error('native_pcm_not_sealed');
    const physicalReceipt = confirmPlayback
      ? await awaitNativePhysicalPlayback(client, {
          streamId: audio.streamId, audioLeaseId: audio.audioLeaseId,
          audioGeneration: audio.audioGeneration,
          turnId: exact.turnId, actorIncarnationId: exact.actorIncarnationId
        }, { expectedBytes: bytes, expectedSegments: index, signal,
          onProgress: onPlaybackProgress }) : null;
    return { status: 'sealed_not_played', playback: false,
      segmentCount: index, bytes, text: text.join(' '),
      ...(physicalReceipt ? { physicalReceipt } : {}) };
  } catch (error) {
    if (audio) {
      try {
        await client.request('audio.cancel', {
          streamId: audio.streamId, audioLeaseId: audio.audioLeaseId,
          audioGeneration: audio.audioGeneration, turnId: exact.turnId,
          actorIncarnationId: exact.actorIncarnationId
        });
      } catch {}
    }
    throw error;
  }
}
