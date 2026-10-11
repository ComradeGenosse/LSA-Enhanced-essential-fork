import {test} from 'node:test';
import {IntelligenceClient} from '../src/perception/intelligenceClient.mjs';
import assert from 'node:assert/strict';
import {M3ObserverOwnerBinder} from '../../lsa-shared-brain/src/events/m3ObserverOwnerBinder.mjs';
import {M3BoundedIntake} from '../../lsa-shared-brain/src/events/m3BoundedIntake.mjs';
import {WitnessedEventRecorder} from '../../lsa-shared-brain/src/events/witnessedEventRecorder.mjs';
import {normalizeWitnessedObservation,verifyM3DerivedEvent} from '../../lsa-shared-brain/src/events/journalEventNormalizer.mjs';
import {ensureM3CoverageSchema,appendM3Coverage,readM3Coverage} from '../../lsa-shared-brain/src/events/m3CoverageSqlite.mjs';
const id=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const WORLD=id(1),LINE=id(2),EPOCH=id(3),HOST=id(4),A=id(5),B=id(6),
  OA=id(7),OB=id(8),AP=id(9),BP=id(10),INC_A=id(11),INC_B=id(12),
  ENC_A=id(13),ENC_B=id(14),PLAYER=id(15),OBS=id(16),EP=id(17),CLAIM=id(18);
const alias=n=>'promoted.'+n;
const owner=(ref,character,inc,enc)=>Object.freeze({ownerAlias:alias(character),
  incarnationId:inc,encounterId:enc,hostRunId:HOST,worldEpoch:2,observerCaptureRef:ref});
const proofs=new Map([[OA,owner(OA,A,INC_A,ENC_A)],[OB,owner(OB,B,INC_B,ENC_B)]]);
function observed(ref=OA,changes={}){
  return {version:1,observationId:OBS,episodeId:EP,revision:1,
    observer:{captureRef:ref,kind:'ped'},
    observedAt:{nativeRun:EPOCH,gameTick:100,receivedUtc:'2026-10-11T21:00:00.000Z'},
    expiresAtMonotonicMs:120000,eventType:'firing_burst',severity:'routine',
    recognizedCharacterIds:[],claims:[{
      claimId:CLAIM,kind:'firing',certainty:'supported',
      evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:100},
      source:{captureRef:PLAYER,kind:'player'},
      details:{eventSignalId:id(19),reason:'visual_clear'}
    }],...changes};
}
function fixture({secondWitness=false,pre=false,participants=false}={}){
  const entries=new Map(),obsA=observed(),obsB=observed(OB);
  entries.set(`${OA}:${EP}`,{value:obsA});
  if(secondWitness)entries.set(`${OB}:${EP}`,{value:obsB});
  const anchors=new Map([[OA,{observer:true,owned:true,kind:'ped'}],
    [OB,{observer:true,owned:true,kind:'ped'}],[PLAYER,{observer:false,kind:'player'}]]);
  const observerIndex=new Map([[OA,{captureRef:OA,kind:'ped',owned:true,incarnationId:INC_A,encounterId:ENC_A}],
    [OB,{captureRef:OB,kind:'ped',owned:true,incarnationId:INC_B,encounterId:ENC_B}]]);
  const ps2={epoch:EPOCH,hostContext:{hostRunId:HOST,worldEpoch:2},
    observations:{entries},anchors,observerIndex,current:ref=>anchors.has(ref)};
  const p2={worldProfileId:WORLD,activeTimelineId:LINE,timelineWritable:true,
    verifiedHostContext:{hostRunId:HOST,worldEpoch:2},
    snapshot:{profiles:pre?[]:[{characterId:A,promotion:{ownerAlias:alias(A)},status:'available'},
      {characterId:B,promotion:{ownerAlias:alias(B)},status:'available'}]}};
  const resolveNativeOwner=({observerCaptureRef,adapterEpoch,observedGameTick})=>{
    const proof=proofs.get(observerCaptureRef);
    return proof?{current:true,nativeVerified:true,promoted:true,characterId:observerCaptureRef===OA?A:B,
      ownerAlias:proof.ownerAlias,ownerProof:proof,
      sourceAtObservation:{nativeVerified:true,gameTick:observedGameTick,adapterEpoch,
        hostRunId:HOST,worldEpoch:2,observerCaptureRef,
        ownerAlias:proof.ownerAlias,incarnationId:proof.incarnationId,
        encounterId:proof.encounterId}}:null;
  };
  const binder=new M3ObserverOwnerBinder({ps2,p2,resolveNativeOwner,
    ...(participants?{resolveParticipants:()=>[{captureRef:PLAYER,subjectKind:'protagonist',
      subjectKey:'franklin',verified:true,nativeVerified:true,hostRunId:HOST,worldEpoch:2,adapterEpoch:EPOCH}]}:{})});
  const receipt=observation=>({observation,adapterEpoch:EPOCH,hostRunId:HOST,worldEpoch:2,
    observerIndex:observerIndex.get(observation.observer.captureRef)});
  return {ps2,p2,binder,receipt,obsA,obsB,resolveNativeOwner};
}
test('two observers: only native-witnessed A binds; no B contamination',()=>{
  const x=fixture();
  const a=x.binder.bindAcceptedReceipt(x.receipt(x.obsA));
  const b=x.binder.bindAcceptedReceipt(x.receipt(x.obsB));
  assert.equal(a.accepted,true);assert.equal(b.accepted,false);
  const i=x.binder.authorize({observation:a.observation,candidate:a.candidate,stage:'commit'});
  assert.equal(i.characterId,A);
  const normalized=normalizeWitnessedObservation({observation:a.observation,identity:i});
  assert.equal(normalized.accepted,true);
  assert.equal(normalized.event.claims[0].durableSubject,`unresolved:${CLAIM}`);
  assert.equal(verifyM3DerivedEvent(normalized.event,normalized.sourceEvidence).valid,true);
  assert.equal(verifyM3DerivedEvent({...normalized.event,eventType:'vehicle_impact'},
    normalized.sourceEvidence).valid,false);
  assert.equal(verifyM3DerivedEvent({...normalized.event,claims:[{...normalized.event.claims[0],
    certainty:'direct',durableSubject:'protagonist:franklin'}]},normalized.sourceEvidence).valid,false);
  assert.equal(x.binder.authorize({observation:x.obsA,candidate:{...a.candidate,characterId:B},
    stage:'commit'}),null);
});
test('protagonist is proven only by checked source-backed native resolver',()=>{
  const x=fixture({participants:true});
  const a=x.binder.bindAcceptedReceipt(x.receipt(x.obsA));
  const i=x.binder.authorize({observation:a.observation,candidate:a.candidate,stage:'commit'});
  const n=normalizeWitnessedObservation({observation:a.observation,identity:i,
    participantProofs:i.participantProofs});
  assert.equal(n.event.claims[0].durableSubject,'protagonist:franklin');
  x.ps2.anchors.delete(PLAYER);
  assert.equal(x.binder.authorize({observation:a.observation,candidate:a.candidate,stage:'commit'}),null);
});
test('PS2 source versus target roles preserve shooter/victim attribution',()=>{
  const x=fixture(),bound=x.binder.bindAcceptedReceipt(x.receipt(x.obsA));
  const identity=x.binder.authorize({observation:bound.observation,candidate:bound.candidate,stage:'commit'});
  const evidence=[
    {captureRef:PLAYER,subjectKind:'protagonist',subjectKey:'franklin',
      verified:true,hostRunId:HOST,worldEpoch:2,adapterEpoch:EPOCH},
    {captureRef:OB,subjectKind:'character',subjectKey:B,
      verified:true,hostRunId:HOST,worldEpoch:2,adapterEpoch:EPOCH},
  ];
  const shooting={...x.obsA,claims:[{...x.obsA.claims[0],target:{captureRef:OB,kind:'ped'}}]};
  const fired=normalizeWitnessedObservation({observation:shooting,identity,participantProofs:evidence});
  assert.equal(fired.event.claims[0].durableSubject,'protagonist:franklin');
  const hurt={...shooting,eventType:'injury',claims:[{...shooting.claims[0],kind:'injured'}]};
  const injured=normalizeWitnessedObservation({observation:hurt,identity,participantProofs:evidence});
  assert.equal(injured.event.claims[0].durableSubject,`character:${B}`);
  const missingTarget=normalizeWitnessedObservation({observation:{...hurt,claims:[{...hurt.claims[0],target:undefined}]},identity,participantProofs:evidence});
  assert.equal(missingTarget.event.claims[0].durableSubject,`unresolved:${CLAIM}`);
});
test('native ownership and timeline are rechecked after queue acceptance',()=>{
  const x=fixture();
  const r=x.binder.bindAcceptedReceipt(x.receipt(x.obsA));
  x.p2.timelineWritable=false;
  assert.equal(x.binder.authorize({observation:r.observation,candidate:r.candidate,stage:'commit'}),null);
  x.p2.timelineWritable=true;
  x.ps2.observerIndex.set(OA,{...x.ps2.observerIndex.get(OA),incarnationId:id(40)});
  assert.equal(x.binder.authorize({observation:r.observation,candidate:r.candidate,stage:'commit'}),null);
});
test('bounded receipt intake never falsely acknowledges durability, accounts overflow and retirement',async()=>{
  const x=fixture(),seen=[];
  let release;
  const fence=new Promise(resolve=>release=resolve);
  const recorder={async capture(row){await fence;return {accepted:true,inserted:true};},
    bufferBeforePromotion(){return {accepted:true};},reset(){seen.push('reset');}};
  const intake=new M3BoundedIntake({binder:x.binder,recorder,limit:1,maxBytes:8192,
    scheduler:fn=>setImmediate(fn),onFailure:(kind)=>seen.push(kind)});
  assert.equal(intake.offer(x.receipt(x.obsA)).queued,true);
  assert.equal(intake.offer(x.receipt(x.obsA)).reason,'m3_intake_overflow');
  assert.equal(intake.snapshot().committed,0);
  release();await intake.idle();
  assert.equal(intake.snapshot().committed,1);
  assert.equal(intake.snapshot().overflow,1);
  assert.equal(seen.includes('overflow'),true);
  intake.retire();assert.equal(seen.includes('reset'),true);
  intake.close();assert.equal(intake.offer(x.receipt(x.obsA)).accepted,false);
});
test('recorder persists proof-parity events inside synchronous timeline fence and dedupes revisions',async()=>{
  const x=fixture(),saved=new Map();
  const recorder=new WitnessedEventRecorder({
    authorize:args=>x.binder.authorize(args),
    withTimelineWrite:async(id,cb)=>{assert.equal(id,LINE);return cb({},{});},
    journalPort:{append:({event,sourceEvidence})=>{
      assert.equal(verifyM3DerivedEvent(event,sourceEvidence).valid,true);
      const key=event.characterId+event.observationId+event.revision;
      if(saved.has(key))return {duplicate:true};
      saved.set(key,{event,sourceEvidence});return {inserted:true};
    }}
  });
  const bound=x.binder.bindAcceptedReceipt(x.receipt(x.obsA));
  assert.equal((await recorder.capture(bound)).inserted,true);
  assert.equal((await recorder.capture(bound)).duplicate,true);
  assert.equal(saved.size,1);
  x.ps2.observations.entries.delete(`${OA}:${EP}`);
  assert.equal((await recorder.capture(bound)).accepted,false);
});
test('coverage is unknown by default and native negatives require source certificate',async t=>{
  let DB;
  try{({DatabaseSync:DB}=await import('node:sqlite'));}catch{t.skip('node:sqlite unavailable on this Node');return;}
  const db=new DB(':memory:');
  try{
    db.exec('CREATE TABLE promoted_profiles(character_id TEXT PRIMARY KEY); CREATE TABLE timelines(timeline_id TEXT PRIMARY KEY);');
    db.prepare('INSERT INTO promoted_profiles(character_id) VALUES (?)').run(A);
    db.prepare('INSERT INTO timelines(timeline_id) VALUES (?)').run(LINE);
    ensureM3CoverageSchema(db);
    const scope={characterId:A,worldProfileId:WORLD,timelineId:LINE,observationId:OBS};
    assert.equal(readM3Coverage(db,scope).status,'unknown');
    const row={...scope,status:'did_not_witness',reason:'native_no_los',
      adapterEpoch:EPOCH,ownerProof:proofs.get(OA)};
    assert.throws(()=>appendM3Coverage(db,row),/m3_negative_not_certified/);
    const receipt={certified:true,nativeVerified:true,sourceReceiptId:id(60),
      observationId:OBS,adapterEpoch:EPOCH,ownerAlias:proofs.get(OA).ownerAlias,
      incarnationId:INC_A,encounterId:ENC_A,status:'did_not_witness',
      observerCaptureRef:OA,hostRunId:HOST,worldEpoch:2,sampledGameTick:100,
      channel:'visual',basis:'native_awareness'};
    assert.equal(appendM3Coverage(db,{...row,nativeCoverage:receipt}).inserted,true);
    assert.equal(readM3Coverage(db,scope).certified,true);
    assert.equal(appendM3Coverage(db,{...row,nativeCoverage:receipt}).duplicate,true);
    assert.throws(()=>appendM3Coverage(db,{...row,status:'unknown',nativeCoverage:null}),/conflicting/);
    db.prepare('DELETE FROM promoted_profiles WHERE character_id=?').run(A);
    assert.equal(readM3Coverage(db,scope).status,'unknown');
  }finally{db.close();}
});

test('H: live intelligence client forwards a synchronous authenticated M3 tap to PS2 runtime',()=>{
 const accepted=()=>({accepted:true,queued:true});
 const client=new IntelligenceClient({mode:'shadow',radio:'off'},{
   acceptedObservationTap:accepted,connect:()=>{throw new Error('must_not_connect');},
   telemetry:()=>{},report:()=>{}
 });
 assert.equal(client.runtime.acceptedObservationTap,accepted);
 const unbound=new IntelligenceClient({mode:'shadow',radio:'off'},{
   acceptedObservationTap:null,connect:()=>{throw new Error('must_not_connect');},
   telemetry:()=>{},report:()=>{}
 });
 assert.equal(unbound.runtime.acceptedObservationTap,null);
});
