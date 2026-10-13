import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createRecallEvidencePolicy} from '../src/memory/recallEvidencePolicy.mjs';
import {ensureSuppressionSchema} from '../src/memory/suppressionSqlite.mjs';

const id=()=>randomUUID(),sha=s=>createHash('sha256').update(s).digest('hex');
const time=n=>new Date(Date.UTC(2026,9,13,12)+n).toISOString();
function setup(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE dialogue_journal(record_id TEXT PRIMARY KEY,world_profile_id TEXT,character_id TEXT,timeline_id TEXT,protagonist TEXT,speaker TEXT,source TEXT,delivery TEXT,content TEXT,content_sha256 TEXT,envelope_json TEXT,envelope_sha256 TEXT,committed_at_utc TEXT,turn_identity_hash TEXT);'
 +'CREATE TABLE event_journal(record_id TEXT,world_profile_id TEXT,character_id TEXT,timeline_id TEXT,source_hash TEXT,observation_id TEXT);'
 +'CREATE TABLE memory_records(memory_id TEXT,world_profile_id TEXT,character_id TEXT,timeline_id TEXT,content_sha256 TEXT,evidence_ids_json TEXT);'
 +'CREATE TABLE memory_tombstones(world_profile_id TEXT,character_id TEXT,timeline_id TEXT,target_id TEXT,command_id TEXT);'
 +'CREATE TABLE memory_corrections(command_id TEXT,world_profile_id TEXT,character_id TEXT,timeline_id TEXT,target_id TEXT,preferred_text TEXT,content_sha256 TEXT,created_at_utc TEXT,correction_mode TEXT);');
 ensureSuppressionSchema(db);
 const world=id(),timeline=id(),npc=id(),other=id();
 const source={hostRunId:id(),worldEpoch:1,ownerAlias:'nathan',
   incarnationId:id(),encounterId:id(),observerCaptureRef:id()};
 const scope={characterId:npc,worldProfileId:world,timelineId:timeline,protagonistKey:'franklin'};
 let live=true;
 const store={worldProfileId:world,activeTimelineId:timeline,timelineWritable:true,
  verifiedHostContext:{hostRunId:source.hostRunId,worldEpoch:1},
  get:char=>char===npc?{promotion:{ownerAlias:'nathan'}}:null,
  withP2SqliteRead:async(_scope,callback)=>callback(db),
  readM3Coverage:async()=>({status:'unknown',certified:false,evidencePresent:false}),
  readObserverCoverage:async()=>({complete:false}),
  readVerifiedEventEvidence:async()=>null,
  readIntegratedRecall:async()=>({rows:[],coverageComplete:false})};
 const policy=(verifyNativeNegative=null)=>createRecallEvidencePolicy({
  store,verifyNativeNegative,isCurrent:()=>live});
 const add=(content,{characterId=npc,avatar='franklin',speaker='player',
    delivery=speaker==='player'?'accepted':'completed',at=0}={})=>{
   const recordId=id(),committedAtUtc=time(at),src=speaker==='player'?'typed':'npc_generated';
   const envelope={version:1,kind:'dialogue_line',recordId,characterId,
    worldProfileId:world,timelineId:timeline,content,speaker,source:src,delivery,committedAtUtc,
    attribution:{protagonist:avatar},turnIdentityHash:sha(recordId),
    ...(speaker==='npc'?{deliveryReceiptId:id()}:{})};
   const raw=JSON.stringify(envelope);
   db.prepare('INSERT INTO dialogue_journal VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(recordId,world,characterId,timeline,avatar,speaker,src,delivery,content,
      sha(content),raw,sha(raw),committedAtUtc,envelope.turnIdentityHash);
   return envelope;
 };
 return {db,world,timeline,npc,other,source,scope,store,policy,add,
  expire:()=>{live=false;},close:()=>db.close()};
}
function setCert(f,observationId){
 const c={certified:true,nativeVerified:true,status:'did_not_witness',
  observationId,adapterEpoch:id(),sourceReceiptId:id(),...f.source,
  sampledGameTick:100,channel:'visual',basis:'native_awareness'};
 const record={observationId,characterId:f.npc,worldProfileId:f.world,
  timelineId:f.timeline,ownerProof:{...f.source},adapterEpoch:c.adapterEpoch,nativeCoverage:c};
 const range={fromUtc:time(0),toUtc:time(2000)};
 const ledger={complete:true,characterId:f.npc,worldProfileId:f.world,timelineId:f.timeline,
  requested:{...range},gaps:[],windows:[{startUtc:time(-1000),endUtc:time(3000),
   status:'closed',hostRunId:f.source.hostRunId,worldEpoch:1}]};
 f.store.readM3Coverage=async()=>({status:'did_not_witness',certified:true,
  evidencePresent:true,record});
 f.store.readObserverCoverage=async()=>ledger;
 return {c,range,ledger};
}
test('G3 counts 402 authenticated P2 rows across all three avatars, not a 384-item page',async()=>{
 const f=setup();
 try{
  for(let i=0;i<402;i++)f.add('telescope '+i,{avatar:['michael','franklin','trevor'][i%3],at:i});
  const r=await f.policy().countDialogue({scope:f.scope,source:f.source,
   predicate:{containsText:'telescope'}});
  assert.equal(r.status,'complete');assert.equal(r.exactCount,402);
  assert.equal(r.scanned,402);assert.equal(r.first.sourceAvatar,'michael');
  assert.equal(r.last.sourceAvatar,'trevor');
 }finally{f.close();}
});
test('G3 refuses capped, corrupt, revoked and unsupported queries',async()=>{
 const f=setup();
 try{
  f.add('one',{at:1});f.add('two',{at:2});
  assert.equal((await f.policy().countDialogue({scope:f.scope,source:f.source,maxScan:1})).status,'incomplete');
  assert.equal((await f.policy().countDialogue({scope:f.scope,source:f.source,
   predicate:{speaker:'journal_event'}})).exactCount,null);
  f.db.prepare('UPDATE dialogue_journal SET content=? WHERE content=?').run('forged','one');
  assert.equal((await f.policy().countDialogue({scope:f.scope,source:f.source})).reason,'source_integrity_failure');
  f.expire();
  assert.equal((await f.policy().countDialogue({scope:f.scope,source:f.source})).reason,'source_revoked');
 }finally{f.close();}
});
test('G3 source suppression and transcript correction exclude, counterclaim preserves',async()=>{
 const f=setup();
 try{
  const a=f.add('forget',{at:1}),b=f.add('misheard',{at:2}),c=f.add('witnessed',{at:3});
  f.db.prepare('INSERT INTO memory_tombstones VALUES(?,?,?,?,?)')
   .run(f.world,f.npc,f.timeline,a.recordId,id());
  const sql=f.db.prepare('INSERT INTO memory_corrections VALUES(?,?,?,?,?,?,?,?,?)');
  sql.run(id(),f.world,f.npc,f.timeline,b.recordId,'actual',sha('actual'),time(4),'transcript');
  sql.run(id(),f.world,f.npc,f.timeline,c.recordId,'deny',sha('deny'),time(5),'counter_claim');
  const r=await f.policy().countDialogue({scope:f.scope,source:f.source});
  assert.equal(r.exactCount,1);assert.equal(r.best.recordId,c.recordId);
  f.add('other',{characterId:f.other,at:6});
  assert.equal((await f.policy().countDialogue({scope:f.scope,source:f.source})).exactCount,1);
  assert.equal((await f.policy().countDialogue({scope:{...f.scope,timelineId:id()},
   source:f.source})).exactCount,null);
 }finally{f.close();}
});
test('G5 witnessed event requires authentic scoped sidecar, not reported event',async()=>{
 const f=setup(),observationId=id(),recordId=id();
 try{
  const event={recordId,observationId,characterId:f.npc,worldProfileId:f.world,
   timelineId:f.timeline,receiptStatus:'witnessed',receivedAtUtc:time(900),
   ownerProof:{...f.source},sourceHash:sha('event')};
  f.store.readVerifiedEventEvidence=async()=>({event,
   sourceEvidence:{sourceHash:event.sourceHash,observation:{observationId},
    ownerProof:{...f.source}}});
  const input={scope:f.scope,source:f.source,observationId,eventRecordId:recordId,
   fromUtc:time(0),toUtc:time(2000)};
  assert.equal((await f.policy().witness(input)).status,'witnessed');
  event.characterId=f.other;
  assert.notEqual((await f.policy().witness(input)).status,'witnessed');
 }finally{f.close();}
});
test('G5 native event-specific independent verifier required; gaps and spoofed identity disqualify',async()=>{
 const f=setup(),observationId=id();
 try{
  const {range,ledger,c}=setCert(f,observationId);
  const input={scope:f.scope,source:f.source,observationId,...range};
  assert.equal((await f.policy().witness(input)).status,'unknown');
  let calls=0;
  const verify=q=>{calls++;assert.equal(q.observationId,observationId);
   assert.equal(q.fromUtc,range.fromUtc);return true;};
  assert.equal((await f.policy(verify).witness(input)).status,'did_not_witness');
  ledger.gaps.push({kind:'lost_observation',fromUtc:time(400),toUtc:time(500)});
  assert.equal((await f.policy(verify).witness(input)).status,'unknown');assert.equal(calls,1);
  ledger.gaps.length=0;ledger.windows[0].status='open';
  assert.equal((await f.policy(verify).witness(input)).status,'unknown');
  ledger.windows[0].status='closed';ledger.windows[0].hostRunId=id();
  assert.equal((await f.policy(verify).witness(input)).status,'unknown');
  ledger.windows[0].hostRunId=f.source.hostRunId;c.encounterId=id();
  assert.equal((await f.policy(verify).witness(input)).status,'unknown');
 }finally{f.close();}
});
test('G5 native proof resolving after source change produces unavailable',async()=>{
 const f=setup(),observationId=id();
 try{
  const {range}=setCert(f,observationId);
  const policy=f.policy(async()=>{
   f.store.verifiedHostContext={hostRunId:id(),worldEpoch:1};return true;
  });
  const r=await policy.witness({scope:f.scope,source:f.source,observationId,...range});
  assert.equal(r.status,'unavailable');
 }finally{f.close();}
});
test('G4 preserves exact Unicode quotes, source avatar, budget, and rejects forged rows',async()=>{
 const f=setup();
 try{
  const a=f.add('I said "🎯"   ',{avatar:'trevor'});
  const b=f.add('done',{speaker:'npc',at:1});
  const row=x=>({...f.scope,sourceKind:'dialogue_line',recordId:x.recordId,
   protagonistKey:x.attribution.protagonist,evidenceState:'verified',
   atUtc:x.committedAtUtc,envelope:x});
  f.store.readIntegratedRecall=async()=>({rows:[row(a),row(b),
   {...row(a),recordId:id()}],coverageComplete:false});
  const r=await f.policy().labelledEvidence({scope:f.scope,source:f.source,maxBytes:1000});
  assert.equal(r.status,'matched');assert.equal(r.completeness,'bounded_candidate_page');
  assert.equal(r.exactCount,null);assert.equal(r.items[0].content,'I said "🎯"   ');
  assert.equal(r.items[0].sourceAvatar,'trevor');assert.equal(r.items[0].category,'exact_quote');
  assert.equal(r.dropped,1);
  const small=await f.policy().labelledEvidence({scope:f.scope,source:f.source,maxBytes:256});
  assert.ok(small.items.length<=r.items.length);
 }finally{f.close();}
});
