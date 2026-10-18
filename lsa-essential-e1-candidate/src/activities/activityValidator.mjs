import { ACT3_CAPABILITY_IDS, ACT6_CAPABILITY_IDS, PRIORITIES, validateProposal } from './contracts.mjs';
import { planSpec } from './intentTemplates.mjs';

// Higher number outranks. A lower-priority admission never interrupts a higher-priority live activity.
const RANK = Object.freeze({ player_direct: 5, player_standing: 4, director_urgent: 3, director_routine: 2, ambient: 1 });
export function priorityRank(priority) { return RANK[priority] ?? 0; }
export function outranks(live, incoming) { return priorityRank(live) > priorityRank(incoming); }

// Admits player menu assignments only. Dialogue, director and commitment sources stay closed until ACT4 and later.
// Every capability a plan would execute must be enabled; ACT3 capabilities additionally need the local per-capability gate.
export function validateAdmission(proposal, { registry, mode, hello, passedProbes, act3Capabilities, act6Capabilities, act5 = false, playerApproved = false } = {}) {
  if (!validateProposal(proposal)) return { ok: false, reason: 'policy_denied' };
  const dialogue = proposal.source === 'player_dialogue';
  // An authenticated, publication-approved direct ACT6 order is distinct from
  // optional ACT5 model suggestions. Other dialogue plans still require ACT5.
  const directNavigation = ['go_to_place', 'vehicle_trip', 'move_to_and_hold'].includes(proposal.intent);
  if (dialogue ? !((act5 || directNavigation) && playerApproved && proposal.priority === 'player_direct') : proposal.source !== 'player_ux')
    return { ok: false, reason: 'policy_denied' };
  const spec = planSpec(proposal.intent, proposal.slots);
  if (spec.reason) return { ok: false, reason: spec.reason };
  const priority = 'player_direct';
  if (!PRIORITIES.includes(priority)) return { ok: false, reason: 'policy_denied' };
  const capabilities = spec.steps.map(step => step.capability);
  for (const capability of capabilities) {
    const row = registry.get(capability);
    if (!row || !['ACT2','ACT3','ACT6'].includes(row.phase)) return { ok: false, reason: 'capability_unavailable' };
    if (!row.allowedSources.includes(proposal.source) || !row.allowedPriority.includes(priority)) return { ok: false, reason: 'policy_denied' };
    if (mode !== 'on') return { ok: false, reason: 'capability_disabled' };
    if (ACT3_CAPABILITY_IDS.includes(capability) && !(act3Capabilities || []).includes(capability)) return { ok: false, reason: 'capability_disabled' };
    if (ACT6_CAPABILITY_IDS.includes(capability) && !(act6Capabilities || []).includes(capability)) return { ok: false, reason: 'capability_disabled' };
    if (!registry.enabled(capability, { mode, hello, requested: [capability], passedProbes, source: proposal.source, priority })) return { ok: false, reason: 'capability_disabled' };
  }
  return { ok: true, capability: capabilities[0], capabilities, priority, proposal: { ...proposal, priority } };
}
