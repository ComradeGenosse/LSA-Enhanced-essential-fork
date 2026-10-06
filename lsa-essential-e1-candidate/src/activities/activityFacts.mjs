import { REASON_CODES } from './contracts.mjs';

export const FACT_LIMIT = 128;
const PHRASES = Object.freeze({
  hold_position: 'Wait here', accompany: 'Follow me', resume_previous: 'Resume previous activity', sit_here: 'Sit here',
  running: 'Running', paused: 'Paused', resuming: 'Resuming', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
  abandoned: 'Stopped', expired: 'Timed out', superseded: 'Replaced', admitting: 'Starting',
});

export class ActivityFacts {
  constructor(id = () => '', now = () => Date.now()) { this.id = id; this.now = now; this.facts = []; }
  record(partial) {
    const fact = {
      factVersion: 1, factId: this.id(), characterId: partial.characterId, activityId: partial.activityId, goalId: partial.goalId,
      kind: partial.kind, intent: partial.intent, placeLabel: partial.placeLabel || null,
      evidence: partial.evidence || 'none', reason: partial.reason || null, atMs: partial.atMs ?? this.now(),
    };
    if ((fact.kind === 'arrived' || fact.kind === 'completed') && fact.evidence !== 'world_strong') fact.kind = 'mode_established';
    this.facts.push(fact);
    if (this.facts.length > FACT_LIMIT) this.facts.splice(0, this.facts.length - FACT_LIMIT);
    return fact;
  }
  forCharacter(characterId) { return this.facts.filter(fact => fact.characterId === characterId).slice(-16); }
}

export function phrase(token) {
  if (token == null) return null;
  if (PHRASES[token]) return PHRASES[token];
  if (REASON_CODES.includes(token)) return token.replaceAll('_', ' ');
  return null;
}

export function projectStatus(activity, goal) {
  if (!activity) return { activity: null, step: null, status: 'none', reason: null, phrase: 'No activity' };
  const step = activity.steps[activity.cursor];
  const status = activity.status;
  const reason = activity.terminal?.reason || null;
  const label = phrase(goal?.intent || activity.template) || 'Activity';
  const state = phrase(status) || status;
  return {
    activity: goal?.intent || activity.template,
    step: step?.capability || null,
    status, reason,
    phrase: reason ? `${label}: ${state} (${phrase(reason)})` : `${label}: ${state}`,
  };
}
