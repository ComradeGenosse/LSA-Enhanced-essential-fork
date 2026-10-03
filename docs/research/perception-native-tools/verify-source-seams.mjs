// Research compatibility proof. Imports real P2 validators/projection; no game,
// provider, IPC, store writes, or proposed intelligence implementation is run.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ProfileStore, validateMemory, PROFILE_LIMITS } from '../../../lsa-essential-e1-candidate/src/characters/profileStore.mjs';
import { narrativeProfile } from '../../../lsa-essential-e1-candidate/src/characters/sessionProfiles.mjs';
const now = new Date().toISOString();
const memory = () => ({ memoryId:randomUUID(), text:'Heard gunfire nearby; shooter unknown.', category:'event',
  createdAtUtc:now, updatedAtUtc:now, worldContext:{ gameTime:100, location:'Davis' }, importance:80,
  source:'event', relatedCharacterIds:[], editable:true, playerCreated:false, selectedForContext:false });
const eventMemory = validateMemory(memory());
assert.equal(eventMemory.source, 'event');
assert.equal(eventMemory.playerCreated, false);
assert.throws(() => validateMemory({ ...memory(), provenance:{ eventId:randomUUID() } }), /invalid_memory/);
const unusedStore = new ProfileStore({ filePath:'unused-research-proof.json', worldProfileId:randomUUID() });
await assert.rejects(unusedStore.memory(randomUUID(), 'create', { patch:{ text:'Event', source:'event' } }), /invalid_memory_edit/);
await assert.rejects(unusedStore.memory(randomUUID(), 'create', { patch:{ text:'Event', playerCreated:false } }), /invalid_memory_edit/);
const memories = Array.from({ length:4 }, () => ({ ...memory(), selectedForContext:true }));
const profile = { name:'Marcus', gender:'male', ageBand:'older', biography:'Civilian', personality:{ description:'', traits:[] },
  relationship:{ state:'friend', description:'' }, memories, characterId:randomUUID(), playerNotes:'Private' };
const projected = narrativeProfile(profile, true);
assert.equal(projected.memories.length, 3);
assert.equal('characterId' in projected || 'playerNotes' in projected, false);
assert.equal(PROFILE_LIMITS.memories, 128);
console.log('8 source-seam assertions passed; no game, provider, IPC, or store writes.');
