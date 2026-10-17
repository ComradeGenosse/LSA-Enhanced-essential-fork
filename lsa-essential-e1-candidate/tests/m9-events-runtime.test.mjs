import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createM9Harness,ALL_ON} from './m9-harness.mjs';

const crash = (damage=60,id=randomUUID()) => ({nativeReceiptId:id,sourceType:'damage_tracker_vehicle_collision',damage});

async function boot(t,options={}) {
  const h = await createM9Harness(t,options);
  t.after(()=>h.close());
  await h.connect();
  await h.sample(100);              // baseline sample (no edge can come from it)
  await h.settle();
  return h;
}

test('witnessed crash is journaled once for the witness only, with unknown detail left unknown',async t=>{
  const h = await boot(t);
  const [a,b] = h.npcs;
  const receiptId = randomUUID();
  await h.sample(100,tick=>({vehicle:h.vehicleState({collision:crash(60,receiptId)}),
    witnessReceipts:[h.witness(a,tick)]}));
  await h.settle();
  const rowsA = await h.rows(a), rowsB = await h.rows(b);
  assert.equal(rowsA.length,1);
  assert.equal(rowsA[0].eventType,'vehicle_crash');
  assert.equal(rowsA[0].receiptStatus,'witnessed');
  assert.equal(rowsB.length,0,'no cross-NPC leakage: B had no native witness receipt');
  const claim = rowsA[0].claims[0];
  assert.equal(claim.kind,'incident');
  assert.equal(claim.modality,'visual');
  assert.equal(claim.certainty,'direct');
  assert.match(claim.durableSubject,/^(protagonist:franklin|unresolved:)/);
  const sidecar = await h.evidence(a,rowsA[0].recordId);
  const observation = sidecar.observation ?? sidecar.sourceEvidence?.observation;
  assert.ok(observation,'verified sidecar carries the PS2 observation');
  assert.equal(JSON.stringify(observation).includes('speedDelta'),false,'no invented speed');
  const snap = h.m9Events.snapshot();
  assert.equal(snap.byType.vehicle_crash,1);
  assert.equal(snap.counters.observations,1);
});

test('same native collision receipt in later samples never journals twice',async t=>{
  const h = await boot(t);
  const [a] = h.npcs;
  const col = crash(70);
  for (let i=0;i<4;i++) await h.sample(100,tick=>({vehicle:h.vehicleState({collision:col}),
    witnessReceipts:[h.witness(a,tick)]}));
  await h.settle();
  assert.equal((await h.rows(a)).length,1);
});

test('no witness receipt means unknown: nothing is journaled and no negative is inferred',async t=>{
  const h = await boot(t);
  await h.sample(100,{vehicle:h.vehicleState({collision:crash()}),witnessReceipts:[]});
  await h.settle();
  for (const npc of h.npcs) assert.equal((await h.rows(npc)).length,0);
  assert.equal(h.m9Events.snapshot().counters.ps2Unqualified,1);
  const coverage = await h.coverageOf(h.npcs[0],0,h.clock.ms+1);
  assert.equal(JSON.stringify(coverage).includes('did_not_witness'),false);
});

test('witness receipt from a different tick does not qualify an observer',async t=>{
  const h = await boot(t);
  const [a] = h.npcs;
  await h.sample(100,tick=>({vehicle:h.vehicleState({collision:crash()}),
    witnessReceipts:[h.witness(a,tick)].map(r=>r)}));
  await h.settle();
  assert.equal((await h.rows(a)).length,1,'control: matching tick journals');
  const b = h.npcs[1];
  await h.sample(100,tick=>({vehicle:h.vehicleState({collision:crash()}),
    witnessReceipts:[{...h.witness(b,tick-50),sampledGameTick:tick-50,
      evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:tick-50}}]}));
  await h.settle();
  assert.equal((await h.rows(b)).length,0);
});

test('reported/dialogue receipts can never create a firsthand M9 memory',async t=>{
  const h = await boot(t);
  const [a] = h.npcs;
  await h.sample(100,tick=>({vehicle:h.vehicleState({collision:crash()}),
    witnessReceipts:[{observer:{captureRef:a.ref,kind:'ped'},status:'reported',sampledGameTick:tick,
      reason:'dialogue_report',evidence:{channel:'report',basis:'dialogue_report',sampledGameTick:tick,
        reportRef:randomUUID()}}]}));
  await h.settle();
  assert.equal((await h.rows(a)).length,0);
});

test('family off drops the event; shadow classifies but never reaches PS2 or SQLite',async t=>{
  const h = await boot(t,{families:{'events.crash':'shadow','events.wasted':'on'}});
  const [a] = h.npcs;
  await h.sample(100,tick=>({vehicle:h.vehicleState({collision:crash()}),witnessReceipts:[h.witness(a,tick)]}));
  await h.sample(100,tick=>({outcome:{kind:'wasted',nativeReceiptId:randomUUID()},witnessReceipts:[h.witness(a,tick)]}));
  await h.settle();
  const rows = await h.rows(a);
  assert.deepEqual(rows.map(r=>r.eventType),['wasted']);
  const snap = h.m9Events.snapshot();
  assert.equal(snap.counters.shadowOnly,1);
  assert.equal(snap.byType.vehicle_crash,1);
});

test('rollover needs two contiguous samples; a gap is not a continuous rollover',async t=>{
  const h = await boot(t);
  const [a] = h.npcs;
  await h.sample(100,tick=>({vehicle:h.vehicleState({rollDegrees:170}),witnessReceipts:[h.witness(a,tick)]}));
  await h.settle();
  // Baseline was 0 deg: a first sample at 170 deg is an edge from the prior sample.
  assert.equal((await h.rows(a)).filter(r=>r.eventType==='vehicle_rollover').length,1);
  // Gap larger than the classifier's contiguity window: no edge from the stale prior.
  await h.sample(100,tick=>({vehicle:h.vehicleState({rollDegrees:20}),witnessReceipts:[h.witness(a,tick)]}));
  await h.sample(2000,tick=>({vehicle:h.vehicleState({rollDegrees:170}),witnessReceipts:[h.witness(a,tick)]}));
  await h.settle();
  assert.equal((await h.rows(a)).filter(r=>r.eventType==='vehicle_rollover').length,1);
});

test('wanted-level edge, wasted and busted journal as distinct source-qualified events',async t=>{
  const h = await boot(t);
  const [a] = h.npcs;
  await h.sample(100,tick=>({wantedLevel:2,witnessReceipts:[h.witness(a,tick)]}));
  await h.sample(100,tick=>({wantedLevel:2,outcome:{kind:'busted',nativeReceiptId:randomUUID()},witnessReceipts:[h.witness(a,tick)]}));
  await h.sample(100,tick=>({wantedLevel:0,outcome:{kind:'wasted',nativeReceiptId:randomUUID()},witnessReceipts:[h.witness(a,tick)]}));
  await h.settle();
  const types = (await h.rows(a)).map(r=>r.eventType).sort();
  assert.deepEqual(types,['busted','wanted_level_changed','wanted_level_changed','wasted']);
});

test('airborne landing and water entry require native state edges',async t=>{
  const h = await boot(t);
  const [a] = h.npcs;
  const w = tick => [h.witness(a,tick)];
  await h.sample(100,tick=>({vehicle:h.vehicleState({airborne:true,grounded:false}),witnessReceipts:w(tick)}));
  await h.sample(800,tick=>({vehicle:h.vehicleState({airborne:false,grounded:true}),witnessReceipts:w(tick)}));
  await h.sample(100,tick=>({vehicle:h.vehicleState({inWater:true}),witnessReceipts:w(tick)}));
  await h.settle();
  const types = (await h.rows(a)).map(r=>r.eventType).sort();
  assert.deepEqual(types,['airborne_stunt','vehicle_entered_water']);
});

test('M9 samples are ignored unless the native peer negotiated m9SampleVersion',async t=>{
  const h = await boot(t,{negotiate:false});
  const [a] = h.npcs;
  await h.sample(100,tick=>({vehicle:h.vehicleState({collision:crash()}),witnessReceipts:[h.witness(a,tick)]}));
  await h.settle();
  assert.equal((await h.rows(a)).length,0);
  assert.equal(h.m9Events.snapshot().counters.samples,0);
});

test('wrong host run or stale world epoch samples are ignored without breaking the stream',async t=>{
  const h = await boot(t);
  const [a] = h.npcs;
  await h.sample(100,tick=>({hostRunId:randomUUID(),vehicle:h.vehicleState({collision:crash()}),witnessReceipts:[h.witness(a,tick)]}));
  await h.sample(100,tick=>({worldEpoch:h.host.worldEpoch+5,vehicle:h.vehicleState({collision:crash()}),witnessReceipts:[h.witness(a,tick)]}));
  await h.settle();
  assert.equal((await h.rows(a)).length,0);
  // Stream continues: a correct sample after the bad ones still works.
  await h.sample(100,tick=>({vehicle:h.vehicleState({collision:crash()}),witnessReceipts:[h.witness(a,tick)]}));
  await h.settle();
  assert.equal((await h.rows(a)).length,1);
});

test('events require M3 memory.events: with the recorder off nothing is written',async t=>{
  const {memoryKM3Activation} = await import('../src/memory/m3Activation.mjs');
  const config = {memoryK:{capabilities:{...ALL_ON,'ps1.producers':'on','ps2.observations':'on',
    'memory.events':'off'}}};
  const h = await createM9Harness(t,{config});
  t.after(()=>h.close());
  assert.equal(memoryKM3Activation(config).events.mode,'off');
  await h.connect();
  await h.sample(100);
  await h.sample(100,tick=>({vehicle:h.vehicleState({collision:crash()}),witnessReceipts:[h.witness(h.npcs[0],tick)]}));
  await h.settle();
  assert.equal((await h.rows(h.npcs[0])).length,0);
});

test('activation: M9 is never legacy-on and blocks on missing upstream in explicit maps',async()=>{
  const {memoryKM9Activation} = await import('../src/memory/m9Activation.mjs');
  assert.equal(memoryKM9Activation({}).anyEvent,false);
  assert.equal(memoryKM9Activation({memoryK:{capabilities:{}}}).requested,false);
  const legacy = memoryKM9Activation({memoryK:{capabilities:{'events.crash':'on'}}});
  assert.equal(legacy.explicit,false);
  assert.equal(legacy.families['events.crash'].mode,'on');
  const explicitBlocked = memoryKM9Activation({memoryK:{capabilities:{'events.crash':'on','memory.dialogue.player':'on'}}});
  assert.equal(explicitBlocked.explicit,true);
  assert.equal(explicitBlocked.families['events.crash'].mode,'off');
  assert.equal(explicitBlocked.families['events.crash'].reason,'dependency_blocked');
  assert.equal(memoryKM9Activation({memoryK:{capabilities:{'events.crash':'on','ps1.producers':'on',
    'ps2.observations':'on','memory.dialogue.player':'on'}}}).families['events.crash'].mode,'on');
  assert.deepEqual(Object.keys(ALL_ON).length,7);
});
