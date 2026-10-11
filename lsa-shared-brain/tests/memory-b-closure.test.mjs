import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {createM5SqliteServices} from '../src/memory/m5SqlitePrivacy.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

const id=()=>randomUUID();
const sum=value=>createHash('sha256').update(value).digest('hex');
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'p2-memory-closure-b-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const filePath=path.join(root,'p2.sqlite');
  const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  const person=await store.create(profile());
  const timelineId=await store.createTimeline({label:'B source-fenced test'});
  const host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
  store.setVerifiedHostContext(host);await store.confirmTimeline(timelineId);
  const scope={worldProfileId,characterId:person.characterId,timelineId,protagonistKey:'franklin'};
  const recorder=createConversationJournalRecorder(store);
  async function line(text,turn='turn-'+id(),protagonist='franklin'){
    const receipt=await recorder.recordPlayerAccepted({characterId:person.characterId,
      identity:{pedId:101,turnId:turn,generationId:'generation',sessionNonce:'closure-b'},
      text,source:'typed',attribution:{protagonist}});
    return receipt.recordId;
  }
  return {root,filePath,store,person,host,scope,line};
}
test('B: 2,101 source-committed Unicode lines replay across bounded pages with durable CAS cursor and restart',async t=>{
  const x=await fixture(t),count=2101,accepted=new Set();
  const acceptedText='I said “déjà vu” 🦊 — damn, exactly!';
  for(let i=0;i<count;i+=35){
    const writes=Array.from({length:Math.min(35,count-i)},(_,j)=>x.line(acceptedText+' '+(i+j),'large-'+(i+j)));
    for(const recordId of await Promise.all(writes))accepted.add(recordId);
  }
  assert.equal(accepted.size,count);
  let checkpoint=await x.store.readCommittedEvidenceCursor({scope:x.scope,consumerId:'m6-primary'});
  let seen=new Set(),pages=0;
  while(true){
    const page=await x.store.readCommittedEvidencePage({scope:x.scope,cursor:checkpoint.cursor,limit:137});
    assert.ok(page.scannedCount<=137);
    assert.equal(page.rejected.length,0);
    for(const item of page.items){
      assert.equal(item.kind,'dialogue');
      assert.ok(item.envelope.content.startsWith(acceptedText));
      assert.ok(accepted.has(item.recordId));
      assert.ok(!seen.has(item.recordId));seen.add(item.recordId);
    }
    pages++;
    const ack=await x.store.ackCommittedEvidenceCursor({scope:x.scope,consumerId:'m6-primary',
      cursor:page.cursor,expectedCursor:checkpoint.cursor});
    assert.equal(ack.committed,true);
    checkpoint=await x.store.readCommittedEvidenceCursor({scope:x.scope,consumerId:'m6-primary'});
    assert.equal(checkpoint.cursor,page.cursor);
    if(!page.hasMore)break;
    assert.ok(pages<30);
  }
  assert.ok(pages>=16);
  assert.equal(seen.size,count);
  const last=checkpoint.cursor;
  const same=await x.store.ackCommittedEvidenceCursor({scope:x.scope,consumerId:'m6-primary',cursor:last,expectedCursor:last});
  assert.equal(same.idempotent,true);
  await assert.rejects(x.store.readCommittedEvidencePage({scope:{...x.scope,protagonistKey:'trevor'},cursor:last}),/invalid_cursor/);
  await x.store.close();
  const reopened=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
  await reopened.initialize();
  try{
    await assert.rejects(reopened.readCommittedEvidenceCursor({scope:x.scope,consumerId:'m6-primary'}),/timeline_write_suspended/);
    reopened.setVerifiedHostContext({...x.host,hostRunId:id(),worldEpoch:2});
    await reopened.confirmTimeline(x.scope.timelineId);
    const again=await reopened.readCommittedEvidenceCursor({scope:x.scope,consumerId:'m6-primary'});
    assert.equal(again.cursor,last);
    assert.equal((await reopened.readCommittedEvidencePage({scope:x.scope,cursor:last})).items.length,0);
    // New evidence after the previously acknowledged head is discovered.
    const next=await createConversationJournalRecorder(reopened).recordPlayerAccepted({
      characterId:x.person.characterId,
      identity:{pedId:101,turnId:'after-restart',generationId:'generation',sessionNonce:'closure-b'},
      text:'new utterance after reconnect',source:'typed',attribution:{protagonist:'franklin'}});
    const resumed=await reopened.readCommittedEvidencePage({scope:x.scope,cursor:last});
    assert.deepEqual(resumed.items.map(item=>item.recordId),[next.recordId]);
  }finally{await reopened.close();}
});
test('B: writer is exclusive, serialized pending writers survive busy/reopen and reject revoked commit source',async t=>{
  const x=await fixture(t);
  const other=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
  await assert.rejects(other.initialize(),/sqlite_writer_busy/);
  const before=await x.line('first unchanged evidence','before');
  const ops=Array.from({length:20},(_,i)=>x.line('concurrent '+i,'writer-'+i));
  assert.equal(new Set(await Promise.all(ops)).size,20);
  const first=x.store.withTimelineWrite(x.scope.timelineId,()=>{
    x.store.setVerifiedHostContext(null);
    return 'revoked';
  });
  const second=x.store.withTimelineSqliteWrite(x.scope,db=>
    db.prepare('DELETE FROM dialogue_journal WHERE record_id=?').run(before));
  assert.equal(await first,'revoked');
  await assert.rejects(second,/timeline_write_suspended/);
  assert.ok((await x.store.findExactQuote({characterId:x.scope.characterId,timelineId:x.scope.timelineId,quote:'first unchanged evidence'})).length);
  await x.store.close();
  const fresh=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
  await fresh.initialize();await fresh.close();
});
test('B: nested savepoint failure rolls back only inner transaction; no second writer connection',async t=>{
  const x=await fixture(t);
  const answer=await x.store.withTimelineWrite(x.scope.timelineId,foundation=>
    foundation.withP2SqliteTransaction(db=>{
      db.exec('CREATE TABLE nested_probe (n INTEGER PRIMARY KEY)');
      db.exec('INSERT INTO nested_probe VALUES(1)');
      assert.throws(()=>foundation.withP2SqliteTransaction(nested=>{
        nested.exec('INSERT INTO nested_probe VALUES(2)');
        throw new Error('abort_inner');
      }),/abort_inner/);
      db.exec('INSERT INTO nested_probe VALUES(3)');
      return db.prepare('SELECT n FROM nested_probe ORDER BY n').all().map(r=>r.n);
    }));
  assert.deepEqual(answer,[1,3]);
  await x.store.close();
});
test('B: native revocation inside transaction rolls back before physical SQLite COMMIT',async t=>{
  const x=await fixture(t);
  await assert.rejects(x.store.withTimelineSqliteWrite(x.scope,db=>{
    db.exec('CREATE TABLE revocation_probe(n INTEGER)');
    db.exec('INSERT INTO revocation_probe VALUES(99)');
    x.store.setVerifiedHostContext(null);
    return 'must-not-commit';
  }),/timeline_write_suspended/);
  x.store.setVerifiedHostContext({...x.host,hostRunId:id(),worldEpoch:2});
  await x.store.confirmTimeline(x.scope.timelineId);
  const count=await x.store.withP2SqliteRead(x.scope,db=>
    db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='revocation_probe'").get().n);
  assert.equal(count,0);
  await x.store.close();
});
test('B: unverified native event stays a rejection, never a witnessed NPC fact',async t=>{
  const x=await fixture(t),scope={...x.scope,protagonistKey:'unknown'},recordId=id();
  const envelope=JSON.stringify({version:1,recordId,characterId:scope.characterId,
    worldProfileId,timelineId:scope.timelineId,kind:'journal_event',eventType:'gunfire',
    sourceHash:sum('not-source-proven')});
  await x.store.withTimelineSqliteWrite(scope,db=>{
    db.prepare('INSERT INTO event_journal VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(
      recordId,worldProfileId,scope.timelineId,scope.characterId,id(),1,'gunfire',
      new Date().toISOString(),sum('not-source-proven'),'witnessed',envelope,sum(envelope));
  });
  const page=await x.store.readCommittedEvidencePage({scope});
  assert.equal(page.items.length,0);
  assert.equal(page.rejected.length,1);
  assert.equal(page.rejected[0].reason,'unverified_or_removed_event');
  assert.equal(page.status,'incomplete_evidence');
  await x.store.close();
});
test('B: M5 single-connection privacy is serialized and cannot restore purged or cross-protagonist data',async t=>{
  const x=await fixture(t);
  const target=await x.line('private Franklin racing story','private');
  const foreign=await x.line('private Trevor story','foreign','trevor');
  let time=Date.now();
  const m5=createM5SqliteServices({store:x.store,filePath:x.filePath,
    clock:()=>new Date(time).toISOString(),authorize:()=>true});
  await m5.ready(x.scope);
  const op=id();
  const [first,duplicate]=await Promise.all([
    m5.trash({scope:x.scope,targetId:target,operationId:op}),
    m5.trash({scope:x.scope,targetId:target,operationId:op})
  ]);
  assert.equal(first.durableCommit,true);
  assert.deepEqual(first,duplicate);
  assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(target));
  assert.equal((await m5.inspect({scope:{...x.scope,protagonistKey:'trevor'}})).records.length,0);
  const exported=await m5.exportArchive({scope:x.scope});
  assert.equal(exported.sha256,sum(exported.json));
  assert.equal(exported.json.includes('private Trevor story'),false);
  time+=8*86400000;
  const purge=await m5.purgeExpired({scope:x.scope});
  assert.ok(purge.purgedIds.includes(target));
  await assert.rejects(m5.restore({scope:x.scope,trashId:op,operationId:id()}),/m5_restore_unavailable/);
  assert.equal((await x.store.readCommittedEvidencePage({scope:x.scope})).items.some(row=>row.recordId===target),false);
  const trevor=await x.store.readCommittedEvidencePage({scope:{...x.scope,protagonistKey:'trevor'}});
  assert.ok(trevor.items.some(row=>row.recordId===foreign));
  await m5.close();
  assert.ok(x.store.available);
  await x.store.close();
});
test('B: confirmed unpromotion destroys M5 and replay records in the same profile CAS transaction',async t=>{
  const x=await fixture(t),target=await x.line('my secret','delete-me');
  const m5=createM5SqliteServices({store:x.store,filePath:x.filePath,authorize:()=>true});
  await m5.ready(x.scope);
  await m5.trash({scope:x.scope,targetId:target,operationId:id()});
  await x.store.remove(x.person.characterId,x.person.characterId,x.person.revision);
  assert.equal(x.store.get(x.person.characterId),null);
  await x.store.withTimelineWrite(x.scope.timelineId,foundation=>{
    const report=foundation.withP2SqliteRead(db=>Object.fromEntries([
      'm5_trash','m5_privacy_ops','p2_memory_replay_feed','p2_memory_replay_cursors'
    ].map(table=>[table,db.prepare('SELECT count(*) AS n FROM '+table+' WHERE character_id=?')
      .get(x.person.characterId).n])));
    assert.deepEqual(report,{m5_trash:0,m5_privacy_ops:0,p2_memory_replay_feed:0,p2_memory_replay_cursors:0});
  });
  await x.store.close();
});
test('B: v4 quick-check and journal hash detection fail closed; reject unknown user_version',async t=>{
  const x=await fixture(t);
  const target=await x.line('unaltered exact source','corrupt-source');
  await x.store.close();
  let db=new DatabaseSync(x.filePath);
  try{db.prepare('UPDATE dialogue_journal SET content=? WHERE record_id=?').run('tampered',target);}
  finally{db.close();}
  let store=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  store.setVerifiedHostContext({...x.host,hostRunId:id(),worldEpoch:2});
  await store.confirmTimeline(x.scope.timelineId);
  await assert.rejects(store.readCommittedEvidencePage({scope:x.scope}),/p2_replay_dialogue_corrupt/);
  await store.close();
  db=new DatabaseSync(x.filePath);
  try{db.exec('PRAGMA user_version=999;');}
  finally{db.close();}
  store=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
  await assert.rejects(store.initialize(),/unsupported_sqlite_profile_schema/);
  db=new DatabaseSync(x.filePath);
  try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,999);}
  finally{db.close();}
});
test('B: P2 rollback JSON export retains legacy profiles, without pretending journal is in v1',async t=>{
  const x=await fixture(t);
  const result=await x.store.exportRollbackSnapshot();
  assert.equal(result.profileCount,1);
  assert.ok(result.sha256.length===64);
  await x.store.close();
});
