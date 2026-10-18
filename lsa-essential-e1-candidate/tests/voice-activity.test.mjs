import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceActivity, peakOfPcm16, reasonForAbort } from '../src/voice/voiceActivity.mjs';
import { createRuntime } from '../src/integration/essentialGlue.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { sameIdentity } from '../src/integration/nativeDelivery.mjs';
import http from 'node:http';
import { fixture as p2Fixture } from './p2-fixtures.mjs';
import { startCharacterEditor } from '../src/characters/editorServer.mjs';

const id = Object.freeze({ pedId: '17', turnId: 'mic-1', generationId: 11, sessionNonce: 5 });
const next = Object.freeze({ ...id, turnId: 'mic-2', generationId: 12 });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const pcm = (...samples) => Buffer.from(Int16Array.from(samples).buffer);
const clockOf = () => { const state = { now: 1000 }; return { state, clock: () => state.now }; };

test('peak is measured from real PCM16 samples, never from state', () => {
  assert.equal(peakOfPcm16(pcm(0, 0, 0, 0)), 0);
  assert.equal(peakOfPcm16(pcm(0, -32768, 10)), 1);
  assert.ok(Math.abs(peakOfPcm16(pcm(100, -16384, 5)) - 0.5) < 1e-9);
  assert.equal(peakOfPcm16(new Uint8Array([1])), 0, 'a partial sample is ignored');
  assert.equal(peakOfPcm16(null), 0);
  // A Buffer view into a shared pool has a non-zero byteOffset.
  const pooled = Buffer.concat([Buffer.alloc(3), pcm(8192)]).subarray(3);
  assert.ok(Math.abs(peakOfPcm16(pooled) - 0.25) < 1e-9);
});

test('level follows chunks inside the window only and keeps no samples', () => {
  const { state, clock } = clockOf();
  const voice = createVoiceActivity({ clock });
  assert.equal(voice.snapshot().phase, 'idle');
  assert.equal(voice.captureStarted(id), true);
  assert.equal(voice.snapshot().phase, 'recording');
  assert.equal(voice.snapshot().level, 0);
  assert.equal(voice.snapshot().levelAgeMs, null, 'no chunk yet means no level, not a fake zero-age signal');
  voice.level(id, pcm(16384));
  state.now += 20; voice.level(id, pcm(4096));
  assert.equal(voice.snapshot().level, 0.5);
  state.now += 200;
  const quiet = voice.snapshot();
  assert.equal(quiet.level, 0, 'old chunks fall out of the window');
  assert.ok(quiet.levelAgeMs >= 200);
  assert.deepEqual(Object.keys(voice.snapshot()).sort(), ['conv', 'convMs', 'level', 'levelAgeMs', 'phase', 'phaseMs', 'reason', 'v']);
  assert.equal(voice.level(next, pcm(30000)), false, 'chunks for another turn are ignored');
});

test('phases follow only stages that actually happened', () => {
  const { state, clock } = clockOf();
  const voice = createVoiceActivity({ clock });
  voice.captureStarted(id);
  assert.equal(voice.stage(id, 'model_running'), true, 'thinking may follow directly');
  voice.captureStarted(id);
  assert.equal(voice.captureEnded(id, { submitted: true }), true);
  assert.equal(voice.snapshot().phase, 'transcribing');
  assert.equal(voice.nativePlayback(id, 'playback_started'), true, 'native playback is the only way to speaking');
  assert.equal(voice.snapshot().phase, 'speaking');

  voice.captureStarted(id);
  voice.captureEnded(id, { submitted: true });
  voice.stage(id, 'transcribing');
  assert.equal(voice.snapshot().phase, 'transcribing');
  for (const stage of ['tts_running', 'native_authorization', 'playback_streaming', 'stream_end', 'playback_completion']) {
    voice.stage(id, stage);
    assert.equal(voice.snapshot().phase, 'thinking', `${stage} is still waiting on the NPC`);
  }
  assert.equal(voice.nativePlayback(id, 'audio_turn_accepted'), false, 'accepted authorization is not speech');
  assert.equal(voice.snapshot().phase, 'thinking');
  voice.nativePlayback(id, 'playback_started');
  assert.equal(voice.snapshot().phase, 'speaking');
  voice.stage(id, 'playback_completion');
  assert.equal(voice.snapshot().phase, 'speaking', 'later stages never walk the status backwards');
  voice.nativePlayback(id, 'playback_ended');
  assert.equal(voice.snapshot().phase, 'speaking');
  voice.terminal(id, 'completed');
  assert.equal(voice.snapshot().phase, 'done');
  state.now += 7000;
  assert.equal(voice.snapshot().phase, 'idle', 'a finished turn stops being reported');
  assert.equal(voice.stage(id, 'model_running'), false, 'late stages after a terminal state are ignored');
});

test('failures carry bounded reasons; supersession clears silently; stale turns cannot touch the new one', () => {
  const voice = createVoiceActivity({ clock: clockOf().clock });
  voice.captureStarted(id); voice.captureEnded(id, { submitted: true });
  voice.terminal(id, 'stt_error');
  assert.deepEqual([voice.snapshot().phase, voice.snapshot().reason], ['error', 'stt_error']);

  voice.captureStarted(id);
  voice.terminal(id, 'Not A Code!');
  assert.equal(voice.snapshot().reason, 'failed', 'unbounded text is never exposed');

  voice.captureStarted(id); voice.captureEnded(id, { submitted: true });
  voice.captureStarted(next); // a new conversation supersedes the old one
  assert.equal(voice.snapshot().phase, 'recording');
  voice.terminal(id, 'superseded'); voice.terminal(id, 'cancelled'); voice.stage(id, 'model_running'); voice.nativePlayback(id, 'playback_started');
  assert.equal(voice.snapshot().phase, 'recording', 'the old turn cannot change the new conversation');
  assert.equal(voice.snapshot().conv, 4);

  voice.captureEnded(next, { submitted: true }); voice.terminal(next, 'superseded');
  assert.equal(voice.snapshot().phase, 'idle');

  voice.captureStarted(id);
  assert.equal(voice.captureEnded(id, { submitted: false, reason: 'no_audio' }), true);
  assert.deepEqual([voice.snapshot().phase, voice.snapshot().reason], ['error', 'no_audio']);
  assert.deepEqual(['x supersede', 'session_closed', 'disconnected', 'anything'].map(reasonForAbort), ['superseded', 'disconnected', 'disconnected', 'cancelled']);
});

test('tracker methods never throw on hostile input', () => {
  const voice = createVoiceActivity({ clock: clockOf().clock });
  for (const bad of [null, undefined, {}, 7, 'x']) {
    assert.doesNotThrow(() => { voice.captureStarted(bad); voice.level(bad, null); voice.captureEnded(bad); voice.stage(bad, 5); voice.nativePlayback(bad, {}); voice.terminal(bad, {}); voice.snapshot(); });
  }
});

// ---- through the real OpenAIConnection and turn runner ----------------------------------
async function fixture({ decide, speak, emit, transcribe } = {}) {
  const config = { ...normalizeConfig({}, {}), providerWorkDeadlineMs: 2000, turnDeadlineMs: 2000, playbackCompletionMinMs: 2000, playbackCompletionMaxMs: 2000, playbackCompletionGraceMs: 5 };
  const runtime = createRuntime(config, { fetchImpl: () => { throw new Error('No network permitted'); } });
  const listeners = new Set();
  let current = id;
  const native = (identity, type, fields = {}) => { for (const f of [...listeners]) f({ ...identity, type, ...fields }); };
  const complete = (identity = id) => native(identity, 'playback_ended', { reason: 'completed', wasInterrupted: false, hadAudio: true, playbackStarted: true });
  runtime.attachBridge({
    assertCapabilities: () => true,
    isCurrent: identity => sameIdentity(identity, current),
    validateDecision: decision => ({ identityValid: true, internalTranscript: decision.dialogue }),
    onNativeEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    authorize: identity => { native(identity, 'audio_turn_accepted'); return true; },
    routePinnedEvent: async event => { if (emit) return emit(event, complete); if (event.type === 'turn_complete') complete(event); return true; },
    failMatchingTurn: () => true,
    log: () => {},
  });
  runtime.services.decide = decide || (async () => ({ dialogue: 'Hello.', command: '' }));
  runtime.services.speak = speak || (async ({ onPcm }) => { await onPcm(new Uint8Array([1, 2])); return { bytes: 2 }; });
  runtime.services.transcribe = transcribe || (async () => 'Hi there');
  const connection = await runtime.createTransport(() => { throw new Error('Gemini constructed'); }).connect({ systemInstruction: 'stock', diagnosticContext: id });
  const start = async (identity = id) => {
    current = identity;
    await connection.beginTurn({ identity, source: 'player_mic', context: { systemInstruction: 'stock' } });
    await connection.startRealtimeInput();
  };
  return { runtime, connection, start, native, complete, phase: () => runtime.voiceActivity.snapshot().phase, snap: () => runtime.voiceActivity.snapshot() };
}

test('recording to speaking to done is driven by the real mic chunks and pipeline stages', async () => {
  const stt = deferred(); const model = deferred(); const spoken = deferred();
  const f = await fixture({
    transcribe: async () => { await stt.promise; return 'Hi there'; },
    decide: async () => { await model.promise; return { dialogue: 'Hello.', command: '' }; },
    emit: async (event, complete) => { if (event.type === 'audio') await spoken.promise; if (event.type === 'turn_complete') complete(event); return true; },
  });
  await f.start();
  assert.equal(f.phase(), 'recording');
  assert.equal(f.snap().level, 0);
  await f.connection.sendRealtimeAudio(pcm(...Array(320).fill(0)));
  assert.equal(f.snap().level, 0, 'silence reads as zero');
  await f.connection.sendRealtimeAudio(pcm(0, 16384, -8000));
  assert.equal(f.snap().level, 0.5, 'the level is the peak of the chunk Essential delivered');

  const done = (async () => { await f.connection.endRealtimeInput(); return f.connection.whenSettled(id); })();
  await tick();
  assert.equal(f.phase(), 'transcribing');
  assert.equal(f.snap().level, 0, 'no level once recording stopped');
  stt.resolve(); await tick(); await tick();
  assert.equal(f.phase(), 'thinking');
  model.resolve(); await tick(); await tick();
  assert.equal(f.phase(), 'thinking', 'queued audio is not speech yet');
  f.native(id, 'playback_started');
  assert.equal(f.phase(), 'speaking');
  spoken.resolve();
  assert.equal((await done).status, 'completed');
  assert.equal(f.phase(), 'done');
});

test('stt failure surfaces a bounded reason and never reaches thinking', async () => {
  const f = await fixture({ transcribe: async () => { throw Object.assign(new Error('boom'), { code: 'timeout' }); } });
  await f.start();
  await f.connection.sendRealtimeAudio(pcm(1000));
  await f.connection.endRealtimeInput();
  const result = await f.connection.whenSettled(id);
  assert.notEqual(result.status, 'completed');
  assert.equal(f.phase(), 'error');
  assert.match(f.snap().reason, /^[a-z][a-z0-9_]*$/);
  assert.equal(f.snap().reason, result.terminalReason);
});

test('releasing without audio, cancelling mid-recording and a newer capture all clear correctly', async () => {
  const empty = await fixture();
  await empty.start();
  assert.throws(() => empty.connection.endRealtimeInput(), /did not contain microphone audio/);
  assert.deepEqual([empty.phase(), empty.snap().reason], ['error', 'no_audio']);

  const cancelled = await fixture();
  await cancelled.start();
  await cancelled.connection.sendRealtimeAudio(pcm(5000));
  cancelled.connection.abortTurn(id, 'cancelled');
  assert.deepEqual([cancelled.phase(), cancelled.snap().reason, cancelled.snap().level], ['error', 'cancelled', 0]);

  const hold = deferred();
  const rapid = await fixture({ transcribe: async () => { await hold.promise; return 'x'; } });
  await rapid.start();
  await rapid.connection.sendRealtimeAudio(pcm(9000));
  await rapid.connection.endRealtimeInput();
  const first = rapid.connection.whenSettled(id);
  await tick();
  assert.equal(rapid.phase(), 'transcribing');
  await rapid.start(next);
  assert.equal(rapid.phase(), 'recording', 'a new press supersedes the old conversation at once');
  hold.resolve();
  assert.equal((await first).terminalReason, 'superseded');
  assert.equal(rapid.phase(), 'recording', 'the superseded turn finishing cannot clear or change the new recording');
});

test('a missing or failing tracker never affects STT or the conversation', async () => {
  const plain = await fixture();
  plain.runtime.voiceActivity = null;
  await plain.start();
  await plain.connection.sendRealtimeAudio(pcm(1234));
  await plain.connection.endRealtimeInput();
  assert.equal((await plain.connection.whenSettled(id)).status, 'completed');

  const hostile = await fixture();
  const boom = () => { throw new Error('meter exploded'); };
  hostile.runtime.voiceActivity = { captureStarted: boom, level: boom, captureEnded: boom, stage: boom, nativePlayback: boom, terminal: boom, snapshot: boom };
  await hostile.start();
  await hostile.connection.sendRealtimeAudio(pcm(1234));
  await hostile.connection.endRealtimeInput();
  assert.equal((await hostile.connection.whenSettled(id)).status, 'completed');
});

test('the editor API serves voice_status behind the token, with no profile or native side effects', async t => {
  const request = (url, { method = 'GET', headers = {}, body = '' } = {}) => new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, response => { const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') })); });
    req.on('error', reject); req.end(body);
  });
  const f = await p2Fixture(t);
  const voice = createVoiceActivity({ clock: clockOf().clock });
  voice.captureStarted(id); voice.level(id, pcm(16384));
  const editor = await startCharacterEditor(f.service, { port: 0, voiceStatus: () => voice.snapshot() });
  t.after(() => editor.close());
  const token = (await request(editor.url)).body.match(/const auth="([a-f0-9]{64})"/)[1];
  const headers = { origin: editor.url, 'content-type': 'application/json', 'x-lsa-editor': token };
  const call = async data => { const result = await request(editor.url + '/api', { method: 'POST', headers, body: JSON.stringify(data) }); return { status: result.status, json: JSON.parse(result.body) }; };
  const before = f.native.requests.length;
  const reply = await call({ action: 'voice_status' });
  assert.equal(reply.status, 200);
  assert.deepEqual([reply.json.phase, reply.json.level], ['recording', 0.5]);
  assert.equal(f.native.requests.length, before, 'reading the meter makes no native request');
  assert.equal(f.store.list().length, 0, 'and touches no profile');
  assert.equal((await request(editor.url + '/api', { method: 'POST', headers: { ...headers, 'x-lsa-editor': '0'.repeat(64) }, body: '{"action":"voice_status"}' })).status, 403);

  const bare = await startCharacterEditor(f.service, { port: 0 });
  t.after(() => bare.close());
  const bareToken = (await request(bare.url)).body.match(/const auth="([a-f0-9]{64})"/)[1];
  const bareReply = await request(bare.url + '/api', { method: 'POST', headers: { origin: bare.url, 'content-type': 'application/json', 'x-lsa-editor': bareToken }, body: '{"action":"voice_status"}' });
  assert.deepEqual([bareReply.status, JSON.parse(bareReply.body)], [200, { v: 1, phase: 'unavailable' }], 'a companion without the tracker reports unavailable, not an error');
});
