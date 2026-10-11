import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { createProviderStack } from '../src/providers/providerStack.mjs';

const identity = { pedId: '17', turnId: 'turn-2', generationId: 3, sessionNonce: 9 };
const pcm = new Uint8Array([1, 0, 2, 0]);
const input = { identity, pcm, sampleRate: 16000 };

function localConfig(stt = {}, env = { OPENAI_API_KEY: 'test-key' }) {
  return normalizeConfig({ transcriptionProvider: 'parakeet-ultra', parakeetStt: stt }, env);
}

test('STT is opt-in, loopback-only, and independent of Qwen speech output', () => {
  assert.equal(normalizeConfig({}, {}).transcriptionProvider, 'openai');
  assert.equal(localConfig().parakeetStt.fallback, 'openai');
  assert.equal(localConfig().parakeetStt.timeoutMs, 2000);
  assert.equal(normalizeConfig({
    transcriptionProvider: 'parakeet-ultra', speechProvider: 'faster-qwen3-tts',
  }, {}).speechProvider, 'faster-qwen3-tts');
  assert.throws(() => localConfig({ baseUrl: 'https://example.com/v1' }), /loopback/);
  assert.throws(() => localConfig({ baseUrl: 'http://192.168.1.1:8001/v1' }), /loopback/);
  assert.throws(() => localConfig({ fallback: 'always' }), /fallback/);
  assert.throws(() => localConfig({ timeoutMs: 0 }), /timeoutMs/);
  assert.throws(() => localConfig({ secret: 'oops' }), /unknown/);
  assert.throws(() => normalizeConfig({ provider: 'gemini', transcriptionProvider: 'parakeet-ultra' }, {}), /requires/);
});

test('successful local inference sends only PCM with no credentials or identity', async () => {
  const events = [];
  let hits = 0;
  const fetchImpl = async (url, opts) => {
    hits++;
    assert.equal(url, 'http://127.0.0.1:8001/v1/audio/transcriptions');
    assert.equal(opts.headers['content-type'], 'application/octet-stream');
    assert.equal(opts.headers['x-lsa-sample-rate'], '16000');
    assert.equal(opts.headers.authorization, undefined);
    assert.deepEqual([...opts.body], [...pcm]);
    return Response.json({ text: 'Hey Nathan.' });
  };
  const stack = createProviderStack(localConfig(), { fetchImpl });
  assert.equal(stack.transcription.id, 'parakeet.transcription');
  assert.equal(await stack.transcribe({
    ...input, telemetry: { event: (name, data) => events.push([name, data]), startSpan: () => () => {} },
  }), 'Hey Nathan.');
  assert.equal(hits, 1);
  assert.equal(events.some(([name, info]) => name === 'stt_route' && info.provider === 'parakeet-ultra'), true);
  assert.equal(events.some(([name, info]) => name === 'stt_local_result' && info.outcome === 'success'), true);
});

test('503 triggers OpenAI exactly once with OpenAI credentials only on cloud route', async () => {
  const hits = [];
  const events = [];
  const fetchImpl = async (url, opts) => {
    hits.push(url);
    if (url.startsWith('http://127.0.0.1')) {
      assert.equal(opts.headers.authorization, undefined);
      return Response.json({ error: 'busy' }, { status: 503 });
    }
    assert.equal(url, 'https://api.openai.com/v1/audio/transcriptions');
    assert.equal(opts.headers.authorization, 'Bearer test-key');
    assert.equal(opts.body.get('model'), 'gpt-transcribe');
    return Response.json({ text: 'Hello from OpenAI' });
  };
  const stack = createProviderStack(localConfig(), { fetchImpl });
  const text = await stack.transcribe({
    ...input, telemetry: { event: (name, info) => events.push([name, info]) },
  });
  assert.equal(text, 'Hello from OpenAI');
  assert.equal(hits.length, 2);
  assert.equal(events.some(([name, info]) => name === 'stt_fallback' && info.reason === 'local_stt_unavailable'), true);
});

test('OpenAI-only mode bypasses local service entirely', async () => {
  const config = normalizeConfig({}, { OPENAI_API_KEY: 'test-key' });
  const urls = [];
  const stack = createProviderStack(config, { fetchImpl: async url => {
    urls.push(url);
    return Response.json({ text: 'cloud' });
  } });
  assert.equal(await stack.transcribe(input), 'cloud');
  assert.deepEqual(urls, ['https://api.openai.com/v1/audio/transcriptions']);
});

test('fallback off rejects local outage without contacting OpenAI', async () => {
  let hits = 0;
  const stack = createProviderStack(localConfig({ fallback: 'off' }), {
    fetchImpl: async () => { hits++; return Response.json({}, { status: 503 }); },
  });
  await assert.rejects(stack.transcribe(input), error => error.code === 'local_stt_unavailable');
  assert.equal(hits, 1);
});

test('bad local request, invalid PCM and cancellation never invoke OpenAI', async () => {
  let hits = 0;
  const stack = createProviderStack(localConfig(), {
    fetchImpl: async () => { hits++; return Response.json({}, { status: 400 }); },
  });
  await assert.rejects(stack.transcribe(input), error => error.code === 'local_stt_bad_request');
  await assert.rejects(stack.transcribe({ ...input, pcm: new Uint8Array([1]) }), /PCM16/);
  assert.equal(hits, 1);

  const controller = new AbortController();
  const pending = createProviderStack(localConfig(), {
    fetchImpl: async (_url, opts) => {
      hits++;
      controller.abort();
      return new Promise((_, reject) => {
        if (opts.signal.aborted) reject(new Error('aborted'));
        else opts.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  });
  await assert.rejects(pending.transcribe({ ...input, signal: controller.signal }), error => error.code === 'cancelled');
  assert.equal(hits, 2);
});

test('empty local output falls back to OpenAI without semantic guessing', async () => {
  let hits = 0;
  const stack = createProviderStack(localConfig(), { fetchImpl: async url => {
    hits++;
    return Response.json({ text: url.startsWith('http://') ? '' : 'Recognized on cloud' });
  } });
  assert.equal(await stack.transcribe(input), 'Recognized on cloud');
  assert.equal(hits, 2);
});

test('local timeout falls back without forwarding its abort to OpenAI', async () => {
  let hits = 0;
  const stack = createProviderStack(localConfig({ timeoutMs: 200 }), {
    fetchImpl: async (url, opts) => {
      hits++;
      if (url.startsWith('https://')) {
        assert.equal(opts.signal.aborted, false);
        return Response.json({ text: 'Cloud recognized it' });
      }
      return new Promise((_, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('local aborted')), { once: true });
      });
    },
  });
  assert.equal(await stack.transcribe(input), 'Cloud recognized it');
  assert.equal(hits, 2);
});
