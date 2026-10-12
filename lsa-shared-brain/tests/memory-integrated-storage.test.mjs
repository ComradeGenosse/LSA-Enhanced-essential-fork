import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {handleExplicitMemoryCommand} from '../src/memory/explicitCommands.mjs';
import {recallFromSharedJournal,createP2IntegratedRecallAdapter,createDurableCurationAdapters,createM3WitnessRecorder,createM3JournalPorts} from '../src/memory/integrationPorts.mjs';
import {recallMemory} from '../src/memory/recallEngine.mjs';
import {selectAutomaticMemories} from '../src/memory/selection.mjs';
import {makeQueueJob} from '../src/memory/queueContract.mjs';
import {processIdleCuration} from '../src/memory/lunaCurator.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

const id=()=>randomUUID();
const identity=(n)=>({pedId:101,turnId:n,generationId:'g1',sessionNonce:'test-session'});
const request=(scope,question)=>({version:1,kind:'recall_query',characterId:scope.characterId,
 worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,queryId:id(),
 turnIdentityHash:'b'.repeat(64),intent:'exact_quote',question,maxBytes:4096});
async function setup(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'memory-integration-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const filePath=path.join(dir,'p2.sqlite');
 const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
 await store.initialize();
 const p=await store.create(profile());
 const timelineId=await store.createTimeline({label:'current'});
 const host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
 store.setVerifiedHostContext(host);
 await store.confirmTimeline(timelineId);
 const scope={characterId:p.characterId,worldProfileId,timelineId,protagonistKey:'franklin'};
 return {filePath,store,scope,recorder:createConversationJournalRecorder(store),host};
}
test('M2 -> real M5 command writes -> readback -> reopen without false acknowledgement',async t=>{
 const x=await setup(t);
 try {
  const record=await x.recorder.recordPlayerAccepted({
   characterId:x.scope.characterId,identity:identity('one'),source:'typed',
   text:'Remember that I hate olives',attribution:{protagonist:'franklin'}});
  const line=(await x.store.readDialogueLines({characterId:x.scope.characterId,timelineId:x.scope.timelineId}))[0];
  const commandId=id();
  const a=await handleExplicitMemoryCommand({line,scope:x.scope,commandId,store:x.store});
  assert.equal(a.outcome,'saved');assert.equal(a.durableCommit,true);
  assert.deepEqual(a.evidenceRecordIds,[record.recordId]);
  assert.deepEqual((await x.store.verifyCommand({scope:x.scope,commandId})).memoryId,a.memoryId);
  const rerun=await handleExplicitMemoryCommand({line,scope:x.scope,commandId,store:x.store});
  assert.deepEqual(rerun,a);
  await x.store.close();
  const second=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
  await second.initialize();
  try{
   assert.equal((await second.verifyCommand({scope:x.scope,commandId})).status,'committed');
   assert.ok((await second.inspect({scope:x.scope})).some(item=>item.content==='I hate olives'));
  }finally{await second.close()}
 }finally{await x.store.close()}
});
test('M4 reads exact dialogue across all player avatars without fabricating evidence',async t=>{
 const x=await setup(t);
 try{
  const text='  🚗 TWO spaces  with olives!  ';
  await x.recorder.recordPlayerAccepted({characterId:x.scope.characterId,identity:identity('phrase'),
    source:'typed',text,attribution:{protagonist:'franklin'}});
  await x.recorder.recordPlayerAccepted({characterId:x.scope.characterId,identity:identity('secret'),
    source:'typed',text:'trevor-only pineapple',attribution:{protagonist:'trevor'}});
  const found=await recallFromSharedJournal({store:x.store,query:request(x.scope,'what did I say about olives?'),
    protagonistKey:'franklin',nowUtc:new Date().toISOString()});
  assert.equal(found.bundle.status,'matched');
  assert.equal(found.bundle.items[0].content,text);
  const missing=await recallFromSharedJournal({store:x.store,query:request(x.scope,'what did I say about pineapple?'),
    protagonistKey:'franklin',nowUtc:new Date().toISOString()});
  assert.equal(missing.bundle.status,'matched');
  assert.ok(missing.bundle.items.some(item=>item.content==='trevor-only pineapple'));
 }finally{await x.store.close()}
});
test('M1 source revocation makes real M5 commit fail without acknowledging success',async t=>{
 const x=await setup(t);
 try{
  await x.recorder.recordPlayerAccepted({characterId:x.scope.characterId,identity:identity('revocation'),
   source:'typed',text:'Remember that I dislike bugs',attribution:{protagonist:'franklin'}});
  const line=(await x.store.readDialogueLines({characterId:x.scope.characterId,timelineId:x.scope.timelineId}))[0];
  x.store.setVerifiedHostContext(null);
  const response=await handleExplicitMemoryCommand({line,scope:x.scope,commandId:id(),store:x.store});
  assert.equal(response.outcome,'failed');assert.equal(response.durableCommit,false);
 }finally{await x.store.close()}
});

test('M5 durable forget suppresses M4 recall but preserves immutable journal bytes',async t=>{
 const x=await setup(t);
 try{
  const words='  gingerbread olives on a purple scooter  ';
  await x.recorder.recordPlayerAccepted({characterId:x.scope.characterId,identity:identity('original'),
    text:words,source:'typed',attribution:{protagonist:'franklin'}});
  await x.recorder.recordPlayerAccepted({characterId:x.scope.characterId,identity:identity('forget'),
    text:'Forget that scooter phrase',source:'typed',attribution:{protagonist:'franklin'}});
  const lines=await x.store.readDialogueLines({characterId:x.scope.characterId,timelineId:x.scope.timelineId});
  const [requestLine,sourceLine]=lines;
  const operation={scope:x.scope,commandId:id(),requestedByLineId:requestLine.recordId,operation:'forget',
   origin:'explicit_player',recordType:'dialogue_line',content:sourceLine.content,
   contentHash:createHash('sha256').update(sourceLine.content).digest('hex'),pin:false,
   evidenceRecordIds:[sourceLine.recordId,requestLine.recordId],targetRecordId:sourceLine.recordId,
   correctionMode:null,subjectCertainty:null,requestedAtUtc:requestLine.committedAtUtc};
  assert.equal((await x.store.commitCommand(operation)).status,'committed');
  assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(sourceLine.recordId));
  const lookup=await recallFromSharedJournal({store:x.store,
    query:request(x.scope,'what did I say about gingerbread olives?'),protagonistKey:'franklin',
    nowUtc:new Date().toISOString()});
  assert.equal(lookup.bundle.status,'unavailable');
  assert.equal((await x.store.findExactQuote({characterId:x.scope.characterId,timelineId:x.scope.timelineId,
    quote:words}))[0].content,words);
 }finally{await x.store.close()}
});

test('M6 automatic memory and M7 Luna queue use durable leases, source links and budget ledger',async t=>{
 const x=await setup(t);
 try{
  await x.recorder.recordPlayerAccepted({characterId:x.scope.characterId,identity:identity('curate'),
    text:'That was hilarious and embarrassing!',source:'typed',attribution:{protagonist:'franklin'}});
  const row=(await x.store.readDialogueLines({characterId:x.scope.characterId,timelineId:x.scope.timelineId}))[0];
  const proposals=selectAutomaticMemories([row]);
  assert.equal(proposals.length,1);
  const proposal=proposals[0],saved=await x.store.saveDeterministicMemory(proposal);
  assert.equal(saved.inserted,true);
  const ports=createDurableCurationAdapters(x.store,{dailyUsd:.05,monthlyUsd:.2});
  const job=makeQueueJob(proposal,new Date(Date.now()-1000).toISOString());
  assert.equal((await ports.queue.enqueueIfAbsent({job})).inserted,true);
  const provider={curateBatch:async originals=>originals.map(p=>({...p,provider:'luna',inCharacterTake:'That was a ridiculous day.'}))};
  const a=await processIdleCuration({enabled:true,queue:ports.queue,ledger:ports.ledger,
    provider,ownerId:id(),nowUtc:new Date().toISOString(),estimatedMaxCostUsd:.02});
  assert.deepEqual(a,{status:'completed',processed:1});
  assert.equal((await processIdleCuration({enabled:true,queue:ports.queue,ledger:ports.ledger,
    provider,ownerId:id(),nowUtc:new Date().toISOString(),estimatedMaxCostUsd:.02})).status,'empty');
  const read=await x.store.readPermanentMemoryRows(x.scope);
  assert.equal(read.length,1);
  assert.deepEqual(read[0].envelope.sourceEvidenceIds,[row.recordId]);
 }finally{await x.store.close()}
});

test('M3 real SQLite stores exact authenticated sidecar, dedupes and rejects revision rollback',async t=>{
 const x=await setup(t);
 try{
  const adapterEpoch=id(),captureRef=id(),incarnationId=id(),encounterId=id(),
   episodeId=id(),observationId=id(),claimId=id();
  const ownerProof={ownerAlias:x.store.get(x.scope.characterId).promotion.ownerAlias,
   incarnationId,encounterId,hostRunId:x.host.hostRunId,worldEpoch:x.host.worldEpoch,
   observerCaptureRef:captureRef};
  const identity={promoted:true,current:true,characterId:x.scope.characterId,
    worldProfileId:x.scope.worldProfileId,timelineId:x.scope.timelineId,
    adapterEpoch,ownerProof};
  const observation={version:1,observationId,episodeId,revision:1,
    observer:{captureRef,kind:'ped'},
    observedAt:{nativeRun:adapterEpoch,gameTick:100,receivedUtc:new Date().toISOString()},
    eventType:'firing_burst',claims:[{claimId,kind:'firing',certainty:'supported',
      evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:100}}]};
  const recorder=createM3WitnessRecorder({store:x.store,
    authorize:()=>identity});
  assert.equal((await recorder.capture({candidate:identity,observation})).inserted,true);
  assert.equal((await recorder.capture({candidate:identity,observation})).duplicate,true);
  const events=await x.store.readJournalEvents({characterId:x.scope.characterId,timelineId:x.scope.timelineId});
  assert.equal(events.length,1);
  const sidecar=await x.store.readVerifiedEventEvidence({characterId:x.scope.characterId,timelineId:x.scope.timelineId,
    recordId:events[0].recordId});
  assert.equal(sidecar.sourceEvidence.observation.observationId,observationId);
  assert.equal(sidecar.event.sourceHash,sidecar.sourceEvidence.sourceHash);
  const updated={...observation,revision:2};
  assert.equal((await recorder.capture({candidate:identity,observation:updated})).inserted,true);
  await assert.rejects(recorder.capture({candidate:identity,observation}),/journal_stale_event_revision/);
 }finally{await x.store.close()}
});

test('M5 corrections remain reported overlays; original transcript is unchanged',async t=>{
 const x=await setup(t);
 try{
  const before='I said red beans yesterday';
  await x.recorder.recordPlayerAccepted({characterId:x.scope.characterId,identity:identity('mistake'),
    text:before,source:'typed',attribution:{protagonist:'franklin'}});
  await x.recorder.recordPlayerAccepted({characterId:x.scope.characterId,identity:identity('correction'),
    text:'No, I said blue beans yesterday',source:'typed',attribution:{protagonist:'franklin'}});
  const [cmd,original]=await x.store.readDialogueLines({characterId:x.scope.characterId,timelineId:x.scope.timelineId});
  const corrected='blue beans yesterday';
  const receipt=await x.store.commitCommand({scope:x.scope,commandId:id(),
    requestedByLineId:cmd.recordId,operation:'correct',origin:'explicit_player',
    recordType:'correction',content:corrected,
    contentHash:createHash('sha256').update(corrected).digest('hex'),
    pin:false,evidenceRecordIds:[original.recordId,cmd.recordId],
    targetRecordId:original.recordId,correctionMode:'transcript',
    subjectCertainty:'reported',requestedAtUtc:cmd.committedAtUtc});
  assert.equal(receipt.durableCommit,true);
  assert.equal((await x.store.findExactQuote({characterId:x.scope.characterId,
    timelineId:x.scope.timelineId,quote:before}))[0].content,before);
  const recalls=await recallFromSharedJournal({store:x.store,
    query:{...request(x.scope,'Tell me about blue beans'),intent:'open_recall'},
    protagonistKey:'franklin',nowUtc:new Date().toISOString()});
  assert.ok(recalls.bundle.items.some(item=>item.mode==='reported_claim'&&item.content.includes(corrected)));
  assert.ok(!recalls.bundle.items.some(item=>item.content===before));
 }finally{await x.store.close()}
});

test('existing M2 v3 journal upgrades atomically to v4 without touching raw dialogue',async t=>{
 const x=await setup(t);
 const exact='Unchanged historical dialogue 🚗  ';
 try{
  await x.recorder.recordPlayerAccepted({characterId:x.scope.characterId,identity:identity('legacy'),
   source:'typed',text:exact,attribution:{protagonist:'franklin'}});
  await x.store.close();
  const db=new DatabaseSync(x.filePath);
  try{
   for(const table of ['memory_luna_appraisals','memory_curation_jobs','memory_budget_reservations',
     'memory_corrections','memory_tombstones','memory_commands','memory_records']){
    db.exec('DROP TABLE '+table);
   }
   db.exec('PRAGMA user_version=3');
  }finally{db.close()}
  const reopened=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
  await reopened.initialize();
  try{
   const rows=await reopened.findExactQuote({characterId:x.scope.characterId,timelineId:x.scope.timelineId,quote:exact});
   assert.equal(rows.length,1);assert.equal(rows[0].content,exact);
   const verify=new DatabaseSync(x.filePath,{readOnly:true});
   try{
    assert.equal(verify.prepare('PRAGMA user_version').get().user_version,4);
    assert.equal(verify.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='memory_luna_appraisals'").get().n,1);
   }finally{verify.close()}
  }finally{await reopened.close()}
 }finally{await x.store.close()}
});

test('H: M3 certified negative coverage uses one P2 transaction and survives restart without cross-owner leakage',async t=>{
 const x=await setup(t);
 const observationId=id();
 const ownerProof={ownerAlias:x.store.get(x.scope.characterId).promotion.ownerAlias,
   incarnationId:id(),encounterId:id(),hostRunId:x.host.hostRunId,
   worldEpoch:x.host.worldEpoch,observerCaptureRef:id()};
 const adapterEpoch=id();
 const scope={characterId:x.scope.characterId,worldProfileId:x.scope.worldProfileId,
   timelineId:x.scope.timelineId,observationId,adapterEpoch};
 // Synthetic native receipt used to exercise the real P2 M3 source validator.
 const receipt={certified:true,nativeVerified:true,sourceReceiptId:id(),
   observationId,adapterEpoch,ownerAlias:ownerProof.ownerAlias,
   incarnationId:ownerProof.incarnationId,encounterId:ownerProof.encounterId,
   status:'did_not_witness',observerCaptureRef:ownerProof.observerCaptureRef,
   hostRunId:ownerProof.hostRunId,worldEpoch:ownerProof.worldEpoch,
   sampledGameTick:123,channel:'visual',basis:'native_awareness'};
 const record={...scope,status:'did_not_witness',reason:'fixture_native_negative',
   ownerProof,nativeCoverage:receipt};
 try{
   const ports=createM3JournalPorts(x.store);
   assert.equal((await x.store.readM3Coverage(scope)).status,'unknown');
   await assert.rejects(x.store.withTimelineWrite(scope.timelineId,foundation=>
     ports.journalPort.recordCoverage({...record,nativeCoverage:null},foundation)),/m3_negative_not_certified|m3_coverage_invalid/);
   assert.equal((await x.store.readM3Coverage(scope)).certified,false);
   assert.equal((await x.store.withTimelineWrite(scope.timelineId,foundation=>
     ports.journalPort.recordCoverage(record,foundation))).inserted,true);
   assert.equal((await x.store.withTimelineWrite(scope.timelineId,foundation=>
     ports.journalPort.recordCoverage(record,foundation))).duplicate,true);
   const stored=await x.store.readM3Coverage(scope);
   assert.equal(stored.certified,true);
   assert.equal(stored.record.ownerProof.observerCaptureRef,ownerProof.observerCaptureRef);
   x.store.setVerifiedHostContext(null);
   await assert.rejects(x.store.withTimelineWrite(scope.timelineId,foundation=>
     ports.journalPort.recordCoverage(record,foundation)),/timeline_write_suspended/);
   await x.store.close();
   const reopened=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
   await reopened.initialize();
   try{
     assert.equal((await reopened.readM3Coverage(scope)).certified,true);
     assert.equal((await reopened.readM3Coverage({...scope,characterId:id()})).status,'unknown');
   }finally{await reopened.close();}
 }finally{await x.store.close()}
});

test('H: strict M4 integrated projection uses existing P2 SQLite connection and byte-exact original quote',async t=>{
 const x=await setup(t);
 try{
   const exact='  permanent blue lighthouse \u{1F680}  ';
   await x.recorder.recordPlayerAccepted({characterId:x.scope.characterId,
     identity:identity('h-m4-lighthouse'),text:exact,source:'typed',
     attribution:{protagonist:'franklin'}});
   const readAdapter=createP2IntegratedRecallAdapter(x.store);
   const query=request(x.scope,'what did I say about lighthouse?');
   const result=await recallMemory({query,readAdapter,
     protagonistKey:'franklin',nowUtc:new Date().toISOString()});
   assert.equal(result.bundle.status,'matched');
   assert.equal(result.bundle.items[0].content,exact);
   assert.equal(result.bundle.totalBytes,Buffer.byteLength(JSON.stringify(result.bundle),'utf8'));
   const other=await recallMemory({query,readAdapter,protagonistKey:'trevor',
     nowUtc:new Date().toISOString()});
   assert.equal(other.bundle.status,'matched');
   assert.ok(other.bundle.items.some(item=>item.content===exact));
 }finally{await x.store.close()}
});

// The combined PR #75 workflow runs this DB-owned suite explicitly.
// Include closure-B adversarial fixtures without changing K-owned CI.
import './memory-b-closure.test.mjs';
