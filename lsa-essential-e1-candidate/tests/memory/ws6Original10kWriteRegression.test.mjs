// EXACT original #138 10,000-write benchmark; retained as a separate blocking
// gate. Its original source, latency and count assertions are intentionally
// unchanged; the optimized bulk-seeded WS6 read test must not replace it.
// Repeatable offline performance: ONE disk-backed production P2 connection,
// actual bounded M4 -> PS4 and original-runner preparation / send verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {d01Harness,sleep,waitFor} from './d01-harness.mjs';
import {appendDialogue} from '../../../lsa-shared-brain/src/memory/journalSqlite.mjs';
import {recallMemory,toPs4RecallContribution} from '../../../lsa-shared-brain/src/memory/recallEngine.mjs';
import {createP2IntegratedRecallAdapter} from '../../../lsa-shared-brain/src/memory/integrationPorts.mjs';
import {createEssentialMemoryStorage} from '../../src/characters/memoryStorageAdapter.mjs';
import {projectPreparedRecall} from '../../src/context/knowledgeSelector.mjs';

const sha=x=>createHash('sha256').update(x).digest('hex');
const stats=s=>{const a=[...s].sort((a,b)=>a-b);return {n:a.length,
 medianMs:a[Math.floor((a.length-1)/2)],p95Ms:a[Math.ceil(a.length*.95)-1]};};
test('WS6 latency: disk P2 busy 10k, cold/restart M4 to PS4, original-runner prepare and pre-send',
 {timeout:180000},async t=>{
 const x=await d01Harness(t),worldProfileId=x.store.worldProfileId;
 const scope={worldProfileId,characterId:x.profile.characterId,timelineId:x.timelineId,protagonistKey:'franklin'};
 const {protagonistKey:unusedAvatar,...journalScope}=scope;
 const now=Date.now(),sessionId=randomUUID();
 // Dataset fixture through the same P2 transaction / real journal validator.
 // This is synthetic historical load, not ten thousand GTA/D03 receipts.
 // WS-4b quota admission adds synchronous checks for every journal row.
 // Bound each transaction's event-loop occupancy so the authenticated native
 // heartbeat is not starved while this test builds its 10k-row fixture.
 // We keep the same total rows and the same strict source/latency assertions.
 for(let batch=0;batch<10000;batch+=50){
 await x.store.withP2SqliteTransaction(scope,db=>{
  for(let i=batch;i<Math.min(batch+50,10000);i++)appendDialogue(db,{version:1,kind:'dialogue_line',...journalScope,
   recordId:randomUUID(),speaker:'player',source:'typed',delivery:'accepted',
   content:i===9000?'meticulous alpaca clock':'ordinary filler '+i,
   committedAtUtc:new Date(now-(i+1)*1000).toISOString(),turnIdentityHash:sha('ws6-busy-'+i),
   utteranceId:null,transcription:null,deliveryReceiptId:null},
   {sessionId,protagonist:['franklin','michael','trevor'][i%3],
    hostRunId:x.native.hostRunId,worldEpoch:1},worldProfileId);
 });
 await sleep(15);
 }
 const query={version:1,kind:'recall_query',queryId:randomUUID(),...scope,protagonistKey:undefined,
  turnIdentityHash:sha('ws6-benchmark'),question:'Quote what I said about meticulous alpaca clock',
  intent:'open_recall',maxBytes:4096};
 delete query.protagonistKey;
 const run=async store=>{
  const result=await recallMemory({query,protagonistKey:'franklin',nowUtc:new Date(now).toISOString(),
   readAdapter:createP2IntegratedRecallAdapter(store)});
  const p=projectPreparedRecall({status:'ready',contribution:toPs4RecallContribution(result.bundle)});
  assert.ok(p.evidence.some(e=>e.content==='meticulous alpaca clock'));
 };
 const start=performance.now();await run(x.store);const coldMs=performance.now()-start;
 const samples=[];
 for(let i=0;i<35;i++){const at=performance.now();await run(x.store);samples.push(performance.now()-at);}
 const m4=stats(samples);console.log('WS6_LATENCY '+JSON.stringify({path:'disk_P2_M4_PS4_busy_10000',coldMs,...m4}));
 assert.ok(m4.p95Ms<=40,'M4 p95 <=40 ms: '+JSON.stringify(m4));
 const prep=[],verify=[];
 // Dataset creation is synchronous and may exceed the native fixture's lease
 // TTL. Supply a fresh authenticated roster/sample before creating any turn.
 await x.native.roster();await x.native.sample();
 try {await waitFor(()=>x.d02.port.status()?.settled===true,'benchmark current native sample');}
 catch(error){
   console.error('WS6_BENCH_NATIVE_DIAG '+JSON.stringify({
     port:x.d02.port.status(),native:{samples:x.native.samples,rosters:x.native.rosters,tick:x.native.tick},
     runtime:{epoch:!!x.client.runtime.epoch,host:!!x.client.runtime.hostContext,
       counters:x.client.runtime.counters,resetReasons:x.client.runtime.resetDiagnostics,
       currentNpc:x.client.runtime.current(x.native.npcRef),
       currentPlayer:x.client.runtime.current(x.native.playerRef)}}));
   throw error;
 }
 const original=x.h.runtime.services.prepareLiveTurnMemory;
 x.h.runtime.services.prepareLiveTurnMemory=async args=>{
  const at=performance.now(),p=await original(args);prep.push(performance.now()-at);
  assert.equal(p.status,'ready');
  return {...p,verifyPrepared:async()=>{const begin=performance.now();const ok=await p.verifyPrepared();
   verify.push(performance.now()-begin);assert.equal(ok,true);return ok;}};
 };
 for(let i=0;i<10;i++){
  // Authorize EACH measured original turn with a new authenticated native
  // roster/owner sample; the fixture is deliberately long-running on Windows
  // and must not assume a previous lease remains current between turns.
  await x.native.roster();await x.native.sample();
  await waitFor(()=>x.d02.port.status()?.settled===true,'current native sample for measured turn');
  const turn=await x.typed('What did I say about meticulous alpaca clock?');
  assert.equal((await x.settled(turn)).status,'completed');
  const p=x.replies.at(-1).knowledgeProjection;
  assert.ok(JSON.parse(p.modelAllocation.scene).lanes.RECALLED.evidence?.some(e=>e.content==='meticulous alpaca clock'),JSON.stringify({prep,verify,stamp:p.memoryStamp,lanes:JSON.parse(p.modelAllocation.scene).lanes.RECALLED}));
 }
 console.log('WS6_LATENCY '+JSON.stringify({path:'original_runner_preparation_busy_10000',...stats(prep)}));
 console.log('WS6_LATENCY '+JSON.stringify({path:'original_runner_pre_send_verification_busy_10000',...stats(verify)}));
 // This final count query also needs an authenticated CURRENT native player.
 await x.native.roster();await x.native.sample();
 await waitFor(()=>x.d02.port.status()?.settled===true,'current native sample for count turn');
 const countStart=performance.now();
 const countTurn=await x.typed('How many times did I say "ordinary filler"?');
 assert.equal((await x.settled(countTurn)).status,'completed');
 const count=JSON.parse(x.replies.at(-1).knowledgeProjection.modelAllocation.scene).lanes.RECALLED.answerEvidence.dialogueCount;
 assert.equal(count.status,'complete');assert.equal(count.exactCount,9999,'exhaustive total exceeds bounded M4 candidate cap');
 console.log('WS6_LATENCY '+JSON.stringify({path:'original_runner_exhaustive_G3_busy_10000',n:1,
  wholeTurnMs:performance.now()-countStart,prepareMs:prep.at(-1),verifyMs:verify.at(-1),exactCount:count.exactCount}));
 x.native.stop();await x.store.close();
 const restartStart=performance.now();
 const reopened=createEssentialMemoryStorage({filePath:x.store.filePath,worldProfileId,sourceRequired:true});
 try{
  await reopened.initialize();reopened.setVerifiedHostContext({hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:2});
  await reopened.confirmTimeline(scope.timelineId);
  const ready=performance.now();await run(reopened);
  console.log('WS6_LATENCY '+JSON.stringify({path:'disk_P2_M4_PS4_restart_busy_10000',n:1,
   reopenAndConfirmMs:ready-restartStart,firstRecallMs:performance.now()-ready}));
 }finally{await reopened.close();}
});
