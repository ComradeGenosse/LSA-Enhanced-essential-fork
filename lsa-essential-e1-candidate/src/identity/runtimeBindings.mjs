import { randomUUID } from 'node:crypto';
import { immutableSnapshot } from '../context/turnSnapshot.mjs';
import { MAX_CHARACTERS, sessionKey, sameAssociation, sourceAlias } from './identityContract.mjs';

// No dispatch API, no character -> ped lookup API, and no disk representation.
export class RuntimeBindings {
  #sessions = new Map();
  #characters = new Map();
  #revision = 0;
  constructor(serverRunId = randomUUID()) { this.serverRunId = serverRunId; }
  get(session) { return this.#sessions.get(sessionKey(session)) || null; }
  bind(session, claim, record, isCurrent) {
    if (!isCurrent()) return { reason: 'native_stale', binding: null };
    const existing = this.get(session);
    if (existing) return sameAssociation(existing.claim, claim) && existing.characterId === record.characterId
      ? { binding: existing } : { reason: 'incarnation_mismatch', binding: null };
    if (this.#characters.has(record.characterId)) return { reason: 'character_already_active', binding: null };
    if (this.#sessions.size >= MAX_CHARACTERS) return { reason: 'binding_limit', binding: null };
    const binding = immutableSnapshot({ pedId: session.pedId, sessionNonce: session.sessionNonce,
      serverRunId: this.serverRunId, bindingId: randomUUID(), bindingRevision: ++this.#revision,
      characterId: record.characterId, alias: sourceAlias(claim), claim });
    this.#sessions.set(sessionKey(session), binding);
    this.#characters.set(record.characterId, binding);
    return { binding, created: true };
  }
  retire(expected) {
    const current = this.get(expected);
    if (!current || current.bindingId !== expected.bindingId || current.bindingRevision !== expected.bindingRevision) return false;
    this.#sessions.delete(sessionKey(expected));
    if (this.#characters.get(current.characterId) === current) this.#characters.delete(current.characterId);
    return true;
  }
  revoke(fact) {
    const retired = [];
    for (const binding of this.#sessions.values()) {
      if (binding.pedId === fact.pedId && binding.claim.adapterEpoch === fact.adapterEpoch &&
          binding.claim.incarnationId === fact.incarnationId && binding.claim.claimRevision === fact.claimRevision && this.retire(binding)) retired.push(binding);
    }
    return retired;
  }
  values() { return [...this.#sessions.values()]; }
}
