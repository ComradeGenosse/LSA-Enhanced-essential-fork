import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { profile } from './p2-fixtures.mjs';
import { worldProfileId } from './identity-fixtures.mjs';
import { ProfileStore, validateProfile } from '../src/characters/profileStore.mjs';
import { createEssentialMemoryStorage } from '../src/characters/memoryStorageAdapter.mjs';
import { createStandaloneMemoryStorage } from '../../lsa-standalone-companion/src/memory/memoryStorageAdapter.mjs';
import { P2SqliteProfileStore } from '../../lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
import { addProfile, editProfile, changeMemory, removeProfile } from '../../lsa-shared-brain/src/characters/profileCommands.mjs';
import { stageSharedMemory } from '../tools/stageSharedMemory.mjs';
import { startCharacterEditor } from '../src/characters/editorServer.mjs';

async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lsa-memory-portable-'));
  t.after(async () => fs.rm(root, { recursive:true, force:true }));
  return {
    root, json:path.join(root,'profiles.v1.json'),
    sqlite:path.join(root,'profiles.v2.sqlite')
  };
}

test('one shared M1 mutation policy preserves deterministic editor inputs', () => {
  const npc = profile();
  const later = new Date(Date.now()+10_000).toISOString();
  const later2 = new Date(Date.now()+11_000).toISOString();
  const first = addProfile([], npc);
  assert.deepEqual(first, [npc]);
  assert.equal(addProfile(first,npc),first);
  assert.throws(()=>addProfile(first,profile({
    characterId:npc.characterId,
    promotion:{...npc.promotion,ownerAlias:'promoted.'+randomUUID()}
  })),/ownership_conflict/);
  const edited = editProfile(first,npc.characterId,{ name:'Shared NPC' },npc.revision,later);
  assert.equal(edited[0].name,'Shared NPC');
  assert.equal(edited[0].revision,npc.revision+1);
  assert.throws(()=>editProfile(edited,npc.characterId,{name:'stale'},npc.revision),/profile_revision_conflict/);
  const added=changeMemory(edited,npc.characterId,'create',{
    expectedRevision:edited[0].revision,patch:{text:'A memorable stunt'}
  },{now:later2,newMemoryId:randomUUID()});
  assert.equal(added.profiles[0].memories.at(-1).text,'A memorable stunt');
  assert.throws(()=>removeProfile(added.profiles,npc.characterId,'wrong',added.profiles[0].revision),/explicit_confirmation_required/);
  assert.deepEqual(removeProfile(added.profiles,npc.characterId,npc.characterId,added.profiles[0].revision),[]);
});

test('Essential and standalone thin adapters resolve the same one SQLite implementation', async t => {
  const p=await workspace(t);
  const essential=createEssentialMemoryStorage({filePath:p.sqlite,worldProfileId});
  const standalone=createStandaloneMemoryStorage({filePath:p.sqlite,worldProfileId});
  assert.ok(essential instanceof P2SqliteProfileStore);
  assert.ok(standalone instanceof P2SqliteProfileStore);
  await essential.initialize();
  assert.equal(essential.loaded,true);
  assert.equal(essential.list().length,0);
  // Writers must not open the same DB concurrently through different hosts.
  await assert.rejects(standalone.initialize(),/sqlite_writer_busy/);
  const npc=validateProfile(profile());
  const created=await essential.create(npc);
  assert.equal(created.characterId,npc.characterId);
  const revised=await essential.edit(npc.characterId,{name:'Portable NPC'},created.revision);
  assert.equal(revised.name,'Portable NPC');
  const note=await essential.memory(npc.characterId,'create',{
    expectedRevision:revised.revision,patch:{text:'Remember the river jump',importance:92}
  });
  assert.equal(note.profile.memories.length,npc.memories.length+1);
  assert.equal(essential.get(npc.characterId).memories.at(-1).text,'Remember the river jump');
  await assert.rejects(essential.edit(npc.characterId,{name:'stale'},created.revision),/profile_revision_conflict/);
  await essential.close();
  const after=createStandaloneMemoryStorage({filePath:p.sqlite,worldProfileId});
  await after.initialize();
  assert.equal(after.get(npc.characterId).name,'Portable NPC');
  assert.equal(after.get(npc.characterId).memories.at(-1).text,'Remember the river jump');
  await after.memory(npc.characterId,'delete',{
    memoryId:note.memoryId,expectedRevision:note.profile.revision
  });
  const deleted=after.get(npc.characterId);
  assert.equal(deleted.memories.some(m=>m.memoryId===note.memoryId),false);
  await after.remove(npc.characterId,npc.characterId,deleted.revision);
  assert.equal(after.list().length,0);
  await after.close();
  // Both hosts can take turns; neither maintains another persistent DB.
  await fs.stat(p.sqlite);
  await assert.rejects(fs.stat(p.sqlite+'.writer.lock'),{code:'ENOENT'});
});

test('M1 SQLite explicit timeline confirmation is durable and freezes on rollback',async t=>{
  const p=await workspace(t);
  const store=createEssentialMemoryStorage({filePath:p.sqlite,worldProfileId});
  await store.initialize();
  const id=await store.createTimeline({label:'Franklin run'});
  assert.equal(store.timelineWritable,false);
  await store.confirmTimeline(id);
  store.assertTimelineWrite(id);
  assert.equal(store.onBoundary({reason:'clock_regression'}).writable,false);
  assert.throws(()=>store.assertTimelineWrite(id),/timeline_write_suspended/);
  await store.confirmTimeline(id);
  store.assertTimelineWrite(id);
  await assert.rejects(store.confirmTimeline(randomUUID()),/timeline_unknown/);
  await store.close();
  const restored=createStandaloneMemoryStorage({filePath:p.sqlite,worldProfileId});
  await restored.initialize();
  assert.equal(restored.activeTimelineId,id);
  assert.equal(restored.timelineWritable,true);
  await restored.close();
});

test('M1 SQLite opt-in parity preserves original JSON, CAS, backups, and read-only default',async t=>{
  const p=await workspace(t);
  const legacy=new ProfileStore({filePath:p.json,worldProfileId});
  await legacy.initialize();
  const npc=await legacy.create(profile());
  const raw=await fs.readFile(p.json,'utf8');
  const store=createEssentialMemoryStorage({filePath:p.sqlite,legacyJsonPath:p.json,worldProfileId});
  await store.initialize();
  assert.deepEqual(store.get(npc.characterId),legacy.get(npc.characterId));
  assert.equal(await fs.readFile(p.json,'utf8'),raw);
  assert.equal(await fs.readFile(p.json+'.pre-sqlite.bak','utf8'),raw);
  await store.close();
});

test('M1 distributable Essential copies the canonical shared module, never depends on repo outside bundle',async t=>{
  const p=await workspace(t);
  const projectRoot=path.resolve(import.meta.dirname,'..');
  const e1=path.join(p.root,'e1');
  await fs.mkdir(path.join(e1,'characters'),{recursive:true});
  for(const name of ['profileStore.mjs','sqliteFoundation.mjs','timelineGuard.mjs','memoryStorageAdapter.mjs']){
    await fs.copyFile(path.join(projectRoot,'src','characters',name),path.join(e1,'characters',name));
  }
  const info=await stageSharedMemory({projectRoot,stagedE1:e1});
  assert.equal(info.staged,4);
  const stage=await fs.readFile(path.join(e1,'characters','profileStore.mjs'),'utf8');
  assert.equal(stage.includes('../../../lsa-shared-brain/'),false);
  const module=await import(pathToFileURL(path.join(e1,'characters','profileStore.mjs')).href);
  assert.equal(typeof module.ProfileStore,'function');
  const sqlite=await import(pathToFileURL(path.join(e1,'characters','sqliteFoundation.mjs')).href);
  assert.equal(typeof sqlite.P2SqliteFoundation,'function');
  const mem=await import(pathToFileURL(path.join(e1,'characters','memoryStorageAdapter.mjs')).href);
  assert.equal(typeof mem.createEssentialMemoryStorage,'function');
});

test('M1 editor hides unsupported mode and requires explicit timeline confirmation',async t=>{
  const p=await workspace(t);
  const store=createEssentialMemoryStorage({filePath:p.sqlite,worldProfileId});
  await store.initialize();
  const service={
    config:{promotedCharacters:{editorPort:0,summonWaitMs:30000}},
    store,emit() {},
    list:async()=>[]
  };
  const editor=await startCharacterEditor(service,{port:0});
  // Close Windows SQLite WAL handles BEFORE workspace() removes the temp directory.
  try {
  const html=await (await fetch(editor.url)).text();
  assert.match(html,/id="timelinePanel" hidden/);
  const token=html.match(/const auth="([a-f0-9]{64})"/)?.[1];
  assert.ok(token);
  const api=async(action,payload={})=>{
    const res=await fetch(editor.url+'/api',{
      method:'POST',headers:{'content-type':'application/json',
        'x-lsa-editor':token,origin:editor.url},
      body:JSON.stringify({action,...payload})
    });
    return {code:res.status,value:await res.json()};
  };
  const initial=await api('timeline_list');
  assert.equal(initial.value.supported,true);
  assert.equal(initial.value.writable,false);
  const created=await api('timeline_create',{label:'My save'});
  assert.equal(created.code,200);
  const timelineId=created.value.timelineId;
  const denied=await api('timeline_confirm',{timelineId,confirmation:'no'});
  assert.equal(denied.code,400);
  assert.equal((await api('timeline_list')).value.activeTimelineId,null);
  const allowed=await api('timeline_confirm',{timelineId,confirmation:timelineId});
  assert.equal(allowed.code,200);
  assert.equal((await api('timeline_list')).value.writable,true);
  store.onBoundary({reason:'clock_regression'});
  assert.equal((await api('timeline_list')).value.writable,false);
  } finally {
    await editor.close();
    await store.close();
  }
});
