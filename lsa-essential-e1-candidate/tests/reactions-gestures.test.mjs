import test from 'node:test';
import assert from 'node:assert/strict';
import { selectReaction, deliveryAllows, DELIVERY_VETO } from '../src/reactions/reactionSelector.mjs';
import { normalizeReactionConfig } from '../src/reactions/reactionConfig.mjs';
import { createReactionService } from '../src/reactions/reactionService.mjs';
import { REACTION_NAMES, OPT_IN_REACTION_NAMES, isReactionName } from '../src/reactions/reactionCatalog.mjs';
import { DELIVERY_VALUES } from '../src/voice/emotion/deliveryContract.mjs';

const both = ['nod', 'shrug'];
const pick = (dialogue, extra = {}) => selectReaction({ dialogue, source: 'player_text', enabled: both, ...extra });

test('gestures: catalog and config keep nod/shrug opt-in', () => {
  for (const name of ['facepalm', 'middle_finger', 'nod', 'shrug']) assert.equal(isReactionName(name), true);
  assert.deepEqual([...OPT_IN_REACTION_NAMES], ['nod', 'shrug']);
  assert.ok(OPT_IN_REACTION_NAMES.every(name => REACTION_NAMES.includes(name)));
  assert.deepEqual([...normalizeReactionConfig({ mode: 'on' }).enabled], []);
  assert.deepEqual([...normalizeReactionConfig({ mode: 'on', enabled: ['nod', 'nod', 'facepalm', 'bogus', 7] }).enabled], ['nod']);
  assert.deepEqual([...normalizeReactionConfig({ mode: 'on', enabled: 'nod' }).enabled], []);
});

test('gestures: nod/shrug are never selected unless enabled, and do not disturb the other reactions', () => {
  assert.equal(selectReaction({ dialogue: 'You got it. Sounds good.', source: 'player_text' }).reaction, 'none');
  assert.equal(selectReaction({ dialogue: 'I have no idea. Who knows.', source: 'player_text', enabled: [] }).reaction, 'none');
  assert.equal(selectReaction({ dialogue: 'You got it. Sounds good.', source: 'player_text', enabled: ['shrug'] }).reaction, 'none');
  // A disabled opt-in cue cannot make a facepalm "ambiguous".
  assert.equal(selectReaction({ dialogue: "You can't be serious. Whatever, I have no idea.", source: 'player_text' }).reaction, 'facepalm');
});

test('gestures: agreement selects nod only on a strong cue or two weak cues', () => {
  for (const line of ['You got it, boss.', 'Fair enough.', "Yeah, you're right about that.", 'Yeah, got it.', 'Okay. Makes sense.', 'I agree with that plan.']) {
    assert.equal(pick(line).reaction, 'nod', line);
  }
  for (const line of ['Sure.', 'Yeah.', 'Okay, the diner is open late.', 'Right, the bus leaves at nine.', 'Exactly one left.']) {
    assert.equal(pick(line).reaction, 'none', line);
  }
});

test('gestures: nod cues that are questioned, negated, reported or quoted stay none', () => {
  for (const line of [
    'Sure you want that?',
    "I don't think you're right.", 'He said you got it.', 'She told me "you got it" and left.',
    "That's not what I'd call fair enough.", 'Is that right? You got it?',
  ]) assert.equal(pick(line).reaction, 'none', line);
});

test('gestures: uncertainty selects shrug, including its own negation', () => {
  for (const line of ["I really don't know.", 'No idea, man.', 'Beats me.', 'Who knows, honestly.', "I can't really tell you."]) {
    assert.equal(pick(line).reaction, 'shrug', line);
  }
  for (const line of ['Maybe.', 'Whatever.', 'I guess.', 'Maybe the bus is late.']) assert.equal(pick(line).reaction, 'none', line);
  assert.equal(pick('Maybe, I guess.').reaction, 'shrug', 'two independent weak cues');
});

test('gestures: reported or quoted uncertainty and playful lines stay none', () => {
  for (const line of ['She said "I don\'t know" and walked off.', 'He told me he had no idea.', "Haha, I don't know, just kidding."]) {
    assert.equal(pick(line).reaction, 'none', line);
  }
});

test('gestures: competing cues, commands and non-player sources fall back to none', () => {
  assert.equal(pick("Yeah, got it. I don't know though, who knows.").reaction, 'none');
  assert.equal(pick('You got it.', { command: 'followtarget', actionCount: 1 }).reaction, 'none');
  assert.equal(pick('You got it.', { source: 'scene_director' }).reaction, 'none');
  assert.equal(pick('You got it.', { source: 'npc_to_npc' }).reaction, 'none');
});

test('gestures: the player\'s words never choose a gesture (selector reads only the NPC line)', () => {
  assert.equal(pick('Nice weather today.', { playerText: 'nod your head and shrug' }).reaction, 'none');
});

test('gestures: delivery intent only vetoes and the table covers real delivery values', () => {
  for (const reaction of Object.keys(DELIVERY_VETO)) {
    assert.ok(DELIVERY_VETO[reaction].every(value => DELIVERY_VALUES.includes(value)), reaction);
    assert.equal(deliveryAllows(reaction, null), true);
    assert.equal(deliveryAllows(reaction, 'neutral'), true, 'neutral never vetoes');
  }
  assert.equal(deliveryAllows('nod', 'sarcastic'), false);
  assert.equal(deliveryAllows('middle_finger', 'amused'), false);
  assert.equal(deliveryAllows('facepalm', 'whisper'), false);
  assert.equal(deliveryAllows('shrug', 'excited'), false);
  assert.equal(deliveryAllows('facepalm', 'angry'), true);
  // A delivery value cannot create a gesture from an unremarkable line.
  assert.equal(selectReaction({ dialogue: 'Nice weather today.', source: 'player_text', enabled: both, delivery: 'angry' }).reaction, 'none');
});

function fakeClient() {
  const sent = [];
  return { sent, send(frame) { sent.push(frame); return true; } };
}
const identity = { pedId: '4242', turnId: 'turn-1', generationId: 7, sessionNonce: 1 };
const play = (service, line, { delivery, source = 'player_text' } = {}) => {
  const turn = service.openTurn({ identity, source });
  if (delivery !== undefined) turn.delivery(delivery);
  turn.validated({ dialogue: line, command: '', actionCount: 0 });
  turn.native({ type: 'playback_started' });
  return turn;
};

test('gestures: service honours enabled and sends the nod frame exactly like other reactions', () => {
  const off = fakeClient();
  play(createReactionService({ config: { mode: 'on', enabled: [] }, client: off }), 'You got it, boss.');
  assert.equal(off.sent.length, 0);
  const on = fakeClient();
  const service = createReactionService({ config: { mode: 'on', enabled: ['nod'] }, client: on });
  play(service, 'You got it, boss.');
  assert.deepEqual(on.sent, [{ reaction: 'nod', tuple: { pedId: '4242', turnId: 'turn-1', generationId: 7 } }]);
  assert.equal(service.counters().vetoed, 0);
});

test('gestures: a contradicting trusted delivery drops the frame, a neutral or missing one does not', () => {
  const run = (line, delivery, enabled = ['nod', 'shrug']) => {
    const client = fakeClient();
    const service = createReactionService({ config: { mode: 'on', enabled }, client });
    play(service, line, { delivery });
    return { sent: client.sent.length, vetoed: service.counters().vetoed };
  };
  assert.deepEqual(run('You got it, boss.', 'sarcastic'), { sent: 0, vetoed: 1 });
  assert.deepEqual(run('You got it, boss.', 'neutral'), { sent: 1, vetoed: 0 });
  assert.deepEqual(run('You got it, boss.', undefined), { sent: 1, vetoed: 0 });
  assert.deepEqual(run('I have no idea.', 'fearful'), { sent: 0, vetoed: 1 });
  assert.deepEqual(run('Fuck off.', 'amused'), { sent: 0, vetoed: 1 });
  assert.deepEqual(run('Fuck off.', 'angry'), { sent: 1, vetoed: 0 });
  // Untrusted-looking values are ignored rather than trusted or thrown on.
  assert.deepEqual(run('You got it, boss.', 'SARCASTIC'), { sent: 1, vetoed: 0 });
  assert.deepEqual(run('You got it, boss.', { value: 'sarcastic' }), { sent: 1, vetoed: 0 });
});

test('gestures: only the first trusted delivery of a turn counts and a late one cannot veto a sent frame', () => {
  const client = fakeClient();
  const service = createReactionService({ config: { mode: 'on', enabled: ['nod'] }, client });
  const turn = play(service, 'You got it, boss.', { delivery: 'neutral' });
  turn.delivery('sarcastic');
  assert.equal(client.sent.length, 1);
  const second = fakeClient();
  const s2 = createReactionService({ config: { mode: 'on', enabled: ['nod'] }, client: second });
  const t2 = s2.openTurn({ identity, source: 'player_text' });
  t2.delivery('sarcastic'); t2.delivery('neutral');
  t2.validated({ dialogue: 'You got it, boss.', command: '', actionCount: 0 });
  t2.native({ type: 'playback_started' });
  assert.equal(second.sent.length, 0);
});

test('gestures: a released turn ignores delivery and throwing reporters stay harmless', () => {
  const client = fakeClient();
  const service = createReactionService({ config: { mode: 'on', enabled: ['nod'] }, client, report() { throw new Error('boom'); } });
  const turn = service.openTurn({ identity, source: 'player_text' });
  turn.release();
  assert.doesNotThrow(() => turn.delivery('sarcastic'));
  const live = service.openTurn({ identity, source: 'player_text' });
  live.delivery('sarcastic');
  live.validated({ dialogue: 'You got it, boss.', command: '', actionCount: 0 });
  assert.doesNotThrow(() => live.native({ type: 'playback_started' }));
});
