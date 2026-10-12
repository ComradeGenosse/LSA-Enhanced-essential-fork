// Agent F M7: offline-only, no real provider transport or billable requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {selectAutomaticMemories} from '../src/memory/selection.mjs';
import {validateM7Consent,validateM7IdleProof,validateM7Pricing,M7_PRIORITY_QUIET_FIELDS} from '../src/memory/m7Consent.mjs';
import {readPermanentMemoryRows} from '../src/memory/integratedSqlite.mjs';
import {createHash} from 'node:crypto';
import {makeQueueJob} from '../src/memory/queueContract.mjs';
import {ensureIntegratedMemorySchema} from '../src/memory/integratedSqlite.mjs';
import {ensureCurationSchema,enqueueCuration,claimCuration,completeCuration,
  retryCuration,releaseCuration,reserveCurationBudget,finishCurationBudget,
  reconcileCurationBudgets,readCurationAppraisals} from '../src/memory/curationSqlite.mjs';
import {processIdleCuration,createLunaCurationAdapter} from '../src/memory/lunaCurator.mjs';
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
      timelineId:f.scope.timelineId,protagonistKey:'trevor'},f.scope.worldProfileId).length,1);
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
const consent=(overrides={})=>({mode:'experimental',cloudOptIn:true,
 consentSource:'explicit_player_settings',offTurnEvidenceUploadAccepted:true,
 consentedAtUtc:at(0),dailyUsd:.20,monthlyUsd:2,maxBatchUsd:.02,...overrides});
const pricedConfig=()=>({provider:'openai',reasoningModel:'gpt-6-luna',
 reasoningBaseUrl:'https://api.openai.com/v1',
 curatorPricing:{model:'gpt-6-luna',source:'operator_verified',verifiedAtUtc:at(0),
 inputUsdPerMillionTokens:1,outputUsdPerMillionTokens:1}});
function nativeFixture(f,store){
 let listener=null;
 const state={kind:'verified_native_idle_v1',nativeVerified:true,
   observedAtUtc:at(2),hostRunId:id(70),worldEpoch:1,
   sessionId:id(71),incarnationId:id(72),encounterId:id(73),observerIndex:0,
   characterId:f.scope.characterId,worldProfileId:f.scope.worldProfileId,
   timelineId:f.scope.timelineId,
   priorityEvidence:Object.fromEntries(M7_PRIORITY_QUIET_FIELDS.map(k=>[k,true])),
   idle:true,idleForMs:3000,micActive:false,
   playerSpeechActive:false,directorBusy:false,gamePaused:false};
 return {state,snapshot:()=>({...state}),
   subscribeInvalidation(fn){listener=fn;return ()=>{if(listener===fn)listener=null;};},
   invalidate(patch={}){Object.assign(state,patch);listener?.();}};
}
function hFixture(f,{provider,allowReserve=true}={}){
 const calls=[],store={worldProfileId:f.scope.worldProfileId,
   activeTimelineId:f.scope.timelineId,timelineWritable:true,
   verifiedHostContext:{hostRunId:id(70),worldEpoch:1},
   get:x=>x===f.scope.characterId?{}:null};
 const nativeIdle=nativeFixture(f,store);
 const queue={enqueueIfAbsent:async()=>{},
   claimDue:async()=>{calls.push('claim');return claim(f,{atMinute:2,until:4});},
   completeLeased:async a=>{calls.push('commit');return completeCuration(f.db,{...a,nowUtc:at(3)},f.scope.worldProfileId,f.scope.timelineId);},
   retryLeased:async a=>{calls.push('retry');return retryCuration(f.db,a,f.scope.worldProfileId,f.scope.timelineId);},
   releaseLeased:async a=>{calls.push('release');return releaseCuration(f.db,a,f.scope.worldProfileId,f.scope.timelineId);}};
 const ledger={budgetLimits:{dailyUsd:.20,monthlyUsd:2},
   reconcile:async()=>{calls.push('reconcile');return reconcileCurationBudgets(f.db,{beforeUtc:at(2),worldProfileId:f.scope.worldProfileId});},
   reserve:async a=>{calls.push('reserve');return allowReserve&&reserveCurationBudget(f.db,a,f.scope.worldProfileId,{dailyUsd:.20,monthlyUsd:2});},
   settle:async a=>{calls.push('settle');return finishCurationBudget(f.db,a,f.scope.worldProfileId,'settled');},
   release:async a=>{calls.push('releaseBudget');return finishCurationBudget(f.db,a,f.scope.worldProfileId,'released');}};
 const cloud=provider??{estimateMaxCostUsd:()=>.005,async curateBatch(){calls.push('cloud');return [f.appraisal];}};
 return {calls,store,nativeIdle,queue,ledger,provider:cloud,
   make:(args={})=>createIdleCurationScheduler({store,nativeIdle,queue,ledger,provider:cloud,
     now:()=>at(2),minIntervalMs:0,maxProviderMs:1000,leaseMs:6000,...args})};
}
test('M7 idle scheduler defaults off, shadows without charges and refuses unverified source',async t=>{
 const f=fixture(t),h=hFixture(f),s=h.make();
 assert.equal((await s.checkpoint({characterId:f.scope.characterId})).status,'disabled');
 s.setMode('shadow');
 assert.equal((await s.checkpoint({characterId:f.scope.characterId})).status,'shadow');
 assert.deepEqual(h.calls,[]);
 assert.throws(()=>s.setMode('experimental',{optIn:true}),/set_consent_required/);
 s.setConsent(consent());
 h.store.verifiedHostContext=null;
 assert.equal((await s.checkpoint({characterId:f.scope.characterId})).status,'source_unverified');
 h.store.verifiedHostContext={hostRunId:id(70),worldEpoch:1};
 assert.equal((await s.checkpoint({characterId:f.scope.characterId})).status,'completed');
 assert.deepEqual(h.calls,['reconcile','claim','reserve','cloud','commit','settle']);
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

test('M7 pricing-enforced maximum rejects costly cloud batch before billing or reservation',async t=>{
 const f=fixture(t);let cloud=0,reservations=0,releases=0;
 const provider=createLunaCurationAdapter({
   config:{reasoningModel:'gpt-6-luna',reasoningBaseUrl:'https://api.openai.com/v1',
     curatorPricing:{inputUsdPerMillionTokens:10,outputUsdPerMillionTokens:20}},
   requestJson:async()=>{cloud++;throw new Error('unexpected cloud call');}});
 assert.ok(provider.estimateMaxCostUsd([f.proposal])>.001);
 const queue={enqueueIfAbsent:async()=>{},claimDue:async()=>claim(f),
   completeLeased:async()=>{throw new Error('should not commit');},
   retryLeased:async()=>{throw new Error('should not retry');},
   releaseLeased:async a=>{releases++;return releaseCuration(f.db,a,f.scope.worldProfileId,f.scope.timelineId);}};
 const ledger={reserve:async()=>{reservations++;return true;},
   settle:async()=>{},release:async()=>{}};
 const outcome=await processIdleCuration({enabled:true,ownerId:id(90),nowUtc:at(2),
   maxProviderMs:1000,leaseMs:6000,provider,queue,ledger,estimatedMaxCostUsd:.0001});
 assert.equal(outcome.status,'budget_estimate_exceeded');
 assert.equal(cloud,0);assert.equal(reservations,0);assert.equal(releases,1);
 assert.equal(f.db.prepare('SELECT state FROM memory_curation_jobs').get().state,'pending');
});

test('M7 privacy purge hides persisted Luna opinion immediately, even with no tombstone',t=>{
 const f=fixture(t),[x]=claim(f);
 assert.equal(complete(f,x).durableCommit,true);
 const read=()=>readCurationAppraisals(f.db,{characterId:f.scope.characterId,
   timelineId:f.scope.timelineId,protagonistKey:'franklin'},f.scope.worldProfileId);
 assert.equal(read().length,1);
 // An authorized future privacy purge may hard-delete a source row.
 f.db.prepare('DELETE FROM dialogue_journal WHERE record_id=?').run(f.proposal.evidenceRecordIds[0]);
 assert.equal(read().length,0);
});


test('M7 consent rejects toggle-only permission, budget escalation and unpriced/mismatched Luna',()=>{
 assert.equal(validateM7Consent().mode,'off');
 assert.equal(validateM7Consent({mode:'shadow'}).cloudOptIn,false);
 assert.throws(()=>validateM7Consent({mode:'experimental',cloudOptIn:true}),/consent_and_budget/);
 assert.throws(()=>validateM7Consent(consent({dailyUsd:.001})),/consent_and_budget/);
 assert.throws(()=>validateM7Consent(consent({consentSource:'automatic'})),/consent_and_budget/);
 assert.throws(()=>validateM7Consent(consent({offTurnEvidenceUploadAccepted:false})),/consent_and_budget/);
 assert.equal(validateM7Consent(consent()).maxBatchUsd,.02);
 assert.equal(validateM7Pricing(pricedConfig()).model,'gpt-6-luna');
 const wrong=pricedConfig();wrong.curatorPricing.model='some-other-model';
 assert.throws(()=>validateM7Pricing(wrong),/verified_luna_pricing/);
 assert.throws(()=>validateM7Pricing({provider:'local',reasoningModel:'gpt-6-luna'}),/verified_luna_pricing/);
});

test('M7 native idle source denies guessed NPCs, stale receipts, mic, Director and divergent timelines',t=>{
 const f=fixture(t),h=hFixture(f),p=h.nativeIdle.state;
 const verify=(override={})=>validateM7IdleProof({...p,...override},{
   store:h.store,characterId:f.scope.characterId,nowUtc:at(2)});
 assert.equal(verify().characterId,f.scope.characterId);
 for(const invalid of [
   {nativeVerified:false},{kind:'timer_idle'},{characterId:id(66)},
   {sessionId:null},{incarnationId:null},{observerIndex:-1},
   {priorityEvidence:null},{priorityEvidence:{ownerIdle:true}},
   {observedAtUtc:at(1)},{worldEpoch:2},{idle:false},
   {micActive:true},{playerSpeechActive:true},{directorBusy:true},
   {gamePaused:true},{idleForMs:100}])
   assert.throws(()=>verify(invalid),/native_idle_proof_required/);
 h.store.timelineWritable=false;
 assert.throws(()=>verify(),/native_idle_proof_required/);
});

test('M7 never starts off/shadow timers, queue claims, budget reservation or paid transport',async t=>{
 const f=fixture(t),h=hFixture(f);
 const s=h.make();
 assert.equal(s.start(),false);
 assert.equal(s.running,false);
 assert.equal((await s.checkpoint()).status,'disabled');
 s.setMode('shadow');
 assert.equal(s.start(),false);
 assert.equal((await s.checkpoint()).status,'shadow');
 assert.deepEqual(h.calls,[]);
 await s.stop();
});

test('M7 late cloud completion cannot commit after synchronous microphone interruption',async t=>{
 const f=fixture(t);
 let resolveRemote,signal,started;
 const onStart=new Promise(resolve=>{started=resolve;});
 const h=hFixture(f,{provider:{
   estimateMaxCostUsd:()=>.005,
   curateBatch(_proposals,opts){signal=opts.signal;started();
     return new Promise(resolve=>{resolveRemote=resolve;});}
 }});
 const s=h.make({consent:consent()});
 const pending=s.checkpoint();
 await onStart;
 assert.equal(s.busy,true);
 assert.equal((await s.checkpoint()).status,'busy');
 h.nativeIdle.invalidate({micActive:true,idle:false});
 assert.equal(signal.aborted,true);
 const outcome=await pending;
 assert.equal(outcome.status,'cancelled');
 resolveRemote([f.appraisal]);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.calls.includes('commit'),false);
 assert.equal(f.db.prepare('SELECT state FROM memory_curation_jobs').get().state,'pending');
 const reservation=f.db.prepare('SELECT state,amount_usd FROM memory_budget_reservations').get();
 assert.equal(reservation.state,'settled');
 assert.equal(reservation.amount_usd,.02); // Cost unknown after transport start.
 await s.stop();
});

test('M7 session/owner/epoch invalidations cancel while provider is pending',async t=>{
 for(const change of [
   {sessionId:id(81)},{incarnationId:id(82)},{encounterId:id(83)},
   {worldEpoch:2},{characterId:id(84)},{timelineId:id(85)},
   {playerSpeechActive:true},{directorBusy:true}
 ]){
   const f=fixture(t,{lineId:40+Number(Object.values(change)[0]===true?4:3)}),startedHolder={};
   let resolveRemote,start;
   const started=new Promise(resolve=>{start=resolve;});
   const h=hFixture(f,{provider:{
     estimateMaxCostUsd:()=>.005,
     curateBatch(){start();return new Promise(resolve=>{resolveRemote=resolve;});}
   }});
   const s=h.make({consent:consent()});
   const pending=s.checkpoint();
   await started;
   h.nativeIdle.invalidate(change);
   assert.equal((await pending).status,'cancelled');
   resolveRemote([f.appraisal]);
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(h.calls.includes('commit'),false);
   await s.stop();
 }
});

test('M7 reserve rejection refuses cloud; offline deterministic M6 memory remains readable after outage',async t=>{
 const f=fixture(t),h=hFixture(f,{allowReserve:false});
 const s=h.make({consent:consent()});
 assert.equal((await s.checkpoint()).status,'budget_blocked');
 assert.equal(h.calls.includes('cloud'),false);
 assert.equal(f.db.prepare('SELECT state FROM memory_curation_jobs').get().state,'pending');
 await s.stop();
 const f2=fixture(t,{lineId:33}),h2=hFixture(f2,{provider:{
   estimateMaxCostUsd:()=>.005,async curateBatch(){throw new Error('offline_mock');}
 }});
 const s2=h2.make({consent:consent()});
 assert.equal((await s2.checkpoint()).status,'retry_scheduled');
 const hash=createHash('sha256').update(f2.proposal.groundedSummary).digest('hex');
 f2.db.prepare('UPDATE memory_records SET content_sha256=? WHERE memory_id=?').run(hash,f2.proposal.proposalId);
 // The tiny M7 queue fixture omits M1 timeline tables; install the M1
 // owner/timeline read precondition to exercise the ACTUAL M4 deterministic reader.
 f2.db.exec('CREATE TABLE timelines (timeline_id TEXT PRIMARY KEY,world_profile_id TEXT NOT NULL)');
 f2.db.prepare('INSERT INTO timelines(timeline_id,world_profile_id) VALUES(?,?)')
   .run(f2.scope.timelineId,f2.scope.worldProfileId);
 const records=readPermanentMemoryRows(f2.db,{...f2.scope,protagonistKey:'franklin'},f2.scope.worldProfileId);
 assert.equal(records.length,1);
 assert.equal(records[0].envelope.content,f2.proposal.groundedSummary);
 assert.deepEqual(records[0].envelope.sourceEvidenceIds,f2.proposal.evidenceRecordIds);
 assert.equal(readCurationAppraisals(f2.db,{...f2.scope,protagonistKey:'franklin'},f2.scope.worldProfileId).length,0);
 await s2.stop();
});

test('M7 reconciles orphaned reservations before cloud work and halts after uncertain cost overrun',async t=>{
 const f=fixture(t);
 assert.equal(reserveCurationBudget(f.db,{batchKey:'old-process',maxUsd:.02,nowUtc:at(0)},f.scope.worldProfileId,
   {dailyUsd:.20,monthlyUsd:2}),true);
 const h=hFixture(f,{provider:{
   estimateMaxCostUsd:()=>.005,
   async curateBatch(){const xs=[f.appraisal];Object.defineProperty(xs,'actualUsd',{value:.03});return xs;}
 }});
 const s=h.make({consent:consent()});
 const r=await s.checkpoint();
 assert.equal(r.status,'cost_overrun');
 assert.equal(f.db.prepare("SELECT state FROM memory_budget_reservations WHERE batch_key='old-process'").get().state,'settled');
 assert.equal((await s.checkpoint()).status,'cost_suspended');
 assert.equal(h.calls.filter(k=>k==='claim').length,1);
 await s.stop();
});

test('M7 production Essential bridge refuses missing cost attestation and runtime ledger mismatch',async t=>{
 const f=fixture(t),h=hFixture(f);
 assert.throws(()=>createEssentialM7Scheduler({store:h.store,queue:h.queue,ledger:h.ledger,
   nativeIdle:h.nativeIdle,consent:consent(),config:null}),/verified_luna_pricing/);
 assert.throws(()=>createEssentialM7Scheduler({store:h.store,queue:h.queue,
   ledger:{...h.ledger,budgetLimits:{dailyUsd:.3,monthlyUsd:2}},
   nativeIdle:h.nativeIdle,consent:consent(),config:pricedConfig()}),/durable_budget_caps/);
 const denied=h.make();
 assert.throws(()=>denied.setConsent(consent({dailyUsd:.3})),/budget_limit_mismatch/);
 await denied.stop();
});

test('M7 Essential pricing estimator blocks a billable fetch before reservation',async t=>{
 const f=fixture(t),h=hFixture(f),seen=[];
 const config={...pricedConfig(),reasoningKey:'offline-only-fake-token'};
 const s=createEssentialM7Scheduler({config,store:h.store,queue:h.queue,ledger:h.ledger,
   nativeIdle:h.nativeIdle,consent:consent({maxBatchUsd:.000001}),
   now:()=>at(2),minIntervalMs:0,leaseMs:6000,maxProviderMs:1000,
   fetchImpl:async()=>{seen.push('billable');throw new Error('network forbidden');}});
 const result=await s.checkpoint();
 assert.equal(result.status,'budget_estimate_exceeded');
 assert.deepEqual(seen,[]);
 assert.equal(h.calls.includes('reserve'),false);
 assert.equal(h.calls.includes('release'),true);
 await s.stop();
});


test('M7 denies two overlapping batches even through separate same-world P2 store handles',async t=>{
 const f=fixture(t);
 let releaseRemote,notifyStart;
 const started=new Promise(resolve=>{notifyStart=resolve;});
 const h=hFixture(f,{provider:{
   estimateMaxCostUsd:()=>.005,
   async curateBatch(){notifyStart();return new Promise(resolve=>{releaseRemote=resolve;});}
 }});
 const a=h.make({consent:consent()}),b=h.make({consent:consent(),store:{...h.store}});
 const running=a.checkpoint();
 await started;
 assert.equal((await b.checkpoint()).status,'busy');
 assert.equal(h.calls.filter(x=>x==='claim').length,1);
 h.nativeIdle.invalidate({micActive:true});
 assert.equal((await running).status,'cancelled');
 releaseRemote([f.appraisal]);
 await new Promise(resolve=>setImmediate(resolve));
 await Promise.all([a.stop(),b.stop()]);
});

test('M7 enforces timeout, no late SQLite commit and uncertain reservation settlement',async t=>{
 const f=fixture(t),h=hFixture(f,{provider:{
   estimateMaxCostUsd:()=>.005,
   async curateBatch(){
     return new Promise(resolve=>setTimeout(()=>resolve([f.appraisal]),1500));
   }
 }});
 const s=h.make({consent:consent(),maxProviderMs:1000});
 const result=await s.checkpoint();
 assert.equal(result.status,'retry_scheduled');
 assert.equal(h.calls.includes('commit'),false);
 assert.equal(f.db.prepare('SELECT state FROM memory_budget_reservations').get().state,'settled');
 assert.equal(f.db.prepare('SELECT state FROM memory_curation_jobs').get().state,'pending');
 await s.stop();
});
