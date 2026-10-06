const TERMINAL = new Set(['satisfied', 'failed', 'abandoned', 'expired', 'superseded', 'rejected', 'cancelled']);
export const GOAL_LIMIT = 32;
export const GOAL_KEEP_MS = 300_000;
export const GOAL_ATTEMPT_LIMIT = 4;
export const GOAL_DEADLINE_MS = 3_600_000;

export class GoalStore {
  constructor(now = () => Date.now()) { this.now = now; this.goals = []; }
  get(id) { return this.goals.find(goal => goal.goalId === id) || null; }
  forCharacter(characterId) { this.#evict(); return this.goals.filter(goal => goal.subject.characterId === characterId); }
  activeFor(characterId) { return this.forCharacter(characterId).find(goal => !TERMINAL.has(goal.status)) || null; }
  add(goal) { this.#evict(); this.goals.push(goal); this.#evict(true); return goal; }
  history(characterId) {
    return this.forCharacter(characterId).filter(goal => TERMINAL.has(goal.status)).slice(-8).map(goal => ({
      goalId: goal.goalId, intent: goal.intent, status: goal.status, reason: goal.terminalReason, atMs: goal.updatedAtMs,
    }));
  }
  #evict(force = false) {
    const now = this.now();
    this.goals = this.goals.filter(goal => !TERMINAL.has(goal.status) || now - goal.updatedAtMs < GOAL_KEEP_MS);
    while ((force || this.goals.length > GOAL_LIMIT) && this.goals.length > GOAL_LIMIT) {
      const index = this.goals.findIndex(goal => TERMINAL.has(goal.status));
      if (index < 0) break;
      this.goals.splice(index, 1);
    }
  }
}

export function makeGoal(proposal, id, now) {
  return {
    goalVersion: 1, goalId: id(), kind: 'instruction', subject: { characterId: proposal.subject.characterId },
    intent: proposal.intent, slots: proposal.slots, source: 'player_ux', priority: 'player_direct', status: 'accepted',
    resumePolicy: 'explicit_only', createdAtMs: now, acceptedAtMs: now, updatedAtMs: now, deadlineAtMs: now + GOAL_DEADLINE_MS,
    activityIds: [], terminalReason: null, commitmentId: null,
  };
}

export { TERMINAL as GOAL_TERMINAL };
