import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { CharacterService,normalizeCharacterConfig } from '../src/characters/characterService.mjs';
import { ProfileStore } from '../src/characters/profileStore.mjs';
import { bindTrustedTimelineSource } from '../src/characters/timelineSourceBridge.mjs';
import { createEssentialMemoryStorage } from '../src/characters/memoryStorageAdapter.mjs';
import { profile } from './p2-fixtures.mjs';
import { worldProfileId } from './identity-fixtures.mjs';

const host=(hostRunId=randomUUID(),worldEpoch=1)=>({hostContextVersion:1,hostRunId,worldEpoch});
async function workspace(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lsa-ea6-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return {root,json:path.join(root,'profiles.v1.json'),db:path.join(root,'profiles.v2.sqlite')};
}
function emitter(){
  const hosts=new Set(),boundaries=new Set();
  return {
    subscribeVerifiedHostContext(cb){hosts.add(cb);return()=>hosts.delete(cb);},
    subscribeWorldBoundary(cb){boundaries.add(cb);return()=>boundaries.delete(cb);},
    host(x){for(const cb of hosts)cb(x);},
    boundary(x){for(const cb of boundaries)cb(x);}
  };
}
test('EA6 P2 constructor selects real M1 core only in explicit SQLite mode',async t=>{
  const p=await workspace(t);
  const common={persistentIdentity:{worldProfileId,storePath:path.join(p.root,'identity.json')}};
  const nativeOwner={request:async()=>({})};
  const json=new CharacterService({...common,promotedCharacters:normalizeCharacterConfig({storePath:p.json})},
    {identityService:{},nativeOwner});
  assert.ok(json.store instanceof ProfileStore);
  assert.equal(json.store.timelineSourceStatus,'unavailable');
  assert.equal(json.store.timelineWritable,false);
  const sqlite=new CharacterService({...common,promotedCharacters:normalizeCharacterConfig({
    storageMode:'sqlite',storePath:p.json,sqliteStorePath:p.db
  })},{identityService:{},nativeOwner});
  assert.equal(sqlite.store.filePath,path.resolve(p.db));
  assert.equal(sqlite.store.timelineWritable,false);
  assert.equal(sqlite.store.timelineSourceStatus,'unavailable');
  assert.equal(await sqlite.initialize(),true);
  assert.equal(sqlite.store.loaded,true);
  await sqlite.closeStorage();
});
test('EA6 imports revisions, notes and ElevenLabs voice assignments without modifying original',async t=>{
  const p=await workspace(t);
  const json=new ProfileStore({filePath:p.json,worldProfileId});
  await json.initialize();
  const incoming=profile();
  const eleven={...incoming,voiceReference:{
    assignmentVersion:3,provider:'elevenlabs',voice:'alloy',
    profileId:'vp_1234567890abcdef1234',poolVersion:'a'.repeat(64)
  }};
  const created=await json.create(eleven);
  const updated=await json.edit(created.characterId,{playerNotes:'Preserve this exact manual note'},created.revision);
  const memory=await json.memory(created.characterId,'create',{
    expectedRevision:updated.revision,patch:{text:'Remember my dog',selectedForContext:true}
  });
  const before=await fs.readFile(p.json,'utf8');
  const sqlite=createEssentialMemoryStorage({filePath:p.db,legacyJsonPath:p.json,worldProfileId,sourceRequired:true});
  await sqlite.initialize();
  assert.deepEqual(sqlite.get(created.characterId),memory.profile);
  assert.equal(sqlite.snapshot.revision,memory.profile.revision);
  assert.equal((await fs.readFile(p.json,'utf8')),before);
  assert.equal((await fs.readFile(p.json+'.pre-sqlite.bak','utf8')),before);
  await assert.rejects(sqlite.edit(created.characterId,{name:'stale'},1),/profile_revision_conflict/);
  const exportResult=await sqlite.exportRollbackSnapshot();
  assert.equal(JSON.parse(await fs.readFile(exportResult.path,'utf8')).profiles[0].playerNotes,'Preserve this exact manual note');
  assert.equal(sqlite.activeTimelineId,null);
  assert.equal(sqlite.timelineWritable,false);
  await sqlite.close();
  const reopened=createEssentialMemoryStorage({filePath:p.db,legacyJsonPath:p.json,worldProfileId,sourceRequired:true});
  await reopened.initialize();
  assert.equal(reopened.get(created.characterId).memories[0].text,'Remember my dog');
  assert.equal(reopened.timelineSourceStatus,'unavailable');
  await reopened.close();
});
test('EA6 requires existing timeline, exact manual confirmation, authenticated source; queued writes fail closed',async t=>{
  const p=await workspace(t);
  const store=createEssentialMemoryStorage({filePath:p.db,worldProfileId,sourceRequired:true});
  const source=emitter();const bridge=bindTrustedTimelineSource({store,intelligenceClient:source});
  try {
    await store.initialize();
    const id=await store.createTimeline({label:'Explicit save A'});
    assert.equal(store.activeTimelineId,null);
    await assert.rejects(store.confirmTimeline(id,{confirmation:id}),/timeline_write_suspended/);
    source.host(host());
    assert.equal(store.timelineSourceStatus,'confirmation_required');
    await assert.rejects(store.confirmTimeline(id),/explicit_confirmation_required/);
    await assert.rejects(store.confirmTimeline(randomUUID(),{confirmation:randomUUID()}),/explicit_confirmation_required/);
    await store.confirmTimeline(id,{confirmation:id});
    assert.equal(store.timelineSourceStatus,'verified');
    assert.equal(store.timelineWritable,true);
    assert.equal(store.activeTimelineId,id);
    let committed=0;
    assert.equal(await store.withTimelineWrite(id,()=>++committed),1);
    const queued=store.withTimelineWrite(id,()=>++committed);
    source.boundary({reason:'clock_regression'});
    await assert.rejects(queued,/timeline_write_suspended/);
    assert.equal(committed,1);
    assert.equal(store.timelineWritable,false);
    await assert.rejects(store.confirmTimeline(id,{confirmation:id}),/timeline_write_suspended/);
    const old=host();
    source.host(old);
    await store.confirmTimeline(id,{confirmation:id});
    source.host(host(old.hostRunId,2));
    assert.equal(store.timelineWritable,false,'epoch change revokes confirmation');
    source.host(null);
    assert.equal(store.timelineSourceStatus,'unavailable');
    source.host(old);
    assert.equal(store.timelineWritable,false,'ABA reconnect cannot revive approval');
    await store.confirmTimeline(id,{confirmation:id});
    for(const reason of ['host_reload','save_fork','world_epoch','timeline_change','unknown_source']){
      source.boundary({reason});
      assert.equal(store.timelineWritable,false,reason);
      source.host(host());
      await store.confirmTimeline(id,{confirmation:id});
    }
    source.host({hostContextVersion:1,hostRunId:'bad',worldEpoch:1});
    assert.equal(store.timelineWritable,false);
  } finally {bridge.close();await store.close();}
});
test('EA6 restart keeps selected save but never persists native authorization',async t=>{
  const p=await workspace(t);
  const first=createEssentialMemoryStorage({filePath:p.db,worldProfileId,sourceRequired:true});
  await first.initialize();
  const id=await first.createTimeline({label:'Save A'});
  const source=host();first.setVerifiedHostContext(source);
  await first.confirmTimeline(id,{confirmation:id});
  assert.equal(first.timelineWritable,true);
  await first.close();
  const second=createEssentialMemoryStorage({filePath:p.db,worldProfileId,sourceRequired:true});
  await second.initialize();
  assert.equal(second.activeTimelineId,id);
  assert.equal(second.timelineSourceStatus,'unavailable');
  second.setVerifiedHostContext(source);
  assert.equal(second.timelineWritable,false);
  await second.confirmTimeline(id,{confirmation:id});
  assert.equal(second.timelineWritable,true);
  await second.close();
});
test('EA6 corrupt database and unknown schema fail closed without unsafe JSON fallback',async t=>{
  const p=await workspace(t);
  await fs.writeFile(p.json,'{"broken":true}');
  const invalid=createEssentialMemoryStorage({filePath:p.db,legacyJsonPath:p.json,worldProfileId,sourceRequired:true});
  await assert.rejects(invalid.initialize(),/legacy_profile_invalid/);
  assert.equal(await fs.readFile(p.json,'utf8'),'{"broken":true}');
  await assert.rejects(fs.stat(p.db),{code:'ENOENT'});
  const clean=createEssentialMemoryStorage({filePath:p.db,worldProfileId,sourceRequired:true});
  await clean.initialize();await clean.close();
  const sql=new DatabaseSync(p.db);sql.exec('PRAGMA user_version=99');sql.close();
  const incompatible=createEssentialMemoryStorage({filePath:p.db,legacyJsonPath:p.json,worldProfileId,sourceRequired:true});
  await assert.rejects(incompatible.initialize(),/unsupported_sqlite_profile_schema/);
  assert.equal(incompatible.timelineWritable,false);
});
test('EA6 trust bridge refuses unsupported native clients and revokes on close',async t=>{
  const p=await workspace(t);
  const store=createEssentialMemoryStorage({filePath:p.db,worldProfileId,sourceRequired:true});
  assert.throws(()=>bindTrustedTimelineSource({store,intelligenceClient:{}}),/authenticated_timeline_source_unavailable/);
  const source=emitter(),bridge=bindTrustedTimelineSource({store,intelligenceClient:source});
  await store.initialize();
  const id=await store.createTimeline({label:'Save B'});
  source.host(host());await store.confirmTimeline(id,{confirmation:id});
  assert.equal(store.timelineWritable,true);
  bridge.close();
  assert.equal(store.timelineWritable,false);
  source.host(host());
  assert.equal(store.timelineWritable,false);
  await store.close();
});

test('EA6 accepts only ordered C-13 epoch evidence before re-confirmation',async t=>{
  const p=await workspace(t);
  const store=createEssentialMemoryStorage({filePath:p.db,worldProfileId,sourceRequired:true});
  const source=emitter(),bridge=bindTrustedTimelineSource({store,intelligenceClient:source});
  try{
    await store.initialize();
    const id=await store.createTimeline({label:'Selected save'});
    const initial=host();
    source.host(initial);
    await store.confirmTimeline(id,{confirmation:id});
    assert.equal(store.timelineWritable,true);
    const next=host(initial.hostRunId,2);
    // The production C-13 callback first publishes the accepted new context.
    source.host(next);
    source.boundary({reason:'clock_regression',hostRunId:next.hostRunId,
      previousEpoch:1,worldEpoch:2});
    assert.equal(store.timelineWritable,false);
    assert.equal(store.timelineSourceStatus,'confirmation_required',
      'verified *new* epoch may be reconfirmed, but is not implicitly approved');
    await store.confirmTimeline(id,{confirmation:id});
    assert.equal(store.timelineWritable,true);
    // Forged/misordered data cannot reuse the prior confirmation.
    source.boundary({reason:'timeline_change',hostRunId:initial.hostRunId,
      previousEpoch:1,worldEpoch:2});
    assert.equal(store.timelineSourceStatus,'unavailable');
    assert.equal(store.timelineWritable,false);
  }finally{bridge.close();await store.close();}
});
test('EA6 damaged SQLite remains authoritative failure and preserves rollback data',async t=>{
  const p=await workspace(t);
  const original=new ProfileStore({filePath:p.json,worldProfileId});
  await original.initialize();await original.create(profile());
  const snapshot=await fs.readFile(p.json,'utf8');
  const first=createEssentialMemoryStorage({filePath:p.db,legacyJsonPath:p.json,
    worldProfileId,sourceRequired:true});
  await first.initialize();await first.close();
  const corruption=Buffer.from('corrupt sqlite content');
  await fs.writeFile(p.db,corruption);
  const broken=createEssentialMemoryStorage({filePath:p.db,legacyJsonPath:p.json,
    worldProfileId,sourceRequired:true});
  await assert.rejects(broken.initialize());
  assert.equal(broken.timelineWritable,false);
  assert.deepEqual(await fs.readFile(p.db),corruption);
  assert.equal(await fs.readFile(p.json,'utf8'),snapshot);
  assert.equal(await fs.readFile(p.json+'.pre-sqlite.bak','utf8'),snapshot);
});
test('EA6 does not break existing writer lock or permit concurrent cross-host writers',async t=>{
  const p=await workspace(t);
  const first=createEssentialMemoryStorage({filePath:p.db,worldProfileId,sourceRequired:true});
  const second=createEssentialMemoryStorage({filePath:p.db,worldProfileId,sourceRequired:true});
  await first.initialize();
  await assert.rejects(second.initialize(),/sqlite_writer_busy/);
  assert.ok((await fs.readFile(p.db+'.writer.lock','utf8')).trim());
  await first.close();
  const third=createEssentialMemoryStorage({filePath:p.db,worldProfileId,sourceRequired:true});
  await third.initialize();
  assert.equal(third.timelineWritable,false);
  await third.close();
});
