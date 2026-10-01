import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createFileSink } from '../src/observability/fileSink.mjs';
import { createTelemetryRecord, sanitizeTelemetryData } from '../src/observability/eventContract.mjs';
import { Telemetry } from '../src/observability/telemetry.mjs';
import { summarizeRecords, readLogFiles, renderMarkdown } from '../tools/summarizeRun.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { createRuntime } from '../src/integration/essentialGlue.mjs';
import { sameIdentity } from '../src/integration/nativeDelivery.mjs';
import { transcribePcm } from '../src/openai/transcribe.mjs';
import { speak } from '../src/openai/speak.mjs';
import { patchSource } from '../tools/buildCandidate.mjs';
import { readFile as readSource } from 'node:fs/promises';

const id = Object.freeze({ pedId: 'ped-17', turnId: 'native-40', generationId: 901, sessionNonce: 5 });
const testRoot = path.dirname(fileURLToPath(import.meta.url));
async function tempDirectory(t) {
  const directory = path.join(testRoot, `.observability-test-${randomUUID()}`);
  await mkdir(directory, { recursive: false });
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function memorySink() {
  return { runId: randomUUID(), records: [], droppedCount: 0, emit(record) { this.records.push({ ...record, sequence: this.records.length + 1, runId: this.runId }); return true; }, async flush() {}, async close() {} };
}

test('telemetry schema drops credentials, text, raw bodies, and arbitrary nested fields', () => {
  const secret = 'sk-proj-NEVER_LOG_THIS';
  const data = sanitizeTelemetryData({ code: secret, model: secret, detail: secret, prompt: 'private dialogue', text: 'private transcript', rawBody: { Authorization: secret }, inputChars: 42, httpStatus: 429 });
  assert.deepEqual(data, { inputChars: 42, httpStatus: 429 });
  const row = createTelemetryRecord({ sequence: 1, runId: 'test', originMs: 1, event: 'turn_terminal_summary', identity: id, source: 'player_text', data: { reason: 'completed', text: 'private dialogue' }, now: 5 });
  assert.deepEqual(row.data, { reason: 'completed' });
  assert.equal(JSON.stringify(row).includes(secret), false);
});

test('telemetry retains bounded provider retry and voice assignment dimensions', () => {
  assert.deepEqual(sanitizeTelemetryData({
    operation: 'tts', provider: 'openai.speech', attempt: 2, maxAttempts: 2, attemptId: 'tts:2',
    retryDelayMs: 500, remainingDeadlineMs: 2500, reason: 'side_effect_started',
    profileId: 'vp_0123456789abcdefabcd', voice: 'shimmer', speed: 1.1, instruction: 'private text',
  }), {
    operation: 'tts', provider: 'openai.speech', attempt: 2, maxAttempts: 2, attemptId: 'tts:2',
    retryDelayMs: 500, remainingDeadlineMs: 2500, reason: 'side_effect_started',
    profileId: 'vp_0123456789abcdefabcd', voice: 'shimmer', speed: 1.1,
  });
});

test('rotating JSONL sink preserves order, bounds retention, and reserves terminal records under queue pressure', async t => {
  const directory = await tempDirectory(t);
  const sink = await createFileSink({ directory, maxFileBytes: 600, maxTotalBytes: 10_000, maxFiles: 2, maxQueue: 2, maxQueueBytes: 1_000 });
  for (let i = 0; i < 100; i++) sink.emit({ event: 'phase_started', data: { operation: 'model', detail: `phase${i}` } });
  sink.emit({ event: 'turn_terminal_summary', data: { terminalReason: 'completed' } });
  assert.ok(sink.droppedCount > 0);
  await sink.flush();
  const files = (await readdir(directory)).filter(name => name.endsWith('.jsonl'));
  assert.ok(files.length <= 2);
  const rows = (await Promise.all(files.map(async name => (await readFile(path.join(directory, name), 'utf8')).trim().split('\n').map(JSON.parse)))).flat().sort((a,b) => a.sequence-b.sequence);
  assert.ok(rows.some(row => row.event === 'turn_terminal_summary'));
  assert.ok(rows.every((row, index) => index === 0 || row.sequence > rows[index-1].sequence));
  await sink.close();
});

test('monotonic turn spans and terminal outcome are recorded only once', () => {
  const sink = memorySink();
  let time = 10;
  const telemetry = new Telemetry({ sink, clock: () => time, utc: () => new Date(0).toISOString() });
  const turn = telemetry.beginTurn(id, 'player_text', { inputChars: 8 });
  turn.event('input_ready', { inputChars: 8 });
  const done = turn.startSpan('model', { model: 'gpt-6-luna' });
  time += 25;
  assert.equal(done('finished', { httpStatus: 200 }), 25);
  assert.equal(turn.finish({ reason: 'completed', stage: 'completed', assistantCommitted: true }), true);
  assert.equal(turn.finish({ reason: 'failed', stage: 'failed' }), false);
  assert.equal(sink.records.filter(row => row.event === 'turn_terminal_summary').length, 1);
  assert.equal(sink.records.find(row => row.event === 'provider_request_finished').data.durationMs, 25);
  assert.equal(sink.records[0].runId, sink.runId);
});

test('STT and TTS instrumentation records sizes and times but never transcripts or dialogue', async () => {
  const sink = memorySink();
  const telemetry = new Telemetry({ sink });
  const metrics = telemetry.beginTurn(id, 'player_mic');
  const config = { ...normalizeConfig({}, { OPENAI_API_KEY: 'test-key' }), transcriptionKey: 'test-key', ttsKey: 'test-key' };
  const transcript = 'TRANSCRIPT MUST NOT APPEAR';
  const result = await transcribePcm({ pcm: new Uint8Array([1,2,3,4]), config, telemetry: metrics, fetchImpl: async () => ({ ok: true, status: 200, headers: new Headers({ 'x-request-id': 'req_sensitive-stt-id' }), json: async () => ({ text: transcript }) }) });
  assert.equal(result, transcript);
  let outputBytes = 0;
  const audio = await speak({ config, dialogue: 'PRIVATE NPC DIALOGUE', telemetry: metrics,
    fetchImpl: async () => new Response(new Uint8Array([1,2,3,4,5,6]), { status: 200, headers: { 'x-request-id': 'req_sensitive-tts-id' } }),
    onPcm: async chunk => { outputBytes += chunk.byteLength; } });
  assert.equal(audio.bytes, 6); assert.equal(outputBytes, 6);
  const serialized = JSON.stringify(sink.records);
  assert.equal(serialized.includes(transcript), false);
  assert.equal(serialized.includes('PRIVATE NPC DIALOGUE'), false);
  assert.ok(sink.records.some(row => row.event === 'provider_request_started' && row.data.operation === 'stt' && row.data.wavBytes === 48));
  assert.ok(sink.records.some(row => row.event === 'provider_headers' && row.data.operation === 'stt' && /^rid_[a-f0-9]{16}$/.test(row.data.requestId)));
  assert.ok(sink.records.some(row => row.event === 'provider_request_finished' && row.data.operation === 'tts' && /^rid_[a-f0-9]{16}$/.test(row.data.requestId)));
  assert.equal(serialized.includes('req_sensitive'), false);
  assert.ok(sink.records.some(row => row.event === 'provider_first_byte' && row.data.operation === 'tts'));
  assert.ok(sink.records.some(row => row.event === 'pcm_first_ready'));
});

test('full fake-native typed turn captures exact lifecycle, history, and one terminal summary without content', async () => {
  const sink = memorySink();
  const telemetry = new Telemetry({ sink });
  const config = normalizeConfig({}, {});
  const runtime = createRuntime(config, { telemetry, fetchImpl: async () => { throw new Error('network disabled'); } });
  const listeners = new Set();
  const bridge = {
    assertCapabilities() {}, isCurrent: candidate => sameIdentity(candidate, id),
    validateDecision: async decision => ({ identityValid: true, internalTranscript: decision.dialogue, actionCount: 0 }),
    onNativeEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    authorize(identity) { for (const fn of listeners) fn({ ...identity, type: 'audio_turn_accepted' }); return true; },
    async routePinnedEvent(event) {
      if (event.type === 'turn_complete') {
        for (const fn of listeners) fn({ ...id, type: 'playback_started' });
        for (const fn of listeners) fn({ ...id, type: 'playback_ended', reason: 'completed', wasInterrupted: false, hadAudio: true, playbackStarted: true });
      }
      return true;
    }, failMatchingTurn() { return true; }, log() {},
  };
  runtime.attachBridge(bridge);
  runtime.services.decide = async ({ telemetry: metrics }) => { const done = metrics.startSpan('model', { model: 'gpt-6-luna' }); done('finished', { httpStatus: 200 }); metrics.event('model_usage', { inputTokens: 8, outputTokens: 3, totalTokens: 11 }); return { dialogue: 'SECRET RESPONSE', command: '' }; };
  runtime.services.speak = async ({ onPcm }) => { await onPcm(new Uint8Array([1,2,3,4])); return { bytes: 4, chunks: 1 }; };
  const connection = await runtime.createTransport(() => { throw new Error('Gemini must remain unused'); }).connect({ systemInstruction: 'safe', diagnosticContext: id });
  await connection.beginTurn({ identity: id, source: 'player_text', context: { inputText: 'SECRET PLAYER TEXT', systemInstruction: 'safe' } });
  await connection.sendText('SECRET PLAYER TEXT');
  const result = await connection.whenSettled(id);
  assert.equal(result.status, 'completed');
  assert.equal(runtime.history.readForSession(id.pedId, id.sessionNonce).length, 2);
  const turnRows = sink.records.filter(row => row.identity?.turnId === id.turnId);
  assert.equal(turnRows.filter(row => row.event === 'turn_terminal_summary').length, 1);
  assert.equal(turnRows.filter(row => row.event === 'native_playback_started').length, 1);
  assert.equal(turnRows.filter(row => row.event === 'native_playback_ended').length, 1);
  assert.equal(turnRows.filter(row => row.event === 'assistant_history_committed').length, 1);
  assert.equal(turnRows.find(row => row.event === 'input_ready')?.data.role, 'typed');
  assert.equal(JSON.stringify(sink.records).includes('SECRET'), false);
  connection.close();
});

test('offline summarizer separates outcomes, unknown usage, and incomplete traces', () => {
  const runId = randomUUID();
  const record = (event, data = {}) => ({ schemaVersion: 1, runId, event, identity: id, source: 'player_text', data });
  const runs = summarizeRecords([record('provider_headers', { operation: 'model', durationMs: 12 }), record('provider_request_finished', { operation: 'model', durationMs: 30 }), record('turn_terminal_summary', { terminalReason: 'completed', stage: 'completed', durationMs: 50, audioDurationMs: 2400, traceComplete: true })]);
  assert.equal(runs[0].completionLatency.p50Ms, 50);
  assert.equal(runs[0].providerUsage.inputTokens, null);
  assert.equal(runs[0].traceComplete, true);
  assert.equal(runs[0].turns[0].timings.modelHeadersMs, 12);
  assert.equal(runs[0].turns[0].expectedPcmDurationMs, 2400);
  const partial = summarizeRecords([record('turn_terminal_summary', { terminalReason: 'provider_timeout', durationMs: 100, traceComplete: false })], { truncatedTail: true });
  assert.equal(partial[0].traceComplete, false);
  assert.match(renderMarkdown(partial), /Non-completed turns are separate/);
});

test('offline summarizer reports retry attempts and outcomes per provider stage', () => {
  const runId = randomUUID();
  const record = (event, data = {}) => ({ schemaVersion: 1, runId, event, identity: id, source: 'player_text', data });
  const retryRecords = [
    record('provider_attempt_started', { operation: 'model', attempt: 1 }),
    record('provider_retry_scheduled', { operation: 'model', retryDelayMs: 500 }),
    record('provider_attempt_started', { operation: 'model', attempt: 2 }),
    record('provider_retry_recovered', { operation: 'model', attempt: 2 }),
    record('provider_attempt_started', { operation: 'tts', attempt: 1 }),
    record('provider_retry_skipped', { operation: 'tts', reason: 'side_effect_started' }),
    record('turn_terminal_summary', { terminalReason: 'completed', stage: 'completed', durationMs: 800, traceComplete: true }),
  ];
  const [run] = summarizeRecords(retryRecords);
  assert.deepEqual(run.providerRetries.model, { attemptsStarted: 2, scheduled: 1, recovered: 1, exhausted: 0, suppressed: 0, scheduledDelayMs: 500 });
  assert.equal(run.providerRetries.tts.suppressed, 1);
  assert.match(renderMarkdown([run]), /model: 2 attempts, 1 recovered/);
});

test('source-pinned stock patch measures action routing at AP without altering identity seam count', async () => {
  const source = await readSource(new URL('../upstream/server.bundle.mjs', import.meta.url), 'utf8');
  const patched = patchSource(source);
  assert.match(patched.output, /actionDispatchStart\(\)/);
  assert.match(patched.output, /actionDispatchEnd\(routed === true\)/);
  assert.ok(patched.edits.some(edit => edit.label === 'Essential provider/action/playback bridge'));
});
