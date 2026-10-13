// M1 shared P2 mutation policy. JSON and SQLite stores invoke the SAME functions.
// No Essential, RPH, standalone, native lease, or voice-provider imports.
import { randomUUID } from 'node:crypto';
import { isUuid } from '../util/identity.mjs';
import { validateProfile, validateMemory } from './profileSchema.mjs';

const fail = code => { throw new Error(code); };
const editFields = ['name','nicknames','biography','personality','relationship','playerNotes','status'];
const memoryFields = ['text','category','worldContext','importance','relatedCharacterIds','selectedForContext'];
const validatePatch = (patch, allowed, code, requireFields = false) => {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch) ||
      (requireFields && !Object.keys(patch).length) ||
      Object.keys(patch).some(key => !allowed.includes(key))) fail(code);
};

export function addProfile(profiles, profile) {
  validateProfile(profile);
  const existing = profiles.find(item => item.characterId === profile.characterId);
  if (existing) {
    if (existing.promotion.ownerAlias !== profile.promotion.ownerAlias) fail('ownership_conflict');
    return profiles;
  }
  return [...profiles, profile];
}

export function editProfile(profiles, characterId, patch, expectedRevision, now = new Date().toISOString()) {
  validatePatch(patch, editFields, 'invalid_profile_edit', true);
  if (!profiles.some(profile => profile.characterId === characterId)) fail('character_missing');
  return profiles.map(profile => {
    if (profile.characterId !== characterId) return profile;
    if (profile.revision !== expectedRevision) fail('profile_revision_conflict');
    return validateProfile({ ...profile, ...patch, revision:profile.revision + 1, updatedAtUtc:now });
  });
}

export function changeMemory(profiles, characterId, operation, {
  memoryId, patch = {}, expectedRevision
} = {}, { now = new Date().toISOString(), newMemoryId = randomUUID() } = {}) {
  if (!['create','edit','delete'].includes(operation)) fail('invalid_memory_operation');
  validatePatch(patch, memoryFields, 'invalid_memory_edit');
  if (!profiles.some(profile => profile.characterId === characterId)) fail('character_missing');
  let changedId = memoryId;
  const next = profiles.map(profile => {
    if (profile.characterId !== characterId) return profile;
    if (profile.revision !== expectedRevision) fail('profile_revision_conflict');
    let memories;
    if (operation === 'create') {
      changedId = newMemoryId;
      const memory = validateMemory({
        memoryId:changedId,text:'',category:'note',createdAtUtc:now,updatedAtUtc:now,
        worldContext:null,importance:50,source:'player',relatedCharacterIds:[],
        editable:true,playerCreated:true,selectedForContext:false,...patch
      });
      memories = [...profile.memories,memory];
    } else {
      const memory = profile.memories.find(item => item.memoryId === memoryId);
      if (!memory) fail('memory_missing');
      if (!memory.editable) fail('memory_not_editable');
      memories = operation === 'delete'
        ? profile.memories.filter(item => item.memoryId !== memoryId)
        : profile.memories.map(item => item.memoryId === memoryId
          ? validateMemory({ ...item, ...patch, updatedAtUtc:now }) : item);
    }
    return validateProfile({ ...profile, memories, revision:profile.revision + 1, updatedAtUtc:now });
  });
  return { profiles:next, memoryId:changedId };
}

export function removeProfile(profiles, characterId, confirmation, expectedRevision) {
  if (confirmation !== characterId || !isUuid(characterId)) fail('explicit_confirmation_required');
  const profile = profiles.find(item => item.characterId === characterId);
  if (!profile) fail('character_missing');
  if (profile.revision !== expectedRevision) fail('profile_revision_conflict');
  return profiles.filter(item => item.characterId !== characterId);
}
