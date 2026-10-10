import {immutableSnapshot} from '../context/turnSnapshot.mjs';
import {readHostContext,sameHostContext} from '../context/hostContext.mjs';
import {isUuid} from '../identity/identityContract.mjs';
import { REASON_CODES } from './contracts.mjs';

export const FACT_LIMIT = 128;
const PHRASES = Object.freeze({
  hold_position: 'Wait here', accompany: 'Follow me', resume_previous: 'Resume previous activity', sit_here: 'Sit here',
  running: 'Running', paused: 'Paused', resuming: 'Resuming', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
  abandoned: 'Stopped', expired: 'Timed out', superseded: 'Replaced', admitting: 'Starting',
});

export class ActivityFacts {
  constructor(id = () => '', now = () => Date.now()) { this.id = id; this.now = now; this.facts = []; }
  record(partial,scope=null) {
    const fact = {
      factVersion: 1, factId: this.id(), characterId: partial.characterId, activityId: partial.activityId, goalId: partial.goalId,
      kind: partial.kind, intent: partial.intent, placeLabel: partial.placeLabel || null,
      evidence: partial.evidence || 'none', reason: partial.reason || null, atMs: partial.atMs ?? this.now(),
    };
    if ((fact.kind === 'arrived' || fact.kind === 'completed') && fact.evidence !== 'world_strong') fact.kind = 'mode_established';
    const host=readHostContext(scope);
    if(host && isUuid(scope.encounterId) && isUuid(scope.incarnationId))fact.provenance=Object.freeze({...host,encounterId:scope.encounterId,incarnationId:scope.incarnationId});
    const frozen=immutableSnapshot(fact);
    this.facts.push(frozen);
    if (this.facts.length > FACT_LIMIT) this.facts.splice(0, this.facts.length - FACT_LIMIT);
    return frozen;
  }
  clear() {this.facts=[];}
  retireEncounter(encounterId) {this.facts=this.facts.filter(fact=>fact.provenance?.encounterId!==encounterId);}
  factsForCharacter(binding) {
    if(!isUuid(binding?.characterId) || !isUuid(binding?.encounterId) || !isUuid(binding?.incarnationId) || !readHostContext(binding.hostContext))return immutableSnapshot([]);
    return immutableSnapshot(this.facts.filter(fact=>fact.characterId===binding.characterId && fact.provenance?.encounterId===binding.encounterId && fact.provenance?.incarnationId===binding.incarnationId && sameHostContext(fact.provenance,binding.hostContext)).slice(-16));
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
