import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { stageNativePcm, MAX_CHUNKS, MAX_PCM_BYTES } from '../src/audio/nativePcm.mjs';

function fixture({ failIndex = -1 } = {}) {
  const turn = { turnId: randomUUID(), actorIncarnationId: randomUUID(),
    leaseId: randomUUID(), generation: '99' };
  const stream = { streamId: randomUUID(), audioLeaseId: randomUUID(),
    audioGeneration: '100' };
  const calls = [];
  let next = 0, count = 0, bytes = 0;
  const client = { async request(type, claims) {
    calls.push({ type, claims });
    if (type === 'audio.open') {
      assert.deepEqual(claims, { ...turn, sampleRate: 24000 });
      return { ...stream, status: 'audio_authorized_not_playing', sampleRate: 24000 };
    }
    if (type === 'audio.chunk') {
      assert.equal(claims.chunkIndex, next);
      assert.equal(claims.audioLeaseId, stream.audioLeaseId);
      if (next === failIndex) throw new Error('native_rejected_audio_backpressure');
      const raw = Buffer.from(claims.pcmBase64, 'base64');
      assert.equal(raw.length % 2, 0);
      assert.ok(raw.length <= 3000);
      bytes += raw.length;
      count++;
      next++;
      return { status: 'buffered_not_played' };
    }
    if (type === 'audio.end') {
      assert.equal(claims.chunkCount, count);
      assert.equal(claims.totalBytes, bytes);
      return { status: 'sealed_not_played' };
    }
    if (type === 'audio.cancel') {
      assert.equal(claims.streamId, stream.streamId);
      return { status: 'ok' };
    }
    throw new Error('unexpected_audio_call');
  }};
  return { turn, stream, calls, client };
}

test('PCM16 is transferred in exact bounded chunks; EOS does not assert audibility', async () => {
  const { turn, calls, client } = fixture();
  const pcm = Buffer.alloc(6200);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE((i % 32768) - 16384, i);
  const answer = await stageNativePcm(client, turn, pcm);
  assert.deepEqual({
    status: answer.status, bufferedBytes: answer.bufferedBytes,
    chunkCount: answer.chunkCount, playback: answer.playback
  }, { status: 'sealed_not_played', bufferedBytes: 6200,
    chunkCount: 3, playback: false });
  assert.deepEqual(calls.map(x => x.type), [
    'audio.open', 'audio.chunk', 'audio.chunk', 'audio.chunk', 'audio.end'
  ]);
  assert.deepEqual(calls.filter(x => x.type === 'audio.chunk').map(x => x.claims.chunkIndex),
    [0, 1, 2]);
});

test('max buffer accepts 64 exact 3000-byte chunks, refuses any larger request', async () => {
  const { turn, calls, client } = fixture();
  const pcm = Buffer.alloc(MAX_PCM_BYTES);
  const result = await stageNativePcm(client, turn, pcm);
  assert.equal(result.chunkCount, MAX_CHUNKS);
  assert.equal(calls.filter(x => x.type === 'audio.chunk').length, MAX_CHUNKS);
  await assert.rejects(stageNativePcm(client, turn,
    Buffer.alloc(MAX_PCM_BYTES + 2)), /invalid_pcm_length/);
});

test('reject odd byte alignment and zero-length PCM before reserving native stream', async () => {
  const { turn, calls, client } = fixture();
  await assert.rejects(stageNativePcm(client, turn, Buffer.alloc(3)),
    /invalid_pcm_length/);
  await assert.rejects(stageNativePcm(client, turn, Buffer.alloc(0)),
    /invalid_pcm_length/);
  assert.equal(calls.length, 0);
});

test('native rejection midway cancels the exact stream, never seals or replays', async () => {
  const { turn, calls, client } = fixture({ failIndex: 1 });
  await assert.rejects(stageNativePcm(client, turn, Buffer.alloc(6500)),
    /native_rejected_audio_backpressure/);
  assert.deepEqual(calls.map(x => x.type), [
    'audio.open', 'audio.chunk', 'audio.chunk', 'audio.cancel'
  ]);
});

test('cancellation after opening prevents partial playback receipt', async () => {
  const { turn, calls, client } = fixture();
  const cancel = new AbortController();
  const original = client.request.bind(client);
  client.request = async (type, claims) => {
    const result = await original(type, claims);
    if (type === 'audio.chunk') cancel.abort();
    return result;
  };
  await assert.rejects(stageNativePcm(client, turn, Buffer.alloc(6200),
    { signal: cancel.signal }), /pcm_transfer_cancelled/);
  assert.equal(calls.at(-1).type, 'audio.cancel');
  assert.ok(!calls.some(x => x.type === 'audio.end'));
});

test('pre-aborted stream cannot open a native audio lease', async () => {
  const { turn, calls, client } = fixture();
  const cancel = new AbortController(); cancel.abort();
  await assert.rejects(stageNativePcm(client, turn, Buffer.alloc(200),
    { signal: cancel.signal }), /pcm_transfer_cancelled/);
  assert.deepEqual(calls, []);
});
