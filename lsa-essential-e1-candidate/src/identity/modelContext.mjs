// Native identity and turn capture evidence are private transport inputs.
export function withoutIdentityEvidence(actor) {
  if (!actor || typeof actor !== 'object') return actor;
  const reserved = ['sessionIdentity', 'turnKnowledge'];
  const has = value => value && reserved.some(key => Object.prototype.hasOwnProperty.call(value,key));
  if (!has(actor) && !has(actor.integrations) && !has(actor.integrations?.raw)) return actor;
  const clean = { ...actor };
  for (const key of reserved) delete clean[key];
  if (actor.integrations) {
    clean.integrations = { ...actor.integrations };
    for (const key of reserved) delete clean.integrations[key];
    if (actor.integrations.raw) {
      clean.integrations.raw = { ...actor.integrations.raw };
      for (const key of reserved) delete clean.integrations.raw[key];
    }
  }
  return clean;
}
