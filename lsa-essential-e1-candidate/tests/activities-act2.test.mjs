import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { ActivityEngine } from '../src/activities/activityEngine.mjs';
import { ActivityRuntime } from '../src/activities/activityRuntime.mjs';
import { ACT2_INTENTS, buildPlan } from '../src/activities/intentTemplates.mjs';
import { loadCapabilityRegistry } from '../src/activities/capabilityRegistry.mjs';
import { normalizeActivityConfig } from '../src/activities/contracts.mjs';

const registry = loadCapabilityRegistry();
const probes = ['Q1', 'F1', 'K1', 'R1', 'FR1', 'M1'];
const character = '11111111-1111-4111-8111-111111111111';
const encounter = '22222222-2222-4222-8222-222222222222';
const incarnation = '33333333-3333-4333-8333-333333333333';
const anchor = '44444444-4444-4444-8444-444444444444';
let clock = 1_000_000;
let serial = 0;
const id = () => `55555555-5555-4555-8555-${String(++serial).padStart(12, '0')}`;
const hello = { type: 'hello', nativeRun: '66666666-6666-4666-8666-666666666666', adapterEpoch: '77777777-7777-4777-8777-777777777777', capabilities: { hold_position: true, follow_person: true, resume_ambient: true, sit_on_ground: true } };

function setup(mode = 'on') {
  serial = 10; clock = 1_000_000;
  const commands = [];
  const engine = new ActivityEngine({ registry, config: normalizeActivityConfig({ mode, passedProbes: probes }), now: () => clock, id, onCommand: frame => commands.push(frame) });
  engine.noteHello(hello);
  return { engine, commands };
}
function proposal(intent, slots = {}) {
  return { proposalVersion: 1, proposalId: id(), source: 'player_ux', subject: { characterId: character }, intent, slots, priority: 'ambient', origin: {}, proposedAtMs: clock };
}
function binding() { return { characterId: character, ownerAlias: `promoted.${character}`, ownershipToken: id(), encounterId: encounter, incarnationId: incarnation }; }
function pump(engine, commands, decide) {
  let guard = 0;
  while (commands.length && guard++ < 30) {
    const frame = commands.shift();
    const reply = decide(frame);
    if (reply) engine.ingest(reply);
  }
}
function happy(engine, commands, extra = {}) {
  pump(engine, commands, frame => {
    if (frame.type === 'actor.acquire') return { type: 'actor.acquired', requestId: frame.requestId, encounterId: encounter, incarnationId: incarnation, leaseEpoch: 1 };
    if (frame.type === 'anchor.resolve') return { type: 'anchor.resolved', requestId: frame.requestId, results: frame.refs.map(ref => ({ role: ref.role, ref: extra.anchor || anchor, reason: null, label: 'here', distanceBand: 'at' })) };
    if (frame.type === 'step.preflight') return { type: 'step.preflighted', requestId: frame.requestId, verdicts: [], alreadySatisfied: extra.already === true, reason: extra.preflight || null };
    if (frame.type === 'step.begin') return extra.receipt ? { type: 'receipt', receipt: receipt(frame, extra.receipt) } : null;
    return null;
  });
}
function receipt(begin, patch) {
  return { executionId: begin.executionId, capability: begin.capability, reason: null, evidence: [], epochs: { nativeRun: hello.nativeRun, adapterEpoch: hello.adapterEpoch, leaseEpoch: begin.leaseEpoch }, milestones: { requestedGameMs: 10 }, state: 'DISPATCHED', ...patch };
}
function current(engine) { return engine.activities.find(item => item.actor.characterId === character); }

test('ACT2 templates are the four closed plans', () => {
  assert.deepEqual(ACT2_INTENTS, ['hold_position', 'accompany', 'resume_previous', 'sit_here']);
  const expected = { hold_position: 'hold_position', accompany: 'follow_person', resume_previous: 'resume_ambient', sit_here: 'sit_on_ground' };
  for (const intent of ACT2_INTENTS) {
    const plan = buildPlan(intent, intent === 'hold_position' ? { until: { kind: 'duration', bucket: 'short' } } : {}, { id, registry });
    assert.equal(plan.steps.length, 1);
    assert.equal(plan.steps[0].capability, expected[intent]);
    assert.equal(plan.onComplete, 'stay');
    assert.equal(buildPlan('board_vehicle', {}, { id, registry }), null);
  }
});

test('each ACT2 capability can be admitted and dispatched once', () => {
  for (const intent of ACT2_INTENTS) {
    const { engine, commands } = setup();
    assert.equal(engine.assign(proposal(intent), binding()).ok, true);
    happy(engine, commands, { receipt: { state: 'HANDLER_ACCEPTED', handlerResult: true } });
    const began = commands.concat().reverse().find(frame => frame.type === 'step.begin') || engine.activities.at(-1);
    assert.equal(current(engine).status, 'running');
    assert.equal(current(engine).steps[0].attempts, 1);
    assert.notEqual(current(engine).currentExecutionId, undefined);
    engine.ingest({ type: 'receipt', receipt: receipt({ executionId: current(engine).currentExecutionId, capability: current(engine).steps[0].capability, leaseEpoch: 1 }, { state: 'MODE_ESTABLISHED', modeHealth: 'healthy' }) });
    assert.equal(current(engine).steps[0].status, 'holding');
  }
});

test('preflight rejection, already satisfied, handler false and timeout stay bounded', () => {
  const rejected = setup();
  rejected.engine.assign(proposal('sit_here'), binding());
  happy(rejected.engine, rejected.commands, { preflight: 'on_foot_required' });
  assert.equal(current(rejected.engine).status, 'failed');
  assert.equal(current(rejected.engine).terminal.reason, 'on_foot_required');
  assert.equal(rejected.commands.some(frame => frame.type === 'step.begin'), false);

  const satisfied = setup();
  satisfied.engine.assign(proposal('hold_position'), binding());
  happy(satisfied.engine, satisfied.commands, { already: true });
  assert.equal(satisfied.commands.some(frame => frame.type === 'step.begin'), false);
  assert.equal(current(satisfied.engine).steps[0].status, 'holding');

  const refused = setup();
  refused.engine.assign(proposal('accompany'), binding());
  happy(refused.engine, refused.commands, { receipt: { state: 'FAILED', reason: 'handler_false' } });
  assert.equal(current(refused.engine).terminal.reason, 'handler_false');

  const timed = setup();
  timed.engine.assign(proposal('hold_position'), binding());
  happy(timed.engine, timed.commands, { receipt: { state: 'TIMED_OUT', reason: 'accept_timeout' } });
  assert.equal(current(timed.engine).status, 'running');
  clock += 1000;
  timed.engine.tick();
  happy(timed.engine, timed.commands, { receipt: { state: 'TIMED_OUT', reason: 'accept_timeout' } });
  assert.equal(current(timed.engine).terminal.reason, 'repeated_failure');
  assert.ok(current(timed.engine).budgets.executionsLeft >= 6);
});


test('ACT2 runtime continuously ticks the lifecycle engine', async () => {
  const pipe = new EventEmitter();
  pipe.write = () => {}; pipe.destroy = () => pipe.emit('close');
  const runtime = new ActivityRuntime(normalizeActivityConfig({ mode: 'on', passedProbes: probes }), { connect: () => pipe, registry, id });
  let ticks = 0;
  const original = runtime.engine.tick.bind(runtime.engine);
  runtime.engine.tick = (...args) => { ticks += 1; return original(...args); };
  runtime.start();
  await new Promise(resolve => setTimeout(resolve, 140));
  runtime.stop();
  assert.ok(ticks >= 1);
});

test('pause and resume mint a new execution and cancel stops only through the engine', () => {
  const { engine, commands } = setup();
  engine.assign(proposal('hold_position'), binding());
  happy(engine, commands, { receipt: { state: 'MODE_ESTABLISHED', modeHealth: 'healthy' } });
  const first = current(engine).currentExecutionId;
  assert.equal(engine.pause(character).ok, true);
  assert.equal(current(engine).status, 'paused');
  assert.equal(commands.at(-1).type === 'step.cancel' || commands.some(frame => frame.type === 'step.cancel' && frame.mode === 'detach'), true);
  commands.length = 0;
  assert.equal(engine.resume(character).ok, true);
  happy(engine, commands, { receipt: { state: 'HANDLER_ACCEPTED' } });
  assert.notEqual(current(engine).currentExecutionId, first);
  assert.equal(engine.cancel(character).status, 'cancelled');
  assert.ok(commands.some(frame => frame.type === 'step.cancel' && frame.mode === 'cancel_if_current'));
});

test('P2 follow, dismiss, reflex, mission, lease, reconnect, clock and stale targets end the activity', () => {
  const { engine, commands } = setup();
  engine.assign(proposal('accompany'), binding());
  happy(engine, commands, { receipt: { state: 'MODE_ESTABLISHED', modeHealth: 'healthy' } });
  const executionId = current(engine).currentExecutionId;
  engine.ingest({ type: 'receipt', receipt: receipt({ executionId, capability: 'follow_person', leaseEpoch: 1 }, { state: 'SUPERSEDED', reason: 'superseded_player', evidence: [{ detail: { externalCommand: 'p2_control' } }] }) });
  assert.equal(current(engine).status, 'superseded');
  assert.equal(engine.resume(character).reason, 'activity_not_paused');

  const dismissed = setup();
  dismissed.engine.assign(proposal('hold_position'), binding());
  happy(dismissed.engine, dismissed.commands, { receipt: { state: 'MODE_ESTABLISHED', modeHealth: 'healthy' } });
  dismissed.engine.ingest({ type: 'lease.changed', encounterId: encounter, leaseEpoch: 2, reason: 'retired' });
  assert.equal(current(dismissed.engine).terminal.reason, 'actor_retired');

  const reflex = setup();
  reflex.engine.assign(proposal('sit_here'), binding());
  happy(reflex.engine, reflex.commands, { receipt: { state: 'MODE_ESTABLISHED', modeHealth: 'healthy' } });
  reflex.engine.ingest({ type: 'actor.facts', encounterId: encounter, alive: true, injured: false, scripted: false, inDirectedInteraction: false, reflexActive: true, distanceBand: 'near', gameMs: 20 });
  assert.equal(current(reflex.engine).status, 'paused');
  reflex.engine.ingest({ type: 'actor.facts', encounterId: encounter, alive: true, injured: false, scripted: false, inDirectedInteraction: false, reflexActive: false, distanceBand: 'near', gameMs: 25 });
  reflex.engine.ingest({ type: 'actor.facts', encounterId: encounter, alive: true, injured: false, scripted: false, inDirectedInteraction: false, reflexActive: true, distanceBand: 'near', gameMs: 30 });
  assert.equal(current(reflex.engine).status, 'cancelled');

  const mission = setup();
  mission.engine.assign(proposal('hold_position'), binding());
  happy(mission.engine, mission.commands, { receipt: { state: 'MODE_ESTABLISHED', modeHealth: 'healthy' } });
  mission.engine.ingest({ type: 'actor.facts', encounterId: encounter, alive: true, injured: false, scripted: true, inDirectedInteraction: false, reflexActive: false, distanceBand: 'near', gameMs: 40 });
  assert.equal(current(mission.engine).status, 'paused');
  assert.equal(current(mission.engine).resumePolicy, 'explicit_only');

  const leased = setup();
  leased.engine.assign(proposal('hold_position'), binding());
  happy(leased.engine, leased.commands, { receipt: { state: 'HANDLER_ACCEPTED' } });
  leased.engine.ingest({ type: 'receipt', receipt: receipt({ executionId: current(leased.engine).currentExecutionId, capability: 'hold_position', leaseEpoch: 1 }, { state: 'DETACHED', reason: 'lease_lost' }) });
  assert.equal(current(leased.engine).status, 'paused');

  const restarted = setup();
  restarted.engine.assign(proposal('hold_position'), binding());
  happy(restarted.engine, restarted.commands, { receipt: { state: 'MODE_ESTABLISHED', modeHealth: 'healthy' } });
  restarted.engine.noteHello({ ...hello, clientRestart: true });
  assert.equal(current(restarted.engine).terminal.reason, 'lease_lost');

  const reset = setup();
  reset.engine.assign(proposal('hold_position'), binding());
  happy(reset.engine, reset.commands, { receipt: { state: 'MODE_ESTABLISHED', modeHealth: 'healthy' } });
  reset.engine.clockReset();
  assert.equal(current(reset.engine).terminal.reason, 'clock_reset');

  const stale = setup();
  stale.engine.assign(proposal('accompany'), binding());
  pump(stale.engine, stale.commands, frame => frame.type === 'actor.acquire' ? { type: 'nack', requestId: frame.requestId, reason: 'actor_retired' } : null);
  assert.equal(current(stale.engine).terminal.reason, 'actor_retired');

  const replaced = setup();
  replaced.engine.assign(proposal('accompany'), binding());
  pump(replaced.engine, replaced.commands, frame => {
    if (frame.type === 'actor.acquire') return { type: 'actor.acquired', requestId: frame.requestId, encounterId: encounter, incarnationId: incarnation, leaseEpoch: 1 };
    if (frame.type === 'anchor.resolve') return { type: 'anchor.resolved', requestId: frame.requestId, results: [{ role: 'target', ref: null, reason: 'target_retired', label: null, distanceBand: null }] };
    return null;
  });
  assert.equal(current(replaced.engine).terminal.reason, 'target_retired');
  assert.equal(replaced.commands.some(frame => frame.type === 'step.begin'), false);
});

test('history, deadlines and execution budgets are bounded', () => {
  const { engine, commands } = setup();
  for (let index = 0; index < 10; index++) {
    engine.assign(proposal('resume_previous'), binding());
    happy(engine, commands, { receipt: { state: 'FAILED', reason: 'handler_false' } });
    clock += 1000;
  }
  assert.equal(engine.historyFor(character).length, 8);
  assert.ok(engine.goals.goals.length <= 32);
  const limited = setup();
  limited.engine.assign(proposal('hold_position'), binding());
  happy(limited.engine, limited.commands, { receipt: { state: 'MODE_ESTABLISHED', modeHealth: 'healthy' } });
  clock += 3_600_001;
  limited.engine.tick();
  assert.equal(current(limited.engine).terminal.reason, 'goal_deadline');
  const off = setup('off');
  assert.equal(off.engine.assign(proposal('hold_position'), binding()).reason, 'capability_disabled');
  const shadow = new ActivityEngine({ registry, config: normalizeActivityConfig({ mode: 'shadow', passedProbes: probes }), now: () => clock, id });
  shadow.noteHello(hello);
  assert.equal(shadow.assign(proposal('hold_position'), binding()).reason, 'capability_disabled');
});

test('ACT2 execution sources do not call raw task natives or broad cancellation', async () => {
  const root = new URL('../../native/', import.meta.url);
  const files = ['activities/StepRunner.cs', 'activities/CompletionAdapters.cs', 'activities/PlaceTable.cs', 'activities/ActivityWorld.cs', 'promoted-characters/ActivityDispatch.cs'];
  const source = (await Promise.all(files.map(file => readFile(new URL(file, root), 'utf8')))).join('\n');
  for (const forbidden of ['TASK_', 'CLEAR_PED_TASKS', 'CLEAR_PED', 'CancelAll', 'ReleaseExclusiveControlForExternalSystem', 'SetControlledBrain']) assert.equal(source.includes(forbidden), false, forbidden);
  assert.match(source, /QueueNpcAction/);
  assert.match(source, /ClearFollowFlags/);
  assert.match(source, /StopFollowTarget/);
  assert.match(source, /StopSitOnGround/);
  assert.doesNotMatch(source, /NpcActions\.WaitHere|NpcActions\.FollowTarget|NpcActions\.ResumeActivity/);
});
