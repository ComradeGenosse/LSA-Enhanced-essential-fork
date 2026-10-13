// WS-5b: production M3 witnessed-event memory capture, end to end.
// OFFLINE TESTED (simulated native pipe, real everything else). Nothing here is
// a GTA-verified claim; see docs/plans/promoted-npc-memory/memory-k-production/WS-5b-HANDOFF.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createHarness,iso,worldProfileId} from './m3-production-harness.mjs';
import {resolveLivePromotedProfile} from '../src/memory/livePromotedProfile.mjs';
import {createTelemetryRecord,EVENT_NAMES} from '../src/observability/eventContract.mjs';
import {M3ObserverOwnerBinder} from '../../lsa-shared-brain/src/events/m3ObserverOwnerBinder.mjs';
import {verifyM3DerivedEvent} from '../../lsa-shared-brain/src/events/journalEventNormalizer.mjs';

const harness=async(t,options)=>{const h=await createHarness(t,options);t.after(()=>h.close());await h.connect();return h;};
const rowsFor=async(h,npc)=>(await h.journal(npc)).filter(e=>e.eventType==='firing_burst');
const isoTick=ms=>iso(ms);

test('profileForAlias resolves only a live, writable, host-verified promoted profile',async t=>{
  const h=await harness(t,{npcCount:2});
  const [a,b]=h.npcs;
  const resolved=resolveLivePromotedProfile(h.store,a.ownerAlias);
  assert.equal(resolved.characterId,a.characterId);
  assert.equal(resolved.timelineWritable,true);
  assert.equal(resolved.worldEpoch,h.host.worldEpoch);
  assert.equal(Object.hasOwn(resolved,'worldProfileId'),false,'P2 profile rows carry no worldProfileId (K-03(f))');
  assert.notEqual(resolveLivePromotedProfile(h.store,b.ownerAlias).characterId,a.characterId);
  for(const bad of [null,'',`promoted.${randomUUID()}`,'promoted.',42,{}])
    assert.equal(resolveLivePromotedProfile(h.store,bad),null,String(bad));
  // Unconfirmed / suspended timeline: the store is not writable, so no alias resolves.
  const closed={list:()=>h.store.list(),timelineWritable:false,verifiedHostContext:h.host,worldProfileId};
  assert.equal(resolveLivePromotedProfile(closed,a.ownerAlias),null);
  const noHost={list:()=>h.store.list(),timelineWritable:true,verifiedHostContext:null,worldProfileId};
  assert.equal(resolveLivePromotedProfile(noHost,a.ownerAlias),null);
  const duplicate={list:()=>[...h.store.list(),{...h.store.get(a.characterId),characterId:randomUUID()}],
    timelineWritable:true,verifiedHostContext:h.host,worldProfileId};
  assert.equal(resolveLivePromotedProfile(duplicate,a.ownerAlias),null,'ambiguous alias fails closed');
  const retired={list:()=>h.store.list().map(p=>({...p,status:'retired'})),timelineWritable:true,
    verifiedHostContext:h.host,worldProfileId};
  assert.equal(resolveLivePromotedProfile(retired,a.ownerAlias),null);
});

test('a witnessed event is journaled for exactly the witnessing promoted NPC with exact identity',async t=>{
  const h=await harness(t,{npcCount:3});
  const [a,b,c]=h.npcs;
  await h.advance(2000);
  const tick=h.clock.ms;
  await h.fire([a]);
  await h.advance(1000);
  await h.drain();
  const rows=await rowsFor(h,a);
  assert.equal(rows.length,1);
  assert.equal((await rowsFor(h,b)).length,0,'a bystander that did not witness gets nothing');
  assert.equal((await rowsFor(h,c)).length,0);
  const e=rows[0];
  assert.equal(e.characterId,a.characterId);
  assert.equal(e.worldProfileId,worldProfileId);
  assert.equal(e.timelineId,h.timelineId);
  assert.deepEqual(Object.keys(e.ownerProof).sort(),
    ['encounterId','hostRunId','incarnationId','observerCaptureRef','ownerAlias','worldEpoch']);
  assert.deepEqual({...e.ownerProof},{ownerAlias:a.ownerAlias,incarnationId:a.incarnationId,
    encounterId:a.encounterId,hostRunId:h.host.hostRunId,worldEpoch:1,observerCaptureRef:a.ref});
  const proof=await h.evidence(a,e.recordId);
  assert.ok(proof,'verified source-evidence sidecar exists');
  const att=proof.sourceEvidence.attribution;
  assert.equal(att.decision,'D-023');
  assert.equal(att.mode,'observation_time');
  assert.equal(att.observationTick,tick);
  assert.deepEqual({...att.observerIndex},{captureRef:a.ref,incarnationId:a.incarnationId,encounterId:a.encounterId});
  assert.ok(Math.abs(att.ownerFrame.sampledGameTick-tick)<=2000,'owner frame is contemporaneous');
  assert.equal(proof.sourceEvidence.participantProofs[0].subjectKey,'franklin');
  assert.equal(proof.sourceEvidence.participantProofs[0].nativeVerified,true);
  assert.doesNotThrow(()=>verifyM3DerivedEvent(proof.event,proof.sourceEvidence));
  const stats=h.m3.adapter.snapshot();
  assert.equal(stats.committed,1);
  assert.equal(stats.unattributed,0);
  assert.equal(stats.attribution,'observation_time');
});

test('only observers that actually witnessed are recorded; several witnesses each get their own row',async t=>{
  const h=await harness(t,{npcCount:3});
  const [a,b,c]=h.npcs;
  await h.advance(1000);
  await h.fire([a,b]);
  await h.drain();
  assert.equal((await rowsFor(h,a)).length,1);
  assert.equal((await rowsFor(h,b)).length,1);
  assert.equal((await rowsFor(h,c)).length,0);
  const [ra]=await rowsFor(h,a),[rb]=await rowsFor(h,b);
  assert.notEqual(ra.recordId,rb.recordId);
  assert.notEqual(ra.observationId,rb.observationId,'one observation per observer, never shared');
  assert.equal(ra.ownerProof.observerCaptureRef,a.ref);
  assert.equal(rb.ownerProof.observerCaptureRef,b.ref);
});

test('re-offering an already committed observation is idempotent (no duplicate, no new revision)',async t=>{
  const h=await harness(t,{npcCount:1});
  const [a]=h.npcs;
  await h.advance(1000);
  await h.fire([a]);
  await h.drain();
  assert.equal(h.taps.length,1);
  const before=await rowsFor(h,a);
  for(let i=0;i<5;i++)h.m3.tap(h.taps[0]);
  await h.drain();
  const after=await rowsFor(h,a);
  assert.equal(after.length,1);
  assert.deepEqual(after[0],before[0]);
  const s=h.m3.adapter.snapshot();
  assert.equal(s.committed,1);
  assert.equal(s.duplicate,5);
});

test('D-023 negative: an NPC absent from the authenticated owner snapshot is never credited',async t=>{
  const h=await harness(t,{npcCount:2});
  const [a,b]=h.npcs;
  h.state.owners=[a];                       // b falls out of the native full snapshot
  await h.advance(1500);
  await h.fire([a,b]);
  await h.drain();
  assert.equal((await rowsFor(h,a)).length,1);
  assert.equal((await rowsFor(h,b)).length,0);
  assert.equal(h.m3.adapter.snapshot().unattributed,1);
});

test('D-023 negative: native incarnation/encounter disagreeing with the PS observer index writes nothing',async t=>{
  for(const mutate of [
    n=>({...n,incarnationId:randomUUID()}),
    n=>({...n,encounterId:randomUUID()}),
  ]){
    const h=await harness(t,{npcCount:1});
    const [a]=h.npcs;
    h.state.owners=[mutate(a)];
    await h.advance(1500);
    await h.fire([a]);
    await h.drain();
    assert.equal((await rowsFor(h,a)).length,0);
    assert.equal(h.m3.adapter.snapshot().unattributed,1);
  }
});

test('D-023 negative: a different promoted alias on the same capture ref is not trusted',async t=>{
  const h=await harness(t,{npcCount:2});
  const [a,b]=h.npcs;
  // Native says the capture ref belongs to b's alias, PS says it is a's incarnation.
  h.state.owners=[{...a,ownerAlias:b.ownerAlias},b];
  await h.advance(1500);
  await h.fire([a]);
  await h.drain();
  assert.equal((await rowsFor(h,a)).length,0);
  assert.equal((await rowsFor(h,b)).length,0);
});

test('D-023 negative: stale owner evidence (native frames stopped) cannot attribute a later observation',async t=>{
  const h=await harness(t,{npcCount:1});
  const [a]=h.npcs;
  await h.advance(1000);
  await h.advance(4000,{authority:false});     // anchors keep flowing, owner frames do not
  await h.fire([a]);
  await h.drain();
  assert.equal((await rowsFor(h,a)).length,0);
  assert.equal(h.m3.adapter.snapshot().unattributed,1);
});

test('D-023 negative: owner frames for another host run or world epoch are rejected',async t=>{
  for(const [name,patch] of [['host',{hostRunId:randomUUID()}],['epoch',{worldEpoch:7}]]){
    const h=await harness(t,{npcCount:1});
    const [a]=h.npcs;
    h.state.authorityPatch=patch;          // every owner frame now names a foreign run/epoch
    await h.advance(3000);
    await h.fire([a]);
    await h.drain();
    assert.equal((await rowsFor(h,a)).length,0,name);
  }
});

test('D-023 negative: a forged receipt for an observer PS never indexed as owned is dropped',async t=>{
  const h=await harness(t,{npcCount:1});
  const [a]=h.npcs;
  await h.advance(1000);
  const forged={...h.taps[0]??{}};
  const before=h.m3.adapter.snapshot();
  // A receipt object that never passed the authenticated PS2 pipeline.
  const r=h.m3.tap({observation:{observationId:randomUUID(),observer:{captureRef:randomUUID(),kind:'ped'},
    status:'witnessed',sampledGameTick:h.clock.ms},forged:true});
  await h.drain();
  assert.equal((await rowsFor(h,a)).length,0);
  assert.ok(r?.accepted!==true||h.m3.adapter.snapshot().committed===before.committed);
  assert.equal(h.m3.adapter.snapshot().committed,before.committed);
});

test('an observation from an ambient (not promoted) observer is not recorded',async t=>{
  const h=await harness(t,{npcCount:1});
  const [a]=h.npcs;
  const ambient={ref:randomUUID()};
  h.send('anchors',[...h.anchors(),{captureRef:ambient.ref,kind:'ped',observer:true,owned:false}]);
  await h.advance(1000);
  await h.fire([ambient]);
  await h.drain();
  assert.equal((await rowsFor(h,a)).length,0);
  assert.equal(h.m3.adapter.snapshot().committed,0);
});

test('a retired world boundary stops capture: later observations are not recorded for the old binding',async t=>{
  const h=await harness(t,{npcCount:1});
  const [a]=h.npcs;
  await h.advance(1000);
  await h.fire([a]);
  await h.drain();
  assert.equal((await rowsFor(h,a)).length,1);
  h.m3.adapter.retire();
  h.m3.tap(h.taps[0]);
  await h.drain();
  assert.equal((await rowsFor(h,a)).length,1,'retired intake journals nothing new');
});

test('closing production memory flushes coverage and then refuses further capture',async t=>{
  const h=await harness(t,{npcCount:1});
  const [a]=h.npcs;
  await h.advance(8000);
  await h.m3.close();
  const cov=await h.coverageOf(a,h.clock.ms-8000,h.clock.ms);
  assert.ok(cov.windows.length>=1);
  assert.equal(cov.windows.at(-1).status,'closed');
  assert.equal(h.m3.tap({}).accepted===true,false);
});

test('coverage: a continuous owner stream certifies the span; a pause is reported as a gap',async t=>{
  const h=await harness(t,{npcCount:1});
  const [a]=h.npcs;
  const t0=h.clock.ms;
  await h.advance(15_000);
  const midpoint=h.clock.ms;
  await h.advance(10_000,{authority:false});          // game paused / stalled: no owner frames
  const resume=h.clock.ms;
  await h.advance(15_000);
  await h.drain();
  const cov=await h.coverageOf(a,t0+500,h.clock.ms-4000);
  assert.equal(cov.basis,'authenticated_owner_frames');
  assert.equal(cov.complete,false);
  const uncovered=cov.gaps.filter(g=>g.kind==='uncovered');
  assert.equal(uncovered.length,1,JSON.stringify(cov.gaps));
  assert.ok(Date.parse(uncovered[0].fromUtc)<=Date.parse(isoTick(midpoint+1000)),'gap starts at the stall');
  assert.ok(Date.parse(uncovered[0].toUtc)>=Date.parse(isoTick(resume)),'and lasts until frames resume');
  assert.equal(cov.windows.length,2);
  const closed=cov.windows.find(w=>w.status==='closed');
  assert.ok(['game_paused','tick_gap'].includes(closed.closeReason),closed.closeReason);
  // The covered stretch before the stall is certified complete.
  const before=await h.coverageOf(a,t0+500,midpoint-500);
  assert.equal(before.complete,true,JSON.stringify(before.gaps));
  assert.equal(before.gaps.length,0);
});

test('coverage: a lost (overflowed) observation is a durable point gap, never silently covered',async t=>{
  const held=[];
  const h=await createHarness(t,{npcCount:1,limit:1,scheduler:fn=>held.push(fn)});
  t.after(async()=>{held.splice(0).forEach(fn=>fn());await h.close();});await h.connect();
  const [a]=h.npcs;
  await h.advance(1000);
  // Scheduler never runs, so the 1-slot queue is held full; later offers overflow.
  await h.fire([a]);
  await h.advance(6000);
  await h.fire([a]);
  await h.advance(6000);
  await h.fire([a]);
  await h.advance(8000);
  const s=h.m3.adapter.snapshot();
  assert.ok(s.overflow>=1,'overflow happened: '+JSON.stringify(s));
  await h.m3.adapter.coverageIdle();
  const cov=await h.coverageOf(a,h.clock.ms-24_000,h.clock.ms-4000);
  const lost=cov.gaps.filter(g=>g.kind==='lost_observation');
  assert.ok(lost.length>=1,JSON.stringify(cov.gaps));
  assert.equal(cov.complete,false);
  assert.equal((await rowsFor(h,a)).length,0,'the lost observation was not fabricated into a row');
});

test('P2 profile edits do not wipe coverage; removing the character does',async t=>{
  const h=await harness(t,{npcCount:2});
  const [a,b]=h.npcs;
  const t0=h.clock.ms;
  await h.advance(12_000);
  await h.drain();
  const total=async n=>(await h.coverageOf(n,t0,h.clock.ms)).windows.length;
  assert.ok(await total(a)>=1);
  const profile=h.store.get(a.characterId);
  await h.store.edit(a.characterId,{biography:'Edited after capture started'},profile.revision);
  await h.store.edit(b.characterId,{name:'Renamed'},h.store.get(b.characterId).revision);
  assert.ok(await total(a)>=1,'cascade-delete regression (m3_coverage FK)');
  assert.ok(await total(b)>=1);
  // The edit changes the profile revision but alias resolution still works.
  await h.advance(2000);
  await h.fire([a]);
  await h.drain();
  assert.equal((await rowsFor(h,a)).length,1);
  h.m3.adapter.retire();
  await h.store.remove(b.characterId,b.characterId,h.store.get(b.characterId).revision);
  assert.equal((await h.coverageOf(b,t0,h.clock.ms)).windows.length,0,'removal deletes that NPC\'s coverage');
  assert.ok(await total(a)>=1,'other NPCs are untouched');
});

test('losses and coverage diagnostics reach telemetry with registered, sanitizable event names',async t=>{
  const emitted=[];
  const held=[];
  const telemetry={emit:(event,identity,source,data)=>{
    // Exactly what the real telemetry pipeline does with every emitted event.
    const record=createTelemetryRecord({sequence:emitted.length+1,runId:randomUUID(),originMs:0,event,
      identity,source,data});
    emitted.push(record);
  }};
  const h=await createHarness(t,{npcCount:1,limit:1,scheduler:fn=>held.push(fn),telemetry});
  t.after(async()=>{held.splice(0).forEach(fn=>fn());await h.close();});
  await h.connect();
  const [a]=h.npcs;
  await h.advance(1000);
  await h.fire([a]);await h.advance(6000);await h.fire([a]);await h.advance(6000);
  await h.m3.adapter.coverageIdle();
  assert.ok(EVENT_NAMES.has('memory_m3_intake_loss')&&EVENT_NAMES.has('memory_m3_coverage'));
  const loss=emitted.filter(r=>r.event==='memory_m3_intake_loss');
  assert.ok(loss.length>=1,'overflow loss is reported');
  assert.equal(loss[0].data.stage,'overflow');
  assert.ok(emitted.every(r=>r.data&&typeof r.data==='object'));
  const snap=h.m3.snapshot();
  assert.equal(snap.attribution,'observation_time');
  assert.equal(snap.coverage.basis,'authenticated_owner_frames');
});

test('D-023 tickets are single-use, bound to the exact observation and candidate, and cannot be forged',async t=>{
  const h=await harness(t,{npcCount:2});
  const [a,b]=h.npcs;
  await h.advance(1000);
  await h.fire([a]);                              // clock is not advanced: the receipt is still current
  const receipt=h.taps[0];
  const binder=new M3ObserverOwnerBinder({ps2:h.client.runtime,p2:h.store,attribution:'observation_time',
    resolveNativeOwner:input=>h.m3.authority.resolveNativeOwner(input),
    resolveParticipants:input=>h.m3.authority.resolveParticipants(input)});
  const attempt=(args)=>{try{return binder.authorize({stage:'commit',...args});}catch{return null;}};
  const bound=binder.bindAcceptedReceipt(receipt);
  assert.equal(bound.accepted,true);
  assert.equal(bound.candidate.characterId,a.characterId);
  assert.match(bound.candidate.ticketId,/^[0-9a-f-]{36}$/);
  const {observation,candidate}=bound;
  // Forgeries: another character's id, a missing/unknown ticket, a tampered observation.
  assert.ok(!attempt({observation,candidate:{...candidate,characterId:b.characterId}}));
  assert.ok(!attempt({observation,candidate:{...candidate,ticketId:undefined}}));
  assert.ok(!attempt({observation,candidate:{...candidate,ticketId:randomUUID()}}));
  assert.ok(!attempt({observation:{...observation,eventType:'injury'},candidate}));
  // The genuine pair is accepted exactly once.
  const identity=attempt({observation,candidate});
  assert.ok(identity,'genuine ticket authorizes');
  assert.equal(identity.characterId,a.characterId);
  assert.equal(identity.attribution.decision,'D-023');
  assert.ok(!attempt({observation,candidate}),'replay of a consumed ticket is refused');
  // A fresh bind of the same receipt issues a different ticket.
  const again=binder.bindAcceptedReceipt(receipt);
  assert.notEqual(again.candidate.ticketId,candidate.ticketId);
  binder.reset();
  assert.ok(!attempt({observation:again.observation,candidate:again.candidate}),'reset revokes outstanding tickets');
});

test('after a write fence change (profile removed) a queued observation cannot be committed',async t=>{
  const held=[];
  const h=await createHarness(t,{npcCount:1,scheduler:fn=>held.push(fn)});
  t.after(async()=>{held.splice(0).forEach(fn=>fn());await h.close();});
  await h.connect();
  const [a]=h.npcs;
  await h.advance(1000);
  await h.fire([a]);                              // queued, scheduler holds the drain
  assert.equal(h.m3.adapter.snapshot().queued,1);
  await h.store.remove(a.characterId,a.characterId,h.store.get(a.characterId).revision);
  held.splice(0).forEach(fn=>fn());
  await h.m3.adapter.idle();
  assert.equal(h.m3.adapter.snapshot().committed,0,'no row for a character that no longer exists');
});

test('witnessed rows are visible to integrated recall as VERIFIED witness evidence with their attribution',async t=>{
  const h=await harness(t,{npcCount:1});
  const [a]=h.npcs;
  await h.advance(1000);
  await h.fire([a]);
  await h.drain();
  const recall=await h.store.readIntegratedRecall({scope:{characterId:a.characterId,worldProfileId,
    timelineId:h.timelineId,protagonistKey:'franklin'},terms:[]});
  const rows=(recall.records??recall.rows??recall).filter?.(r=>r.sourceKind==='journal_event')??[];
  assert.equal(rows.length,1,JSON.stringify(recall).slice(0,300));
  assert.equal(rows[0].evidenceState,'verified');
});
