import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { directory } from './identity-fixtures.mjs';
import { SAMPLES, orderedProviders, percentile, summarize, parseArgs,
  runTtsOnly, runConversations, renderReport } from '../tools/qwen/compare_tts_benchmark.mjs';

const voices = { openaiVoice: 'ash', qwenVoice: 'nathan' };
const rawConfig = { qwenTts: { baseUrl: 'http://127.0.0.1:8000/v1', speechVoices: ['nathan'] },
  retry: { enabled: false, maxAttempts: 1 }, providerWorkDeadlineMs: 15000 };
const env = { OPENAI_API_KEY: 'mock-key-must-never-be-sent-to-qwen' };
const pcm = Uint8Array.from([4, 0, 9, 0, 12, 0, 7, 0]);
function frame(event) {
  return 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n';
}
function streamingLunaResponse() {
  const text = JSON.stringify({ mode: 'dialogue_only', segments: [
    { text: 'I heard you.' }, { text: 'Everything looks fine.' } ], command: '' });
  const item = { id: 'msg_bench', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text }] };
  const frames = [
    { type: 'response.created', response: { id: 'resp_bench', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { id: item.id, type: 'message', role: 'assistant', content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: item.id, delta: text },
    { type: 'response.completed', response: { id: 'resp_bench', status: 'completed', output: [item] } },
  ];
  return new Response(frames.map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } });
}
function mockNetwork(requests) {
  return async (url, init) => {
    const payload = JSON.parse(init.body);
    requests.push({ url: String(url), input: payload.input, stream: payload.stream, voice: payload.voice,
      hasAuthorization: Boolean(init.headers?.authorization) });
    if (String(url).endsWith('/responses')) {
      if (payload.stream) return streamingLunaResponse();
      return Response.json({ status: 'completed', output: [{
        type: 'message', content: [{ type: 'output_text',
          text: JSON.stringify({ dialogue: 'Yes, I heard you.', command: '' }) }],
      }] });
    }
    if (String(url).endsWith('/audio/speech')) {
      return new Response(pcm, { status: 200, headers: { 'x-lsa-sample-rate': '24000' } });
    }
    throw new Error('Unexpected test request');
  };
}

test('ten samples alternate fair provider order and percentiles are deterministic', () => {
  assert.equal(SAMPLES.length, 10);
  assert.deepEqual(orderedProviders(0), ['openai', 'qwen']);
  assert.deepEqual(orderedProviders(1), ['qwen', 'openai']);
  assert.equal(percentile([10, 30, 20], 50), 20);
  assert.equal(percentile([10, 30], 90), 28);
  assert.equal(percentile([], 50), null);
  assert.throws(() => percentile([1], -1), /percentile/);
  assert.throws(() => parseArgs(['--mode','oops']), /Invalid --mode/);
  assert.equal(parseArgs([]).allowBilling, false);
  assert.equal(parseArgs(['--mode','both','--allow-billing']).mode, 'both');
});

test('ten real-adapter TTS pairs preserve identical text, validate PCM and do not forward key to Qwen', async t => {
  const requests = [];
  const rows = await runTtsOnly({ rawConfig, env, voices,
    outputDir: await directory(t), fetchImpl: mockNetwork(requests) });
  assert.equal(rows.length, 20);
  assert.ok(rows.every(r => r.status === 'completed' && r.pcm_bytes === pcm.length && r.wav.endsWith('.wav')));
  assert.deepEqual(rows.slice(0, 4).map(r => r.provider), ['openai','qwen','qwen','openai']);
  for (const sample of SAMPLES) {
    const pair = requests.filter(r => r.input === sample.dialogue);
    assert.equal(pair.length, 2);
    assert.equal(pair.filter(r => r.hasAuthorization).length, 1);
    assert.equal(pair.find(r => !r.hasAuthorization).voice, 'nathan');
  }
  assert.equal(summarize(rows, 'tts').pairedSamples, 10);
  assert.equal(renderReport(rows, {mode:'tts',head:'fixture'}).includes('ten identical text fixtures'), true);
});

test('real patched controller compares early streaming OpenAI and buffered Qwen with mocked network', { timeout: 60000 }, async t => {
  const requests = [];
  const rows = await runConversations({ rawConfig, env, voices,
    outputDir: await directory(t), fetchImpl: mockNetwork(requests) });
  assert.equal(rows.length, 20, JSON.stringify(rows.filter(r => r.status !== 'completed')));
  assert.ok(rows.every(r => r.status === 'completed'),
    JSON.stringify(rows.filter(r => r.status !== 'completed')));
  assert.ok(rows.every(r => r.first_pcm_ms !== null && r.simulated_native_playback === true));
  assert.ok(rows.every(r => r.model_stream_end_ms !== null && r.tts_requests >= 1));
  const modelCalls = requests.filter(r => r.url.endsWith('/responses'));
  assert.equal(modelCalls.length, 20);
  assert.equal(modelCalls.filter(r => r.stream === true).length, 10);
  assert.equal(rows.filter(r => r.model_mode === 'structured_early_streaming').length, 10);
  const localTts = requests.filter(r => r.url.startsWith('http://127.0.0.1:8000'));
  assert.equal(localTts.length, 10);
  assert.ok(localTts.every(r => !r.hasAuthorization));
  assert.equal(summarize(rows, 'conversation').pairedSamples, 10);
});
