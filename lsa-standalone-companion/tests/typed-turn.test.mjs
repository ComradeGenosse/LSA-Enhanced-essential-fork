import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PendingDialogue, handleNextTypedTurn } from '../src/conversation/typedTurn.js.mjs';
import { createResponsesProvider } from '../src/conversation/responsesProvider.mjs';

function fixture() {
  const run = randomUUID();
  const offer = {
    hostRunId: run, worldEpoch: 1, transportId: randomUUID(),
    status: 'ok', source: 'player_text',
    playerText: 'Are you okay?', turnId: randomUUID(),
    sessionNonce: randomUUID(), actorIncarnationId: randomUUID(),
    leaseId: randomUUID(), generation: '1'
  };
  const events = [];
  const client = {
    closed: new Promise(() => {}),
    async request(type, claims = {}) {
      events.push({ type, claims });
      if (type === 'turn.next') return offer;
      if (type === 'turn.confirm') {
        assert.equal(claims.leaseId, offer.leaseId);
        assert.equal(claims.sessionNonce, offer.sessionNonce);
        return { status: 'ok' };
      }
      if (type === 'turn.reply') {
        assert.equal(claims.actorIncarnationId, offer.actorIncarnationId);
        assert.equal(claims.generation, offer.generation);
        return { status: 'staged_not_played' };
      }
      if (type === 'turn.cancel') return { status: 'ok' };
      throw Error('unsupported');
    }
  };
  return { offer, events, client };
}

test('native-sourced typed turn stages one AI reply but never commits history', async () => {
  const { client, events } = fixture();
  const staged = new PendingDialogue();
  const provider = { async complete({ text }) {
    assert.equal(text, 'Are you okay?');
    return 'I am fine, thanks.';
  } };
  const result = await handleNextTypedTurn(client, provider, { pending: staged });
  assert.equal(result.state, 'staged_not_played');
  assert.equal(staged.pendingCount, 1);
  assert.deepEqual(events.map(e => e.type), ['turn.next', 'turn.confirm', 'turn.reply']);
  assert.equal(typeof staged.commit, 'undefined');
  staged.retireAll();
  assert.equal(staged.pendingCount, 0);
});

test('missing native-validated player text cancels without calling provider', async () => {
  const { offer, client, events } = fixture();
  delete offer.playerText;
  const staged = new PendingDialogue();
  let called = false;
  await assert.rejects(handleNextTypedTurn(client, {
    async complete() { called = true; return 'unexpected'; }
  }, { pending: staged }), /native_typed_text_missing/);
  assert.equal(called, false);
  assert.equal(staged.pendingCount, 0);
  assert.deepEqual(events.map(e => e.type), ['turn.next', 'turn.cancel']);
});

test('provider failure cancels native permit and stages no history', async () => {
  const { client, events } = fixture();
  const staged = new PendingDialogue();
  await assert.rejects(handleNextTypedTurn(client, {
    async complete() { throw new Error('provider_offline'); }
  }, { pending: staged }), /provider_offline/);
  assert.equal(staged.pendingCount, 0);
  assert.deepEqual(events.map(e => e.type), ['turn.next', 'turn.confirm', 'turn.cancel']);
});

test('old client disconnect prevents late AI text from being staged', async () => {
  const { client, events } = fixture();
  let retire;
  client.closed = new Promise(resolve => { retire = resolve; });
  const staged = new PendingDialogue();
  let start;
  const startWait = new Promise(resolve => { start = resolve; });
  const task = handleNextTypedTurn(client, {
    async complete({ signal }) {
      start();
      await new Promise(resolve => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', resolve, { once: true });
      });
      return 'late reply';
    }
  }, { pending: staged });
  await startWait;
  retire('native_disconnected');
  await assert.rejects(task, /typed_turn_cancelled/);
  assert.equal(staged.pendingCount, 0);
  assert.equal(events.filter(e => e.type === 'turn.reply').length, 0);
});

test('provider adapter emits minimal, nonstored Responses request', async () => {
  const calls = [];
  const provider = createResponsesProvider({
    apiKey: 'fixture-secret-not-logged', model: 'fixture-model',
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, async json() {
        return { status: 'completed', output: [
          { type: 'reasoning', summary: [] },
          { type: 'message', role: 'assistant',
            content: [{ type: 'output_text', text: 'Nothing unusual.' }] }
        ] };
      } };
    }
  });
  assert.equal(await provider.complete({ text: 'What is happening?' }), 'Nothing unusual.');
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(calls[0].options.body).store, false);
  assert.equal(JSON.parse(calls[0].options.body).input, 'What is happening?');
  assert.ok(calls[0].options.headers.Authorization.includes('fixture-secret'));
  assert.ok(!calls[0].options.body.includes('fixture-secret'));
});

test('provider refuses incomplete and invalid responses, no false successful answer', async () => {
  const make = result => createResponsesProvider({
    apiKey: 'test', model: 'fixture-model',
    fetchImpl: async () => ({ ok: true, async json() { return result; } })
  });
  await assert.rejects(make({ status: 'in_progress', output: [] })
    .complete({ text: 'Hello' }), /provider_incomplete/);
  await assert.rejects(make({ status: 'completed', output: [] })
    .complete({ text: 'Hello' }), /provider_invalid_answer/);
});

test('poll no pending native offer skips model and history entirely', async () => {
  const events = [];
  const client = { async request(type) {
    events.push(type); return { status: 'none' };
  } };
  const out = await handleNextTypedTurn(client, {
    async complete() { throw Error('provider_should_not_be_called'); }
  });
  assert.equal(out.state, 'none');
  assert.deepEqual(events, ['turn.next']);
});

test('two native turns on same actor keep a conversation identity without replaying unplayed history', () => {
  const pending = new PendingDialogue();
  const nativeRun = randomUUID(), actorIncarnationId = randomUUID();
  const conversationId = randomUUID();
  pending.stage(nativeRun, {
    turnId: randomUUID(), actorIncarnationId, conversationId, turnOrdinal: 1
  }, 'first not yet played');
  assert.equal(pending.pendingCount, 1);
  pending.stage(nativeRun, {
    turnId: randomUUID(), actorIncarnationId, conversationId, turnOrdinal: 2
  }, 'second not yet played');
  assert.equal(pending.pendingCount, 1,
    'superseded reply is discarded, never promoted to completed dialogue');
  pending.stage(nativeRun, {
    turnId: randomUUID(), actorIncarnationId: randomUUID(),
    conversationId: randomUUID(), turnOrdinal: 1
  }, 'other NPC');
  assert.equal(pending.pendingCount, 2, 'two unrelated NPCs remain isolated');
  pending.retireAll();
  assert.equal(pending.pendingCount, 0);
});
