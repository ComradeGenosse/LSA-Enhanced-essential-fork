import test from 'node:test';
import assert from 'node:assert/strict';
import { createDialogueTrace, createNoopDialogueTrace, normalizeDialogueLoggingConfig } from '../src/observability/dialogueTrace.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';

const identity = Object.freeze({ pedId: 'ped-17', sessionNonce: 5, turnId: 'turn-40', generationId: 901 });
function memorySink() {
  return { runId: 'dialogue-run', records: [], droppedCount: 0, emit(record) { this.records.push({ ...record, sequence: this.records.length + 1, runId: this.runId }); return true; }, async flush() {}, async close() {} };
}
function payloadText(records, kind) { return records.filter(row => row.data?.payloadKind === kind).sort((a,b) => a.data.chunkIndex-b.data.chunkIndex).map(row => row.data.text).join(''); }

test('dialogue logging is disabled by default and configuration is bounded', () => {
  assert.equal(normalizeConfig({}, {}).dialogueLogging.enabled, false);
  assert.equal(normalizeConfig({ promotedCharacters: {} }, {}).promotedCharacters.summonWaitMs, 30_000);
  assert.equal(normalizeDialogueLoggingConfig({ enabled: true }).enabled, true);
  assert.throws(() => normalizeDialogueLoggingConfig({ surprise: true }), /Invalid dialogueLogging/);
  assert.throws(() => normalizeDialogueLoggingConfig({ maxTotalBytes: 65536, maxFileBytes: 131072 }), /at least maxFileBytes/);
  assert.throws(() => normalizeConfig({ promotedCharacters: { summonWaitMs: 60_001 } }, {}), /Invalid promotedCharacters/);
});

test('dialogue trace snapshots the request, correlates attempt and turn, chunks it and redacts credentials', () => {
  const sink = memorySink(); const config = normalizeDialogueLoggingConfig({ enabled: true, maxPayloadBytes: 8192 });
  const trace = createDialogueTrace({ sink, config, telemetryRunId: 'telemetry-run', secrets: ['test-secret'] });
  const turn = trace.beginTurn(identity, 'player_text');
  turn.input('Hi test-secret 👋');
  const attempt = turn.beginAttempt({ operation: 'model', attemptId: 'model:1' });
  const request = { model: 'gpt-6-luna', input: [{ role: 'user', content: 'hello' }] };
  attempt.request(request); request.input[0].content = 'mutated';
  const requestText = payloadText(sink.records, 'request_json');
  assert.deepEqual(JSON.parse(requestText), { model: 'gpt-6-luna', input: [{ role: 'user', content: 'hello' }] });
  assert.equal(payloadText(sink.records, 'player_text'), 'Hi [REDACTED] 👋');
  assert.equal(sink.records[0].telemetryRunId, 'telemetry-run');
  assert.deepEqual(sink.records[0].identity, identity);
  attempt.finish({ outcome: 'completed', complete: true });
  turn.decision({ dialogue: 'Hello there.', command: '', internalTranscript: 'Hello there.' });
  turn.finish({ reason: 'completed', stage: 'completed', assistantCommitted: true });
  assert.equal(sink.records.filter(row => row.event === 'turn_terminal_summary').length, 1);
  assert.equal(sink.records.find(row => row.event === 'model_attempt_finished').data.attemptId, 'model:1');
});

test('stream failure stores one bounded partial snapshot and terminal close is idempotent', async () => {
  const sink = memorySink(); const trace = createDialogueTrace({ sink, config: { maxPayloadBytes: 1024 } });
  const turn = trace.beginTurn(identity, 'internal');
  const attempt = turn.beginAttempt({ operation: 'model', attemptId: 'model:2' });
  attempt.appendDelta('partial 👋'.repeat(300));
  attempt.finish({ outcome: 'timeout' }); attempt.finish({ outcome: 'completed', complete: true });
  const row = sink.records.find(record => record.data?.payloadKind === 'assistant_stream');
  assert.equal(row.data.truncated, true);
  assert.equal(row.data.partial, true);
  assert.ok(row.data.capturedBytes <= 1024);
  turn.finish({ reason: 'provider_timeout', stage: 'model_running' });
  await trace.close(); await trace.close();
  assert.equal(sink.records.filter(record => record.event === 'run_shutdown').length, 1);
});

test('dropped payload chunks remain detectable and a failed disk sink never escapes into the turn', async () => {
  const partialSink = memorySink(); const originalEmit = partialSink.emit.bind(partialSink);
  partialSink.emit = record => record.data?.payloadKind && record.data.chunkIndex === 1 ? false : originalEmit(record);
  const trace = createDialogueTrace({ sink: partialSink, config: { maxPayloadBytes: 30_000 } });
  const turn = trace.beginTurn(identity, 'player_text');
  assert.equal(turn.input('hello '.repeat(3000)), false);
  const firstChunk = partialSink.records.find(row => row.data?.payloadKind === 'player_text').data;
  assert.equal(firstChunk.chunkCount, 3);
  assert.equal(partialSink.records.filter(row => row.data?.payloadId === firstChunk.payloadId).length, 2);
  await trace.close();

  const brokenTrace = createDialogueTrace({ sink: { emit() { throw new Error('disk unavailable'); }, async flush() { throw new Error('disk unavailable'); }, async close() { throw new Error('disk unavailable'); } } });
  const brokenTurn = brokenTrace.beginTurn(identity, 'player_text');
  assert.doesNotThrow(() => brokenTurn.input('still playable'));
  assert.doesNotThrow(() => brokenTurn.finish({ reason: 'completed' }));
  await assert.doesNotReject(brokenTrace.close());
});

test('no-op trace implements all hooks without retaining work', async () => {
  const trace = createNoopDialogueTrace(); const turn = trace.beginTurn(identity, 'player_text');
  const attempt = turn.beginAttempt({ operation: 'model', attemptId: 'model:1' });
  assert.equal(turn.input('private'), false); assert.equal(attempt.request({ private: true }), false);
  assert.equal(attempt.appendDelta('private'), false); assert.equal(attempt.finish({ outcome: 'completed' }), false);
  assert.equal(turn.finish({ reason: 'completed' }), false); await trace.flush(); await trace.close();
});
