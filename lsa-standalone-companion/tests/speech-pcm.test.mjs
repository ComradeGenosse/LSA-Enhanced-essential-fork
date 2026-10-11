import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSpeechPcmProvider } from '../src/audio/speechProvider.mjs';
import { stageNativePcmStream } from '../src/audio/nativePcm.mjs';

function fixture(samples, { abortOnChunk = false, denyCredit = false } = {}) {
  const calls = [], frames = [];
  const turn = { turnId: randomUUID(), actorIncarnationId: randomUUID(),
    leaseId: randomUUID(), generation: '1' };
  const stream = { streamId: randomUUID(), audioLeaseId: randomUUID(),
    audioGeneration: '2' };
  let admittedBytes = 0, queued = 0, claimedIndex = 0, statusChecks = 0;
  const controller = new AbortController();
  const native = {
    async request(type, fields) {
      calls.push(type);
      if (type === 'audio.open') return {
        ...stream, sampleRate: 24000, status: 'audio_authorized_not_playing'
      };
      if (type === 'audio.chunk') {
        assert.equal(fields.chunkIndex, claimedIndex);
        const bytes = Buffer.from(fields.pcmBase64, 'base64');
        if (denyCredit && queued + bytes.length > 192000)
          throw new Error('native_rejected_audio_backpressure');
        frames.push(bytes);
        admittedBytes += bytes.length;
        queued += bytes.length;
        claimedIndex++;
        if (abortOnChunk) controller.abort();
        return { status: 'buffered_not_played' };
      }
      if (type === 'audio.status') {
        statusChecks++;
        // Fake output has accepted all buffered bytes, not physically played.
        const value = { status: 'not_played', queuedBytes: 0,
          acceptedBytes: admittedBytes, forwardedBytes: admittedBytes,
          creditsBytes: 192000, sealed: false };
        queued = 0;
        return value;
      }
      if (type === 'audio.end') {
        assert.equal(fields.chunkCount, claimedIndex);
        assert.equal(fields.totalBytes, admittedBytes);
        return { status: 'sealed_not_played' };
      }
      if (type === 'audio.cancel') return { status: 'ok' };
      throw new Error('invalid_fixture_command');
    }
  };
  return { calls, frames, turn, controller, native, get statusChecks() { return statusChecks; } };
}

test('speech adapter requests raw PCM without storing text in logs', async () => {
  let call;
  const provider = createSpeechPcmProvider({
    apiKey: 'private-fixture-key', model: 'gpt-4o-mini-tts', voice: 'onyx',
    instructions: 'Speak conversationally.',
    fetchImpl: async (url, init) => {
      call = { url, init };
      return { ok: true, body: new ReadableStream({
        start(controller) {
          controller.enqueue(Uint8Array.of(1));
          controller.enqueue(Uint8Array.of(2, 3, 4));
          controller.close();
        }
      }) };
    }
  });
  const frames = [];
  for await (const frame of provider.streamPcm({ text: 'Hello' })) frames.push(frame);
  assert.deepEqual(frames.map(a => [...a]), [[1], [2, 3, 4]]);
  assert.equal(call.url, 'https://api.openai.com/v1/audio/speech');
  const args = JSON.parse(call.init.body);
  assert.equal(args.response_format, 'pcm');
  assert.equal(args.voice, 'onyx');
  assert.equal(args.model, 'gpt-4o-mini-tts');
  assert.equal(args.input, 'Hello');
  assert.equal(args.instructions, 'Speak conversationally.');
  assert.equal(call.init.headers.Authorization, 'Bearer private-fixture-key');
  assert.ok(!call.init.body.includes('private-fixture-key'));
});

test('true streamed source preserves odd-sized HTTP frames and exact samples', async () => {
  const f = fixture();
  async function* audio() {
    yield Uint8Array.of(1);
    yield Uint8Array.of(2, 3, 4, 5);
    yield Uint8Array.of(6, 7, 8);
    yield Buffer.alloc(4090, 90);
  }
  const result = await stageNativePcmStream(f.native, f.turn, audio());
  assert.equal(result.status, 'sealed_not_played');
  assert.equal(result.playback, false);
  assert.deepEqual(Buffer.concat(f.frames),
    Buffer.concat([Buffer.from([1,2,3,4,5,6,7,8]), Buffer.alloc(4090, 90)]));
  assert.equal(result.bufferedBytes, 4098);
});

test('odd trailing byte rejects EOS and cancels exact native audio', async () => {
  const f = fixture();
  async function* audio() { yield Buffer.from([1, 2, 3]); }
  await assert.rejects(stageNativePcmStream(f.native, f.turn, audio()),
    /invalid_pcm_length/);
  assert.equal(f.calls.at(-1), 'audio.cancel');
  assert.ok(!f.calls.includes('audio.end'));
});

test('late cancellation destroys native stream before sealing', async () => {
  const f = fixture(null, { abortOnChunk: true });
  async function* audio() { yield Buffer.alloc(3200); }
  await assert.rejects(stageNativePcmStream(f.native, f.turn, audio(), {
    signal: f.controller.signal
  }), /pcm_transfer_cancelled/);
  assert.equal(f.calls.at(-1), 'audio.cancel');
  assert.ok(!f.calls.includes('audio.end'));
});

test('simulated output credit permits over four seconds with bounded retries', async () => {
  const f = fixture(null, { denyCredit: true });
  async function* audio() { yield Buffer.alloc(300000); }
  const outcome = await stageNativePcmStream(f.native, f.turn, audio());
  assert.equal(outcome.bufferedBytes, 300000);
  assert.equal(outcome.chunkCount, 100);
  assert.ok(f.statusChecks > 0);
  assert.equal(outcome.playback, false);
});

test('speech provider rejects http error and unauthorized model configurations', async () => {
  assert.throws(() => createSpeechPcmProvider({
    apiKey: '', model: 'gpt-4o-mini-tts', voice: 'onyx'
  }), /speech_provider_configuration_missing/);
  const provider = createSpeechPcmProvider({
    apiKey: 'fake', model: 'gpt-4o-mini-tts', voice: 'onyx',
    fetchImpl: async () => ({ ok: false, status: 429 })
  });
  await assert.rejects(async () => {
    for await (const _ of provider.streamPcm({ text: 'Hello' })) {}
  }, /speech_http_failure/);
});
