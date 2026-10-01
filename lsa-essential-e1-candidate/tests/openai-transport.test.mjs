import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { createRuntime } from '../src/integration/essentialGlue.mjs';
import { OpenAITransport } from '../src/openai/openaiTransport.mjs';
import { Telemetry, createNoopTelemetry } from '../src/observability/telemetry.mjs';

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

test('microphone structured turns complete with real and disabled logging, with early TTS on and off', async t => {
  for (const earlyTtsEnabled of [true, false]) {
    for (const loggingEnabled of [true, false]) {
      await t.test(`earlyTts=${earlyTtsEnabled}, logging=${loggingEnabled}`, async t => {
        const records = [];
        const telemetry = loggingEnabled ? new Telemetry({ sink: { emit(record) { records.push(record); return true; } } }) : createNoopTelemetry();
        const config = normalizeConfig({ structuredStreamingEnabled: true, earlyTtsEnabled, retry: { enabled: false, maxAttempts: 1 } }, { OPENAI_API_KEY: 'test-key' });
        const requests = [];
        const full = JSON.stringify({ mode: 'dialogue_only', segments: [{ text: 'First reply.' }, { text: 'Second reply.' }], command: '' });
        const message = { id: 'msg_mic', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: full, annotations: [] }] };
        const frame = event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
        const runtime = createRuntime(config, { telemetry, fetchImpl: async url => {
          requests.push(url);
          if (url.endsWith('/audio/transcriptions')) return Response.json({ text: 'Private microphone input.' });
          if (url.endsWith('/audio/speech')) return new Response(Uint8Array.from([1, 0]), { status: 200 });
          assert.ok(url.endsWith('/responses'));
          const events = [
            { type: 'response.created', response: { id: 'resp_mic', status: 'in_progress' } },
            { type: 'response.output_item.added', output_index: 0, item: { id: message.id, type: 'message', role: 'assistant', content: [] } },
            { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: message.id, delta: full },
            { type: 'response.completed', response: { id: 'resp_mic', status: 'completed', output: [message] } },
          ];
          return new Response(events.map(frame).join(''), { headers: { 'content-type': 'text/event-stream' } });
        } });
        const events = [];
        const bridge = readyBridge(event => { events.push(event); if (event.type === 'turn_complete') queueMicrotask(() => bridge.complete(event)); return true; });
        runtime.attachBridge(bridge);
        const identity = { pedId: '17', turnId: 'mic-telemetry', generationId: 1, sessionNonce: 1 };
        const connection = await new OpenAITransport(runtime).connect({ diagnosticContext: identity, systemInstruction: 'stock' });
        t.after(() => connection.close());
        await connection.beginTurn({ identity, source: 'player_mic', context: { systemInstruction: 'stock' } });
        await connection.startRealtimeInput();
        await connection.sendRealtimeAudio(new Uint8Array(32_000), 16_000);
        await connection.endRealtimeInput();
        assert.equal((await connection.whenSettled(identity)).status, 'completed');
        assert.equal(requests.filter(url => url.endsWith('/audio/transcriptions')).length, 1);
        assert.equal(requests.filter(url => url.endsWith('/audio/speech')).length, earlyTtsEnabled ? 2 : 1);
        assert.equal(events.filter(event => event.type === 'turn_complete').length, 1);
        assert.ok(events.some(event => event.type === 'audio'));
        assert.deepEqual(runtime.history.readForSession('17', 1), [
          { role: 'user', content: 'Private microphone input.' },
          { role: 'assistant', content: 'First reply. Second reply.' },
        ]);
        if (loggingEnabled) {
          assert.equal(records.filter(record => record.event === 'turn_terminal_summary').length, 1);
          assert.equal(records.find(record => record.event === 'turn_terminal_summary').data.terminalReason, 'completed');
          assert.equal(JSON.stringify(records).includes('Private microphone input.'), false);
        }
      });
    }
  }
});

test('early segmented TTS overlaps one structured response and closes one Essential stream', async () => {
  const config = normalizeConfig({ structuredStreamingEnabled: true, earlyTtsEnabled: true, retry: { enabled: false, maxAttempts: 1 } }, { OPENAI_API_KEY: 'test-key' });
  let releaseModel;
  let signalTtsStarted;
  const ttsStarted = new Promise(resolve => { signalTtsStarted = resolve; });
  const full = JSON.stringify({ mode: 'dialogue_only', segments: [{ text: 'I saw him.' }, { text: 'He went east.' }], command: '' });
  const firstEnd = full.indexOf('},{') + 1;
  const eventFrame = event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  const resultMessage = { id: 'msg_stream', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: full, annotations: [] }] };
  let ttsRequests = 0;
  const fakeFetch = async (url, init) => {
    if (url.endsWith('/audio/speech')) {
      ttsRequests += 1;
      if (ttsRequests === 1) signalTtsStarted();
      return new Response(Uint8Array.from([0, 0, 1, 0]), { status: 200 });
    }
    assert.ok(url.endsWith('/responses'));
    const sent = JSON.parse(init.body);
    assert.equal(sent.stream, true);
    assert.equal(sent.text.format.strict, true);
    return new Response(new ReadableStream({ start(controller) {
      const send = event => controller.enqueue(new TextEncoder().encode(eventFrame(event)));
      send({ type: 'response.created', response: { id: 'resp_stream', status: 'in_progress' } });
      send({ type: 'response.output_item.added', output_index: 0, item: { id: 'msg_stream', type: 'message', role: 'assistant', content: [] } });
      send({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_stream', delta: full.slice(0, firstEnd) });
      releaseModel = () => {
        send({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_stream', delta: full.slice(firstEnd) });
        send({ type: 'response.completed', response: { id: 'resp_stream', status: 'completed', output: [resultMessage] } });
        controller.close();
      };
    } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const runtime = createRuntime(config, { fetchImpl: fakeFetch });
  const events = [];
  const bridge = readyBridge(event => { events.push(event); if (event.type === 'turn_complete') queueMicrotask(() => bridge.complete(event)); return true; });
  runtime.attachBridge(bridge);
  const identity = { pedId: 'p17', turnId: 'stream-turn', generationId: 8, sessionNonce: 2 };
  const connection = await new OpenAITransport(runtime).connect({
    systemInstruction: 'Use short safe dialogue.', diagnosticContext: { pedId: identity.pedId, sessionNonce: identity.sessionNonce },
    onEvent: async event => { events.push(event); if (event.type === 'turn_complete') queueMicrotask(() => bridge.complete(event)); },
  });
  await connection.beginTurn({ identity, source: 'player_text', context: { systemInstruction: 'Use short safe dialogue.', inputText: 'What happened?' } });
  await connection.sendText('What happened?');
  await ttsStarted;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.ok(events.some(event => event.type === 'audio'), 'first PCM is forwarded before the model terminal event');
  assert.equal(events.some(event => event.type === 'output_transcript'), false, 'the final transcript stays behind the decision barrier');
  releaseModel();
  const settled = await connection.whenSettled(identity);
  assert.equal(settled.status, 'completed', JSON.stringify(settled));
  assert.equal(ttsRequests, 2, 'one serial synthesis request per segment');
  assert.equal(events.filter(event => event.type === 'output_transcript').length, 1);
  assert.equal(events.filter(event => event.type === 'generation_complete').length, 1);
  assert.equal(events.filter(event => event.type === 'turn_complete').length, 1);
  assert.equal(events.find(event => event.type === 'output_transcript').text, 'I saw him. He went east.');
  connection.close();
});

test('early speech failures cancel active readers and never hand off a successful turn with real logging', { timeout: 5000 }, async t => {
  for (const failure of ['late_model_refusal', 'partial_pcm16_sample']) {
    await t.test(failure, async t => {
      const config = normalizeConfig({ structuredStreamingEnabled: true, earlyTtsEnabled: true, retry: { enabled: false, maxAttempts: 1 } }, { OPENAI_API_KEY: 'test-key' });
      const records = [];
      const telemetry = new Telemetry({ sink: { emit(record) { records.push(record); return true; } } });
      const full = JSON.stringify({ mode: 'dialogue_only', segments: [{ text: 'Safe phrase.' }], command: '' });
      const message = { id: 'msg_failure', type: 'message', role: 'assistant', content: [] };
      const frame = event => new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      let modelController;
      let ttsCancelled = false;
      const events = [];
      let firstAudio;
      const gotAudio = new Promise(resolve => { firstAudio = resolve; });
      const runtime = createRuntime(config, { telemetry, fetchImpl: async url => {
        if (url.endsWith('/audio/speech')) {
          if (failure === 'partial_pcm16_sample') return new Response(Uint8Array.from([0, 0, 1]));
          return new Response(new ReadableStream({
            start(controller) { controller.enqueue(Uint8Array.from([0, 0])); },
            cancel() { ttsCancelled = true; },
          }));
        }
        return new Response(new ReadableStream({ start(controller) {
          modelController = controller;
          for (const event of [
            { type: 'response.created', response: { id: 'resp_failure', status: 'in_progress' } },
            { type: 'response.output_item.added', output_index: 0, item: message },
            { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: message.id, delta: full },
          ]) controller.enqueue(frame(event));
          if (failure === 'partial_pcm16_sample') {
            controller.enqueue(frame({ type: 'response.completed', response: { id: 'resp_failure', status: 'completed', output: [{ ...message, status: 'completed', content: [{ type: 'output_text', text: full }] }] } }));
            controller.close();
          }
        } }), { headers: { 'content-type': 'text/event-stream' } });
      } });
      const bridge = readyBridge(event => { events.push(event); if (event.type === 'audio') firstAudio(); if (event.type === 'turn_complete') queueMicrotask(() => bridge.complete(event)); return true; });
      let nativeFailures = 0;
      bridge.failMatchingTurn = () => { nativeFailures++; return true; };
      runtime.attachBridge(bridge);
      const identity = { pedId: '17', turnId: failure, generationId: 1, sessionNonce: 1 };
      const connection = await new OpenAITransport(runtime).connect({ diagnosticContext: identity, systemInstruction: 'stock' });
      t.after(() => connection.close());
      await connection.beginTurn({ identity, source: 'player_text', context: { inputText: 'Hello.' } });
      await connection.sendText('Hello.');
      const done = connection.whenSettled(identity);
      if (failure === 'late_model_refusal') {
        const first = await Promise.race([gotAudio.then(() => 'audio'), done.then(() => 'failed')]);
        assert.equal(first, 'audio', 'the refusal arrives while TTS is still streaming');
        modelController.enqueue(frame({ type: 'response.refusal.delta', delta: 'Private refusal.' }));
        modelController.close();
      }
      const result = await done;
      assert.equal(result.terminalReason, failure === 'late_model_refusal' ? 'model_refusal' : 'tts_error');
      assert.equal(result.cause.code, failure === 'late_model_refusal' ? 'model_refusal' : 'partial_pcm16_sample');
      if (failure === 'late_model_refusal') assert.equal(ttsCancelled, true, 'model failure must cancel the pending TTS body read');
      assert.equal(nativeFailures, 1);
      assert.equal(events.filter(event => event.type === 'audio').length, 1);
      assert.equal(events.some(event => event.type === 'generation_complete' || event.type === 'turn_complete'), false);
      assert.equal(runtime.history.readForSession('17', 1).filter(item => item.role === 'assistant').length, 0);
      assert.equal(records.filter(record => record.event === 'turn_terminal_summary').length, 1);
      assert.equal(JSON.stringify(records).includes('Private refusal.'), false);
    });
  }
});

test('a command contradicting an already released dialogue-only stream fails the exact turn without dispatch', async () => {
  const config = normalizeConfig({ structuredStreamingEnabled: true, earlyTtsEnabled: true, retry: { enabled: false, maxAttempts: 1 } }, { OPENAI_API_KEY: 'test-key' });
  let releaseModel;
  let signalTtsStarted;
  const ttsStarted = new Promise(resolve => { signalTtsStarted = resolve; });
  const full = JSON.stringify({ mode: 'dialogue_only', segments: [{ text: 'I saw him.' }], command: 'DO WaitHere' });
  const firstEnd = full.indexOf('}],') + 2;
  const eventFrame = event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  const resultMessage = { id: 'msg_contra', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: full, annotations: [] }] };
  const runtime = createRuntime(config, { fetchImpl: async (url, init) => {
    if (url.endsWith('/audio/speech')) {
      signalTtsStarted();
      return new Response(Uint8Array.from([0, 0]), { status: 200 });
    }
    return new Response(new ReadableStream({ start(controller) {
      const send = event => controller.enqueue(new TextEncoder().encode(eventFrame(event)));
      send({ type: 'response.created', response: { id: 'resp_contra', status: 'in_progress' } });
      send({ type: 'response.output_item.added', output_index: 0, item: { id: 'msg_contra', type: 'message', role: 'assistant', content: [] } });
      send({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_contra', delta: full.slice(0, firstEnd) });
      releaseModel = () => {
        send({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_contra', delta: full.slice(firstEnd) });
        send({ type: 'response.completed', response: { id: 'resp_contra', status: 'completed', output: [resultMessage] } });
        controller.close();
      };
    } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  } });
  let failureCalls = 0;
  let completionCalls = 0;
  const events = [];
  const bridge = readyBridge(event => { events.push(event); if (event.type === 'turn_complete') queueMicrotask(() => bridge.complete(event)); return true; });
  bridge.failMatchingTurn = () => { failureCalls += 1; return true; };
  runtime.attachBridge(bridge);
  const identity = { pedId: 'p17', turnId: 'stream-conflict', generationId: 9, sessionNonce: 2 };
  const connection = await new OpenAITransport(runtime).connect({
    systemInstruction: 'Use safe dialogue.', diagnosticContext: { pedId: identity.pedId, sessionNonce: identity.sessionNonce },
    onEvent: async event => { events.push(event); if (event.type === 'turn_complete') { completionCalls += 1; queueMicrotask(() => bridge.complete(event)); } },
  });
  await connection.beginTurn({ identity, source: 'player_text', context: { systemInstruction: 'Use safe dialogue.', inputText: 'What happened?' } });
  await connection.sendText('What happened?');
  await ttsStarted;
  releaseModel();
  const settled = await connection.whenSettled(identity);
  assert.notEqual(settled.status, 'completed');
  assert.equal(failureCalls, 1);
  assert.equal(completionCalls, 0);
  assert.equal(events.some(event => event.type === 'output_transcript'), false);
  assert.equal(events.some(event => event.type === 'generation_complete' || event.type === 'turn_complete'), false);
  connection.close();
});

test('cancellation during an early segment stops model/TTS readers and sends no final handoff', { timeout: 5000 }, async () => {
  const config = normalizeConfig({ structuredStreamingEnabled: true, earlyTtsEnabled: true, retry: { enabled: false, maxAttempts: 1 } }, { OPENAI_API_KEY: 'test-key' });
  const full = JSON.stringify({ mode: 'dialogue_only', segments: [{ text: 'Wait here.' }, { text: 'I am checking.' }], command: '' });
  const split = full.indexOf('},{') + 1;
  const frame = event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  let modelCancelled = false;
  let ttsCancelled = false;
  let ttsRequested = false;
  let firstAudio;
  const gotAudio = new Promise(resolve => { firstAudio = resolve; });
  const events = [];
  let authorizations = 0;
  const runtime = createRuntime(config, { fetchImpl: async url => {
    if (url.endsWith('/audio/speech')) { ttsRequested = true; return new Response(new ReadableStream({
      start(controller) { controller.enqueue(Uint8Array.from([0, 0])); },
      cancel() { ttsCancelled = true; },
    }), { status: 200 }); }
    const textItem = { id: 'msg_cancel', type: 'message', role: 'assistant', content: [] };
    return new Response(new ReadableStream({
      start(controller) {
        for (const event of [
          { type: 'response.created', response: { id: 'resp_cancel', status: 'in_progress' } },
          { type: 'response.output_item.added', output_index: 0, item: textItem },
          { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_cancel', delta: full.slice(0, split) },
        ]) controller.enqueue(new TextEncoder().encode(frame(event)));
      },
      cancel() { modelCancelled = true; },
    }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  } });
  let bridge;
  bridge = readyBridge(event => { events.push(event); if (event.type === 'audio') firstAudio(); if (event.type === 'turn_complete') queueMicrotask(() => bridge.complete(event)); return true; });
  const authorize = bridge.authorize.bind(bridge);
  bridge.authorize = identity => { authorizations += 1; return authorize(identity); };
  runtime.attachBridge(bridge);
  const identity = { pedId: 'p19', turnId: 'stream-cancel', generationId: 4, sessionNonce: 5 };
  const connection = await new OpenAITransport(runtime).connect({
    systemInstruction: 'Stream short dialogue.', diagnosticContext: { pedId: identity.pedId, sessionNonce: identity.sessionNonce },
    onEvent: async event => { events.push(event); if (event.type === 'audio') firstAudio(); if (event.type === 'turn_complete') queueMicrotask(() => bridge.complete(event)); },
  });
  await connection.beginTurn({ identity, source: 'player_text', context: { systemInstruction: 'Stream short dialogue.', inputText: 'What are you doing?' } });
  await connection.sendText('What are you doing?');
  const audioArrived = await Promise.race([gotAudio.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 1500))]);
  if (!audioArrived) { connection.close(); assert.fail(`first audio timed out; ttsRequested=${ttsRequested}; events=${events.map(event => event.type).join(',')}`); }
  assert.equal(connection.abortTurn(identity, 'native_interrupt'), true);
  const settled = await connection.whenSettled(identity);
  assert.notEqual(settled.status, 'completed');
  assert.equal(authorizations, 1);
  assert.equal(events.some(event => event.type === 'output_transcript' || event.type === 'generation_complete' || event.type === 'turn_complete'), false);
  assert.equal(modelCancelled, true);
  assert.equal(ttsCancelled, true);
  connection.close();
});

test('early segmented PCM has an aggregate byte ceiling before native authorization', async () => {
  const config = normalizeConfig({ structuredStreamingEnabled: true, earlyTtsEnabled: true, streamingMaxPcmBytes: 48_000, retry: { enabled: false, maxAttempts: 1 } }, { OPENAI_API_KEY: 'test-key' });
  const full = JSON.stringify({ mode: 'dialogue_only', segments: [{ text: 'Oversized audio.' }], command: '' });
  const frame = event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  const message = { id: 'msg_pcm_limit', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: full, annotations: [] }] };
  let authorizationCalls = 0;
  const runtime = createRuntime(config, { fetchImpl: async url => {
    if (url.endsWith('/audio/speech')) return new Response(new Uint8Array(48_002), { status: 200 });
    const events = [
      { type: 'response.created', response: { id: 'resp_pcm_limit', status: 'in_progress' } },
      { type: 'response.output_item.added', output_index: 0, item: { id: 'msg_pcm_limit', type: 'message', role: 'assistant', content: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_pcm_limit', delta: full },
      { type: 'response.completed', response: { id: 'resp_pcm_limit', status: 'completed', output: [message] } },
    ];
    return new Response(new ReadableStream({ start(controller) { for (const event of events) controller.enqueue(new TextEncoder().encode(frame(event))); controller.close(); } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  } });
  const bridge = readyBridge();
  const originalAuthorize = bridge.authorize;
  bridge.authorize = identity => { authorizationCalls += 1; return originalAuthorize(identity); };
  runtime.attachBridge(bridge);
  const identity = { pedId: 'p20', turnId: 'stream-pcm-limit', generationId: 5, sessionNonce: 6 };
  const events = [];
  const connection = await new OpenAITransport(runtime).connect({
    systemInstruction: 'Use short dialogue.', diagnosticContext: { pedId: identity.pedId, sessionNonce: identity.sessionNonce },
    onEvent: async event => { events.push(event); },
  });
  await connection.beginTurn({ identity, source: 'player_text', context: { systemInstruction: 'Use short dialogue.', inputText: 'Hello.' } });
  await connection.sendText('Hello.');
  const settled = await connection.whenSettled(identity);
  assert.notEqual(settled.status, 'completed');
  assert.equal(authorizationCalls, 0, 'oversized provider PCM is rejected before native authorization');
  assert.equal(events.some(event => event.type === 'audio' || event.type === 'generation_complete' || event.type === 'turn_complete'), false);
  connection.close();
});

test('buffered_action mode keeps TTS behind response completion even with early TTS enabled', async () => {
  const config = normalizeConfig({ structuredStreamingEnabled: true, earlyTtsEnabled: true, retry: { enabled: false, maxAttempts: 1 } }, { OPENAI_API_KEY: 'test-key' });
  const full = JSON.stringify({ mode: 'buffered_action', segments: [{ text: 'I will stay here.' }], command: 'DO WaitHere' });
  const frame = event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  const msg = { id: 'msg_action', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: full, annotations: [] }] };
  let responseCompleted = false;
  let ttsStartedAfterTerminal = false;
  const runtime = createRuntime(config, { fetchImpl: async url => {
    if (url.endsWith('/audio/speech')) {
      ttsStartedAfterTerminal = responseCompleted;
      return new Response(Uint8Array.from([0, 0]), { status: 200 });
    }
    const events = [
      { type: 'response.created', response: { id: 'resp_action', status: 'in_progress' } },
      { type: 'response.output_item.added', output_index: 0, item: { id: 'msg_action', type: 'message', role: 'assistant', content: [] } },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_action', delta: full },
      { type: 'response.completed', response: { id: 'resp_action', status: 'completed', output: [msg] } },
    ];
    return new Response(new ReadableStream({ start(controller) {
      for (const event of events) { controller.enqueue(new TextEncoder().encode(frame(event))); if (event.type === 'response.completed') responseCompleted = true; }
      controller.close();
    } }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  } });
  let bridge;
  bridge = readyBridge(event => { if (event.type === 'turn_complete') queueMicrotask(() => bridge.complete(event)); return true; });
  runtime.attachBridge(bridge);
  const identity = { pedId: 'p18', turnId: 'stream-action', generationId: 2, sessionNonce: 3 };
  const connection = await new OpenAITransport(runtime).connect({
    systemInstruction: 'Keep action turns buffered.', diagnosticContext: { pedId: identity.pedId, sessionNonce: identity.sessionNonce },
    onEvent: async event => { if (event.type === 'turn_complete') queueMicrotask(() => bridge.complete(event)); },
  });
  await connection.beginTurn({ identity, source: 'player_text', context: { systemInstruction: 'Keep action turns buffered.', inputText: 'Stay here.' } });
  await connection.sendText('Stay here.');
  const settled = await connection.whenSettled(identity);
  assert.equal(settled.status, 'completed', JSON.stringify(settled));
  assert.equal(ttsStartedAfterTerminal, true);
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
