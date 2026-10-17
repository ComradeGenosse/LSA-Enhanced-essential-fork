import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { inspectP2Sqlite } from '../../lsa-shared-brain/src/characters/sqliteFoundation.mjs';
import { JOURNAL_SCHEMA_VERSION } from '../../lsa-shared-brain/src/memory/journalSqlite.mjs';
import { createEssentialMemoryStorage } from '../src/characters/memoryStorageAdapter.mjs';
import { parseInspectArgs } from '../tools/inspectM1Sqlite.mjs';
import { worldProfileId } from './identity-fixtures.mjs';
import { profile } from './p2-fixtures.mjs';

const run=promisify(execFile);
async function files(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'m1-offline-check-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return {dir,filePath:path.join(dir,'npc.v2.sqlite')};
}
test('M1 offline recovery inspection validates exact DB without changing its bytes',async t=>{
  const {filePath}=await files(t);
  const s=createEssentialMemoryStorage({filePath,worldProfileId});
  await s.initialize();
  const p=await s.create(profile());
  const id=await s.createTimeline({label:'F save'});
  await s.confirmTimeline(id,{confirmation:id});
  await s.close();
  const before=await fs.readFile(filePath);
  const result=await inspectP2Sqlite({filePath,worldProfileId});
  assert.deepEqual(result,{
    status:'verified',revision:1,profileCount:1,timelineCount:1,
    activeTimelineId:id,schemaVersion:JOURNAL_SCHEMA_VERSION
  });
  assert.deepEqual(await fs.readFile(filePath),before);
  const tool=path.resolve(import.meta.dirname,'../tools/inspectM1Sqlite.mjs');
  const child=await run(process.execPath,[tool,'--db',filePath,'--world-profile-id',worldProfileId]);
  const stdout=JSON.parse(child.stdout);
  assert.deepEqual(stdout,result);
  assert.equal(stdout.profileCount,1);
  assert.equal(JSON.stringify(stdout).includes(p.name),false,'CLI must not expose private profile text');
  assert.deepEqual(await fs.readFile(filePath),before);
});

test('M1 inspector preserves corrupted DB and fails closed without replacement',async t=>{
  const {filePath}=await files(t);
  const s=createEssentialMemoryStorage({filePath,worldProfileId});
  await s.initialize();
  await s.create(profile());
  await s.close();
  const d=new DatabaseSync(filePath);
  d.exec("UPDATE promoted_profiles SET owner_alias='tampered'");
  d.close();
  const before=await fs.readFile(filePath);
  await assert.rejects(inspectP2Sqlite({filePath,worldProfileId}),
    /sqlite_profile_index_conflict/);
  assert.deepEqual(await fs.readFile(filePath),before);
  await assert.rejects(inspectP2Sqlite({filePath,worldProfileId:randomUUID()}),
    /sqlite_profile_world_conflict/);
});
test('M1 inspector never creates missing file or clears stale writer lock',async t=>{
  const {filePath}=await files(t);
  await assert.rejects(inspectP2Sqlite({filePath,worldProfileId}),{code:'ENOENT'});
  await assert.rejects(fs.stat(filePath),{code:'ENOENT'});
  const s=createEssentialMemoryStorage({filePath,worldProfileId});
  await s.initialize();
  await s.close();
  const lockPath=filePath+'.writer.lock';
  await fs.writeFile(lockPath,'unknown previous process\n');
  assert.equal((await inspectP2Sqlite({filePath,worldProfileId})).status,'verified');
  assert.equal(await fs.readFile(lockPath,'utf8'),'unknown previous process\n');
  assert.deepEqual(parseInspectArgs(['--db',filePath,'--world-profile-id',worldProfileId]),
    {filePath,worldProfileId});
  assert.throws(()=>parseInspectArgs(['--db',filePath]),/usage/);
  assert.throws(()=>parseInspectArgs(['--db',filePath,'--world-profile-id',worldProfileId,'--force']),/usage/);
});
