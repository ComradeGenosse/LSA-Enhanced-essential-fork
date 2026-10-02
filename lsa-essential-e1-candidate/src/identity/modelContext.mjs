// P1 transport evidence is private. P2 projects narrative facts separately.
export function withoutIdentityEvidence(actor) {
  if (!actor?.integrations) return actor;
  const integrations = { ...actor.integrations };
  delete integrations.sessionIdentity;
  if (integrations.raw) { integrations.raw = { ...integrations.raw }; delete integrations.raw.sessionIdentity; }
  return { ...actor, integrations };
}
