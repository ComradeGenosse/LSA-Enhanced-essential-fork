import test from 'node:test';
import assert from 'node:assert/strict';
import { stockHarness } from './stock-harness.mjs';
import { buildRequest } from '../src/context/essentialDecision.mjs';

async function setup({ decide, speak, actorContext, completePlayback = true } = {}) {
  const h = await stockHarness('openai');
  const { connection, autoNativeAcks } = await h.openAIControllerSession({ actorContext });
  autoNativeAcks({ completePlayback });
  h.runtime.services.decide = decide || (async () => ({ dialogue: 'I can help.', command: '' }));
  h.runtime.services.speak = speak || (async ({ onPcm }) => { await onPcm(new Uint8Array([1, 2])); return { bytes: 2 }; });
  return { h, connection };
}

function nativeIdentity(turn, nonce = 1) {
  return { pedId: turn.pedId, turnId: turn.id, generationId: turn.generationId, sessionNonce: nonce };
}

function invokeTyped(h, text) {
  h.context.playerText = text;
  return h.evaluate('ib({ pedId: "17", speaker: { pedId: "17" }, target: { pedId: "player" }, text: playerText })');
}

async function waitFor(predicate, label) {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail(`Timed out waiting for ${label}`);
}

test('stock ib typed controller sends PLAYER_TEXT through native playback and commits both sides once', async () => {
  let seen;
  const { h, connection } = await setup({ decide: async options => { seen = options; return { dialogue: 'Take the next street.', command: '' }; } });
  const turn = await invokeTyped(h, 'Where is the station?');
  const identity = nativeIdentity(turn);
  assert.equal(turn.source, 'player_text');
  assert.equal(turn.input.transcript, 'Where is the station?');
  assert.equal((await connection.whenSettled(identity)).status, 'completed');
  assert.equal(seen.source, 'player_text');
  assert.equal(seen.input, 'Where is the station?');
  assert.deepEqual(h.runtime.history.readForSession('17', 1), [
    { role: 'user', content: 'Where is the station?' },
    { role: 'assistant', content: 'Take the next street.' },
  ]);
  assert.ok(h.sent.filter(message => ['npcAudioTurnStart', 'npcAudioChunk', 'npcAudioStreamEnded'].includes(message.type))
    .every(message => message.pedId === identity.pedId && message.turnId === identity.turnId && message.generationId === identity.generationId));
  h.context.nativeIdentity = identity;
  await h.evaluate('by({ ...nativeIdentity, type: "npcPlaybackEnded", reason: "completed", hadAudio: true, playbackStarted: true, wasInterrupted: false })');
  assert.equal(h.runtime.history.readForSession('17', 1).length, 2);
});

test('stock typed controller handles consecutive turns for the same NPC with bounded dialogue history', async () => {
  const { h, connection } = await setup();
  const first = await invokeTyped(h, 'First question.');
  assert.equal((await connection.whenSettled(nativeIdentity(first))).status, 'completed');
  const second = await invokeTyped(h, 'Second question.');
  assert.equal((await connection.whenSettled(nativeIdentity(second))).status, 'completed');
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.generationId, second.generationId);
  assert.deepEqual(h.runtime.history.readForSession('17', 1), [
    { role: 'user', content: 'First question.' }, { role: 'assistant', content: 'I can help.' },
    { role: 'user', content: 'Second question.' }, { role: 'assistant', content: 'I can help.' },
  ]);
});

test('stock typed turn supersedes pending old TTS and late PCM stays tied to the old generation', async () => {
  let releaseOld;
  let firstPcmStarted;
  const firstPcm = new Promise(resolve => { firstPcmStarted = resolve; });
  let calls = 0;
  const { h, connection } = await setup({
    speak: async ({ onPcm }) => {
      if (++calls === 1) {
        await onPcm(new Uint8Array([1, 2])); firstPcmStarted();
        await new Promise(resolve => { releaseOld = resolve; });
        await onPcm(new Uint8Array([3, 4]));
        return { bytes: 4 };
      }
      await onPcm(new Uint8Array([5, 6])); return { bytes: 2 };
    },
  });
  const first = await invokeTyped(h, 'Old request.');
  const firstId = nativeIdentity(first);
  const firstDone = connection.whenSettled(firstId);
  await firstPcm;
  const second = await invokeTyped(h, 'New request.');
  const secondId = nativeIdentity(second);
  assert.equal((await connection.whenSettled(secondId)).status, 'completed');
  const oldWireCount = h.sent.filter(message => message.turnId === firstId.turnId).length;
  releaseOld();
  const oldResult = await firstDone;
  assert.notEqual(oldResult.status, 'completed');
  assert.equal(h.sent.filter(message => message.turnId === firstId.turnId).length, oldWireCount);
  assert.ok(h.sent.filter(message => ['npcAudioChunk', 'npcAudioStreamEnded'].includes(message.type)).every(message =>
    message.turnId === firstId.turnId || message.turnId === secondId.turnId));
  assert.deepEqual(h.runtime.history.readForSession('17', 1), [
    { role: 'user', content: 'Old request.' },
    { role: 'user', content: 'New request.' },
    { role: 'assistant', content: 'I can help.' },
  ]);
});

test('stock controller dispatches a valid action with dialogue and preserves dialogue-only behavior', async () => {
  const { h, connection } = await setup({
    actorContext: { pedId: '17', integrations: { policingRedefined: { detected: true } } },
    decide: async () => ({ dialogue: 'I will run the test.', command: 'DO PerformOneLegStandTest' }),
  });
  const turn = await invokeTyped(h, 'Can you check my balance?');
  const identity = nativeIdentity(turn);
  assert.equal((await connection.whenSettled(identity)).status, 'completed');
  assert.equal(h.actions.length, 1);
  assert.equal(h.actions[0].action, 'performonelegstandtest');
  assert.deepEqual(h.runtime.history.readForSession('17', 1), [
    { role: 'user', content: 'Can you check my balance?' }, { role: 'assistant', content: 'I will run the test.' },
  ]);

  h.runtime.services.decide = async () => ({ dialogue: 'Here is a dialogue only reply.', command: '' });
  const next = await invokeTyped(h, 'Just talk to me.');
  assert.equal((await connection.whenSettled(nativeIdentity(next))).status, 'completed');
  assert.equal(h.actions.length, 1);
  assert.equal(h.runtime.history.readForSession('17', 1).filter(message => message.role === 'assistant').length, 2);
});

test('stock kb special event is internal context, retains exact identity, and never becomes fake player history', async () => {
  let seen;
  const { h, connection } = await setup({ decide: async options => { seen = options; return { dialogue: 'I heard that.', command: '' }; } });
  const turn = await h.evaluate('kb({ speakerPedId: "17", listenerPedId: "player", content: "A car alarm is sounding.", reason: "scene_event" })');
  const identity = nativeIdentity(turn);
  assert.equal(turn.source, 'special_event');
  assert.equal(seen.source, 'special_event');
  assert.equal(seen.input, '');
  assert.equal(seen.context.internalEvent, 'A car alarm is sounding.');
  assert.equal(seen.context.contextText, '');
  const request = buildRequest({ model: 'test', effort: 'low', systemInstruction: 'stock',
    actor: seen.context.actor, listener: seen.context.listener, world: seen.context.world,
    contextText: seen.context.contextText, internalEvent: seen.context.internalEvent, source: seen.source,
    input: seen.input, history: seen.history });
  const system = request.input[0].content;
  assert.equal(system.split('A car alarm is sounding.').length - 1, 1);
  assert.match(request.input.at(-1).content, /No player utterance was received/);
  assert.equal((await connection.whenSettled(identity)).status, 'completed');
  assert.deepEqual(h.runtime.history.readForSession('17', 1), [{ role: 'assistant', content: 'I heard that.' }]);
  assert.ok(h.sent.filter(message => ['npcAudioTurnStart', 'npcAudioChunk', 'npcAudioStreamEnded'].includes(message.type))
    .every(message => message.pedId === identity.pedId && message.turnId === identity.turnId && message.generationId === identity.generationId));
});

test('stale special-event inference cannot affect a later typed player turn', async () => {
  let releaseEvent;
  let eventStarted;
  const started = new Promise(resolve => { eventStarted = resolve; });
  const { h, connection } = await setup({ decide: async options => {
    if (options.source === 'special_event') { eventStarted(); await new Promise(resolve => { releaseEvent = resolve; }); return { dialogue: 'Late event.', command: '' }; }
    return { dialogue: 'Current answer.', command: '' };
  } });
  const old = await h.evaluate('kb({ speakerPedId: "17", content: "A siren approaches.", reason: "scene_event" })');
  const oldId = nativeIdentity(old);
  const oldDone = connection.whenSettled(oldId);
  await started;
  const current = await invokeTyped(h, 'What is happening?');
  const currentId = nativeIdentity(current);
  assert.equal((await connection.whenSettled(currentId)).status, 'completed');
  releaseEvent();
  assert.notEqual((await oldDone).status, 'completed');
  assert.equal(h.sent.some(message => message.turnId === oldId.turnId && ['npcAudioChunk', 'npcAudioStreamEnded'].includes(message.type)), false);
  assert.deepEqual(h.runtime.history.readForSession('17', 1), [
    { role: 'user', content: 'What is happening?' }, { role: 'assistant', content: 'Current answer.' },
  ]);
});

test('long native playback is interrupted by exact old identity while the new typed generation succeeds', async () => {
  const { h, connection } = await setup({
    completePlayback: false,
    speak: async ({ onPcm }) => { await onPcm(new Uint8Array([1, 2])); return { bytes: 2_880_000 }; },
  });
  const old = await invokeTyped(h, 'Long answer please.');
  const oldId = nativeIdentity(old);
  const oldDone = connection.whenSettled(oldId);
  await waitFor(() => h.sent.some(message => message.type === 'npcAudioStreamEnded' && message.turnId === oldId.turnId), 'old stream end');
  const oldEndCount = h.sent.filter(message => message.type === 'npcAudioStreamEnded' && message.turnId === oldId.turnId).length;

  const next = await invokeTyped(h, 'Interrupt and answer me.');
  const nextId = nativeIdentity(next);
  const interruption = h.sent.find(message => message.type === 'npcSpeechInterrupted' && message.turnId === oldId.turnId);
  assert.ok(interruption, 'stock controller sends the exact old-turn interrupt');
  assert.equal(interruption.pedId, oldId.pedId);
  assert.equal(interruption.generationId, oldId.generationId);
  const nextDone = connection.whenSettled(nextId);
  await waitFor(() => h.sent.some(message => message.type === 'npcAudioStreamEnded' && message.turnId === nextId.turnId), 'new stream end');
  h.context.nativeIdentity = nextId;
  await h.evaluate('by({ ...nativeIdentity, type: "npcPlaybackEnded", reason: "completed", hadAudio: true, playbackStarted: true, wasInterrupted: false })');
  assert.equal((await nextDone).status, 'completed');
  assert.notEqual((await oldDone).status, 'completed');
  assert.equal(h.sent.filter(message => message.type === 'npcAudioStreamEnded' && message.turnId === oldId.turnId).length, oldEndCount);
  assert.deepEqual(h.runtime.history.readForSession('17', 1), [
    { role: 'user', content: 'Long answer please.' },
    { role: 'user', content: 'Interrupt and answer me.' },
    { role: 'assistant', content: 'I can help.' },
  ]);
});

test('late action completion cannot dispatch after its exact native turn is interrupted', async () => {
  let releaseDecision;
  let decisionStarted;
  const started = new Promise(resolve => { decisionStarted = resolve; });
  const { h, connection } = await setup({
    actorContext: { pedId: '17', roleName: 'Police Officer' },
    decide: async () => { decisionStarted(); await new Promise(resolve => { releaseDecision = resolve; }); return { dialogue: 'Backup requested.', command: 'DO RequestBackup' }; },
  });
  const turn = await invokeTyped(h, 'Send backup.');
  const identity = nativeIdentity(turn);
  const done = connection.whenSettled(identity);
  await started;
  assert.equal(h.actions.length, 0); // RequestBackup dispatches only at native final completion.
  h.context.stockTurn = turn;
  await h.evaluate('Qi(stockTurn.id, ke.PLAYER_BARGE_IN)');
  releaseDecision();
  await done;
  await h.evaluate('Rb(stockTurn, true); Rb(stockTurn, true)');
  assert.equal(h.actions.length, 0);
  assert.equal(h.runtime.host.isCurrent(identity), false);
});
