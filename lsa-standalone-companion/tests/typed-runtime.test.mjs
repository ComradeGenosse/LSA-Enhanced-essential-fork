import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { runTypedTurnSession } from '../src/conversation/typedRuntime.mjs';

function nativeFixture({ offers = 1, modelHold = false } = {}) {
  const abort = new AbortController();
  const calls = [];
  const pending = [];
  let resolveClosed;
  const closed = new Promise(resolve => { resolveClosed = resolve; });
  let generated = 0;
  const client = {
    closed,
    async request(type, fields = {}) {
      calls.push({ type, fields });
      if (abort.signal.aborted) throw Error('native_disconnected');
      if (type === 'turn.next') {
        if (generated++ >= offers) return { status: 'none' };
        return { status: 'ok', hostRunId: randomUUID(),
          turnId: randomUUID(), leaseId: randomUUID(), actorIncarnationId: randomUUID(),
          sessionNonce: randomUUID(), source: 'player_text', generation: '1',
          playerText: 'What is going on?' };
      }
      if (type === 'turn.confirm') return { status: 'ok' };
      if (type === 'turn.reply') return { status: 'staged_not_played' };
      if (type === 'turn.cancel') return { status: 'ok' };
      throw Error('unexpected_native_call');
    }
  };
  return { client, calls, abort,
    disconnect: () => { abort.abort(); resolveClosed('native_disconnected'); } };
}
const waitFor = async (condition, timeoutMs = 1200) => {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw Error('fixture_timeout');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

test('production typed poller consumes native input, validates reply and retires pending state', async () => {
  const fixture = nativeFixture();
  const statuses = [];
  const worker = runTypedTurnSession({
    client: fixture.client, signal: fixture.abort.signal, pollMs: 50,
    provider: { async complete({ text }) {
      assert.equal(text, 'What is going on?');
      return 'Just standing around.';
    } },
    onStatus: event => statuses.push(event)
  });
  await waitFor(() => statuses.includes('typed_reply_staged'));
  fixture.disconnect();
  await worker;
  assert.deepEqual(fixture.calls.slice(0,3).map(x => x.type),
    ['turn.next', 'turn.confirm', 'turn.reply']);
  assert.equal(statuses.filter(x => x === 'typed_reply_staged').length, 1);
});

test('connection death aborts slow provider and never attempts a stale native reply', async () => {
  const fixture = nativeFixture();
  let modelStarted;
  const started = new Promise(resolve => { modelStarted = resolve; });
  const worker = runTypedTurnSession({
    client: fixture.client, signal: fixture.abort.signal, pollMs: 50,
    provider: { async complete({ signal }) {
      modelStarted();
      await new Promise(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', resolve, { once: true });
      });
      return 'old session output';
    } }
  });
  await started;
  fixture.disconnect();
  await worker;
  assert.equal(fixture.calls.some(x => x.type === 'turn.reply'), false);
});

test('failed provider response cancels permit but does not create an infinite retry loop', async () => {
  const fixture = nativeFixture();
  const statuses = [];
  const worker = runTypedTurnSession({
    client: fixture.client, signal: fixture.abort.signal, pollMs: 50,
    provider: { async complete() { throw Error('provider_http_failure'); } },
    onStatus: (type, metadata) => statuses.push({ type, metadata })
  });
  await waitFor(() => fixture.calls.some(x => x.type === 'turn.cancel'));
  fixture.disconnect();
  await worker;
  assert.equal(fixture.calls.filter(x => x.type === 'turn.confirm').length, 1);
  assert.equal(fixture.calls.filter(x => x.type === 'turn.reply').length, 0);
  assert.equal(statuses[0].metadata.reason, 'provider_http_failure');
});

test('never emits arbitrary provider exception text in status callback', async () => {
  const fixture = nativeFixture();
  const statuses = [];
  const worker = runTypedTurnSession({
    client: fixture.client, signal: fixture.abort.signal, pollMs: 50,
    provider: { async complete() { throw Error('private accidental transcript'); } },
    onStatus: (event, metadata) => statuses.push(metadata?.reason)
  });
  await waitFor(() => statuses.length > 0);
  fixture.disconnect();
  await worker;
  assert.deepEqual(statuses, ['typed_turn_rejected']);
});
