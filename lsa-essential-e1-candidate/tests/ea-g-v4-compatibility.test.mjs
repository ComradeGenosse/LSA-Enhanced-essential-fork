// G: isolated, adversarial real-P2 v2/v4 compatibility checks. Never user data.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createEssentialMemoryStorage} from '../src/characters/memoryStorageAdapter.mjs';
import {bindTrustedTimelineSource} from '../src/characters/timelineSourceBridge.mjs';
import {inspectP2Sqlite} from '../../../lsa-shared-brain/src/characters/sqliteFoundation.mjs';
import {ProfileStore} from '../src/characters/profileStore.mjs';
import {createMoodRuntime} from '../src/voice/emotion/moodRuntime.mjs';
import {profile} from './p2-fixtures.mjs';
import {worldProfileId} from './identity-fixtures.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const host=(hostRunId=randomUUID(),worldEpoch=1)=>({hostContextVersion:1,hostRunId,worldEpoch});
function emitter(){
  const hosts=new Set(),boundaries=new Set();
  return {
    subscribeVerifiedHostContext(f){hosts.add(f);return()=>hosts.delete(f);},
    subscribeWorldBoundary(f){boundaries.add(f);return()=>boundaries.delete(f);},
    host(c){for(const f of hosts)f(c);},
    boundary(b){for(const f of boundaries)f(b);}
  };
}
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lsa-g-v4-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return {dir,db:path.join(dir,'fixture.sqlite'),json:path.join(dir,'profile.json')};
}
const storage=p=>createEssentialMemoryStorage({filePath:p.db,worldProfileId,sourceRequired:true});
async function preparedStore(p,{person=true}={}){
  const store=storage(p);await store.initialize();
  const npc=person?await store.create(profile()):null;
  return {store,npc};
}
async function approved(store){
  const t=await store.createTimeline({label:'Manual operator save'});
  const proof=host();store.setVerifiedHostContext(proof);
  await store.confirmTimeline(t,{confirmation:t});
  return {timelineId:t,proof};
}
const scope=(npc,t)=>({worldProfileId,characterId:npc.characterId,timelineId:t,protagonistKey:'franklin'});
function originalV2(dbPath,snapshot){
  const db=new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE p2_store(singleton INTEGER PRIMARY KEY CHECK(singleton=1),
        world_profile_id TEXT NOT NULL,revision INTEGER NOT NULL,source_sha256 TEXT NOT NULL,snapshot_json TEXT NOT NULL);
      CREATE TABLE promoted_profiles(character_id TEXT PRIMARY KEY,owner_alias TEXT NOT NULL UNIQUE,
        position INTEGER NOT NULL UNIQUE,revision INTEGER NOT NULL,profile_json TEXT NOT NULL);
      CREATE TABLE timelines(timeline_id TEXT PRIMARY KEY,world_profile_id TEXT NOT NULL,label TEXT NOT NULL,
        created_at_utc TEXT NOT NULL,active INTEGER NOT NULL CHECK(active IN (0,1)));
      CREATE UNIQUE INDEX one_active_timeline ON timelines(active) WHERE active=1;
    `);
    const raw=JSON.stringify(snapshot)+'\n';
    db.prepare('INSERT INTO p2_store VALUES(1,?,?,?,?)')
      .run(worldProfileId,snapshot.revision,digest(raw),raw);
    const write=db.prepare('INSERT INTO promoted_profiles VALUES(?,?,?,?,?)');
    snapshot.profiles.forEach((p,i)=>write.run(p.characterId,p.promotion.ownerAlias,i,p.revision,JSON.stringify(p)));
    db.exec('PRAGMA user_version=2');
  }finally{db.close();}
}
test('G01: v2 profiles migrate forward with exact existing profile and revision',async t=>{
  const p=await fixture(t),legacy=new ProfileStore({filePath:p.json,worldProfileId});
  await legacy.initialize();await legacy.create(profile());
  const snapshot=JSON.parse(await fs.readFile(p.json,'utf8'));
  originalV2(p.db,snapshot);
  const store=storage(p);await store.initialize();
  assert.equal(store.snapshot.revision,snapshot.revision);
  assert.deepEqual(store.list(),snapshot.profiles);
  await store.close();
  const ro=new DatabaseSync(p.db,{readOnly:true});
  try{
    assert.equal(ro.prepare('PRAGMA user_version').get().user_version,4);
    assert.ok(ro.prepare("SELECT name FROM sqlite_master WHERE name='dialogue_journal'").get());
    assert.ok(ro.prepare("SELECT name FROM sqlite_master WHERE name='m5_privacy_ops'").get());
  }finally{ro.close();}
});
test('G02: populated v4 retains verbatim evidence, replay cursor, profile and confirmation separation',async t=>{
  const p=await fixture(t),{store,npc}=await preparedStore(p),{timelineId,proof}=await approved(store);
  const accepted={
    version:1,characterId:npc.characterId,worldProfileId,timelineId,kind:'dialogue_line',
    recordId:randomUUID(),speaker:'player',source:'typed',content:'I remember 😎 café — exactly.',
    delivery:'accepted',committedAtUtc:new Date().toISOString(),turnIdentityHash:digest('line one'),
    utteranceId:null,transcription:null,deliveryReceiptId:null
  };
  await store.appendDialogueLine(accepted,{
    sessionId:randomUUID(),protagonist:'franklin',hostRunId:proof.hostRunId,worldEpoch:proof.worldEpoch
  });
  const s=scope(npc,timelineId),page=await store.readCommittedEvidencePage({scope:s});
  assert.equal(page.items.length,1);
  assert.equal(page.items[0].envelope.content,accepted.content);
  const before=await store.readCommittedEvidenceCursor({scope:s,consumerId:'g.fixture'});
  await store.ackCommittedEvidenceCursor({scope:s,consumerId:'g.fixture',cursor:page.cursor,expectedCursor:before.cursor});
  await store.close();
  const inspected=await inspectP2Sqlite({filePath:p.db,worldProfileId});
  assert.equal(inspected.schemaVersion,4);
  const reopened=storage(p);await reopened.initialize();
  assert.equal(reopened.timelineWritable,false);
  assert.equal(reopened.get(npc.characterId).revision,npc.revision);
  assert.equal((await reopened.readDialogueLines({characterId:npc.characterId,timelineId}))[0].content,accepted.content);
  // A stored cursor never grants save authority, even for a previously confirmed timeline.
  reopened.setVerifiedHostContext(proof);
  assert.equal(reopened.timelineWritable,false);
  await reopened.confirmTimeline(timelineId,{confirmation:timelineId});
  assert.equal((await reopened.readCommittedEvidenceCursor({scope:s,consumerId:'g.fixture'})).lastSequence,page.lastSequence);
  assert.equal((await reopened.readCommittedEvidencePage({scope:s})).items[0].envelope.content,accepted.content);
  await reopened.close();
});
test('G03: read-only inspection has no migration side effects',async t=>{
  const p=await fixture(t),legacy=new ProfileStore({filePath:p.json,worldProfileId});
  await legacy.initialize();await legacy.create(profile());
  originalV2(p.db,JSON.parse(await fs.readFile(p.json,'utf8')));
  const before=await fs.readFile(p.db);
  const report=await inspectP2Sqlite({filePath:p.db,worldProfileId});
  assert.equal(report.schemaVersion,2);
  assert.deepEqual(await fs.readFile(p.db),before);
  const ro=new DatabaseSync(p.db,{readOnly:true});
  try{assert.equal(ro.prepare('PRAGMA user_version').get().user_version,2);}finally{ro.close();}
});
test('G04: unsupported future v42 schema refuses without mutation',async t=>{
  const p=await fixture(t),{store}=await preparedStore(p,{person:false});
  await store.close();
  const db=new DatabaseSync(p.db);
  db.exec('PRAGMA user_version=42');db.close();
  const before=await fs.readFile(p.db);
  await assert.rejects(storage(p).initialize(),/unsupported_sqlite_profile_schema/);
  assert.deepEqual(await fs.readFile(p.db),before);
});
test('G05: corrupt SQLite refuses and preserves exact original bytes',async t=>{
  const p=await fixture(t);
  const corrupt=Buffer.from('NOT A DATABASE\0\u2603','utf8');
  await fs.writeFile(p.db,corrupt);
  await assert.rejects(storage(p).initialize());
  assert.deepEqual(await fs.readFile(p.db),corrupt);
});
test('G06: simultaneous P2 writer lock excludes another instance',async t=>{
  const p=await fixture(t),one=storage(p),two=storage(p);
  await one.initialize();
  try{await assert.rejects(two.initialize(),/sqlite_writer_busy/);}
  finally{await one.close();}
  const three=storage(p);await three.initialize();
  assert.equal(three.timelineSourceStatus,'unavailable');
  await three.close();
});
test('G07: host reconnect, fork, epoch, rollback and explicit re-confirmation revoke writes',async t=>{
  const p=await fixture(t),st=storage(p);
  const source=emitter(),binding=bindTrustedTimelineSource({store:st,intelligenceClient:source});
  try{
    await st.initialize();const id=await st.createTimeline();
    await assert.rejects(st.confirmTimeline(id,{confirmation:id}),/timeline_write_suspended/);
    const a=host();source.host(a);
    await st.confirmTimeline(id,{confirmation:id});
    for(const reason of ['save_fork','clock_regression','host_reload','native_disconnect']){
      source.boundary({reason});
      assert.equal(st.timelineWritable,false,reason);
      await assert.rejects(st.withTimelineWrite(id,()=>true),/timeline_write_suspended/);
      source.host(host());await st.confirmTimeline(id,{confirmation:id});
    }
    source.host(null);assert.equal(st.timelineWritable,false);
    source.host(a);assert.equal(st.timelineWritable,false);
  }finally{binding.close();await st.close();}
});
test('G08: Franklin/Michael/Franklin ABA may not supply save identity or revive confirmation',async t=>{
  const p=await fixture(t),st=storage(p);await st.initialize();
  try{
    const id=await st.createTimeline(),a=host();
    st.setVerifiedHostContext(a);await st.confirmTimeline(id,{confirmation:id});
    st.onBoundary({reason:'source_change'}); // native actor changed
    assert.equal(st.timelineWritable,false);
    st.setVerifiedHostContext(a); // an identical host/epoch cannot imply identical save
    assert.equal(st.timelineWritable,false);
    st.onBoundary({reason:'source_change'}); // changed back
    assert.equal(st.timelineWritable,false);
    st.setVerifiedHostContext(a);
    assert.equal(st.timelineSourceStatus,'confirmation_required');
  }finally{await st.close();}
});
test('G09: queued v4 writes reject prior source generation despite same source reconfirmed',async t=>{
  const p=await fixture(t),st=storage(p);await st.initialize();
  try{
    const id=await st.createTimeline(),h=host();st.setVerifiedHostContext(h);
    await st.confirmTimeline(id,{confirmation:id});
    let writes=0;
    const queued=st.withTimelineWrite(id,()=>++writes);
    st.onBoundary({reason:'save_fork'});
    st.setVerifiedHostContext(h);
    await st.confirmTimeline(id,{confirmation:id});
    await assert.rejects(queued,/timeline_write_suspended/);
    assert.equal(writes,0);
  }finally{await st.close();}
});
test('G10: v4 context never persists ephemeral EA4 mood; no proof is neutral',async t=>{
  const p=await fixture(t),st=storage(p);await st.initialize();
  try{
    assert.equal(st.timelineSourceStatus,'unavailable');
    const mood=createMoodRuntime({getRuntime:()=>({characterService:{store:st}})});
    assert.equal(mood.readMood({identity:{},turn:{characterSnapshot:{}}}),null);
    assert.equal(mood.size,0);
    const db=new DatabaseSync(p.db,{readOnly:true});
    try{assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE '%mood%'").get().n,0);}
    finally{db.close();}
  }finally{await st.close();}
});
test('G11: opt-in v4 timeline requires actual accepted C-13 callback plus exact user selection',async t=>{
  const p=await fixture(t),st=storage(p),source=emitter();
  const bind=bindTrustedTimelineSource({store:st,intelligenceClient:source});
  try{
    await st.initialize();const id=await st.createTimeline();
    assert.equal(st.timelineWritable,false);
    source.host(host());assert.equal(st.timelineSourceStatus,'confirmation_required');
    await assert.rejects(st.confirmTimeline(id),/explicit_confirmation_required/);
    await st.confirmTimeline(id,{confirmation:id});
    assert.equal(st.timelineSourceStatus,'verified');
    assert.equal(st.timelineWritable,true);
    assert.ok(st.verifiedHostContext);
    source.host(null);assert.equal(st.verifiedHostContext,null);
    assert.equal(st.timelineWritable,false);
  }finally{bind.close();await st.close();}
});
test('G12: JSON default remains selected without SQLite authorization',async t=>{
  const p=await fixture(t);
  const {CharacterService,normalizeCharacterConfig}=await import('../src/characters/characterService.mjs');
  const service=new CharacterService({
    persistentIdentity:{worldProfileId,storePath:path.join(p.dir,'ident.json')},
    promotedCharacters:normalizeCharacterConfig({storePath:p.json})
  },{identityService:{},nativeOwner:{request:async()=>({})}});
  assert.equal(service.store.constructor.name,'ProfileStore');
  assert.equal(service.store.timelineWritable,false);
  await service.initialize();
  await service.closeStorage();
});