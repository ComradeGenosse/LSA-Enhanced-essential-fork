import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { immutableSnapshot } from '../context/turnSnapshot.mjs';
import { UUID, OWNER_NAMESPACE, MAX_CHARACTERS, MAX_STORE_BYTES, exactObject, boundedKey, positive, aliasKey } from './identityContract.mjs';

export function validateStore(value, worldProfileId) {
  const invalid = () => { throw new TypeError('invalid_identity_store'); };
  if (!exactObject(value, ['schemaVersion','worldProfileId','registryRevision','characters']) || value.schemaVersion !== 1 ||
      value.worldProfileId !== worldProfileId || !UUID.test(value.worldProfileId) ||
      !Number.isSafeInteger(value.registryRevision) || value.registryRevision < 0 ||
      !Array.isArray(value.characters) || value.characters.length > MAX_CHARACTERS) invalid();
  const ids = new Set(), aliases = new Set();
  for (const record of value.characters) {
    if (!exactObject(record, ['characterId','recordRevision','createdAtUtc','updatedAtUtc','aliases','voiceAssignment']) ||
        !UUID.test(record.characterId) || ids.has(record.characterId) || !positive(record.recordRevision) || record.recordRevision > value.registryRevision ||
        ![record.createdAtUtc,record.updatedAtUtc].every(time => typeof time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(time) && Number.isFinite(Date.parse(time))) ||
        !Array.isArray(record.aliases) || record.aliases.length !== 1) invalid();
    ids.add(record.characterId);
    for (const alias of record.aliases) {
      if (!exactObject(alias, ['sourceNamespace','sourceKey','sourceContractVersion']) || alias.sourceNamespace !== OWNER_NAMESPACE ||
          !boundedKey(alias.sourceKey) || alias.sourceContractVersion !== 1) invalid();
      const key = aliasKey({ ...alias, worldProfileId });
      if (aliases.has(key)) invalid();
      aliases.add(key);
    }
    const voice = record.voiceAssignment;
    if (voice !== null && (!exactObject(voice, ['assignmentVersion','profileId','provider','voice','poolVersion']) ||
        voice.assignmentVersion !== 1 || !/^vp_[a-f0-9]{20}$/.test(voice.profileId) || voice.provider !== 'openai' ||
        !/^[a-z][a-z0-9_-]{0,31}$/.test(voice.voice) || !/^[a-f0-9]{64}$/.test(voice.poolVersion))) invalid();
  }
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_STORE_BYTES) invalid();
  return immutableSnapshot(value);
}

export class CharacterStore {
  #queue = Promise.resolve();
  #fs;
  #loaded = false;
  #available = true;
  constructor({ filePath, worldProfileId, fileSystem = fs }) {
    this.filePath = path.resolve(filePath); this.worldProfileId = worldProfileId; this.#fs = fileSystem;
  }
  get available() { return this.#available; }
  #serial(operation) {
    const job = this.#queue.then(operation);
    this.#queue = job.catch(() => {});
    return job;
  }
  async #read(file) {
    const stat = await this.#fs.stat(file);
    if (!stat.isFile() || stat.size > MAX_STORE_BYTES) throw new Error('invalid_identity_store');
    return validateStore(JSON.parse(await this.#fs.readFile(file, 'utf8')), this.worldProfileId);
  }
  load() { return this.#serial(async () => {
    if (!this.#available || this.#loaded) throw new Error('identity_store_unavailable');
    try {
      let value;
      try { value = await this.#read(this.filePath); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error; // Preserve corrupt/unsupported primary, even if backup exists.
        try {
          value = await this.#read(this.filePath + '.bak');
          await this.#commit(value, false); // Recovery only when the primary is absent.
        } catch (backupError) {
          if (backupError.code !== 'ENOENT') throw backupError;
          value = validateStore({ schemaVersion: 1, worldProfileId: this.worldProfileId, registryRevision: 0, characters: [] }, this.worldProfileId);
        }
      }
      this.#loaded = true;
      return value;
    } catch { this.#available = false; throw new Error('identity_store_unavailable'); }
  }); }
  save(value) { return this.#serial(async () => {
    if (!this.#loaded || !this.#available) throw new Error('identity_store_unavailable');
    try { await this.#commit(validateStore(value, this.worldProfileId), true); }
    catch { this.#available = false; throw new Error('identity_store_unavailable'); }
  }); }
  async #replace(from, to) {
    for (let attempt = 0; ; attempt++) {
      try { await this.#fs.rename(from, to); return; }
      catch (error) {
        if (!['EPERM','EBUSY','EACCES'].includes(error.code) || attempt === 2) throw error;
        await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }
  }
  async #commit(value, backup) {
    await this.#fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = this.filePath + '.' + randomUUID() + '.tmp';
    const backupTemp = temp + '.bak';
    let handle;
    try {
      handle = await this.#fs.open(temp, 'wx');
      await handle.writeFile(JSON.stringify(value) + '\n', 'utf8');
      await handle.sync(); await handle.close(); handle = null;
      if (backup) {
        try {
          await this.#fs.copyFile(this.filePath, backupTemp);
          const backupHandle = await this.#fs.open(backupTemp, 'r+');
          try { await backupHandle.sync(); } finally { await backupHandle.close(); }
          await this.#replace(backupTemp, this.filePath + '.bak');
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      // Node's Windows rename uses replace-existing; never unlink the primary.
      await this.#replace(temp, this.filePath);
    } finally {
      await handle?.close().catch(() => {});
      await this.#fs.rm(temp, { force: true }).catch(() => {});
      await this.#fs.rm(backupTemp, { force: true }).catch(() => {});
    }
  }
}
