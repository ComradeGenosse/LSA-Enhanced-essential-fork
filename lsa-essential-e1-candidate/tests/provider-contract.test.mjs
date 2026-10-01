import test from 'node:test';
import assert from 'node:assert/strict';
import { createProviderStack } from '../src/providers/providerStack.mjs';
import { assertProvider } from '../src/providers/providerContract.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';

const identity = { pedId: '17', turnId: 'turn-1', generationId: 2, sessionNonce: 9 };

test('OpenAI provider stack exposes three independent single-request contracts', async () => {
  const received = [];
  const providers = {
    reasoning: { id: 'test.reasoning', capabilities: { cancellation: true, strictDecisionParsing: true }, async decide(input) { received.push(['reasoning', input]); return { dialogue: 'Hi.', command: '' }; } },
    transcription: { id: 'test.transcription', capabilities: { cancellation: true, pcm16MonoInput: true }, async transcribe(input) { received.push(['transcription', input]); return 'Hello'; } },
    speech: { id: 'test.speech', capabilities: { cancellation: true, awaitedPcmCallback: true, outputFormat: 'pcm_s16le_mono_24000' }, async synthesize(input) { received.push(['speech', input]); return { bytes: 2, chunks: 1, sampleRate: 24_000, channels: 1 }; } },
  };
  const stack = createProviderStack(normalizeConfig({}, {}), { providers, fetchImpl: () => { throw Error('not used'); } });
  assert.equal(stack.reasoning.id, 'test.reasoning');
  assert.equal(stack.transcription.id, 'test.transcription');
  assert.equal(stack.speech.id, 'test.speech');
  assert.deepEqual(await stack.decide({ identity, signal: new AbortController().signal }), { dialogue: 'Hi.', command: '' });
  assert.equal(await stack.transcribe({ identity, pcm: new Uint8Array([1, 2]), sampleRate: 16_000 }), 'Hello');
  assert.equal((await stack.speak({ identity, dialogue: 'Hi.' })).sampleRate, 24_000);
  assert.deepEqual(received.map(([operation, input]) => [operation, input.identity]), [['reasoning', identity], ['transcription', identity], ['speech', identity]]);
  assert.equal(Object.isFrozen(stack), true);
});

test('provider contracts reject missing operations and capabilities', () => {
  assert.throws(() => assertProvider({ id: 'Bad Provider', capabilities: {}, decide() {} }, { operation: 'decide' }), /identifier/);
  assert.throws(() => assertProvider({ id: 'test.provider', capabilities: {}, decide() {} }, { operation: 'decide', requiredCapabilities: ['cancellation'] }), /lacks cancellation/);
  assert.throws(() => createProviderStack(normalizeConfig({ provider: 'gemini' }, {})), /only serves the OpenAI route/);
});

test('OpenAI wrappers reuse existing request implementations and preserve exact decision and text contracts', async () => {
  const config = normalizeConfig({}, { OPENAI_API_KEY: 'test-key' });
  const receivedBodies = [];
  const fetchImpl = async (_url, request) => {
    const body = request.body instanceof FormData ? request.body.get('model') : JSON.parse(request.body);
    receivedBodies.push(body);
    if (request.body instanceof FormData) return Response.json({ text: 'recognized speech' });
    if (typeof body === 'object' && typeof body.input === 'string') return new Response(new Uint8Array([1, 2]), { status: 200 });
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"dialogue":"Hello.","command":""}' }] }] });
  };
  const stack = createProviderStack(config, { fetchImpl });
  const signal = new AbortController().signal;
  assert.deepEqual(await stack.decide({ identity, context: {}, input: 'question', history: [], source: 'player_text', signal }), { dialogue: 'Hello.', command: '' });
  assert.equal(await stack.transcribe({ identity, pcm: new Uint8Array([1, 2]), sampleRate: 16_000, signal }), 'recognized speech');
  const result = await stack.speak({ identity, dialogue: 'Exact words.', signal, onPcm: async () => {} });
  assert.equal(result.bytes, 2);
  assert.equal(receivedBodies[1], 'gpt-transcribe');
  assert.equal(receivedBodies[2].input, 'Exact words.');
});
