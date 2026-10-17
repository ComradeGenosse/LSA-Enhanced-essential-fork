import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { buildRequest, segmentedDeliveryV1Schema as requestSchema } from '../src/context/essentialDecision.mjs';
import { segmentedDecisionSchema, segmentedDeliveryV1Schema as streamSchema, streamDecision } from '../src/openai/streamDecision.mjs';
import { createSegmentDecoder } from '../src/openai/segmentDecoder.mjs';
import { decideStreaming } from '../src/openai/decide.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';

const config = normalizeConfig({ structuredStreamingEnabled: true }, { OPENAI_API_KEY: 'fake-key' });
const context = { systemInstruction: 'Use only stock actions.', actor: null, listener: null, world: null };
const v1Segment = (delivery, text) => ({ delivery, text });
const wire = (segments, mode = 'dialogue_only', command = '') =>
  JSON.stringify({ mode, segments, command });
const makeRequest = (lunaDeliveryVersion = 0) => buildRequest({
  model: 'gpt-6-luna', effort: 'low', systemInstruction: 'stock',
  actor: null, listener: null, world: null, input: 'hello',
  structuredSegments: true, lunaDeliveryVersion,
});

test('EA3 strict v1 schema is opt-in, mirrored and keeps legacy strict {text}', () => {
  const legacy = makeRequest();
  const v1 = makeRequest(1);
  assert.deepEqual(requestSchema, streamSchema);
  assert.equal(legacy.text.format.name, 'e1_segmented_decision');
  assert.deepEqual(legacy.text.format.schema.properties.segments.items.required, ['text']);
  assert.deepEqual(legacy.text.format.schema, segmentedDecisionSchema);
  assert.equal(v1.text.format.name, 'e1_segmented_delivery_v1');
  assert.deepEqual(v1.text.format.schema.properties.segments.items.required, ['delivery', 'text']);
  assert.deepEqual(Object.keys(v1.text.format.schema.properties.segments.items.properties), ['delivery', 'text']);
  assert.equal(v1.text.format.schema.properties.segments.items.properties.delivery.enum.includes('neutral'), true);
  assert.equal(v1.text.format.strict, true);
  assert.equal(v1.stream, true);
  assert.match(v1.input[0].content, /Do not output bracketed audio tags/);
  assert.throws(() => makeRequest(2), /Unsupported Luna segment delivery/);
  assert.throws(() => buildRequest({
    model: 'gpt-6-luna', effort: 'low', systemInstruction: 'stock',
    actor: null, world: null, input: 'hello', lunaDeliveryVersion: 1,
  }), /require structured segments/);
});

test('EA3 decoder releases complete emotion+text early without changing canonical words', () => {
  const decoder = createSegmentDecoder({ lunaDeliveryVersion: 1 });
  const first = '{"mode":"dialogue_only","segments":[{"delivery":"amused","text":"That was wild!"},';
  decoder.append(first.slice(0, -6));
  assert.deepEqual(decoder.takeNewSegments(), []);
  decoder.append(first.slice(-6));
  assert.deepEqual(decoder.takeNewSegments(), [
    { sequence: 1, text: 'That was wild!', delivery: 'amused' },
  ]);
  assert.equal(decoder.mode, 'dialogue_only');
  decoder.append('{"delivery":"concerned","text":"Are you hurt?"}],"command":""}');
  assert.deepEqual(decoder.takeNewSegments(), [
    { sequence: 2, text: 'Are you hurt?', delivery: 'concerned' },
  ]);
  const final = decoder.finish();
  assert.deepEqual(final.segments, [
    { text: 'That was wild!', delivery: 'amused' },
    { text: 'Are you hurt?', delivery: 'concerned' },
  ]);
  assert.deepEqual(final.decision, { dialogue: 'That was wild! Are you hurt?', command: '' });
  assert.equal(Object.hasOwn(final.decision, 'delivery'), false);

  const legacy = createSegmentDecoder();
  legacy.append(wire([{ text: 'That was wild!' }]));
  assert.deepEqual(legacy.takeNewSegments(), [{ sequence: 1, text: 'That was wild!' }]);
  assert.deepEqual(legacy.finish().segments, [{ text: 'That was wild!' }]);
});

test('EA3 rejects malformed, missing, extra, reordered and injected acting intents', () => {
  const invalid = [
    wire([{ text: 'Hello.' }]),
    wire([v1Segment('unknown', 'Hello.')]),
    wire([v1Segment('[laughs]', 'Hello.')]),
    wire([{ delivery: 'amused', text: 'Hello.', intensity: '100' }]),
    wire([{ text: 'Hello.', delivery: 'amused' }]),
    '{"mode":"dialogue_only","segments":[{"delivery":"amused","delivery":"angry","text":"Hi"}],"command":""}',
    wire([v1Segment('amused', 'DO WaitHere')]),
  ];
  for (const raw of invalid) {
    const decoder = createSegmentDecoder({ lunaDeliveryVersion: 1 });
    assert.throws(() => { decoder.append(raw); decoder.finish(); }, undefined, raw);
  }
  assert.throws(() => {
    const decoder = createSegmentDecoder();
    decoder.append(wire([v1Segment('amused', 'Hi')]));
  }, /missing or extra/);
  assert.throws(() => createSegmentDecoder({ lunaDeliveryVersion: -1 }), /Unsupported/);
});

test('EA3 reflow keeps per-segment delivery across each word-boundary split', () => {
  const text = Array.from({ length: 56 }, (_, n) => 'word' + n).join(' ');
  const decoder = createSegmentDecoder({ lunaDeliveryVersion: 1, maxSegmentChars: 100 });
  decoder.append(wire([v1Segment('sarcastic', text)]));
  const early = decoder.takeNewSegments();
  const finished = decoder.finish();
  assert.ok(early.length > 1 && early.length <= 6);
  assert.ok(early.every(item => item.delivery === 'sarcastic' && item.text.length <= 100));
  assert.ok(finished.segments.every(item => item.delivery === 'sarcastic'));
  assert.equal(finished.segments.map(item => item.text).join(' '), text);
  assert.equal(finished.decision.dialogue, text);
  assert.equal(finished.reflowedSegments, early.length - 1);
});

test('EA3 action mode and stock command rules remain strict', () => {
  const action = createSegmentDecoder({ lunaDeliveryVersion: 1 });
  action.append(wire([v1Segment('neutral', 'Follow me.')], 'buffered_action', 'DO Follow P001'));
  assert.equal(action.mode, 'buffered_action');
  assert.deepEqual(action.finish().decision, { dialogue: 'Follow me.', command: 'DO Follow P001' });
  const contradictory = createSegmentDecoder({ lunaDeliveryVersion: 1 });
  contradictory.append(wire([v1Segment('neutral', 'Follow me.')], 'dialogue_only', 'DO Follow P001'));
  assert.throws(() => contradictory.finish(), /command after speech/);
  const invalid = createSegmentDecoder({ lunaDeliveryVersion: 1 });
  invalid.append(wire([v1Segment('amused', 'Fine.')], 'buffered_action', 'DO First|DO Second'));
  assert.throws(() => invalid.finish(), /one complete DO command/);
});

const frame = event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
test('EA3 decideStreaming emits validated delivery before terminal, reconciles once, and makes one Luna call', async () => {
  const text = wire([v1Segment('amused', 'Nice one.'), v1Segment('neutral', 'Come on.')]);
  const boundary = text.indexOf('},{') + 1;
  const terminalMsg = { id: 'msg_1', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text }] };
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let fetches = 0;
  let requested;
  const seen = [];
  let first;
  const firstSegment = new Promise(resolve => { first = resolve; });
  const pending = decideStreaming({
    config, context, input: 'hello', history: [], lunaDeliveryVersion: 1,
    timeoutMs: 5000,
    fetchImpl: async (_url, init) => {
      fetches++;
      requested = JSON.parse(init.body);
      return new Response(new ReadableStream({
        start(controller) {
          const send = event => controller.enqueue(new TextEncoder().encode(frame(event)));
          send({ type: 'response.created', response: { id: 'resp_1' } });
          send({ type: 'response.output_item.added', output_index: 0, item:
            { id: 'msg_1', type: 'message', role: 'assistant', content: [] } });
          send({ type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: text.slice(0, boundary) });
          gate.then(() => {
            send({ type: 'response.output_text.delta', output_index: 0, item_id: 'msg_1', delta: text.slice(boundary) });
            send({ type: 'response.output_text.done', output_index: 0, item_id: 'msg_1', text });
            send({ type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [terminalMsg] } });
            controller.close();
          });
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    },
    onSegment: segment => { seen.push(segment); if (seen.length === 1) first(); },
  });
  try {
    await firstSegment;
    assert.equal(fetches, 1);
    assert.deepEqual(seen, [{ sequence: 1, text: 'Nice one.', delivery: 'amused' }]);
    assert.equal(requested.text.format.name, 'e1_segmented_delivery_v1');
    assert.equal(requested.stream, true);
  } finally { release(); }
  const result = await pending;
  assert.deepEqual(result.decision, { dialogue: 'Nice one. Come on.', command: '' });
  assert.deepEqual(result.segments.map(({ delivery }) => delivery), ['amused', 'neutral']);
  assert.equal(fetches, 1);
});

test('EA3 schema/version mismatch fails before sending any provider request', async () => {
  let calls = 0;
  await assert.rejects(streamDecision({
    config, body: makeRequest(), lunaDeliveryVersion: 1,
    fetchImpl: async () => { calls++; throw new Error('not expected'); },
  }), /does not match/);
  await assert.rejects(streamDecision({
    config, body: makeRequest(1), lunaDeliveryVersion: 0,
    fetchImpl: async () => { calls++; throw new Error('not expected'); },
  }), /requires explicit opt-in/);
  assert.equal(calls, 0);
});

test('EA3 local decoder performance stays bounded for normal short Luna segments', () => {
  const raw = wire([v1Segment('neutral', 'Okay.'), v1Segment('amused', 'That is funny.')]);
  const start = performance.now();
  for (let i = 0; i < 100; i++) {
    const decoder = createSegmentDecoder({ lunaDeliveryVersion: 1 });
    for (let offset = 0; offset < raw.length; offset += 7)
      decoder.append(raw.slice(offset, offset + 7));
    assert.equal(decoder.finish().decision.dialogue, 'Okay. That is funny.');
  }
  // Generous bound avoids CI machine flakiness while guarding runaway parsing.
  assert.ok(performance.now() - start < 5000);
});
