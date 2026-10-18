import test from 'node:test';
import assert from 'node:assert/strict';
import { createKnowledgeDelivery } from '../src/context/knowledgeDelivery.mjs';

const stockReply = { dialogue: 'Yeah, I know that song.', command: '' };
const offer = { intent: 'hold_position', slots: {} };
const act5 = { act5Intents: ['hold_position'], act5Choices: { hold_position: [{}] } };

function request() {
  let current = true;
  const acknowledgements = [];
  const delivery = createKnowledgeDelivery({
    frame: {
      frameVersion: 1,
      modelAllocation: { scene: 'radio verified', messages: [] },
      delivery: [{ decisionKey: 'same-original-observation' }],
    },
    isCurrent: () => current,
    validate: () => null,
    acknowledge: (...args) => { acknowledgements.push(args); return true; },
  });
  delivery.beforeRequest({ model: 'gpt-6-luna', request: 'sealed' });
  return { delivery, acknowledgements, retire: () => { current = false; } };
}

test('October 18 voice fallback regression: ordinary dialogue with ACT5 activity:null is delivered', () => {
  // When ACT5 is available, even an ordinary response carries activity:null.
  const failureBeforeFix = request();
  assert.throws(() => failureBeforeFix.delivery.success({ ...stockReply, activity: null }),
    /only dialogue and command/);
  assert.deepEqual(failureBeforeFix.acknowledgements, []);
  assert.equal(failureBeforeFix.delivery.finish().outcome, 'rejected');

  const fixed = request();
  const result = fixed.delivery.success({ ...stockReply, activity: null }, act5);
  assert.equal(result.outcome, 'delivered');
  assert.equal(result.acknowledged, 1);
  assert.deepEqual(fixed.acknowledgements,
    [['same-original-observation', 'ps4_context', 'delivered']]);
  assert.equal(fixed.delivery.success({ ...stockReply, activity: null }, act5), null);

  // A currently active ACT5 turn may have zero offered intents.
  const empty = request();
  assert.equal(empty.delivery.success({ ...stockReply, activity: null },
    { act5Intents: [], act5Choices: {} }).outcome, 'delivered');
});

test('valid ACT5 proposal is delivered without granting activity execution authority', () => {
  const f = request();
  const decision = { dialogue: 'Want me to wait here?', command: '', activity: offer };
  assert.equal(f.delivery.success(decision, act5).outcome, 'delivered');
  // This is only a C-03 knowledge acknowledgement, not an ACT3 native command.
  assert.deepEqual(f.acknowledgements,
    [['same-original-observation', 'ps4_context', 'delivered']]);
});

test('stock dialogue still uses strict legacy shape, without implicit ACT5 opt-in', () => {
  const normal = request();
  assert.equal(normal.delivery.success(stockReply).outcome, 'delivered');
  const unsolicited = request();
  assert.throws(() => unsolicited.delivery.success({ ...stockReply, activity: null }),
    /only dialogue and command/);
  assert.equal(unsolicited.acknowledgements.length, 0);
  assert.equal(unsolicited.delivery.finish().outcome, 'rejected');
});

test('ACT5 invalid, unavailable, and conflicting decisions never consume knowledge', () => {
  const cases = [
    { name: 'missing activity key', decision: stockReply },
    { name: 'extra unrecognized field', decision: { ...stockReply, activity: null, extra: true } },
    { name: 'unoffered intent', decision: { ...stockReply, activity: { intent: 'accompany', slots: { person: { kind: 'player' } } } } },
    { name: 'unverified slots', decision: { ...stockReply, activity: { intent: 'hold_position', slots: { destination: 'arbitrary' } } } },
    { name: 'parallel stock command', decision: { ...stockReply, command: 'DO WaitHere', activity: offer } },
    { name: 'control command in speech', decision: { dialogue: 'DO WaitHere', command: '', activity: null } },
    { name: 'runtime removed choice', decision: { ...stockReply, activity: offer },
      context: { act5Intents: ['hold_position'], act5Choices: { hold_position: [] } } },
  ];
  for (const scenario of cases) {
    const f = request();
    assert.throws(() => f.delivery.success(scenario.decision, scenario.context ?? act5),
      undefined, scenario.name);
    assert.deepEqual(f.acknowledgements, [], scenario.name);
    assert.equal(f.delivery.finish().outcome, 'rejected', scenario.name);
  }
});

test('ACT5 replies still fail closed when original knowledge loses its owner', () => {
  const f = request();
  f.retire();
  assert.throws(() => f.delivery.success({ ...stockReply, activity: null }, act5),
    { code: 'knowledge_request_stale', reason: 'superseded' });
  assert.deepEqual(f.acknowledgements, []);
  assert.equal(f.delivery.finish().outcome, 'expired');
  assert.deepEqual(f.acknowledgements,
    [['same-original-observation', 'ps4_context', 'expired']]);
});
