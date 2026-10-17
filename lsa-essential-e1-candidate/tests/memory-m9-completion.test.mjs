import { test } from 'node:test';
import assert from 'node:assert/strict';
import { M9NativeEventProducer } from '../../lsa-shared-brain/src/events/m9EventProducers.mjs';
import { M9MemoryCueCandidates, M9_CUE_LIMITS } from '../../lsa-shared-brain/src/events/m9MemoryCues.mjs';
import { M9Ps2CandidateBridge } from '../../lsa-shared-brain/src/events/m9Ps2CandidateBridge.mjs';
import { M9DirectorCueAdmission } from '../src/perception/m9DirectorCueAdmission.mjs';

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
  typedIdle:true,combatIdle:true,stockIdle:true,
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

const ps3=(observer=id(14),observationId=id(11))=>({
  observation:{observer:{kind:'ped',captureRef:observer},
    observationId,revision:1,eventType:'vehicle_impact',expiresAtMonotonicMs:1500,
    claims:[{certainty:'supported',evidence:{channel:'visual'}}]},
  decision:{observationId,revision:1,decisionKey:'genuine-ps3-decision',
    policyVersion:1,response:'eligible',expiresAtMonotonicMs:1500},
  situation:{lifetimeCurrent:true,channelHealthy:true,
    perceptionSupported:true,playerCaptureRef:player},
  entitlementCurrent:true,observedAtMonotonicMs:990
});
const ps6Facts=(observer=id(14))=>({
  nowMonotonicMs:1000,speakerCaptureRef:observer,playerCaptureRef:player
});
const safePs6={...allSafe,typedIdle:true,combatIdle:true,stockIdle:true};
function ps6Harness({original=true,priority=safePs6,delivery='delivered',
  registration=true,authorize=()=>true,
  committed=()=>({authorized:true})}={}) {
  const calls={attempt:0,registered:0,unregistered:0};
  const cues=new M9MemoryCueCandidates({authorizeWitness:authorize,now:()=>1000});
  const existingSceneDirector={
    originalGrantCurrent:()=>original,
    attempt:async()=>{calls.attempt++;return {status:delivery};}
  };
  const adapter=new M9DirectorCueAdmission({cueCandidates:cues,
    existingSceneDirector,readCurrentPriority:()=>priority,
    committedWitnessAuthority:{check:committed},
    registerPs4MemoryCue:({cue})=>{
      calls.registered++;
      return registration?{status:'registered',cueId:cue.cueId,
        unregister:()=>calls.unregistered++}:null;
    }
  });
  return {adapter,calls,cues};
}
test('M9 PS2 bridge only enqueues source-checked candidates, not memories',()=>{
  const e=accident();
  let received=null;
  const intake=new M9Ps2CandidateBridge({
    verifyNativeCandidate:({candidate,nativeReceipt})=>
      candidate.eventId===e.eventId && nativeReceipt?.fromOwnerFiber===true,
    submitForPs2Qualification:envelope=>{
      received=envelope;
      return {status:'accepted_for_qualification',
        candidateEventId:envelope.candidateEventId};
    },now:()=>1000
  });
  assert.equal(intake.submit({candidate:e}).reason,'native_event_unverified');
  assert.equal(received,null);
  const admitted=intake.submit({candidate:e,
    nativeReceipt:{fromOwnerFiber:true}});
  assert.equal(admitted.status,'pending_ps2_witness_qualification');
  assert.equal(received.type,'m9.ps2_qualification_request');
  assert.equal(received.observers,null);
  assert.equal(received.coverage,'unknown');
  assert.equal(received.memoryCommitted,false);
  assert.equal(intake.submit({candidate:e,
    nativeReceipt:{fromOwnerFiber:true}}).reason,'duplicate_candidate');
  intake.reset();
  assert.equal(intake.submit({candidate:e,
    nativeReceipt:{fromOwnerFiber:true}}).accepted,true);
});
test('M9 PS2 bridge rejects unsupported v1 PS2 wire and fake grants',()=>{
  const e=accident();
  let send=()=>({status:'unsupported'});
  const b=new M9Ps2CandidateBridge({verifyNativeCandidate:()=>true,
    submitForPs2Qualification:x=>send(x),now:()=>1000});
  assert.equal(b.submit({candidate:e}).reason,'ps2_qualification_unavailable');
  send=x=>({status:'accepted_for_qualification',candidateEventId:x.candidateEventId,
    grantsWitness:true});
  assert.equal(b.submit({candidate:e}).accepted,false);
  send=x=>({status:'accepted_for_qualification',candidateEventId:x.candidateEventId,
    memoryCommitted:true});
  assert.equal(b.submit({candidate:e}).accepted,false);
});
test('M9 PS6 cues only enter an already entitled original stock Director turn',async()=>{
  const e=accident(),w=qualified(e),h=ps6Harness();
  const result=await h.adapter.attempt({candidate:e,witness:w,
    ps3Candidates:[ps3()],facts:ps6Facts(),stamp:{}});
  assert.equal(result.status,'director_submitted_audio_unverified');
  assert.equal(result.requiresVerifiedPs4Receipt,true);
  assert.equal(result.requiresNativePlaybackCompletionReceipt,true);
  assert.equal(h.calls.attempt,1);
  assert.equal(h.calls.registered,1);
  assert.equal(h.calls.unregistered,1);
});
test('M9 PS6 cannot invent an original PS3 entitlement or PS4 memory',async()=>{
  const e=accident(),w=qualified(e);
  for (const setting of [{original:false},{registration:false}]) {
    const h=ps6Harness(setting);
    const r=await h.adapter.attempt({candidate:e,witness:w,
      ps3Candidates:[ps3()],facts:ps6Facts(),stamp:{}});
    assert.notEqual(r.status,'director_submitted_audio_unverified');
    assert.equal(h.calls.attempt,0);
  }
  const h=ps6Harness();
  assert.equal((await h.adapter.attempt({candidate:e,witness:w,
    ps3Candidates:[],facts:ps6Facts(),stamp:{}})).status,
    'missing_original_ps3_source');
  assert.equal(h.calls.attempt,0);
});
test('M9 PS6 unrelated spectator without durable witnessed proof is never eligible',async()=>{
  const e=accident();
  const h=ps6Harness({authorize:({witness})=>witness.characterId===charA});
  const spectator=qualified(e,charB);
  const outcome=await h.adapter.attempt({candidate:e,witness:spectator,
    ps3Candidates:[ps3(id(15))],facts:ps6Facts(id(15)),stamp:{}});
  assert.equal(outcome.status,'cue_refused');
  assert.equal(h.calls.attempt,0);
});
test('M9 PS6 mic, typed player input, combat, stock turn and unknown veto',async()=>{
  const e=accident(),w=qualified(e);
  for(const key of ['known','micIdle','typedIdle','combatIdle','stockIdle',
    'interruptionFree','playerIdle']) {
    const h=ps6Harness({priority:{...safePs6,[key]:false}});
    const result=await h.adapter.attempt({candidate:e,witness:w,
      ps3Candidates:[ps3()],facts:ps6Facts(),stamp:{}});
    assert.equal(result.status,'player_or_combat_priority',key);
    assert.equal(h.calls.attempt,0);
  }
});
test('M9 PS6 native Director lease refusal and interrupted sound cannot claim playback',async()=>{
  const e=accident(),w=qualified(e);
  for(const delivery of ['not_admitted','not_delivered']) {
    const h=ps6Harness({delivery});
    const result=await h.adapter.attempt({candidate:e,witness:w,
      ps3Candidates:[ps3()],facts:ps6Facts(),stamp:{}});
    assert.equal(result.status,'director_not_delivered');
    assert.equal(result.directorStatus,delivery);
    assert.equal(h.calls.unregistered,1);
  }
});
test('M9 PS6 cooldown is not reset by another event and survives rejected replay',async()=>{
  const e=accident(),h=ps6Harness(),w=qualified(e);
  assert.equal((await h.adapter.attempt({candidate:e,witness:w,
    ps3Candidates:[ps3()],facts:ps6Facts(),stamp:{}})).status,
    'director_submitted_audio_unverified');
  const next={...e,eventId:id(88)};
  const result=await h.adapter.attempt({candidate:next,
    witness:qualified(next),ps3Candidates:[ps3()],facts:ps6Facts(),stamp:{}});
  assert.equal(result.status,'cue_refused');
  assert.equal(result.reason,'cooldown');
  assert.equal(h.calls.attempt,1);
});
test('M9 PS6 rejects forged original observer, missing witness and stale PS3',async()=>{
  const e=accident(),h=ps6Harness(),w=qualified(e);
  assert.equal((await h.adapter.attempt({candidate:e,witness:w,
    ps3Candidates:[ps3(id(15))],facts:ps6Facts(id(15)),stamp:{}})).status,
    'original_ps3_not_eligible');
  assert.equal((await h.adapter.attempt({candidate:e,
    ps3Candidates:[ps3()],facts:ps6Facts(),stamp:{}})).status,
    'missing_original_ps3_source');
  assert.equal((await h.adapter.attempt({candidate:e,witness:w,
    ps3Candidates:[ps3()],facts:{...ps6Facts(),nowMonotonicMs:1501},
    stamp:{}})).status,'original_ps3_not_eligible');
});

test('M9 cannot produce an invented rollover edge after unknown orientation',()=>{
  const d=detector();
  d.run(100,{vehicle:vehicleState({rollDegrees:null})});
  assert.deepEqual(d.run(200,{vehicle:vehicleState({rollDegrees:160})}).candidates,[]);
  assert.deepEqual(d.run(300,{vehicle:vehicleState({rollDegrees:165})}).candidates,[]);
  d.run(400,{vehicle:vehicleState({rollDegrees:30})});
  assert.deepEqual(d.run(500,{vehicle:vehicleState({rollDegrees:160})}).candidates.map(x=>x.eventType),
    ['vehicle_rollover']);
});

test('M9 emits only proved positive roll, airborne landing and water edges',()=>{
  const d=detector();
  d.run(100);
  const roll=d.run(200,{vehicle:vehicleState({rollDegrees:150})});
  assert.deepEqual(roll.candidates.map(x=>x.eventType),['vehicle_rollover']);
  assert.deepEqual(d.run(300,{vehicle:vehicleState({rollDegrees:155})}).candidates,[]);
  d.run(400,{vehicle:vehicleState({airborne:true,grounded:false})});
  const land=d.run(1100,{vehicle:vehicleState({airborne:false,grounded:true})});
  assert.deepEqual(land.candidates.map(x=>x.eventType),['airborne_stunt']);
  assert.equal(land.candidates[0].evidence.airborneMs,700);
  assert.deepEqual(d.run(1200,{vehicle:vehicleState({inWater:true,submerged:false})})
    .candidates.map(x=>x.eventType),['vehicle_entered_water']);
  assert.deepEqual(d.run(1300,{vehicle:vehicleState({inWater:true,submerged:true})})
    .candidates.map(x=>x.eventType),['vehicle_submerged']);
  assert.deepEqual(d.run(1400,{vehicle:vehicleState({inWater:true,submerged:true})})
    .candidates,[]);
});
test('M9 wanted-level changes require two proven adjacent samples, not repeats',()=>{
  const d=detector();
  d.run(100,{wantedLevel:null});
  assert.deepEqual(d.run(200,{wantedLevel:2}).candidates,[]);
  assert.deepEqual(d.run(300,{wantedLevel:2}).candidates,[]);
  assert.deepEqual(d.run(400,{wantedLevel:3}).candidates.map(x=>x.eventType),
    ['wanted_level_changed']);
  assert.deepEqual(d.run(500,{wantedLevel:3}).candidates,[]);
  assert.deepEqual(d.run(600,{wantedLevel:null}).candidates,[]);
  assert.deepEqual(d.run(700,{wantedLevel:0}).candidates,[]);
  assert.deepEqual(d.run(800,{wantedLevel:2}).candidates.map(x=>x.eventType),
    ['wanted_level_changed']);
});
test('M9 host/epoch restart cannot join old samples into an event',()=>{
  const d=detector();
  d.run(100,{wantedLevel:0});
  const nextSource={...source,hostRunId:id(301),adapterEpoch:id(302),worldEpoch:2};
  d.setNow(200);
  const first=d.instance.ingest({snapshot:sample(200,{
    hostRunId:nextSource.hostRunId,nativeRun:nextSource.adapterEpoch,
    worldEpoch:2,wantedLevel:4}),source:nextSource});
  assert.equal(first.accepted,true);
  assert.deepEqual(first.candidates,[]);
  d.setNow(300);
  const second=d.instance.ingest({snapshot:sample(300,{
    hostRunId:nextSource.hostRunId,nativeRun:nextSource.adapterEpoch,
    worldEpoch:2,wantedLevel:5}),source:nextSource});
  assert.deepEqual(second.candidates.map(x=>x.eventType),['wanted_level_changed']);
});
test('M9 cues preserve unknown protagonist rather than inferring one',()=>{
  const e=accident(),w=qualified(e);
  const c=new M9MemoryCueCandidates({authorizeWitness:()=>true,now:()=>1000})
    .propose({candidate:e,witness:w,priority:allSafe});
  assert.equal(c.accepted,true);
  assert.equal(c.cue.protagonistKey,'unknown');
  assert.equal(c.cue.spokenText,null);
});


test('W08 original Director refuses missing or stale committed PS2/P2 source',async()=>{
  const e=accident(),w=qualified(e);
  const absent=ps6Harness({committed:()=>({authorized:false})});
  assert.equal((await absent.adapter.attempt({candidate:e,witness:w,
    ps3Candidates:[ps3()],facts:ps6Facts(),stamp:{}})).status,
    'committed_m9_witness_unverified');
  assert.equal(absent.calls.attempt,0);
  let checked=0;
  const expired=ps6Harness({committed:()=>({authorized:++checked<3})});
  const result=await expired.adapter.attempt({candidate:e,witness:w,
    ps3Candidates:[ps3()],facts:ps6Facts(),stamp:{}});
  assert.equal(result.status,'priority_or_original_grant_changed');
  assert.equal(expired.calls.unregistered,1);
  assert.equal(expired.calls.attempt,0);
});
test('W08 Director submission is not an audible-dialogue completion',async()=>{
  const e=accident(),w=qualified(e),h=ps6Harness();
  const r=await h.adapter.attempt({candidate:e,witness:w,
    ps3Candidates:[ps3()],facts:ps6Facts(),stamp:{}});
  assert.equal(r.status,'director_submitted_audio_unverified');
  assert.equal(r.requiresNativePlaybackCompletionReceipt,true);
  assert.equal(r.spokenText,undefined);
});
