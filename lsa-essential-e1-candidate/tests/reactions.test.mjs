import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { EventEmitter } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { selectReaction } from '../src/reactions/reactionSelector.mjs';
import { normalizeReactionConfig } from '../src/reactions/reactionConfig.mjs';
import { createReactionService } from '../src/reactions/reactionService.mjs';
import { ReactionClient, validateHello } from '../src/reactions/reactionClient.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';

const select = (dialogue, extra = {}) => selectReaction({ dialogue, source: 'player_text', ...extra });

test('reactions: config is default-off and normalizes unsafe values', () => {
  assert.deepEqual({ ...normalizeReactionConfig(undefined) }, { mode: 'off', pipeName: 'LSA.Reactions.v1' });
  assert.equal(normalizeReactionConfig({ mode: 'on' }).mode, 'on');
  assert.equal(normalizeReactionConfig({ mode: 'shadow' }).mode, 'shadow');
  assert.equal(normalizeReactionConfig({ mode: 'ON' }).mode, 'off');
  assert.equal(normalizeReactionConfig({ mode: true }).mode, 'off');
  assert.equal(normalizeReactionConfig({ mode: 'on', pipeName: '..\\evil' }).pipeName, 'LSA.Reactions.v1');
});

test('reactions: selection defaults to none for ordinary dialogue', () => {
  for (const line of [
    'Sure, I can help with that.', 'Yeah, the diner on Vinewood is open late.', 'I am not sure what you mean.',
    'Fuck yeah, that was a great night!', 'Seriously good coffee here.', '', '   ',
  ]) assert.equal(select(line).reaction, 'none', line);
});

test('reactions: strong exasperation cues select facepalm', () => {
  assert.equal(select('Are you kidding me right now?').reaction, 'facepalm');
  assert.equal(select("For fuck's sake, you can't be serious.").reaction, 'facepalm');
  assert.equal(select('What is wrong with you?').reaction, 'facepalm');
  // Two independent weak cues also qualify.
  assert.equal(select("I can't believe you. Unbelievable.").reaction, 'facepalm');
});

test('reactions: a single weak cue is not enough', () => {
  assert.equal(select('Unbelievable.').reaction, 'none');
  assert.equal(select('Ugh, fine.').reaction, 'none');
  assert.equal(select('Get lost.').reaction, 'none');
});

test('reactions: contempt directed at the player selects middle_finger', () => {
  assert.equal(select('Fuck off, I am done talking to you.').reaction, 'middle_finger');
  assert.equal(select('Go fuck yourself.').reaction, 'middle_finger');
  assert.equal(select('Shut the fuck up and get lost.').reaction, 'middle_finger');
});

test('reactions: quoted, negated, reported or playful cues stay none', () => {
  for (const line of [
    'I would never tell you to fuck off.', 'He said "fuck you" and walked away.', "Don't you fuck off on me.",
    'Did she really say fuck you?', 'Fuck off, man, haha.', 'You are kidding me, lol.', 'Just kidding, are you kidding me?',
    'She told me to go fuck yourself, can you believe it', 'Why would I say piss off to you?',
  ]) assert.equal(select(line).reaction, 'none', line);
});

test('reactions: competing facepalm and finger cues are ambiguous, so none', () => {
  const result = select('Are you kidding me? Fuck off.');
  assert.equal(result.reaction, 'none');
  assert.equal(result.reason, 'ambiguous');
});

test('reactions: commands, non-player sources and the player\'s words never trigger', () => {
  assert.equal(select('Are you kidding me?', { command: 'followtarget' }).reaction, 'none');
  assert.equal(select('Are you kidding me?', { actionCount: 1 }).reaction, 'none');
  for (const source of ['scene_director', 'special_event', 'npc_to_npc', 'exact_speech', 'system', '']) {
    assert.equal(select('Are you kidding me?', { source }).reaction, 'none', source);
  }
  // The selector has no access to player input: asking for a gesture does nothing.
  assert.equal(selectReaction({ dialogue: 'Sure, whatever you say.', source: 'player_text', playerInput: 'do a facepalm now' }).reaction, 'none');
  assert.equal(select(undefined).reaction, 'none');
  assert.equal(select(42).reaction, 'none');
});

test('reactions: selection is deterministic', () => {
  const first = select('Are you kidding me right now?');
  for (let i = 0; i < 20; i += 1) assert.deepEqual(select('Are you kidding me right now?'), first);
});

function fakeClient(ready = true) {
  const sent = [];
  return { sent, send(frame) { if (!ready) return false; sent.push(frame); return true; } };
}
const identity = { pedId: '4242', turnId: 'turn-1', generationId: 7, sessionNonce: 1 };

test('reactions: service is null when off and for non-player sources', () => {
  assert.equal(createReactionService({ config: { mode: 'off' }, client: fakeClient() }), null);
  const service = createReactionService({ config: { mode: 'on' }, client: fakeClient() });
  assert.equal(service.openTurn({ identity, source: 'scene_director' }), null);
  assert.equal(service.openTurn({ identity, source: 'npc_to_npc' }), null);
});

test('reactions: frame waits for both a validated line and matching playback_started', () => {
  const client = fakeClient();
  const service = createReactionService({ config: { mode: 'on' }, client });
  // validated first, then playback
  let turn = service.openTurn({ identity, source: 'player_text' });
  turn.validated({ dialogue: 'Are you kidding me?', command: '', actionCount: 0 });
  assert.equal(client.sent.length, 0);
  turn.native({ type: 'audio_turn_accepted' });
  assert.equal(client.sent.length, 0);
  turn.native({ type: 'playback_started' });
  assert.equal(client.sent.length, 1);
  assert.deepEqual(client.sent[0], { reaction: 'facepalm', tuple: { pedId: '4242', turnId: 'turn-1', generationId: 7 } });
  turn.native({ type: 'playback_started' });
  assert.equal(client.sent.length, 1, 'at most one frame per turn');
  // playback first (early TTS), then validated
  const second = createReactionService({ config: { mode: 'on' }, client: fakeClient() });
  const c2 = second.openTurn({ identity, source: 'player_mic' });
  c2.native({ type: 'playback_started' });
  c2.validated({ dialogue: 'Fuck off.', command: '', actionCount: 0 });
  assert.equal(second.counters().sent, 1);
});

test('reactions: cancelled, ended, aborted, stale or released turns send nothing', () => {
  for (const make of [
    turn => turn.native({ type: 'playback_ended' }),
    turn => turn.native({ type: 'interrupt' }),
    turn => turn.native({ type: 'cancel' }),
    turn => turn.native({ type: 'audio_turn_rejected' }),
    turn => turn.release(),
  ]) {
    const client = fakeClient();
    const service = createReactionService({ config: { mode: 'on' }, client });
    const turn = service.openTurn({ identity, source: 'player_text' });
    make(turn);
    turn.validated({ dialogue: 'Are you kidding me?', command: '', actionCount: 0 });
    turn.native({ type: 'playback_started' });
    assert.equal(client.sent.length, 0);
  }
  const abort = new AbortController();
  const client = fakeClient();
  const turn = createReactionService({ config: { mode: 'on' }, client }).openTurn({ identity, source: 'player_text', signal: abort.signal });
  turn.validated({ dialogue: 'Are you kidding me?', command: '', actionCount: 0 });
  abort.abort();
  turn.native({ type: 'playback_started' });
  assert.equal(client.sent.length, 0);
  const stale = fakeClient();
  const staleTurn = createReactionService({ config: { mode: 'on' }, client: stale }).openTurn({ identity, source: 'player_text', isCurrent: () => false });
  staleTurn.validated({ dialogue: 'Are you kidding me?', command: '', actionCount: 0 });
  staleTurn.native({ type: 'playback_started' });
  assert.equal(stale.sent.length, 0);
});

test('reactions: command-bearing or ordinary lines never send; channel loss is a silent drop', () => {
  const client = fakeClient();
  const service = createReactionService({ config: { mode: 'on' }, client });
  const withCommand = service.openTurn({ identity, source: 'player_text' });
  withCommand.native({ type: 'playback_started' });
  withCommand.validated({ dialogue: 'Are you kidding me?', command: 'followtarget', actionCount: 1 });
  const plain = service.openTurn({ identity: { ...identity, turnId: 'turn-2' }, source: 'player_text' });
  plain.native({ type: 'playback_started' });
  plain.validated({ dialogue: 'Nice weather today.', command: '', actionCount: 0 });
  assert.equal(client.sent.length, 0);
  const down = createReactionService({ config: { mode: 'on' }, client: fakeClient(false) });
  const turn = down.openTurn({ identity, source: 'player_text' });
  turn.native({ type: 'playback_started' });
  turn.validated({ dialogue: 'Are you kidding me?', command: '', actionCount: 0 });
  assert.equal(down.counters().dropped, 1);
});

test('reactions: a throwing reporter cannot break the turn hook', () => {
  const service = createReactionService({ config: { mode: 'on' }, client: fakeClient(), report() { throw new Error('boom'); } });
  const turn = service.openTurn({ identity, source: 'player_text' });
  turn.native({ type: 'playback_started' });
  assert.doesNotThrow(() => turn.validated({ dialogue: 'Are you kidding me?', command: '', actionCount: 0 }));
});

const HELLO = { version: 1, type: 'hello', reactionVersion: 1, hostRunId: '3f1c0f5e-7a43-4c1b-9a6e-2f2f6c3d9a10', worldEpoch: 3, mode: 'on' };

test('reactions: hello validation is exact', () => {
  assert.equal(validateHello(HELLO), true);
  for (const bad of [{ ...HELLO, version: 2 }, { ...HELLO, hostRunId: 'nope' }, { ...HELLO, worldEpoch: 0 }, { ...HELLO, mode: 'off' }, { ...HELLO, reactionVersion: 2 }, null]) {
    assert.equal(validateHello(bad), false);
  }
});

test('reactions: companion/native mode mismatches never permit a gesture frame', () => {
  for (const companionMode of ['shadow', 'on']) for (const nativeMode of ['shadow', 'on']) {
    const socket = new EventEmitter();
    socket.destroyed = false;
    socket.writableLength = 0;
    socket.setEncoding = () => {};
    const sent = [];
    socket.write = line => { sent.push(line); return true; };
    socket.destroy = () => { socket.destroyed = true; socket.emit('close'); };
    const events = [];
    const client = new ReactionClient({ mode: companionMode, pipeName: 'x' }, {
      connect: () => socket, onEvent: (type, data) => events.push([type, data]),
    });
    client.start();
    try {
      socket.emit('data', JSON.stringify({ ...HELLO, mode: nativeMode }) + '\\n');
      const same = companionMode === nativeMode;
      assert.equal(client.ready, same, companionMode + '/' + nativeMode);
      assert.equal(client.send({ reaction: 'facepalm', tuple: { pedId: '1', turnId: 't', generationId: 1 } }), same);
      assert.equal(sent.length, same ? 1 : 0);
      assert.equal(events.some(([type]) => type === 'reaction_channel_mode_mismatch'), !same);
    } finally { client.stop(); }
  }
});

async function withPipe(handler, fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'lsa-rx-'));
  const file = path.join(dir, 'pipe.sock');
  const server = net.createServer(handler);
  await new Promise(resolve => server.listen(file, resolve));
  try { await fn(file, server); } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
}
const until = async (predicate, ms = 2000) => {
  const end = Date.now() + ms;
  while (!predicate()) { if (Date.now() > end) throw new Error('timeout'); await new Promise(r => setTimeout(r, 5)); }
};

test('reactions: client is not ready before hello, then echoes native host context in frames', async () => {
  const received = [];
  await withPipe(socket => {
    socket.setEncoding('utf8');
    socket.on('data', chunk => received.push(...chunk.split('\n').filter(Boolean).map(line => JSON.parse(line))));
    setTimeout(() => socket.write(JSON.stringify(HELLO) + '\n'), 30);
  }, async file => {
    const events = [];
    const client = new ReactionClient({ pipeName: 'x' }, { pathFor: () => file, retryMs: 20, onEvent: (type, data) => events.push([type, data]) });
    client.start();
    try {
      await until(() => client.ready === false && true);
      assert.equal(client.send({ reaction: 'facepalm', tuple: { pedId: '1', turnId: 't', generationId: 1 } }), false, 'dropped before hello');
      await until(() => client.ready);
      assert.deepEqual(client.hostContext, { hostRunId: HELLO.hostRunId, worldEpoch: 3 });
      assert.equal(client.send({ reaction: 'unknown', tuple: { pedId: '1', turnId: 't', generationId: 1 } }), false);
      assert.equal(client.send({ reaction: 'middle_finger', tuple: { pedId: '1', turnId: 't', generationId: 9 } }), true);
      await until(() => received.length === 1);
      const frame = received[0];
      assert.equal(frame.type, 'reaction');
      assert.equal(frame.version, 1);
      assert.equal(frame.hostRunId, HELLO.hostRunId);
      assert.equal(frame.worldEpoch, 3);
      assert.deepEqual(frame.tuple, { pedId: '1', turnId: 't', generationId: 9 });
      assert.match(frame.frameId, /^[0-9a-f-]{36}$/);
      assert.deepEqual(Object.keys(frame).sort(), ['frameId', 'hostRunId', 'reaction', 'tuple', 'type', 'version', 'worldEpoch']);
    } finally { client.stop(); }
    assert.equal(client.ready, false);
    assert.equal(client.send({ reaction: 'facepalm', tuple: { pedId: '1', turnId: 't', generationId: 1 } }), false);
  });
});

test('reactions: client rejects a bad hello and reports acks without trusting them', async () => {
  let sockets = 0;
  await withPipe(socket => {
    sockets += 1;
    if (sockets === 1) { socket.write('{"type":"hello","version":1}\n'); return; }
    socket.write(JSON.stringify(HELLO) + '\n');
    socket.write(JSON.stringify({ type: 'reaction.ack', reaction: 'facepalm', status: 'played', reason: 'ok' }) + '\n');
    socket.write(JSON.stringify({ type: 'reaction.ack', reaction: 'bogus', status: 'played' }) + '\n');
  }, async file => {
    const events = [];
    const client = new ReactionClient({ pipeName: 'x' }, { pathFor: () => file, retryMs: 10, maxRetryMs: 20, onEvent: (type, data) => events.push([type, data]) });
    client.start();
    try {
      await until(() => client.ready);
      await until(() => events.some(([type]) => type === 'reaction_ack'));
      assert.equal(sockets, 2, 'reconnected after the bad hello');
      const acks = events.filter(([type]) => type === 'reaction_ack');
      assert.equal(acks.length, 1);
      assert.deepEqual(acks[0][1], { reaction: 'facepalm', status: 'played', reason: 'ok' });
    } finally { client.stop(); }
  });
});

test('reactions: normalized E1 config defaults reactions off and keeps explicit modes', () => {
  assert.equal(normalizeConfig({}, {}).reactions.mode, 'off');
  assert.equal(normalizeConfig({ reactions: { mode: 'shadow' } }, {}).reactions.mode, 'shadow');
  assert.equal(normalizeConfig({ reactions: { mode: 'banana' } }, {}).reactions.mode, 'off');
  assert.equal(Object.isFrozen(normalizeConfig({}, {}).reactions), true);
});
