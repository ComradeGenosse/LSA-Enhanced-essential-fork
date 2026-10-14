import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {createM5SqliteServices} from '../src/memory/m5SqlitePrivacy.mjs';
import {selectAutomaticMemories} from '../src/memory/selection.mjs';
import {makeQueueJob} from '../src/memory/queueContract.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

const id=()=>randomUUID(),sha=s=>createHash('sha256').update(s).digest('hex');
// Real file-backed P2; native source is an explicit offline fixture. No M2/M5
// coordinator, optional worker or second production connection is constructed.
async function rig(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'memory-e2-'));
 const filePath=path.join(root,'p2.sqlite'),host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
 let store,now=Date.now(),sequence=0,authorized=true;
 const open=async()=>{store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});await store.initialize();};
 await open();const npc=await store.create(profile()),timelineId=await store.createTimeline({label:'E2'});
 store.setVerifiedHostContext(host);await store.confirmTimeline(timelineId);
 const scope={worldProfileId,characterId:npc.characterId,timelineId,protagonistKey:'franklin'};
 const privacy=()=>createM5SqliteServices({store,filePath,clock:()=>new Date(now).toISOString(),authorize:()=>authorized});
 const x={root,filePath,scope,host,privacy,
  get store(){return store;},set authorized(value){authorized=value;},advance:ms=>{now+=ms;},
  sql:fn=>store.withTimelineSqliteWrite(scope,fn),
  restart:async()=>{await store.close();await open();store.setVerifiedHostContext(host);await store.confirmTimeline(timelineId);},
  async accept(text,source='typed',avatar='franklin'){
   const r=await createConversationJournalRecorder(store).recordPlayerAccepted({characterId:npc.characterId,
    identity:{pedId:101,turnId:'e2-'+(++sequence),generationId:'g1',sessionNonce:'e2'},
    text,source,attribution:{protagonist:avatar}});
   return (await store.readDialogueLines({characterId:npc.characterId,timelineId})).find(row=>row.recordId===r.recordId);
  },
  async correct(target,mode='transcript'){
   const line=await x.accept('No, I actually said the blue bicycle');
   return store.commitCommand({scope,commandId:id(),requestedByLineId:line.recordId,
    operation:'correct',correctionMode:mode,content:'the blue bicycle',contentHash:sha('the blue bicycle'),
    evidenceRecordIds:[line.recordId,target.recordId],targetRecordId:target.recordId,requestedAtUtc:line.committedAtUtc});
  }};
 t.after(async()=>{await store.close();await fs.rm(root,{recursive:true,force:true});});return x;
}

for(const operation of ['inspect','export'])test(`E2 privileged ${operation} rechecks authorization after queue admission`,async t=>{
 const x=await rig(t);await x.accept('private operator archive');
 const pending=operation==='inspect'?x.privacy().inspect({scope:x.scope}):x.privacy().exportArchive({scope:x.scope});
 x.authorized=false;
 await assert.rejects(pending,/authorization/);
});

for(const mutation of [r=>({...r,targetIds:[id()]}),r=>({...r,durableCommit:false}),
 r=>({...r,operation:'restore'}),r=>({...r,committedAtUtc:'broken'})])
 test('E2 corrupted durable privacy receipt cannot certify a retry',async t=>{
  const x=await rig(t),line=await x.accept('receipt-bound private source'),operationId=id();
  const p=x.privacy(),r=await p.trash({scope:x.scope,targetId:line.recordId,operationId});
  await x.sql(db=>db.prepare('UPDATE m5_privacy_ops SET receipt_json=? WHERE operation_id=?').run(JSON.stringify(mutation(r)),operationId));
  await assert.rejects(p.verifyPrivacy({scope:x.scope,operationId}),/privacy.*(corrupt|integrity)/);
  await assert.rejects(p.trash({scope:x.scope,targetId:line.recordId,operationId}),/privacy.*(corrupt|integrity)/);
  assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(line.recordId));
 });

test('E2 restore rejects a partially purged bundle without clearing any permanent suppression',async t=>{
 const x=await rig(t),a=await x.accept('bundle private A'),b=await x.accept('bundle private B');
 const p=x.privacy(),op=id();await p.trashScope({scope:x.scope,operationId:op});
 const ticket=await x.sql(db=>{
  db.prepare('DELETE FROM dialogue_journal WHERE record_id=?').run(a.recordId);
  db.prepare('UPDATE m5_trash SET purged_at_utc=? WHERE operation_id=? AND target_id=?').run(new Date().toISOString(),op,a.recordId);
  return db.prepare('SELECT trash_id AS id FROM m5_trash WHERE operation_id=? AND target_id=?').get(op,b.recordId).id;
 });
 await assert.rejects(p.restore({scope:x.scope,trashId:ticket,operationId:id()}),/restore_unavailable|privacy.*integrity/);
 assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(a.recordId));
 assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(b.recordId));
});

test('E2 malformed restore expiry fails closed instead of releasing suppression',async t=>{
 const x=await rig(t),line=await x.accept('invalid expiry source'),op=id(),p=x.privacy();
 await p.trash({scope:x.scope,targetId:line.recordId,operationId:op});
 await x.sql(db=>db.prepare('UPDATE m5_trash SET purge_after_utc=? WHERE operation_id=?').run('not-a-time',op));
 await assert.rejects(p.restore({scope:x.scope,trashId:op,operationId:id()}),/restore_unavailable|privacy.*integrity/);
 assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(line.recordId));
});

test('E2 purge refuses corrupt permanent receipts before deleting recoverable source bytes',async t=>{
 const x=await rig(t),line=await x.accept('retain bytes on failed purge'),p=x.privacy(),op=id();
 await p.trash({scope:x.scope,targetId:line.recordId,operationId:op});x.advance(8*86400000);
 await x.sql(db=>db.prepare('UPDATE memory_suppressions SET receipt_sha256=?').run('0'.repeat(64)));
 await assert.rejects(p.purgeExpired({scope:x.scope}),/suppression_integrity/);
 assert.equal(await x.sql(db=>db.prepare('SELECT count(*) AS n FROM dialogue_journal WHERE record_id=?').get(line.recordId).n),1);
});

test('E2 purge rejects a corrupted editor receipt and an artificially early expiry',async t=>{
 const x=await rig(t),line=await x.accept('protect seven-day recovery'),op=id(),p=x.privacy();
 const receipt=await p.trash({scope:x.scope,targetId:line.recordId,operationId:op});
 await x.sql(db=>db.prepare('UPDATE m5_trash SET purge_after_utc=created_at_utc WHERE operation_id=?').run(op));
 await assert.rejects(p.purgeExpired({scope:x.scope}),/privacy.*integrity/);
 await x.sql(db=>{
  db.prepare('UPDATE m5_trash SET purge_after_utc=? WHERE operation_id=?')
   .run(new Date(Date.parse(receipt.committedAtUtc)+7*86400000).toISOString(),op);
  db.prepare('UPDATE m5_privacy_ops SET receipt_json=? WHERE operation_id=?').run('{}',op);
 });
 x.advance(8*86400000);
 await assert.rejects(p.purgeExpired({scope:x.scope}),/privacy.*integrity/);
 assert.equal(await x.sql(db=>db.prepare('SELECT count(*) AS n FROM dialogue_journal WHERE record_id=?').get(line.recordId).n),1);
});

for(const mutation of ["preferred_text='corrupted correction'","correction_mode='unsupported'"])
 test(`E2 correction visibility rejects corrupt metadata: ${mutation}`,async t=>{
  const x=await rig(t),line=await x.accept('I said the red bicycle','stt');await x.correct(line);
  await x.sql(db=>db.exec('UPDATE memory_corrections SET '+mutation));
  await assert.rejects(x.store.findCandidates({scope:x.scope}),/correction.*(corrupt|integrity)/);
  await assert.rejects(x.store.readCommittedEvidencePage({scope:x.scope,limit:20}),/correction.*(corrupt|integrity)/);
 });

test('E2 interrupted forget rolls back, durable retry survives process exit and startup replay',async t=>{
 const x=await rig(t),line=await x.accept('crash-bound private source'),operationId=id();
 await x.store.close();
 const storeModule=new URL('../src/characters/sqliteProfileStore.mjs',import.meta.url).href;
 const privacyModule=new URL('../src/memory/m5SqlitePrivacy.mjs',import.meta.url).href;
 const script=crash=>`import {createP2MemoryStorage} from ${JSON.stringify(storeModule)};
 import {createM5SqliteServices} from ${JSON.stringify(privacyModule)};
 const scope=${JSON.stringify(x.scope)},store=createP2MemoryStorage({filePath:${JSON.stringify(x.filePath)},worldProfileId:scope.worldProfileId,sourceRequired:true});
 await store.initialize();store.setVerifiedHostContext(${JSON.stringify(x.host)});await store.confirmTimeline(scope.timelineId);
 ${crash?`await store.withTimelineSqliteWrite(scope,db=>{db.function('e2_crash',()=>process.exit(73));db.exec('CREATE TEMP TRIGGER e2_crash BEFORE INSERT ON m5_privacy_ops BEGIN SELECT e2_crash(); END');});`:''}
 await createM5SqliteServices({store,filePath:store.filePath,authorize:()=>true}).trash({scope,targetId:${JSON.stringify(line.recordId)},operationId:${JSON.stringify(operationId)}});process.exit(74);`;
 const aborted=spawnSync(process.execPath,['--input-type=module','-e',script(true)],{encoding:'utf8',timeout:20000});
 assert.equal(aborted.status,73,aborted.stderr);await x.restart();
 assert.deepEqual(await x.store.listSuppressedMemoryIds(x.scope),[]);
 assert.deepEqual(await x.sql(db=>['memory_tombstones','memory_suppressions','m5_trash','m5_privacy_ops']
  .map(table=>db.prepare('SELECT count(*) AS n FROM '+table).get().n)),[0,0,0,0]);
 await x.store.close();
 const committed=spawnSync(process.execPath,['--input-type=module','-e',script(false)],{encoding:'utf8',timeout:20000});
 assert.equal(committed.status,74,committed.stderr);await x.restart();
 const replay=await x.store.readCommittedEvidencePage({scope:{...x.scope,protagonistKey:'trevor'},limit:20});
 assert.ok(!JSON.stringify(replay.items).includes(line.content));
 assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(line.recordId));
 const retry=await x.privacy().trash({scope:{...x.scope,protagonistKey:'michael'},targetId:line.recordId,operationId});
 assert.equal(retry.durableCommit,true);
});

test('E2 forget/restore/purge rejects stale derivation and curation leases, fresh IDs and restart resurrection',async t=>{
 const x=await rig(t),line=await x.accept('That was a hilarious and embarrassing secret bicycle crash!');
 const [proposal]=selectAutomaticMemories([line]);assert.ok(proposal);
 await x.store.saveDeterministicMemory(proposal);
 const now=new Date().toISOString(),job=makeQueueJob(proposal,now);
 await x.store.enqueueCurationJob({job});
 const [lease]=await x.store.claimCurationDue({limit:1,nowUtc:now,
  leaseUntilUtc:new Date(Date.parse(now)+60000).toISOString(),ownerId:id(),characterId:x.scope.characterId});
 assert.ok(lease);
 const p=x.privacy(),op=id();await p.trash({scope:x.scope,targetId:proposal.proposalId,operationId:op});
 assert.equal((await x.store.readPermanentMemoryRows(x.scope)).length,0);
 assert.equal((await x.store.readIntegratedRecall({scope:x.scope,limit:100})).rows.length,0);
 assert.deepEqual((await x.store.readCommittedEvidencePage({scope:x.scope})).items,[]);
 await assert.rejects(x.store.saveDeterministicMemory({...proposal,proposalId:id()}),/forgotten/);
 await assert.rejects(x.store.completeCurationLease({jobId:job.jobId,leaseToken:lease.leaseToken,
  proposal:{...proposal,provider:'luna',inCharacterTake:'A hilarious day.'},nowUtc:now}),/forgotten/);
 await p.restore({scope:{...x.scope,protagonistKey:'trevor'},trashId:op,operationId:id()});
 assert.equal((await x.store.readPermanentMemoryRows(x.scope)).length,1);
 assert.ok((await x.store.readCommittedEvidencePage({scope:x.scope})).items.some(r=>r.recordId===line.recordId));
 await p.trash({scope:x.scope,targetId:line.recordId,operationId:id()});x.advance(8*86400000);
 const purged=await p.purgeExpired({scope:x.scope});assert.equal((await p.verifyPurge({scope:x.scope,result:purged})).confirmed,true);
 await x.restart();
 assert.deepEqual((await x.store.readCommittedEvidencePage({scope:x.scope})).items,[]);
 assert.equal((await x.store.readIntegratedRecall({scope:x.scope,limit:100})).rows.length,0);
 await assert.rejects(x.accept(line.content,'typed','michael'),/forgotten/);
 await assert.rejects(x.store.saveDeterministicMemory({...proposal,proposalId:id()}),/forgotten|evidence/);
 await assert.rejects(x.privacy().restore({scope:x.scope,trashId:op,operationId:id()}),/restore_unavailable/);
});

test('E2 concurrent retries commit once, conflicting forgets and stale sources cannot cross the writer fence',async t=>{
 const x=await rig(t),line=await x.accept('concurrent private source'),op=id(),p=x.privacy();
 const [a,b]=await Promise.all(['franklin','trevor'].map(protagonistKey=>p.trash({
  scope:{...x.scope,protagonistKey},targetId:line.recordId,operationId:op})));
 assert.deepEqual(a,b);
 await assert.rejects(p.trash({scope:x.scope,targetId:line.recordId,operationId:id()}),/already_suppressed/);
 const count=await x.sql(db=>db.prepare('SELECT count(*) AS n FROM m5_privacy_ops').get().n);
 assert.equal(count,1);
 const pending=p.restore({scope:x.scope,trashId:op,operationId:id()});
 x.store.setVerifiedHostContext(null);
 await assert.rejects(pending,/timeline_write_suspended/);
 x.store.setVerifiedHostContext(x.host);await x.store.confirmTimeline(x.scope.timelineId);
 assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(line.recordId));
});

test('E2 wrong NPC, world, timeline and replay cursor never authorize privacy access',async t=>{
 const x=await rig(t),line=await x.accept('strictly scoped private source'),p=x.privacy(),op=id();
 await p.trash({scope:x.scope,targetId:line.recordId,operationId:op});
 const cursor=(await x.store.readCommittedEvidencePage({scope:x.scope})).cursor;
 const otherNpc=await x.store.create(profile({characterId:id()}));
 const otherTimeline=await x.store.createTimeline({label:'another save'});
 for(const wrong of [{...x.scope,characterId:otherNpc.characterId},{...x.scope,worldProfileId:id()},
  {...x.scope,timelineId:otherTimeline}]){
  await assert.rejects(p.restore({scope:wrong,trashId:op,operationId:id()}),/scope|owner|timeline|restore_unavailable/);
  await assert.rejects(x.store.readCommittedEvidencePage({scope:wrong,cursor}),/scope|owner|world|timeline|cursor/);
 }
 assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(line.recordId));
});

test('E2 original avatar-bound privacy hashes still verify across human avatar switches',async t=>{
 const x=await rig(t),line=await x.accept('legacy receipt compatibility'),p=x.privacy(),op=id();
 const receipt=await p.trash({scope:x.scope,targetId:line.recordId,operationId:op});
 const legacy=(avatar,fields)=>sha(JSON.stringify({scope:{characterId:x.scope.characterId,
  worldProfileId:x.scope.worldProfileId,timelineId:x.scope.timelineId,protagonistKey:avatar},...fields}));
 await x.sql(db=>db.prepare('UPDATE m5_privacy_ops SET request_sha256=? WHERE operation_id=?')
  .run(legacy('franklin',{targetId:line.recordId,operationId:op,operation:'trash'}),op));
 assert.deepEqual(await p.trash({scope:{...x.scope,protagonistKey:'trevor'},targetId:line.recordId,operationId:op}),receipt);
 const restore=id(),scope={...x.scope,protagonistKey:'michael'};
 const restored=await p.restore({scope,trashId:op,operationId:restore});
 await x.sql(db=>db.prepare('UPDATE m5_privacy_ops SET request_sha256=? WHERE operation_id=?')
  .run(legacy('michael',{trashId:op,operationId:restore,operation:'restore'}),restore));
 assert.deepEqual(await p.restore({scope:x.scope,trashId:op,operationId:restore}),restored);
});

test('E2 a pre-forget recovery snapshot stays metadata-only after live database corruption',async t=>{
 const x=await rig(t),line=await x.accept('secret that exists in an old backup');
 await x.store.snapshotAtSessionEnd();
 const p=x.privacy();await p.trash({scope:x.scope,targetId:line.recordId,operationId:id()});
 x.advance(8*86400000);await p.purgeExpired({scope:x.scope});await x.store.close();
 const snapshots=x.filePath+'.snapshots',names=await fs.readdir(snapshots);
 const weekly=names.find(n=>n.startsWith('weekly-'));assert.ok(weekly);
 const old=new DatabaseSync(path.join(snapshots,weekly),{readOnly:true});
 try{assert.equal(old.prepare('SELECT content FROM dialogue_journal WHERE record_id=?').get(line.recordId).content,line.content);}
 finally{old.close();}
 // Only a pre-forget copy is available to this simulated recovery operator.
 for(const name of names)if(name!==weekly)await fs.rm(path.join(snapshots,name));
 await fs.writeFile(x.filePath,'broken live database');
 const recovery=await x.store.inspectReadOnlyRecovery(x.scope);
 assert.equal(recovery.status,'read_only_snapshot');assert.equal(recovery.dialogue,null);
 assert.ok(!JSON.stringify(recovery).includes(line.content));
 const reopened=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
 await assert.rejects(reopened.initialize(),/database|sqlite/i);await reopened.close();
 assert.equal(await fs.readFile(x.filePath,'utf8'),'broken live database','recovery must never auto-restore an old snapshot');
});

test('E2 old single-item forget receipt cannot claim active suppression after restore',async t=>{
 const x=await rig(t),line=await x.accept('restored private memory'),p=x.privacy();
 const forgetId=id(),restoreId=id();
 const forget=await p.trash({scope:x.scope,targetId:line.recordId,operationId:forgetId});
 assert.equal(forget.durableCommit,true);
 await p.restore({scope:{...x.scope,protagonistKey:'trevor'},trashId:forgetId,operationId:restoreId});
 assert.ok(!(await x.store.listSuppressedMemoryIds(x.scope)).includes(line.recordId));
 await assert.rejects(p.verifyPrivacy({scope:x.scope,operationId:forgetId}),/privacy_receipt_inactive/);
 await assert.rejects(p.trash({scope:x.scope,targetId:line.recordId,operationId:forgetId}),/privacy_receipt_inactive/);
 const renewed=await p.trash({scope:x.scope,targetId:line.recordId,operationId:id()});
 assert.equal(renewed.durableCommit,true);
 // Restore receipt records its historical commit, not future visibility.
 assert.equal((await p.verifyPrivacy({scope:x.scope,operationId:restoreId})).operation,'restore');
 assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(line.recordId));
});

test('E2 restored scope forget cannot be replayed as a current successful deletion',async t=>{
 const x=await rig(t),a=await x.accept('scope restore A'),b=await x.accept('scope restore B');
 const p=x.privacy(),forgetId=id();
 const original=await p.trashScope({scope:x.scope,operationId:forgetId});
 assert.equal(original.targetIds.length,2);
 const ticket=(await p.inspect({scope:x.scope})).trash.find(z=>z.targetId===a.recordId).trashId;
 await p.restore({scope:x.scope,trashId:ticket,operationId:id()});
 assert.ok(!(await x.store.listSuppressedMemoryIds(x.scope)).includes(a.recordId));
 assert.ok(!(await x.store.listSuppressedMemoryIds(x.scope)).includes(b.recordId));
 await assert.rejects(p.verifyPrivacy({scope:x.scope,operationId:forgetId}),/privacy_receipt_inactive/);
 await assert.rejects(p.trashScope({scope:{...x.scope,protagonistKey:'michael'},operationId:forgetId}),/privacy_receipt_inactive/);
});

test('E2 durable receipt rejects missing original suppression with intact trash metadata',async t=>{
 const x=await rig(t),line=await x.accept('lost suppression receipt'),p=x.privacy(),op=id();
 await p.trash({scope:x.scope,targetId:line.recordId,operationId:op});
 await x.sql(db=>{
  db.prepare('DELETE FROM memory_suppressions WHERE command_id=?').run(op);
  db.prepare('DELETE FROM memory_tombstones WHERE command_id=?').run(op);
 });
 await assert.rejects(p.verifyPrivacy({scope:x.scope,operationId:op}),/privacy_receipt_integrity_failed/);
 await assert.rejects(p.trash({scope:x.scope,targetId:line.recordId,operationId:op}),/privacy_receipt_integrity_failed/);
 assert.equal(await x.sql(db=>db.prepare('SELECT count(*) AS n FROM dialogue_journal WHERE record_id=?').get(line.recordId).n),1);
});

test('E2 scope receipt requires the complete original suppression bundle',async t=>{
 const x=await rig(t),a=await x.accept('bundle A'),b=await x.accept('bundle B');
 const p=x.privacy(),op=id();await p.trashScope({scope:x.scope,operationId:op});
 await x.sql(db=>db.prepare('DELETE FROM memory_suppressions WHERE command_id=? AND target_id=?').run(op,b.recordId));
 await assert.rejects(p.verifyPrivacy({scope:x.scope,operationId:op}),/privacy_receipt_integrity_failed/);
 assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(a.recordId));
});

test('E2 archive creation revocation does not leave sensitive files on disk',async t=>{
 const x=await rig(t);await x.accept('sensitive archive content');
 for(const allowedCalls of [4,5,6,7]){
  let calls=0;
  const p=createM5SqliteServices({store:x.store,filePath:x.filePath,
   authorize:()=>++calls<=allowedCalls});
  const destinationPath=path.join(x.root,'revoked-'+allowedCalls+'.json');
  await assert.rejects(p.writeArchive({scope:x.scope,destinationPath}),/authorization/);
  await assert.rejects(fs.stat(destinationPath),{code:'ENOENT'});
 }
});
