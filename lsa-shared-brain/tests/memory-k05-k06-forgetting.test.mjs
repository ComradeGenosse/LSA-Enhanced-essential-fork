// Actual production P2 SQLite paths; only native receipts and Luna transport
// are offline fixtures. No billable calls, packaging, or GTA deployment.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {createM5SqliteServices} from '../src/memory/m5SqlitePrivacy.mjs';
import {selectAutomaticMemories} from '../src/memory/selection.mjs';
import {makeQueueJob} from '../src/memory/queueContract.mjs';
import {createDurableCurationAdapters,createM3WitnessRecorder} from '../src/memory/integrationPorts.mjs';
import {processIdleCuration} from '../src/memory/lunaCurator.mjs';
import {readCurationAppraisals} from '../src/memory/curationSqlite.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';
const id=()=>randomUUID(),sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const DAY=86400000;
async function fixture(t){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'k05-k06-'));
 let store,privacy,now=Date.now(),sequence=0;
 const filePath=path.join(root,'p2.sqlite'),host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
 const open=async()=>{
  store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();store.setVerifiedHostContext(host);
 };
 await open();
 const npc=await store.create(profile()),timelineId=await store.createTimeline({label:'forgetting'});
 const scope={worldProfileId,characterId:npc.characterId,timelineId,protagonistKey:'franklin'};
 await store.confirmTimeline(timelineId,{confirmation:timelineId});
 const service=()=>privacy=createM5SqliteServices({store,filePath,clock:()=>new Date(now).toISOString(),
  authorize:({scope:s})=>s.worldProfileId===worldProfileId&&s.characterId===scope.characterId&&s.timelineId===timelineId});
 service();await privacy.ready(scope);
 t.after(async()=>{await store.close();await fs.rm(root,{recursive:true,force:true});});
 const say=async(text,{avatar='franklin',characterId=scope.characterId}={})=>{
  const result=await createConversationJournalRecorder(store).recordPlayerAccepted({characterId,
   identity:{pedId:101,turnId:'k-forget-'+(++sequence),generationId:'g1',sessionNonce:'k-forget'},
   source:'typed',text,attribution:{protagonist:avatar}});
  return (await store.readDialogueLines({characterId,timelineId:store.activeTimelineId})).find(r=>r.recordId===result.recordId);
 };
 const command=(line,operation,{target=null,content=line.content}={})=>({scope,
  commandId:id(),requestedByLineId:line.recordId,operation,origin:'explicit_player',
  recordType:'permanent_memory',content,contentHash:sha(content),pin:false,
  evidenceRecordIds:[...new Set([line.recordId,...(target?[target]:[])])],targetRecordId:target,
  correctionMode:null,subjectCertainty:null,requestedAtUtc:line.committedAtUtc});
 const proposal=line=>{
  const [p]=selectAutomaticMemories([line]);assert.ok(p,'real deterministic selector positive control');return p;
 };
 return {scope,host,filePath,say,command,proposal,
  get store(){return store;},get privacy(){return privacy;},
  advance:days=>{now+=days*DAY;},
  restart:async()=>{await store.close();await open();await store.confirmTimeline(timelineId,{confirmation:timelineId});service();await privacy.ready(scope);},
  recall:()=>store.readIntegratedRecall({scope,limit:384}),
  sql:fn=>store.withP2SqliteRead(scope,fn),
  write:fn=>store.withTimelineSqliteWrite(scope,fn),
  ports:()=>createDurableCurationAdapters(store,{dailyUsd:1,monthlyUsd:5})};
}
const appraisal=p=>({...p,provider:'luna',inCharacterTake:'That was hilarious.'});
const worker=(ports,provider,extra={})=>processIdleCuration({enabled:true,queue:ports.queue,ledger:ports.ledger,
 provider,ownerId:id(),estimatedMaxCostUsd:.02,strictAck:true,...extra});
const neverProvider=()=>({curateBatch:async()=>assert.fail('forgotten evidence reached Luna')});

test('K05 explicit forget -> purge -> restart -> replay/curation never resurrects source',async t=>{
 const x=await fixture(t),line=await x.say('That was hilarious and embarrassing! I ordered ramen.');
 const p=x.proposal(line);await x.store.saveDeterministicMemory(p);
 const job=makeQueueJob(p,new Date(Date.now()-1000).toISOString());
 await x.store.enqueueCurationJob({job});
 const forgetLine=await x.say('Forget that ramen memory');
 await x.privacy.bindCommands().commitCommand(x.command(forgetLine,'forget',{target:p.proposalId}));
 assert.deepEqual((await x.recall()).rows.map(r=>r.recordId),[forgetLine.recordId]);
 assert.equal((await x.store.readCommittedEvidencePage({scope:x.scope})).items.some(i=>i.recordId===line.recordId),false);
 await assert.rejects(x.store.saveDeterministicMemory({...p,proposalId:id()}),/curation_source_forgotten/);
 await assert.rejects(x.store.enqueueCurationJob({job}),/curation_source_forgotten/);
 assert.deepEqual(await worker(x.ports(),neverProvider()),{status:'empty',processed:0});
 x.advance(8);
 const purged=await x.privacy.purgeExpired({scope:x.scope});
 assert.equal((await x.privacy.verifyPurge({scope:x.scope,result:purged})).confirmed,true);
 assert.ok(purged.purgedIds.includes(line.recordId));
 assert.equal(await x.sql(db=>db.prepare('SELECT count(*) AS n FROM dialogue_journal WHERE record_id=?').get(line.recordId).n),0);
 await x.restart();
 assert.equal((await x.recall()).rows.some(r=>[line.recordId,p.proposalId].includes(r.recordId)),false);
 assert.equal((await x.store.readCommittedEvidencePage({scope:x.scope})).items.some(i=>i.recordId===line.recordId),false);
 await assert.rejects(x.store.saveDeterministicMemory(p),/curation_source_forgotten/);
 await assert.rejects(x.store.enqueueCurationJob({job}),/curation_source_forgotten/);
 await assert.rejects(x.say(line.content,{avatar:'trevor'}),/memory_source_forgotten/);
 assert.deepEqual(await worker(x.ports(),neverProvider()),{status:'empty',processed:0});
 const safe=await x.say('That was hilarious! A new adventure with coffee.');
 assert.equal((await x.store.saveDeterministicMemory(x.proposal(safe))).inserted,true);
});

test('K06 deterministic replay is denied before idempotency, including transitive siblings',async t=>{
 const x=await fixture(t),line=await x.say('That was hilarious and embarrassing! Purple scooter.'),p=x.proposal(line);
 await x.store.saveDeterministicMemory(p);
 const sister={...p,proposalId:id(),groundedSummary:p.groundedSummary+' Another interpretation.'};
 await x.store.saveDeterministicMemory(sister);
 await x.privacy.trash({scope:x.scope,targetId:p.proposalId});
 for(const attempt of [p,sister,{...p,proposalId:id()}])
  await assert.rejects(x.store.saveDeterministicMemory(attempt),/curation_source_forgotten/);
 assert.equal((await x.store.readPermanentMemoryRows(x.scope)).length,0);
 x.advance(8);await x.privacy.purgeExpired({scope:x.scope});await x.restart();
 for(const attempt of [p,sister])await assert.rejects(x.store.saveDeterministicMemory(attempt),/curation_source_forgotten/);
});

test('K06 leased Luna completion after forget and expired lease replay after restart fail closed',async t=>{
 const x=await fixture(t),line=await x.say('That was hilarious and embarrassing! Secret ramen.'),p=x.proposal(line);
 await x.store.saveDeterministicMemory(p);
 const job=makeQueueJob(p,new Date(Date.now()-1000).toISOString());await x.store.enqueueCurationJob({job});
 const [lease]=await x.store.claimCurationDue({limit:1,nowUtc:new Date().toISOString(),leaseUntilUtc:new Date(Date.now()+60000).toISOString(),ownerId:id()});
 assert.ok(lease);
 await x.privacy.trash({scope:x.scope,targetId:p.proposalId});
 await assert.rejects(x.store.completeCurationLease({jobId:job.jobId,leaseToken:lease.leaseToken,proposal:appraisal(p)}),/curation_source_forgotten/);
 await x.restart();
 assert.deepEqual(await x.store.claimCurationDue({limit:1,nowUtc:new Date(Date.now()+120000).toISOString(),leaseUntilUtc:new Date(Date.now()+180000).toISOString(),ownerId:id()}),[]);
 x.advance(8);await x.privacy.purgeExpired({scope:x.scope});await x.restart();
 await assert.rejects(x.store.completeCurationLease({jobId:job.jobId,leaseToken:lease.leaseToken,proposal:appraisal(p)}),/curation_lease_not_current/);
 assert.equal(await x.sql(db=>db.prepare('SELECT count(*) AS n FROM memory_luna_appraisals').get().n),0);
});

test('K06 forget while awaiting budget prevents Luna transport; forget during transport prevents commit',async t=>{
 for(const boundary of ['budget','transport']){
  const x=await fixture(t),line=await x.say('That was hilarious and embarrassing! '+boundary),p=x.proposal(line);
  await x.store.saveDeterministicMemory(p);
  await x.store.enqueueCurationJob({job:makeQueueJob(p,new Date(Date.now()-1000).toISOString())});
  const ports=x.ports();let calls=0;
  const forget=()=>x.privacy.trash({scope:x.scope,targetId:p.proposalId});
  const ledger=boundary==='budget'?{...ports.ledger,reserve:async a=>{const r=await ports.ledger.reserve(a);await forget();return r;}}:ports.ledger;
  const result=await worker({...ports,ledger},{curateBatch:async originals=>{calls++;await forget();return originals.map(appraisal);}});
  assert.equal(result.processed,0);
  assert.equal(calls,boundary==='budget'?0:1);
  assert.equal(await x.sql(db=>db.prepare('SELECT count(*) AS n FROM memory_luna_appraisals').get().n),0);
 }
});

test('K06 strict Luna worker makes no claims or transport when durable verification is unavailable',async()=>{
 const queue=Object.fromEntries(['enqueueIfAbsent','claimDue','completeLeased','retryLeased','releaseLeased'].map(k=>[k,async()=>assert.fail('queue must not run')]));
 const ledger=Object.fromEntries(['reserve','settle','release'].map(k=>[k,async()=>assert.fail('ledger must not run')]));
 assert.deepEqual(await worker({queue,ledger},neverProvider()),{status:'source_verification_unavailable',processed:0});
});

test('K05 restore before expiry releases only its bundle, preserves bytes, and re-offers cursor-skipped sources',async t=>{
 const x=await fixture(t),line=await x.say('That was hilarious and embarrassing! Restore ramen.'),p=x.proposal(line);
 await x.store.saveDeterministicMemory(p);
 const forgotten=await x.privacy.trash({scope:x.scope,targetId:p.proposalId});
 const page=await x.store.readCommittedEvidencePage({scope:x.scope});assert.equal(page.items.length,0);
 await x.store.ackCommittedEvidenceCursor({scope:x.scope,consumerId:'restore-test',cursor:page.cursor});
 await x.restart();
 const restored=await x.privacy.restore({scope:{...x.scope,protagonistKey:'trevor'},trashId:forgotten.operationId});
 assert.ok(restored.targetIds.includes(line.recordId));
 assert.equal((await x.recall()).rows.find(r=>r.recordId===line.recordId).envelope.content,line.content);
 const next=await x.store.readCommittedEvidencePage({scope:x.scope,cursor:page.cursor});
 assert.deepEqual(next.items.map(i=>i.recordId),[line.recordId]);
 const job=makeQueueJob(p,new Date(Date.now()-1000).toISOString());await x.store.enqueueCurationJob({job});
 assert.deepEqual(await worker(x.ports(),{curateBatch:async originals=>originals.map(appraisal)}),{status:'completed',processed:1});
 assert.equal((await x.sql(db=>readCurationAppraisals(db,x.scope,worldProfileId))).length,1);
 await x.restart();assert.equal((await x.store.readPermanentMemoryRows(x.scope)).length,1);
});

test('K05 restore cannot clear a separate forget with identical content or restore expired/purged trash',async t=>{
 const x=await fixture(t),a=await x.say('That was hilarious! Identical ramen.'),b=await x.say(a.content,{avatar:'michael'});
 const first=await x.privacy.trash({scope:x.scope,targetId:a.recordId});
 const second=await x.privacy.trash({scope:x.scope,targetId:b.recordId});
 await x.privacy.restore({scope:x.scope,trashId:first.operationId});
 assert.equal((await x.recall()).rows.length,0);
 await assert.rejects(x.say(a.content),/memory_source_forgotten/);
 x.advance(8);await assert.rejects(x.privacy.restore({scope:x.scope,trashId:second.operationId}),/m5_restore_unavailable/);
 await x.privacy.purgeExpired({scope:x.scope});await x.restart();
 await assert.rejects(x.privacy.restore({scope:x.scope,trashId:second.operationId}),/m5_restore_unavailable/);
 assert.equal((await x.recall()).rows.length,0);
});

test('K05 suppression is shared across avatars and isolated across NPCs and confirmed timelines',async t=>{
 const x=await fixture(t),text='That was hilarious and embarrassing! Scoped ramen.',a=await x.say(text);
 await x.privacy.trash({scope:x.scope,targetId:a.recordId});x.advance(8);await x.privacy.purgeExpired({scope:x.scope});
 for(const avatar of ['franklin','michael','trevor','unknown'])await assert.rejects(x.say(text,{avatar}),/memory_source_forgotten/);
 const npc=await x.store.create(profile());assert.ok(await x.say(text,{characterId:npc.characterId}));
 const timeline=await x.store.createTimeline({label:'separate future'});await x.store.confirmTimeline(timeline,{confirmation:timeline});
 assert.ok(await x.say(text));
 await x.store.confirmTimeline(x.scope.timelineId,{confirmation:x.scope.timelineId});await assert.rejects(x.say(text),/memory_source_forgotten/);
});

test('K05 legacy target-only tombstone upgrades to permanent source suppression before purge',async t=>{
 const x=await fixture(t),line=await x.say('That was hilarious and embarrassing! Legacy ramen.'),p=x.proposal(line),op=id();
 await x.store.saveDeterministicMemory(p);
 await x.write(db=>db.prepare('INSERT INTO memory_tombstones VALUES(?,?,?,?,?,?)').run(x.scope.characterId,worldProfileId,x.scope.timelineId,p.proposalId,op,new Date().toISOString()));
 await x.restart();
 assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(line.recordId));
 x.advance(8);await x.privacy.purgeExpired({scope:x.scope});await x.restart();
 await assert.rejects(x.say(line.content),/memory_source_forgotten/);
});

test('K05 legacy purge with lost provenance fails closed only in its own scope',async t=>{
 const x=await fixture(t),missing=id(),op=id(),at=new Date().toISOString();
 await x.write(db=>db.prepare('INSERT INTO m5_trash VALUES(?,?,?,?,?,?,?,?,?,NULL,?)').run(op,op,missing,worldProfileId,x.scope.characterId,x.scope.timelineId,'franklin',at,at,at));
 await x.restart();
 await assert.rejects(x.recall(),/memory_suppression_integrity_unavailable/);
 await assert.rejects(x.say('This scope cannot prove what was forgotten'),/memory_suppression_integrity_unavailable/);
 const safeNpc=await x.store.create(profile());assert.ok(await x.say('Other NPC remains usable',{characterId:safeNpc.characterId}));
});

test('K05 altered fingerprint or missing suppression schema denies recall, replay, curation and source writes',async t=>{
 const x=await fixture(t),line=await x.say('That was hilarious! Integrity ramen.'),p=x.proposal(line);
 await x.store.saveDeterministicMemory(p);
 await x.privacy.trash({scope:x.scope,targetId:p.proposalId});
 await x.write(db=>db.prepare('UPDATE memory_suppressions SET content_sha256=? WHERE target_id=?').run('0'.repeat(64),line.recordId));
 for(const read of [()=>x.recall(),()=>x.store.readCommittedEvidencePage({scope:x.scope}),()=>x.store.saveDeterministicMemory(p),()=>x.say(line.content)])
  await assert.rejects(read(),/memory_suppression_integrity_unavailable/);
 await x.write(db=>db.exec('DROP TABLE memory_suppressions'));
 await assert.rejects(x.recall(),/no such table/);
 await x.restart();
 await assert.rejects(x.say(line.content),/memory_source_forgotten/);
});

test('K05 a deleted permanent receipt cannot downgrade purge integrity to ID-only suppression',async t=>{
 const x=await fixture(t),line=await x.say('That was hilarious! Deleted receipt ramen.');
 await x.privacy.trash({scope:x.scope,targetId:line.recordId});x.advance(8);
 const purge=await x.privacy.purgeExpired({scope:x.scope});
 await x.write(db=>db.prepare('DELETE FROM memory_suppressions WHERE target_id=?').run(line.recordId));
 await assert.rejects(x.privacy.verifyPurge({scope:x.scope,result:purge}),/memory_suppression_integrity_unavailable/);
 await assert.rejects(x.say(line.content),/memory_suppression_integrity_unavailable/);
 await x.restart();
 await assert.rejects(x.recall(),/memory_suppression_integrity_unavailable/);
});

test('K06 unverifiable source bytes between claim and transport cannot reach Luna',async t=>{
 const x=await fixture(t),line=await x.say('That was hilarious! Verified ramen.'),p=x.proposal(line);
 await x.store.saveDeterministicMemory(p);
 await x.store.enqueueCurationJob({job:makeQueueJob(p,new Date(Date.now()-1000).toISOString())});
 const ports=x.ports(),ledger={...ports.ledger,reserve:async a=>{
  const reserved=await ports.ledger.reserve(a);
  await x.write(db=>db.prepare('UPDATE dialogue_journal SET content=? WHERE record_id=?').run('tampered',line.recordId));
  return reserved;
 }};
 assert.equal((await worker({...ports,ledger},neverProvider())).processed,0);
 assert.equal(await x.sql(db=>db.prepare('SELECT count(*) AS n FROM memory_luna_appraisals').get().n),0);
});

test('K05 atomic M5 command path retains ancestral closure and cannot remember suppressed content',async t=>{
 const x=await fixture(t),line=await x.say('Remember that ramen was embarrassing');
 const saved=await x.store.commitCommand(x.command(line,'remember',{content:'ramen was embarrassing'}));
 const later=await x.say('Remember the ramen experience again');
 const derived=await x.store.commitCommand(x.command(later,'remember',{target:saved.memoryId,content:'derived ramen recollection'}));
 const forgottenLine=await x.say('Forget the first ramen memory');
 const forget=x.command(forgottenLine,'forget',{target:saved.memoryId});
 assert.equal((await x.privacy.commitAtomicBatch({scope:x.scope,line:forgottenLine,operations:[forget]}))[0].durableCommit,true);
 const hidden=await x.store.listSuppressedMemoryIds(x.scope);
 for(const target of [line.recordId,saved.memoryId,later.recordId,derived.memoryId])assert.ok(hidden.includes(target));
 // Fresh evidence and a remapped command ID cannot evade content fingerprints.
 const clean=await x.say('A separate source without the forgotten wording');
 const restoreAttempt=x.command(clean,'remember',{content:'ramen was embarrassing'});
 await assert.rejects(x.store.commitCommand(restoreAttempt),/memory_source_forgotten/);
 await assert.rejects(x.privacy.commitAtomicBatch({scope:x.scope,line:clean,operations:[restoreAttempt]}),/memory_source_forgotten/);
 x.advance(8);
 // The source closure is indivisible even with a smaller requested purge cap.
 assert.deepEqual((await x.privacy.purgeExpired({scope:x.scope,limit:1})).purgedIds,[]);
 await x.privacy.purgeExpired({scope:x.scope,limit:100});await x.restart();
 await assert.rejects(x.store.commitCommand({...restoreAttempt,commandId:id()}),/memory_source_forgotten/);
 assert.ok((await x.recall()).rows.every(r=>![line.recordId,later.recordId,derived.memoryId].includes(r.recordId)));
});

test('K06 completed Luna opinions disappear through scope forget/purge/restart and leave no content archive',async t=>{
 const x=await fixture(t),line=await x.say('That was hilarious and embarrassing! Luna ramen.'),p=x.proposal(line);
 await x.store.saveDeterministicMemory(p);
 await x.store.enqueueCurationJob({job:makeQueueJob(p,new Date(Date.now()-1000).toISOString())});
 assert.equal((await worker(x.ports(),{curateBatch:async originals=>originals.map(appraisal)})).processed,1);
 assert.equal((await x.sql(db=>readCurationAppraisals(db,x.scope,worldProfileId))).length,1);
 const forgotten=await x.privacy.trashScope({scope:x.scope});assert.ok(forgotten.targetIds.includes(line.recordId));
 assert.deepEqual(await x.sql(db=>readCurationAppraisals(db,x.scope,worldProfileId)),[]);
 x.advance(8);const purge=await x.privacy.purgeExpired({scope:x.scope});
 assert.equal((await x.privacy.verifyPurge({scope:x.scope,result:purge})).confirmed,true);
 await x.restart();
 const archive=await x.privacy.exportArchive({scope:x.scope});
 assert.equal(archive.json.includes(line.content),false);
 assert.equal(archive.json.includes('That was hilarious.'),false);
 assert.equal(await x.sql(db=>db.prepare('SELECT count(*) AS n FROM memory_luna_appraisals').get().n),0);
 await assert.rejects(x.store.saveDeterministicMemory(p),/curation_source_forgotten/);
});

test('K05 forget transaction rolls back suppression and trash on corrupt provenance or SQL failure',async t=>{
 const x=await fixture(t),line=await x.say('That was hilarious and embarrassing! Atomic ramen.'),p=x.proposal(line);
 await x.store.saveDeterministicMemory(p);
 await x.write(db=>db.exec("CREATE TRIGGER k05_abort BEFORE INSERT ON m5_trash BEGIN SELECT RAISE(ABORT,'forced_privacy_failure'); END"));
 await assert.rejects(x.privacy.trash({scope:x.scope,targetId:p.proposalId}),/forced_privacy_failure/);
 assert.equal(await x.sql(db=>db.prepare('SELECT count(*) AS n FROM memory_suppressions').get().n),0);
 assert.ok((await x.recall()).rows.some(r=>r.recordId===line.recordId));
 await x.write(db=>{db.exec('DROP TRIGGER k05_abort');db.prepare('UPDATE dialogue_journal SET content_sha256=? WHERE record_id=?').run('0'.repeat(64),line.recordId);});
 await assert.rejects(x.privacy.trash({scope:x.scope,targetId:p.proposalId}),/memory_suppression_integrity_unavailable/);
 assert.equal(await x.sql(db=>db.prepare('SELECT count(*) AS n FROM memory_suppressions').get().n),0);
});

test('K05 witnessed event replay and newer revisions stay forgotten after purge/restart',async t=>{
 const x=await fixture(t),adapterEpoch=id(),observationId=id(),ownerProof={ownerAlias:x.store.get(x.scope.characterId).promotion.ownerAlias,
  incarnationId:id(),encounterId:id(),hostRunId:x.host.hostRunId,worldEpoch:1,observerCaptureRef:id()};
 const identity={promoted:true,current:true,...x.scope,adapterEpoch,ownerProof};
 const observation={version:1,observationId,episodeId:id(),revision:1,observer:{captureRef:ownerProof.observerCaptureRef,kind:'ped'},
  observedAt:{nativeRun:adapterEpoch,gameTick:100,receivedUtc:new Date().toISOString()},eventType:'firing_burst',
  claims:[{claimId:id(),kind:'firing',certainty:'supported',evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:100}}]};
 const capture=observation=>createM3WitnessRecorder({store:x.store,authorize:()=>identity}).capture({candidate:identity,observation});
 assert.equal((await capture(observation)).inserted,true);
 const [event]=await x.store.readJournalEvents({characterId:x.scope.characterId,timelineId:x.scope.timelineId});
 await x.privacy.trash({scope:x.scope,targetId:event.recordId});x.advance(8);await x.privacy.purgeExpired({scope:x.scope});await x.restart();
 await assert.rejects(capture(observation),/memory_source_forgotten/);
 await assert.rejects(capture({...observation,revision:2}),/memory_source_forgotten/);
 assert.equal((await x.recall()).rows.length,0);
});
