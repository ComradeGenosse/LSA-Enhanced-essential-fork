import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { createSegmentDecoder } from '../src/openai/segmentDecoder.mjs';
import { streamDecision } from '../src/openai/streamDecision.mjs';

const full = JSON.stringify({ mode: 'dialogue_only', segments: [{ text: 'I saw him.' }, { text: 'He went east.' }], command: '' });
const frame = event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
function streamingResponse(events) {
  const bytes = new TextEncoder().encode(events.map(frame).join(''));
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += 5) controller.enqueue(bytes.slice(i, i + 5));
    controller.close();
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
function responseEvents(text, { holdFinal } = {}) {
  const split = text.indexOf('},{') + 1;
  const resultText = { id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
  return [
    { type: 'response.created', response: { id: 'resp_1', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { id: 'msg_1', type: 'message', role: 'assistant', content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta: text.slice(0, split) },
    ...(holdFinal ? [] : [
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta: text.slice(split) },
      { type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [resultText], usage: { input_tokens: 4, output_tokens: 9 } } },
    ]),
  ];
}

test('complete-segment decoder emits only closed locally validated objects and reconciles the terminal decision', () => {
  const decoder = createSegmentDecoder();
  const completeFirst = '{"mode":"dialogue_only","segments":[{"text":"Safe { phrase."},';
  decoder.append(completeFirst);
  assert.deepEqual(decoder.takeNewSegments().map(segment => segment.text), ['Safe { phrase.']);
  assert.equal(decoder.mode, 'dialogue_only');
  assert.throws(() => decoder.finish(), /invalid|incomplete|trailing/i);
  const final = '{"mode":"dialogue_only","segments":[{"text":"DO WaitHere"}],"command":""}';
  assert.throws(() => { const invalid = createSegmentDecoder(); invalid.append(final); }, /control command/);
  const contradiction = '{"mode":"dialogue_only","segments":[{"text":"Hello."}],"command":"DO WaitHere"}';
  assert.throws(() => { const invalid = createSegmentDecoder(); invalid.append(contradiction); invalid.finish(); }, /command after speech/);
});

test('Responses stream yields only validated complete segments before response.completed', async () => {
  const config = normalizeConfig({ structuredStreamingEnabled: true }, { OPENAI_API_KEY: 'test-key' });
  let firstValidated;
  const callbacks = [];
  let releaseTerminal;
  const terminal = new Promise(resolve => { releaseTerminal = resolve; });
  const start = new Promise(resolve => { firstValidated = resolve; });
  const resultPromise = streamDecision({
    config,
    body: { model: 'gpt-6-luna', stream: true, input: [], text: { format: { type: 'json_schema', strict: true } } },
    timeoutMs: 3000,
    fetchImpl: async (_url, init) => {
      assert.equal(JSON.parse(init.body).stream, true);
      return new Response(new ReadableStream({
        start(controller) {
          const first = responseEvents(full, { holdFinal: true });
          for (const event of first) controller.enqueue(new TextEncoder().encode(frame(event)));
          terminal.then(() => {
            const split = full.indexOf('},{') + 1;
            const msg = { id: 'msg_1', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: full, annotations: [] }] };
            controller.enqueue(new TextEncoder().encode(frame({ type: 'response.output_text.delta', output_index: 0, content_index: 0, item_id: 'msg_1', delta: full.slice(split) })));
        controller.enqueue(new TextEncoder().encode(frame({ type: 'response.output_text.done', output_index: 0, content_index: 0, item_id: 'msg_1', text: full })));
            controller.enqueue(new TextEncoder().encode(frame({ type: 'response.completed', response: { id: 'resp_1', status: 'completed', output: [msg] } })));
            controller.close();
          });
        },
      }), { headers: { 'content-type': 'text/event-stream' } });
    },
    onSegment: async segment => { callbacks.push(segment); if (callbacks.length === 1) firstValidated(); },
  });
  await start;
  assert.deepEqual(callbacks.map(item => item.text), ['I saw him.']);
  releaseTerminal();
  const result = await resultPromise;
  assert.equal(result.mode, 'dialogue_only');
  assert.deepEqual(result.decision, { dialogue: 'I saw him. He went east.', command: '' });
  assert.deepEqual(result.segments.map(item => item.text), ['I saw him.', 'He went east.']);
  assert.deepEqual(callbacks.map(item => item.text), ['I saw him.', 'He went east.']);
});

test('streamed refusal, missing terminal, and incompatible final text fail closed', async () => {
  const config = normalizeConfig({ structuredStreamingEnabled: true }, { OPENAI_API_KEY: 'test-key' });
  const base = { config, body: {}, timeoutMs: 1000, fetchImpl: async () => streamingResponse([
    { type: 'response.created' }, { type: 'response.refusal.delta', delta: 'no' },
  ]) };
  await assert.rejects(streamDecision(base), error => error.code === 'model_refusal');
  await assert.rejects(streamDecision({ ...base, fetchImpl: async () => streamingResponse(responseEvents(full, { holdFinal: true })) }), error => error.code === 'incomplete_response');
  const different = JSON.stringify({ mode: 'dialogue_only', segments: [{ text: 'Different.' }], command: '' });
  const events = responseEvents(full);
  events.pop();
  events.push({ type: 'response.completed', response: { id: 'resp_2', status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: different }] }] } });
  await assert.rejects(streamDecision({ ...base, fetchImpl: async () => streamingResponse([
    ...events,
  ]) }), error => error.code === 'invalid_response');
});
