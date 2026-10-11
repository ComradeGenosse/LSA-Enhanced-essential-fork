import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeWitnessedObservation } from '../../lsa-shared-brain/src/events/journalEventNormalizer.mjs';
import { WitnessedEventRecorder, PROMOTION_GRACE_LIMITS } from '../../lsa-shared-brain/src/events/witnessedEventRecorder.mjs';
import { M9NativeEventProducer } from '../../lsa-shared-brain/src/events/m9EventProducers.mjs';
import { validateObservation } from '../src/perception/contracts.mjs';

const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=id(1), B=id(2), WORLD=id(3), TIMELINE=id(4), RUN=id(5), EPOCH=id(6), INCARNATION=id(7),
  ENCOUNTER=id(8), REF=id(9), OTHER=id(10), EPISODE=id(11), SIGNAL=id(12), CLAIM=id(13);
const originalProof={ownerAlias:'owner-123',incarnationId:INCARNATION,encounterId:ENCOUNTER,
  hostRunId:RUN,worldEpoch:4,observerCaptureRef:REF};
const identity=(overrides={})=>({
  promoted:true,current:true,characterId:A,worldProfileId:WORLD,timelineId:TIMELINE,
  adapterEpoch:EPOCH,ownerProof:originalProof,...overrides
});
const observation=(overrides={})=>({
  version:1,observationId:id(14),episodeId:EPISODE,revision:1,
  observer:{captureRef:REF,kind:'ped'},
  observedAt:{nativeRun:EPOCH,gameTick:100,receivedUtc:'2026-10-11T21:45:00.000Z'},
  expiresAtMonotonicMs:123456,eventType:'firing_burst',severity:'routine',
  recognizedCharacterIds:[],claims:[{claimId:CLAIM,kind:'firing',certainty:'supported',
    evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:100},
    source:{captureRef:OTHER,kind:'player'},details:{eventSignalId:SIGNAL,reason:'visual_clear'}}],
  ...overrides
});
function rig({promoted=true,now=1000}={}) {
  let clock=now, writable=true, approval=promoted, actor=A, owner=originalProof, nativeEpoch=EPOCH;
  const entries=new Map(), negative=[];
  const calls=[];
  const authoritative=()=>identity({promoted:approval,characterId:actor,ownerProof:owner,adapterEpoch:nativeEpoch});
  const port={
    append({event,sourceEvidence}){
      if(!writable) throw new Error('unexpected_write');
      assert.equal(event.sourceHash,sourceEvidence.sourceHash);
      const key=[event.characterId,event.timelineId,event.observationId].join(':');
      const prior=entries.get(key);
      if(prior && prior.event.revision>=event.revision)
        return {duplicate:true};
      entries.set(key,{event,sourceEvidence});return {inserted:true};
    },
    recordCoverage(row){negative.push(row);return {inserted:true}}
  };
  const withTimelineWrite=async (line,commit)=>{
    calls.push(line);
    assert.equal(line,TIMELINE);
    if(!writable)throw new Error('timeline_write_suspended');
    const result=commit({mockDb:true},{mockSnapshot:true});
    assert.equal(typeof result?.then,'undefined');
    return result;
  };
  const recorder=new WitnessedEventRecorder({
    now:()=>clock,authorize:({candidate})=>{
      if(candidate?.timelineId!==TIMELINE)return null;
      return authoritative();
    },withTimelineWrite,journalPort:port
  });
  return {recorder,entries,negative,calls,setClock:n=>clock=n,
    setPromoted:n=>approval=n,setActor:n=>actor=n,setProof:n=>owner=n,setEpoch:n=>nativeEpoch=n,setWritable:n=>writable=n};
}
test('M3 contract shape, deterministic id, exact PS2 source hash and immutability',()=>{
  assert.equal(validateObservation(observation()),true); // accepted PS2 v1 shape, not made-up test wire
  const a=normalizeWitnessedObservation({observation:observation(),identity:identity()});
  assert.equal(a.accepted,true);
  assert.equal(a.event.kind,'journal_event');
  assert.equal(a.event.receiptStatus,'witnessed');
  assert.equal(a.event.claims[0].certainty,'direct');
  assert.equal(a.event.claims[0].durableSubject,`unresolved:${CLAIM}`);
  assert.equal(a.event.recordId,normalizeWitnessedObservation({observation:observation(),identity:identity()}).event.recordId);
  assert.equal(Object.isFrozen(a.sourceEvidence.observation.claims[0]),true);
  assert.throws(()=>{a.event.claims[0].kind='invented';},TypeError);
  assert.equal(Object.keys(a.event).sort().join(','),[
    'version','characterId','worldProfileId','timelineId','kind','recordId','observationId',
    'revision','eventType','receivedAtUtc','sourceHash','ownerProof','receiptStatus','claims'
  ].sort().join(','));
});
test('M3 refuses wrong observer, native run, bad modality, missing ownership or leaked epoch',()=>{
  assert.equal(normalizeWitnessedObservation({observation:observation({observer:{captureRef:OTHER,kind:'ped'}}),identity:identity()}).accepted,false);
  assert.equal(normalizeWitnessedObservation({observation:observation({observedAt:{nativeRun:RUN,gameTick:100,receivedUtc:'2026-10-11T21:45:00.000Z'}}),identity:identity()}).accepted,false);
  assert.equal(normalizeWitnessedObservation({observation:observation(),identity:identity({current:false})}).accepted,false);
  assert.equal(normalizeWitnessedObservation({observation:observation(),identity:identity({promoted:false})}).accepted,false);
  assert.equal(normalizeWitnessedObservation({observation:observation(),identity:identity({ownerProof:{...originalProof,worldEpoch:-1}})}).accepted,false);
  const bad=observation();
  bad.claims[0].evidence={channel:'report',basis:'audibility_model',sampledGameTick:100};
  assert.equal(normalizeWitnessedObservation({observation:bad,identity:identity()}).accepted,false);
});
test('M3 only promotes participant identity with matching native epoch and run proof',()=>{
  const expected=`protagonist:franklin`;
  const base={captureRef:OTHER,verified:true,hostRunId:RUN,worldEpoch:4,adapterEpoch:EPOCH,
    subjectKind:'protagonist',subjectKey:'franklin'};
  const yes=normalizeWitnessedObservation({observation:observation(),identity:identity(),participantProofs:[base]});
  assert.equal(yes.event.claims[0].durableSubject,expected);
  const no=normalizeWitnessedObservation({observation:observation(),identity:identity(),participantProofs:[{...base,worldEpoch:3}]});
  assert.equal(no.event.claims[0].durableSubject,`unresolved:${CLAIM}`);
});
test('M3 hearsay remains reported instead of firsthand witnessed',()=>{
  const claim={claimId:CLAIM,kind:'report',certainty:'supported',evidence:{
    channel:'report',basis:'dialogue_report',sampledGameTick:100,reportRef:id(19)}};
  const r=normalizeWitnessedObservation({observation:observation({eventType:'report',claims:[claim]}),identity:identity()});
  assert.equal(r.accepted,true);assert.equal(r.event.receiptStatus,'reported');
  assert.equal(r.event.claims[0].certainty,'reported');
});
test('M3 timeline-fenced synchronous append and idempotent replay',async()=>{
  const r=rig();const first=await r.recorder.capture({observation:observation(),candidate:identity()});
  assert.equal(first.inserted,true);
  assert.equal((await r.recorder.capture({observation:observation(),candidate:identity()})).duplicate,true);
  assert.equal(r.entries.size,1);assert.equal(r.calls.length,2);
  r.setWritable(false);
  await assert.rejects(r.recorder.capture({observation:observation(),candidate:identity()}),/timeline_write_suspended/);
  assert.equal(r.entries.size,1);
});
test('M3 per-character isolation even with identical observation ID',async()=>{
  const r=rig();
  await r.recorder.capture({observation:observation(),candidate:identity()});
  r.setActor(B);
  const rejected=await r.recorder.capture({observation:observation(),candidate:identity()});
  assert.equal(rejected.accepted,false); // old candidate cannot be silently rebound to B
  assert.equal(r.entries.size,1);
  await r.recorder.capture({observation:observation(),candidate:identity({characterId:B})});
  assert.equal(r.entries.size,2);
  const ids=[...r.entries.values()].map(x=>x.event.recordId);
  assert.notEqual(ids[0],ids[1]);
});
test('M3 prepromotion grace cannot borrow another lifetime, epoch or stale physical actor',async()=>{
  const r=rig({promoted:false});
  assert.equal(r.recorder.bufferBeforePromotion({observation:observation(),candidate:identity()}).accepted,true);
  assert.equal(r.recorder.bufferBeforePromotion({observation:observation(),candidate:identity()}).reason,'duplicate_buffer');
  r.setClock(1001);r.setPromoted(true);
  let result=await r.recorder.importOnPromotion({candidate:identity()});
  assert.equal(result.imported,1);assert.equal(r.entries.size,1);
  assert.equal(r.recorder.bufferedCount,0);
  r.setPromoted(false);r.setClock(2000);
  r.recorder.bufferBeforePromotion({observation:observation({observationId:id(20)}),candidate:identity()});
  r.setPromoted(true);r.setActor(B);
  result=await r.recorder.importOnPromotion({candidate:identity({characterId:B})});
  assert.equal(result.imported,1); // must be the freshly authorized promoted ID for this lifetime
  assert.equal(r.entries.size,2);
});
test('M3 grace rejects recycled captureRef, changed incarnation and new native epoch',async()=>{
  const original=observation({observationId:id(71)});
  const r=rig({promoted:false});
  assert.equal(r.recorder.bufferBeforePromotion({observation:original,candidate:identity()}).accepted,true);
  r.setPromoted(true);
  const replacement={...originalProof,incarnationId:id(72)};
  r.setProof(replacement);
  const mismatch=await r.recorder.importOnPromotion({candidate:identity({ownerProof:replacement})});
  assert.equal(mismatch.imported,0);assert.equal(mismatch.rejected,1);
  assert.equal(r.entries.size,0);
  r.setPromoted(false);r.setProof(originalProof);
  assert.equal(r.recorder.bufferBeforePromotion({observation:observation({observationId:id(73)}),candidate:identity()}).accepted,true);
  r.setPromoted(true);r.setEpoch(id(74));
  const changed=await r.recorder.importOnPromotion({candidate:identity({adapterEpoch:id(74)})});
  assert.equal(changed.imported,0);assert.equal(changed.rejected,1);
  assert.equal(r.entries.size,0);
});
test('M3 grace expiry, cold start and negative coverage do not invent witnessed events',async()=>{
  const r=rig({promoted:false});
  r.recorder.bufferBeforePromotion({observation:observation(),candidate:identity()});
  r.setClock(PROMOTION_GRACE_LIMITS.maxAgeMs+1001);r.setPromoted(true);
  assert.equal((await r.recorder.importOnPromotion({candidate:identity()})).imported,0);
  assert.equal(r.entries.size,0);
  assert.equal((await r.recorder.recordNegativeCoverage({candidate:identity(),observationId:id(60),
    status:'did_not_witness',reason:'blocked'})).accepted,true);
  assert.equal(r.entries.size,0);assert.equal(r.negative[0].status,'did_not_witness');
  r.recorder.reset();assert.equal(r.recorder.bufferedCount,0);
});
test('M3 prepromotion ring capacity is bounded under bursts',()=>{
  const r=rig({promoted:false});
  for(let i=0;i<400;i++)r.recorder.bufferBeforePromotion({
    observation:observation({observationId:id(1000+i)}),candidate:identity()
  });
  assert.equal(r.recorder.bufferedCount,PROMOTION_GRACE_LIMITS.maxObservations);
});
function snap(ms,overrides={}){
  return {nativeRun:EPOCH,hostRunId:RUN,worldEpoch:4,playerCaptureRef:OTHER,
    vehicleCaptureRef:id(90),gameTick:ms,sampledAtMs:ms,wantedLevel:0,
    vehicle:{airborne:false,inWater:false,submerged:false,grounded:true,
      rollDegrees:0,speedKph:80,collision:null},outcome:null,...overrides};
}
const source={authenticated:true,adapterEpoch:EPOCH,hostRunId:RUN,worldEpoch:4};
test('M9 detects collision, roll, stunt, water, wanted levels and native Wasted/Busted receipts',()=>{
  let now=2000;const producer=new M9NativeEventProducer({now:()=>now});
  producer.ingest({snapshot:snap(1),source});
  const events=[];
  const run=(ms,overrides)=>{now=ms;const r=producer.ingest({snapshot:snap(ms,overrides),source});
    assert.equal(r.accepted,true);events.push(...r.candidates);};
  run(100,{vehicle:{...snap(100).vehicle,collision:{nativeReceiptId:id(91),speedDeltaKph:30}}});
  run(200,{vehicle:{...snap(200).vehicle,rollDegrees:155}});
  run(300,{vehicle:{...snap(300).vehicle,airborne:true}});
  run(1100,{vehicle:{...snap(1100).vehicle,grounded:true}});
  run(1200,{vehicle:{...snap(1200).vehicle,inWater:true,submerged:true}});
  run(1300,{wantedLevel:3});
  run(1400,{outcome:{kind:'wasted',nativeReceiptId:id(92)}});
  run(1500,{outcome:{kind:'busted',nativeReceiptId:id(93)}});
  const kinds=events.map(e=>e.eventType);
  for(const kind of ['vehicle_crash','vehicle_rollover','airborne_stunt','vehicle_entered_water',
    'vehicle_submerged','wanted_level_changed','wasted','busted']) assert.ok(kinds.includes(kind),kind);
  assert.ok(events.every(e=>e.kind==='m9_candidate' && e.requiresPs2WitnessReceipt));
});
test('M9 refuses fake proof and unverified narratives; initializes without spurious edges',()=>{
  const producer=new M9NativeEventProducer({now:()=>500});
  assert.equal(producer.ingest({snapshot:snap(100),source:{...source,authenticated:false}}).accepted,false);
  const initial=producer.ingest({snapshot:snap(100,{wantedLevel:5}),source});
  assert.deepEqual(initial.candidates,[]);
  const noCrash=producer.ingest({snapshot:snap(200,{wantedLevel:5,vehicle:{...snap(200).vehicle,speedKph:0}}),source});
  assert.deepEqual(noCrash.candidates,[]);
  assert.equal(producer.ingest({snapshot:snap(150),source}).accepted,false);
});
test('M9 re-establishes physics baseline after an unavailable native vehicle snapshot',()=>{
  let now=500;const producer=new M9NativeEventProducer({now:()=>now});
  const first=producer.ingest({snapshot:snap(100,{vehicle:null}),source});
  assert.equal(first.accepted,true);
  const next=producer.ingest({snapshot:snap(200,{vehicle:{...snap(200).vehicle,rollDegrees:160}}),source});
  assert.equal(next.accepted,true);
  assert.deepEqual(next.candidates,[]); // no invented rollover from missing earlier orientation
});
test('M9 suppresses repeated native collision receipts',()=>{
  let now=1000;const producer=new M9NativeEventProducer({now:()=>now});
  producer.ingest({snapshot:snap(100),source});
  const collision={nativeReceiptId:id(99),speedDeltaKph:50};
  const a=producer.ingest({snapshot:snap(200,{vehicle:{...snap(200).vehicle,collision}}),source});
  const b=producer.ingest({snapshot:snap(300,{vehicle:{...snap(300).vehicle,collision}}),source});
  assert.equal(a.candidates.length,1);assert.equal(b.candidates.length,0);
});
