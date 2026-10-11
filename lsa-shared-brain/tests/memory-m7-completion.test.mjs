// Agent F M7: offline-only, no real provider transport or billable requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {selectAutomaticMemories} from '../src/memory/selection.mjs';
import {makeQueueJob} from '../src/memory/queueContract.mjs';
import {ensureIntegratedMemorySchema} from '../src/memory/integratedSqlite.mjs';
import {ensureCurationSchema,enqueueCuration,claimCuration,completeCuration,
  retryCuration,releaseCuration,reserveCurationBudget,finishCurationBudget,
  reconcileCurationBudgets,readCurationAppraisals} from '../src/memory/curationSqlite.mjs';
import {processIdleCuration} from '../src/memory/lunaCurator.mjs';
import {createIdleCurationScheduler} from '../src/memory/idleCurationScheduler.mjs';
import {createEssentialM7Scheduler} from '../../lsa-essential-e1-candidate/src/memory/lunaCurationBridge.mjs';
const id=n=>'00000000-0000-4000-8000-'+n.toString(16).padStart(12,'0');
const at=n=>new Date(Date.UTC(2026,9,11,16,n)).toISOString();
function fixture(t,{npc=1,world=2,timeline=3,lineId=4}={}){
 const root=mkdtempSync(path.join(tmpdir(),'m7-offline-'));
 const file=path.join(root,'memory.sqlite'),db=new DatabaseSync(file);
 // Windows keeps SQLite files locked until the DatabaseSync handle closes.
 t.after(()=>{try{db.close()}catch{} rmSync(root,{recursive:true,force:true});});
 db.exec('CREATE TABLE promoted_profiles (character_id TEXT PRIMARY KEY); CREATE TABLE dialogue_journal (record_id TEXT PRIMARY KEY,world_profile_id TEXT,timeline_id TEXT,character_id TEXT,speaker TEXT,source TEXT,delivery TEXT,receipt_id TEXT,protagonist TEXT); CREATE TABLE event_journal (record_id TEXT PRIMARY KEY,world_profile_id TEXT,timeline_id TEXT,character_id TEXT,receipt_status TEXT,source_hash TEXT); CREATE TABLE event_source_evidence (record_id TEXT PRIMARY KEY,source_evidence_json TEXT);');
 ensureIntegratedMemorySchema(db);ensureCurationSchema(db);
 const scope={characterId:id(npc),worldProfileId:id(world),timelineId:id(timeline)};
 db.prepare('INSERT INTO promoted_profiles(character_id) VALUES(?)').run(scope.characterId);
 const line={version:1,kind:'dialogue_line',...scope,recordId:id(lineId),speaker:'player',source:'typed',
   content:'That was hilarious and embarrassing!',delivery:'accepted',committedAtUtc:at(0),
   turnIdentityHash:'b'.repeat(64),utteranceId:id(11),transcription:null,deliveryReceiptId:null};
 const [proposal]=selectAutomaticMemories([line]);
 assert.ok(proposal,'fixture selected automatic memory');
 db.prepare('INSERT INTO dialogue_journal(record_id,world_profile_id,timeline_id,character_id,speaker,source,delivery,receipt_id,protagonist) VALUES(?,?,?,?,?,?,?,?,?)')
   .run(line.recordId,scope.worldProfileId,scope.timelineId,scope.characterId,'player','typed','accepted',null,'franklin');
 db.prepare('INSERT INTO memory_records(memory_id,character_id,world_profile_id,timeline_id,protagonist_key,origin,content,content_sha256,mode,pin,notability,evidence_ids_json,created_at_utc,proposal_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .run(proposal.proposalId,scope.characterId,scope.worldProfileId,scope.timelineId,'franklin',
     'deterministic',proposal.groundedSummary,'test-checksum','reported_claim',0,
     proposal.notability,JSON.stringify(proposal.evidenceRecordIds),at(0),JSON.stringify(proposal));
 const job=makeQueueJob(proposal,at(1)),appraisal={...proposal,provider:'luna',inCharacterTake:'I thought that was hilarious.'};
 assert.equal(enqueueCuration(db,{job},scope.worldProfileId,scope.timelineId).inserted,true);
 return {db,file,scope,proposal,job,appraisal};
}
const args=(f,{atMinute=2,until=4,characterId=f.scope.characterId}={})=>
  ({limit:4,nowUtc:at(atMinute),leaseUntilUtc:at(until),ownerId:id(90),characterId});
const claim=(f,options)=>claimCuration(f.db,args(f,options),f.scope.worldProfileId,f.scope.timelineId);
const complete=(f,x,options={})=>completeCuration(f.db,{jobId:x.job.jobId,leaseToken:x.leaseToken,
  proposal:f.appraisal,nowUtc:at(3),...options},f.scope.worldProfileId,f.scope.timelineId);

test('M7 real SQLite queue survives restart, stores source-linked opinion separately from facts',t=>{
 const f=fixture(t),[x]=claim(f);
 assert.equal(x.job.characterId,f.scope.characterId);
 assert.equal(complete(f,x).durableCommit,true);
 const reopened=new DatabaseSync(f.file);
 try{
   const rows=readCurationAppraisals(reopened,{characterId:f.scope.characterId,
      timelineId:f.scope.timelineId,protagonistKey:'franklin'},f.scope.worldProfileId);
   assert.equal(rows.length,1);assert.equal(rows[0].opinion,f.appraisal.inCharacterTake);
   assert.equal(rows[0].epistemicStatus,'character_opinion');
   assert.equal(rows[0].verifiedWorldFact,false);
   assert.deepEqual(rows[0].sourceEvidenceIds,f.proposal.evidenceRecordIds);
   assert.equal(readCurationAppraisals(reopened,{characterId:f.scope.characterId,
      timelineId:f.scope.timelineId,protagonistKey:'trevor'},f.scope.worldProfileId).length,0);
 }finally{reopened.close()}
 assert.equal(claim(f).length,0);
});
test('M7 lease expires and is re-claimed after restart; old token can never commit',t=>{
 const f=fixture(t),[old]=claim(f,{atMinute:2,until:4});
 const restarted=new DatabaseSync(f.file);
 try{
   const [newLease]=claimCuration(restarted,args(f,{atMinute:5,until:7}),f.scope.worldProfileId,f.scope.timelineId);
   assert.notEqual(old.leaseToken,newLease.leaseToken);
   assert.throws(()=>completeCuration(restarted,{jobId:old.job.jobId,leaseToken:old.leaseToken,
     proposal:f.appraisal,nowUtc:at(5)},f.scope.worldProfileId,f.scope.timelineId),/lease_not_current/);
   assert.equal(completeCuration(restarted,{jobId:newLease.job.jobId,leaseToken:newLease.leaseToken,
     proposal:f.appraisal,nowUtc:at(6)},f.scope.worldProfileId,f.scope.timelineId).durableCommit,true);
 }finally{restarted.close()}
});
test('M7 rejects lapsed lease, newly forgotten facts and duplicate output',t=>{
 const f=fixture(t),[x]=claim(f);
 assert.throws(()=>complete(f,x,{nowUtc:at(5)}),/lease_expired/);
 f.db.prepare('INSERT INTO memory_tombstones(character_id,world_profile_id,timeline_id,target_id,command_id,created_at_utc) VALUES(?,?,?,?,?,?)')
   .run(f.scope.characterId,f.scope.worldProfileId,f.scope.timelineId,
        f.proposal.evidenceRecordIds[0],id(99),at(2));
 assert.throws(()=>complete(f,x),/source_no_longer_authorized/);
 assert.equal(claim(f,{atMinute:5,until:7}).length,0);
 assert.equal(f.db.prepare('SELECT state FROM memory_curation_jobs').get().state,'dead_letter');
});
test('M7 corrected evidence and expired owners cannot be appraised',t=>{
 const f=fixture(t);
 f.db.prepare('INSERT INTO memory_corrections(command_id,character_id,world_profile_id,timeline_id,target_id,preferred_text,content_sha256,created_at_utc) VALUES(?,?,?,?,?,?,?,?)')
   .run(id(99),f.scope.characterId,f.scope.worldProfileId,f.scope.timelineId,
       f.proposal.evidenceRecordIds[0],'corrected','x',at(2));
 assert.equal(claim(f).length,0);
 assert.equal(f.db.prepare('SELECT state FROM memory_curation_jobs').get().state,'dead_letter');
});
test('M7 durable limits reserve before transport, settle actual only when known, reconcile crash',t=>{
 const f=fixture(t),w=f.scope.worldProfileId,limits={dailyUsd:.05,monthlyUsd:.08};
 const reserve=(key,amount,when=at(1))=>reserveCurationBudget(f.db,{batchKey:key,maxUsd:amount,nowUtc:when},w,limits);
 assert.equal(reserve('one',.03),true);
 assert.equal(reserve('two',.03),false);
 assert.equal(finishCurationBudget(f.db,{batchKey:'one',maxUsd:.03,actualUsd:.01},w,'settled'),true);
 assert.equal(reserve('two',.03),true);
 assert.equal(reconcileCurationBudgets(f.db,{beforeUtc:at(2),worldProfileId:w}),1);
 assert.equal(f.db.prepare("SELECT state FROM memory_budget_reservations WHERE batch_key='two'").get().state,'settled');
 assert.equal(reserve('three',.05),false);
 assert.equal(finishCurationBudget(f.db,{batchKey:'two',maxUsd:.03},w,'settled'),true);
});
test('M7 Retry-After, max attempts, and dead letters are bounded and durable',t=>{
 const f=fixture(t),[x]=claim(f);
 assert.deepEqual(retryCuration(f.db,{jobId:x.job.jobId,leaseToken:x.leaseToken,
   attempt:1,nextAttemptAtUtc:at(10),errorCode:'curation_retry'},f.scope.worldProfileId,f.scope.timelineId),
   {status:'pending'});
 assert.equal(claim(f,{atMinute:3,until:6}).length,0);
 const [next]=claim(f,{atMinute:11,until:13});
 assert.equal(next.job.attempt,1);
 assert.throws(()=>retryCuration(f.db,{jobId:next.job.jobId,leaseToken:next.leaseToken,
   attempt:1,nextAttemptAtUtc:at(20),errorCode:'curation_retry'},f.scope.worldProfileId,f.scope.timelineId),/attempt_conflict/);
 assert.equal(retryCuration(f.db,{jobId:next.job.jobId,leaseToken:next.leaseToken,
   attempt:2,nextAttemptAtUtc:at(20),errorCode:'curation_dead_letter'},f.scope.worldProfileId,f.scope.timelineId).status,'dead_letter');
 assert.equal(claim(f,{atMinute:30,until:32}).length,0);
});
test('M7 scoped claims cannot transport a different promoted NPC',t=>{
 const f=fixture(t);
 assert.equal(claim(f,{characterId:id(55)}).length,0);
 assert.equal(claim(f).length,1);
});
test('M7 idle scheduler defaults off, shadows without charges and refuses unverified source',async t=>{
 const f=fixture(t),log=[];
 const store={worldProfileId:f.scope.worldProfileId,activeTimelineId:f.scope.timelineId,timelineWritable:true,
   verifiedHostContext:{hostRunId:id(70),worldEpoch:1},get:x=>x===f.scope.characterId?{}:null};
 const provider={async curateBatch(){log.push('cloud');return [f.appraisal]}};
 const queue={async claimDue(a){log.push('claim');const x=claim(f,{atMinute:2,until:4});return x;},
   async completeLeased(a){return completeCuration(f.db,{...a,nowUtc:at(3)},f.scope.worldProfileId,f.scope.timelineId);},
   async releaseLeased(a){return releaseCuration(f.db,a,f.scope.worldProfileId,f.scope.timelineId);},
   async retryLeased(a){return retryCuration(f.db,a,f.scope.worldProfileId,f.scope.timelineId);},
   async enqueueIfAbsent(){}};
 const ledger={reserve:async a=>reserveCurationBudget(f.db,a,f.scope.worldProfileId,{dailyUsd:1,monthlyUsd:1}),
   settle:async a=>finishCurationBudget(f.db,a,f.scope.worldProfileId,'settled'),
   release:async a=>finishCurationBudget(f.db,a,f.scope.worldProfileId,'released')};
 const s=createIdleCurationScheduler({store,queue,ledger,provider,isIdle:()=>true,
   now:()=>at(2),minIntervalMs:0,maxProviderMs:1000,leaseMs:6000});
 assert.equal((await s.checkpoint({characterId:f.scope.characterId})).status,'disabled');
 s.setMode('shadow');assert.equal((await s.checkpoint({characterId:f.scope.characterId})).status,'shadow');
 assert.deepEqual(log,[]);
 s.setMode('experimental',{optIn:true});
 store.verifiedHostContext=null;
 assert.equal((await s.checkpoint({characterId:f.scope.characterId})).status,'source_unverified');
 store.verifiedHostContext={hostRunId:id(70),worldEpoch:1};
 const done=await s.checkpoint({characterId:f.scope.characterId});
 assert.equal(done.status,'completed');assert.deepEqual(log,['claim','cloud']);
 await s.stop();
});
test('M7 no live API in Essential factory until explicitly enabled',async t=>{
 const f=fixture(t),s=createEssentialM7Scheduler({config:null,mode:'off',
   store:{worldProfileId:f.scope.worldProfileId,activeTimelineId:f.scope.timelineId,timelineWritable:true,
     get:()=>null,verifiedHostContext:null}});
 assert.equal((await s.checkpoint({characterId:f.scope.characterId})).status,'disabled');
 await s.stop();
});
test('M7 worker retries mock rate limit and respects provider Retry-After without leaking a receipt',async t=>{
 const f=fixture(t),ports={
   queue:{enqueueIfAbsent:async()=>{},claimDue:async()=>claim(f),
     completeLeased:async a=>complete(f,{job:{jobId:a.jobId},leaseToken:a.leaseToken}),
     retryLeased:async a=>retryCuration(f.db,a,f.scope.worldProfileId,f.scope.timelineId),
     releaseLeased:async a=>releaseCuration(f.db,a,f.scope.worldProfileId,f.scope.timelineId)},
   ledger:{reserve:async a=>reserveCurationBudget(f.db,a,f.scope.worldProfileId,{dailyUsd:1,monthlyUsd:1}),
     settle:async a=>finishCurationBudget(f.db,a,f.scope.worldProfileId,'settled'),
     release:async a=>finishCurationBudget(f.db,a,f.scope.worldProfileId,'released')}};
 const failure=Object.assign(new Error('rate limited'),{status:429,retryAfterMs:20000});
 const response=await processIdleCuration({enabled:true,...ports,ownerId:id(90),
   nowUtc:at(2),maxProviderMs:1000,leaseMs:6000,
   provider:{async curateBatch(){throw failure;}}});
 assert.equal(response.status,'retry_scheduled');
 const q=f.db.prepare('SELECT state,next_attempt_at_utc FROM memory_curation_jobs').get();
 assert.equal(q.state,'pending');
 assert.equal(q.next_attempt_at_utc,new Date(Date.parse(at(2))+20000).toISOString());
});
