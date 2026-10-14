// Repeatable offline performance: ONE disk-backed production P2 connection,
// actual bounded M4 -> PS4 and original-runner preparation / send verification.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {d01Harness,sleep,waitFor} from './d01-harness.mjs';
import {validateDialogueLine} from '../../../lsa-shared-brain/src/memory/journalSqlite.mjs';
import {enforceJournalCaps} from '../../../lsa-shared-brain/src/characters/sqliteDurability.mjs';
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
 // This measures read/turn latency, NOT repeated per-row quota admission.
 // Generate fully schema-validated synthetic historical M2 envelopes and seed
 // them in ONE P2-owned transaction. The full incoming byte budget is checked
 // against the unchanged production journal caps before ANY inserts; SQLite
 // FTS/triggers, checks, timestamps and hashes remain real. Direct seeding
 // avoids 10k progressively more expensive O(n) cap scans starving the native
 // socket heartbeat (and timing out this unrelated *read* benchmark).
 // Production appendDialogue and its per-write cap checks remain unchanged and
 // are exercised by separate journal/durability regressions.
 const entries=[];
 let incomingBytes=0;
 for(let i=0;i<10000;i++){
  const e=validateDialogueLine({version:1,kind:'dialogue_line',...journalScope,
   recordId:randomUUID(),speaker:'player',source:'typed',delivery:'accepted',
   content:i===9000?'meticulous alpaca clock':'ordinary filler '+i,
   committedAtUtc:new Date(now-(i+1)*1000).toISOString(),turnIdentityHash:sha('ws6-busy-'+i),
   utteranceId:null,transcription:null,deliveryReceiptId:null},worldProfileId);
  const raw=JSON.stringify(e);incomingBytes+=Buffer.byteLength(raw)+Buffer.byteLength(e.content);
  entries.push({e,raw,avatar:['franklin','michael','trevor'][i%3]});
 }
 const seedStart=performance.now();
 await x.store.withP2SqliteTransaction(scope,db=>{
  assert.equal(db.prepare('SELECT count(*) AS n FROM dialogue_journal WHERE character_id=?').get(scope.characterId).n,0);
  assert.equal(db.prepare('SELECT count(*) AS n FROM memory_tombstones').get().n,0);
  enforceJournalCaps(db,{characterId:scope.characterId,bytes:incomingBytes});
  const insert=db.prepare('INSERT INTO dialogue_journal (record_id,world_profile_id,timeline_id,character_id,session_id,protagonist,host_run_id,world_epoch,speaker,source,delivery,turn_identity_hash,committed_at_utc,content,content_sha256,receipt_id,envelope_json,envelope_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const {e,raw,avatar} of entries)insert.run(e.recordId,e.worldProfileId,e.timelineId,e.characterId,
   sessionId,avatar,x.native.hostRunId,1,e.speaker,e.source,e.delivery,e.turnIdentityHash,
   e.committedAtUtc,e.content,sha(e.content),null,raw,sha(raw));
  assert.equal(db.prepare('SELECT count(*) AS n FROM dialogue_journal WHERE character_id=?').get(scope.characterId).n,10000);
 });
 console.log('WS6_SEED '+JSON.stringify({rows:10000,method:'validated_P2_single_writer_aggregate_cap',
  bytes:incomingBytes,elapsedMs:performance.now()-seedStart}));
 sourcePhase('post_seeding');
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
 // Even if a slow runner retired its previous native source during fixture
 // preparation, only a NEW authenticated hello on a NEW stream can restore it.
 // A fresh sample on a timed-out stream is never an authorization.
 const previousStream=x.native.streamId;
 await x.native.renew();
 assert.notEqual(x.native.streamId,previousStream);
 sourcePhase('post_rehandshake');
 try {await waitFor(()=>x.d02.port.status()?.settled===true &&
   x.client.runtime.stream===x.native.streamId &&
   x.client.runtime.hostContext?.hostRunId===x.native.hostRunId,
   'benchmark source reauthenticated with new native hello');}
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
 const countProjection=x.replies.at(-1).knowledgeProjection;
 const countScene=JSON.parse(countProjection.modelAllocation.scene);
 sourcePhase('post_count_turn',countProjection);
 const count=countScene.lanes.RECALLED.answerEvidence?.dialogueCount;
 assert.ok(count,'count evidence must be authenticated and survive PS4 allocation: '+
   JSON.stringify({source:x.d02.port.status(),hostCurrent:!!x.client.runtime.hostContext,
     memoryStamp:countProjection.memoryStamp,recallStamp:countProjection.recallStamp,
     recallAnswerEvidence:countProjection.recallAnswerEvidence,
     diagnostics:countProjection.diagnostics,answerEvidence:countScene.lanes.RECALLED.answerEvidence}));
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

test('WS6 native source expiry: old-stream samples fail closed and only a new authenticated hello restores D02', {timeout:45000}, async t=>{
 const x=await d01Harness(t);
 // Diagnostic only: no authentication state is modified or fabricated.
 // Phase snapshots allow Windows logs to distinguish a live ShadowRuntime,
 // a settled D02 native lease, and PS4 optional evidence-budget omission.
 const sourcePhase=(phase,frame=null)=>{
  const runtime=x.client.runtime,port=x.d02.port.status();
  console.log('WS6_SOURCE_PHASE '+JSON.stringify({phase,
   fixtureSamples:x.native.samples,fixtureRosters:x.native.rosters,
   runtimeLive:!!runtime.epoch,hostLive:!!runtime.hostContext,
   ownerAnchorCurrent:runtime.current(x.native.npcRef),
   playerAnchorCurrent:runtime.current(x.native.playerRef),
   runtimeTimeouts:runtime.resetDiagnostics.timeouts,
   runtimeFaults:runtime.resetDiagnostics.faults,
   d02Connected:port.connected,d02Settled:port.settled,
   ...(frame?{recallAnswerEvidence:frame.recallAnswerEvidence,
     recallStampPresent:!!frame.recallStamp,
     memoryStampPresent:!!frame.memoryStamp,
     frameBytes:frame.diagnostics?.bytes,
     canonLaneBytes:frame.diagnostics?.perLane?.RECALLED}:{})}));
 };

 x.native.stop();await x.native.idle();
 const oldStream=x.native.streamId,oldSocket=x.native.socket;
 // Expire via the real ShadowRuntime expiry path, not by changing D02 status
 // or authorizing based on elapsed time. The test advances its last-receipt
 // marker solely to exercise the negative timeout boundary.
 x.client.runtime.lastReceipt=x.client.runtime.now()-3001;
 x.client.runtime.expire();
 assert.equal(x.client.runtime.epoch,null,'a timed-out source loses its epoch');
 await x.native.sample();
 assert.equal(x.d02.port.status().settled,false,'old-stream sample is not re-authentication');
 assert.equal(x.client.runtime.hostContext,null,'old host evidence remains retired');
 await x.native.renew();
 await waitFor(()=>x.d02.port.status()?.settled===true &&
   x.client.runtime.stream===x.native.streamId,'new authenticated hello and owner sample');
 assert.notEqual(x.native.streamId,oldStream,'reconnect must rotate the source stream');
 assert.equal(oldSocket.destroyed,true,'expired socket is closed');
 assert.equal(x.d02.port.status().ownerCount,1);
 // Repeated real reconnects preserve authentication and close prior sockets.
 for(let i=0;i<2;i++){
  const previous=x.native.socket,stream=x.native.streamId;
  await x.native.renew();
  await waitFor(()=>x.d02.port.status()?.settled===true &&
    x.client.runtime.stream===x.native.streamId,'repeated authenticated renewal');
  assert.equal(previous.destroyed,true);
  assert.notEqual(x.native.streamId,stream);
 }
 const turn=await x.typed('I remember the little blue house.');
 assert.equal((await x.settled(turn)).status,'completed','ordinary typed dialogue survives renewed source');
 assert.equal((await x.journal()).players.length,1,'accepted dialogue keeps one durable journal row');
});
