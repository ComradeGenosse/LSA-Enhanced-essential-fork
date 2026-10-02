// Only P1 transport evidence is private here. General knowledge projection is P3.
export function withoutIdentityEvidence(actor) {
  if (!actor?.integrations) return actor;
  const integrations = { ...actor.integrations };
  delete integrations.sessionIdentity;
  if (integrations.raw) { integrations.raw = { ...integrations.raw }; delete integrations.raw.sessionIdentity; }
  return { ...actor, integrations };
}
