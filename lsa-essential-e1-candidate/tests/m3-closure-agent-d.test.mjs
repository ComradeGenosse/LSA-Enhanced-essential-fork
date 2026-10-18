import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createM3Ps2ObserverAdapter} from '../../lsa-shared-brain/src/events/m3Ps2ObserverAdapter.mjs';
import {M3ObserverOwnerBinder} from '../../lsa-shared-brain/src/events/m3ObserverOwnerBinder.mjs';
import {normalizeWitnessedObservation,verifyM3DerivedEvent} from '../../lsa-shared-brain/src/events/journalEventNormalizer.mjs';
import {validateM3Coverage} from '../../lsa-shared-brain/src/events/m3CoverageSqlite.mjs';
const id=n=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const W=id(1),T=id(2),R=id(3),E=id(4),OA=id(5),OB=id(6),A=id(7),B=id(8),
  IA=id(9),IB=id(10),EA=id(11),EB=id(12),EP=id(13),PLAYER=id(14);
const proof=(ref)=>({ownerAlias:ref===OA?'owner.a':'owner.b',
  incarnationId:ref===OA?IA:IB,encounterId:ref===OA?EA:EB,
  hostRunId:R,worldEpoch:3,observerCaptureRef:ref});
const char=ref=>ref===OA?A:B;
function observed(ref=OA,n=100,channel='visual'){
  const claim={claimId:id(200+n),kind:channel==='report'?'report':'firing',certainty:'supported',
    evidence:channel==='report'?{channel,basis:'dialogue_report',sampledGameTick:n,reportRef:id(400+n)}:
      {channel,basis:channel==='auditory'?'audibility_model':'sampled_state',sampledGameTick:n},
    ...(channel==='report'?{}:{source:{captureRef:PLAYER,kind:'player'}}),
    details:{eventSignalId:id(700+n),reason:'native_source_sample'}};
  return {version:1,observationId:id(500+n),episodeId:EP,revision:1,
    observer:{kind:'ped',captureRef:ref},observedAt:{nativeRun:E,gameTick:n,receivedUtc:'2026-10-11T22:00:00.000Z'},
    eventType:channel==='report'?'report':'firing_burst',severity:'routine',claims:[claim],
    recognizedCharacterIds:[]};
}
function rig({scheduler,gate,pre=false}={}){
  const entries=new Map(),journal=new Map(),coverage=new Map(),losses=[];
  const a=observed(OA),b=observed(OB);
  entries.set(`${OA}:${EP}`,{value:a});
  entries.set(`${OB}:${EP}`,{value:b});
  const rows=new Map([[OA,{captureRef:OA,kind:'ped',owned:true,incarnationId:IA,encounterId:EA}],
    [OB,{captureRef:OB,kind:'ped',owned:true,incarnationId:IB,encounterId:EB}]]);
  const anchors=new Map([[OA,{observer:true,owned:true,kind:'ped'}],
    [OB,{observer:true,owned:true,kind:'ped'}],[PLAYER,{observer:false,kind:'player'}]]);
  const ps2={epoch:E,hostContext:{hostRunId:R,worldEpoch:3},observerIndex:rows,anchors,
    observations:{entries},current:ref=>anchors.has(ref)};
  const profiles=new Map([[A,{characterId:A,promotion:{ownerAlias:'owner.a'},status:'available'}],
    [B,{characterId:B,promotion:{ownerAlias:'owner.b'},status:'available'}]]);
  if(pre)profiles.delete(A);
  const state={writable:true,activeTimeline:T,worldProfileId:W,epoch:E,
    verifiedHostContext:{hostRunId:R,worldEpoch:3},nativeOwners:new Set([OA,OB]),
    protagonist:false,negative:false};
  const store={worldProfileId:W,get activeTimelineId(){return state.activeTimeline;},
    get timelineWritable(){return state.writable;},
    get verifiedHostContext(){return state.writable?state.verifiedHostContext:null;},
    get snapshot(){return {profiles:[...profiles.values()]};},
    get(characterId){return profiles.get(characterId);},
    async withTimelineWrite(timelineId,fn){
      if(gate)await gate.promise;
      if(!state.writable||state.activeTimeline!==timelineId)throw new Error('timeline_suspended');
      const foundation={
        appendJournalEvent(event,{hostContext,sourceEvidence}){
          assert.equal(hostContext.hostRunId,R);
          assert.equal(verifyM3DerivedEvent(event,sourceEvidence).valid,true);
          const key=`${event.characterId}:${event.timelineId}:${event.observationId}:${event.revision}`;
          const prior=journal.get(key);
          if(!prior)journal.set(key,{event,sourceEvidence});
          return {recordId:event.recordId,inserted:!prior};
        },
        appendM3Coverage(record){
          validateM3Coverage(record);
          const key=`${record.characterId}:${record.observationId}`;
          if(coverage.has(key))return {duplicate:true};
          coverage.set(key,record);return {inserted:true};
        }
      };
      return fn(foundation,{activeTimelineId:state.activeTimeline});
    },
    appendJournalEvent(){throw new Error('must_use_single_p2_transaction');}
  };
  const ownerProof=({observerCaptureRef,adapterEpoch,observedGameTick,observation,observationId,observationRevision})=>{
    if(!state.nativeOwners.has(observerCaptureRef))return null;
    const p=proof(observerCaptureRef);
    return {nativeVerified:true,current:true,promoted:profiles.has(char(observerCaptureRef)),
      reserved:!profiles.has(char(observerCaptureRef)),characterId:char(observerCaptureRef),
      ownerAlias:p.ownerAlias,ownerProof:p,
      sourceAtObservation:{nativeVerified:true,source:'original_native_ps2_witness_sample',
        gameTick:observedGameTick,adapterEpoch,observationId,revision:observationRevision,
        hostRunId:R,worldEpoch:3,observerCaptureRef,ownerAlias:p.ownerAlias,
        incarnationId:p.incarnationId,encounterId:p.encounterId,
        signalProofs:(observation?.claims??[]).map(claim=>({
          claimId:claim.claimId,signalId:claim.details.eventSignalId,
          sourceReceiptId:id(800+Number(claim.evidence.sampledGameTick)),
          sampledGameTick:claim.evidence.sampledGameTick,
          channel:claim.evidence.channel,basis:claim.evidence.basis}))}};
  };
  const nativeAuthority={resolveNativeOwner:ownerProof,resolvePrepromotion:ownerProof,
    resolveParticipants:()=>state.protagonist?[{nativeVerified:true,verified:true,
      captureRef:PLAYER,subjectKind:'protagonist',subjectKey:'franklin',sampledGameTick:100,
      hostRunId:R,worldEpoch:3,adapterEpoch:E}]:[],
    verifyNativeCoverage:({candidate,observationId})=>state.negative?{
      nativeVerified:true,certified:true,status:'did_not_witness',sourceReceiptId:id(900),
      observationId,adapterEpoch:E,ownerAlias:candidate.ownerProof.ownerAlias,
      incarnationId:candidate.ownerProof.incarnationId,encounterId:candidate.ownerProof.encounterId,
      observerCaptureRef:candidate.ownerProof.observerCaptureRef,hostRunId:R,worldEpoch:3,
      sampledGameTick:100,channel:'visual',basis:'native_awareness'}:null};
  const adapter=createM3Ps2ObserverAdapter({ps2,p2:store,nativeAuthority,
    ...(scheduler?{scheduler}:{}),limit:16,maxBytes:65536,onLoss:(kind)=>losses.push(kind)});
  const receipt=o=>({observation:o,adapterEpoch:E,hostRunId:R,worldEpoch:3,
    observerIndex:rows.get(o.observer.captureRef)});
  const candidate=ref=>({characterId:char(ref),worldProfileId:W,timelineId:T,
    adapterEpoch:E,ownerProof:proof(ref)});
  return {adapter,ps2,store,state,profiles,journal,coverage,losses,a,b,receipt,candidate,nativeAuthority};
}
test('M3: two observers isolated and PS3 salience is not an admission gate',async()=>{
  const x=rig();x.ps2.salience=null;
  assert.equal(x.adapter.acceptedObservationTap(x.receipt(x.a)).queued,true);
  assert.equal(x.adapter.acceptedObservationTap(x.receipt(x.b)).queued,true);
  await x.adapter.idle();
  assert.equal(x.journal.size,2);
  assert.deepEqual(new Set([...x.journal.values()].map(x=>x.event.characterId)),new Set([A,B]));
  assert.equal(x.adapter.snapshot().committed,2);
  assert.equal(x.adapter.snapshot().overflow,0);
});
test('M3: no accepted PS2 receipt is not no-witness evidence',async()=>{
  const x=rig();x.ps2.observations.entries.delete(`${OB}:${EP}`);
  assert.equal(x.adapter.acceptedObservationTap(x.receipt(x.b)).accepted,false);
  assert.equal(x.journal.size,0);
  const negative=await x.adapter.recordNegativeCoverage({candidate:x.candidate(OB),
    observationId:x.b.observationId,status:'did_not_witness'});
  assert.equal(negative.accepted,false);
  assert.equal(x.coverage.size,0);
  x.state.negative=true;
  assert.equal((await x.adapter.recordNegativeCoverage({candidate:x.candidate(OB),
    observationId:x.b.observationId,status:'did_not_witness'})).inserted,true);
  assert.equal(x.coverage.size,1);
  assert.equal(x.journal.size,0);
});
test('M3: no guessed protagonist; report never promoted to firsthand',async()=>{
  const x=rig();x.adapter.acceptedObservationTap(x.receipt(x.a));await x.adapter.idle();
  const unproven=[...x.journal.values()][0].event;
  assert.match(unproven.claims[0].durableSubject,/^unresolved:/);
  const y=rig();y.state.protagonist=true;
  y.adapter.acceptedObservationTap(y.receipt(y.a));await y.adapter.idle();
  assert.equal([...y.journal.values()][0].event.claims[0].durableSubject,'protagonist:franklin');
  const z=rig(),reported=observed(OA,199,'report');
  z.ps2.observations.entries.set(`${OA}:${EP}`,{value:reported});
  z.adapter.acceptedObservationTap(z.receipt(reported));await z.adapter.idle();
  assert.equal([...z.journal.values()][0].event.receiptStatus,'reported');
  assert.equal([...z.journal.values()][0].event.claims[0].modality,'report');
});
test('M3: source-time native proof, ped reuse and post-reset taps fail closed',async()=>{
  const x=rig();const stale=x.receipt(x.a);
  x.ps2.observerIndex.set(OA,{...x.ps2.observerIndex.get(OA),incarnationId:id(999)});
  assert.equal(x.adapter.acceptedObservationTap(stale).accepted,false);
  const y=rig();y.nativeAuthority.resolveNativeOwner=()=>null;
  y.ps2.anchors.delete(OA);
  assert.equal(y.adapter.acceptedObservationTap(y.receipt(y.a)).accepted,false);
  assert.equal(y.journal.size,0);
});
test('M3: in-flight retirement and timeline rollover cannot write late receipts',async()=>{
  let release;const gate={promise:new Promise(resolve=>release=resolve)};
  const x=rig({gate});
  x.adapter.acceptedObservationTap(x.receipt(x.a));
  x.adapter.acceptedObservationTap(x.receipt(x.b));
  await new Promise(resolve=>setImmediate(resolve));
  x.adapter.retire();x.state.activeTimeline=id(777);x.state.writable=false;
  release();await x.adapter.idle();
  assert.equal(x.journal.size,0);
  assert.ok(x.adapter.snapshot().retired>=1);
  assert.equal(x.adapter.snapshot().committed,0);
});
test('M3: 10k burst stays bounded and callback never promises SQLite durability',async()=>{
  const tasks=[];const x=rig({scheduler:fn=>tasks.push(fn)});
  for(let n=1000;n<11000;n++){
    const o=observed(OA,n);x.ps2.observations.entries.set(`${OA}:${EP}`,{value:o});
    const response=x.adapter.acceptedObservationTap(x.receipt(o));
    assert.notEqual(response.committed,true);
  }
  const snap=x.adapter.snapshot();
  assert.equal(snap.offered,10000);assert.ok(snap.queued>0&&snap.queued<=16);
  assert.ok(snap.overflow>0);assert.equal(snap.committed,0);
  x.adapter.close();tasks.shift()?.();await x.adapter.idle();
  assert.equal(x.journal.size,0);
});
test('M3: restart has no fabricated negative; authentic replay is idempotent',async()=>{
  const x=rig();x.adapter.acceptedObservationTap(x.receipt(x.a));await x.adapter.idle();
  assert.equal(x.journal.size,1);
  assert.equal(x.adapter.snapshot().recovery,'committed_sqlite_only_uncommitted_callbacks_unknown');
  x.adapter.acceptedObservationTap(x.receipt(x.a));await x.adapter.idle();
  assert.equal(x.journal.size,1);
  assert.equal(x.adapter.snapshot().duplicate,1);
  assert.equal(x.coverage.size,0);
});
test('M3: grace imports only reserved physical owner and no later recycled actor',async()=>{
  const x=rig({pre:true});
  x.adapter.prepromotionAcceptedTap(x.receipt(x.a));await x.adapter.idle();
  x.profiles.set(A,{characterId:A,promotion:{ownerAlias:'owner.a'},status:'available'});
  assert.equal((await x.adapter.importOnPromotion({candidate:x.candidate(OA)})).imported,1);
  assert.equal(x.journal.size,1);
  const y=rig({pre:true});y.adapter.prepromotionAcceptedTap(y.receipt(y.a));await y.adapter.idle();
  y.profiles.set(A,{characterId:A,promotion:{ownerAlias:'owner.a'},status:'available'});
  const old=y.candidate(OA);
  y.ps2.observerIndex.get(OA).incarnationId=id(991);
  assert.equal((await y.adapter.importOnPromotion({candidate:old})).imported,0);
  assert.equal(y.journal.size,0);
});
test('M3: source evidence hash tampering cannot silently rewrite claim modality',()=>{
  const x=rig();const binder=new M3ObserverOwnerBinder({ps2:x.ps2,p2:x.store,
    resolveNativeOwner:x.nativeAuthority.resolveNativeOwner,
    resolveParticipants:x.nativeAuthority.resolveParticipants});
  const first=binder.bindAcceptedReceipt(x.receipt(x.a));assert.equal(first.accepted,true);
  const identity=binder.authorize({observation:first.observation,candidate:first.candidate,stage:'commit'});
  const normalized=normalizeWitnessedObservation({observation:x.a,identity});
  assert.equal(verifyM3DerivedEvent(normalized.event,normalized.sourceEvidence).valid,true);
  const altered={...normalized.sourceEvidence,observation:{...x.a,
    claims:[{...x.a.claims[0],evidence:{channel:'auditory',basis:'audibility_model',sampledGameTick:100}}]}};
  assert.equal(verifyM3DerivedEvent(normalized.event,altered).valid,false);
});

test('M3: mismatched source-time native ledger must not bind PS2 observation',()=>{
  const x=rig(),original=x.nativeAuthority.resolveNativeOwner;
  x.nativeAuthority.resolveNativeOwner=input=>{
    const n=original(input);
    return {...n,sourceAtObservation:{...n.sourceAtObservation,gameTick:101}};
  };
  assert.equal(x.adapter.acceptedObservationTap(x.receipt(x.a)).accepted,false);
  assert.equal(x.journal.size,0);
});
test('M3: protagonist proof is per-claim tick, not entire episode identity',async()=>{
  const x=rig();x.state.protagonist=true;
  const later=observed(OA,129);
  x.ps2.observations.entries.set(`${OA}:${EP}`,{value:later});
  x.adapter.acceptedObservationTap(x.receipt(later));await x.adapter.idle();
  assert.match([...x.journal.values()][0].event.claims[0].durableSubject,/^unresolved:/);
});
test('M3: stale native negative certificate never authorizes no-witness',async()=>{
  const x=rig();x.state.negative=true;
  const original=x.nativeAuthority.verifyNativeCoverage;
  x.nativeAuthority.verifyNativeCoverage=args=>({...original(args),observationId:id(12345)});
  const result=await x.adapter.recordNegativeCoverage({candidate:x.candidate(OB),
    observationId:x.b.observationId,status:'did_not_witness'});
  assert.equal(result.accepted,false);assert.equal(x.coverage.size,0);
});

test('M3: unavailable or throwing native participant identity retains witnessed PS2 event',async()=>{
  for(const unavailable of [()=>null,()=>{throw new Error('participant_source_offline');}]){
    const x=rig();x.nativeAuthority.resolveParticipants=unavailable;
    assert.equal(x.adapter.acceptedObservationTap(x.receipt(x.a)).queued,true);
    await x.adapter.idle();
    assert.equal(x.journal.size,1);
    assert.equal([...x.journal.values()][0].event.receiptStatus,'witnessed');
    assert.match([...x.journal.values()][0].event.claims[0].durableSubject,/^unresolved:/);
  }
});
