// WS-5b: 2,500-event stress through the PRODUCTION adapter chain.
//   authenticated pipe parser -> PS2 runtime/correlator -> native memory authority
//   -> M3 intake/binder/recorder -> P2 SQLite journal + coverage ledger.
// OFFLINE TESTED on a simulated native clock (no GTA, no wall-clock sleeping).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHarness,iso} from './m3-production-harness.mjs';

const SPACING_MS=5500;       // > the correlator's 5 s continuation window: every signal is a distinct observation
const PER_MINUTE_LOG=0;
async function integrity(h,expectedByNpc,{perRowEvidence=true}={}) {
  const seen=new Set(),obs=new Set();
  let total=0;
  for(const npc of h.npcs){
    const rows=await h.journal(npc);
    const want=expectedByNpc.get(npc.characterId)??0;
    assert.equal(rows.length,want,'journal rows for '+npc.ownerAlias);
    total+=rows.length;
    for(const e of rows){
      assert.equal(e.characterId,npc.characterId,'row belongs to its witness');
      assert.equal(e.timelineId,h.timelineId);
      assert.equal(e.ownerProof.ownerAlias,npc.ownerAlias);
      assert.equal(e.ownerProof.observerCaptureRef,npc.ref);
      assert.equal(e.ownerProof.incarnationId,npc.incarnationId);
      assert.equal(e.ownerProof.encounterId,npc.encounterId);
      assert.equal(e.ownerProof.hostRunId,h.host.hostRunId);
      assert.equal(e.ownerProof.worldEpoch,1);
      assert.equal(seen.has(e.recordId),false,'duplicate recordId');
      assert.equal(obs.has(e.observationId),false,'duplicate observationId');
      seen.add(e.recordId);obs.add(e.observationId);
      if(perRowEvidence){
        const proof=await h.evidence(npc,e.recordId);
        assert.ok(proof,'verified evidence for '+e.recordId);
        assert.equal(proof.sourceEvidence.attribution.decision,'D-023');
        assert.equal(proof.sourceEvidence.ownerProof.ownerAlias,npc.ownerAlias);
      }
    }
  }
  return total;
}

test('2,500 single-witness events across 5 promoted NPCs: all persisted once, correctly attributed, coverage unbroken',
    {timeout:600_000},async t=>{
  const N=2500,NPCS=5;
  const h=await createHarness(t,{npcCount:NPCS});
  t.after(()=>h.close());
  await h.connect();
  const t0=h.clock.ms;
  const expected=new Map(h.npcs.map(n=>[n.characterId,0]));
  let reoffered=0;
  await h.advance(1000);
  for(let i=0;i<N;i++){
    const witness=h.npcs[i%NPCS];
    expected.set(witness.characterId,expected.get(witness.characterId)+1);
    await h.fire([witness]);
    // Prompt native re-delivery of the very same receipt (every 10th event).
    if(i%10===0){reoffered++;h.m3.tap(h.taps.at(-1));}
    await h.advance(SPACING_MS);
    if(i%250===249)await h.drain();
  }
  await h.advance(8000);        // settle margin so the final events are inside certified coverage
  await h.drain();
  void PER_MINUTE_LOG;

  const s=h.m3.adapter.snapshot();
  assert.equal(h.taps.length,N,'every PS2-accepted observation reached the tap exactly once');
  assert.equal(s.offered,N+reoffered);
  assert.equal(s.committed,N,'re-delivered receipts never create a second row');
  assert.equal(s.duplicate,reoffered);
  for(const k of ['stale','rejected','unattributed','overflow','tooLarge','failed','retired','waiting'])
    assert.equal(s[k],0,k+': '+JSON.stringify({...s,coverage:null}));
  assert.ok(s.highWater<=512,'bounded queue high-water '+s.highWater);
  assert.equal(await integrity(h,expected),N);

  // Coverage: one unbroken window per NPC, certified complete across every event.
  const cs=s.coverage;
  assert.equal(cs.windowsOpened,NPCS);
  assert.equal(cs.windowsClosed,0,JSON.stringify(cs.closedBy));
  assert.equal(cs.gapsRecorded,0);
  assert.equal(cs.persistFailures,0);
  assert.equal(cs.degraded,false);
  assert.equal(cs.pending,0);
  assert.equal(cs.unpersistedGaps,0);
  for(const npc of h.npcs){
    const cov=await h.coverageOf(npc,t0+1000,h.clock.ms-4000);
    assert.equal(cov.complete,true,npc.ownerAlias+' '+JSON.stringify(cov.gaps));
    assert.equal(cov.windows.length,1);
    assert.equal(cov.gaps.length,0);
  }

  // A much later re-delivery is NOT re-attributed from stale owner frames (D-023 is
  // observation-time): fail closed, no new row, no fabricated loss inside covered time.
  const gapsBefore=h.m3.adapter.snapshot().coverage.gapsRecorded;
  for(const r of h.taps.slice(0,50))h.m3.tap(r);
  await h.drain();
  const late=h.m3.adapter.snapshot();
  assert.equal(late.committed,N);
  assert.equal(late.unattributed,50);
  assert.equal(await integrity(h,expected,{perRowEvidence:false}),N);
  assert.equal(late.coverage.gapsRecorded,gapsBefore+50,'refusals are accounted for, never silently dropped');
});

test('2,500 observations from 500 signals each witnessed by 5 NPCs at once (burst fan-out)',
    {timeout:600_000},async t=>{
  const SIGNALS=500,NPCS=5;
  const h=await createHarness(t,{npcCount:NPCS});
  t.after(()=>h.close());
  await h.connect();
  const t0=h.clock.ms;
  await h.advance(1000);
  for(let i=0;i<SIGNALS;i++){
    await h.fire(h.npcs);
    await h.advance(SPACING_MS);
    if(i%100===99)await h.drain();
  }
  await h.advance(8000);
  await h.drain();
  const N=SIGNALS*NPCS;
  const s=h.m3.adapter.snapshot();
  assert.equal(h.taps.length,N);
  assert.equal(s.committed,N);
  for(const k of ['duplicate','stale','rejected','unattributed','overflow','failed','retired'])
    assert.equal(s[k],0,k);
  const expected=new Map(h.npcs.map(n=>[n.characterId,SIGNALS]));
  assert.equal(await integrity(h,expected,{perRowEvidence:false}),N);
  // Observations of the SAME signal by different NPCs are separate, never merged or shared.
  const [a,b]=h.npcs;
  const [ra]=await h.journal(a,1),[rb]=await h.journal(b,1);
  assert.notEqual(ra.recordId,rb.recordId);
  assert.equal(ra.ownerProof.observerCaptureRef,a.ref);
  assert.equal(rb.ownerProof.observerCaptureRef,b.ref);
  for(const npc of h.npcs){
    const cov=await h.coverageOf(npc,t0+1000,h.clock.ms-4000);
    assert.equal(cov.complete,true,JSON.stringify(cov.gaps));
  }
});

test('a pause in the middle of a long run is a durable gap; events before and after it are still exact',
    {timeout:600_000},async t=>{
  const h=await createHarness(t,{npcCount:2});
  t.after(()=>h.close());
  await h.connect();
  const [a,b]=h.npcs;
  const t0=h.clock.ms;
  await h.advance(1000);
  for(let i=0;i<40;i++){await h.fire([a]);await h.advance(SPACING_MS);}
  const pauseStart=h.clock.ms;
  await h.advance(30_000,{authority:false});           // paused: no owner frames
  const pauseEnd=h.clock.ms;
  await h.advance(500);                                // owner frames resume before the next observation
  for(let i=0;i<40;i++){await h.fire([a,b]);await h.advance(SPACING_MS);}
  await h.advance(8000);
  await h.drain();
  assert.equal((await h.journal(a)).length,80);
  assert.equal((await h.journal(b)).length,40);
  const cov=await h.coverageOf(a,t0+1000,h.clock.ms-4000);
  assert.equal(cov.complete,false);
  const un=cov.gaps.filter(g=>g.kind==='uncovered');
  assert.equal(un.length,1,JSON.stringify(cov.gaps));
  assert.ok(Date.parse(un[0].fromUtc)<=Date.parse(iso(pauseStart+1000)));
  assert.ok(Date.parse(un[0].toUtc)>=Date.parse(iso(pauseEnd)));
  // b only existed (as a covered owner) after the pause for its events; its pre-pause span is
  // covered too (it was a native owner the whole time) but nothing was witnessed by it then.
  const before=await h.coverageOf(b,t0+1000,pauseStart-3000);
  assert.equal(before.complete,true,JSON.stringify(before.gaps));
  assert.equal((await h.journal(b)).every(e=>Date.parse(e.receivedAtUtc)>=Date.parse(iso(pauseEnd))),true,
    'b has no events from before the pause (it never witnessed any)');
});
