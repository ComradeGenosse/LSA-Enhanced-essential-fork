import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { createRuntime } from '../src/integration/essentialGlue.mjs';
import { OpenAITransport } from '../src/openai/openaiTransport.mjs';

function readyBridge(onEvent = async () => {}) {
  const listeners = new Set();
  return {
    assertCapabilities: () => true,
    isCurrent: () => true,
    validateDecision: decision => ({ identityValid: true, internalTranscript: decision.command ? `${decision.command}|${decision.dialogue}` : decision.dialogue }),
    failMatchingTurn: () => true,
    routePinnedEvent: event => onEvent(event),
    authorize(identity) { for (const listener of listeners) listener({ ...identity, type: 'audio_turn_accepted' }); return true; },
    onNativeEvent(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    complete(identity) {
      for (const listener of listeners) listener({ ...identity, type: 'playback_ended', reason: 'completed', wasInterrupted: false, hadAudio: true, playbackStarted: true });
    },
  };
}

function fakeProviderFetch() {
  const requests = [];
  return {
    requests,
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/responses')) return new Response(JSON.stringify({
        status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '{"dialogue":"I am fine.","command":""}' }] }],
      }), { status: 200 });
      if (url.endsWith('/audio/speech')) return new Response(Uint8Array.from([0, 0, 1, 0]), { status: 200 });
      throw new Error('Unexpected fake endpoint.');
    },
  };
}

test('typed OpenAI turn is pinned, sequential, and awaits matching protocol playback', async () => {
  const fake = fakeProviderFetch();
  const config = normalizeConfig({}, { OPENAI_API_KEY: 'test-key' });
  const runtime = createRuntime(config, { fetchImpl: fake.fetch });
  const events = [];
  const bridge = readyBridge(event => { events.push(event); if (event.type === 'turn_complete') queueMicrotask(() => bridge.complete(event)); return true; });
  runtime.attachBridge(bridge);
  const identity = { pedId: '17', turnId: 'turn-1', generationId: 3, sessionNonce: 1 };
  const transport = new OpenAITransport(runtime);
  const connection = await transport.connect({
    systemInstruction: 'Stock Essential system prompt',
    diagnosticContext: { pedId: identity.pedId, sessionNonce: identity.sessionNonce },
    onEvent: async event => {
      events.push(event);
      assert.deepEqual({ pedId: event.pedId, turnId: event.turnId, generationId: event.generationId, sessionNonce: event.sessionNonce }, identity);
      if (event.type === 'turn_complete') queueMicrotask(() => bridge.complete(identity));
    },
  });
  await connection.beginTurn({ identity, source: 'player_text', context: {
    systemInstruction: 'Stock Essential system prompt', actor: { pedId: '17', roleName: 'Civilian' },
    listener: { pedId: 'player' }, contextText: 'Street: Grove Street', inputText: 'Are you okay?',
  } });
  await connection.sendText('unused wrapper text');
  const settled = await connection.whenSettled(identity);
  assert.equal(settled.status, 'completed', JSON.stringify(settled));
  assert.deepEqual(fake.requests.map(request => request.url), [
    'https://api.openai.com/v1/responses', 'https://api.openai.com/v1/audio/speech',
  ]);
  assert.deepEqual(events.map(event => event.type), ['output_transcript', 'audio', 'generation_complete', 'turn_complete']);
  assert.equal(events[0].text, 'I am fine.');
  assert.equal(runtime.history.readForSession(identity.pedId, identity.sessionNonce).length, 2);
  connection.close();
});

test('PTT audio is bounded and cannot silently send a truncated prefix', async () => {
  const config = normalizeConfig({ maxMicDurationMs: 1000 }, {});
  const runtime = createRuntime(config);
  const connection = await new OpenAITransport(runtime).connect({ systemInstruction: 'stock', diagnosticContext: { pedId: '17', sessionNonce: 1 }, onEvent: async () => {} });
  const identity = { pedId: '17', turnId: 'turn-mic', generationId: 4, sessionNonce: 1 };
  await connection.beginTurn({ identity, source: 'player_mic', context: { inputText: '', systemInstruction: 'stock' } });
  await connection.startRealtimeInput();
  assert.throws(() => connection.sendRealtimeAudio(new Uint8Array(config.maxMicPcmBytes + 2), 16_000), /exceeded/);
  assert.throws(() => connection.endRealtimeInput(), /no truncated audio/);
  connection.close();
});

test('cancellation aborts the active provider request and stale turn events are rejected', async () => {
  const config = normalizeConfig({}, { OPENAI_API_KEY: 'test-key' });
  let providerSignal;
  const runtime = createRuntime(config, { fetchImpl: async (_url, init) => {
    providerSignal = init.signal;
    return await new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  } });
  const bridge = readyBridge();
  runtime.attachBridge(bridge);
  const events = [];
  const connection = await new OpenAITransport(runtime).connect({
    systemInstruction: 'Stock Essential system prompt',
    diagnosticContext: { pedId: '17', sessionNonce: 1 },
    onEvent: async event => { events.push(event); },
  });
  const identity = { pedId: '17', turnId: 'turn-cancel', generationId: 7, sessionNonce: 1 };
  await connection.beginTurn({ identity, source: 'player_text', context: { systemInstruction: 'stock', inputText: 'Hello.' } });
  await connection.sendText('Hello.');
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(providerSignal);
  assert.equal(connection.abortTurn(identity, 'native_interrupt'), true);
  const cancelled = await connection.whenSettled(identity);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.terminalReason, 'cancelled');
  assert.equal(providerSignal.aborted, true);
  assert.deepEqual(events, []);
  await connection.beginTurn({ identity: { ...identity, turnId: 'turn-next', generationId: 8 }, source: 'player_text', context: { systemInstruction: 'stock' } });
  assert.equal(await connection.emitProviderEvent({ ...identity, provider: 'openai', type: 'audio', chunk: new Uint8Array([0, 0]) }), false);
  connection.close();
});
