// H2 retrieval / evidence / contribution / revalidation latency on a 10,000-row
// busy journal (production P2 SQLite on disk). Phases are measured separately and
// are NOT a claim about whole foreground-pipeline latency. The original M4 target
// (query + contribution, p95 <= 40 ms) is asserted; the other phases are reported.
import test from 'node:test';
import assert from 'node:assert/strict';
import {p2Fixture,ago,id,sha,worldProfileId} from './h2-p2-fixture.mjs';
import {prepareFactualRecall} from '../../src/memory/h2FactualRecall.mjs';
import {validateDialogueLine} from '../../../lsa-shared-brain/src/memory/journalSqlite.mjs';
import {enforceJournalCaps} from '../../../lsa-shared-brain/src/characters/sqliteDurability.mjs';

const stats=s=>{const a=[...s].sort((x,y)=>x-y);return {n:a.length,
 medianMs:a[Math.floor((a.length-1)/2)],p95Ms:a[Math.ceil(a.length*.95)-1],maxMs:a.at(-1)};};

test('H2 10,000-row journal: exact retrieval and phase latencies',{timeout:240000},async t=>{
 const f=await p2Fixture(t);
 const scope=f.scope();
 const {protagonistKey,...journalScope}=scope;
 const now=Date.now(),sessionId=id();
 const entries=[];let incoming=0;
 for(let i=0;i<10000;i++){
  const e=validateDialogueLine({version:1,kind:'dialogue_line',...journalScope,recordId:id(),
   speaker:'player',source:'typed',delivery:'accepted',
   content:i===9000?'meticulous alpaca clock':'ordinary filler '+i,
   committedAtUtc:new Date(now-(i+1)*1000-3600000).toISOString(),turnIdentityHash:sha('h2-busy-'+i),
   utteranceId:null,transcription:null,deliveryReceiptId:null},worldProfileId);
  const raw=JSON.stringify(e);incoming+=Buffer.byteLength(raw)+Buffer.byteLength(e.content);
  entries.push({e,raw,avatar:['franklin','michael','trevor'][i%3]});
 }
 const seedStart=performance.now();
 await f.store.withP2SqliteTransaction(scope,db=>{
  enforceJournalCaps(db,{characterId:scope.characterId,bytes:incoming});
  const insert=db.prepare('INSERT INTO dialogue_journal (record_id,world_profile_id,timeline_id,character_id,session_id,protagonist,host_run_id,world_epoch,speaker,source,delivery,turn_identity_hash,committed_at_utc,content,content_sha256,receipt_id,envelope_json,envelope_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for(const {e,raw,avatar} of entries)insert.run(e.recordId,e.worldProfileId,e.timelineId,e.characterId,
   sessionId,avatar,f.host.hostRunId,f.host.worldEpoch,e.speaker,e.source,e.delivery,e.turnIdentityHash,
   e.committedAtUtc,e.content,sha(e.content),null,raw,sha(raw));
  assert.equal(db.prepare('SELECT count(*) AS n FROM dialogue_journal WHERE character_id=?').get(scope.characterId).n,10000);
 });
 console.log('H2_SEED '+JSON.stringify({rows:10000,elapsedMs:performance.now()-seedStart}));
 const input='Quote what I said about meticulous alpaca clock';
 const accepted=await f.say(input);
 const args={store:f.store,turn:f.turnFor(0),acceptedReceipt:{status:'stored',durable:true,
  recordId:accepted.recordId,protagonistKey:'franklin'},input,source:'player_text',isCurrent:()=>true};
 const run=async()=>{
  const r=await prepareFactualRecall(args);
  assert.equal(r.status,'ready');
  assert(r.preparedRecall.contribution.items.some(x=>x.content==='meticulous alpaca clock'));
  return r;
 };
 const cold=await run();
 const phases={readbackMs:[],retrievalMs:[],evidenceMs:[],contributionMs:[],totalMs:[],m4Ms:[],revalidationMs:[]};
 for(let i=0;i<35;i++){
  const r=await run();
  for(const k of ['readbackMs','retrievalMs','evidenceMs','contributionMs','totalMs'])phases[k].push(r.timings[k]);
  phases.m4Ms.push(r.timings.retrievalMs+r.timings.contributionMs);
  assert.equal(await r.verifyPrepared(),true);phases.revalidationMs.push(r.revalidationMs());
 }
 const report=Object.fromEntries(Object.entries(phases).map(([k,v])=>[k,stats(v)]));
 console.log('H2_LATENCY '+JSON.stringify({rows:10000,coldTotalMs:cold.timings.totalMs,...report}));
 assert.ok(report.m4Ms.p95Ms<=40,'M4 query+contribution p95 <= 40 ms: '+JSON.stringify(report.m4Ms));
 // Count query is exhaustive over the full 10k journal, not the 384 candidate page.
 const countInput='How many times did I say "ordinary filler"?';
 const countLine=await f.say(countInput);
 const at=performance.now();
 const c=await prepareFactualRecall({...args,input:countInput,
  acceptedReceipt:{status:'stored',durable:true,recordId:countLine.recordId,protagonistKey:'franklin'}});
 const countMs=performance.now()-at;
 assert.equal(c.preparedRecall.answerEvidence.dialogueCount.exactCount,9999);
 console.log('H2_LATENCY '+JSON.stringify({path:'exhaustive_count_10k',prepareMs:countMs,timings:c.timings}));
});

