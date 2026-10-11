import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M9NativeEventProducer } from '../../lsa-shared-brain/src/events/m9EventProducers.mjs';
import { M9MemoryCueCandidates, M9_CUE_LIMITS } from '../../lsa-shared-brain/src/events/m9MemoryCues.mjs';

const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const run=id(1),epoch=id(2),player=id(3),vehicle=id(4);
const charA=id(5),charB=id(6),world=id(7),timeline=id(8);
const source={authenticated:true,adapterEpoch:epoch,hostRunId:run,
  worldEpoch:1,playerCaptureRef:player};
const vehicleState=(o={})=>({
  airborne:false,grounded:true,submerged:false,inWater:false,
  rollDegrees:0,speedKph:70,collision:null,...o
});
const sample=(t,o={})=>({
  nativeRun:epoch,hostRunId:run,worldEpoch:1,playerCaptureRef:player,
  vehicleCaptureRef:vehicle,gameTick:t,sampledAtMs:t,
  wantedLevel:0,vehicle:vehicleState(),outcome:null,...o
});
function detector(initialNow=1000,verifySource=()=>true) {
  let now=initialNow;
  const instance=new M9NativeEventProducer({now:()=>now,verifySource});
  return {instance,setNow:value=>now=value,run:(ms,props={})=>{
    now=ms;
    return instance.ingest({snapshot:sample(ms,props),source});
  }};
}
const allSafe={known:true,playerIdle:true,micIdle:true,
  interruptionFree:true,directorAvailable:true,ownerCurrent:true,
  timelineWritable:true};
const qualified=(event,characterId=charA)=>({
  status:'witnessed',modality:'visual',certainty:'direct',
  candidateEventId:event.eventId,observationId:id(11),
  witnessReceiptId:id(12),journalRecordId:id(13),
  characterId,worldProfileId:world,timelineId:timeline,
  playerCaptureRef:player,protagonistKey:'unknown',
  observerCaptureRef:id(characterId===charA?14:15),
  nativeRun:epoch,hostRunId:run,worldEpoch:1
});
function accident() {
  const d=detector();
  d.run(100);
  const x=d.run(200,{vehicle:vehicleState({
    collision:{sourceType:'damage_tracker_vehicle_collision',
      damage:55,nativeReceiptId:id(30)}
  })});
  assert.equal(x.accepted,true);
  assert.equal(x.candidates.length,1);
  return x.candidates[0];
}
test('M9 callback-backed collision carries severity but no invented speed',()=>{
  const e=accident();
  assert.equal(e.eventType,'vehicle_crash');
  assert.equal(e.evidence.basis,'native_damage_tracker_collision');
  assert.equal(e.evidence.impactDamage,55);
  assert.equal(e.evidence.speedDeltaKph,null);
  assert.equal(e.requiresPs2WitnessReceipt,true);
  assert.match(e.eventId,/^[0-9a-f-]{36}$/);
  assert.ok(Object.isFrozen(e));
});
test('M9 rejects collision-free speed dips and under-threshold classified damage',()=>{
  const d=detector();d.run(100);
  assert.deepEqual(d.run(200,{vehicle:vehicleState({speedKph:0})}).candidates,[]);
  assert.deepEqual(d.run(300,{vehicle:vehicleState({
    collision:{sourceType:'damage_tracker_vehicle_collision',damage:34,nativeReceiptId:id(40)}
  })}).candidates,[]);
  assert.equal(d.run(400,{vehicle:vehicleState({
    collision:{sourceType:'damage_tracker_vehicle_collision',damage:35,nativeReceiptId:id(41)}
  })}).candidates.length,1);
});
test('M9 stable event IDs survive producer replay and dedupe same callback receipt',()=>{
  const d=detector();d.run(100);
  const collision=vehicleState({collision:{nativeReceiptId:id(42),sourceType:'native_collision_callback',speedDeltaKph:21}});
  const a=d.run(200,{vehicle:collision}).candidates;
  assert.equal(a.length,1);
  assert.deepEqual(d.run(300,{vehicle:collision}).candidates,[]);
  d.instance.reset();d.run(100);
  const again=d.run(200,{vehicle:collision}).candidates;
  assert.equal(again[0].eventId,a[0].eventId);
});
test('M9 resets physics on sparse samples and vehicle incarnation changes',()=>{
  const d=detector();d.run(100);
  const s=d.run(200,{vehicle:vehicleState({airborne:true})});
  assert.deepEqual(s.candidates,[]);
  assert.deepEqual(d.run(1900,{vehicle:vehicleState({grounded:true})}).candidates,[]);
  d.run(2000,{vehicle:vehicleState({rollDegrees:0})});
  assert.deepEqual(d.run(2100,{vehicleCaptureRef:id(77),
    vehicle:vehicleState({rollDegrees:155})}).candidates,[]);
  assert.deepEqual(d.run(2200,{vehicleCaptureRef:id(77),
    vehicle:vehicleState({rollDegrees:170})}).candidates,[]);
});
test('M9 retains wrap-safe native tick order and refuses regressions',()=>{
  let now=250;
  const p=new M9NativeEventProducer({now:()=>now,verifySource:()=>true});
  const base=sample(100,{gameTick:0xfffffffe});
  assert.equal(p.ingest({snapshot:base,source}).accepted,true);
  const wrapped=sample(200,{gameTick:2,wantedLevel:2});
  assert.equal(p.ingest({snapshot:wrapped,source}).accepted,true);
  assert.equal(p.ingest({snapshot:sample(201,{gameTick:1}),source}).accepted,false);
});
test('M9 rejects stale, unauthenticated and mismatched owner epoch/source callback',()=>{
  const d=detector(1000,({source:s})=>s.playerCaptureRef===player);
  assert.equal(d.instance.ingest({snapshot:sample(100),source:{
    ...source,playerCaptureRef:id(99)}}).accepted,false);
  assert.equal(d.instance.ingest({snapshot:sample(100),source:{
    ...source,worldEpoch:2}}).accepted,false);
  assert.equal(d.instance.ingest({snapshot:sample(100),source:{
    ...source,authenticated:false}}).accepted,false);
  d.setNow(10000);
  assert.equal(d.instance.ingest({snapshot:sample(100),source}).accepted,false);
});
test('M9 outcome claims require distinct native receipt IDs',()=>{
  const d=detector();d.run(100);
  const a=d.run(200,{outcome:{kind:'wasted',nativeReceiptId:id(51)}});
  const b=d.run(300,{outcome:{kind:'wasted',nativeReceiptId:id(51)}});
  const c=d.run(400,{outcome:{kind:'busted',nativeReceiptId:id(52)}});
  assert.deepEqual(a.candidates.map(e=>e.eventType),['wasted']);
  assert.deepEqual(b.candidates,[]);
  assert.deepEqual(c.candidates.map(e=>e.eventType),['busted']);
});
test('M9 never promotes a raw accident or reported hearing into a memory cue',()=>{
  const e=accident();
  const cues=new M9MemoryCueCandidates({authorizeWitness:()=>true,now:()=>1000});
  assert.equal(cues.propose({candidate:e,priority:allSafe}).accepted,false);
  assert.equal(cues.propose({candidate:e,witness:{
    ...qualified(e),status:'reported',modality:'report'
  },priority:allSafe}).accepted,false);
  assert.equal(cues.propose({candidate:e,witness:{
    ...qualified(e),candidateEventId:id(100)
  },priority:allSafe}).accepted,false);
});
test('M9 requires actual PS2 owner-proof authorization at proposal time',()=>{
  const e=accident();
  const cues=new M9MemoryCueCandidates({authorizeWitness:()=>false,now:()=>1000});
  assert.equal(cues.propose({candidate:e,witness:qualified(e),priority:allSafe}).reason,
    'witness_not_authorized');
  const throwing=new M9MemoryCueCandidates({authorizeWitness:()=>{throw Error('stale');},
    now:()=>1000});
  assert.equal(throwing.propose({candidate:e,witness:qualified(e),
    priority:allSafe}).accepted,false);
});
test('M9 cues yield to active player speech, interrupted turns and unknown Director state',()=>{
  const e=accident();
  const cues=new M9MemoryCueCandidates({authorizeWitness:()=>true,now:()=>1000});
  for(const key of ['known','micIdle','playerIdle','interruptionFree',
    'directorAvailable','ownerCurrent','timelineWritable']) {
    assert.equal(cues.propose({candidate:e,witness:qualified(e),
      priority:{...allSafe,[key]:false}}).accepted,false,key);
  }
  assert.equal(cues.propose({candidate:e,witness:qualified(e),priority:allSafe}).accepted,true);
});
test('M9 emits an inert immutable candidate, never text or automatic PS6 admission',()=>{
  const e=accident();
  const cues=new M9MemoryCueCandidates({authorizeWitness:()=>true,now:()=>1000});
  const r=cues.propose({candidate:e,witness:qualified(e),priority:allSafe});
  assert.equal(r.accepted,true);
  assert.equal(r.cue.requiresDirectorAdmission,true);
  assert.equal(r.cue.spokenText,null);
  assert.equal(r.cue.characterId,charA);
  assert.ok(Object.isFrozen(r.cue));
  assert.equal(cues.propose({candidate:e,witness:qualified(e),priority:allSafe}).reason,
    'duplicate_candidate');
});
test('M9 keeps separate promoted observers isolated for one accident',()=>{
  const e=accident();
  let reads=[];
  const cues=new M9MemoryCueCandidates({authorizeWitness:({witness})=>{
    reads.push(witness.characterId);return true;},now:()=>1000});
  const a=cues.propose({candidate:e,witness:qualified(e,charA),priority:allSafe});
  const b=cues.propose({candidate:e,witness:qualified(e,charB),priority:allSafe});
  assert.equal(a.accepted,true);
  assert.equal(b.accepted,true);
  assert.notEqual(a.cue.cueId,b.cue.cueId);
  assert.deepEqual(reads,[charA,charB]);
});
test('M9 per-NPC cooldown defers another accident but does not forge a memory',()=>{
  const e=accident();
  let now=1000;
  const cues=new M9MemoryCueCandidates({authorizeWitness:()=>true,now:()=>now});
  assert.equal(cues.propose({candidate:e,witness:qualified(e),priority:allSafe}).accepted,true);
  const next={...e,eventId:id(81),observedAtMonotonicMs:1100};
  now=1100;
  assert.equal(cues.propose({candidate:next,witness:qualified(next),
    priority:allSafe}).reason,'cooldown');
  now=700000;
  const late={...next,eventId:id(82),observedAtMonotonicMs:699900};
  assert.equal(cues.propose({candidate:late,witness:qualified(late),
    priority:allSafe}).accepted,true);
});
test('M9 timeline switch resets cooldown and rejects old-scoped evidence',()=>{
  const e=accident();
  const cues=new M9MemoryCueCandidates({authorizeWitness:({witness})=>
    witness.timelineId===timeline,now:()=>1000});
  assert.equal(cues.propose({candidate:e,witness:qualified(e),priority:allSafe}).accepted,true);
  const newCandidate={...e,eventId:id(83)};
  const foreign={...qualified(newCandidate),timelineId:id(84)};
  assert.equal(cues.propose({candidate:newCandidate,witness:foreign,
    priority:allSafe}).accepted,false);
});

test('M9 10k callback burst preserves event IDs and bounded candidate output',()=>{
  const d=detector();
  d.run(100);
  const observed=new Set();
  for(let i=0;i<10000;i++) {
    const ms=200+i;
    const receipt=id(10000+i);
    const one=d.run(ms,{vehicle:vehicleState({
      collision:{sourceType:'damage_tracker_vehicle_collision',
        damage:50,nativeReceiptId:receipt}
    })});
    assert.equal(one.accepted,true);
    assert.equal(one.candidates.length,1);
    assert.equal(one.candidates[0].kind,'m9_candidate');
    assert.ok(!observed.has(one.candidates[0].eventId));
    observed.add(one.candidates[0].eventId);
  }
  assert.equal(observed.size,10000);
});
test('M9 cue refuses cross-player capture and unsupported protagonist',()=>{
  const e=accident();
  const cues=new M9MemoryCueCandidates({authorizeWitness:()=>true,now:()=>1000});
  assert.equal(cues.propose({candidate:e,witness:{
    ...qualified(e),playerCaptureRef:id(220)
  },priority:allSafe}).accepted,false);
  assert.equal(cues.propose({candidate:e,witness:{
    ...qualified(e),protagonistKey:'guessed_person'
  },priority:allSafe}).accepted,false);
});
test('M9 cue rejects expired source and never refreshes it during interruption',()=>{
  const e=accident();
  const cues=new M9MemoryCueCandidates({authorizeWitness:()=>true,now:()=>40000});
  assert.equal(cues.propose({candidate:e,witness:qualified(e),priority:allSafe}).reason,
    'stale_candidate');
});

test('M9 refuses unspecified and unknown witness modality despite direct label',()=>{
  const e=accident();
  const cues=new M9MemoryCueCandidates({authorizeWitness:()=>true,now:()=>1000});
  for(const modality of [undefined,'unknown','report']) {
    const witness={...qualified(e),modality};
    assert.equal(cues.propose({candidate:e,witness,priority:allSafe}).accepted,false);
  }
});

test('M9 refuses native-shaped JSON without an independent verifier',()=>{
  assert.throws(()=>new M9NativeEventProducer(),/verified_native_source_port_required/);
  const p=new M9NativeEventProducer({now:()=>100,verifySource:()=>false});
  assert.equal(p.ingest({snapshot:sample(100),source}).accepted,false);
});
test('M9 partial native proof cannot imply motion, rollover, water or wanted edges',()=>{
  const d=detector();
  const unknown=vehicleState({airborne:null,grounded:null,inWater:null,
    submerged:null,rollDegrees:null,speedKph:null});
  d.run(100,{wantedLevel:null,vehicle:unknown});
  assert.deepEqual(d.run(200,{wantedLevel:null,vehicle:unknown}).candidates,[]);
  assert.equal(d.run(300,{wantedLevel:null,vehicle:{...unknown,collision:{
    sourceType:'damage_tracker_vehicle_collision',damage:50,nativeReceiptId:id(68)
  }}}).candidates[0]?.eventType,'vehicle_crash');
});
test('M9 high-speed label requires source proved speed before collision',()=>{
  const d=detector();d.run(100);
  const missing=d.run(200,{vehicle:vehicleState({collision:{
    sourceType:'native_collision_callback',nativeReceiptId:id(69),speedDeltaKph:25
  }})}).candidates[0];
  assert.equal(missing.evidence.severity,'significant_delta');
  const proven=d.run(300,{vehicle:vehicleState({collision:{
    sourceType:'native_collision_callback',nativeReceiptId:id(70),
    speedDeltaKph:25,speedBeforeKph:105
  }})}).candidates[0];
  assert.equal(proven.evidence.severity,'high_speed_verified');
});
test('M9 minimum cue cooldown is ten minutes',()=>{
  assert.ok(M9_CUE_LIMITS.perCharacterCooldownMs>=600000);
});
