import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ActivityEngine } from '../src/activities/activityEngine.mjs';
import { ACT3_BLOCKED_INTENTS, ACT3_INTENTS, buildPlan, planSpec } from '../src/activities/intentTemplates.mjs';
import { outranks, validateAdmission } from '../src/activities/activityValidator.mjs';
import { loadCapabilityRegistry } from '../src/activities/capabilityRegistry.mjs';
import { ACT3_CAPABILITY_IDS, normalizeActivityConfig } from '../src/activities/contracts.mjs';
import { projectStatus } from '../src/activities/activityFacts.mjs';
import { projectActivityKnowledge } from '../src/activities/activityKnowledge.mjs';

const registry = loadCapabilityRegistry();
const IMPLEMENTED = ['stop_and_face', 'approach_person', 'walk_away_from', 'exit_vehicle', 'begin_driving', 'take_cover', 'enter_vehicle_seat', 'scenario_here', 'grab_item', 'clear_held_item'];
const ACT2 = ['hold_position', 'follow_person', 'resume_ambient', 'sit_on_ground'];
// config.passedProbes holds at most 12 ids, so the vehicle-seat probes are opted in on their own.
const probesFor = ids => [...new Set(ids.flatMap(id => registry.get(id).probes))];
const probes = probesFor([...ACT2, ...IMPLEMENTED.filter(item => !['enter_vehicle_seat', 'grab_item', 'clear_held_item', 'begin_driving'].includes(item))]);
const seatProbes = probesFor(['enter_vehicle_seat']);
assert.ok(probes.length <= 12 && seatProbes.length <= 12);
const character = '11111111-1111-4111-8111-111111111111';
const encounter = '22222222-2222-4222-8222-222222222222';
const incarnation = '33333333-3333-4333-8333-333333333333';
const playerRef = '44444444-4444-4444-8444-444444444444';
const vehicleRef = '99999999-9999-4999-8999-999999999999';
let clock = 1_000_000;
let serial = 0;
const id = () => `55555555-5555-4555-8555-${String(++serial).padStart(12, '0')}`;
const hello = { type: 'hello', nativeRun: '66666666-6666-4666-8666-666666666666', adapterEpoch: '77777777-7777-4777-8777-777777777777', capabilities: Object.fromEntries([...ACT2, ...IMPLEMENTED].map(key => [key, true])) };

function setup({ gate = IMPLEMENTED, mode = 'on', capabilities = hello.capabilities, passed = probes } = {}) {
  serial = 10; clock = 1_000_000;
  const commands = [];
  const engine = new ActivityEngine({ registry, config: normalizeActivityConfig({ mode, passedProbes: passed, act3Capabilities: gate }), now: () => clock, id, onCommand: frame => commands.push(frame) });
  engine.noteHello({ ...hello, capabilities });
  return { engine, commands };
}
const proposal = (intent, slots = {}) => ({ proposalVersion: 1, proposalId: id(), source: 'player_ux', subject: { characterId: character }, intent, slots, priority: 'ambient', origin: {}, proposedAtMs: clock });
const binding = () => ({ characterId: character, ownerAlias: `promoted.${character}`, ownershipToken: id(), encounterId: encounter, incarnationId: incarnation });
const current = engine => engine.activities.find(item => item.actor.characterId === character);
const receipt = (begin, patch) => ({ executionId: begin.executionId, capability: begin.capability, reason: null, evidence: [], epochs: { nativeRun: hello.nativeRun, adapterEpoch: hello.adapterEpoch, leaseEpoch: begin.leaseEpoch }, milestones: { requestedGameMs: 10 }, state: 'HANDLER_ACCEPTED', ...patch });

// Drives the native side by hand. `script` can answer each frame type.
function drive(engine, commands, script = {}) {
  const seen = [];
  let guard = 0;
  while (commands.length && guard++ < 60) {
    const frame = commands.shift();
    seen.push(frame);
    let reply = null;
    if (frame.type === 'actor.acquire') reply = { type: 'actor.acquired', requestId: frame.requestId, encounterId: encounter, incarnationId: incarnation, leaseEpoch: 1 };
    else if (frame.type === 'anchor.resolve') reply = script.anchors ? script.anchors(frame) : { type: 'anchor.resolved', requestId: frame.requestId, results: frame.refs.map(ref => ({ role: ref.role, ref: ref.role === 'vehicle' ? vehicleRef : playerRef, reason: null, label: ref.role === 'place' ? 'here' : null, distanceBand: 'near' })) };
    else if (frame.type === 'step.preflight') reply = script.preflight ? script.preflight(frame) : { type: 'step.preflighted', requestId: frame.requestId, verdicts: [], alreadySatisfied: false, reason: null };
    else if (frame.type === 'step.begin') reply = script.begin ? script.begin(frame) : null;
    if (reply) engine.ingest(reply);
  }
  return seen;
}
const lastBegin = seen => seen.filter(frame => frame.type === 'step.begin').at(-1);

test('config: ACT3 capabilities are off by default, closed and de-duplicated', () => {
  assert.equal(Object.hasOwn(normalizeActivityConfig({ mode: 'on' }), 'act3Capabilities'), false);
  assert.deepEqual(normalizeActivityConfig({ act3Capabilities: ['take_cover', 'take_cover', 'hold_position', 'rm -rf', 7] }).act3Capabilities, ['take_cover']);
  assert.equal(Object.hasOwn(normalizeActivityConfig({ act3Capabilities: 'take_cover' }), 'act3Capabilities'), false);
  assert.deepEqual(ACT3_CAPABILITY_IDS.filter(item => !registry.get(item) || registry.get(item).phase !== 'ACT3'), []);
});

test('gate: probes and hello alone never enable an ACT3 capability', () => {
  const { engine, commands } = setup({ gate: [] });
  const result = engine.assign(proposal('scenario_here', { scenario: 'smoke' }), binding());
  assert.deepEqual([result.ok, result.reason], [false, 'capability_disabled']);
  assert.equal(commands.length, 0);
  // Gate listing alone is not enough either: native must advertise the capability.
  const hidden = setup({ capabilities: { ...hello.capabilities, scenario_here: false } });
  assert.equal(hidden.engine.assign(proposal('scenario_here', { scenario: 'smoke' }), binding()).reason, 'capability_disabled');
  const off = setup({ mode: 'shadow' });
  assert.equal(off.engine.assign(proposal('scenario_here', { scenario: 'smoke' }), binding()).reason, 'capability_disabled');
});

test('gate: a multi-step plan needs every step enabled', () => {
  const partial = setup({ gate: ['approach_person'] });
  assert.equal(partial.engine.assign(proposal('approach_and_face'), binding()).reason, 'capability_disabled');
  const noAct2 = setup({ capabilities: { ...hello.capabilities, hold_position: false } });
  assert.equal(noAct2.engine.assign(proposal('exit_vehicle_and_hold'), binding()).reason, 'capability_disabled');
  const full = setup();
  assert.equal(full.engine.assign(proposal('approach_and_face'), binding()).ok, true);
});

test('unsupported and blocked intents get typed refusals, never a fake plan', () => {
  const { engine, commands } = setup();
  const reasons = [
    [proposal('scenario_at', { place: { kind: 'here' }, scenario: 'smoke' }), 'capability_unavailable'],
    [proposal('go_to_place', { place: { kind: 'here' } }), 'capability_disabled'],
    [proposal('vehicle_trip', { vehicle: { kind: 'player_vehicle' }, place: { kind: 'here' } }), 'capability_disabled'],
    [proposal('hang_out_with', { person: { kind: 'player' } }), 'capability_unavailable'],
    [proposal('move_to_and_hold', { place: { kind: 'here' } }), 'capability_disabled'],
    [proposal('scenario_here', { scenario: 'sit_bench' }), 'unsupported_combination'],
    [proposal('scenario_here'), 'unsupported_combination'],
    [proposal('ride_along', { seat: 'driver' }), 'unsupported_combination'],
    [proposal('approach_and_face', { person: { kind: 'turn_alias', alias: 'P001' } }), 'unsupported_combination'],
  ];
  for (const [item, reason] of reasons) assert.equal(engine.assign(item, binding()).reason, reason, item.intent);
  assert.equal(commands.length, 0);
  assert.deepEqual(Object.keys(ACT3_BLOCKED_INTENTS).sort(), ['hang_out_with', 'scenario_at']);
  assert.equal(buildPlan('scenario_at', {}, { id, registry }), null);
});

test('plans are closed templates composed of existing capabilities only', () => {
  const caps = intent => buildPlan(intent, intent === 'scenario_here' ? { scenario: 'phone' } : {}, { id, registry }).steps.map(step => step.capability);
  assert.deepEqual(caps('scenario_here'), ['scenario_here']);
  assert.deepEqual(caps('approach_and_face'), ['approach_person', 'stop_and_face']);
  assert.deepEqual(caps('board_vehicle'), ['enter_vehicle_seat']);
  assert.deepEqual(caps('ride_along'), ['enter_vehicle_seat']);
  assert.deepEqual(caps('exit_vehicle_and_hold'), ['exit_vehicle', 'hold_position']);
  assert.deepEqual(caps('leave_scene'), ['walk_away_from', 'resume_ambient']);
  assert.deepEqual(caps('take_cover_and_hold'), ['take_cover']);
  for (const intent of ACT3_INTENTS) {
    const plan = buildPlan(intent, intent === 'scenario_here' ? { scenario: 'lean' } : {}, { id, registry });
    for (const step of plan.steps) assert.equal(step.completion.adapter, registry.get(step.capability).adapter, `${intent} adapter matches the contract row`);
  }
  const seat = buildPlan('board_vehicle', { seat: 'rear' }, { id, registry }).steps[0];
  assert.equal(seat.args.seat, 'rear');
  assert.equal(buildPlan('board_vehicle', {}, { id, registry }).steps[0].args.seat, 'any_passenger');
  assert.equal(planSpec('scenario_here', { scenario: 'smoke' }).steps[0].args.scenario, 'smoke');
});

test('approach_and_face: only physical completion advances; acceptance does not', () => {
  const { engine, commands } = setup();
  assert.equal(engine.assign(proposal('approach_and_face'), binding()).ok, true);
  let seen = drive(engine, commands);
  const resolve = seen.find(frame => frame.type === 'anchor.resolve');
  assert.deepEqual(resolve.refs, [{ role: 'target', slot: { kind: 'player' } }]);
  const begin = lastBegin(seen);
  assert.equal(begin.capability, 'approach_person');
  assert.deepEqual(begin.args, { target: { kind: 'player', captureRef: playerRef } });
  engine.ingest({ type: 'receipt', receipt: receipt(begin, { state: 'HANDLER_ACCEPTED' }) });
  assert.equal(current(engine).cursor, 0);
  assert.equal(current(engine).steps[0].status, 'executing');
  assert.equal(commands.length, 0, 'acceptance queues nothing further');
  assert.equal(engine.facts.facts.some(fact => fact.kind === 'completed' || fact.kind === 'step_completed'), false);
  engine.ingest({ type: 'receipt', receipt: receipt(begin, { state: 'PHYSICALLY_COMPLETED' }) });
  assert.equal(current(engine).cursor, 1);
  seen = drive(engine, commands);
  assert.equal(seen[0].type, 'anchor.resolve', 'the next step resolves its own anchors');
  const second = lastBegin(seen);
  assert.equal(second.capability, 'stop_and_face');
  assert.notEqual(second.executionId, begin.executionId);
  engine.ingest({ type: 'receipt', receipt: receipt(second, { state: 'MODE_ESTABLISHED', predicate: 'satisfied', modeHealth: 'healthy' }) });
  assert.equal(current(engine).status, 'running');
  assert.equal(current(engine).steps[1].status, 'holding');
  // A late receipt for the finished first execution is stale and changes nothing.
  const before = engine.staleReceipts;
  engine.ingest({ type: 'receipt', receipt: receipt(begin, { state: 'FAILED', reason: 'approach_failed' }) });
  assert.equal(engine.staleReceipts, before + 1);
  assert.equal(current(engine).status, 'running');
});

test('a satisfied first step advances the plan instead of completing it', () => {
  const { engine, commands } = setup();
  engine.assign(proposal('approach_and_face'), binding());
  let asked = 0;
  const seen = drive(engine, commands, { preflight: frame => ({ type: 'step.preflighted', requestId: frame.requestId, verdicts: [], alreadySatisfied: frame.capability === 'approach_person' && ++asked === 1, reason: null }) });
  assert.equal(seen.filter(frame => frame.type === 'step.preflight').map(frame => frame.capability).join(), 'approach_person,stop_and_face');
  assert.equal(lastBegin(seen).capability, 'stop_and_face');
  assert.equal(current(engine).status, 'running');
  assert.equal(current(engine).steps[0].status, 'done');
});

test('exit_vehicle_and_hold and leave_scene resolve anchors per step', () => {
  const exit = setup();
  exit.engine.assign(proposal('exit_vehicle_and_hold', { until: { kind: 'duration', bucket: 'short' } }), binding());
  let seen = drive(exit.engine, exit.commands);
  assert.equal(seen.some(frame => frame.type === 'anchor.resolve'), false, 'exit_vehicle needs no anchor');
  const begin = lastBegin(seen);
  assert.equal(begin.capability, 'exit_vehicle');
  exit.engine.ingest({ type: 'receipt', receipt: receipt(begin, { state: 'PHYSICALLY_COMPLETED' }) });
  seen = drive(exit.engine, exit.commands);
  const resolve = seen.find(frame => frame.type === 'anchor.resolve');
  assert.deepEqual(resolve.refs[0].slot, { kind: 'place', place: { kind: 'here' } });
  const hold = lastBegin(seen);
  assert.equal(hold.capability, 'hold_position');
  assert.deepEqual(hold.args.place, { kind: 'place', placeRef: playerRef });
  assert.equal(hold.completion.until.kind, 'duration');

  const leave = setup();
  leave.engine.assign(proposal('leave_scene'), binding());
  seen = drive(leave.engine, leave.commands);
  const walk = lastBegin(seen);
  assert.equal(walk.capability, 'walk_away_from');
  leave.engine.ingest({ type: 'receipt', receipt: receipt(walk, { state: 'PHYSICALLY_COMPLETED' }) });
  seen = drive(leave.engine, leave.commands);
  assert.equal(lastBegin(seen).capability, 'resume_ambient');
});

test('board_vehicle binds the resolved vehicle and seat and completes only on seat occupancy', () => {
  const { engine, commands } = setup({ passed: seatProbes });
  engine.assign(proposal('board_vehicle', { vehicle: { kind: 'player_vehicle' }, seat: 'driver' }), binding());
  const seen = drive(engine, commands);
  assert.deepEqual(seen.find(frame => frame.type === 'anchor.resolve').refs, [{ role: 'vehicle', slot: { kind: 'player_vehicle' } }]);
  const begin = lastBegin(seen);
  assert.deepEqual(begin.args, { seat: 'driver', vehicle: { kind: 'capture', captureRef: vehicleRef } });
  engine.ingest({ type: 'receipt', receipt: receipt(begin, { state: 'HANDLER_ACCEPTED' }) });
  assert.equal(current(engine).status, 'running');
  engine.ingest({ type: 'receipt', receipt: receipt(begin, { state: 'PHYSICALLY_COMPLETED' }) });
  assert.equal(current(engine).status, 'completed');
});

test('stale or missing targets fail the activity with the native reason', () => {
  const stale = setup();
  stale.engine.assign(proposal('approach_and_face'), binding());
  drive(stale.engine, stale.commands, { anchors: frame => ({ type: 'anchor.resolved', requestId: frame.requestId, results: [{ role: 'target', ref: null, reason: 'target_invalid', label: null, distanceBand: null }] }) });
  assert.deepEqual([current(stale.engine).status, current(stale.engine).terminal.reason], ['failed', 'target_invalid']);
  const vehicle = setup({ passed: seatProbes });
  vehicle.engine.assign(proposal('board_vehicle'), binding());
  drive(vehicle.engine, vehicle.commands, { anchors: frame => ({ type: 'anchor.resolved', requestId: frame.requestId, results: [{ role: 'vehicle', ref: null, reason: 'vehicle_invalid', label: null, distanceBand: null }] }) });
  assert.deepEqual([current(vehicle.engine).status, current(vehicle.engine).terminal.reason], ['failed', 'vehicle_invalid']);
  // A target that retires mid-step is reported by native and ends the activity; it is never retried blindly.
  const mid = setup();
  mid.engine.assign(proposal('approach_and_face'), binding());
  const begin = lastBegin(drive(mid.engine, mid.commands));
  mid.engine.ingest({ type: 'receipt', receipt: receipt(begin, { state: 'CANCELLED', reason: 'target_retired' }) });
  assert.equal(['cancelled', 'failed'].includes(current(mid.engine).status), true);
  assert.equal(current(mid.engine).terminal.reason, 'target_retired');
});

test('failure receipts end the plan with the native reason and never advance', () => {
  const { engine, commands } = setup({ passed: seatProbes });
  engine.assign(proposal('board_vehicle'), binding());
  const begin = lastBegin(drive(engine, commands));
  engine.ingest({ type: 'receipt', receipt: receipt(begin, { state: 'FAILED', reason: 'vehicle_mismatch' }) });
  assert.deepEqual([current(engine).status, current(engine).terminal.reason], ['failed', 'vehicle_mismatch']);
  const walk = setup();
  walk.engine.assign(proposal('leave_scene'), binding());
  const started = lastBegin(drive(walk.engine, walk.commands));
  walk.engine.ingest({ type: 'receipt', receipt: receipt(started, { state: 'TIMED_OUT', reason: 'complete_timeout' }) });
  assert.equal(current(walk.engine).status, 'failed');
  assert.equal(current(walk.engine).cursor, 0, 'resume_ambient never runs after a failed walk away');
});

test('cancellation and supersession release the actor and never leave a second controller', () => {
  const { engine, commands } = setup();
  engine.assign(proposal('approach_and_face'), binding());
  const begin = lastBegin(drive(engine, commands));
  assert.equal(engine.cancel(character).ok, true);
  const sent = commands.splice(0);
  const cancel = sent.find(frame => frame.type === 'step.cancel');
  assert.deepEqual([cancel.executionId, cancel.mode], [begin.executionId, 'cancel_if_current']);
  assert.equal(sent.some(frame => frame.type === 'actor.release'), true);
  assert.equal(current(engine).status, 'cancelled');
  // A new assignment supersedes the live one and cancels only if still current.
  const next = setup();
  next.engine.assign(proposal('scenario_here', { scenario: 'smoke' }), binding());
  drive(next.engine, next.commands);
  next.engine.assign(proposal('take_cover_and_hold'), binding());
  const frames = next.commands.splice(0);
  assert.equal(frames.find(frame => frame.type === 'step.cancel').mode, 'cancel_if_current');
  assert.equal(next.engine.activities[0].status, 'superseded');
  assert.equal(next.engine.activities[0].terminal.reason, 'superseded_player');
});

test('ownership: p2 control and foreign supersession interrupt, they are never overridden', () => {
  const { engine, commands } = setup();
  engine.assign(proposal('approach_and_face'), binding());
  const begin = lastBegin(drive(engine, commands));
  engine.ingest({ type: 'receipt', receipt: receipt(begin, { state: 'SUPERSEDED', reason: 'superseded_essential', evidence: [{ kind: 'callback', strength: 'strong', detail: { externalCommand: 'p2_control' } }] }) });
  assert.equal(['superseded', 'cancelled'].includes(current(engine).status), true);
  assert.equal(commands.some(frame => frame.type === 'step.begin'), false, 'no dispatch after an external takeover');
  const lease = setup();
  lease.engine.assign(proposal('take_cover_and_hold'), binding());
  drive(lease.engine, lease.commands);
  lease.engine.ingest({ type: 'lease.changed', encounterId: encounter, leaseEpoch: 2, reason: 'p2_control' });
  assert.equal(lease.commands.some(frame => frame.type === 'step.begin'), false);
  assert.equal(['superseded', 'cancelled'].includes(current(lease.engine).status), true);
});

test('priority: a lower priority never outranks a higher one', () => {
  assert.equal(outranks('player_direct', 'director_routine'), true);
  assert.equal(outranks('director_routine', 'player_direct'), false);
  assert.equal(outranks('player_direct', 'player_direct'), false);
  assert.equal(outranks('ambient', 'player_standing'), false);
  const { engine } = setup();
  const live = engine.assign(proposal('take_cover_and_hold'), binding());
  assert.equal(live.ok, true);
  // Admission is player menu only; anything else is refused before touching a live activity.
  for (const source of ['player_dialogue', 'commitment', 'recovery', 'scene_director']) {
    const denied = engine.assign({ ...proposal('leave_scene'), source }, binding());
    assert.equal(denied.ok, false, source);
  }
  assert.equal(current(engine).status, 'admitting');
});

test('validator reports typed reasons for every ACT3 intent', () => {
  const ctx = { registry, mode: 'on', hello: hello.capabilities, passedProbes: probes, act3Capabilities: IMPLEMENTED };
  const ok = validateAdmission(proposal('leave_scene'), ctx);
  assert.deepEqual([ok.ok, ok.capabilities.join()], [true, 'walk_away_from,resume_ambient']);
  assert.equal(validateAdmission(proposal('leave_scene'), { ...ctx, passedProbes: [] }).reason, 'capability_disabled');
  assert.equal(validateAdmission(proposal('leave_scene'), { ...ctx, act3Capabilities: [] }).reason, 'capability_disabled');
  assert.equal(validateAdmission({ ...proposal('leave_scene'), source: 'scene_director' }, ctx).reason, 'policy_denied');
  assert.equal(validateAdmission(proposal('give_item_to_player'), ctx).reason, 'policy_denied');
});

test('status text, knowledge and registry aliases cover ACT3 without inventing completion', () => {
  const activity = { template: 'approach_and_face', status: 'running', cursor: 0, steps: [{ capability: 'approach_person' }], terminal: null };
  assert.equal(projectStatus(activity, null).phrase, 'Come over and face me: Running');
  const binding_ = { characterId: character, encounterId: encounter, incarnationId: incarnation, hostContext: { hostContextVersion: 1, hostRunId: id(), worldEpoch: 1 } };
  const fact = { factVersion: 1, factId: id(), characterId: character, activityId: id(), goalId: id(), kind: 'started', intent: 'leave_scene', evidence: 'handler_only', reason: null, placeLabel: null, atMs: 1, provenance: { ...binding_.hostContext, encounterId: encounter, incarnationId: incarnation } };
  const known = projectActivityKnowledge({ binding: binding_, facts: [fact], reason: null, ownerPendingProof: false });
  for (const item of known.facts) assert.equal(/undefined/.test(item.text), false);
  const unknown = projectActivityKnowledge({ binding: binding_, facts: [{ ...fact, intent: 'invent_a_task' }], reason: null, ownerPendingProof: false });
  assert.equal(unknown.facts.length, 0);
  assert.equal(registry.namesFor('enter_vehicle_seat').includes('EnterDriverSeatOfTargetVehicle'), true);
  assert.equal(registry.namesFor('grab_item').includes('GrabItem'), true);
});

test('ACT3 companion files add no raw GTA task calls or second executors', async () => {
  for (const name of ['intentTemplates.mjs', 'activityValidator.mjs', 'activityEngine.mjs']) {
    const text = await readFile(new URL(`../src/activities/${name}`, import.meta.url), 'utf8');
    for (const forbidden of ['TASK_', 'CLEAR_PED', 'CancelAll', 'SetControlledBrain', 'ReleaseExclusiveControl', 'QueueNpcAction', 'child_process']) assert.equal(text.includes(forbidden), false, `${name} contains ${forbidden}`);
  }
});
