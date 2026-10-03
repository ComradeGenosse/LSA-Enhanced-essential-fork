import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { directory,worldProfileId,identity,actor } from './identity-fixtures.mjs';
import { profile,fixture } from './p2-fixtures.mjs';
import { ProfileStore,validateProfile,validateProfiles,validateMemory,PROFILE_LIMITS } from '../src/characters/profileStore.mjs';
import { SessionProfiles,narrativeProfile,narrativeProfileWithDiagnostics,CHARACTER_CANON_MAX_BYTES,CHARACTER_GROUNDING,nameKey } from '../src/characters/sessionProfiles.mjs';

test('ambient NPC keeps one application name and traits for its encounter through native session replacement',() => {
  const sessions = new SessionProfiles(),encounterId = randomUUID(),a = actor('17',null,{integrations:{characterProfile:{encounterId}}});
  const first = sessions.get(identity(),a,{voice:'onyx'});
  assert.equal(sessions.get(identity('17',9),a),first); assert.equal(first.gender,'male'); assert.equal(first.ageBand,'older'); assert.ok(Object.isFrozen(first));
});
test('active NPC names avoid each other and persistent names including nicknames',() => {
  const sessions = new SessionProfiles(),used = [];
  for (let index = 0; index < 100; index++) used.push(sessions.get(identity(String(index)),actor(String(index),null)).name);
  assert.equal(new Set(used.map(nameKey)).size,100);
  const fresh = new SessionProfiles(); fresh.reservePersistent(used.map(name => ({name,nicknames:['Chris']})));
  for (let index = 0; index < 100; index++) assert.ok(!used.includes(fresh.get(identity(String(index)),actor(String(index),null)).name));
});

test('ambient introductions prefer distinct first names and avoid persistent first names when alternatives exist',() => {
  const sessions = new SessionProfiles(); sessions.reservePersistent([{name:'Ray Rivera',nicknames:['Sam']}]);
  const firstNames = Array.from({length:26},(_,index) => sessions.get(identity(String(index)),actor(String(index),null)).name.split(' ')[0]);
  assert.equal(new Set(firstNames).size,26); assert.ok(!firstNames.includes('Ray')); assert.ok(!firstNames.includes('Sam'));
  assert.ok(sessions.get(identity('extra'),actor('extra',null)),'a bounded surname alternative is available after first names run out');
});
test('session registry is bounded, native death releases names, and session fallback detaches',() => {
  const sessions = new SessionProfiles({maxProfiles:1}),encounterId = randomUUID(),a = actor('17',null,{integrations:{characterProfile:{encounterId}}});
  assert.ok(sessions.get(identity(),a)); assert.equal(sessions.get(identity('2'),actor('2',null)),null);
  sessions.pruneNative([],sessions.encounterIds()); assert.ok(sessions.get(identity('2'),actor('2',null)));
  sessions.detach(identity('2')); assert.ok(sessions.get(identity('3'),actor('3',null)));
});
test('grounding makes authored canon authoritative while preserving capability and injection boundaries',() => {
  const narrative = narrativeProfile(new SessionProfiles().get(identity(),actor('17',null)));
  assert.ok(narrative.name); for (const word of ['player-authored promoted-character canon','authoritative','Generated Persona','willingness','capabilities','action validation','executable system']) assert.ok(CHARACTER_GROUNDING.toLowerCase().includes(word.toLowerCase()));
});
test('name generation never touches durable storage or creates a CharacterId',async t => {
  const f = await fixture(t); f.service.session(identity(),actor('17',null));
  assert.equal(f.store.list().length,0); await assert.rejects(fs.stat(f.config.persistentIdentity.storePath),{code:'ENOENT'});
});
test('profile edits and manually selected memory CRUD survive restart',async t => {
  const root = await directory(t),filePath = path.join(root,'profiles.json');
  const store = new ProfileStore({filePath,worldProfileId}); await store.initialize(); const p = await store.create(profile());
  const updated = await store.edit(p.characterId,{name:'Renamed',personality:{description:'Reserved',traits:['careful']},relationship:{state:'friend',description:'Trusts the player'},playerNotes:'Player note'},1);
  const created = await store.memory(p.characterId,'create',{expectedRevision:updated.revision,patch:{text:'Promise to meet tomorrow',category:'promise',importance:90,selectedForContext:true,worldContext:{gameTime:999,location:'Downtown'},relatedCharacterIds:[randomUUID()]}});
  const edited = await store.memory(p.characterId,'edit',{memoryId:created.memoryId,expectedRevision:created.profile.revision,patch:{text:'Meet next week'}});
  const restarted = new ProfileStore({filePath,worldProfileId}); await restarted.initialize();
  assert.equal(restarted.get(p.characterId).name,'Renamed'); assert.deepEqual(restarted.get(p.characterId).personality,updated.personality);
  assert.equal(restarted.get(p.characterId).memories[0].text,'Meet next week'); assert.equal(restarted.get(p.characterId).memories[0].memoryId,created.memoryId);
  assert.equal(restarted.get(p.characterId).memories[0].source,'player');
  const removed = await restarted.memory(p.characterId,'delete',{memoryId:created.memoryId,expectedRevision:edited.profile.revision}); assert.deepEqual(removed.profile.memories,[]);
});
test('concurrent profile writes serialize and stale revisions cannot overwrite edits',async t => {
  const f = await fixture(t),p = await f.store.create(profile());
  const results = await Promise.allSettled([f.store.edit(p.characterId,{name:'First'},1),f.store.edit(p.characterId,{name:'Second'},1)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length,1); assert.equal(f.store.get(p.characterId).name,'First');
  await assert.rejects(f.store.edit(randomUUID(),{name:'Missing'},1),/character_missing/);
});
test('profile and memory edits cannot alter native ownership, IDs, sources or evidence',async t => {
  const f = await fixture(t),p = await f.store.create(profile());
  for (const patch of [{characterId:randomUUID()},{promotion:{}},{modelHash:99},{voiceReference:null},{memories:[]},{pedId:'92'},{sessionNonce:2}]) await assert.rejects(f.store.edit(p.characterId,patch,1),/invalid_profile_edit/);
  for (const patch of [{memoryId:randomUUID()},{source:'event'},{editable:false},{createdAtUtc:'x'}]) await assert.rejects(f.store.memory(p.characterId,'create',{expectedRevision:1,patch}),/invalid_memory_edit/);
  assert.equal(f.store.get(p.characterId).revision,1);
});
test('unpromotion requires an explicit exact CharacterId confirmation and revision',async t => {
  const f = await fixture(t),p = await f.store.create(profile());
  await assert.rejects(f.store.remove(p.characterId,'yes',1),/explicit_confirmation_required/);
  await assert.rejects(f.store.remove(p.characterId,p.characterId,2),/profile_revision_conflict/);
  assert.equal(f.store.list().length,1); await f.store.remove(p.characterId,p.characterId,1); assert.equal(f.store.list().length,0);
});
for (const [label,change] of Object.entries({unknownField:p=>({...p,pedId:'17'}),invalidUuid:p=>({...p,characterId:'17'}),largeName:p=>({...p,name:'x'.repeat(81)}),largeNote:p=>({...p,playerNotes:'x'.repeat(2401)}),badModel:p=>({...p,modelHash:0}),duplicateTrait:p=>({...p,personality:{description:'',traits:['a','a']}}),runtimeStatus:p=>({...p,status:'spawned'}),badAppearance:p=>({...p,appearance:{version:1,components:[{slot:12,drawable:0,texture:0,palette:0}],props:[]}})})) test(`strict durable profile validation rejects ${label}`,()=>assert.throws(()=>validateProfile(change(profile()))));
test('strict store rejects duplicate authored aliases and independent duplicate CharacterIds',() => {
  const p = profile();
  for (const duplicate of [profile({characterId:p.characterId}),profile({promotion:p.promotion})]) assert.throws(()=>validateProfiles({schemaVersion:1,worldProfileId,revision:2,profiles:[p,duplicate]},worldProfileId));
});
test('corrupt and unsupported profile primaries are preserved even beside a valid backup',async t => {
  for (const contents of ['{broken',JSON.stringify({schemaVersion:999})]) {
    const root = await directory(t),filePath = path.join(root,'profiles.json'); await fs.writeFile(filePath,contents);
    await fs.writeFile(filePath + '.bak',JSON.stringify({schemaVersion:1,worldProfileId,revision:1,profiles:[profile()]}));
    const store = new ProfileStore({filePath,worldProfileId}); await assert.rejects(store.initialize(),/profile_store_unavailable/);
    assert.equal(await fs.readFile(filePath,'utf8'),contents); assert.equal(store.available,false);
  }
});
test('missing-primary recovery restores a valid prior revision only',async t => {
  const root = await directory(t),filePath = path.join(root,'profiles.json'),p = profile();
  await fs.writeFile(filePath + '.bak',JSON.stringify({schemaVersion:1,worldProfileId,revision:1,profiles:[p]}));
  const store = new ProfileStore({filePath,worldProfileId}); await store.initialize(); assert.deepEqual(store.get(p.characterId),p); assert.ok(await fs.stat(filePath));
});

test('failed disk replacement preserves the prior profile and never publishes an unwritten edit',async t => {
  const f = await fixture(t),p = await f.store.create(profile());
  const failing = new ProfileStore({filePath:f.store.filePath,worldProfileId,fileSystem:{...fs,async rename(from,to) {
    if (to === f.store.filePath) throw Object.assign(new Error('offline I/O failure'),{code:'EIO'});
    return fs.rename(from,to);
  }}});
  await failing.initialize(); await assert.rejects(failing.edit(p.characterId,{name:'Never written'},1),/profile_store_unavailable/);
  assert.equal(failing.get(p.characterId).name,p.name); assert.equal(failing.available,false);
  const restarted = new ProfileStore({filePath:f.store.filePath,worldProfileId}); await restarted.initialize(); assert.deepEqual(restarted.get(p.characterId),p);
  assert.ok(!(await fs.readdir(path.dirname(f.store.filePath))).some(name => name.endsWith('.tmp')));
});
test('durable store rejects excessive records, memories, related IDs and memory text',() => {
  const p = profile(); assert.throws(()=>validateProfiles({schemaVersion:1,worldProfileId,revision:1,profiles:Array(501).fill(p)},worldProfileId));
  assert.throws(()=>validateProfile({...p,memories:Array(PROFILE_LIMITS.memories + 1).fill({})}));
  assert.throws(()=>validateMemory({text:'x'.repeat(PROFILE_LIMITS.memoryChars + 1)}));
});
test('model projection is frozen, budgeted, manually selected, and excludes all P1/private fields',async t => {
  const f = await fixture(t),p = await f.store.create(profile({playerNotes:'PRIVATE NOTES',personality:{description:'x'.repeat(1200),traits:Array.from({length:12},(_,i)=>String(i).repeat(30))},biography:'b'.repeat(1200)}));
  let next = p;
  for (let i = 0; i < 5; i++) next = (await f.store.memory(p.characterId,'create',{expectedRevision:next.revision,patch:{text:('Memory '+i+' ').repeat(100),importance:i * 10,selectedForContext:i > 0}})).profile;
  const narrative = narrativeProfile(next,true),serialized = JSON.stringify(narrative);
  assert.equal(narrative.memories.length,4); assert.deepEqual(narrative.memories.map(memory=>memory.importance),[40,30,20,10]);
  assert.equal(narrative.personality.traits.length,12); assert.ok(Buffer.byteLength(serialized) <= CHARACTER_CANON_MAX_BYTES); assert.ok(Object.isFrozen(narrative));
  for (const secret of ['PRIVATE NOTES',p.characterId,p.promotion.ownerAlias,'voiceReference','worldProfileId','adapterEpoch','incarnationId','sessionNonce']) assert.ok(!serialized.includes(secret));
  assert.ok(!serialized.includes('Memory 0'));
});

test('oversized canon deterministically retains personality and higher-priority fields before memories',() => {
  const full = profile({nicknames:['Nate'],biography:'界'.repeat(1200),personality:{description:'fearless '.repeat(130),traits:Array.from({length:12},(_,i)=>`loyal ${i} `+'界'.repeat(70))},relationship:{state:'friend',description:'trusted '.repeat(80)},playerNotes:'PRIVATE NOTES',memories:Array.from({length:128},(_,i)=>({memoryId:`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`,text:`Memory ${i} `+'界'.repeat(1200),category:'note',importance:128-i,selectedForContext:true}))});
  const first = narrativeProfileWithDiagnostics(full,true),second = narrativeProfileWithDiagnostics(full,true);
  assert.deepEqual(first,second); assert.ok(Buffer.byteLength(JSON.stringify(first.narrative)) <= CHARACTER_CANON_MAX_BYTES);
  assert.equal(first.narrative.name,full.name); assert.match(first.narrative.personality.description,/fearless/);
  assert.equal(first.narrative.personality.traits.length,12); assert.equal(first.narrative.relationship.state,'friend');
  assert.match(first.narrative.biography,/界/); assert.ok(first.narrative.memories.length > 0);
  assert.equal(first.narrative.memories[0].importance,128); assert.ok(!JSON.stringify(first.narrative).includes('PRIVATE NOTES'));
  assert.ok(first.droppedMemoryCount > 0); assert.ok(Object.isFrozen(first.narrative));
});
