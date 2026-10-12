import {test} from 'node:test';
import assert from 'node:assert/strict';
import {M9CommittedWitnessAuthority} from '../src/events/m9CommittedWitnessAuthority.mjs';

const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const [nativeRun,hostRunId,playerCaptureRef,observerCaptureRef,characterId,
  worldProfileId,timelineId,incarnationId,encounterId,
  eventId,observationId,witnessReceiptId,journalRecordId,otherObserver]=
  Array.from({length:14},(_,i)=>id(i+1));
const ownerProof={hostRunId,worldEpoch:3,observerCaptureRef,
  incarnationId,encounterId,ownerAlias:'promoted.'+characterId};
const candidate={kind:'m9_candidate',eventId,eventType:'vehicle_crash',
  nativeEvidenceId:id(20),nativeRun,hostRunId,worldEpoch:3,
  playerCaptureRef,gameTick:110,observedAtMonotonicMs:2000};
const witness={status:'witnessed',certainty:'direct',modality:'visual',
  candidateEventId:eventId,nativeEvidenceId:candidate.nativeEvidenceId,
  observationId,witnessReceiptId,journalRecordId,characterId,
  worldProfileId,timelineId,observerCaptureRef,incarnationId,encounterId,
  nativeRun,hostRunId,worldEpoch:3,playerCaptureRef,
  protagonistKey:'unknown'};
const native={authenticated:true,current:true,timelineWritable:true,
  nativeRun,hostRunId,worldEpoch:3,playerCaptureRef,gameTick:115,
  observerCaptureRef,incarnationId,encounterId,
  protagonistKey:'unknown',worldProfileId,timelineId};
const sourceAtObservation={nativeVerified:true,gameTick:110,nativeRun,
  hostRunId,worldEpoch:3,observerCaptureRef,incarnationId,encounterId};
const ps2={status:'witnessed',nativeVerified:true,coverage:'witnessed',
  sourceAtObservation,observedGameTick:110,eventType:'vehicle_crash',
  candidateEventId:eventId,nativeEvidenceId:candidate.nativeEvidenceId,
  observationId,witnessReceiptId,observerCaptureRef,incarnationId,encounterId,
  hostRunId,worldEpoch:3,nativeRun,modality:'visual',certainty:'direct'};
const event={kind:'journal_event',receiptStatus:'witnessed',
  recordId:journalRecordId,observationId,eventType:'vehicle_crash',
  worldProfileId,timelineId,characterId,ownerProof,
  sourceHash:'a'.repeat(64),
  claims:[{sourceEvidenceId:witnessReceiptId,certainty:'direct',
    modality:'visual'}]};
const sidecar={committed:true,candidateEventId:eventId,
  nativeEvidenceId:candidate.nativeEvidenceId,journalRecordId,
  observationId,witnessReceiptId,sourceHash:event.sourceHash,
  characterId,worldProfileId,timelineId,eventType:'vehicle_crash',
  nativeRun,hostRunId,worldEpoch:3,playerCaptureRef,gameTick:110};
const clone=x=>structuredClone(x);
function harness(changes={}) {
  let state={candidate:clone(candidate),witness:clone(witness),
    native:clone(native),ps2:clone(ps2),event:clone(event),
    sidecar:clone(sidecar),...changes};
  let reads=[];
  const authority=new M9CommittedWitnessAuthority({
    readCurrentNativeScope:()=>{reads.push('native');return state.native;},
    readSourceTimePs2Witness:()=>{reads.push('ps2');return state.ps2;},
    readCommittedP2Event:()=>{reads.push('event');return state.event;},
    readCommittedP2Sidecar:()=>{reads.push('sidecar');return state.sidecar;}
  });
  return {authority,state,reads,check:()=>authority.check({
    candidate:state.candidate,witness:state.witness})};
}
test('W08 accepts ONLY exact PS2 observed + P2 committed event and sidecar in live native scope',()=>{
  const h=harness(),result=h.check();
  assert.equal(result.authorized,true);
  assert.equal(result.receipt.journalRecordId,journalRecordId);
  assert.deepEqual(h.reads,['native','ps2','event','sidecar','native']);
  assert.ok(Object.isFrozen(result.receipt));
});
test('W08 missing P2 event/sidecar and pending transactions never grant Director a memory',()=>{
  for(const [field,value] of [
    ['event',null],['sidecar',null],
    ['event',{...event,receiptStatus:'pending'}],
    ['sidecar',{...sidecar,committed:false}],
    ['sidecar',Promise.resolve(sidecar)]
  ]) {
    const h=harness({[field]:value});
    assert.equal(h.check().authorized,false,field);
  }
});
test('W08 cross-host, epoch, protagonist and recycled owner do not join independent receipts',()=>{
  const mutations=[
    ['candidate',x=>{x.hostRunId=id(101);}],
    ['native',x=>{x.current=false;}],
    ['native',x=>{x.worldEpoch=4;}],
    ['native',x=>{x.incarnationId=id(102);}],
    ['native',x=>{x.observerCaptureRef=otherObserver;}],
    ['native',x=>{x.protagonistKey='franklin';}],
    ['witness',x=>{x.protagonistKey='other';}],
    ['witness',x=>{x.observerCaptureRef=otherObserver;}],
    ['ps2',x=>{x.sourceAtObservation.gameTick=109;}],
    ['ps2',x=>{x.sourceAtObservation.encounterId=id(103);}],
    ['ps2',x=>{x.coverage='unknown';}],
    ['ps2',x=>{x.modality='report';}],
    ['event',x=>{x.ownerProof.encounterId=id(104);}],
    ['event',x=>{x.ownerProof.ownerAlias='promoted.'+id(105);}],
    ['event',x=>{x.tombstoned=true;}],
    ['event',x=>{x.claims=[{certainty:'reported',sourceEvidenceId:witnessReceiptId}];}],
    ['sidecar',x=>{x.candidateEventId=id(106);}],
    ['sidecar',x=>{x.sourceHash='b'.repeat(64);}],
    ['sidecar',x=>{x.deleted=true;}],
    ['sidecar',x=>{x.gameTick=999;}]
  ];
  for(const [field,edit] of mutations){
    const h=harness();edit(h.state[field]);
    assert.equal(h.check().authorized,false,field+' '+edit.toString());
  }
});
test('W08 never permits Promise-returning native PS2/P2 adapters',()=>{
  const h=harness({native:Promise.resolve(native)});
  assert.equal(h.check().authorized,false);
  const later=harness({ps2:Promise.resolve(ps2)});
  assert.equal(later.check().authorized,false);
});
test('W08 rechecks native scope AFTER P2 readback to defeat timeline changes',()=>{
  const h=harness();
  let calls=0;
  const authority=new M9CommittedWitnessAuthority({
    readCurrentNativeScope:()=>{
      calls++;return calls===1?native:{...native,timelineId:id(122)};
    },
    readSourceTimePs2Witness:()=>ps2,
    readCommittedP2Event:()=>event,
    readCommittedP2Sidecar:()=>sidecar
  });
  assert.equal(authority.check({candidate,witness}).authorized,false);
  assert.equal(calls,2);
});
