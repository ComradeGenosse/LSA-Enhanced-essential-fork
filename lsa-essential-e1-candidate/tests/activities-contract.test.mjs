import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ACTIVITY_CAPABILITIES_SHA256, loadCapabilityRegistry, validateCapabilityDocument } from '../src/activities/capabilityRegistry.mjs';
import { CAPABILITY_IDS, LIMITS, normalizeActivityConfig, validateActivity, validateFact, validateFrame, validateGoal, validateProposal, validateReceipt, validateResumeToken, validateStep } from '../src/activities/contracts.mjs';
import { verifyActivitiesContract } from '../tools/verifyActivitiesContract.mjs';

const ids = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444','55555555-5555-4555-8555-555555555555','66666666-6666-4666-8666-666666666666'];
const step = () => ({ stepId: ids[3], capability: 'hold_position', kind: 'mode', args: {}, preconditions: ['actor_owned'], establishes: [], completion: { adapter: 'hold_mode', until: { kind: 'player_command' } }, abort: { onInterrupt: { player_command: 'cancel' }, violated: [] }, retry: { maxRetries: 1, retryOn: ['accept_timeout'], backoffMs: 500 }, alternatives: [], timeouts: { acceptMs: 2000, establishMs: 5000, completeMs: null, holdMaxMs: 1800000 }, resumable: true, resumeOn: ['player_command'], status: 'pending', attempts: 0 });
const proposal = () => ({ proposalVersion: 1, proposalId: ids[0], source: 'player_ux', subject: { characterId: ids[1] }, intent: 'hold_position', slots: { until: { kind: 'duration', bucket: 'short' } }, priority: 'player_direct', origin: {}, proposedAtMs: 10 });
const goal = () => ({ goalVersion: 1, goalId: ids[0], kind: 'instruction', subject: { characterId: ids[1] }, intent: 'hold_position', slots: {}, source: 'player_ux', priority: 'player_direct', status: 'accepted', resumePolicy: 'explicit_only', createdAtMs: 10, acceptedAtMs: 11, updatedAtMs: 12, deadlineAtMs: 10 + 3_600_000, activityIds: [ids[2]], terminalReason: null, commitmentId: null });
const activity = () => ({ activityVersion: 1, activityId: ids[2], goalId: ids[0], actor: { characterId: ids[1], encounterId: ids[4], ownerAlias: 'promoted.' + ids[1], ownershipToken: ids[5], incarnationId: ids[0] }, template: 'hold_position', planRevision: 0, steps: [step()], cursor: 0, status: 'running', source: 'player_ux', priority: 'player_direct', leaseId: ids[3], leaseEpoch: 1, budgets: { retriesLeft: 1, alternativesLeft: 2, replansLeft: 1, resumesLeft: 3, executionsLeft: 8 }, deadlines: { activityDeadlineGameMs: 1000, wallCapAtMs: 20 }, interrupt: null, executionIds: [], onComplete: 'stay', createdAtMs: 10, updatedAtMs: 12, terminal: null });
const receipt = (patch = {}) => ({ receiptVersion: 1, executionId: ids[0], activityId: ids[2], stepId: ids[3], attempt: 1, actorEncounterId: ids[4], capability: 'hold_position', essential: { path: 'queue', name: 'waithere' }, targets: [], epochs: { nativeRun: ids[0], adapterEpoch: ids[1], leaseEpoch: 1 }, state: 'HANDLER_ACCEPTED', modeHealth: null, predicate: 'not_yet', reason: null, handlerResult: true, milestones: { requestedGameMs: 1, validatedGameMs: 2, dispatchedGameMs: 3, acceptedGameMs: 4, establishedGameMs: null, completedGameMs: null, terminalGameMs: null }, evidence: [{ kind: 'handler_result', strength: 'weak', gameMs: 4, detail: null }], evidenceDropped: 0, sequence: 1, ...patch });
const token = () => ({ tokenVersion: 1, activityId: ids[2], planRevision: 0, cursor: 0, completedStepIds: [], anchors: [{ role: 'actor', ref: ids[4], incarnationId: ids[0] }], interrupt: 'player_command', pausedAtMs: 10, resumeNotBeforeMs: 10, resumeDeadlineMs: 10 + 120_000, resumeCount: 0, nativeRun: ids[0], adapterEpoch: ids[1] });
const fact = () => ({ factVersion: 1, factId: ids[0], characterId: ids[1], activityId: ids[2], goalId: ids[3], kind: 'started', intent: 'hold_position', placeLabel: null, evidence: 'none', reason: null, atMs: 10 });
const hello = () => ({ version: 1, type: 'hello', nativeRun: ids[0], adapterEpoch: ids[1], contractSha256: ACTIVITY_CAPABILITIES_SHA256, capabilities: Object.fromEntries(CAPABILITY_IDS.map(id => [id, false])), limits: { ...LIMITS } });
function rejectClosed(validate, value) {
  assert.equal(validate(value), true);
  assert.equal(validate({ ...value, extra: true }), false);
  for (const key of Object.keys(value)) { const missing = { ...value }; delete missing[key]; assert.equal(validate(missing), false, key); }
}

test('activity config defaults off and keeps ACT2 execution opt-in', () => {
  assert.equal(normalizeActivityConfig().mode, 'off');
  assert.equal(normalizeActivityConfig({ mode: 'shadow' }).mode, 'shadow');
  assert.equal(normalizeActivityConfig({ mode: 'on' }).mode, 'on');
  assert.deepEqual(normalizeActivityConfig({ mode: 'on' }).passedProbes, []);
  assert.equal(normalizeActivityConfig({ mode: 'on', dialogue: true }).dialogue, false);
  for (const mode of ['execute', 'context']) assert.equal(normalizeActivityConfig({ mode }).mode, 'off');
  assert.equal(normalizeActivityConfig({ mode: 'shadow', pipeName: '../bad' }).pipeName, 'LSA.Activities.v1');
});
test('capability registry is SHA pinned and excluded or never rows cannot be enabled', async () => {
  const bytes = await readFile(new URL('../../contracts/activity-capabilities.v1.json', import.meta.url));
  const registry = loadCapabilityRegistry(bytes);
  assert.equal(registry.rows.size, 23);
  assert.throws(() => loadCapabilityRegistry(Buffer.from(String(bytes).replace('hold_position', 'hold_positiox'))), /activity_contract_mismatch/);
  const document = JSON.parse(String(bytes));
  assert.ok(validateCapabilityDocument(document));
  for (const bad of [{ ...document, schemaVersion: 0 }, { ...document, extra: true }, { ...document, capabilities: document.capabilities.slice(1) }]) assert.equal(validateCapabilityDocument(bad), null);
  const enable = id => registry.enabled(id, { mode: 'on', hello: { [id]: true }, requested: [id], passedProbes: registry.get(id)?.probes || ['Q1'], source: 'player_ux', priority: 'player_direct' });
  assert.equal(enable('hold_position'), true);
  for (const id of ['chase_person', 'perform_activity', 'directed_interaction', 'attack', 'aim_at', 'flee_from']) assert.equal(enable(id), false);
  assert.equal(registry.enabled('hold_position', { mode: 'shadow', hello: { hold_position: true }, requested: ['hold_position'], passedProbes: ['Q1', 'FR1'] }), false);
  const contract = await verifyActivitiesContract();
  assert.equal(contract.available, true);
  assert.equal(contract.dispatch, false);
  assert.equal((await verifyActivitiesContract({ metadataText: '{}' })).available, false);
});
test('record validators accept the canonical shape and reject single-field mutations', () => {
  rejectClosed(validateProposal, proposal());
  rejectClosed(validateGoal, goal());
  rejectClosed(validateStep, step());
  rejectClosed(validateActivity, activity());
  rejectClosed(validateReceipt, receipt());
  rejectClosed(validateResumeToken, token());
  rejectClosed(validateFact, fact());
  rejectClosed(validateFrame, hello());
  assert.equal(validateProposal({ ...proposal(), source: 'model' }), false);
  assert.equal(validateProposal({ ...proposal(), proposalId: 'not-a-uuid' }), false);
  assert.equal(validateProposal({ ...proposal(), proposedAtMs: -1 }), false);
  assert.equal(validateProposal({ ...proposal(), proposedAtMs: 1.5 }), false);
  assert.equal(validateProposal({ ...proposal(), slots: { person: { kind: 'player' } } }), false);
  assert.equal(validateGoal({ ...goal(), kind: 'routine' }), false);
  assert.equal(validateGoal({ ...goal(), deadlineAtMs: goal().createdAtMs + 3_600_001 }), false);
  assert.equal(validateGoal({ ...goal(), activityIds: Array(5).fill(ids[2]) }), false);
  assert.equal(validateReceipt({ ...receipt(), state: 'PHYSICALLY_COMPLETED', reason: null, evidence: [{ kind: 'distance', strength: 'strong', gameMs: 4, detail: { distanceBand: 'at' } }] }), false);
  const finite = receipt({ capability: 'walk_to', state: 'PHYSICALLY_COMPLETED', reason: null, evidence: [{ kind: 'distance', strength: 'strong', gameMs: 4, detail: { distanceBand: 'at' } }] });
  assert.equal(validateReceipt(finite), true);
  assert.equal(validateReceipt({ ...finite, evidence: [{ kind: 'handler_result', strength: 'weak', gameMs: 4, detail: null }] }), false);
  assert.equal(validateReceipt({ ...receipt(), state: 'FAILED', reason: null }), false);
  assert.equal(validateReceipt({ ...receipt(), sequence: 0 }), false);
  assert.equal(validateFact({ ...fact(), kind: 'arrived', evidence: 'handler_only' }), false);
  assert.equal(validateFact({ ...fact(), kind: 'arrived', evidence: 'world_strong' }), true);
  assert.equal(validateFrame({ ...hello(), contractSha256: 'ab' }), false);
  assert.equal(validateFrame({ version: 1, type: 'lease', sequence: 1, leaseTtlMs: 5001 }), false);
  assert.equal(validateFrame({ version: 1, type: 'step.begin', sequence: 1, requestId: ids[0], executionId: ids[1], activityId: ids[2], stepId: ids[3], attempt: 1, encounterId: ids[4], leaseId: ids[5], leaseEpoch: 1, capability: 'hold_position', args: {}, timeouts: step().timeouts, completion: step().completion, violated: [], onLeaseLoss: 'detach' }), true);
});
test('native and companion capability pins are the same constant', async () => {
  const source = await readFile(new URL('../../native/activities/CapabilityTable.cs', import.meta.url), 'utf8');
  assert.match(source, new RegExp(`ContractSha256 = "${ACTIVITY_CAPABILITIES_SHA256}"`));
});
