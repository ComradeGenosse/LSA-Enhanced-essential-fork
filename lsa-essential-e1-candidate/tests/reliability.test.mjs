import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyProviderFailure, parseRetryAfter } from '../src/reliability/errorClassifier.mjs';
import { retryPolicyDecision } from '../src/reliability/retryPolicy.mjs';
import { executeProviderOperation } from '../src/reliability/providerExecutor.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { createRuntime } from '../src/integration/essentialGlue.mjs';
import { OpenAITransport } from '../src/openai/openaiTransport.mjs';
import { speak } from '../src/openai/speak.mjs';

test('provider errors distinguish transient rate limits from permanent quota failures', () => {
  assert.deepEqual(classifyProviderFailure({ status: 429, providerErrorType: 'rate_limit_error' }), { retryable: true, reason: 'rate_limit_error' });
  assert.equal(classifyProviderFailure({ status: 429, providerErrorCode: 'insufficient_quota' }).retryable, false);
  assert.equal(classifyProviderFailure({ status: 429 }).retryable, false);
  assert.equal(classifyProviderFailure({ status: 503 }).retryable, true);
  assert.equal(classifyProviderFailure({ status: 400, providerErrorType: 'invalid_request_error' }).retryable, false);
});

test('retry configuration enforces bounded attempts, delays, and timeout controls', () => {
  const defaults = normalizeConfig({}, {}).retry;
  assert.deepEqual(defaults, { enabled: true, maxAttempts: 2, baseDelayMs: 500, maxDelayMs: 3000, honorRetryAfter: true, jitter: 'bounded', minAttemptBudgetMs: 1000, attemptTimeoutMs: null });
  assert.equal(normalizeConfig({ retry: { enabled: false, maxAttempts: 1, honorRetryAfter: false } }, {}).retry.enabled, false);
  assert.throws(() => normalizeConfig({ retry: { maxAttempts: 3 } }, {}), /maxAttempts/);
  assert.throws(() => normalizeConfig({ retry: { baseDelayMs: 2000, maxDelayMs: 1000 } }, {}), /retry configuration/);
  assert.throws(() => normalizeConfig({ retry: { jitter: 'unbounded' } }, {}), /retry configuration/);
  assert.throws(() => normalizeConfig({ retry: { attemptTimeoutMs: 500 } }, {}), /attemptTimeoutMs/);
});

test('speech consumer failures retain their native error identity and stay nonretryable', async () => {
  const config = normalizeConfig({}, { OPENAI_API_KEY: 'offline-test-key' });
  const nativeError = Object.assign(new Error('native authorization rejected'), { code: 'native_authorization_rejected' });
  await assert.rejects(speak({ config, dialogue: 'Test.', signal: new AbortController().signal,
    fetchImpl: async () => new Response(Uint8Array.from([0, 0]), { status: 200 }),
    onPcm: async () => { throw nativeError; },
  }), error => error === nativeError);
  assert.equal(classifyProviderFailure(nativeError).retryable, false);
});

test('Retry-After is honored as a minimum and unsafe waits are skipped', () => {
  assert.equal(parseRetryAfter('1.25', 0), 1250);
  assert.equal(parseRetryAfter('Thu, 01 Jan 1970 00:00:02 GMT', 0), 2000);
  assert.equal(parseRetryAfter('not-a-date', 0), null);
  const error = { status: 429, providerErrorType: 'rate_limit_error', retryAfterMs: 2000 };
  assert.equal(retryPolicyDecision({ error, attempt: 1, maxAttempts: 2, policy: { enabled: true, baseDelayMs: 20, maxDelayMs: 3000, minAttemptBudgetMs: 1000, random: () => 0 }, canRetry: true, remainingMs: 4000 }).delayMs, 2000);
  assert.equal(retryPolicyDecision({ error: { ...error, retryAfterMs: 5000 }, attempt: 1, maxAttempts: 2, policy: { enabled: true, baseDelayMs: 20, maxDelayMs: 3000, minAttemptBudgetMs: 1000, random: () => 0 }, canRetry: true, remainingMs: 9000 }).reason, 'retry_after_above_max');
  const backoff = { enabled: true, baseDelayMs: 100, maxDelayMs: 100, minAttemptBudgetMs: 10 };
  assert.equal(retryPolicyDecision({ error: { status: 503 }, attempt: 1, maxAttempts: 2, policy: { ...backoff, random: () => 0 }, canRetry: true, remainingMs: 1000 }).delayMs, 50);
  assert.equal(retryPolicyDecision({ error: { status: 503 }, attempt: 1, maxAttempts: 2, policy: { ...backoff, random: () => 1 }, canRetry: true, remainingMs: 1000 }).delayMs, 100);
});

test('root cancellation during retry backoff prevents the next provider attempt', async () => {
  const controller = new AbortController();
  const reason = Object.assign(new Error('superseded'), { code: 'superseded' });
  let attempts = 0;
  await assert.rejects(executeProviderOperation({
    operation: 'model', provider: 'openai.reasoning', identity: { pedId: 'p', turnId: 't', generationId: 1, sessionNonce: 1 },
    signal: controller.signal, deadlineAt: performance.now() + 2_000,
    retryConfig: { enabled: true, maxAttempts: 2, baseDelayMs: 100, maxDelayMs: 100, minAttemptBudgetMs: 10 },
    telemetry: { event: name => { if (name === 'provider_retry_scheduled') controller.abort(reason); } },
    run: async () => { attempts++; throw Object.assign(new Error('temporary'), { status: 503 }); },
  }), error => error === reason);
  assert.equal(attempts, 1);
});

test('attempt timeout retires late telemetry before a recovered attempt returns', async () => {
  const events = [];
  let staleActive;
  let attempts = 0;
  const result = await executeProviderOperation({
    operation: 'model', provider: 'openai.reasoning', identity: { pedId: 'p', turnId: 't', generationId: 1, sessionNonce: 1 },
    signal: new AbortController().signal, deadlineAt: performance.now() + 2_000,
    retryConfig: { enabled: true, maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 100, minAttemptBudgetMs: 10, attemptTimeoutMs: 15 },
    telemetry: { event: (name, data) => events.push({ name, data }) },
    run: async ({ attempt, isActive, telemetry }) => {
      attempts++;
      if (attempt === 1) {
        staleActive = isActive;
        await new Promise(resolve => setTimeout(resolve, 30));
        telemetry.event('late_usage', { outputTokens: 900 });
        throw Object.assign(new Error('late timeout'), { status: 503 });
      }
      return 'recovered';
    },
  });
  assert.equal(result, 'recovered');
  assert.equal(attempts, 2);
  assert.equal(staleActive(), false);
  assert.equal(events.some(event => event.name === 'late_usage'), false);
});

test('executor performs at most one eligible retry inside the original deadline', async () => {
  let attempts = 0;
  let clock = 0;
  const events = [];
  const controller = new AbortController();
  const result = await executeProviderOperation({
    operation: 'model', provider: 'openai.reasoning', identity: { pedId: 'p', turnId: 't', generationId: 1, sessionNonce: 1 },
    signal: controller.signal, deadlineAt: 10_000, now: () => clock,
    retryConfig: { enabled: true, maxAttempts: 2, baseDelayMs: 10, maxDelayMs: 100, minAttemptBudgetMs: 10 },
    telemetry: { event: (name, data) => events.push({ name, data }) },
    delay: async ms => { clock += ms; },
    run: async ({ attempt, signal, timeoutMs }) => {
      attempts++;
      assert.equal(signal.aborted, false);
      assert.ok(timeoutMs <= 10_000);
      if (attempt === 1) throw Object.assign(new Error('temporary'), { status: 503 });
      return 'ok';
    },
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
  assert.ok(events.some(event => event.name === 'provider_retry_scheduled'));
  assert.ok(events.some(event => event.name === 'provider_retry_recovered'));
});

test('dialogue trace closes every model attempt and retains distinct retry identities', async () => {
  const attempts = [];
  const result = await executeProviderOperation({
    operation: 'model', provider: 'openai.reasoning', identity: { pedId: 'p', turnId: 't', generationId: 1, sessionNonce: 1 },
    signal: new AbortController().signal, deadlineAt: 10_000, now: () => 0,
    retryConfig: { enabled: true, maxAttempts: 2, baseDelayMs: 0, maxDelayMs: 0, minAttemptBudgetMs: 1 },
    dialogueTrace: { beginAttempt: value => { const item = { ...value, finished: null }; attempts.push(item); return { request: body => { item.body = body; }, finish: outcome => { item.finished = outcome; } }; } },
    delay: async () => {},
    run: async ({ attempt, dialogueAttempt }) => {
      dialogueAttempt.request({ input: `attempt ${attempt}` });
      if (attempt === 1) throw Object.assign(new Error('temporary'), { status: 503 });
      return 'ok';
    },
  });
  assert.equal(result, 'ok');
  assert.deepEqual(attempts.map(item => item.attemptId), ['model:1', 'model:2']);
  assert.deepEqual(attempts.map(item => item.body.input), ['attempt 1', 'attempt 2']);
  assert.deepEqual(attempts.map(item => item.finished.outcome), ['failed', 'completed']);
});

function bridge(onEvent = async () => {}, validateDecision = decision => ({ identityValid: true, internalTranscript: decision.dialogue, actionCount: 0 })) {
  const listeners = new Set();
  return {
    assertCapabilities() {}, isCurrent: () => true, validateDecision,
    failMatchingTurn: () => true, routePinnedEvent: onEvent,
    authorize(identity) { for (const fn of listeners) fn({ ...identity, type: 'audio_turn_accepted' }); return true; },
    onNativeEvent(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    complete(identity) { for (const fn of listeners) fn({ ...identity, type: 'playback_ended', reason: 'completed', wasInterrupted: false, hadAudio: true, playbackStarted: true }); },
  };
}

function decisionResponse(command = '') {
  return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ dialogue: 'A short reply.', command }) }] }] }), { status: 200 });
}

async function runTurn({ fetch, validateDecision, pcm = null } = {}) {
  const config = normalizeConfig({}, { OPENAI_API_KEY: 'offline-test-key' });
  const runtime = createRuntime(config, { fetchImpl: fetch });
  const b = bridge(async event => { if (event.type === 'turn_complete') queueMicrotask(() => b.complete(event)); return true; }, validateDecision);
  runtime.attachBridge(b);
  const identity = { pedId: '17', turnId: 'retry-test', generationId: 1, sessionNonce: 1 };
  const connection = await new OpenAITransport(runtime).connect({ systemInstruction: 'stock', diagnosticContext: { pedId: '17', sessionNonce: 1 }, onEvent: async () => {} });
  await connection.beginTurn({ identity, source: 'player_text', context: { inputText: 'Hello.', systemInstruction: 'stock' } });
  if (pcm) {
    await connection.startRealtimeInput();
    await connection.sendRealtimeAudio(pcm, 16_000);
    await connection.endRealtimeInput();
  } else await connection.sendText('Hello.');
  const result = await connection.whenSettled(identity);
  connection.close();
  return result;
}

test('dialogue-only TTS retries a transient failure before PCM and emits one successful stream', async () => {
  let speechRequests = 0;
  const fetch = async url => {
    if (url.endsWith('/responses')) return decisionResponse();
    speechRequests++;
    if (speechRequests === 1) return new Response(JSON.stringify({ error: { type: 'server_error' } }), { status: 503 });
    return new Response(Uint8Array.from([0, 0, 1, 0]), { status: 200 });
  };
  const result = await runTurn({ fetch });
  assert.equal(result.status, 'completed');
  assert.equal(speechRequests, 2);
});

test('transcription and reasoning retry transient provider failures once before publication', async t => {
  await t.test('STT', async () => {
    let sttRequests = 0;
    const fetch = async url => {
      if (url.endsWith('/audio/transcriptions')) {
        sttRequests++;
        if (sttRequests === 1) return new Response(JSON.stringify({ error: { type: 'server_error' } }), { status: 503 });
        return new Response(JSON.stringify({ text: 'Hello.' }), { status: 200 });
      }
      if (url.endsWith('/responses')) return decisionResponse();
      return new Response(Uint8Array.from([0, 0]), { status: 200 });
    };
    const result = await runTurn({ fetch, pcm: Uint8Array.from([0, 0]) });
    assert.equal(result.status, 'completed');
    assert.equal(sttRequests, 2);
  });
  await t.test('reasoning', async () => {
    let modelRequests = 0;
    const fetch = async url => {
      if (url.endsWith('/responses')) {
        modelRequests++;
        if (modelRequests === 1) return new Response(JSON.stringify({ error: { type: 'server_error' } }), { status: 503 });
        return decisionResponse();
      }
      return new Response(Uint8Array.from([0, 0]), { status: 200 });
    };
    const result = await runTurn({ fetch });
    assert.equal(result.status, 'completed');
    assert.equal(modelRequests, 2);
  });
});

test('TTS does not retry after its first PCM handoff or on an action-bearing turn', async t => {
  await t.test('PCM handoff started', async () => {
    let speechRequests = 0;
    const fetch = async url => {
      if (url.endsWith('/responses')) return decisionResponse();
      speechRequests++;
      let first = true;
      const body = { getReader: () => ({
        read: async () => { if (first) { first = false; return { done: false, value: Uint8Array.from([0, 0]) }; } throw new Error('connection reset'); },
        cancel: async () => {}, releaseLock() {},
      }) };
      return { status: 200, ok: true, headers: { get: () => null }, body };
    };
    const result = await runTurn({ fetch });
    assert.notEqual(result.status, 'completed');
    assert.equal(speechRequests, 1);
  });
  await t.test('action-bearing turn', async () => {
    let speechRequests = 0;
    const fetch = async url => {
      if (url.endsWith('/responses')) return decisionResponse();
      speechRequests++;
      return new Response(JSON.stringify({ error: { type: 'server_error' } }), { status: 503 });
    };
    const result = await runTurn({ fetch, validateDecision: decision => ({ identityValid: true, internalTranscript: decision.dialogue, actionCount: 1 }) });
    assert.notEqual(result.status, 'completed');
    assert.equal(speechRequests, 1);
  });
});
