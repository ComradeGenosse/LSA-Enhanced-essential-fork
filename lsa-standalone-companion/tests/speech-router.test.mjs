import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { createFasterQwenSpeechProvider } from '../src/audio/qwenSpeechProvider.mjs';
import { createSpeechPcmProvider } from '../src/audio/speechProvider.mjs';
import { createSpeechRouter, parseVoiceAssignments } from '../src/audio/speechContract.mjs';
import { createConfiguredSpeechRouter } from '../src/audio/speechSetup.mjs';

const offer = () => ({
  hostRunId: randomUUID(), actorIncarnationId: randomUUID(),
  turnId: randomUUID(), conversationId: randomUUID(),
  worldEpoch: 1
});
const collect = async provider => {
  const frames = [];
  for await (const data of provider) frames.push(Buffer.from(data));
  return Buffer.concat(frames);
};
const okPcm = bytes => ({
  ok: true,
  headers: { get: key => key === 'x-lsa-sample-rate' ? '24000' : null },
  body: new ReadableStream({
    start(c) { c.enqueue(bytes); c.close(); }
  })
});

test('Qwen provider never sends the OpenAI key and matches registered voice', async () => {
  const calls = [];
  const provider = createFasterQwenSpeechProvider({
    baseUrl: 'http://127.0.0.1:8000/v1', voices: ['nathan', 'aiden_local'],
    fetchImpl: async (url, options) => {
      calls.push({ url, options }); return okPcm(Uint8Array.of(1, 2, 3, 4));
    }
  });
  assert.equal(provider.capabilities.outputFormat, 'pcm_s16le_mono_24000');
  const data = await collect(provider.streamPcm({
    text: 'Morning, Nathan.', voice: 'nathan',
    instructions: 'Speak warmly.'
  }));
  assert.equal(data.length, 4);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:8000/v1/audio/speech');
  const body = JSON.parse(calls[0].options.body);
  assert.deepEqual(body, {
    model: 'qwen3-tts', input: 'Morning, Nathan.',
    voice: 'nathan', response_format: 'pcm',
    instructions: 'Speak warmly.'
  });
  assert.ok(!Object.hasOwn(calls[0].options.headers, 'Authorization'));
  assert.ok(!calls[0].options.body.includes('OPENAI_API_KEY'));
});

test('Qwen rejects non-loopback addresses and userinfo redirects at configuration', () => {
  for (const url of [
    'https://api.openai.com/v1', 'http://example.com/v1',
    'http://localhost:8000/v1', 'http://127.0.0.2:8000/v1',
    'http://127.0.0.1:8000/other',
    'http://user:pass@127.0.0.1:8000/v1',
    'http://127.0.0.1:8000/v1?key=x'
  ]) assert.throws(
    () => createFasterQwenSpeechProvider({ baseUrl: url, voices: ['nathan'] }),
    /qwen_invalid_loopback_url/
  );
});

test('Qwen wrong voice / invalid sample-rate fail closed', async () => {
  let called = 0;
  const provider = createFasterQwenSpeechProvider({
    voices: ['nathan'], fetchImpl: async () => {
      called++;
      const reply = okPcm(Uint8Array.of(1, 2));
      return { ...reply, headers: { get: () => '48000' } };
    }
  });
  await assert.rejects(collect(provider.streamPcm({ text: 'Hello', voice: 'fake' })),
    /qwen_invalid_speech_request/);
  assert.equal(called, 0);
  await assert.rejects(collect(provider.streamPcm({ text: 'Hello', voice: 'nathan' })),
    /qwen_pcm_format_mismatch/);
});

test('Qwen cancellation stops a pending provider without yielding stale PCM', async () => {
  const cancel = new AbortController();
  let issued = false;
  const provider = createFasterQwenSpeechProvider({
    voices: ['nathan'], fetchImpl: async (_url, options) => {
      issued = true;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () =>
          reject(new Error('aborted')), { once: true });
      });
    }
  });
  const work = collect(provider.streamPcm({
    text: 'Never play.', voice: 'nathan', signal: cancel.signal
  }));
  await new Promise(resolve => setImmediate(resolve));
  cancel.abort();
  await assert.rejects(work, /speech_cancelled/);
  assert.ok(issued);
});

test('voice registry rejects unsafe entries, duplicates and forged revisions', () => {
  const world = randomUUID(), char = randomUUID();
  const fixture = {
    schemaVersion: 1, worldProfileId: world, assignments: [{
      characterId: char, assignmentVersion: 1, recordRevision: 1,
      profile: { provider: 'faster-qwen3-tts', voice: 'nathan', profileRevision: 1 }
    }]
  };
  const parsed = parseVoiceAssignments(fixture);
  assert.equal(parsed.find(char).voice, 'nathan');
  assert.throws(() => parseVoiceAssignments({
    ...fixture, assignments: [...fixture.assignments, ...fixture.assignments]
  }), /invalid_voice_assignment_registry/);
  assert.throws(() => parseVoiceAssignments({
    ...fixture, assignments: [{ ...fixture.assignments[0],
      profile: { provider: 'faster-qwen3-tts', voice: 'nathan',
        ref_audio: 'C:\\secrets\\nathan.wav' } }]
  }), /invalid_voice_assignment_registry/);
  assert.throws(() => parseVoiceAssignments({
    ...fixture, schemaVersion: 2
  }), /invalid_voice_assignment_registry/);
});

test('router only allows persisted voice choice after exact native identity proof', async () => {
  const world = randomUUID(), person = randomUUID(), identity = offer();
  const assignments = parseVoiceAssignments({
    schemaVersion: 1, worldProfileId: world, assignments: [{
      characterId: person, assignmentVersion: 1, recordRevision: 1,
      profile: { provider: 'faster-qwen3-tts', voice: 'nathan', profileRevision: 1 }
    }]
  });
  const spoken = [];
  const mock = id => ({
    id, capabilities: { cancellation: true,
      streaming: true, outputFormat: 'pcm_s16le_mono_24000' },
    async *streamPcm({ voice }) {
      spoken.push([id, voice]); yield Buffer.from([5, 6]);
    }
  });
  const providers = { openai: mock('openai'),
    'faster-qwen3-tts': mock('faster-qwen3-tts') };
  const options = { providers, assignments,
    defaultProfile: { provider: 'openai', voice: 'onyx' } };
  const without = createSpeechRouter(options);
  await collect(without.streamPcm({ text: 'Hello', identity }));
  assert.deepEqual(spoken.pop(), ['openai','onyx']);

  const resolver = current => ({
    characterId: person, worldProfileId: world,
    hostRunId: current.hostRunId, actorIncarnationId: current.actorIncarnationId,
    turnId: current.turnId
  });
  const withProof = createSpeechRouter({
    ...options, resolveVerifiedCharacter: resolver
  });
  await collect(withProof.streamPcm({ text: 'Hello again', identity }));
  assert.deepEqual(spoken.pop(), ['faster-qwen3-tts','nathan']);
  const fake = createSpeechRouter({ ...options,
    resolveVerifiedCharacter: () => ({
      ...resolver(identity), actorIncarnationId: randomUUID()
    })
  });
  await assert.rejects(collect(fake.streamPcm({ text: 'Wrong', identity })),
    /untrusted_character_binding/);
});

test('session voice pool deterministically ties voice to actor incarnation', async () => {
  const native = offer(), seen = [];
  const router = createSpeechRouter({
    providers: { openai: {
      id: 'openai', capabilities: { cancellation: true,
        streaming: true, outputFormat: 'pcm_s16le_mono_24000' },
      async *streamPcm({ voice }) { seen.push(voice); yield Buffer.from([1, 2]); }
    } },
    defaultProfile: { provider: 'openai', voice: 'onyx' },
    sessionVoices: ['onyx', 'ash', 'nova']
  });
  await collect(router.streamPcm({ text: 'First', identity: native }));
  await collect(router.streamPcm({ text: 'Second', identity: {
    ...native, turnId: randomUUID()
  } }));
  assert.equal(seen[0], seen[1]);
  assert.ok(['onyx', 'ash', 'nova'].includes(seen[0]));
});

test('Qwen mode boots without cloud TTS credentials and exercises real local HTTP PCM', async () => {
  let received = 0;
  const server = createServer((req, res) => {
    let json = '';
    req.on('data', p => { json += p; });
    req.on('end', () => {
      assert.equal(req.headers.authorization, undefined);
      assert.equal(JSON.parse(json).voice, 'nathan');
      received++;
      res.writeHead(200, {
        'Content-Type': 'audio/pcm', 'x-lsa-sample-rate': '24000'
      });
      res.end(Buffer.from([1, 2, 3, 4]));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const router = await createConfiguredSpeechRouter({
      LSA_STANDALONE_TTS_PROVIDER: 'faster-qwen3-tts',
      LSA_STANDALONE_TTS_VOICE: 'nathan',
      LSA_STANDALONE_QWEN_VOICES: 'nathan',
      LSA_STANDALONE_QWEN_URL: 'http://127.0.0.1:' +
        server.address().port + '/v1'
    });
    const pcm = await collect(router.streamPcm({
      text: 'Hello, friend', identity: offer()
    }));
    assert.equal(received, 1);
    assert.equal(pcm.length, 4);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('OpenAI provider accepts an exact per-NPC voice override', async () => {
  let submitted;
  const openai = createSpeechPcmProvider({
    apiKey: 'test-key', model: 'gpt-4o-mini-tts', voice: 'onyx',
    fetchImpl: async (_url, init) => {
      submitted = JSON.parse(init.body);
      return { ok: true, body: new ReadableStream({
        start(c) { c.enqueue(Uint8Array.of(9, 8)); c.close(); }
      }) };
    }
  });
  await collect(openai.streamPcm({
    text: 'Hello.', voice: 'ash', instructions: 'Quietly.'
  }));
  assert.equal(submitted.voice, 'ash');
  assert.equal(submitted.instructions, 'Quietly.');
});
