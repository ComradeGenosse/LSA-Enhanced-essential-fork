import { randomUUID } from 'node:crypto';
import { immutableSnapshot } from '../context/turnSnapshot.mjs';
import { MAX_CHARACTERS, aliasKey, validateClaim } from './identityContract.mjs';

export class CharacterRegistry {
  #data = null;
  #queue = Promise.resolve();
  #loading = null;
  constructor(store) { this.store = store; }
  initialize() { return this.#loading ||= this.store.load().then(data => { this.#data = data; return true; }); }
  resolveOrCreate(claim, makeVoice = null, isCurrent = () => true) {
    const job = this.#queue.then(async () => {
      await this.initialize();
      if (!validateClaim(claim, { worldProfileId: this.store.worldProfileId })) throw new Error('invalid_identity_claim');
      if (!this.store.available || !isCurrent()) throw new Error('identity_store_unavailable');
      let record = this.#data.characters.find(record => record.aliases.some(alias => aliasKey({ ...alias, worldProfileId: this.#data.worldProfileId }) === aliasKey(claim)));
      if (record && (record.voiceAssignment || !makeVoice)) return record;
      if (!record && this.#data.characters.length >= MAX_CHARACTERS) throw new Error('identity_store_unavailable');
      const now = new Date().toISOString();
      const characterId = record?.characterId || randomUUID();
      const voiceAssignment = record?.voiceAssignment || (makeVoice ? makeVoice(characterId) : null);
      if (!isCurrent()) throw new Error('native_stale');
      record = immutableSnapshot({ characterId, recordRevision: (record?.recordRevision || 0) + 1,
        createdAtUtc: record?.createdAtUtc || now, updatedAtUtc: now,
        aliases: record?.aliases || [{ sourceNamespace: claim.sourceNamespace, sourceKey: claim.sourceKey, sourceContractVersion: claim.sourceContractVersion }], voiceAssignment });
      const next = immutableSnapshot({ ...this.#data, registryRevision: this.#data.registryRevision + 1,
        characters: [...this.#data.characters.filter(item => item.characterId !== characterId), record] });
      await this.store.save(next);
      this.#data = next; // Publish only after durable write. Caller still rechecks native/owner authority.
      return record;
    });
    this.#queue = job.catch(() => {});
    return job;
  }
}
