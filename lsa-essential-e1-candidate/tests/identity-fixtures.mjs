import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sameAssociation } from '../src/identity/identityContract.mjs';
export const worldProfileId = '11111111-1111-4111-8111-111111111111';
export function claim(overrides = {}) {
  return { schemaVersion: 1, sourceContractVersion: 1, worldProfileId, sourceNamespace: 'comrade.authored', sourceKey: 'companion.alex',
    adapterEpoch: '22222222-2222-4222-8222-222222222222', incarnationId: randomUUID(), claimRevision: 1, observationSequence: 1, observedGameTime: 1000, ...overrides };
}
export const identity = (pedId = '17', sessionNonce = 1, generationId = 1) => ({ pedId, sessionNonce, generationId, turnId: `turn-${pedId}-${sessionNonce}-${generationId}` });
export const actor = (pedId, evidence, extras = {}) => ({ pedId, gender: 'male', ageRange: 'old', roleName: 'Civilian',
  ...(evidence ? { integrations: { sessionIdentity: evidence } } : {}), ...extras });
export async function directory(t) {
  const directory = await mkdtemp(fileURLToPath(new URL('../.identity-test-', import.meta.url)));
  t.after(() => rm(directory, { recursive: true, force: true })); return directory;
}
export class TestOwnerEvidence {
  current = new Map(); listeners = new Set(); available = true; revoked = new Set();
  register(pedId, value = claim()) { this.current.set(pedId, value); return value; }
  async verify(pedId) {
    if (!this.available) return { kind:'unavailable' };
    const value = this.current.get(pedId);
    if (!value) return { kind:'retired' };
    value.observationSequence++;
    return { kind:'verified', claim:{ ...value } };
  }
  isCurrent(value) { return this.available && !this.revoked.has(JSON.stringify([value.adapterEpoch,value.incarnationId,value.claimRevision])); }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  fact(fact) { for (const listener of this.listeners) listener(fact); }
  retire(pedId, expected = this.current.get(pedId)) {
    this.revoked.add(JSON.stringify([expected.adapterEpoch,expected.incarnationId,expected.claimRevision]));
    if (sameAssociation(this.current.get(pedId), expected)) this.current.delete(pedId);
    this.fact({ type: 'revoke', pedId, adapterEpoch: expected.adapterEpoch, incarnationId: expected.incarnationId, claimRevision: expected.claimRevision });
  }
  close() { this.available = false; for (const value of this.current.values()) this.fact({ type: 'lost', adapterEpoch: value.adapterEpoch }); }
}
