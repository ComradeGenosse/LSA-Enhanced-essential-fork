import { Phase2NativeClient } from '../src/native/phase2Wire.mjs';
import { stageNativePcmStream } from '../src/audio/nativePcm.mjs';

// Separate net481 process uses simulated audio acceptance (no sound device).
// Validates >4 sec transfer, native rolling credits and truthful EOS only.
const client = new Phase2NativeClient();
try {
  await client.connect();
  const offer = await client.request('turn.next');
  if (offer.status !== 'ok') throw Error('native_offer_missing');
  const claims = {
    turnId: offer.turnId, actorIncarnationId: offer.actorIncarnationId,
    leaseId: offer.leaseId, generation: offer.generation
  };
  await client.request('turn.confirm', {
    ...claims, sessionNonce: offer.sessionNonce, source: offer.source
  });
  await client.request('turn.reply', { ...claims, replyText: 'Fixture long answer.' });
  async function* pcm() {
    for (let i = 0; i < 110; i++) {
      // A 3KB chunk crosses arbitrary HTTP frame boundaries.
      yield Buffer.alloc(1199, i);
      yield Buffer.alloc(1801, i);
    }
  }
  const output = await stageNativePcmStream(client, claims, pcm());
  if (output.status !== 'sealed_not_played' || output.bufferedBytes !== 330000 ||
      output.chunkCount < 110 || output.playback !== false)
    throw new Error('long_pcm_receipt_invalid');
  console.log(JSON.stringify({
    result: output.status, audioBytes: output.bufferedBytes,
    durationSeconds: output.bufferedBytes / 48000, soundDevice: 'simulated_only',
    heard: false
  }));
} catch (error) {
  console.error('rolling_audio_fixture_failed:' + error.message);
  process.exitCode = 1;
} finally {
  client.close();
}
