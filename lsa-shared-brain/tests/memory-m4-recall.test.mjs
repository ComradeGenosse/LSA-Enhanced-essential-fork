import {ensureSuppressionSchema} from '../src/memory/suppressionSqlite.mjs';
import {createHash} from 'node:crypto';
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
test('NPC/world/timeline are hard fences, source avatars share one player',async()=>{
 const f=fixture(),s=scope(),other=scope();try{
  f.add(other,dialogue(other,'classified ketchup'));
  f.add(s,dialogue(s,'trevor secret'),{protagonistKey:'trevor'});
  f.add(s,dialogue(s,'timeline proof'));
  assert.equal((await recall(f,s,'ketchup')).bundle.items.length,0);
  assert.ok((await recall(f,s,'secret')).bundle.items.length>0);
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
  assert.equal((await recall(f,s,'what did I say about pineapples yesterday?',{intent:'exact_quote'})).bundle.status,'unavailable');
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

test('recent speaker line, conservative oldest and chronological followup remain safe',async()=>{
 const f=fixture(),s=scope();try{
  f.add(s,dialogue(s,'one more banana',{at:'2026-10-11T19:00:00.000Z'}));
  f.add(s,dialogue(s,'newest pineapple'));
  assert.equal((await recall(f,s,'what did I just say?',{intent:'exact_quote'})).bundle.items[0].content,'newest pineapple');
  assert.equal((await recall(f,s,'what was the first thing I said?',{intent:'exact_quote'})).bundle.status,'unavailable');
  const begin=await recall(f,s,'what did I say?',{intent:'exact_quote'});
  const prior=await recall(f,s,'before that?',{intent:'exact_quote',followup:begin.continuation});
  assert.equal(prior.bundle.items[0].content,'one more banana');
 }finally{f.close();}
});

test('strict v1 bundle schema includes exact self-accounted UTF-8 bytes and rejects malformed projections',async()=>{
 const f=fixture(),s=scope();try{
  f.add(s,dialogue(s,'🚗 gingerbread special'));
  const q=query(s,'what did I say about gingerbread?',{intent:'exact_quote'});
  const {bundle}=await recallMemory({query:q,readAdapter:f.adapter,protagonistKey:s.protagonistKey,nowUtc:clock});
  assert.equal(bundle.totalBytes,Buffer.byteLength(JSON.stringify(bundle),'utf8'));
  assert.ok(bundle.totalBytes<=q.maxBytes);
  assert.throws(()=>toPs4RecallContribution({...bundle,totalBytes:undefined}),/strict_v1/);
  assert.throws(()=>toPs4RecallContribution({...bundle,unrecognized:true}),/strict_v1/);
  assert.throws(()=>toPs4RecallContribution({...bundle,totalBytes:bundle.totalBytes+1}),/byte_accounting/);
  await assert.rejects(recallMemory({query:{...q,additionalField:'forbidden'},readAdapter:f.adapter,
    protagonistKey:s.protagonistKey,nowUtc:clock}),/strict_v1/);
 }finally{f.close();}
});

test('v1 retains 3072-unit exact lines and safely abstains on 3073-unit lines',async()=>{
 const f=fixture(),s=scope();try{
  const good='snowflake '+('x'.repeat(3072-'snowflake '.length));
  f.add(s,dialogue(s,good));
  const a=(await recall(f,s,'what did I say about snowflake?',{intent:'exact_quote',maxBytes:14336})).bundle;
  assert.equal(a.items[0].content,good);
  const bad='firecracker '+('y'.repeat(3073-'firecracker '.length));
  f.add(s,dialogue(s,bad));
  const b=(await recall(f,s,'what did I say about firecracker?',{intent:'exact_quote'})).bundle;
  assert.equal(b.status,'unavailable');assert.equal(b.items.length,0);
  assert.equal(b.totalBytes,Buffer.byteLength(JSON.stringify(b)));
 }finally{f.close();}
});

test('malicious verified output marked superseded or forgotten cannot reach the model',async()=>{
 const s=scope(),e=dialogue(s,'forgotten secret');
 const make=flag=>({read:async()=>({rows:[{...s,recordId:e.recordId,sourceKind:e.kind,
   atUtc:e.committedAtUtc,evidenceState:'verified',envelope:e,[flag]:true}],coverageComplete:true})});
 for(const flag of ['forgotten','superseded','suppressed']){
  const b=(await recallMemory({query:query(s,'forgotten secret',{intent:'exact_quote'}),
   readAdapter:make(flag),protagonistKey:s.protagonistKey,nowUtc:clock})).bundle;
  assert.equal(b.status,'unavailable');
 }
});

function integratedFixture(){
 const db=new DatabaseSync(':memory:');
 ensureSuppressionSchema(db);
 db.exec("CREATE TABLE dialogue_journal(record_id TEXT PRIMARY KEY,world_profile_id TEXT,character_id TEXT,timeline_id TEXT,protagonist TEXT,speaker TEXT,source TEXT,delivery TEXT,committed_at_utc TEXT,content TEXT,content_sha256 TEXT,envelope_json TEXT,envelope_sha256 TEXT)");
 db.exec("CREATE VIRTUAL TABLE dialogue_journal_fts USING fts5(content,content='dialogue_journal',content_rowid='rowid')");
 db.exec("CREATE TRIGGER dialogue_fts_insert AFTER INSERT ON dialogue_journal BEGIN INSERT INTO dialogue_journal_fts(rowid,content) VALUES(new.rowid,new.content); END");
 db.exec("CREATE TABLE memory_records(memory_id TEXT PRIMARY KEY,world_profile_id TEXT,character_id TEXT,timeline_id TEXT,protagonist_key TEXT,content TEXT,content_sha256 TEXT,mode TEXT,evidence_ids_json TEXT,created_at_utc TEXT)");
 db.exec("CREATE TABLE memory_tombstones(world_profile_id TEXT,character_id TEXT,timeline_id TEXT,target_id TEXT)");
 db.exec("CREATE TABLE memory_commands(command_id TEXT PRIMARY KEY,protagonist_key TEXT)");
 db.exec("CREATE TABLE memory_corrections(command_id TEXT PRIMARY KEY,world_profile_id TEXT,character_id TEXT,timeline_id TEXT,target_id TEXT,preferred_text TEXT,content_sha256 TEXT,created_at_utc TEXT)");
 db.exec("CREATE TABLE event_journal(record_id TEXT PRIMARY KEY,world_profile_id TEXT,character_id TEXT,timeline_id TEXT,event_type TEXT,received_at_utc TEXT,envelope_json TEXT,envelope_sha256 TEXT,receipt_status TEXT)");
 db.exec("CREATE TABLE event_source_evidence(record_id TEXT PRIMARY KEY,source_evidence_json TEXT,source_evidence_sha256 TEXT)");
 const digest=v=>createHash('sha256').update(v,'utf8').digest('hex');
 const ins=db.prepare('INSERT INTO dialogue_journal VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
 const mem=db.prepare('INSERT INTO memory_records VALUES(?,?,?,?,?,?,?,?,?,?)');
 const corr=db.prepare('INSERT INTO memory_corrections VALUES(?,?,?,?,?,?,?,?)');
 return {db,adapter:new SQLiteRecallReadAdapter({db}),digest,
  dialogue(s,text,opts={}){
   const e=dialogue(s,text,opts),raw=JSON.stringify(e);
   ins.run(e.recordId,s.worldProfileId,s.characterId,s.timelineId,opts.protagonistKey??s.protagonistKey,
     e.speaker,e.source,e.delivery,e.committedAtUtc,e.content,digest(e.content),raw,digest(raw));return e;
  },
  correction(s,target,preferred,at=clock){
   const id=U();db.prepare('INSERT INTO memory_commands VALUES(?,?)').run(id,s.protagonistKey);
   corr.run(id,s.worldProfileId,s.characterId,s.timelineId,target,preferred,digest(preferred),at);return id;
  },
  memory(s,content,evidence){
   const id=U();mem.run(id,s.worldProfileId,s.characterId,s.timelineId,s.protagonistKey,content,digest(content),
    'reported_claim',JSON.stringify(evidence),clock);return id;
  },
  close(){db.close();}
 };
}

test('real v4 read projection: source hashes, archived FTS, correction overlays and recursive forgets',async()=>{
 const f=integratedFixture(),s=scope();try{
  const old=f.dialogue(s,'I said RED beans and 🚗',{at:'2023-01-01T00:00:00.000Z'});
  const unrelated=f.dialogue(s,'classified Trevor pudding',{protagonistKey:'trevor'});
  const crossAvatarCorrection=f.correction(s,unrelated.recordId,'cross-avatar player correction');
  const forgedMemory=f.memory(s,'orphaned evidence claim',[U()]);
  const forgedLookup=(await recallMemory({query:query(s,'orphaned evidence claim'),
    readAdapter:f.adapter,protagonistKey:s.protagonistKey,nowUtc:clock})).bundle;
  assert.ok(!forgedLookup.items.some(x=>x.recordId===forgedMemory));
  const forgedReport=(await recallMemory({query:query(s,'cross-avatar player correction'),
    readAdapter:f.adapter,protagonistKey:s.protagonistKey,nowUtc:clock})).bundle;
  assert.ok(forgedReport.items.some(x=>x.recordId===crossAvatarCorrection));
  const raw=await recallMemory({query:query(s,'what did I say about RED beans?',{intent:'exact_quote'}),
    readAdapter:f.adapter,protagonistKey:s.protagonistKey,nowUtc:clock});
  assert.equal(raw.bundle.items[0].recordId,old.recordId);assert.equal(raw.bundle.items[0].freshness,'archive');
  const target=f.correction(s,old.recordId,'BLUE beans');
  const quoteCorrection=(await recallMemory({query:query(s,'what did I say about beans?',{intent:'exact_quote'}),
    readAdapter:f.adapter,protagonistKey:s.protagonistKey,nowUtc:clock})).bundle;
  assert.ok(quoteCorrection.items.some(item=>item.recordId===target&&item.mode==='reported_claim'));
  assert.ok(!quoteCorrection.items.some(item=>item.recordId===old.recordId));
  let b=(await recallMemory({query:query(s,'tell me about beans'),readAdapter:f.adapter,protagonistKey:s.protagonistKey,nowUtc:clock})).bundle;
  assert.ok(b.items.some(x=>x.recordId===target&&x.mode==='reported_claim'&&x.content.includes('BLUE beans')),JSON.stringify(b));
  assert.ok(!b.items.some(x=>x.recordId===old.recordId));
  const stable=f.memory(s,'original faulty memory',[old.recordId]);
  b=(await recallMemory({query:query(s,'faulty memory'),readAdapter:f.adapter,protagonistKey:s.protagonistKey,nowUtc:clock})).bundle;
  assert.ok(!b.items.some(x=>x.recordId===stable));
  assert.equal((await recallMemory({query:query(s,'Trevor pudding'),readAdapter:f.adapter,
   protagonistKey:s.protagonistKey,nowUtc:clock})).bundle.items.length,0);
  f.db.prepare('INSERT INTO memory_tombstones VALUES(?,?,?,?)').run(s.worldProfileId,s.characterId,s.timelineId,old.recordId);
  b=(await recallMemory({query:query(s,'tell me about BLUE beans'),readAdapter:f.adapter,
   protagonistKey:s.protagonistKey,nowUtc:clock})).bundle;
  assert.ok(!b.items.some(x=>x.recordId===target));
  assert.ok(!b.items.some(x=>x.recordId===old.recordId));
  assert.ok(!b.items.some(x=>x.recordId===stable));
  assert.equal(unrelated.kind,'dialogue_line');
 }finally{f.close();}
});

test('real v4 projection 10k-record p95 retrieval target is measured, not GTA acceptance',async()=>{
 const f=integratedFixture(),s=scope();try{
  f.db.exec('BEGIN');
  for(let i=0;i<10000;i++)f.dialogue(s,i===13?'meticulous alpaca clock':'ordinary filler '+i,{
   at:new Date(Date.parse(clock)-i*1000).toISOString()});
  f.db.exec('COMMIT');
  const q=query(s,'what did I say about meticulous alpaca?',{intent:'exact_quote'}),samples=[];
  for(let i=0;i<35;i++){
   const t=performance.now();
   const {bundle}=await recallMemory({query:q,readAdapter:f.adapter,protagonistKey:s.protagonistKey,nowUtc:clock});
   samples.push(performance.now()-t);
   assert.equal(bundle.items[0].content,'meticulous alpaca clock');
   assert.ok(bundle.totalBytes<=q.maxBytes);
  }
  samples.sort((a,b)=>a-b);const p95=samples[Math.ceil(samples.length*.95)-1];
  console.log('M4 integrated 10k v4 p95 ms:',p95.toFixed(2),'target <=40ms (environment dependent)');
  assert.ok(Number.isFinite(p95));
 }finally{f.close();}
});

test('PS4 source priority, frozen turn ownership, deadline and send-time revalidation',async()=>{
 const {preparePs4Recall,verifyPs4RecallCurrent}=await import('../src/memory/ps4RecallContribution.mjs');
 const f=fixture(),s=scope(),turnIdentityHash=SHA;
 try{
  f.add(s,dialogue(s,'safe memory raccoon'));
  const q=query(s,'what did I say about raccoon?',{intent:'exact_quote'});
  let identity={...s,turnIdentityHash,hostRunId:U(),worldEpoch:1,
    incarnationId:U(),encounterId:U(),turnId:U()};
  const accepted=await preparePs4Recall({query:q,readAdapter:f.adapter,
    snapshot:identity,currentIdentity:()=>identity,protagonistKey:s.protagonistKey,
    nowUtc:clock,deadlineMs:200});
  assert.equal(accepted.status,'ready');
  assert.equal(accepted.contribution.items[0].content,'safe memory raccoon');
  assert.ok(verifyPs4RecallCurrent(accepted,{currentIdentity:()=>identity,validateEvidence:()=>true}));
  identity={...identity,worldEpoch:2};
  assert.equal(verifyPs4RecallCurrent(accepted,{currentIdentity:()=>identity}),false);
  const stale=await preparePs4Recall({query:q,readAdapter:f.adapter,snapshot:accepted.stamp,
    currentIdentity:()=>identity,protagonistKey:s.protagonistKey,nowUtc:clock});
  assert.equal(stale.reason,'stale_before_read');
  const blocked=await preparePs4Recall({query:{...q,intent:'spontaneous'},
    readAdapter:f.adapter,snapshot:identity,currentIdentity:()=>identity,
    protagonistKey:s.protagonistKey,source:'player_text',playerActive:true,nowUtc:clock});
  assert.equal(blocked.reason,'player_priority');
  const slow={read:()=>new Promise(resolve=>setTimeout(()=>resolve({rows:[],coverageComplete:false}),60))};
  const late=await preparePs4Recall({query:q,readAdapter:slow,snapshot:identity,
    currentIdentity:()=>identity,protagonistKey:s.protagonistKey,nowUtc:clock,deadlineMs:5});
  assert.equal(late.reason,'deadline');
 }finally{f.close();}
});

test('real v4 event archive validates actual M3 sidecar and never invents witnessing',async()=>{
 const {normalizeWitnessedObservation}=await import('../src/events/journalEventNormalizer.mjs');
 const f=integratedFixture(),s={...scope(),protagonistKey:'unknown'};
 const make=(type,kind,channel,at)=>{
  const ownerProof={ownerAlias:'npc.test',incarnationId:U(),encounterId:U(),hostRunId:U(),
    worldEpoch:1,observerCaptureRef:U()};
  const identity={promoted:true,current:true,characterId:s.characterId,
    worldProfileId:s.worldProfileId,timelineId:s.timelineId,adapterEpoch:U(),ownerProof};
  const observation={version:1,observationId:U(),episodeId:U(),revision:1,
    observer:{kind:'ped',captureRef:ownerProof.observerCaptureRef},
    observedAt:{nativeRun:identity.adapterEpoch,gameTick:10,receivedUtc:at},
    eventType:type,claims:[{claimId:U(),kind,certainty:'supported',
      evidence:{channel,basis:channel==='report'?'dialogue_report':'sampled_state',
        sampledGameTick:10,...(channel==='report'?{reportRef:U()}:{})}}]};
  return normalizeWitnessedObservation({observation,identity});
 };
 const add=v=>{
  assert.equal(v.accepted,true);
  const e=v.event,raw=JSON.stringify(e),side=JSON.stringify(v.sourceEvidence);
  f.db.prepare('INSERT INTO event_journal VALUES(?,?,?,?,?,?,?,?,?)')
    .run(e.recordId,s.worldProfileId,s.characterId,s.timelineId,e.eventType,
      e.receivedAtUtc,raw,f.digest(raw),e.receiptStatus);
  f.db.prepare('INSERT INTO event_source_evidence VALUES(?,?,?)')
    .run(e.recordId,side,f.digest(side));
  return e;
 };
 try{
  const old=add(make('firing_burst','firing','visual','2023-01-01T00:00:00.000Z'));
  f.db.exec('BEGIN');
  for(let i=0;i<400;i++)add(make('character_present','presence','visual',
     new Date(Date.parse(clock)-i*1000).toISOString()));
  f.db.exec('COMMIT');
  const b=(await recallMemory({query:query(s,'did you witness firing?'),
    readAdapter:f.adapter,protagonistKey:'unknown',nowUtc:clock})).bundle;
  assert.ok(b.items.some(x=>x.recordId===old.recordId&&x.mode==='observed_fact'));
  const other=(await recallMemory({query:query(s,'did you witness firing?'),
    readAdapter:f.adapter,protagonistKey:'franklin',nowUtc:clock})).bundle;
  assert.ok(other.items.some(x=>x.recordId===old.recordId));
  f.db.prepare('UPDATE event_source_evidence SET source_evidence_json=? WHERE record_id=?')
    .run('{}',old.recordId);
  const tampered=(await recallMemory({query:query(s,'did you witness firing?'),
    readAdapter:f.adapter,protagonistKey:'unknown',nowUtc:clock})).bundle;
  assert.equal(tampered.status,'unavailable');
 }finally{f.close();}
});

// Run the focused PS4 closure/adversarial suites in the established M4 CI gate.
import '../../lsa-essential-e1-candidate/tests/memory-m4-closure.test.mjs';

// WS-6 Agent B exercises the same M4 source integrity path in Windows/Linux CI.
import './memory-ws6-g3-g5-evidence.test.mjs';
