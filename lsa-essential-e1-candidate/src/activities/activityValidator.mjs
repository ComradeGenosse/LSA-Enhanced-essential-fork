import { validateProposal } from './contracts.mjs';
import { ACT2_INTENTS, templateFor } from './intentTemplates.mjs';

// ACT2 admits player menu assignments only. Dialogue, director and commitment sources stay closed.
export function validateAdmission(proposal, { registry, mode, hello, passedProbes } = {}) {
  if (!validateProposal(proposal)) return { ok: false, reason: 'policy_denied' };
  if (proposal.source !== 'player_ux') return { ok: false, reason: 'policy_denied' };
  if (!ACT2_INTENTS.includes(proposal.intent)) return { ok: false, reason: 'capability_unavailable' };
  const template = templateFor(proposal.intent);
  const capability = template?.capability;
  if (!capability) return { ok: false, reason: 'capability_unavailable' };
  const priority = 'player_direct';
  if (!registry.enabled(capability, { mode, hello, requested: [capability], passedProbes, source: 'player_ux', priority })) {
    const row = registry.get(capability);
    if (!row || row.phase !== 'ACT2') return { ok: false, reason: 'capability_unavailable' };
    if (mode !== 'on') return { ok: false, reason: 'capability_disabled' };
    if (row.probes.some(probe => !(passedProbes || []).includes(probe))) return { ok: false, reason: 'capability_disabled' };
    return { ok: false, reason: 'capability_disabled' };
  }
  return { ok: true, capability, priority, proposal: { ...proposal, priority } };
}
