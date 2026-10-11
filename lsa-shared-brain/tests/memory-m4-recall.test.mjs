import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {DatabaseSync} from 'node:sqlite';
import {recallMemory,toPs4RecallContribution} from '../src/memory/recallEngine.mjs';
import {SQLiteRecallReadAdapter} from '../src/memory/sqliteRecallReadAdapter.mjs';

const U=()=>randomUUID(),SHA='b'.repeat(64),clock='2026-10-11T21:00:00.000Z';
const scope=()=>({characterId:U(),worldProfileId:U(),timelineId:U(),protagonistKey:'franklin'});
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE m4_recall_records_v1(document_id INTEGER PRIMARY KEY,character_id TEXT,world_profile_id TEXT,timeline_id TEXT,protagonist_key TEXT,record_id TEXT,source_kind TEXT,speaker TEXT,timestamp_utc TEXT,evidence_state TEXT,envelope_json TEXT,surface_text TEXT)');
 db.exec('CREATE INDEX m4_recent ON m4_recall_records_v1(character_id,world_profile_id,timeline_id,protagonist_key,source_kind,speaker,timestamp_utc DESC)');
 db.exec('CREATE VIRTUAL TABLE m4_recall_fts_v1 USING fts5(surface_text)');
 db.exec('CREATE TABLE m4_recall_coverage_v1(character_id TEXT,world_profile_id TEXT,timeline_id TEXT,protagonist_key TEXT,source_kind TEXT,from_utc TEXT,to_utc TEXT,all_complete INTEGER,complete INTEGER)');
 const insert=db.prepare('INSERT INTO m4_recall_records_v1(character_id,world_profile_id,timeline_id,protagonist_key,record_id,source_kind,speaker,timestamp_utc,evidence_state,envelope_json,surface_text) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
 const index=db.prepare('INSERT INTO m4_recall_fts_v1(rowid,surface_text) VALUES(?,?)');
 const coverage=db.prepare('INSERT INTO m4_recall_coverage_v1 VALUES(?,?,?,?,?,?,?,?,?)');
 return {
  db,adapter:new SQLiteRecallReadAdapter({db}),
  add(s,e,{protagonistKey=s.protagonistKey,evidenceState='verified'}={}){
   const at=e.kind==='dialogue_line'?e.committedAtUtc:e.receivedAtUtc;
   const surface=e.kind==='dialogue_line'?e.content:e.kind==='journal_event'?[e.eventType,...e.claims.map(c=>c.kind+' '+c.durableSubject)].join(' '):e.content;
   const id=insert.run(s.characterId,s.worldProfileId,s.timelineId,protagonistKey,e.recordId,e.kind,e.speaker??null,at,evidenceState,JSON.stringify(e),surface).lastInsertRowid;
   index.run(Number(id),surface);return e;
  },
  cover(s,kind='dialogue_line',from=null,to=null){coverage.run(s.characterId,s.worldProfileId,s.timelineId,s.protagonistKey,kind,from,to,from===null?1:0,1);},
  close(){db.close();}
 };
}
function dialogue(s,content,{speaker='player',at=clock,delivery=speaker==='player'?'accepted':'completed',source=speaker==='player'?'typed':'npc_generated',receipt=speaker==='npc'?U():null}={}){
 return {version:1,kind:'dialogue_line',characterId:s.characterId,worldProfileId:s.worldProfileId,timelineId:s.timelineId,recordId:U(),speaker,source,content,delivery,committedAtUtc:at,turnIdentityHash:SHA,utteranceId:U(),transcription:source==='stt'?{provider:'openai',model:'transcribe',confidence:null}:null,deliveryReceiptId:receipt};
}
function event(s,kind='crash',{at=clock,receiptStatus='witnessed',modality='visual',certainty='direct'}={}){
 return {version:1,kind:'journal_event',characterId:s.characterId,worldProfileId:s.worldProfileId,timelineId:s.timelineId,recordId:U(),observationId:U(),revision:1,eventType:kind,receivedAtUtc:at,sourceHash:SHA,ownerProof:{ownerAlias:'promoted.test',incarnationId:U(),encounterId:U(),hostRunId:U(),worldEpoch:1,observerCaptureRef:U()},receiptStatus,claims:[{kind,modality,certainty,durableSubject:'player',sourceEvidenceId:U()}]};
}
const query=(s,question,{intent='open_recall',maxBytes=4096}={})=>({version:1,kind:'recall_query',characterId:s.characterId,worldProfileId:s.worldProfileId,timelineId:s.timelineId,queryId:U(),turnIdentityHash:SHA,intent,question,maxBytes});
const recall=(f,s,q,opts={})=>recallMemory({query:query(s,q,opts),readAdapter:f.adapter,protagonistKey:s.protagonistKey,nowUtc:clock,...opts});

test('retained typed Unicode quote is byte exact, source linked and bounded',async()=>{
 const f=fixture(),s=scope();try{
  const text='  I SAID:  🚗 two  spaces, damn! \n next line  ',e=f.add(s,dialogue(s,text));
  const {bundle}=await recall(f,s,'what did I say about spaces?',{intent:'exact_quote'});
  assert.equal(bundle.status,'matched');assert.equal(bundle.items[0].content,text);
  assert.deepEqual(Buffer.from(bundle.items[0].content),Buffer.from(text));
  assert.equal(bundle.items[0].recordId,e.recordId);assert.equal(bundle.items[0].mode,'exact_quote');
  assert.ok(Buffer.byteLength(JSON.stringify(bundle))<=4096);
 }finally{f.close();}
});
test('unplayed/interrupted NPC speech and invented player input are excluded',async()=>{
 const f=fixture(),s=scope();try{
  f.add(s,dialogue(s,'phantom unicorn',{speaker:'npc',delivery:'interrupted'}));
  f.add(s,dialogue(s,'phantom unicorn',{speaker:'npc',receipt:null}));
  f.add(s,dialogue(s,'phantom unicorn',{speaker:'player',source:'npc_generated'}));
  assert.equal((await recall(f,s,'what did you say about phantom?',{intent:'exact_quote'})).bundle.status,'unavailable');
  const real=f.add(s,dialogue(s,'phantom unicorn',{speaker:'npc'}));
  const b=(await recall(f,s,'what did you say about phantom?',{intent:'exact_quote'})).bundle;
  assert.equal(b.items.length,1);assert.equal(b.items[0].recordId,real.recordId);
 }finally{f.close();}
});
test('character, world, timeline and protagonist are independent hard fences',async()=>{
 const f=fixture(),s=scope(),other=scope();try{
  f.add(other,dialogue(other,'classified ketchup'));
  f.add(s,dialogue(s,'trevor secret'),{protagonistKey:'trevor'});
  f.add(s,dialogue(s,'timeline proof'));
  assert.equal((await recall(f,s,'ketchup')).bundle.items.length,0);
  assert.equal((await recall(f,s,'secret')).bundle.items.length,0);
  const good=f.add(s,dialogue(s,'hello from franklin'));
  const injected={read:async()=>({rows:[{characterId:other.characterId,worldProfileId:s.worldProfileId,timelineId:s.timelineId,protagonistKey:s.protagonistKey,recordId:good.recordId,sourceKind:good.kind,envelope:good,atUtc:clock,evidenceState:'verified'}],coverageComplete:true})};
  const result=await recallMemory({query:query(s,'franklin'),readAdapter:injected,protagonistKey:s.protagonistKey,nowUtc:clock});
  assert.equal(result.bundle.items.length,0);
 }finally{f.close();}
});
test('yesterday window and explicit coverage distinguish not-recorded from unknown',async()=>{
 const f=fixture(),s=scope();try{
  f.add(s,dialogue(s,'secret orange umbrella',{at:'2026-10-10T15:00:00.000Z'}));
  f.add(s,dialogue(s,'secret orange refrigerator'));
  const b=(await recall(f,s,'what did I say about orange yesterday?',{intent:'exact_quote'})).bundle;
  assert.deepEqual(b.items.map(x=>x.content),['secret orange umbrella']);
  assert.equal((await recall(f,s,'did we see a crash yesterday?')).bundle.status,'unavailable');
  f.cover(s,'dialogue_line','2026-10-10T00:00:00.000Z','2026-10-11T00:00:00.000Z');
  assert.equal((await recall(f,s,'what did I say about pineapples yesterday?',{intent:'exact_quote'})).bundle.status,'not_recorded');
 }finally{f.close();}
});
test('witnessed events are distinct from a reported claim',async()=>{
 const f=fixture(),s=scope();try{
  f.add(s,event(s,'crash'));
  f.add(s,event(s,'gunfire',{receiptStatus:'reported',modality:'report',certainty:'reported'}));
  const crash=(await recall(f,s,'did you witness a crash?')).bundle;
  assert.equal(crash.items[0].sourceKind,'journal_event');assert.equal(crash.items[0].mode,'observed_fact');
  const report=(await recall(f,s,'what about gunfire?')).bundle;
  assert.equal(report.items[0].mode,'reported_claim');
 }finally{f.close();}
});
test('spontaneous budget and typed PS4 lane; oversized exact quote fails closed',async()=>{
 const f=fixture(),s=scope();try{
  for(let i=0;i<30;i++)f.add(s,dialogue(s,'disco pineapple number '+i,{at:new Date(Date.parse(clock)-i*60000).toISOString()}));
  const b=(await recall(f,s,'disco pineapple',{intent:'spontaneous',maxBytes:1200})).bundle;
  assert.ok(b.items.length<=3);assert.ok(Buffer.byteLength(JSON.stringify(b))<=1200);
  assert.equal(toPs4RecallContribution(b).lane,'RECALLED');
  f.add(s,dialogue(s,'needle '+('x'.repeat(4000))));
  const over=(await recall(f,s,'what did I say about needle?',{intent:'exact_quote'})).bundle;
  assert.equal(over.status,'unavailable');assert.equal(over.items.length,0);
 }finally{f.close();}
});
test('follow-up inherits topic only within the identical scoped identity',async()=>{
 const f=fixture(),s=scope(),other=scope();try{
  f.add(s,dialogue(s,'rainbow scooter'));f.add(s,dialogue(s,'purple frisbee'));
  const first=await recall(f,s,'what did I say about rainbow scooter?',{intent:'exact_quote'});
  assert.equal(first.bundle.items[0].content,'rainbow scooter');
  const next=await recall(f,s,'what about that?',{intent:'exact_quote',followup:first.continuation});
  assert.equal(next.bundle.items[0].content,'rainbow scooter');
  const shifted=await recall(f,s,'and purple frisbee?',{intent:'exact_quote',followup:first.continuation});
  assert.equal(shifted.bundle.items[0].content,'purple frisbee');
  const crossed=await recallMemory({query:query(other,'what about that?',{intent:'exact_quote'}),readAdapter:f.adapter,protagonistKey:other.protagonistKey,nowUtc:clock,followup:first.continuation});
  assert.equal(crossed.bundle.items.length,0);
 }finally{f.close();}
});
test('archived quote FTS and 10k-record retrieval p95 measurement',async()=>{
 const f=fixture(),s=scope();try{
  const old=f.add(s,dialogue(s,'in 2023 the volcano scooter was legendary',{at:'2023-01-01T00:00:00.000Z'}));
  f.db.exec('BEGIN');
  for(let i=0;i<10000;i++)f.add(s,dialogue(s,i===11?'meticulous alpaca clock':'routine itinerary no '+i,{at:new Date(Date.parse(clock)-i*1000).toISOString()}));
  f.db.exec('COMMIT');
  const b=(await recall(f,s,'what did I say about volcano scooter?',{intent:'exact_quote'})).bundle;
  assert.equal(b.items[0].recordId,old.recordId);assert.equal(b.items[0].freshness,'archive');
  const samples=[];
  for(let n=0;n<50;n++){const t=performance.now(),b=(await recall(f,s,'what did I say about meticulous alpaca?',{intent:'exact_quote'})).bundle;samples.push(performance.now()-t);assert.equal(b.items[0].content,'meticulous alpaca clock');}
  samples.sort((a,b)=>a-b);
  const p95=samples[Math.ceil(samples.length*.95)-1];
  console.log('M4 CPU 10k-record fixture p95 milliseconds:',p95.toFixed(2),'target: <=40ms; fixture, not GTA');
  assert.ok(Number.isFinite(p95));
 }finally{f.close();}
});
