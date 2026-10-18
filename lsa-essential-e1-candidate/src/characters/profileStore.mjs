// Essential compatibility surface: validation is shared with standalone.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { addProfile, editProfile, changeMemory, removeProfile } from '../../../lsa-shared-brain/src/characters/profileCommands.mjs';
import { PROFILE_SCHEMA, PROFILE_LIMITS, PROFILE_MIGRATIONS, validateAppearance, validateMemory, validateProfile, validateProfiles } from '../../../lsa-shared-brain/src/characters/profileSchema.mjs';
export { PROFILE_SCHEMA, PROFILE_LIMITS, PROFILE_MIGRATIONS, validateAppearance, validateMemory, validateProfile, validateProfiles } from '../../../lsa-shared-brain/src/characters/profileSchema.mjs';
const fail = code => { throw new Error(code); };

export class ProfileStore {
  #queue = Promise.resolve(); #loading; #data; #available = true;
  constructor({ filePath, worldProfileId, fileSystem = fs }) { this.filePath = path.resolve(filePath); this.worldProfileId = worldProfileId; this.fs = fileSystem; }
  // Legacy global JSON profiles do not assert a GTA save lineage.
  get activeTimelineId() { return null; }
  get timelineWritable() { return false; }
  get timelineSourceStatus() { return 'unavailable'; }
  get available() { return this.#available; }
  get loaded() { return !!this.#data; }
  #serial(operation) { const job = this.#queue.then(operation); this.#queue = job.catch(() => {}); return job; }
  async #read(file) {
    const stat = await this.fs.stat(file);
    if (!stat.isFile() || stat.size > PROFILE_LIMITS.bytes) fail('invalid_profile_store');
    let value = JSON.parse(await this.fs.readFile(file,'utf8'));
    if (value.schemaVersion !== PROFILE_SCHEMA) {
      const migrate = PROFILE_MIGRATIONS.get(value.schemaVersion);
      if (!migrate) fail('unsupported_profile_version');
      value = migrate(value);
    }
    return validateProfiles(value,this.worldProfileId);
  }
  initialize() { return this.#loading ||= this.#serial(async () => {
    try {
      let data;
      try { data = await this.#read(this.filePath); }
      catch (error) {
        if (error.code !== 'ENOENT') throw error;
        try { data = await this.#read(this.filePath + '.bak'); await this.#commit(data,false); }
        catch (backupError) {
          if (backupError.code !== 'ENOENT') throw backupError;
          data = validateProfiles({ schemaVersion:1,worldProfileId:this.worldProfileId,revision:0,profiles:[] },this.worldProfileId);
        }
      }
      this.#data = data;
      return data;
    } catch { this.#available = false; fail('profile_store_unavailable'); }
  }); }
  list() { return this.#data?.profiles || Object.freeze([]); }
  get(characterId) { return this.list().find(profile => profile.characterId === characterId) || null; }
  async #replace(from,to) {
    for (let attempt = 0;; attempt++) try { await this.fs.rename(from,to); return; }
    catch (error) { if (!['EPERM','EACCES','EBUSY'].includes(error.code) || attempt === 2) throw error; await new Promise(resolve => setTimeout(resolve,10 * (attempt + 1))); }
  }
  async #commit(data,backup = true) {
    await this.fs.mkdir(path.dirname(this.filePath),{ recursive:true });
    const temporary = this.filePath + '.' + randomUUID() + '.tmp';
    let handle;
    try {
      handle = await this.fs.open(temporary,'wx'); await handle.writeFile(JSON.stringify(data) + '\n','utf8'); await handle.sync(); await handle.close(); handle = null;
      if (backup) try {
        await this.fs.copyFile(this.filePath,temporary + '.bak');
        const backupHandle = await this.fs.open(temporary + '.bak','r+');
        try { await backupHandle.sync(); } finally { await backupHandle.close(); }
        await this.#replace(temporary + '.bak',this.filePath + '.bak');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      await this.#replace(temporary,this.filePath);
    } finally { await handle?.close().catch(() => {}); await this.fs.rm(temporary,{force:true}).catch(() => {}); await this.fs.rm(temporary + '.bak',{force:true}).catch(() => {}); }
  }
  async #mutate(change) {
    await this.initialize();
    return this.#serial(async () => {
      if (!this.#available) fail('profile_store_unavailable');
      const profiles = change(this.#data.profiles);
      const next = validateProfiles({ ...this.#data, revision:this.#data.revision + 1,profiles },this.worldProfileId);
      try { await this.#commit(next); } catch { this.#available = false; fail('profile_store_unavailable'); }
      this.#data = next;
      return next;
    });
  }
  async create(profile) {
    validateProfile(profile);
    const next = await this.#mutate(profiles => addProfile(profiles,profile));
    return next.profiles.find(item => item.characterId === profile.characterId);
  }
  async edit(characterId,patch,expectedRevision) {
    await this.#mutate(profiles => editProfile(profiles,characterId,patch,expectedRevision));
    const profile = this.get(characterId);
    if (!profile) fail('character_missing');
    return profile;
  }
  async memory(characterId,operation,args = {}) {
    let changedId = args.memoryId;
    await this.#mutate(profiles => {
      const result = changeMemory(profiles,characterId,operation,args);
      changedId = result.memoryId;
      return result.profiles;
    });
    return {profile:this.get(characterId),memoryId:changedId};
  }
  async remove(characterId,confirmation,expectedRevision) {
    await this.#mutate(profiles => removeProfile(profiles,characterId,confirmation,expectedRevision));
    return true;
  }
}
