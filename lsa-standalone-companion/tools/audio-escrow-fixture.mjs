import { Phase2NativeClient } from '../src/native/phase2Wire.mjs';
import { stageNativePcm } from '../src/audio/nativePcm.mjs';

// Test-only native-issued permit and deterministic PCM. No actual model,
// audio device, TTS, spatial output, or user data enters this fixture.
const client = new Phase2NativeClient();
try {
  await client.connect();
  const offer = await client.request('turn.next');
  if (offer.status !== 'ok' || offer.source !== 'player_text')
    throw new Error('native_offer_missing');
  const ticket = {
    turnId: offer.turnId, actorIncarnationId: offer.actorIncarnationId,
    leaseId: offer.leaseId, generation: offer.generation
  };
  await client.request('turn.confirm', {
    ...ticket, sessionNonce: offer.sessionNonce, source: offer.source
  });
  const stage = await client.request('turn.reply', {
    ...ticket, replyText: 'Deterministic fixture dialogue not spoken.'
  });
  if (stage.status !== 'staged_not_played') throw new Error('reply_not_staged');

  const untrusted = await client.request('audio.open', {
    ...ticket, sampleRate: 24000
  });
  if (untrusted.status !== 'audio_authorized_not_playing')
    throw new Error('audio_authority_unavailable');

  let reorderedDenied = false;
  try {
    await client.request('audio.chunk', {
      streamId: untrusted.streamId, audioLeaseId: untrusted.audioLeaseId,
      audioGeneration: untrusted.audioGeneration,
      turnId: ticket.turnId, actorIncarnationId: ticket.actorIncarnationId,
      chunkIndex: 1, pcmBase64: Buffer.alloc(200, 1).toString('base64')
    });
  } catch (e) {
    reorderedDenied = e.message === 'native_rejected_audio_out_of_order';
  }
  if (!reorderedDenied) throw new Error('reordered_chunk_accepted');

  const old = {
    streamId: untrusted.streamId, audioLeaseId: untrusted.audioLeaseId,
    audioGeneration: untrusted.audioGeneration,
    turnId: ticket.turnId, actorIncarnationId: ticket.actorIncarnationId
  };
  const cancelled = await client.request('audio.cancel', old);
  if (cancelled.status !== 'ok') throw new Error('audio_cancel_failed');
  const pcm = Buffer.alloc(5600);
  for (let i = 0; i < pcm.length; i += 2)
    pcm.writeInt16LE(((i * 101) % 65000) - 32500, i);
  const result = await stageNativePcm(client, ticket, pcm);
  if (result.status !== 'sealed_not_played' || result.chunkCount !== 2 ||
      result.bufferedBytes !== 5600 || result.playback !== false)
    throw new Error('false_audio_receipt');
  let replayDenied = false;
  try {
    await client.request('audio.chunk', {
      ...old, chunkIndex: 0, pcmBase64: Buffer.alloc(200).toString('base64')
    });
  } catch (e) {
    replayDenied = e.message === 'native_rejected_stale_audio';
  }
  if (!replayDenied) throw new Error('cancelled_audio_replayed');
  console.log(JSON.stringify({
    status: result.status, chunks: result.chunkCount, bytes: result.bufferedBytes,
    previouslyCancelledStreamRejected: replayDenied,
    outOfOrderChunkRejected: reorderedDenied, audible: false
  }));
} catch (error) {
  console.error('audio_escrow_fixture_failed:' + error.message);
  process.exitCode = 1;
} finally {
  client.close();
}
