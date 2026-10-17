// Pure, host-neutral P2 profile contract. Do not import game adapters here.
import { isUuid, exactObject, immutableSnapshot } from '../util/identity.mjs';

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
  return value === null || exactObject(value,['assignmentVersion','profileId','provider','voice','poolVersion']) && ((value.assignmentVersion === 1 && value.provider === 'openai') || (value.assignmentVersion === 2 && value.provider === 'faster-qwen3-tts') || (value.assignmentVersion === 3 && value.provider === 'elevenlabs')) && /^vp_[a-f0-9]{20}$/.test(value.profileId) && /^[a-z][a-z0-9_-]{0,31}$/.test(value.voice) && /^[a-f0-9]{64}$/.test(value.poolVersion);
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

