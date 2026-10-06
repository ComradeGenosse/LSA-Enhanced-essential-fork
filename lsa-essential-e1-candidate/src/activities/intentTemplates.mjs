import { INTENTS } from './contracts.mjs';

// Closed ACT2 plans. The model never supplies these steps.
export const ACT2_INTENTS = Object.freeze(['hold_position', 'accompany', 'resume_previous', 'sit_here']);
export const ACT2_CAPABILITIES = Object.freeze(['hold_position', 'follow_person', 'resume_ambient', 'sit_on_ground']);

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

const TEMPLATES = Object.freeze({
  hold_position: { capability: 'hold_position', until: true, needs: () => [{ role: 'place', slot: { kind: 'place', place: { kind: 'here' } } }] },
  accompany: { capability: 'follow_person', until: true, needs: slots => [{ role: 'target', slot: slots.person || { kind: 'player' } }] },
  resume_previous: { capability: 'resume_ambient', until: false, needs: () => [] },
  sit_here: { capability: 'sit_on_ground', until: true, needs: () => [] },
});

export function templateFor(intent) {
  return ACT2_INTENTS.includes(intent) ? TEMPLATES[intent] : null;
}

export function buildPlan(intent, slots, { id, registry }) {
  const template = templateFor(intent);
  const row = template && registry.get(template.capability);
  if (!row || !INTENTS.includes(intent) || row.phase !== 'ACT2') return null;
  const until = template.until ? (slots.until || { kind: 'player_command' }) : null;
  const step = {
    stepId: id(),
    capability: row.id,
    kind: row.kind,
    args: {},
    needs: template.needs(slots || {}),
    preconditions: row.preconditions.slice(),
    establishes: [],
    completion: { adapter: row.adapter, until },
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
  return { template: intent, onComplete: 'stay', steps: [step], onLeaseLoss: 'cancel_if_current' };
}
