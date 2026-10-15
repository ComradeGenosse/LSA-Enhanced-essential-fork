import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID as id,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {createHarness,worldProfileId,iso} from './m3-production-harness.mjs';
import {memoryKM3Activation} from '../src/memory/m3Activation.mjs';
import {normalizeMemoryKConfig} from '../src/memory/capabilityPolicy.mjs';
import {createM3ProductionMemory} from '../src/memory/m3ProductionMemory.mjs';
import {createP2MemoryStorage} from '../../lsa-shared-brain/src/characters/sqliteProfileStore.mjs';
import {createM5SqliteServices} from '../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';
import {createConversationJournalRecorder} from '../../lsa-shared-brain/src/memory/conversationRecorder.mjs';

const config=(events='on',coverage='on',extra={})=>({memoryK:{capabilities:{
  'ps1.producers':'on','ps2.observations':'on','ps3.salience':'off',
  'memory.dialogue.player':'off','memory.dialogue.npc':'off',
  'memory.events':events,'memory.coverage':coverage,...extra}}});
const harness=async(t,options={})=>{
  const h=await createHarness(t,{config:config(),...options});t.after(()=>h.close());
  await h.connect();return h;
};
const scope=(h,n=h.npcs[0],avatar='franklin')=>({worldProfileId,
  characterId:n.characterId,timelineId:h.timelineId,protagonistKey:avatar});
const sql=(h,fn)=>h.store.withP2SqliteRead(scope(h),fn);

test('G activation preserves legacy and closes invalid dependency combinations',()=>{
  const legacy=memoryKM3Activation({});
  assert.equal(legacy.events.mode,'on');assert.equal(legacy.coverage.mode,'on');
  for(const events of ['off','shadow','on'])for(const coverage of ['off','shadow','on']){
    const a=memoryKM3Activation(config(events,coverage));
    assert.equal(a.events.mode,events);assert.equal(a.coverage.mode,coverage);
  }
  for(const extra of [{'ps1.producers':'off'},{'ps2.observations':'off'},
    {'ps1.producers':'shadow'},{'ps2.observations':'shadow'}]){
    const a=memoryKM3Activation(config('on','on',extra));
    assert.equal(a.events.mode,'off');assert.equal(a.events.reason,'dependency_blocked');
    assert.equal(a.coverage.mode,'on');
  }
  assert.throws(()=>normalizeMemoryKConfig({capabilities:{'memory.events':'active'}}));
  assert.throws(()=>normalizeMemoryKConfig({capabilities:{'memory.madeUp':'on'}}));
});

for(const coverage of ['off','on'])test(`G events on / coverage ${coverage}: durable positive with M2/PS3 off`,async t=>{
  const h=await harness(t,{config:config('on',coverage)}),[a,b]=h.npcs;
  assert.equal(h.client.runtime.salience,null);
  assert.equal(h.m3.operationalStates()['memory.events'].state,'waiting');
  await h.advance(1000);await h.fire([a]);await h.drain();
  const [event]=await h.journal(a);assert.ok(event);
  assert.equal((await h.journal(b)).length,0);
  const proof=await h.evidence(a,event.recordId);
  assert.equal(proof.sourceEvidence.attribution.decision,'D-023');
  assert.equal(event.ownerProof.observerCaptureRef,a.ref);
  // Independent connection is read-only: production still has one P2 writer.
  const reader=new DatabaseSync(h.filePath,{readOnly:true});
  try{assert.equal(reader.prepare('SELECT count(*) AS n FROM event_journal').get().n,1);
    assert.equal(reader.prepare('SELECT count(*) AS n FROM dialogue_journal').get().n,0);
  }finally{reader.close();}
  assert.equal(h.m3.operationalStates()['memory.events'].state,'operational');
  if(coverage==='off'){
    assert.equal(h.m3.snapshot().coverage,null);
    assert.equal(await sql(h,db=>db.prepare('SELECT count(*) AS n FROM m3_observer_coverage').get().n),0);
  }
});

test('G source-only coverage persists native samples and intake-disabled gaps without PS2 or event work',async t=>{
  const h=await harness(t,{config:config('off','on',{'ps1.producers':'off','ps2.observations':'off'})});
  assert.equal(h.client.runtime.correlator,null);assert.equal(h.client.runtime.acceptedObservationTap,null);
  const start=h.clock.ms;await h.advance(12000);await h.fire(h.npcs);await h.drain();
  assert.equal(h.taps.length,0);assert.equal(h.m3.snapshot().offered,undefined);
  assert.equal(h.m3.operationalStates()['memory.events'].effectiveMode,'off');
  assert.equal(h.m3.operationalStates()['memory.coverage'].state,'operational');
  for(const npc of h.npcs){
    assert.equal((await h.journal(npc)).length,0);
    const c=await h.coverageOf(npc,start+500,h.clock.ms-4000);
    assert.equal(c.complete,false);assert.equal(c.windows.length,0);
    assert.ok(c.nativeSamples.length>0);assert.ok(c.gaps.some(g=>g.kind==='event_intake_disabled'));
    assert.ok(c.nativeSamples.every(s=>s.frames>0));
  }
  h.socket.destroy();
  assert.equal(h.m3.operationalStates()['memory.coverage'].state,'blocked');
  const later=await h.coverageOf(h.npcs[0],h.clock.ms+1,h.clock.ms+4000);
  assert.equal(later.complete,false);assert.deepEqual(later.nativeSamples,[]);
});

for(const [events,coverage] of [['shadow','shadow'],['shadow','off'],['off','shadow']])
test(`G shadow validates without durable effects: events ${events}, coverage ${coverage}`,async t=>{
  const h=await harness(t,{config:config(events,coverage)});
  await h.advance(1000);await h.fire([h.npcs[0]]);await h.advance(8000);await h.drain();
  assert.equal((await h.journal(h.npcs[0])).length,0);
  assert.equal(await sql(h,db=>db.prepare('SELECT count(*) AS n FROM m3_observer_coverage').get().n),0);
  assert.equal(h.m3.snapshot().offered,undefined,'no asynchronous event queue');
  if(events==='shadow')assert.equal(h.m3.snapshot().shadow.qualified,1);
  if(coverage==='shadow')assert.ok(h.m3.snapshot().coverage.samples>0);
});

test('G one qualified and one unqualified observer cannot borrow ownership; forged cross-NPC proof is refused',async t=>{
  const h=await harness(t),[a,b]=h.npcs;
  h.state.owners=[a];await h.advance(1000);await h.fire([a,b]);await h.drain();
  assert.equal((await h.journal(a)).length,1);assert.equal((await h.journal(b)).length,0);
  assert.equal(h.m3.snapshot().unattributed,1);
  const forged=structuredClone(h.taps[0]);forged.observation.observer.captureRef=b.ref;
  assert.equal(h.m3.tap(forged).accepted,false);await h.drain();
  assert.equal((await h.journal(b)).length,0);
});

for(const [events,coverage] of [['on','shadow'],['shadow','on']])
test(`G mixed durable/shadow sinks remain independent (${events}/${coverage})`,async t=>{
  const h=await harness(t,{config:config(events,coverage)}),start=h.clock.ms;
  await h.advance(1000);await h.fire(h.npcs);await h.advance(8000);await h.drain();
  assert.equal((await h.journal(h.npcs[0])).length,events==='on'?1:0);
  const count=await sql(h,db=>db.prepare('SELECT count(*) AS n FROM m3_observer_coverage').get().n);
  assert.equal(count>0,coverage==='on');
  const c=await h.coverageOf(h.npcs[0],start+500,h.clock.ms-4000);
  assert.equal(c.complete,false);
  if(coverage==='on')assert.ok(c.gaps.some(g=>g.kind==='event_intake_disabled'));
});

test('G injected authority cannot fabricate native production coverage',async t=>{
  const h=await harness(t,{injectedAuthority:{resolveNativeOwner:()=>null}});
  await h.advance(12000);await h.drain();
  assert.equal(h.m3.snapshot().coverage,null);
  assert.equal(await sql(h,db=>db.prepare('SELECT count(*) AS n FROM m3_observer_coverage').get().n),0);
  assert.equal(h.m3.operationalStates()['memory.coverage'].reason,'injected_authority_has_no_production_coverage');
});

test('G saturation accounts every qualified observation, including replay and retirement',async t=>{
  const held=[],h=await harness(t,{limit:8,scheduler:fn=>held.push(fn)});
  t.after(()=>held.splice(0).forEach(fn=>fn()));
  await h.advance(1000);await h.fire(h.npcs);
  for(let i=0;i<100;i++)assert.equal(typeof h.m3.tap(h.taps[i%2]).accepted,'boolean');
  const before=h.m3.snapshot();assert.equal(before.qualified,102);assert.equal(before.queued,8);
  assert.equal(before.dropped,94);assert.equal(before.lost,94);assert.equal(before.highWater,8);
  h.m3.adapter.retire();held.splice(0).forEach(fn=>fn());await h.drain();
  const s=h.m3.snapshot();assert.equal(s.lost,102);assert.equal(s.retired,8);
  assert.equal(s.committed+s.duplicate+s.stale+s.lost,s.qualified);
  assert.equal((await h.journal(h.npcs[0])).length,0);
});

test('G source retirement after asynchronous admission fences the P2 write',async t=>{
  const held=[],h=await harness(t,{scheduler:fn=>held.push(fn)});
  await h.advance(1000);await h.fire([h.npcs[0]]);
  // Running drain reaches the existing P2 await before the native retirement.
  held.shift()();h.socket.destroy();await h.drain();
  assert.equal(h.m3.snapshot().committed,0);assert.equal(h.m3.snapshot().lost,1);
  assert.equal((await h.journal(h.npcs[0])).length,0);
});

for(const graceful of [false,true])test(`G shutdown freezes coverage while native frames continue (graceful=${graceful})`,async t=>{
  const held=[],h=await harness(t,{scheduler:fn=>held.push(fn)}),start=h.clock.ms;
  await h.advance(10000);await h.m3.adapter.coverageIdle();
  await h.fire([h.npcs[0]]);
  const samples=h.m3.snapshot().coverage.samples,cut=h.clock.ms;
  const closing=graceful?h.m3.close():Promise.resolve(h.m3.adapter.close());
  await h.advance(8000);
  assert.equal(h.m3.snapshot().coverage.samples,samples,'post-stop frames cannot extend coverage');
  assert.equal(h.m3.tap(h.taps[0]).accepted,false);
  held.splice(0).forEach(fn=>fn());await closing;await h.drain();
  assert.equal(h.m3.operationalStates()['memory.events'].state,'stopped');
  assert.equal(h.m3.operationalStates()['memory.coverage'].state,'stopped');
  const c=await h.coverageOf(h.npcs[0],cut+1000,h.clock.ms);
  assert.equal(c.complete,false);assert.equal(c.windows.length,0);assert.deepEqual(c.nativeSamples,[]);
  assert.ok(cut>start);
});

test('G timeline and world transitions retire admitted evidence rather than reattribute it',async t=>{
  const held=[],h=await harness(t,{scheduler:fn=>held.push(fn)});
  await h.advance(1000);await h.fire([h.npcs[0]]);
  const next=await h.store.createTimeline({label:'G next timeline'});
  await h.store.confirmTimeline(next);held.shift()();await h.drain();
  assert.equal(h.m3.snapshot().committed,0);
  await h.store.confirmTimeline(h.timelineId);
  await h.advance(5500);await h.fire([h.npcs[0]]);
  h.send('world_epoch',{epoch:2,reason:'clock_regression'});await h.flush();
  held.splice(0).forEach(fn=>fn());await h.drain();
  assert.equal(h.m3.snapshot().committed,0);assert.equal(h.m3.snapshot().lost,2);
});

test('G forgotten in-flight replay, correction, purge and restart cannot revive event or old sidecar',async t=>{
  const held=[],h=await harness(t,{scheduler:fn=>held.push(fn)}),[a,b]=h.npcs;
  await h.advance(1000);await h.fire([a,b]);held.shift()();await h.drain();
  const [event]=await h.journal(a),receipt=h.taps[0];
  let now=Date.now();
  const privacy=createM5SqliteServices({store:h.store,filePath:h.filePath,authorize:()=>true,
    clock:()=>new Date(now).toISOString()});
  // A reported correction is an overlay, never a rewrite of witnessed facts.
  const command=await createConversationJournalRecorder(h.store).recordPlayerAccepted({characterId:a.characterId,
    identity:{pedId:101,turnId:'g-correction',generationId:'g1',sessionNonce:'g'},
    text:'That was a different incident',source:'typed',attribution:{protagonist:'trevor'}});
  const [line]=await h.store.readDialogueLines({characterId:a.characterId,timelineId:h.timelineId});
  const content='That was a different incident';
  await h.store.commitCommand({scope:scope(h,a,'trevor'),commandId:id(),requestedByLineId:command.recordId,
    operation:'correct',correctionMode:'counter_claim',content,contentHash:createHash('sha256').update(content).digest('hex'),
    evidenceRecordIds:[command.recordId,event.recordId],targetRecordId:event.recordId,requestedAtUtc:line.committedAtUtc});
  assert.equal((await h.evidence(a,event.recordId)).event.sourceHash,event.sourceHash);
  assert.equal(h.m3.tap(receipt).accepted,true);
  await privacy.trash({scope:scope(h,a,'michael'),targetId:event.recordId,operationId:id()});
  held.shift()();await h.drain();assert.equal(h.m3.snapshot().lost,1);
  // Recovery trash retains immutable bytes until purge. The active replay
  // reader must hide them, and a queued duplicate cannot republish them.
  assert.equal((await h.store.readCommittedEvidencePage({scope:scope(h,a,'michael')})).items
    .some(row=>row.recordId===event.recordId),false);
  assert.ok((await h.store.listSuppressedMemoryIds(scope(h,a,'trevor'))).includes(event.recordId));
  assert.equal((await h.journal(b)).length,1,'other NPC retains its independently witnessed event');
  now+=8*86400000;await privacy.purgeExpired({scope:scope(h,a,'trevor')});
  await h.m3.close();await h.store.close();
  const reopened=createP2MemoryStorage({filePath:h.filePath,worldProfileId,sourceRequired:true});
  await reopened.initialize();t.after(()=>reopened.close());
  reopened.setVerifiedHostContext(h.host);await reopened.confirmTimeline(h.timelineId);
  const m3=createM3ProductionMemory({intelligence:h.client,memoryStore:reopened,eventMode:'on',coverageMode:'off',
    authorityOptions:{now:()=>h.clock.ms}});t.after(()=>m3.close());
  h.send('memory_authority',h.authorityPayload(h.clock.ms));await h.flush();
  assert.equal(m3.tap(receipt).accepted,true);await m3.adapter.idle();
  assert.equal(m3.snapshot().committed,0);assert.equal(m3.snapshot().lost,1);
  assert.equal(await reopened.readVerifiedEventEvidence({characterId:a.characterId,timelineId:h.timelineId,recordId:event.recordId}),null);
  assert.ok((await reopened.listSuppressedMemoryIds(scope(h,a,'franklin'))).includes(event.recordId));
});

test('G single-writer contention cannot open a second P2 writer and does not lose admitted events',async t=>{
  const h=await harness(t),other=createP2MemoryStorage({filePath:h.filePath,worldProfileId,sourceRequired:true});
  await assert.rejects(other.initialize(),/sqlite_writer_busy/);
  await other.close();await h.advance(1000);await h.fire(h.npcs);await h.drain();
  for(const npc of h.npcs)assert.equal((await h.journal(npc)).length,1);
  assert.equal(h.m3.snapshot().lost,0);
});

test('G SQLite lock contention happens after bounded intake and preserves durable idempotence',async t=>{
  const h=await harness(t,{config:config('on','off')});
  await h.advance(1000);await h.fire([h.npcs[0]]);await h.drain();
  // Deliberately hostile test connection. Production never opens this writer.
  const child=spawn(process.execPath,['--input-type=module','-e',
    "import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);"+
    "db.exec('BEGIN IMMEDIATE');process.stdout.write('LOCKED\\n');"+
    "setTimeout(()=>{db.exec('ROLLBACK');db.close();},300);",h.filePath],{stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  await new Promise((resolve,reject)=>{child.stdout.once('data',resolve);child.once('error',reject);});
  const before=h.m3.snapshot().duplicate,at=performance.now();
  assert.equal(h.m3.tap(h.taps[0]).queued,true);
  const intakeMs=performance.now()-at;
  assert.equal(h.m3.snapshot().duplicate,before,'tap has not executed SQLite');
  await h.drain();assert.equal(await exited,0);
  assert.equal(h.m3.snapshot().duplicate,before+1);assert.equal(h.m3.snapshot().lost,0);
  assert.equal((await h.journal(h.npcs[0])).length,1);
  t.diagnostic('G_CONTENTION '+JSON.stringify({intakeMs,lockHeldMs:300,lost:0,duplicate:1}));
});

test('G diagnostics contain bounded scalars and no identity or memory content',async t=>{
  const h=await harness(t);await h.advance(1000);await h.fire(h.npcs);await h.drain();
  const states=h.m3.operationalStates(),raw=JSON.stringify(states);
  for(const npc of h.npcs)for(const privateValue of [npc.characterId,npc.ownerAlias,npc.ref])
    assert.equal(raw.includes(privateValue),false);
  for(const row of Object.values(states))for(const count of Object.values(row.counters))
    assert.ok(Number.isSafeInteger(count)&&count>=0&&count<=2147483647);
  t.diagnostic('G_DIAGNOSTICS '+raw);
});

test('G 2500 qualified fan-out attempts with M2/PS3 off preserve exact independent attribution',
  {timeout:600000},async t=>{
  const h=await harness(t,{npcCount:5}),times=[],tap=h.client.runtime.acceptedObservationTap;
  h.client.runtime.acceptedObservationTap=r=>{const at=performance.now(),result=tap(r);times.push(performance.now()-at);return result;};
  const started=performance.now(),start=h.clock.ms;
  for(let i=0;i<500;i++){
    await h.fire(h.npcs);
    if(i%10===0)for(const receipt of h.taps.slice(-5))h.m3.tap(receipt);
    await h.advance(5500);await h.drain();
  }
  await h.advance(8000);await h.drain();
  const s=h.m3.snapshot();assert.equal(s.qualified,2750);assert.equal(s.committed,2500);
  assert.equal(s.duplicate,250);assert.equal(s.lost,0);assert.equal(s.dropped,0);
  assert.equal(s.rejected,0);assert.equal(s.failed,0);assert.ok(s.highWater<=512);
  const records=new Set();
  for(const npc of h.npcs){
    const rows=await h.journal(npc);assert.equal(rows.length,500);
    for(const row of rows){
      assert.equal(row.characterId,npc.characterId);assert.equal(row.ownerProof.observerCaptureRef,npc.ref);
      assert.equal(records.has(row.recordId),false);records.add(row.recordId);
      assert.ok(await h.evidence(npc,row.recordId));
    }
    assert.equal((await h.coverageOf(npc,start+1000,h.clock.ms-4000)).complete,true);
  }
  times.sort((a,b)=>a-b);
  t.diagnostic('G_STRESS '+JSON.stringify({attempts:s.offered,qualified:s.qualified,committed:s.committed,
    duplicates:s.duplicate,rejected:s.rejected,dropped:s.dropped,lost:s.lost,queueHighWater:s.highWater,
    tapP50Ms:times[Math.floor(times.length*.5)],tapP95Ms:times[Math.floor(times.length*.95)],
    tapMaxMs:times.at(-1),elapsedMs:performance.now()-started,ps3Decisions:h.client.runtime.ps3Diagnostics.decisions}));
});
