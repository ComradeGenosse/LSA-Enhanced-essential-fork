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
test('M6 selection separates incompatible protagonists and maintains fun-first scoring',()=>{
 const a=line(1,'That was hilarious!');
 const b=line(2,'That was hilarious!',{attribution:{...a.attribution,protagonist:'trevor'}});
 const result=evaluateAutomaticMemoryBatch([a,b]);
 assert.equal(result.proposals.length,2);
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
