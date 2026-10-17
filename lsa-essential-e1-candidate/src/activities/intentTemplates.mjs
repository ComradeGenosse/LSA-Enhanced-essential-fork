import { INTENTS } from './contracts.mjs';

// Closed plans. The model never supplies these steps. ACT2 intents keep their exact historical plans.
export const ACT2_INTENTS = Object.freeze(['hold_position', 'accompany', 'resume_previous', 'sit_here']);
export const ACT2_CAPABILITIES = Object.freeze(['hold_position', 'follow_person', 'resume_ambient', 'sit_on_ground']);
// ACT3 plans compose only capabilities that Essential already executes. Every other ACT3 intent is blocked
// below with a typed reason instead of a plan.
export const ACT3_INTENTS = Object.freeze(['scenario_here', 'approach_and_face', 'board_vehicle', 'ride_along', 'exit_vehicle_and_hold', 'leave_scene', 'take_cover_and_hold']);
export const ACT3_BLOCKED_INTENTS = Object.freeze({
  scenario_at: 'capability_unavailable', move_to_and_hold: 'capability_unavailable', hang_out_with: 'capability_unavailable',
  go_to_place: 'capability_unavailable', vehicle_trip: 'capability_unavailable',
});

const ON = Object.freeze({
  player_turn: 'pause', player_command: 'cancel', directed_interaction: 'pause', reflex: 'pause', injury: 'cancel', death: 'fail',
  scripted_state: 'pause', player_switch: 'cancel', vehicle_change: 'pause', target_lost: 'fail', ownership_change: 'cancel',
  control_released: 'fail', preempted: 'pause', lease_lost: 'pause', clock_reset: 'cancel', superseded_external: 'pause',
});
export const INTERRUPT_POLICY = Object.freeze({
  player_turn: 'auto_if_quiet', player_command: 'never', directed_interaction: 'explicit_only', reflex: 'auto', injury: 'never', death: 'never',
  scripted_state: 'explicit_only', player_switch: 'never', vehicle_change: 'auto_if_quiet', target_lost: 'never', ownership_change: 'never',
  control_released: 'never', preempted: 'auto', lease_lost: 'explicit_only', clock_reset: 'never', superseded_external: 'auto_if_quiet',
});

const PLAYER = Object.freeze({ kind: 'player' });
const here = () => [{ role: 'place', slot: { kind: 'place', place: { kind: 'here' } } }];
const playerTarget = () => [{ role: 'target', slot: PLAYER }];
const playerVehicle = () => [{ role: 'vehicle', slot: { kind: 'player_vehicle' } }];
const untilOf = slots => slots.until || { kind: 'player_command' };

// ACT2 templates (unchanged shape).
const TEMPLATES = Object.freeze({
  hold_position: { capability: 'hold_position', until: true, needs: () => here() },
  accompany: { capability: 'follow_person', until: true, needs: slots => [{ role: 'target', slot: slots.person || { kind: 'player' } }] },
  resume_previous: { capability: 'resume_ambient', until: false, needs: () => [] },
  sit_here: { capability: 'sit_on_ground', until: true, needs: () => [] },
});

// ACT3 step lists. A step is { capability, args, needs, until }. Only the last mode step carries `until`.
// Targets and vehicles resolve to the player and the player's vehicle only; Essential has no other
// resolvable entity slot in ACT3, so any other slot is a typed unsupported_combination, not a guess.
const onlyPlayer = slot => slot === undefined || slot.kind === 'player';
const onlyPlayerVehicle = slot => slot === undefined || slot.kind === 'player_vehicle' || slot.kind === 'current_vehicle';
const ACT3_PLANS = Object.freeze({
  scenario_here: slots => {
    if (slots.scenario === undefined) return { reason: 'unsupported_combination' };
    // Essential has no sit-on-bench wrapper; the row exists but the combination is refused.
    if (slots.scenario === 'sit_bench') return { reason: 'unsupported_combination' };
    return { steps: [{ capability: 'scenario_here', args: { scenario: slots.scenario }, needs: [], until: untilOf(slots) }] };
  },
  approach_and_face: slots => {
    if (!onlyPlayer(slots.person)) return { reason: 'unsupported_combination' };
    return { steps: [
      { capability: 'approach_person', args: {}, needs: playerTarget(), until: null },
      { capability: 'stop_and_face', args: {}, needs: playerTarget(), until: { kind: 'player_command' } },
    ] };
  },
  board_vehicle: slots => {
    if (!onlyPlayerVehicle(slots.vehicle)) return { reason: 'unsupported_combination' };
    return { steps: [{ capability: 'enter_vehicle_seat', args: { seat: slots.seat || 'any_passenger' }, needs: playerVehicle(), until: null }] };
  },
  ride_along: slots => {
    if (slots.seat === 'driver') return { reason: 'unsupported_combination' };
    return { steps: [{ capability: 'enter_vehicle_seat', args: { seat: slots.seat || 'any_passenger' }, needs: playerVehicle(), until: null }] };
  },
  exit_vehicle_and_hold: slots => ({ steps: [
    { capability: 'exit_vehicle', args: {}, needs: [], until: null },
    { capability: 'hold_position', args: {}, needs: here(), until: untilOf(slots) },
  ] }),
  leave_scene: () => ({ steps: [
    { capability: 'walk_away_from', args: {}, needs: playerTarget(), until: null },
    { capability: 'resume_ambient', args: {}, needs: [], until: null },
  ] }),
  take_cover_and_hold: slots => ({ steps: [{ capability: 'take_cover', args: {}, needs: [], until: untilOf(slots) }] }),
});

export function templateFor(intent) {
  return ACT2_INTENTS.includes(intent) ? TEMPLATES[intent] : null;
}

// The capability ids a proposal would execute, or a typed refusal. Admission and planning share this.
export function planSpec(intent, slots) {
  const safe = slots || {};
  if (ACT2_INTENTS.includes(intent)) {
    const template = TEMPLATES[intent];
    return { steps: [{ capability: template.capability, args: {}, needs: template.needs(safe), until: template.until ? (safe.until || { kind: 'player_command' }) : null }] };
  }
  if (ACT3_INTENTS.includes(intent)) return ACT3_PLANS[intent](safe);
  if (ACT3_BLOCKED_INTENTS[intent]) return { reason: ACT3_BLOCKED_INTENTS[intent] };
  return { reason: 'capability_unavailable' };
}

function buildStep(spec, row, id) {
  return {
    stepId: id(),
    capability: row.id,
    kind: row.kind,
    args: { ...spec.args },
    needs: spec.needs,
    preconditions: row.preconditions.slice(),
    establishes: [],
    completion: { adapter: row.adapter, until: spec.until || null },
    abort: { onInterrupt: { ...ON }, violated: [] },
    retry: { maxRetries: 1, retryOn: ['accept_timeout', 'establish_timeout', 'queue_not_accepted'], backoffMs: 1000 },
    alternatives: [],
    timeouts: {
      acceptMs: row.timeouts.acceptMs,
      establishMs: row.timeouts.establishMaxMs,
      completeMs: row.timeouts.completeMaxMs,
      holdMaxMs: row.timeouts.holdMaxMs,
    },
    resumable: true,
    resumeOn: Object.keys(ON).filter(kind => INTERRUPT_POLICY[kind] !== 'never'),
    status: 'pending',
    attempts: 0,
  };
}

// Returns { plan } or { reason }. Never returns a partial plan.
export function planFor(intent, slots, { id, registry }) {
  const spec = planSpec(intent, slots);
  if (spec.reason) return { reason: spec.reason };
  if (!INTENTS.includes(intent)) return { reason: 'capability_unavailable' };
  const steps = [];
  for (const item of spec.steps) {
    const row = registry.get(item.capability);
    if (!row || (row.phase !== 'ACT2' && row.phase !== 'ACT3')) return { reason: 'capability_unavailable' };
    if (ACT2_INTENTS.includes(intent) && row.phase !== 'ACT2') return { reason: 'capability_unavailable' };
    steps.push(buildStep(item, row, id));
  }
  return { plan: { template: intent, onComplete: 'stay', steps, onLeaseLoss: 'cancel_if_current' } };
}

export function buildPlan(intent, slots, context) {
  return planFor(intent, slots, context).plan || null;
}
