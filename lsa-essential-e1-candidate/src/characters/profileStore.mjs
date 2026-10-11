// Essential compatibility surface: validation is shared with standalone.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isUuid } from '../identity/identityContract.mjs';
import { PROFILE_SCHEMA, PROFILE_LIMITS, PROFILE_MIGRATIONS, validateAppearance, validateMemory, validateProfile, validateProfiles } from '../../../lsa-shared-brain/src/characters/profileSchema.mjs';
export { PROFILE_SCHEMA, PROFILE_LIMITS, PROFILE_MIGRATIONS, validateAppearance, validateMemory, validateProfile, validateProfiles } from '../../../lsa-shared-brain/src/characters/profileSchema.mjs';
const fail = code => { throw new Error(code); };

export class ProfileStore {
  #queue = Promise.resolve(); #loading; #data; #available = true;
  constructor({ filePath, worldProfileId, fileSystem = fs }) { this.filePath = path.resolve(filePath); this.worldProfileId = worldProfileId; this.fs = fileSystem; }
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
    const next = await this.#mutate(profiles => {
      const existing = profiles.find(item => item.characterId === profile.characterId);
      if (existing) { if (existing.promotion.ownerAlias !== profile.promotion.ownerAlias) fail('ownership_conflict'); return profiles; }
      return [...profiles,profile];
    });
    return next.profiles.find(item => item.characterId === profile.characterId);
  }
  async edit(characterId,patch,expectedRevision) {
    const allowed = ['name','nicknames','biography','personality','relationship','playerNotes','status'];
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !allowed.includes(key))) fail('invalid_profile_edit');
    await this.#mutate(profiles => { if (!profiles.some(profile => profile.characterId === characterId)) fail('character_missing'); return profiles.map(profile => {
      if (profile.characterId !== characterId) return profile;
      if (profile.revision !== expectedRevision) fail('profile_revision_conflict');
      return validateProfile({ ...profile,...patch,revision:profile.revision + 1,updatedAtUtc:new Date().toISOString() });
    }); });
    const profile = this.get(characterId); if (!profile) fail('character_missing'); return profile;
  }
  async memory(characterId,operation,{ memoryId,patch = {},expectedRevision } = {}) {
    if (!['create','edit','delete'].includes(operation)) fail('invalid_memory_operation');
    const allowed = ['text','category','worldContext','importance','relatedCharacterIds','selectedForContext'];
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).some(key => !allowed.includes(key))) fail('invalid_memory_edit');
    let changedId = memoryId;
    await this.#mutate(profiles => {
      if (!profiles.some(profile => profile.characterId === characterId)) fail('character_missing');
      return profiles.map(profile => {
        if (profile.characterId !== characterId) return profile;
        if (profile.revision !== expectedRevision) fail('profile_revision_conflict');
        const now = new Date().toISOString();
        let memories;
        if (operation === 'create') {
          changedId = randomUUID();
          const memory = validateMemory({ memoryId:changedId,text:'',category:'note',createdAtUtc:now,updatedAtUtc:now,worldContext:null,importance:50,source:'player',relatedCharacterIds:[],editable:true,playerCreated:true,selectedForContext:false,...patch });
          memories = [...profile.memories,memory];
        } else {
          const memory = profile.memories.find(item => item.memoryId === memoryId);
          if (!memory) fail('memory_missing');
          if (!memory.editable) fail('memory_not_editable');
          memories = operation === 'delete' ? profile.memories.filter(item => item.memoryId !== memoryId) : profile.memories.map(item => item.memoryId === memoryId ? validateMemory({ ...item,...patch,updatedAtUtc:now }) : item);
        }
        return validateProfile({ ...profile,memories,revision:profile.revision + 1,updatedAtUtc:now });
      });
    });
    return { profile:this.get(characterId),memoryId:changedId };
  }
  async remove(characterId,confirmation,expectedRevision) {
    if (confirmation !== characterId || !isUuid(characterId)) fail('explicit_confirmation_required');
    await this.#mutate(profiles => {
      const profile = profiles.find(item => item.characterId === characterId);
      if (!profile) fail('character_missing');
      if (profile.revision !== expectedRevision) fail('profile_revision_conflict');
      return profiles.filter(item => item.characterId !== characterId);
    });
    return true;
  }
}
