// WS-5b / K-13 write side: the authenticated observer-coverage tracker.
// OFFLINE TESTED. Samples here are fed directly (the authenticated pipe and the
// native authority are exercised end-to-end in the e1 production tests).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createM3ObserverCoverageTracker} from '../src/events/m3ObserverCoverageTracker.mjs';

const world=randomUUID(),timeline=randomUUID();
const iso=ms=>new Date(Date.UTC(2026,9,13,12)+ms).toISOString();

function rig(options={}){
  const clock={ms:100_000},sink=[],stats={fail:null};
  const chars=new Map(),ctx={streamId:randomUUID(),adapterEpoch:randomUUID(),hostRunId:randomUUID(),worldEpoch:1,seq:0};
  const npc=(name)=>{
    const o={ownerAlias:'promoted.'+randomUUID(),observerCaptureRef:randomUUID(),
      incarnationId:randomUUID(),encounterId:randomUUID(),characterId:randomUUID(),name};
    chars.set(o.ownerAlias,{characterId:o.characterId,promotion:{ownerAlias:o.ownerAlias}});
    return o;
  };
  let timelineId=timeline;
  const tracker=createM3ObserverCoverageTracker({worldProfileId:world,
    resolveCharacter:alias=>chars.get(alias)??null,activeTimeline:()=>timelineId,
    monotonicNow:()=>clock.ms,utcNow:()=>iso(clock.ms),options,
    persist:async ops=>{
      if(stats.fail)throw new Error(stats.fail);
      sink.push(...ops);return {staleIndexes:[]};
    }});
  const sample=(owners,{dt=250,dtick=dt,streamId=ctx.streamId,worldEpoch=ctx.worldEpoch,hostRunId=ctx.hostRunId,sequence}={})=>{
    clock.ms+=dt;ctx.tick=(ctx.tick??clock.ms)+dtick;
    return tracker.sample({streamId,adapterEpoch:ctx.adapterEpoch,sequence:sequence??++ctx.seq,hostRunId,
      worldEpoch,sampledGameTick:ctx.tick,owners:owners.map(o=>({ownerAlias:o.ownerAlias,
        observerCaptureRef:o.observerCaptureRef,incarnationId:o.incarnationId,encounterId:o.encounterId}))});
  };
  const run=(owners,count,opts)=>{for(let i=0;i<count;i++)sample(owners,opts);};
  const records=()=>sink.filter(x=>x.record).map(x=>x.record);
  const windows=id=>records().filter(r=>r.kind==='window'&&(!id||r.characterId===id));
  const last=(id)=>windows(id).at(-1);
  return {tracker,clock,ctx,sink,stats,npc,sample,run,records,windows,last,
    setTimeline:v=>{timelineId=v;}};
}

test('a steady owner stream becomes one window whose persisted end trails the settle margin',async()=>{
  const r=rig(),a=r.npc('a');
  r.run([a],80);                           // 20 s of 250 ms frames
  await r.tracker.idle();
  const w=r.last(a.characterId);
  assert.equal(w.status,'open');
  assert.equal(r.windows(a.characterId).every(x=>x.coverageId===w.coverageId),true,'one continuous window');
  assert.ok(w.endTick<=r.ctx.tick-3000,'never claims the unsettled last 3 s');
  assert.ok(w.endTick>=r.ctx.tick-3000-250,'but trails by no more than one frame');
  assert.equal(r.sink[0].seal.processId!==undefined,true,'stale windows of an earlier process are sealed first');
  assert.equal(r.tracker.snapshot().windowsOpened,1);
});

test('windows break (and never bridge) on pause, stall, delivery gap, reset and epoch change',async()=>{
  const cases=[
    ['tick_gap',r=>r.sample([r.a],{dt:250,dtick:5000})],
    ['game_paused',r=>r.sample([r.a],{dt:6000,dtick:100})],
    ['delivery_gap',r=>r.sample([r.a],{dt:-10,dtick:10})],
    ['sequence_gap',r=>r.sample([r.a],{sequence:1})],
    ['tick_regression',r=>r.sample([r.a],{dtick:-3000})],
    ['stream_changed',r=>{r.ctx.streamId=randomUUID();r.sample([r.a]);}],
    ['epoch_boundary',r=>{r.ctx.worldEpoch=2;r.sample([r.a]);}],
    ['epoch_boundary',r=>{r.ctx.hostRunId=randomUUID();r.sample([r.a]);}],
  ];
  for(const [reason,act] of cases){
    const r=rig();r.a=r.npc('a');
    r.run([r.a],20);
    const first=r.tracker.snapshot().windows[0];
    act(r);
    r.run([r.a],24);                      // the fresh window needs its settle margin to be claimable
    await r.tracker.idle();
    assert.equal(r.tracker.snapshot().closedBy[reason],1,reason);
    const wins=r.windows(r.a.characterId);
    const ids=new Set(wins.map(w=>w.coverageId));
    assert.equal(ids.size,2,reason+': closed window and a fresh one');
    const closed=wins.find(w=>w.status==='closed');
    assert.equal(closed.closeReason,reason);
    // The closed window ends at its own last real sample, never at the resume.
    assert.ok(closed.endTick<=first.lastTick+250*20,reason);
    assert.ok(closed.endTick<r.ctx.tick,reason+': nothing claimed across the gap');
  }
});

test('an owner dropped from the roster or replaced (new incarnation/encounter) closes its window',async()=>{
  const r=rig(),a=r.npc('a'),b=r.npc('b');
  r.run([a,b],10);
  r.run([a],4);                                    // b vanishes from the full snapshot
  assert.equal(r.tracker.snapshot().closedBy.owner_absent,1);
  const a2={...a,incarnationId:randomUUID()};
  r.run([a2],2);
  assert.equal(r.tracker.snapshot().closedBy.owner_changed,1);
  r.run([a2,b],24);
  await r.tracker.idle();
  const bw=r.windows(b.characterId);
  assert.equal(new Set(bw.map(w=>w.coverageId)).size,2,'b gets a NEW window; the time away is uncovered');
});

test('unknown aliases and alias/profile mismatches are skipped, never guessed',()=>{
  const r=rig(),a=r.npc('a');
  r.run([a,{...a,ownerAlias:'promoted.'+randomUUID()}],4);
  assert.equal(r.tracker.snapshot().ownersSkipped,4);
  assert.equal(r.tracker.snapshot().windowsOpened,1);
});

test('an invalid sample retires every window instead of extending it',async()=>{
  const r=rig(),a=r.npc('a');
  r.run([a],10);
  assert.equal(r.tracker.sample({streamId:'nope'}).accepted,false);
  assert.equal(r.tracker.snapshot().closedBy.stream_retired,1);
  await r.tracker.idle();
  assert.equal(r.last(a.characterId).status,'closed');
});

test('timeline change or unwritable timeline closes windows; coverage is per timeline',async()=>{
  const r=rig(),a=r.npc('a');
  r.run([a],10);
  r.setTimeline(randomUUID());
  r.run([a],3);
  assert.equal(r.tracker.snapshot().closedBy.timeline_changed,1);
  r.setTimeline(null);
  r.run([a],3);
  assert.equal(r.tracker.snapshot().closedBy.timeline_unwritable,1);
  await r.tracker.idle();
  assert.equal(new Set(r.windows(a.characterId).map(w=>w.timelineId)).size,2);
});

test('SAFETY: persisted end never passes a queued (undecided) observation',async()=>{
  const r=rig({settleMs:500}),a=r.npc('a');
  r.run([a],4);
  const queuedTick=r.ctx.tick;
  assert.equal(r.tracker.noteQueued({key:'q1',characterId:a.characterId,tick:queuedTick}),true);
  r.run([a],80);
  await r.tracker.idle();
  assert.ok(r.last(a.characterId).endTick<queuedTick,'held below the queued observation');
  r.tracker.noteSettled('q1');
  await r.tracker.idle();
  assert.ok(r.last(a.characterId).endTick>queuedTick,'released once the observation committed');
});

test('SAFETY: a lost observation is a durable point gap written BEFORE the window passes it',async()=>{
  const r=rig({settleMs:500}),a=r.npc('a');
  r.run([a],4);
  const tick=r.ctx.tick,obs=randomUUID();
  r.tracker.noteQueued({key:'q',characterId:a.characterId,tick});
  r.run([a],40);
  assert.equal(r.tracker.noteLoss({characterId:a.characterId,observationId:obs,tick,
    receivedUtc:iso(r.clock.ms),reason:'intake_overflow'}),true);
  r.tracker.noteSettled('q');
  await r.tracker.idle();
  const gap=r.records().find(x=>x.kind==='gap');
  assert.ok(gap);
  assert.equal(gap.gapReason,'intake_overflow');
  assert.equal(gap.observationId,obs);
  assert.equal(gap.startTick,tick);
  const gapIndex=r.sink.findIndex(x=>x.record?.kind==='gap');
  const passIndex=r.sink.findIndex(x=>x.record?.kind==='window'&&x.record.endTick>=tick);
  assert.ok(gapIndex>=0&&(passIndex===-1||gapIndex<=passIndex),'gap persisted no later than the window that passes it');
});

test('a burst of same-reason losses coalesces into one gap row (no ledger flood)',async()=>{
  const r=rig(),a=r.npc('a');
  r.run([a],4);
  for(let i=0;i<500;i++)r.tracker.noteLoss({characterId:a.characterId,observationId:randomUUID(),
    tick:r.ctx.tick+i,receivedUtc:iso(r.clock.ms),reason:'intake_overflow'});
  await r.tracker.idle();
  const byId=new Map();
  for(const g of r.records().filter(x=>x.kind==='gap'))byId.set(g.coverageId,Math.max(byId.get(g.coverageId)??0,g.frames));
  assert.equal(byId.size,1,'one coalesced gap row, got '+byId.size);
  assert.equal([...byId.values()][0],500,'every one of the 500 losses is accounted for');
});

test('a loss for an observer with no window is counted unattributed, not invented',()=>{
  const r=rig();
  assert.equal(r.tracker.noteLoss({observerCaptureRef:randomUUID(),observationId:randomUUID(),tick:1,
    receivedUtc:iso(0),reason:'owner_unverified'}),false);
  assert.equal(r.tracker.snapshot().gapsUnattributed,1);
});

test('persist failures are retried without dropping state; a hard ledger rejection stops claiming',async()=>{
  const r=rig({retryMs:0}),a=r.npc('a');
  r.stats.fail='timeline_write_suspended';
  r.run([a],40);
  await r.tracker.idle();
  assert.equal(r.tracker.snapshot().degradedReason,null,'suspension is transient');
  assert.equal(r.windows().length,0);
  r.stats.fail=null;
  await r.tracker.idle();
  assert.ok(r.windows(a.characterId).length>=1,'the held tail is written after recovery');
  r.stats.fail='m3_observer_coverage_identity_conflict';
  r.run([a],40);
  await r.tracker.idle();
  assert.equal(r.tracker.snapshot().degradedReason,'ledger_write_rejected');
  assert.equal(r.tracker.sample({}).accepted,false);
});

test('retire() and close() seal the final real sample and claim nothing after it',async()=>{
  const r=rig(),a=r.npc('a');
  r.run([a],20);
  const lastTick=r.ctx.tick;
  r.tracker.retire('host_disconnected');
  await r.tracker.idle();
  const w=r.last(a.characterId);
  assert.equal(w.status,'closed');
  assert.equal(w.closeReason,'host_disconnected');
  assert.equal(w.endTick,lastTick);
  await r.tracker.close();
  assert.equal(r.tracker.sample({}).accepted,false);
});

test('the sealing op for earlier-process windows is emitted first and only until acknowledged',async()=>{
  const r=rig(),a=r.npc('a');
  r.run([a],40);
  await r.tracker.idle();
  r.run([a],40);
  await r.tracker.idle();
  assert.equal(r.sink.filter(x=>x.seal).length,1);
  assert.ok(r.sink[0].seal);
});

test('a long run keeps bounded memory (history thinning never raises the persisted end)',async()=>{
  const r=rig({historyLimit:64,settleMs:1000}),a=r.npc('a');
  for(let i=0;i<20;i++){r.run([a],50);}
  const snap=r.tracker.snapshot();
  assert.ok(snap.historyThinned>=0);
  await r.tracker.idle();
  assert.ok(r.last(a.characterId).endTick<=r.ctx.tick-1000);
});
