import { isUuid } from '../identity/identityContract.mjs';
import { validateHostEnvelope, validateWorldEpoch } from '../context/hostContext.mjs';

export const ACTIVITY_CONTRACT_VERSION = 1;
export const FRAME_BYTES = 8192;
const U32 = 0xffffffff;
const ALIAS = /^promoted\.[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REASON = /^[a-z][a-z0-9_]{0,47}$/;
const CAPABILITY = /^[a-z][a-z0-9_]{2,31}$/;
const SHA = /^[a-f0-9]{64}$/;
const HANDLE = /^[0-9]{1,16}$/;
const PLACE_QUERY = /^[a-z0-9][a-z0-9 '\-]{0,39}$/;
const TURN_ALIAS = /^[PV]\d{3}$/;
const LABEL = /^[A-Za-z0-9 .,'()\-]{1,40}$/;

export const SOURCES = Object.freeze(['player_ux', 'player_dialogue', 'scene_director', 'commitment', 'recovery']);
export const PRIORITIES = Object.freeze(['player_direct', 'player_standing', 'director_urgent', 'director_routine', 'ambient']);
export const GOAL_KINDS = Object.freeze(['instruction', 'reaction', 'commitment', 'routine']);
export const GOAL_STATUSES = Object.freeze(['proposed', 'accepted', 'active', 'suspended', 'satisfied', 'failed', 'abandoned', 'expired', 'superseded', 'rejected', 'cancelled']);
export const ACTIVITY_STATUSES = Object.freeze(['admitting', 'running', 'paused', 'resuming', 'completed', 'failed', 'cancelled', 'abandoned', 'expired', 'superseded']);
export const STEP_KINDS = Object.freeze(['finite', 'mode', 'finite_then_mode', 'instant']);
export const STEP_STATUSES = Object.freeze(['pending', 'preflight', 'executing', 'holding', 'done', 'skipped', 'failed', 'cancelled']);
export const RECEIPT_STATES = Object.freeze(['REQUESTED', 'VALIDATED', 'REJECTED', 'DISPATCHED', 'HANDLER_ACCEPTED', 'MODE_ESTABLISHED', 'PHYSICALLY_COMPLETED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'TIMED_OUT', 'DETACHED']);
export const TERMINAL_RECEIPTS = Object.freeze(['REJECTED', 'PHYSICALLY_COMPLETED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'TIMED_OUT', 'DETACHED']);
export const REASON_REQUIRED = Object.freeze(['REJECTED', 'FAILED', 'CANCELLED', 'SUPERSEDED', 'TIMED_OUT', 'DETACHED']);
export const MODE_HEALTH = Object.freeze(['healthy', 'degraded', 'lost']);
export const PREDICATES = Object.freeze(['satisfied', 'not_yet', 'violated', 'unknown']);
export const EVIDENCE_STRENGTHS = Object.freeze(['weak', 'medium', 'strong']);
export const EVIDENCE_KINDS = Object.freeze(['preflight_satisfied', 'queue_submitted', 'wrapper_invoked', 'handler_result', 'modifier_after', 'mode_flag', 'task_status', 'approach_event', 'distance', 'seat_occupancy', 'vehicle_motion', 'held_item', 'scenario_active', 'heading', 'continuity_target', 'control_changed', 'reflex_active', 'directed_interaction', 'scripted_state', 'anchor_retired', 'deadline']);
export const INTERRUPTS = Object.freeze(['player_turn', 'player_command', 'directed_interaction', 'reflex', 'injury', 'death', 'scripted_state', 'player_switch', 'vehicle_change', 'target_lost', 'ownership_change', 'control_released', 'preempted', 'lease_lost', 'clock_reset', 'superseded_external']);
export const RESUME_POLICIES = Object.freeze(['auto', 'auto_if_quiet', 'explicit_only', 'never']);
export const RECOVERY_ACTIONS = Object.freeze(['retry_once', 'alternative', 'replan', 'defer', 'ask_player', 'abandon']);
export const ON_COMPLETE = Object.freeze(['stay', 'restore_companion_mode', 'resume_ambient']);
export const ON_LEASE_LOSS = Object.freeze(['detach', 'cancel_if_current']);
export const REASON_CODES = Object.freeze(['already_satisfied', 'actor_not_owned', 'actor_unavailable', 'actor_dead', 'actor_retired', 'actor_injured', 'scripted_state', 'directed_interaction', 'reflex_active', 'on_foot_required', 'in_vehicle_required', 'driver_required', 'vehicle_invalid', 'vehicle_moving', 'seat_occupied', 'seat_unavailable', 'target_invalid', 'target_retired', 'target_out_of_range', 'place_unresolved', 'place_unsupported', 'capability_unavailable', 'capability_disabled', 'policy_denied', 'role_blocked', 'state_blocked', 'queue_not_accepted', 'handler_false', 'handler_exception', 'approach_failed', 'no_progress', 'navigation_failed', 'accept_timeout', 'establish_timeout', 'complete_timeout', 'hold_limit', 'activity_deadline', 'goal_deadline', 'superseded_player', 'superseded_essential', 'superseded_reflex', 'superseded_activity', 'control_released', 'far_release', 'lease_lost', 'epoch_changed', 'clock_reset', 'cancelled_by_player', 'cancelled_by_engine', 'preempted', 'stale_receipt', 'budget_exhausted', 'repeated_failure', 'bubble_exceeded', 'unsupported_combination', 'activity_busy', 'activity_limit', 'vehicle_mismatch', 'target_changed']);
export const INTENTS = Object.freeze(['hold_position', 'accompany', 'resume_previous', 'sit_here', 'scenario_here', 'scenario_at', 'move_to_and_hold', 'approach_and_face', 'hang_out_with', 'board_vehicle', 'ride_along', 'exit_vehicle_and_hold', 'leave_scene', 'take_cover_and_hold', 'go_to_place', 'vehicle_trip']);
export const INTENT_SLOTS = Object.freeze({
  hold_position: ['until'], accompany: ['person'], resume_previous: [], sit_here: ['until'], scenario_here: ['scenario', 'until'], scenario_at: ['place', 'scenario', 'until'],
  move_to_and_hold: ['place', 'until'], approach_and_face: ['person'], hang_out_with: ['person', 'until'], board_vehicle: ['vehicle', 'seat', 'until'], ride_along: ['seat'],
  exit_vehicle_and_hold: ['until'], leave_scene: [], take_cover_and_hold: ['until'], go_to_place: ['place'], vehicle_trip: ['vehicle', 'place'],
});
export const SCENARIOS = Object.freeze(['smoke', 'drink_coffee', 'phone', 'lean', 'stand_idle', 'sit_bench', 'clipboard', 'binoculars']);
export const ITEMS = Object.freeze(['canned_goods', 'donut', 'breakfast_snack', 'snack', 'soda', 'beer', 'coffee', 'liquor', 'energy_drink', 'water']);
export const SEATS = Object.freeze(['driver', 'passenger', 'rear', 'any_passenger']);
export const RADII = Object.freeze(['arrival', 'near', 'medium']);
export const PRECONDITIONS = Object.freeze(['actor_owned', 'actor_alive', 'actor_not_injured', 'actor_state_registered', 'not_scripted', 'not_foreign_mission_entity', 'not_directed_interaction', 'no_active_reflex', 'actor_on_foot', 'actor_in_vehicle', 'actor_is_driver', 'actor_in_bubble', 'target_valid', 'target_human', 'target_not_actor', 'target_within_near', 'target_within_medium', 'target_within_far', 'vehicle_valid', 'vehicle_not_moving', 'seat_free', 'vehicle_has_free_passenger_seat', 'place_resolved', 'place_within_medium', 'place_within_far', 'scenario_allowed', 'item_known', 'holding_item', 'capability_enabled', 'no_essential_mode', 'actor_near_place']);
export const ADAPTERS = Object.freeze(['hold_mode', 'follow_mode', 'pose_mode', 'cover_mode', 'drive_mode', 'approach', 'seat_occupancy', 'vehicle_exit', 'held_item', 'item_transfer', 'walk_away', 'resume_ambient', 'scenario', 'scenario_at', 'place_arrival', 'drive_arrival', 'none']);
export const EXECUTION_PATHS = Object.freeze(['queue', 'wrapper', 'extension', 'none']);
export const CAPABILITY_IDS = Object.freeze(['hold_position', 'follow_person', 'resume_ambient', 'sit_on_ground', 'stop_and_face', 'approach_person', 'enter_vehicle_seat', 'exit_vehicle', 'follow_vehicle', 'begin_driving', 'scenario_here', 'scenario_at', 'walk_away_from', 'take_cover', 'grab_item', 'give_item', 'take_item', 'clear_held_item', 'walk_to', 'drive_to', 'chase_person', 'directed_interaction', 'perform_activity']);
export const DISTANCE_BANDS = Object.freeze(['at', 'near', 'medium', 'far']);
export const LIMITS = Object.freeze({ characters: 4, anchors: 32, pendingPerActor: 1, callbackRing: 64, frameBytes: FRAME_BYTES, nativeQueue: 64, companionQueue: 256, receiptsPerSecond: 4, factsPerSecond: 2 });
export const DIAGNOSTIC_KEYS = Object.freeze(['activities', 'paused', 'executions', 'anchors', 'dispatches', 'accepted', 'established', 'completed', 'failed', 'superseded', 'timedOut', 'detached', 'staleReceipts', 'callbackDropped', 'adapterDeferred', 'updateMicrosP95', 'leaseExpiries', 'breakerTrips', 'extensionReissues']);
export const FACT_KINDS = Object.freeze(['instructed', 'accepted', 'started', 'step_completed', 'arrived', 'mode_established', 'paused', 'resumed', 'completed', 'failed', 'cancelled', 'abandoned']);
export const FACT_EVIDENCE = Object.freeze(['none', 'handler_only', 'mode_flag', 'world_strong']);

const one = values => new Set(values);
const sourceSet = one(SOURCES), prioritySet = one(PRIORITIES), goalKindSet = one(GOAL_KINDS), goalStatusSet = one(GOAL_STATUSES), activityStatusSet = one(ACTIVITY_STATUSES);
const stepKindSet = one(STEP_KINDS), stepStatusSet = one(STEP_STATUSES), receiptSet = one(RECEIPT_STATES), reasonRequired = one(REASON_REQUIRED), healthSet = one(MODE_HEALTH);
const predicateSet = one(PREDICATES), strengthSet = one(EVIDENCE_STRENGTHS), evidenceSet = one(EVIDENCE_KINDS), interruptSet = one(INTERRUPTS), resumeSet = one(RESUME_POLICIES);
const recoverySet = one(RECOVERY_ACTIONS), completeSet = one(ON_COMPLETE), leaseLossSet = one(ON_LEASE_LOSS), reasonSet = one(REASON_CODES), intentSet = one(INTENTS);
const scenarioSet = one(SCENARIOS), itemSet = one(ITEMS), seatSet = one(SEATS), radiusSet = one(RADII), preconditionSet = one(PRECONDITIONS), adapterSet = one(ADAPTERS);
const capabilitySet = one(CAPABILITY_IDS), bandSet = one(DISTANCE_BANDS), factKindSet = one(FACT_KINDS), factEvidenceSet = one(FACT_EVIDENCE);
const integer = (value, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const gameMs = value => integer(value, U32);
const nullableGame = value => value === null || gameMs(value);
const keys = (value, required, optional = []) => value !== null && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const reason = value => typeof value === 'string' && reasonSet.has(value) && REASON.test(value);
const nullableReason = value => value === null || reason(value);
const uuidList = (value, max) => Array.isArray(value) && value.length <= max && value.every(isUuid) && new Set(value).size === value.length;
const enumList = (value, set, max) => Array.isArray(value) && value.length <= max && value.every(item => set.has(item));

export function normalizeActivityConfig(value = {}) {
  // "on" is the explicit ACT2 execution switch. It is never the default, and listing
  // probe ids is an operator opt-in for a GTA experiment, not evidence those probes passed.
  const valid = value && typeof value === 'object' && !Array.isArray(value);
  const mode = valid && (value.mode === 'shadow' || value.mode === 'on') ? value.mode : 'off';
  const pipeName = valid && typeof value.pipeName === 'string' ? value.pipeName : 'LSA.Activities.v1';
  const passedProbes = valid && Array.isArray(value.passedProbes)
    ? [...new Set(value.passedProbes.filter(item => typeof item === 'string' && /^[A-Z][A-Z0-9]{0,8}$/.test(item)))].slice(0, 12)
    : [];
  return Object.freeze({ mode, pipeName: /^[A-Za-z0-9_.-]{1,80}$/.test(pipeName) ? pipeName : 'LSA.Activities.v1', passedProbes, dialogue: false });
}

function refSlot(value) {
  if (!keys(value, ['kind'], ['alias', 'pickId'])) return false;
  if (value.kind === 'turn_alias') return keys(value, ['kind', 'alias']) && typeof value.alias === 'string' && TURN_ALIAS.test(value.alias);
  if (value.kind === 'ux_pick') return keys(value, ['kind', 'pickId']) && isUuid(value.pickId);
  return keys(value, ['kind']) && ['player', 'current_vehicle', 'player_vehicle'].includes(value.kind);
}
function placeSlot(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Object.hasOwn(value, 'kind')) return false;
  if (value.kind === 'here' || value.kind === 'waypoint') return keys(value, ['kind']);
  if (value.kind === 'named') return keys(value, ['kind', 'query']) && typeof value.query === 'string' && PLACE_QUERY.test(value.query);
  if (value.kind === 'home') return keys(value, ['kind']);
  if (value.kind === 'near_person') return keys(value, ['kind', 'person']) && refSlot(value.person);
  if (value.kind === 'ux_point') return keys(value, ['kind', 'pickId']) && isUuid(value.pickId);
  return false;
}
function untilClause(value) {
  if (!value || typeof value !== 'object') return false;
  if (value.kind === 'player_returns') return keys(value, ['kind', 'radius']) && ['near', 'medium'].includes(value.radius);
  if (value.kind === 'duration') return keys(value, ['kind', 'bucket']) && ['short', 'medium', 'long'].includes(value.bucket);
  if (value.kind === 'player_command' || value.kind === 'arrival') return keys(value, ['kind']);
  return false;
}
export function validateSlots(intent, slots) {
  const allowed = INTENT_SLOTS[intent];
  if (!allowed || !keys(slots, [], ['person', 'vehicle', 'seat', 'place', 'scenario', 'until'])) return false;
  if (Object.keys(slots).some(key => !allowed.includes(key))) return false;
  if (slots.person !== undefined && !refSlot(slots.person)) return false;
  if (slots.vehicle !== undefined && !refSlot(slots.vehicle)) return false;
  if (slots.seat !== undefined && !seatSet.has(slots.seat)) return false;
  if (slots.place !== undefined && !placeSlot(slots.place)) return false;
  if (slots.scenario !== undefined && !scenarioSet.has(slots.scenario)) return false;
  if (slots.until !== undefined && !untilClause(slots.until)) return false;
  return true;
}
function anchorRef(value) {
  if (!keys(value, ['kind'], ['captureRef', 'placeRef'])) return false;
  if (value.kind === 'actor') return keys(value, ['kind']);
  if (value.kind === 'player' || value.kind === 'capture') return keys(value, ['kind', 'captureRef']) && isUuid(value.captureRef);
  if (value.kind === 'place') return keys(value, ['kind', 'placeRef']) && isUuid(value.placeRef);
  return false;
}
export function validateStepArgs(value) {
  if (!keys(value, [], ['target', 'vehicle', 'seat', 'place', 'scenario', 'radius', 'item'])) return false;
  if (value.target !== undefined && !anchorRef(value.target)) return false;
  if (value.vehicle !== undefined && !anchorRef(value.vehicle)) return false;
  if (value.place !== undefined && !anchorRef(value.place)) return false;
  if (value.seat !== undefined && !seatSet.has(value.seat)) return false;
  if (value.scenario !== undefined && !scenarioSet.has(value.scenario)) return false;
  if (value.radius !== undefined && !radiusSet.has(value.radius)) return false;
  if (value.item !== undefined && !itemSet.has(value.item)) return false;
  return true;
}
function completion(value) {
  return keys(value, ['adapter', 'until']) && adapterSet.has(value.adapter) && (value.until === null || untilClause(value.until));
}
function timeouts(value) {
  return keys(value, ['acceptMs', 'establishMs', 'completeMs', 'holdMaxMs']) && integer(value.acceptMs, 3_600_000) &&
    [value.establishMs, value.completeMs, value.holdMaxMs].every(item => item === null || integer(item, 3_600_000));
}
export function validateProposal(value) {
  if (!keys(value, ['proposalVersion', 'proposalId', 'source', 'subject', 'intent', 'slots', 'priority', 'origin', 'proposedAtMs']) || value.proposalVersion !== 1 || !isUuid(value.proposalId) || !sourceSet.has(value.source) || !intentSet.has(value.intent) || !prioritySet.has(value.priority) || !integer(value.proposedAtMs)) return false;
  if (!keys(value.subject, ['characterId']) || !isUuid(value.subject.characterId) || !validateSlots(value.intent, value.slots) || !keys(value.origin, [], ['turn', 'uxRequestId', 'directorTicketId', 'commitmentId'])) return false;
  if (value.source === 'player_dialogue') {
    const turn = value.origin.turn;
    if (!keys(turn, ['pedId', 'sessionNonce', 'turnId', 'generationId']) || typeof turn.pedId !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(turn.pedId) || !integer(turn.sessionNonce) || !isUuid(turn.turnId) || !integer(turn.generationId)) return false;
  } else if (value.origin.turn !== undefined) return false;
  for (const key of ['uxRequestId', 'directorTicketId', 'commitmentId']) if (value.origin[key] !== undefined && !isUuid(value.origin[key])) return false;
  return true;
}
export function validateGoal(value) {
  if (!keys(value, ['goalVersion', 'goalId', 'kind', 'subject', 'intent', 'slots', 'source', 'priority', 'status', 'resumePolicy', 'createdAtMs', 'acceptedAtMs', 'updatedAtMs', 'deadlineAtMs', 'activityIds', 'terminalReason', 'commitmentId'])) return false;
  if (value.goalVersion !== 1 || !isUuid(value.goalId) || !goalKindSet.has(value.kind) || value.kind === 'routine' || !keys(value.subject, ['characterId']) || !isUuid(value.subject.characterId)) return false;
  if (!intentSet.has(value.intent) || !validateSlots(value.intent, value.slots) || !sourceSet.has(value.source) || !prioritySet.has(value.priority) || !goalStatusSet.has(value.status) || !resumeSet.has(value.resumePolicy)) return false;
  if (!integer(value.createdAtMs) || (value.acceptedAtMs !== null && !integer(value.acceptedAtMs)) || !integer(value.updatedAtMs) || !integer(value.deadlineAtMs) || value.deadlineAtMs > value.createdAtMs + 3_600_000) return false;
  if (!uuidList(value.activityIds, 4) || !nullableReason(value.terminalReason) || (value.commitmentId !== null && !isUuid(value.commitmentId))) return false;
  return true;
}
export function validateStep(value) {
  if (!keys(value, ['stepId', 'capability', 'kind', 'args', 'preconditions', 'establishes', 'completion', 'abort', 'retry', 'alternatives', 'timeouts', 'resumable', 'resumeOn', 'status', 'attempts'])) return false;
  if (!isUuid(value.stepId) || !capabilitySet.has(value.capability) || !stepKindSet.has(value.kind) || !validateStepArgs(value.args) || !enumList(value.preconditions, preconditionSet, 32) || !enumList(value.establishes, preconditionSet, 32) || !completion(value.completion)) return false;
  const abort = value.abort;
  if (!keys(abort, ['onInterrupt', 'violated']) || !keys(abort.onInterrupt, [], INTERRUPTS) || Object.values(abort.onInterrupt).some(item => !['pause', 'cancel', 'fail'].includes(item)) || !enumList(abort.violated, preconditionSet, 32)) return false;
  if (!keys(value.retry, ['maxRetries', 'retryOn', 'backoffMs']) || ![0, 1].includes(value.retry.maxRetries) || !enumList(value.retry.retryOn, reasonSet, 16) || !integer(value.retry.backoffMs, 5000) || value.retry.backoffMs < 500) return false;
  if (!Array.isArray(value.alternatives) || value.alternatives.length > 2 || value.alternatives.some(item => !keys(item, ['onReason', 'replaceArgs']) || !enumList(item.onReason, reasonSet, 8) || !validateStepArgs(item.replaceArgs))) return false;
  if (!timeouts(value.timeouts) || typeof value.resumable !== 'boolean' || !enumList(value.resumeOn, interruptSet, INTERRUPTS.length) || !stepStatusSet.has(value.status) || !integer(value.attempts, 8)) return false;
  return true;
}
export function validateActivity(value) {
  if (!keys(value, ['activityVersion', 'activityId', 'goalId', 'actor', 'template', 'planRevision', 'steps', 'cursor', 'status', 'source', 'priority', 'leaseId', 'leaseEpoch', 'budgets', 'deadlines', 'interrupt', 'executionIds', 'onComplete', 'createdAtMs', 'updatedAtMs', 'terminal'])) return false;
  if (value.activityVersion !== 1 || !isUuid(value.activityId) || !isUuid(value.goalId) || !keys(value.actor, ['characterId', 'encounterId', 'ownerAlias', 'ownershipToken', 'incarnationId'])) return false;
  if (![value.actor.characterId, value.actor.encounterId, value.actor.ownershipToken, value.actor.incarnationId].every(isUuid) || !ALIAS.test(value.actor.ownerAlias)) return false;
  if (typeof value.template !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(value.template) || !integer(value.planRevision, 1) || !Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 6 || !value.steps.every(validateStep)) return false;
  if (!integer(value.cursor, value.steps.length - 1) || !activityStatusSet.has(value.status) || !sourceSet.has(value.source) || !prioritySet.has(value.priority) || !isUuid(value.leaseId) || !integer(value.leaseEpoch)) return false;
  const budgets = value.budgets;
  if (!keys(budgets, ['retriesLeft', 'alternativesLeft', 'replansLeft', 'resumesLeft', 'executionsLeft']) || ![budgets.retriesLeft, budgets.alternativesLeft, budgets.resumesLeft, budgets.executionsLeft].every(item => integer(item, 8)) || ![0, 1].includes(budgets.replansLeft)) return false;
  if (!keys(value.deadlines, ['activityDeadlineGameMs', 'wallCapAtMs']) || !gameMs(value.deadlines.activityDeadlineGameMs) || !integer(value.deadlines.wallCapAtMs)) return false;
  if (value.interrupt !== null && (!keys(value.interrupt, ['kind', 'atMs', 'token']) || !interruptSet.has(value.interrupt.kind) || !integer(value.interrupt.atMs) || (value.interrupt.token !== null && !validateResumeToken(value.interrupt.token)))) return false;
  if (!uuidList(value.executionIds, 16) || !completeSet.has(value.onComplete) || !integer(value.createdAtMs) || !integer(value.updatedAtMs)) return false;
  if (value.terminal !== null && (!keys(value.terminal, ['status', 'reason', 'atMs']) || !activityStatusSet.has(value.terminal.status) || !reason(value.terminal.reason) || !integer(value.terminal.atMs))) return false;
  return true;
}
function evidenceDetail(value) {
  if (value === null) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const names = Object.keys(value);
  if (names.length !== 1 && !(names.length === 2 && names.includes('approachOk') && names.includes('approachReason'))) return false;
  if (Object.hasOwn(value, 'distanceBand')) return names.length === 1 && bandSet.has(value.distanceBand);
  if (Object.hasOwn(value, 'seat')) return names.length === 1 && ['driver', 'passenger', 'rear', 'none'].includes(value.seat);
  if (Object.hasOwn(value, 'taskStatus')) return names.length === 1 && ['waiting', 'performing', 'finished', 'unknown'].includes(value.taskStatus);
  if (Object.hasOwn(value, 'approachOk')) return typeof value.approachOk === 'boolean' && ['arrived', 'no_progress', 'task_ended_near', 'target_missing', 'other'].includes(value.approachReason);
  if (Object.hasOwn(value, 'externalCommand')) return names.length === 1 && ['player_turn', 'p2_control', 'essential', 'reflex', 'unknown'].includes(value.externalCommand);
  if (Object.hasOwn(value, 'modifierPhase')) return names.length === 1 && ['before', 'after'].includes(value.modifierPhase);
  return false;
}
export function validateReceipt(value) {
  if (!keys(value, ['receiptVersion', 'executionId', 'activityId', 'stepId', 'attempt', 'actorEncounterId', 'capability', 'essential', 'targets', 'epochs', 'state', 'modeHealth', 'predicate', 'reason', 'handlerResult', 'milestones', 'evidence', 'evidenceDropped', 'sequence'])) return false;
  if (value.receiptVersion !== 1 || ![value.executionId, value.activityId, value.stepId, value.actorEncounterId].every(isUuid) || !integer(value.attempt, 8) || value.attempt < 1 || !capabilitySet.has(value.capability)) return false;
  if (!keys(value.essential, ['path', 'name']) || !EXECUTION_PATHS.includes(value.essential.path) || (value.essential.name !== null && (typeof value.essential.name !== 'string' || value.essential.name.length < 1 || value.essential.name.length > 80))) return false;
  if (!Array.isArray(value.targets) || value.targets.length > 8 || value.targets.some(item => !keys(item, ['role', 'ref']) || !['target', 'vehicle', 'place'].includes(item.role) || !isUuid(item.ref))) return false;
  if (!keys(value.epochs, ['nativeRun', 'adapterEpoch', 'leaseEpoch']) || !isUuid(value.epochs.nativeRun) || !isUuid(value.epochs.adapterEpoch) || !integer(value.epochs.leaseEpoch)) return false;
  if (!receiptSet.has(value.state) || !predicateSet.has(value.predicate) || (value.handlerResult !== null && typeof value.handlerResult !== 'boolean')) return false;
  if (value.state === 'MODE_ESTABLISHED' ? !healthSet.has(value.modeHealth) : value.modeHealth !== null) return false;
  if (value.state === 'PHYSICALLY_COMPLETED' && (value.capability === 'hold_position' || value.capability === 'follow_person' || value.capability === 'sit_on_ground' || value.capability === 'stop_and_face' || value.capability === 'follow_vehicle' || value.capability === 'begin_driving' || value.capability === 'scenario_here' || value.capability === 'take_cover' || value.capability === 'chase_person' || value.capability === 'directed_interaction')) return false;
  if (reasonRequired.has(value.state) ? !reason(value.reason) : value.reason !== null) return false;
  const marks = value.milestones;
  if (!keys(marks, ['requestedGameMs', 'validatedGameMs', 'dispatchedGameMs', 'acceptedGameMs', 'establishedGameMs', 'completedGameMs', 'terminalGameMs']) || !gameMs(marks.requestedGameMs) || [marks.validatedGameMs, marks.dispatchedGameMs, marks.acceptedGameMs, marks.establishedGameMs, marks.completedGameMs, marks.terminalGameMs].some(item => !nullableGame(item))) return false;
  if (!Array.isArray(value.evidence) || value.evidence.length > 8 || value.evidence.some(item => !keys(item, ['kind', 'strength', 'gameMs', 'detail']) || !evidenceSet.has(item.kind) || !strengthSet.has(item.strength) || !gameMs(item.gameMs) || !evidenceDetail(item.detail))) return false;
  if (!integer(value.evidenceDropped, 1_000_000) || !integer(value.sequence, 1_000_000) || value.sequence < 1) return false;
  if (value.state === 'PHYSICALLY_COMPLETED' && !value.evidence.some(item => item.strength === 'strong')) return false;
  return true;
}
export function validateResumeToken(value) {
  if (!keys(value, ['tokenVersion', 'activityId', 'planRevision', 'cursor', 'completedStepIds', 'anchors', 'interrupt', 'pausedAtMs', 'resumeNotBeforeMs', 'resumeDeadlineMs', 'resumeCount', 'nativeRun', 'adapterEpoch'])) return false;
  if (value.tokenVersion !== 1 || !isUuid(value.activityId) || !integer(value.planRevision, 1) || !integer(value.cursor, 5) || !uuidList(value.completedStepIds, 6) || !interruptSet.has(value.interrupt)) return false;
  if (!Array.isArray(value.anchors) || value.anchors.length > 8 || value.anchors.some(item => !keys(item, ['role', 'ref', 'incarnationId']) || !['actor', 'target', 'vehicle', 'place'].includes(item.role) || !isUuid(item.ref) || (item.incarnationId !== null && !isUuid(item.incarnationId)))) return false;
  if (!integer(value.pausedAtMs) || !integer(value.resumeNotBeforeMs) || !integer(value.resumeDeadlineMs) || value.resumeDeadlineMs > value.pausedAtMs + 120_000 || !integer(value.resumeCount, 3) || !isUuid(value.nativeRun) || !isUuid(value.adapterEpoch)) return false;
  return true;
}
export function validateFact(value) {
  if (!keys(value, ['factVersion', 'factId', 'characterId', 'activityId', 'goalId', 'kind', 'intent', 'placeLabel', 'evidence', 'reason', 'atMs'])) return false;
  if (value.factVersion !== 1 || ![value.factId, value.characterId, value.activityId, value.goalId].every(isUuid) || !factKindSet.has(value.kind) || !intentSet.has(value.intent)) return false;
  if (value.placeLabel !== null && (typeof value.placeLabel !== 'string' || !LABEL.test(value.placeLabel))) return false;
  if (!factEvidenceSet.has(value.evidence) || !nullableReason(value.reason) || !integer(value.atMs)) return false;
  if ((value.kind === 'arrived' || value.kind === 'completed') && value.evidence !== 'world_strong') return false;
  return true;
}

function capabilities(value) {
  return keys(value, CAPABILITY_IDS) && Object.values(value).every(item => typeof item === 'boolean');
}
function limits(value) {
  return keys(value, Object.keys(LIMITS)) && Object.entries(LIMITS).every(([key, expected]) => value[key] === expected);
}
function resolveSlot(value) {
  if (!keys(value, ['kind'], ['id', 'place', 'pickId'])) return false;
  if (value.kind === 'handle_once') return keys(value, ['kind', 'id']) && typeof value.id === 'string' && HANDLE.test(value.id);
  if (value.kind === 'player' || value.kind === 'current_vehicle' || value.kind === 'player_vehicle') return keys(value, ['kind']);
  if (value.kind === 'place') return keys(value, ['kind', 'place']) && placeSlot(value.place);
  if (value.kind === 'ux_pick') return keys(value, ['kind', 'pickId']) && isUuid(value.pickId);
  return false;
}
const sequenced = value => !!value && value.version === 1 && typeof value.type === 'string' && integer(value.sequence, 1_000_000_000) && value.sequence >= 1;
export function validateFrame(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > FRAME_BYTES) return false;
  if (value.type === 'hello' && value.nativeRun !== undefined) return validateHostEnvelope(value, ['version', 'type', 'nativeRun', 'adapterEpoch', 'contractSha256', 'capabilities', 'limits']) && value.version === 1 && isUuid(value.nativeRun) && isUuid(value.adapterEpoch) && SHA.test(value.contractSha256) && capabilities(value.capabilities) && limits(value.limits);
  if (value.type === 'hello') return validateHostEnvelope(value, ['version', 'type', 'contractSha256', 'clientRun']) && value.version === 1 && SHA.test(value.contractSha256) && isUuid(value.clientRun);
  if (!sequenced(value)) return false;
  if (value.type === 'world_epoch') return keys(value,['version','type','sequence','epoch','reason']) && validateWorldEpoch({epoch:value.epoch,reason:value.reason});
  if (value.type === 'lease') return keys(value, ['version', 'type', 'sequence', 'leaseTtlMs']) && integer(value.leaseTtlMs, 5000) && value.leaseTtlMs >= 1;
  if (value.type === 'actor.acquire') return keys(value, ['version', 'type', 'sequence', 'requestId', 'characterId', 'ownerAlias', 'ownershipToken', 'leaseId']) && [value.requestId, value.characterId, value.ownershipToken, value.leaseId].every(isUuid) && ALIAS.test(value.ownerAlias);
  if (value.type === 'actor.acquired') return keys(value, ['version', 'type', 'sequence', 'requestId', 'encounterId', 'incarnationId', 'leaseEpoch']) && [value.requestId, value.encounterId, value.incarnationId].every(isUuid) && integer(value.leaseEpoch);
  if (value.type === 'ack') return keys(value, ['version', 'type', 'sequence', 'requestId']) && isUuid(value.requestId);
  if (value.type === 'nack') return keys(value, ['version', 'type', 'sequence', 'requestId', 'reason']) && isUuid(value.requestId) && reason(value.reason);
  if (value.type === 'actor.release') return keys(value, ['version', 'type', 'sequence', 'requestId', 'encounterId', 'leaseId']) && [value.requestId, value.encounterId, value.leaseId].every(isUuid);
  if (value.type === 'anchor.resolve') return keys(value, ['version', 'type', 'sequence', 'requestId', 'encounterId', 'leaseId', 'refs']) && [value.requestId, value.encounterId, value.leaseId].every(isUuid) && Array.isArray(value.refs) && value.refs.length <= 8 && value.refs.every(item => keys(item, ['role', 'slot']) && ['actor', 'target', 'vehicle', 'place'].includes(item.role) && resolveSlot(item.slot));
  if (value.type === 'anchor.resolved') return keys(value, ['version', 'type', 'sequence', 'requestId', 'results']) && isUuid(value.requestId) && Array.isArray(value.results) && value.results.length <= 8 && value.results.every(item => keys(item, ['role', 'ref', 'reason', 'label', 'distanceBand']) && ['actor', 'target', 'vehicle', 'place'].includes(item.role) && (item.ref === null || isUuid(item.ref)) && nullableReason(item.reason) && (item.label === null || (typeof item.label === 'string' && LABEL.test(item.label))) && (item.distanceBand === null || bandSet.has(item.distanceBand)));
  if (value.type === 'step.preflight') return keys(value, ['version', 'type', 'sequence', 'requestId', 'encounterId', 'leaseId', 'capability', 'args', 'preconditions']) && [value.requestId, value.encounterId, value.leaseId].every(isUuid) && capabilitySet.has(value.capability) && validateStepArgs(value.args) && enumList(value.preconditions, preconditionSet, 32);
  if (value.type === 'step.preflighted') return keys(value, ['version', 'type', 'sequence', 'requestId', 'verdicts', 'alreadySatisfied', 'reason']) && isUuid(value.requestId) && Array.isArray(value.verdicts) && value.verdicts.length <= 32 && value.verdicts.every(item => keys(item, ['id', 'verdict']) && preconditionSet.has(item.id) && predicateSet.has(item.verdict)) && typeof value.alreadySatisfied === 'boolean' && nullableReason(value.reason);
  if (value.type === 'step.begin') return keys(value, ['version', 'type', 'sequence', 'requestId', 'executionId', 'activityId', 'stepId', 'attempt', 'encounterId', 'leaseId', 'leaseEpoch', 'capability', 'args', 'timeouts', 'completion', 'violated', 'onLeaseLoss']) && [value.requestId, value.executionId, value.activityId, value.stepId, value.encounterId, value.leaseId].every(isUuid) && integer(value.attempt, 8) && value.attempt >= 1 && integer(value.leaseEpoch) && capabilitySet.has(value.capability) && validateStepArgs(value.args) && timeouts(value.timeouts) && completion(value.completion) && enumList(value.violated, preconditionSet, 32) && leaseLossSet.has(value.onLeaseLoss);
  if (value.type === 'step.cancel') return keys(value, ['version', 'type', 'sequence', 'requestId', 'executionId', 'mode']) && isUuid(value.requestId) && isUuid(value.executionId) && leaseLossSet.has(value.mode);
  if (value.type === 'step.query') return keys(value, ['version', 'type', 'sequence', 'requestId', 'executionIds']) && isUuid(value.requestId) && uuidList(value.executionIds, 8);
  if (value.type === 'receipts') return keys(value, ['version', 'type', 'sequence', 'requestId', 'receipts']) && isUuid(value.requestId) && Array.isArray(value.receipts) && value.receipts.length <= 8 && value.receipts.every(validateReceipt);
  if (value.type === 'receipt') return keys(value, ['version', 'type', 'sequence', 'receipt']) && validateReceipt(value.receipt);
  if (value.type === 'actor.facts') return keys(value, ['version', 'type', 'sequence', 'encounterId', 'alive', 'injured', 'scripted', 'suspended', 'inDirectedInteraction', 'reflexActive', 'inVehicle', 'isDriver', 'controlIntent', 'stateRegistered', 'distanceBand', 'gameMs']) && isUuid(value.encounterId) && ['alive', 'injured', 'scripted', 'suspended', 'inDirectedInteraction', 'reflexActive', 'inVehicle', 'isDriver', 'controlIntent', 'stateRegistered'].every(key => typeof value[key] === 'boolean') && bandSet.has(value.distanceBand) && gameMs(value.gameMs);
  if (value.type === 'lease.changed') return keys(value, ['version', 'type', 'sequence', 'encounterId', 'leaseEpoch', 'reason']) && isUuid(value.encounterId) && integer(value.leaseEpoch) && ['p2_control', 'external_command', 'released', 'retired'].includes(value.reason);
  if (value.type === 'diagnostics') return keys(value, ['version', 'type', 'sequence', ...DIAGNOSTIC_KEYS]) && DIAGNOSTIC_KEYS.every(key => integer(value[key], 2_147_483_647));
  return false;
}
