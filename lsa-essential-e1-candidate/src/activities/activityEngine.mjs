import { randomUUID } from 'node:crypto';
import { validateActivity } from './contracts.mjs';
import { loadCapabilityRegistry } from './capabilityRegistry.mjs';
import { INTERRUPT_POLICY, buildPlan } from './intentTemplates.mjs';
import { validateAdmission } from './activityValidator.mjs';
import { GOAL_ATTEMPT_LIMIT, GOAL_DEADLINE_MS, GoalStore, makeGoal } from './goalStore.mjs';
import { ActivityFacts, projectStatus } from './activityFacts.mjs';
import { readHostContext, sameHostContext } from '../context/hostContext.mjs';

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'abandoned', 'expired', 'superseded']);
const RECEIPT_TERMINAL = new Set(['REJECTED', 'PHYSICALLY_COMPLETED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'TIMED_OUT', 'DETACHED']);
const BREAKER_REASONS = new Set(['handler_exception', 'queue_not_accepted', 'accept_timeout']);
const WALL_CAP_MS = 7_200_000;
const ACTIVITY_GAME_CAP = 3_600_000;
const QUIET_MS = 3_000;
const REFLEX_WINDOW_MS = 60_000;
const RESUME_DEADLINE_MS = 120_000;

const RECOVERY = Object.freeze({
  accept_timeout: 'retry_once', queue_not_accepted: 'retry_once', establish_timeout: 'retry_once',
  reflex_active: 'defer', vehicle_moving: 'defer',
  handler_false: 'abandon', handler_exception: 'abandon', state_blocked: 'abandon', role_blocked: 'abandon', policy_denied: 'abandon',
  target_invalid: 'abandon', target_retired: 'abandon', target_out_of_range: 'abandon', actor_retired: 'abandon', actor_dead: 'abandon', actor_injured: 'abandon',
  lease_lost: 'abandon', epoch_changed: 'abandon', clock_reset: 'abandon', budget_exhausted: 'abandon', repeated_failure: 'abandon',
  hold_limit: 'abandon', complete_timeout: 'abandon', activity_deadline: 'abandon', goal_deadline: 'abandon',
});

function unsignedElapsed(now, start) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(start)) return 0;
  return (now - start) >>> 0;
}

export class ActivityEngine {
  constructor({ registry = loadCapabilityRegistry(), config, now = () => Date.now(), id = randomUUID, onCommand = () => {}, onEvent = () => {} } = {}) {
    this.registry = registry;
    this.config = config || { mode: 'off', passedProbes: [] };
    this.now = now;
    this.id = id;
    this.onCommand = onCommand;
    this.onEvent = onEvent;
    this.goals = new GoalStore(now);
    this.facts = new ActivityFacts(id, now);
    this.activities = [];
    this.history = [];
    this.hello = null;
    this.hostContext = null;
    this.failures = [];
    this.breakerUntil = 0;
    this.staleReceipts = 0;
    this.byRequest = new Map();
    this.byExecution = new Map();
    this.lastGameMs = null;
  }

  get executing() { return this.config.mode === 'on'; }

  assign(proposal, binding) {
    const now = this.now();
    if (!this.executing) return this.#reject(proposal, 'capability_disabled');
    if (now < this.breakerUntil) return this.#reject(proposal, 'capability_disabled');
    if (!binding || binding.characterId !== proposal?.subject?.characterId || !binding.ownerAlias || !binding.ownershipToken) return this.#reject(proposal, 'actor_not_owned');
    const hello = this.hello?.capabilities || null;
    const admission = validateAdmission(proposal, { registry: this.registry, mode: this.config.mode, hello, passedProbes: this.config.passedProbes || [] });
    if (!admission.ok) return this.#reject(proposal, admission.reason);
    const characterId = proposal.subject.characterId;
    const live = this.#liveFor(characterId);
    if (live.length >= 1) this.#finish(live[0], 'superseded', 'superseded_player', now, 'cancel_if_current');
    if (this.#live().length >= 4) return this.#reject(proposal, 'activity_limit');
    const goal = makeGoal(admission.proposal, this.id, now);
    if (goal.activityIds.length >= GOAL_ATTEMPT_LIMIT) return this.#reject(proposal, 'budget_exhausted');
    const plan = buildPlan(proposal.intent, proposal.slots, { id: this.id, registry: this.registry });
    if (!plan) return this.#reject(proposal, 'capability_unavailable');
    const activity = this.#activity(goal, plan, binding, now);
    if (goal.activityIds.length > GOAL_ATTEMPT_LIMIT) return this.#reject(proposal, 'budget_exhausted');
    this.goals.add(goal);
    this.activities.push(activity);
    goal.activityIds.push(activity.activityId);
    goal.status = 'active';
    this.facts.record({ characterId, activityId: activity.activityId, goalId: goal.goalId, kind: 'instructed', intent: goal.intent, atMs: now });
    this.facts.record({ characterId, activityId: activity.activityId, goalId: goal.goalId, kind: 'accepted', intent: goal.intent, atMs: now });
    this.onEvent('activity_admitted', { activityId: activity.activityId, intent: goal.intent });
    this.#send('actor.acquire', { requestId: activity.acquireId, characterId, ownerAlias: binding.ownerAlias, ownershipToken: binding.ownershipToken, leaseId: activity.leaseId });
    return { ok: true, activityId: activity.activityId, goalId: goal.goalId };
  }

  pause(characterId) {
    const activity = this.#current(characterId);
    if (!activity) return { ok: false, reason: 'no_activity' };
    if (activity.status === 'paused') return { ok: true, status: 'paused' };
    if (TERMINAL.has(activity.status)) return { ok: false, reason: 'no_activity' };
    this.#pause(activity, 'player_command', this.now(), 'explicit_only', 'detach');
    return { ok: true, status: 'paused' };
  }

  resume(characterId) {
    const activity = this.#current(characterId);
    if (!activity || activity.status !== 'paused') return { ok: false, reason: 'activity_not_paused' };
    return this.#resume(activity, this.now(), true);
  }

  cancel(characterId) {
    const activity = this.#current(characterId);
    if (!activity || TERMINAL.has(activity.status)) return { ok: false, reason: 'no_activity' };
    this.#finish(activity, 'cancelled', 'cancelled_by_player', this.now(), 'cancel_if_current');
    return { ok: true, status: 'cancelled' };
  }

  status(characterId) {
    const activity = this.#current(characterId);
    const goal = activity && this.goals.get(activity.goalId);
    return { ...projectStatus(activity, goal), history: this.historyFor(characterId) };
  }

  historyFor(characterId) { return this.history.filter(item => item.characterId === characterId).slice(-8); }

  noteHello(frame) {
    if(frame.clientRestart) {
      for(const activity of this.#live()) this.#finish(activity,'abandoned','lease_lost',this.now(),'detach',false);
      this.hello=null;return;
    }
    const context=readHostContext(frame);
    if((this.hostContext || context) && !sameHostContext(this.hostContext,context)) this.#resetWorld();
    this.hostContext=context;
    const changed = this.hello && frame.nativeRun !== this.hello.nativeRun;
    if (this.hello && (frame.nativeRun !== this.hello.nativeRun || frame.adapterEpoch !== this.hello.adapterEpoch || frame.clientRestart)) {
      for (const activity of this.#live()) this.#finish(activity, 'abandoned', frame.nativeRun !== this.hello.nativeRun ? 'epoch_changed' : 'lease_lost', this.now(), 'detach');
    }
    this.hello = { nativeRun: frame.nativeRun, adapterEpoch: frame.adapterEpoch, capabilities: frame.capabilities || {} };
    if (changed) this.failures = [];
  }

  ingest(frame) {
    if (!frame || typeof frame !== 'object') return;
    if (frame.type === 'hello' && frame.nativeRun) { this.noteHello(frame); return; }
    if(frame.type==='world_epoch') {
      if(this.hostContext && frame.epoch===this.hostContext.worldEpoch+1) {
        this.#resetWorld();this.hostContext=Object.freeze({...this.hostContext,worldEpoch:frame.epoch});this.hello=null;
      }
      return;
    }
    if (frame.type === 'actor.acquired') return this.#onAcquire(frame);
    if (frame.type === 'nack') return this.#onNack(frame);
    if (frame.type === 'anchor.resolved') return this.#onAnchors(frame);
    if (frame.type === 'step.preflighted') return this.#onPreflight(frame);
    if (frame.type === 'ack') return;
    if (frame.type === 'receipt') return this.#onReceipt(frame.receipt);
    if (frame.type === 'lease.changed') return this.#onLease(frame);
    if (frame.type === 'actor.facts') return this.#onFacts(frame);
  }
  #resetWorld() {
    for(const activity of this.#live()) this.#finish(activity,'abandoned','epoch_changed',this.now(),'detach',false);
    this.goals=new GoalStore(this.now);this.activities=[];this.history=[];this.facts.facts=[];
    this.byRequest.clear();this.byExecution.clear();this.failures=[];this.lastGameMs=null;
  }

  tick(gameMs = null) {
    if (gameMs == null) gameMs = this.lastGameMs;
    const now = this.now();
    for (const activity of this.activities.filter(item => !TERMINAL.has(item.status))) {
      const goal = this.goals.get(activity.goalId);
      if (goal && now >= goal.deadlineAtMs) { this.#finish(activity, 'expired', 'goal_deadline', now, 'cancel_if_current'); continue; }
      if (now >= activity.deadlines.wallCapAtMs) { this.#finish(activity, 'expired', 'activity_deadline', now, 'cancel_if_current'); continue; }
      if (gameMs != null && activity.gameStart != null && unsignedElapsed(gameMs, activity.gameStart) >= ACTIVITY_GAME_CAP && unsignedElapsed(gameMs, activity.gameStart) < 0x80000000) {
        this.#finish(activity, 'expired', 'activity_deadline', now, 'cancel_if_current'); continue;
      }
      if (activity.status === 'paused') this.#tickPaused(activity, now);
      else if (activity.deferUntil && now >= activity.deferUntil) { activity.deferUntil = 0; this.#preflight(activity); }
      else this.#tickUntil(activity, now);
    }
  }

  clockReset() {
    for (const activity of this.#live()) this.#finish(activity, 'abandoned', 'clock_reset', this.now(), 'detach');
  }

  #reject(proposal, reason) {
    this.onEvent('activity_rejected', { intent: proposal?.intent, reason });
    return { ok: false, reason };
  }

  #activity(goal, plan, binding, now) {
    const activity = {
      activityVersion: 1, activityId: this.id(), goalId: goal.goalId,
      actor: { characterId: binding.characterId, encounterId: binding.encounterId || this.id(), ownerAlias: binding.ownerAlias, ownershipToken: binding.ownershipToken, incarnationId: binding.incarnationId || this.id() },
      template: plan.template, planRevision: 0, steps: plan.steps, cursor: 0, status: 'admitting', source: 'player_ux', priority: 'player_direct',
      leaseId: this.id(), leaseEpoch: 0,
      budgets: { retriesLeft: 1, alternativesLeft: 2, replansLeft: 1, resumesLeft: 3, executionsLeft: 8 },
      deadlines: { activityDeadlineGameMs: 0, wallCapAtMs: now + WALL_CAP_MS },
      interrupt: null, executionIds: [], onComplete: plan.onComplete, onLeaseLoss: plan.onLeaseLoss,
      createdAtMs: now, updatedAtMs: now, terminal: null,
      acquireId: this.id(), anchors: {}, seen: {}, failureKeys: {}, reflexCount: 0, resumeCount: 0, deferred: false,
      deferUntil: 0, quietSince: 0, asked: null, gameStart: null, holdingSince: null, playerWasFar: false,
    };
    this.byRequest.set(activity.acquireId, { activity, kind: 'acquire' });
    return activity;
  }

  #send(type, fields) {
    const frame = { version: 1, type, ...fields };
    this.onCommand(frame);
    return frame;
  }

  #onNack(frame) {
    const pending = this.byRequest.get(frame.requestId);
    if (!pending) return;
    this.byRequest.delete(frame.requestId);
    if (TERMINAL.has(pending.activity.status)) return;
    this.#finish(pending.activity, 'failed', frame.reason || (pending.kind === 'acquire' ? 'actor_unavailable' : 'capability_unavailable'), this.now(), 'detach');
  }

  #onAcquire(frame) {
    const pending = this.byRequest.get(frame.requestId);
    if (!pending || pending.kind !== 'acquire') return;
    const activity = pending.activity;
    this.byRequest.delete(frame.requestId);
    if (TERMINAL.has(activity.status)) return;
    if (frame.type === 'nack') return this.#finish(activity, 'failed', frame.reason || 'actor_unavailable', this.now(), 'detach');
    if (activity.actor.incarnationId && activity.knownIncarnation && frame.incarnationId !== activity.knownIncarnation) {
      return this.#finish(activity, 'failed', 'actor_retired', this.now(), 'detach');
    }
    activity.actor.encounterId = frame.encounterId;
    activity.actor.incarnationId = frame.incarnationId;
    activity.knownIncarnation = frame.incarnationId;
    activity.leaseEpoch = frame.leaseEpoch;
    const step = activity.steps[activity.cursor];
    const refs = step.needs || [];
    if (refs.length === 0) return this.#preflight(activity);
    const requestId = this.id();
    this.byRequest.set(requestId, { activity, kind: 'anchor', refs });
    this.#send('anchor.resolve', { requestId, encounterId: activity.actor.encounterId, leaseId: activity.leaseId, refs });
  }

  #onAnchors(frame) {
    const pending = this.byRequest.get(frame.requestId);
    if (!pending || pending.kind !== 'anchor') return;
    this.byRequest.delete(frame.requestId);
    const activity = pending.activity;
    if (TERMINAL.has(activity.status)) return;
    const step = activity.steps[activity.cursor];
    for (const result of frame.results || []) {
      if (!result.ref) return this.#finish(activity, 'failed', result.reason || 'place_unresolved', this.now(), 'detach');
      const previous = activity.anchors[result.role];
      if (previous && previous.ref !== result.ref) return this.#finish(activity, 'failed', 'target_changed', this.now(), 'detach');
      activity.anchors[result.role] = { ref: result.ref, label: result.label || null, incarnationId: activity.actor.incarnationId };
      if (result.role === 'place') step.args = { ...step.args, place: { kind: 'place', placeRef: result.ref } };
      const requested = (pending.refs || []).find(item => item.role === result.role);
      if (result.role === 'target') step.args = { ...step.args, target: requested?.slot?.kind === 'player' ? { kind: 'player', captureRef: result.ref } : { kind: 'capture', captureRef: result.ref } };
      if (result.label) activity.placeLabel = result.label;
    }
    this.#preflight(activity);
  }

  #preflight(activity) {
    if (TERMINAL.has(activity.status) || activity.budgets.executionsLeft <= 0) {
      if (!TERMINAL.has(activity.status)) this.#finish(activity, 'failed', 'budget_exhausted', this.now(), 'detach');
      return;
    }
    const step = activity.steps[activity.cursor];
    step.status = 'preflight';
    const requestId = this.id();
    this.byRequest.set(requestId, { activity, kind: 'preflight' });
    this.#send('step.preflight', { requestId, encounterId: activity.actor.encounterId, leaseId: activity.leaseId, capability: step.capability, args: step.args, preconditions: step.preconditions });
  }

  #onPreflight(frame) {
    const pending = this.byRequest.get(frame.requestId);
    if (!pending || pending.kind !== 'preflight') return;
    this.byRequest.delete(frame.requestId);
    const activity = pending.activity;
    if (TERMINAL.has(activity.status)) return;
    const now = this.now();
    if (frame.alreadySatisfied) return this.#already(activity, now);
    if (frame.reason) return this.#recover(activity, frame.reason, now);
    this.#begin(activity, now);
  }

  #already(activity, now) {
    const step = activity.steps[activity.cursor];
    this.facts.record({ characterId: activity.actor.characterId, activityId: activity.activityId, goalId: activity.goalId, kind: 'mode_established', intent: activity.template, evidence: 'mode_flag', atMs: now });
    if (step.kind === 'finite' || step.kind === 'instant' || this.#untilMet(activity, now)) {
      step.status = 'done';
      return this.#finish(activity, 'completed', 'already_satisfied', now, 'detach');
    }
    step.status = 'holding';
    activity.status = 'running';
    activity.holdingSince = now;
    activity.updatedAtMs = now;
  }

  #begin(activity, now) {
    const step = activity.steps[activity.cursor];
    if (activity.budgets.executionsLeft <= 0) return this.#finish(activity, 'failed', 'budget_exhausted', now, 'detach');
    const executionId = this.id();
    activity.budgets.executionsLeft -= 1;
    step.attempts += 1;
    step.status = 'executing';
    activity.status = activity.status === 'resuming' ? 'running' : 'running';
    activity.executionIds.push(executionId);
    if (activity.executionIds.length > 16) activity.executionIds.shift();
    activity.currentExecutionId = executionId;
    this.byExecution.set(executionId, activity);
    const requestId = this.id();
    this.byRequest.set(requestId, { activity, kind: 'begin' });
    this.#send('step.begin', {
      requestId, executionId, activityId: activity.activityId, stepId: step.stepId, attempt: step.attempts,
      encounterId: activity.actor.encounterId, leaseId: activity.leaseId, leaseEpoch: activity.leaseEpoch,
      capability: step.capability, args: step.args, timeouts: step.timeouts, completion: step.completion,
      violated: step.abort.violated, onLeaseLoss: activity.onLeaseLoss,
    });
    this.facts.record({ characterId: activity.actor.characterId, activityId: activity.activityId, goalId: activity.goalId, kind: 'started', intent: activity.template, atMs: now });
    this.onEvent('activity_step_started', { activityId: activity.activityId, intent: activity.template, capability: step.capability, stepIndex: activity.cursor });
    activity.updatedAtMs = now;
  }

  #onReceipt(receipt) {
    if (!receipt) return;
    const activity = this.byExecution.get(receipt.executionId);
    if (!activity || activity.currentExecutionId !== receipt.executionId) { this.staleReceipts += 1; this.onEvent('activity_receipt', { receiptState: 'stale_receipt' }); return; }
    if (receipt.epochs && (receipt.epochs.leaseEpoch !== activity.leaseEpoch || (this.hello && (receipt.epochs.nativeRun !== this.hello.nativeRun || receipt.epochs.adapterEpoch !== this.hello.adapterEpoch)))) {
      this.staleReceipts += 1; return;
    }
    const now = this.now();
    if (receipt.milestones?.requestedGameMs != null) {
      this.lastGameMs = receipt.milestones.requestedGameMs;
      if (activity.gameStart == null) activity.gameStart = receipt.milestones.requestedGameMs;
      else if (unsignedElapsed(receipt.milestones.requestedGameMs, activity.gameStart) > 0xf0000000) return this.clockReset();
    }
    activity.updatedAtMs = now;
    const step = activity.steps[activity.cursor];
    this.onEvent('activity_receipt', { activityId: activity.activityId, capability: receipt.capability, receiptState: receipt.state, reason: receipt.reason });
    if (receipt.state === 'HANDLER_ACCEPTED' || receipt.state === 'VALIDATED' || receipt.state === 'DISPATCHED') { step.status = 'executing'; activity.status = 'running'; return; }
    if (receipt.state === 'MODE_ESTABLISHED') {
      step.status = 'holding'; activity.status = 'running'; activity.holdingSince = activity.holdingSince || now;
      this.facts.record({ characterId: activity.actor.characterId, activityId: activity.activityId, goalId: activity.goalId, kind: 'mode_established', intent: activity.template, evidence: receipt.predicate === 'satisfied' ? 'world_strong' : 'mode_flag', atMs: now });
      if (receipt.modeHealth === 'lost') return this.#recover(activity, 'no_progress', now);
      if (step.kind === 'finite_then_mode' && receipt.predicate === 'satisfied') return this.#advance(activity, now, 'world_strong');
      return;
    }
    if (receipt.state === 'PHYSICALLY_COMPLETED') return this.#advance(activity, now, 'world_strong');
    if (receipt.state === 'REJECTED' && receipt.reason === 'already_satisfied') return this.#already(activity, now);
    if (receipt.state === 'SUPERSEDED') return this.#interrupt(activity, this.#kind(receipt), now);
    if (receipt.state === 'CANCELLED') {
      if (activity.asked === 'pause') return;
      if (activity.asked === 'cancel' || activity.asked === 'finish') return;
      return this.#interrupt(activity, this.#kind(receipt), now);
    }
    if (receipt.state === 'DETACHED') {
      if (activity.asked === 'pause' || activity.asked === 'finish') return;
      if (this.#untilMet(activity, now)) return this.#advance(activity, now, 'mode_flag');
      return this.#interrupt(activity, receipt.reason === 'lease_lost' ? 'lease_lost' : this.#kind(receipt), now);
    }
    if (RECEIPT_TERMINAL.has(receipt.state)) return this.#recover(activity, receipt.reason || 'handler_false', now);
  }

  #kind(receipt) {
    const external = (receipt.evidence || []).map(item => item.detail?.externalCommand).find(Boolean);
    if (receipt.reason === 'superseded_player' || external === 'p2_control' || external === 'player_turn') return 'player_command';
    if (receipt.reason === 'superseded_reflex' || external === 'reflex') return 'reflex';
    if (receipt.reason === 'scripted_state' || external === 'scripted_state') return 'scripted_state';
    if (receipt.reason === 'directed_interaction') return 'directed_interaction';
    if (receipt.reason === 'clock_reset') return 'clock_reset';
    if (receipt.reason === 'lease_lost') return 'lease_lost';
    if (receipt.reason === 'actor_retired' || receipt.reason === 'epoch_changed') return 'ownership_change';
    if (receipt.reason === 'target_retired' || receipt.reason === 'target_out_of_range') return 'target_lost';
    if (receipt.reason === 'actor_dead') return 'death';
    if (receipt.reason === 'actor_injured') return 'injury';
    if (receipt.reason === 'control_released' || receipt.reason === 'far_release') return 'control_released';
    return 'superseded_external';
  }

  #interrupt(activity, kind, now) {
    if (TERMINAL.has(activity.status)) return;
    if (kind === 'reflex') activity.reflexCount += 1;
    const action = activity.reflexCount >= 2 && kind === 'reflex' ? 'cancel' : (activity.steps[activity.cursor].abort.onInterrupt[kind] || 'cancel');
    const policy = INTERRUPT_POLICY[kind] || 'never';
    if (action === 'pause' && policy !== 'never') return this.#pause(activity, kind, now, policy, 'detach');
    const reason = kind === 'player_command' ? 'superseded_player' : kind === 'death' ? 'actor_dead' : kind === 'injury' ? 'actor_injured' : kind === 'ownership_change' ? 'actor_retired' : kind === 'target_lost' ? 'target_retired' : kind === 'clock_reset' ? 'clock_reset' : kind === 'lease_lost' ? 'lease_lost' : kind === 'control_released' ? 'control_released' : 'preempted';
    const status = action === 'fail' || kind === 'death' ? 'failed' : kind === 'player_command' ? 'superseded' : 'cancelled';
    this.#finish(activity, status, reason, now, 'detach');
  }

  #pause(activity, kind, now, policy, mode) {
    if (TERMINAL.has(activity.status) || activity.status === 'paused') return;
    activity.status = 'paused';
    activity.asked = 'pause';
    activity.quietSince = 0;
    const step = activity.steps[activity.cursor];
    const token = step.resumable ? {
      tokenVersion: 1, activityId: activity.activityId, planRevision: activity.planRevision, cursor: activity.cursor,
      completedStepIds: activity.steps.filter(item => item.status === 'done').map(item => item.stepId),
      anchors: Object.entries(activity.anchors).map(([role, anchor]) => ({ role: role === 'place' ? 'place' : role === 'target' ? 'target' : 'actor', ref: anchor.ref, incarnationId: anchor.incarnationId })),
      interrupt: kind, pausedAtMs: now, resumeNotBeforeMs: now, resumeDeadlineMs: now + RESUME_DEADLINE_MS, resumeCount: activity.resumeCount,
      nativeRun: this.hello?.nativeRun || activity.actor.encounterId, adapterEpoch: this.hello?.adapterEpoch || activity.actor.encounterId,
    } : null;
    activity.interrupt = { kind, atMs: now, token };
    activity.resumePolicy = policy;
    if (activity.currentExecutionId) this.#send('step.cancel', { requestId: this.id(), executionId: activity.currentExecutionId, mode });
    this.facts.record({ characterId: activity.actor.characterId, activityId: activity.activityId, goalId: activity.goalId, kind: 'paused', intent: activity.template, reason: null, atMs: now });
    this.onEvent('activity_paused', { activityId: activity.activityId, intent: activity.template });
    const goal = this.goals.get(activity.goalId);
    if (goal) { goal.status = 'suspended'; goal.updatedAtMs = now; }
  }

  #resume(activity, now, explicit) {
    const token = activity.interrupt?.token;
    const policy = activity.resumePolicy || 'explicit_only';
    if (!explicit && policy === 'explicit_only') return { ok: false, reason: 'activity_not_paused' };
    if (!explicit && policy === 'never') return this.#finish(activity, 'cancelled', 'preempted', now, 'detach'), { ok: false, reason: 'preempted' };
    if (!token || !activity.steps[activity.cursor].resumable) return this.#finish(activity, 'failed', 'epoch_changed', now, 'detach'), { ok: false, reason: 'epoch_changed' };
    if (this.hello && (token.nativeRun !== this.hello.nativeRun || token.adapterEpoch !== this.hello.adapterEpoch)) return this.#finish(activity, 'failed', 'epoch_changed', now, 'detach'), { ok: false, reason: 'epoch_changed' };
    if (now > token.resumeDeadlineMs || activity.resumeCount >= 3 || activity.budgets.resumesLeft <= 0 || activity.budgets.executionsLeft <= 0) {
      return this.#finish(activity, 'expired', now > token.resumeDeadlineMs ? 'activity_deadline' : 'budget_exhausted', now, 'detach'), { ok: false, reason: 'budget_exhausted' };
    }
    activity.resumeCount += 1;
    activity.budgets.resumesLeft -= 1;
    token.resumeCount = activity.resumeCount;
    activity.status = 'resuming';
    activity.asked = null;
    activity.currentExecutionId = null;
    this.facts.record({ characterId: activity.actor.characterId, activityId: activity.activityId, goalId: activity.goalId, kind: 'resumed', intent: activity.template, atMs: now });
    this.onEvent('activity_resumed', { activityId: activity.activityId, intent: activity.template });
    const goal = this.goals.get(activity.goalId);
    if (goal) { goal.status = 'active'; goal.updatedAtMs = now; }
    this.#preflight(activity);
    return { ok: true, status: 'resuming' };
  }

  #tickPaused(activity, now) {
    const token = activity.interrupt?.token;
    if (token && now > token.resumeDeadlineMs) return this.#finish(activity, 'expired', 'activity_deadline', now, 'detach');
    const policy = activity.resumePolicy;
    if (policy !== 'auto' && policy !== 'auto_if_quiet') return;
    const kind = activity.interrupt?.kind;
    if (kind === 'reflex' && now - activity.interrupt.atMs > REFLEX_WINDOW_MS) return this.#finish(activity, 'cancelled', 'superseded_reflex', now, 'detach');
    if (!activity.quietSince) activity.quietSince = now;
    if (now - activity.quietSince < QUIET_MS) return;
    const result = this.#resume(activity, now, false);
    if (!result.ok && activity.steps[activity.cursor].status === 'failed') return;
  }

  #tickUntil(activity, now) {
    const step = activity.steps[activity.cursor];
    if (step?.status !== 'holding' || !this.#untilMet(activity, now)) return;
    this.#advance(activity, now, 'mode_flag');
  }

  #untilMet(activity, now) {
    const until = activity.steps[activity.cursor]?.completion?.until;
    if (!until) return false;
    if (until.kind === 'player_command') return false;
    if (until.kind === 'duration') {
      const bucket = until.bucket === 'short' ? 60_000 : until.bucket === 'medium' ? 180_000 : 600_000;
      const held = activity.holdingSince ? now - activity.holdingSince : 0;
      return held >= bucket;
    }
    if (until.kind === 'player_returns') return activity.playerReturned === true;
    return false;
  }

  #advance(activity, now, evidence) {
    const step = activity.steps[activity.cursor];
    step.status = 'done';
    this.facts.record({ characterId: activity.actor.characterId, activityId: activity.activityId, goalId: activity.goalId, kind: evidence === 'world_strong' ? 'completed' : 'step_completed', intent: activity.template, evidence: evidence === 'world_strong' ? 'world_strong' : 'mode_flag', placeLabel: activity.placeLabel || null, atMs: now });
    if (activity.cursor >= activity.steps.length - 1) return this.#finish(activity, 'completed', 'already_satisfied', now, 'detach');
    activity.cursor += 1;
    this.#preflight(activity);
  }

  #recover(activity, reason, now) {
    const step = activity.steps[activity.cursor];
    const key = `${step.capability}:${reason}`;
    activity.failureKeys[key] = (activity.failureKeys[key] || 0) + 1;
    if (activity.failureKeys[key] >= 2) return this.#finish(activity, 'failed', 'repeated_failure', now, 'cancel_if_current');
    if (BREAKER_REASONS.has(reason)) {
      this.failures.push(now);
      this.failures = this.failures.filter(at => now - at <= 120_000);
      if (this.failures.length >= 5) { this.breakerUntil = now + 60_000; this.onEvent('activity_breaker_tripped', {}); }
    }
    if (reason === 'already_satisfied') return this.#already(activity, now);
    if ((reason === 'scripted_state' || reason === 'directed_interaction') && activity.status !== 'paused') return this.#pause(activity, reason === 'scripted_state' ? 'scripted_state' : 'directed_interaction', now, 'explicit_only', 'detach');
    const action = RECOVERY[reason] || 'abandon';
    if (action === 'retry_once' && activity.budgets.retriesLeft > 0 && step.retry.retryOn.includes(reason)) {
      activity.budgets.retriesLeft -= 1;
      activity.deferUntil = now + Math.min(5000, Math.max(500, step.retry.backoffMs));
      activity.currentExecutionId = null;
      return;
    }
    if (action === 'defer' && !activity.deferred) {
      activity.deferred = true;
      activity.deferUntil = now + (reason === 'vehicle_moving' ? 5000 : 10_000);
      return;
    }
    if ((reason === 'complete_timeout' || reason === 'hold_limit') && this.#untilMet(activity, now)) return this.#advance(activity, now, 'mode_flag');
    this.#finish(activity, 'failed', reason, now, 'cancel_if_current');
  }

  #onLease(frame) {
    const activity = this.activities.find(item => item.actor.encounterId === frame.encounterId && !TERMINAL.has(item.status));
    if (!activity) return;
    activity.leaseEpoch = frame.leaseEpoch;
    if (frame.reason === 'p2_control') this.#interrupt(activity, 'player_command', this.now());
    else if (frame.reason === 'retired') this.#finish(activity, 'abandoned', 'actor_retired', this.now(), 'detach');
    else if (frame.reason === 'released') this.#interrupt(activity, 'control_released', this.now());
    else this.#interrupt(activity, 'superseded_external', this.now());
  }

  #onFacts(frame) {
    const activity = this.activities.find(item => item.actor.encounterId === frame.encounterId && !TERMINAL.has(item.status));
    if (!activity) return;
    const now = this.now();
    if (frame.gameMs != null) this.lastGameMs = frame.gameMs;
    if (frame.gameMs != null && activity.gameStart != null && unsignedElapsed(frame.gameMs, activity.gameStart) > 0xf0000000) return this.clockReset();
    if (activity.gameStart == null && frame.gameMs != null) activity.gameStart = frame.gameMs;
    if (!frame.alive) return this.#interrupt(activity, 'death', now);
    if (frame.injured) return this.#interrupt(activity, 'injury', now);
    if (frame.scripted && activity.status === 'running') return this.#interrupt(activity, 'scripted_state', now);
    if (frame.inDirectedInteraction && activity.status === 'running') return this.#interrupt(activity, 'directed_interaction', now);
    if (frame.reflexActive && !activity.reflexSeen && (activity.status === 'running' || activity.status === 'paused')) { activity.reflexSeen = true; return this.#interrupt(activity, 'reflex', now); }
    if (!frame.reflexActive) { activity.reflexSeen = false; if (activity.status === 'paused' && activity.interrupt?.kind === 'reflex') activity.quietSince = activity.quietSince || now; }
    const until = activity.steps[activity.cursor]?.completion?.until;
    if (until?.kind === 'player_returns') {
      const near = until.radius === 'near' ? ['at', 'near'] : ['at', 'near', 'medium'];
      if (!near.includes(frame.distanceBand)) activity.playerWasFar = true;
      if (activity.playerWasFar && near.includes(frame.distanceBand)) activity.playerReturned = true;
    }
    if (activity.status === 'paused' && (frame.scripted || frame.reflexActive || frame.inDirectedInteraction)) activity.quietSince = 0;
  }

  #finish(activity, status, reason, now, mode, publish = true) {
    if (TERMINAL.has(activity.status)) return;
    activity.status = status;
    activity.terminal = { status, reason, atMs: now };
    activity.updatedAtMs = now;
    activity.asked = 'finish';
    const step = activity.steps[activity.cursor];
    if (step && step.status !== 'done') step.status = status === 'completed' ? 'done' : status === 'cancelled' || status === 'superseded' ? 'cancelled' : 'failed';
    if (publish && activity.currentExecutionId) this.#send('step.cancel', { requestId: this.id(), executionId: activity.currentExecutionId, mode: mode || 'detach' });
    if (publish && activity.leaseEpoch > 0) this.#send('actor.release', { requestId: this.id(), encounterId: activity.actor.encounterId, leaseId: activity.leaseId });
    const goal = this.goals.get(activity.goalId);
    if (goal && !['satisfied', 'failed', 'abandoned', 'expired', 'superseded', 'rejected', 'cancelled'].includes(goal.status)) {
      goal.status = status === 'completed' ? 'satisfied' : status === 'superseded' ? 'superseded' : status === 'expired' ? 'expired' : status === 'cancelled' ? 'cancelled' : 'failed';
      goal.terminalReason = reason;
      goal.updatedAtMs = now;
      if (now > goal.createdAtMs + GOAL_DEADLINE_MS) goal.status = 'expired';
    }
    const evidence = status === 'completed' && reason !== 'already_satisfied' ? 'world_strong' : 'none';
    const kind = status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : status === 'abandoned' ? 'abandoned' : 'failed';
    this.facts.record({ characterId: activity.actor.characterId, activityId: activity.activityId, goalId: activity.goalId, kind, intent: activity.template, evidence, reason, placeLabel: activity.placeLabel || null, atMs: now });
    this.history.push({ characterId: activity.actor.characterId, activityId: activity.activityId, intent: activity.template, status, reason, atMs: now });
    if (this.history.length > 64) this.history.shift();
    this.onEvent('activity_terminal', { activityId: activity.activityId, intent: activity.template, capability: step?.capability, reason });
    if (goal && goal.deadlineAtMs < goal.createdAtMs) goal.deadlineAtMs = goal.createdAtMs;
  }

  #live() { return this.activities.filter(activity => !TERMINAL.has(activity.status)); }
  #liveFor(characterId) { return this.#live().filter(activity => activity.actor.characterId === characterId); }
  #current(characterId) { return this.activities.filter(activity => activity.actor.characterId === characterId).at(-1) || null; }

  exportActivity(activity) {
    const copy = { ...activity };
    for (const key of ['acquireId', 'anchors', 'seen', 'failureKeys', 'reflexCount', 'resumeCount', 'deferred', 'deferUntil', 'quietSince', 'asked', 'gameStart', 'holdingSince', 'playerWasFar', 'playerReturned', 'currentExecutionId', 'knownIncarnation', 'onLeaseLoss', 'placeLabel', 'resumePolicy']) delete copy[key];
    copy.steps = activity.steps.map(step => { const next = { ...step }; delete next.needs; return next; });
    return validateActivity(copy) ? copy : null;
  }
}
