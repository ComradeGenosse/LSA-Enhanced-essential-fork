import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { worldProfileId } from './identity-fixtures.mjs';
import { profile } from './p2-fixtures.mjs';
import { ProfileStore } from '../src/characters/profileStore.mjs';
import { P2SqliteFoundation,probeP2Sqlite } from '../src/characters/sqliteFoundation.mjs';
import { TimelineGuard,durableSubjectRef } from '../src/characters/timelineGuard.mjs';

async function workspace(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lsa-memory-m1-'));
  t.after(async()=>fs.rm(root,{recursive:true,force:true}));
  return {root,legacy:path.join(root,'profiles.v1.json'),sqlite:path.join(root,'characters.v2.sqlite')};
}
test('M1 SQLite and FTS5 are available without a local AI server',()=>{
  const probe=probeP2Sqlite();
  assert.equal(probe.available,true,probe.reason);
  assert.equal(probe.fts5,true);
});
test('M1 imports P2 profiles and manual memories without modifying source JSON',async t=>{
  const p=await workspace(t);
  const legacy=new ProfileStore({filePath:p.legacy,worldProfileId});await legacy.initialize();
  const first=await legacy.create(profile());
  const revised=await legacy.memory(first.characterId,'create',{expectedRevision:first.revision,patch:{text:'Remember the ridiculous fountain crash.',importance:99,selectedForContext:true}});
  const before=await fs.readFile(p.legacy,'utf8');
  const sqlite=new P2SqliteFoundation({filePath:p.sqlite,legacyJsonPath:p.legacy,worldProfileId});
  await sqlite.initialize();
  assert.deepEqual(sqlite.get(first.characterId),revised.profile);
  assert.deepEqual(sqlite.snapshot,JSON.parse(before));
  assert.equal(await fs.readFile(p.legacy,'utf8'),before);
  assert.equal(await fs.readFile(p.legacy+'.pre-sqlite.bak','utf8'),before);
  assert.equal(sqlite.activeTimelineId(),null,'a migrated profile must not silently select a timeline');
  sqlite.close();
  const reopened=new P2SqliteFoundation({filePath:p.sqlite,legacyJsonPath:p.legacy,worldProfileId});
  await reopened.initialize();
  assert.deepEqual(reopened.get(first.characterId),revised.profile);
  reopened.close();
});
test('M1 performs CAS profile writes transactionally and enforces ownership uniqueness',async t=>{
  const p=await workspace(t);
  const foundation=new P2SqliteFoundation({filePath:p.sqlite,worldProfileId});
  await foundation.initialize();
  const a=profile();
  const initial=foundation.snapshot;
  const next={...initial,revision:1,profiles:[a]};
  const result=foundation.replaceSnapshot(next,0);
  assert.equal(result.revision,1);
  assert.equal(foundation.get(a.characterId).promotion.ownerAlias,a.promotion.ownerAlias);
  assert.throws(()=>foundation.replaceSnapshot({...next,revision:2},0),/sqlite_revision_conflict/);
  const duplicate=profile({characterId:randomUUID(),promotion:a.promotion});
  assert.throws(()=>foundation.replaceSnapshot({...next,revision:2,profiles:[a,duplicate]},1),/invalid_profile_store/);
  foundation.close();
  const reopened=new P2SqliteFoundation({filePath:p.sqlite,worldProfileId});await reopened.initialize();
  assert.deepEqual(reopened.get(a.characterId),a);reopened.close();
});
test('M1 fails closed for corrupt legacy JSON and does not create a replacement',async t=>{
  const p=await workspace(t);
  await fs.writeFile(p.legacy,'{broken');
  const foundation=new P2SqliteFoundation({filePath:p.sqlite,legacyJsonPath:p.legacy,worldProfileId});
  await assert.rejects(foundation.initialize(),/legacy_profile_invalid/);
  await assert.rejects(fs.stat(p.sqlite),{code:'ENOENT'});
  assert.equal(await fs.readFile(p.legacy,'utf8'),'{broken');
});
test('M1 rejects unknown SQLite schema and foreign world profiles without overwriting',async t=>{
  const p=await workspace(t);
  const foundation=new P2SqliteFoundation({filePath:p.sqlite,worldProfileId});await foundation.initialize();foundation.close();
  const other=new P2SqliteFoundation({filePath:p.sqlite,worldProfileId:randomUUID()});
  await assert.rejects(other.initialize(),/sqlite_profile_world_conflict/);
  const db=new DatabaseSync(p.sqlite);db.exec('PRAGMA user_version=77');db.close();
  const unsupported=new P2SqliteFoundation({filePath:p.sqlite,worldProfileId});
  await assert.rejects(unsupported.initialize(),/unsupported_sqlite_profile_schema/);
  assert.ok((await fs.stat(p.sqlite)).size>0);
});
test('M1 persists one active timeline and never automatically accepts ambiguous rollback',async t=>{
  const p=await workspace(t);
  const foundation=new P2SqliteFoundation({filePath:p.sqlite,worldProfileId});await foundation.initialize();
  const first=foundation.createTimeline({label:'Save A'}),second=foundation.createTimeline({label:'Save B'});
  assert.equal(foundation.activeTimelineId(),null);
  foundation.activateTimeline(first);assert.equal(foundation.activeTimelineId(),first);
  foundation.activateTimeline(second);assert.equal(foundation.activeTimelineId(),second);
  assert.equal(foundation.listTimelines().filter(x=>x.active===1).length,1);
  const guard=new TimelineGuard({timelineId:second});guard.assertWrite(second);
  assert.equal(guard.onBoundary({reason:'clock_regression'}).writable,false);
  assert.throws(()=>guard.assertWrite(second),/timeline_write_suspended/);
  assert.equal(guard.selectTimeline(first),first);guard.assertWrite(first);
  assert.throws(()=>guard.assertWrite(second),/timeline_write_suspended/);
  foundation.close();
  const reopened=new P2SqliteFoundation({filePath:p.sqlite,worldProfileId});await reopened.initialize();
  assert.equal(reopened.activeTimelineId(),second,'guard selection is not a persisted timeline switch until explicitly activated');
  reopened.activateTimeline(first);assert.equal(reopened.activeTimelineId(),first);reopened.close();
});
test('M1 durable SubjectRef distinguishes protagonists and refuses stale/unknown handles',()=>{
  const franklin=durableSubjectRef({kind:'protagonist',key:'franklin'});
  const michael=durableSubjectRef({kind:'protagonist',key:'michael'});
  assert.notDeepEqual(franklin,michael);
  assert.equal(durableSubjectRef({kind:'protagonist',key:'unknown'}),null);
  assert.equal(durableSubjectRef({kind:'character',key:randomUUID()}).kind,'character');
  assert.equal(durableSubjectRef({kind:'stranger',key:'stranger2'}),null);
  assert.deepEqual(durableSubjectRef({kind:'self'}),{kind:'self',key:'self'});
  const scoped=durableSubjectRef({kind:'stranger',key:'stranger2',sceneId:randomUUID()});
  assert.equal(scoped.kind,'stranger');assert.ok(Object.isFrozen(scoped));
});
