import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isUuid, exactObject } from '../identity/identityContract.mjs';
import { immutableSnapshot } from '../context/turnSnapshot.mjs';

export const PROFILE_SCHEMA = 1;
export const PROFILE_LIMITS = Object.freeze({ characters: 500, bytes: 8 * 1024 * 1024, memories: 128, memoryChars: 1200 });
// Future migrations must be explicit, pure, bounded, and validate their output.
// Unknown versions are preserved on disk and disabled, never guessed or rewritten.
export const PROFILE_MIGRATIONS = new Map();
const fail = code => { throw new Error(code); };
const text = (value, max, empty = true) => typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const strings = (value, count, chars) => Array.isArray(value) && value.length <= count && value.every(item => text(item, chars, false)) && new Set(value).size === value.length;
const keys = ['profileVersion','characterId','revision','name','nicknames','gender','ageBand','modelHash','appearance','biography','personality','relationship','playerNotes','voiceReference','status','createdAtUtc','updatedAtUtc','promotion','memories'];
export function validateAppearance(value) {
  if (!exactObject(value, ['version','components','props']) || value.version !== 1) fail('invalid_appearance');
  for (const [group, limit, fields] of [['components',12,['slot','drawable','texture','palette']], ['props',8,['slot','drawable','texture']]]) {
    if (!Array.isArray(value[group]) || value[group].length > limit || new Set(value[group].map(item => item?.slot)).size !== value[group].length) fail('invalid_appearance');
    for (const item of value[group]) if (!exactObject(item, fields) || !integer(item.slot,0,limit - 1) || !integer(item.drawable,group === 'props' ? -1 : 0,4095) || !integer(item.texture,0,4095) || (group === 'components' && !integer(item.palette,0,3))) fail('invalid_appearance');
  }
  return immutableSnapshot(value);
}
function voice(value) {
  return value === null || exactObject(value,['assignmentVersion','profileId','provider','voice','poolVersion']) && value.assignmentVersion === 1 && /^vp_[a-f0-9]{20}$/.test(value.profileId) && value.provider === 'openai' && /^[a-z][a-z0-9_-]{0,31}$/.test(value.voice) && /^[a-f0-9]{64}$/.test(value.poolVersion);
}
export function validateMemory(value) {
  if (!exactObject(value,['memoryId','text','category','createdAtUtc','updatedAtUtc','worldContext','importance','source','relatedCharacterIds','editable','playerCreated','selectedForContext']) || !isUuid(value.memoryId) || !text(value.text,PROFILE_LIMITS.memoryChars,false) || !['note','relationship','promise','event','biography','other'].includes(value.category) || !timestamp(value.createdAtUtc) || !timestamp(value.updatedAtUtc) || value.updatedAtUtc < value.createdAtUtc || !integer(value.importance,0,100) || !['player','import','event'].includes(value.source) || !Array.isArray(value.relatedCharacterIds) || value.relatedCharacterIds.length > 8 || !value.relatedCharacterIds.every(isUuid) || new Set(value.relatedCharacterIds).size !== value.relatedCharacterIds.length || !['editable','playerCreated','selectedForContext'].every(key => typeof value[key] === 'boolean')) fail('invalid_memory');
  if (value.worldContext !== null && (!exactObject(value.worldContext,['gameTime','location']) || (value.worldContext.gameTime !== null && !integer(value.worldContext.gameTime,0,0xffffffff)) || !text(value.worldContext.location,120))) fail('invalid_memory');
  return immutableSnapshot(value);
}
export function validateProfile(value) {
  if (!exactObject(value,keys) || value.profileVersion !== 1 || !isUuid(value.characterId) || !integer(value.revision,1,Number.MAX_SAFE_INTEGER) || !text(value.name,80,false) || !strings(value.nicknames,8,80) || !['male','female','unknown'].includes(value.gender) || !['young','adult','mature','older','senior','unknown'].includes(value.ageBand) || !integer(value.modelHash,1,0xffffffff) || !text(value.biography,1200) || !exactObject(value.personality,['description','traits']) || !text(value.personality.description,1200) || !strings(value.personality.traits,12,80) || !exactObject(value.relationship,['state','description']) || !['associate','friend','trusted','strained','neutral'].includes(value.relationship.state) || !text(value.relationship.description,600) || !text(value.playerNotes,2400) || !voice(value.voiceReference) || !['available','dead','retired'].includes(value.status) || !timestamp(value.createdAtUtc) || !timestamp(value.updatedAtUtc) || value.updatedAtUtc < value.createdAtUtc || !exactObject(value.promotion,['source','ownerAlias','promotedAtUtc']) || value.promotion.source !== 'player' || !/^promoted\.[0-9a-f-]{36}$/.test(value.promotion.ownerAlias) || !isUuid(value.promotion.ownerAlias.slice(9)) || !timestamp(value.promotion.promotedAtUtc) || !Array.isArray(value.memories) || value.memories.length > PROFILE_LIMITS.memories) fail('invalid_character_profile');
  validateAppearance(value.appearance);
  const memoryIds = new Set();
  for (const memory of value.memories) { validateMemory(memory); if (memoryIds.has(memory.memoryId)) fail('invalid_memory'); memoryIds.add(memory.memoryId); }
  return immutableSnapshot(value);
}
export function validateProfiles(value, worldProfileId) {
  if (!exactObject(value,['schemaVersion','worldProfileId','revision','profiles']) || value.schemaVersion !== PROFILE_SCHEMA || !isUuid(worldProfileId) || value.worldProfileId !== worldProfileId || !integer(value.revision,0,Number.MAX_SAFE_INTEGER) || !Array.isArray(value.profiles) || value.profiles.length > PROFILE_LIMITS.characters) fail('invalid_profile_store');
  const ids = new Set(), aliases = new Set();
  for (const profile of value.profiles) {
    validateProfile(profile);
    if (ids.has(profile.characterId) || aliases.has(profile.promotion.ownerAlias) || profile.revision > value.revision) fail('invalid_profile_store');
    ids.add(profile.characterId); aliases.add(profile.promotion.ownerAlias);
  }
  if (Buffer.byteLength(JSON.stringify(value)) > PROFILE_LIMITS.bytes) fail('profile_store_limit');
  return immutableSnapshot(value);
}

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
