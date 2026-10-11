import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {handleExplicitMemoryCommand} from '../src/memory/explicitCommands.mjs';
import {recallFromSharedJournal,createDurableCurationAdapters,createM3WitnessRecorder} from '../src/memory/integrationPorts.mjs';
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
test('M4 reads real M2 bytes but excludes foreign protagonists and suppresses missing evidence',async t=>{
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
  assert.equal(missing.bundle.status,'unavailable');
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
