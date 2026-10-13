import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {P2SqliteFoundation} from '../src/characters/sqliteFoundation.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {acquireWriterLock,releaseWriterLock,inspectWriterLock,snapshotSqlite,enforceJournalCaps} from '../src/characters/sqliteDurability.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';

async function temp(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'ws4b-durability-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  return {root,file:path.join(root,'characters.sqlite')};
}
test('WS-4b crashed process is reclaimed; live writer and reentrant instance are refused',async t=>{
  const {file}=await temp(t);
  const lock=file+'.writer.lock',module=pathToFileURL(fileURLToPath(new URL('../src/characters/sqliteDurability.mjs',import.meta.url))).href;
  const script=`import {acquireWriterLock} from ${JSON.stringify(module)};await acquireWriterLock(${JSON.stringify(lock)});`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
  assert.equal(child.status,0,child.stderr);
  assert.equal((await inspectWriterLock(lock)).status,'stale_owner');
  const first=createP2MemoryStorage({filePath:file,worldProfileId});
  await first.initialize();
  try{
    assert.equal(first.durabilityStatus.writer,'stale_reclaimed');
    const second=createP2MemoryStorage({filePath:file,worldProfileId});
    await assert.rejects(second.initialize(),/sqlite_writer_busy/);
    assert.equal((await inspectWriterLock(lock)).status,'live_owner');
    await first.create(profile());
  }finally{await first.close();}
  const again=createP2MemoryStorage({filePath:file,worldProfileId});
  await again.initialize();
  try{assert.equal(again.list().length,1);}finally{await again.close();}
});
test('WS-4b legacy, malformed, foreign-host and live-PID locks never auto-reclaimed',async t=>{
  const {file}=await temp(t),lock=file+'.writer.lock';
  const legacy='original-token\\n';
  await fs.writeFile(lock,legacy);
  const instance=createP2MemoryStorage({filePath:file,worldProfileId});
  await assert.rejects(instance.initialize(),/sqlite_writer_busy/);
  assert.equal(await fs.readFile(lock,'utf8'),legacy);
  const lease=await fs.rm(lock).then(()=>acquireWriterLock(lock));
  try{
    const denied=createP2MemoryStorage({filePath:file,worldProfileId});
    await assert.rejects(denied.initialize(),/sqlite_writer_busy/);
  }finally{await releaseWriterLock(lock,lease);}
});
test('WS-4b snapshots are complete SQLite copies; retain 7 daily and 4 weekly',async t=>{
  const {file}=await temp(t),db=new DatabaseSync(file);
  try{
    db.exec("CREATE TABLE test_data (v TEXT); INSERT INTO test_data VALUES ('durable line')");
    for(let i=0;i<84;i+=7)await snapshotSqlite(db,file,{now:new Date(Date.UTC(2026,0,1+i))});
    const files=await fs.readdir(file+'.snapshots');
    assert.equal(files.filter(n=>n.startsWith('daily-')).length,7);
    assert.equal(files.filter(n=>n.startsWith('weekly-')).length,4);
    const snap=path.join(file+'.snapshots',files.find(n=>n.startsWith('daily-')));
    const reader=new DatabaseSync(snap,{readOnly:true});
    try{assert.equal(reader.prepare('SELECT v FROM test_data').get().v,'durable line');}
    finally{reader.close();}
  }finally{db.close();}
});
test('WS-4b integrity failure never recreates or overwrites a damaged database',async t=>{
  const {file}=await temp(t);
  const first=new P2SqliteFoundation({filePath:file,worldProfileId});
  await first.initialize();
  first.close();
  const header=await fs.open(file,'r+');
  try{await header.write(Buffer.from('NOT A SQLITE DATABASE'),0,21,0);}finally{await header.close();}
  const damaged=await fs.readFile(file);
  const next=new P2SqliteFoundation({filePath:file,worldProfileId});
  await assert.rejects(next.initialize());
  assert.equal(next.recoveryStatus?.status,'read_only_recovery_required');
  assert.deepEqual(await fs.readFile(file),damaged);
});
test('WS-4b failed extension migration rolls back DDL and preserves pre-migration snapshot',async t=>{
  const {file}=await temp(t);
  const foundation=new P2SqliteFoundation({filePath:file,worldProfileId});
  await foundation.initialize();foundation.close();
  const setup=new DatabaseSync(file);
  setup.exec('DROP TABLE m3_coverage; CREATE VIEW m3_coverage AS SELECT 1 AS sentinel; DROP TABLE m5_trash');
  setup.close();
  const failed=new P2SqliteFoundation({filePath:file,worldProfileId});
  await assert.rejects(failed.initialize());
  const check=new DatabaseSync(file,{readOnly:true});
  try{
    assert.equal(check.prepare("SELECT type FROM sqlite_master WHERE name='m3_coverage'").get().type,'view');
    assert.equal(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='m5_trash'").get().n,0);
    assert.equal(check.prepare('PRAGMA user_version').get().user_version,4);
  }finally{check.close();}
  assert.ok((await fs.readdir(file+'.snapshots')).some(n=>n.startsWith('daily-')));
});
test('WS-4b caps fail closed in the transaction with no data loss',async()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec('CREATE TABLE dialogue_journal(character_id TEXT,envelope_json TEXT,content TEXT);'+
      'CREATE TABLE event_journal(record_id TEXT,character_id TEXT,envelope_json TEXT);'+
      'CREATE TABLE event_source_evidence(record_id TEXT,source_evidence_json TEXT);');
    db.prepare('INSERT INTO event_journal VALUES (?,?,?)').run('one','character','{}');
    assert.throws(()=>enforceJournalCaps(db,{characterId:'character',event:true,bytes:1,limits:{events:1}}),/sqlite_journal_character_event_cap/);
    assert.throws(()=>enforceJournalCaps(db,{characterId:'character',bytes:100,limits:{characterBytes:5}}),/sqlite_journal_character_byte_cap/);
    assert.throws(()=>enforceJournalCaps(db,{characterId:'character',bytes:1,limits:{globalBytes:1}}),/sqlite_journal_global_byte_cap/);
    assert.equal(db.prepare('SELECT count(*) AS n FROM event_journal').get().n,1);
  }finally{db.close();}
});

test('WS-4b a corrupt main file supports checked snapshot read-only recovery without restore',async t=>{
  const {file}=await temp(t),store=createP2MemoryStorage({filePath:file,worldProfileId});
  await store.initialize();
  const character=await store.create(profile());
  await store.close();
  const fd=await fs.open(file,'r+');
  try{await fd.write(Buffer.from('BROKEN DATABASE HEADER'),0,22,0);}finally{await fd.close();}
  const reader=createP2MemoryStorage({filePath:file,worldProfileId});
  await assert.rejects(reader.initialize());
  const recovery=await reader.inspectReadOnlyRecovery();
  assert.equal(recovery.status,'read_only_snapshot');
  assert.equal(recovery.profiles[0].characterId,character.characterId);
  await assert.rejects(reader.create(profile()),/profile_store_unavailable/);
  await reader.close();
});
test('WS-4b recent free recall includes 200 player lines while older quotes stay in archive',async t=>{
  const {file}=await temp(t),store=createP2MemoryStorage({filePath:file,worldProfileId});
  await store.initialize();
  try{
    const character=await store.create(profile());
    const timelineId=await store.createTimeline({label:'recent'});
    await store.confirmTimeline(timelineId);
    const recorder=createConversationJournalRecorder(store);
    for(let i=0;i<210;i++)await recorder.recordPlayerAccepted({
      characterId:character.characterId,
      identity:{pedId:101,turnId:'ws4b-'+i,generationId:'g1',
        sessionNonce:i<10?'first-session':i<20?'second-session':'latest-session'},
      source:'typed',text:'archive quote number '+i,
      attribution:{protagonist:'franklin'}
    });
    const scope={worldProfileId,characterId:character.characterId,timelineId};
    const recent=await store.readFreeRecallWindow(scope);
    assert.equal(recent.tier,'free_recall');
    assert.ok(recent.lines.length>=200);
    assert.ok(recent.bytes<=512*1024);
    assert.ok(recent.lines.every(x=>x.content!=='archive quote number 0'));
    const old=await store.findExactQuote({...scope,quote:'archive quote number 0'});
    assert.equal(old[0].content,'archive quote number 0');
  }finally{await store.close();}
});
