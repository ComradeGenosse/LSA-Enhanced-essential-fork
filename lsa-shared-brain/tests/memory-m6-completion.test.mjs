let DatabaseSync=null;
try { ({DatabaseSync}=await import('node:sqlite')); } catch {}
const hasRealSqlite=typeof DatabaseSync==='function';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId as fixtureWorldId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {selectAutomaticMemories,evaluateAutomaticMemoryBatch} from '../src/memory/selection.mjs';
import {createM6SelectionCoordinator} from '../src/memory/m6Coordinator.mjs';
import {stableUuid} from '../src/memory/evidence.mjs';
import {consolidateCandidates} from '../src/memory/consolidation.mjs';

const uuid=()=>randomUUID();
const scope={characterId:uuid(),worldProfileId:uuid(),timelineId:uuid()};
const base=Date.parse('2026-10-11T16:00:00.000Z');
const time=seconds=>new Date(base+seconds*1000).toISOString();
const proof={ownerAlias:'promoted.'+scope.characterId,incarnationId:uuid(),encounterId:uuid(),
  hostRunId:uuid(),worldEpoch:5,observerCaptureRef:uuid()};
function line(seconds,content,options={}){
 return {version:1,kind:'dialogue_line',...scope,recordId:uuid(),speaker:'player',source:'typed',
  delivery:'accepted',content,committedAtUtc:time(seconds),
  attribution:{protagonist:'franklin',hostRunId:proof.hostRunId,worldEpoch:5,
   sessionId:uuid()},...options};
}
function event(seconds,type='rollover',options={}){
 const recordId=uuid();
 return {version:1,kind:'journal_event',...scope,recordId,observationId:uuid(),
  receiptStatus:'witnessed',sourceHash:'a'.repeat(64),ownerProof:proof,
  eventType:type,receivedAtUtc:time(seconds),
  claims:[{kind:type,modality:'visual',certainty:'direct',
   durableSubject:'vehicle',sourceEvidenceId:uuid()}],...options};
}
function fakeStore({lines=[],events=[],sidecars=true,queueEnabled=true}={}){
 const permanent=[],jobs=new Map(),suppressed=[],corrections=[];
 let failQueue=0;
 const store={
  worldProfileId:scope.worldProfileId,activeTimelineId:scope.timelineId,timelineWritable:true,
  get:()=>({promoted:true}),
  readDialogueLines:async()=>lines,
  readJournalEvents:async()=>events,
  readVerifiedEventEvidence:async({recordId})=>{
    const found=events.find(e=>e.recordId===recordId);
    return sidecars?{event:found,sourceEvidence:{sourceHash:found.sourceHash}}:null;
  },
  readPermanentMemoryRows:async({protagonistKey})=>permanent.filter(r=>r.protagonistKey===protagonistKey),
  listSuppressedMemoryIds:async()=>suppressed,
  readCorrectionOverlays:async()=>corrections,
  saveDeterministicMemory:async proposal=>{
   const old=permanent.find(p=>p.recordId===proposal.proposalId);
   if(old)return {inserted:false,recordId:proposal.proposalId};
   const protagonistKey=proposal.evidenceRecordIds.some(id=>events.some(e=>e.recordId===id))
    ?'unknown':'franklin';
   permanent.push({recordId:proposal.proposalId,characterId:scope.characterId,
    worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,protagonistKey,
    atUtc:time(100),envelope:{sourceEvidenceIds:proposal.evidenceRecordIds,
    content:proposal.groundedSummary}});
   return {inserted:true,recordId:proposal.proposalId};
  },
  enqueueCurationJob:async({job})=>{
   if(!queueEnabled)throw Error('provider_offline');
   if(failQueue-->0)throw Error('queue_write_failed');
   if(jobs.has(job.jobId))return {inserted:false,jobId:job.jobId};
   jobs.set(job.jobId,job);return {inserted:true,jobId:job.jobId};
  },
  _permanent:permanent,_jobs:jobs,_suppressed:suppressed,_corrections:corrections,
  failNextQueue(){failQueue=1;}
 };
 return store;
}
test('M6 selection unifies same-player source avatars while retaining fun-first scoring',()=>{
 const a=line(1,'That was hilarious!');
 const b=line(2,'That was hilarious!',{attribution:{...a.attribution,protagonist:'trevor'}});
 const result=evaluateAutomaticMemoryBatch([a,b]);
 assert.equal(result.proposals.length,1);
 assert.deepEqual(result.proposals[0].evidenceRecordIds,[a.recordId,b.recordId].sort());
 assert.equal(result.qualifiedCount,2);
 assert.deepEqual(selectAutomaticMemories([line(3,'Hi there')]),[]);
 assert.equal(selectAutomaticMemories([event(3,'bizarre_crash')],{existingInHour:999}).length,1);
});
test('M6 retains immutable witnessed events and rejects unverifiable claims with diagnostics',()=>{
 const good=event(1,'crash'),bad=event(2,'crash',{receiptStatus:'reported'});
 const data=evaluateAutomaticMemoryBatch([good,bad]);
 assert.equal(data.proposals.length,1);
 assert.deepEqual(data.proposals[0].evidenceRecordIds,[good.recordId]);
 assert.deepEqual(data.rejected.map(x=>x.recordId),[bad.recordId]);
 assert.match(data.proposals[0].groundedSummary,/Observed crash/);
 const hearsay=event(6,'inside_joke');
 hearsay.claims[0].modality='report';hearsay.claims[0].certainty='reported';
 assert.match(selectAutomaticMemories([hearsay])[0].groundedSummary,/Reported inside joke/);
});
test('scene grouping records jokes, relationships and strange crashes without fuzzy collapsing other episodes',()=>{
 const a=event(1,'crash'),b=event(2,'rollover'),c=event(200,'rollover');
 const proposals=selectAutomaticMemories([c,b,a]);
 assert.equal(proposals.length,2);
 assert.deepEqual(proposals[0].evidenceRecordIds,[a.recordId,b.recordId].sort());
 const duplicate=consolidateCandidates([proposals[0]],{...proposals[0]});
 assert.equal(duplicate.action,'link_duplicate');
 assert.equal(consolidateCandidates([proposals[0]],proposals[1]).action,'insert');
 assert.equal(selectAutomaticMemories([line(1,'I promise I will help you')]).length,1);
});
test('M6 coordinator selects committed funny dialogue and journals ordinary speech without promoting it',async()=>{
 const ordinary=line(1,'Hello, nice weather.'),joke=line(10,'That was hilarious!');
 const store=fakeStore({lines:[ordinary,joke]});
 const coordinator=createM6SelectionCoordinator({store,allowLegacyBoundedReplay:true});
 const result=await coordinator.onSceneClose({scope,atUtc:time(20)});
 assert.equal(result.status,'legacy_bounded');
 assert.equal(result.candidateCount,1);
 assert.equal(store._permanent.length,1);
 assert.equal(store._permanent[0].envelope.sourceEvidenceIds.includes(joke.recordId),true);
 const replay=await coordinator.onSceneClose({scope,atUtc:time(21)});
 assert.equal(replay.saved.length,0);
 assert.equal(store._permanent.length,1);
});
test('M6 queue retry reconstructs saved proposals after crash between save and enqueue',async()=>{
 const input=line(1,'That was hilarious!');
 const store=fakeStore({lines:[input]});
 store.failNextQueue();
 const coordinator=createM6SelectionCoordinator({store,cloudQueueEnabled:true,allowLegacyBoundedReplay:true});
 await assert.rejects(coordinator.onSceneClose({scope,atUtc:time(10)}),/queue_write_failed/);
 assert.equal(store._permanent.length,1);
 assert.equal(store._jobs.size,0);
 const recovered=await coordinator.recover({scope,atUtc:time(300)});
 assert.equal(recovered.queued,1);
 assert.equal(store._jobs.size,1);
 assert.equal(store._permanent.length,1);
 const second=await coordinator.recover({scope,atUtc:time(400)});
 assert.equal(second.queued,0);
 assert.equal(store._jobs.size,1);
});
test('M6 suppresses forgotten and superseded evidence before scene selection',async()=>{
 const a=line(1,'That was hilarious!'),b=line(2,'I promise this is funny');
 const store=fakeStore({lines:[a,b]});
 store._suppressed.push(a.recordId);
 store._corrections.push({targetId:b.recordId});
 const outcome=await createM6SelectionCoordinator({store,allowLegacyBoundedReplay:true}).onSceneClose({scope,atUtc:time(10)});
 assert.equal(outcome.qualifiedCount,0);
 assert.equal(store._permanent.length,0);
});
test('M6 refuses sidecar-less witness claims, cross-timeline and coverage exhaustion',async()=>{
 const e=event(1),store=fakeStore({events:[e],sidecars:false});
 const runner=createM6SelectionCoordinator({store,allowLegacyBoundedReplay:true});
 const result=await runner.onSceneClose({scope,atUtc:time(10)});
 assert.equal(result.status,'partial_evidence');
 assert.equal(result.candidateCount,0);
 assert.equal(result.rejected[0].recordId,e.recordId);
 store.timelineWritable=false;
 await assert.rejects(runner.onIdle({scope,atUtc:time(300)}),/m6_timeline_not_writable/);
 const overflow=fakeStore({lines:[line(1,'That was hilarious!'),line(2,'Another joke!')]});
 await assert.rejects(createM6SelectionCoordinator({store:overflow,maxRead:2,allowLegacyBoundedReplay:true})
   .recover({scope,atUtc:time(300)}),/m6_journal_replay_window_exhausted/);
});
test('M6 never requires provider or GPU and does not queue automatically by default',async()=>{
 const store=fakeStore({lines:[line(1,'That was hilarious!')],queueEnabled:false});
 const outcome=await createM6SelectionCoordinator({store,allowLegacyBoundedReplay:true}).onSceneClose({scope,atUtc:time(10)});
 assert.equal(outcome.candidateCount,1);
 assert.equal(store._permanent.length,1);
 assert.equal(store._jobs.size,0);
});
test('M6 idempotent deterministic proposal IDs use canonical immutable evidence set',()=>{
 const events=[event(1),event(2)];
 const [a]=selectAutomaticMemories(events),[b]=selectAutomaticMemories([...events].reverse());
 assert.equal(a.proposalId,b.proposalId);
 assert.equal(a.proposalId,stableUuid('auto-memory-v1',scope.characterId,
   scope.worldProfileId,scope.timelineId,a.evidenceRecordIds));
});

// Run durable P2-cursor lifecycle adversarial cases in the pinned M6 CI suite.
import './memory-m6-cursor-lifecycle.test.mjs';


test('M6 real P2 SQLite migrates old avatar cursors without losing interleaved evidence',{skip:!hasRealSqlite},async t=>{
 const folder=mkdtempSync(path.join(tmpdir(),'m6-agent-c-'));
 const filePath=path.join(folder,'p2.sqlite'),consumerId='agent-c-m6';
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const create=()=>createP2MemoryStorage({filePath,worldProfileId:fixtureWorldId,sourceRequired:true});
 const original=create();
 await original.initialize();
 const promoted=await original.create(profile());
 const timelineId=await original.createTimeline({label:'unified replay'});
 const scope={characterId:promoted.characterId,worldProfileId:fixtureWorldId,
   timelineId,protagonistKey:'franklin'};
 original.setVerifiedHostContext({hostContextVersion:1,hostRunId:uuid(),worldEpoch:3});
 await original.confirmTimeline(timelineId);
 const journal=createConversationJournalRecorder(original),ids=[];
 for(const [index,protagonist] of ['franklin','michael','trevor'].entries()){
   const recorded=await journal.recordPlayerAccepted({characterId:scope.characterId,
     identity:{pedId:101,turnId:'agent-c-turn-'+index,generationId:'gen-1',sessionNonce:'m6'},
     source:'typed',text:'That was hilarious on '+protagonist,
     attribution:{protagonist}});
   ids.push(recorded.recordId);
 }
 const baseline=await original.readCommittedEvidenceCursor({scope,consumerId});
 assert.equal(baseline.lastSequence,0);
 const initial=await original.readCommittedEvidencePage({scope,cursor:baseline.cursor,limit:10});
 assert.deepEqual(initial.items.map(r=>r.recordId),ids);
 await original.close();
 // v1 avatar-local cursors may have different watermarks. MAX would silently
 // skip historical Michael/Trevor evidence, so v2 must replay from zero.
 const raw=new DatabaseSync(filePath);
 try{
   const add=raw.prepare('INSERT INTO p2_memory_replay_cursors(consumer_id,world_profile_id,character_id,timeline_id,protagonist_key,after_sequence,updated_at_utc) VALUES(?,?,?,?,?,?,?)');
   for(const [i,who] of ['franklin','michael','trevor'].entries())
     add.run(consumerId,scope.worldProfileId,scope.characterId,scope.timelineId,
       who,initial.items[2-i].sequence,new Date().toISOString());
 }finally{raw.close();}
 const resumed=create();
 await resumed.initialize();
 try{
   resumed.setVerifiedHostContext({hostContextVersion:1,hostRunId:uuid(),worldEpoch:4});
   await resumed.confirmTimeline(timelineId);
   const start=await resumed.readCommittedEvidenceCursor({...{scope,consumerId}});
   assert.equal(start.lastSequence,0);
   const replay=await resumed.readCommittedEvidencePage({
     scope:{...scope,protagonistKey:'michael'},cursor:start.cursor,limit:10});
   assert.deepEqual(replay.items.map(r=>r.recordId),ids);
   assert.deepEqual(replay.items.map(r=>r.envelope.attribution.protagonist),
     ['franklin','michael','trevor']);
   const commit=await resumed.ackCommittedEvidenceCursor({
     scope:{...scope,protagonistKey:'trevor'},consumerId,cursor:replay.cursor,
     expectedCursor:start.cursor});
   assert.equal(commit.committed,true);
   const repeated=await resumed.ackCommittedEvidenceCursor({
     scope:{...scope,protagonistKey:'franklin'},consumerId,cursor:replay.cursor,
     expectedCursor:start.cursor});
   assert.equal(repeated.idempotent,true);
 }finally{await resumed.close();}
 const restarted=create();
 await restarted.initialize();
 try{
   restarted.setVerifiedHostContext({hostContextVersion:1,hostRunId:uuid(),worldEpoch:5});
   await restarted.confirmTimeline(timelineId);
   for(const who of ['franklin','michael','trevor']){
     const current=await restarted.readCommittedEvidenceCursor({
       scope:{...scope,protagonistKey:who},consumerId});
     assert.equal(current.lastSequence,initial.lastSequence);
     const page=await restarted.readCommittedEvidencePage({
       scope:{...scope,protagonistKey:who},cursor:current.cursor});
     assert.equal(page.items.length,0);
   }
 }finally{await restarted.close();}
});

test('M6 replay refuses forged historical protagonist attribution in its SQLite feed',{skip:!hasRealSqlite},async t=>{
 const folder=mkdtempSync(path.join(tmpdir(),'m6-provenance-'));
 const filePath=path.join(folder,'p2.sqlite');
 t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const create=()=>createP2MemoryStorage({filePath,worldProfileId:fixtureWorldId,sourceRequired:true});
 const store=create();await store.initialize();
 const npc=await store.create(profile()),timelineId=await store.createTimeline({label:'provenance'});
 const scope={characterId:npc.characterId,worldProfileId:fixtureWorldId,timelineId,protagonistKey:'michael'};
 store.setVerifiedHostContext({hostContextVersion:1,hostRunId:uuid(),worldEpoch:1});
 await store.confirmTimeline(timelineId);
 const row=await createConversationJournalRecorder(store).recordPlayerAccepted({
   characterId:npc.characterId,
   identity:{pedId:101,turnId:'turn-provenance',generationId:'gen-1',sessionNonce:'m6'},
   source:'typed',text:'We are friends.',attribution:{protagonist:'michael'}});
 await store.close();
 const raw=new DatabaseSync(filePath);
 try{raw.prepare("UPDATE p2_memory_replay_feed SET protagonist_key='trevor' WHERE record_id=?")
   .run(row.recordId);}finally{raw.close();}
 const verify=create();await verify.initialize();
 try{
   verify.setVerifiedHostContext({hostContextVersion:1,hostRunId:uuid(),worldEpoch:2});
   await verify.confirmTimeline(timelineId);
   await assert.rejects(verify.readCommittedEvidencePage({scope,limit:10}),
     /p2_replay_feed_protagonist_mismatch/);
 }finally{await verify.close();}
});


test('M6 three-avatar scenes consolidate only with shared verified lifetime and owner',()=>{
 const a=line(1,'I trust you, friend!');
 const b=line(2,'That was hilarious!',{attribution:{...a.attribution,protagonist:'michael'}});
 const c=line(3,'Inside joke, remember?',{attribution:{...a.attribution,protagonist:'trevor'}});
 const proposals=selectAutomaticMemories([c,a,b]);
 assert.equal(proposals.length,1);
 assert.deepEqual(proposals[0].evidenceRecordIds,[a.recordId,b.recordId,c.recordId].sort());
 const earlier={...proposals[0],protagonistKey:'franklin',revision:1};
 const updated={...proposals[0],protagonistKey:'trevor'};
 const link=consolidateCandidates([earlier],updated);
 assert.equal(link.action,'link_duplicate');
 assert.deepEqual(link.evidenceRecordIds,earlier.evidenceRecordIds);
 const unproved=line(4,'Inside joke, remember?',{attribution:{protagonist:'trevor'}});
 assert.equal(selectAutomaticMemories([a,unproved]).length,2,
   'missing source lifetime cannot borrow the verified Franklin scene');
 assert.equal(consolidateCandidates([earlier],
   {...updated,worldProfileId:uuid()}).action,'insert');
 assert.equal(consolidateCandidates([earlier],
   {...updated,characterId:uuid()}).action,'insert');
});
