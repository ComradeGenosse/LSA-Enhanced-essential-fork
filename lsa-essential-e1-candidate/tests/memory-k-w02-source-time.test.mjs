import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createM3SourceTimeAuthority} from '../../lsa-shared-brain/src/events/m3SourceTimeAuthority.mjs';
import {createM3Ps2ObserverAdapter} from '../../lsa-shared-brain/src/events/m3Ps2ObserverAdapter.mjs';
import {verifyM3DerivedEvent} from '../../lsa-shared-brain/src/events/journalEventNormalizer.mjs';

const id=n=>`d0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const RUN=id(1),ADAPTER=id(2),WORLD=id(3),TIMELINE=id(4),EP=id(5),PLAYER=id(6);
const members=[{ref:id(11),char:id(12),inc:id(13),enc:id(14),signal:id(15),rid:id(16)},
  {ref:id(21),char:id(22),inc:id(23),enc:id(24),signal:id(25),rid:id(26)}];
const owner=m=>({ownerAlias:`promoted.${m.char}`,hostRunId:RUN,worldEpoch:2,
  observerCaptureRef:m.ref,incarnationId:m.inc,encounterId:m.enc});
const observed=(m,n=100,channel='visual')=>({
  version:1,observationId:id(500+n+(m===members[0]?0:1000)),
  episodeId:EP,revision:1,observer:{kind:'ped',captureRef:m.ref},
  observedAt:{nativeRun:ADAPTER,gameTick:n,receivedUtc:'2026-10-12T10:00:00.000Z'},
  eventType:channel==='report'?'report':'firing_burst',severity:'routine',
  claims:[{claimId:id(600+n+(m===members[0]?0:1000)),
    kind:channel==='report'?'report':'firing',certainty:'supported',
    evidence:channel==='report'?{channel,basis:'dialogue_report',sampledGameTick:n,reportRef:id(900+n)}:
      {channel,basis:channel==='auditory'?'audibility_model':'sampled_state',sampledGameTick:n},
    ...(channel==='report'?{}:{source:{kind:'player',captureRef:PLAYER}}),
    details:{eventSignalId:m.signal,reason:'native_witness'}}],
  recognizedCharacterIds:[]});
function setup({limit=8,maxBytes=65536}={}){
  let subscribe,clock=1000;const losses=[],journal=new Map();
  const base={resolveNativeOwner:({observerCaptureRef})=>{
    const m=members.find(x=>x.ref===observerCaptureRef);
    return m?{current:true,nativeVerified:true,promoted:true,
      ownerAlias:owner(m).ownerAlias,ownerProof:owner(m),characterId:m.char}:null;
  }};
  const authority=createM3SourceTimeAuthority({
    subscribeAuthenticatedNativeFrames:(fn,retire)=>{subscribe={fn,retire};return ()=>{};},
    currentAuthority:base,now:()=>clock,onLoss:(reason)=>losses.push(reason)});
  const entry=new Map(),rows=new Map(),anchors=new Map(),profiles=[];
  for(const m of members){
    const obs=observed(m);entry.set(`${m.ref}:${EP}`,{value:obs});
    rows.set(m.ref,{captureRef:m.ref,kind:'ped',owned:true,
      incarnationId:m.inc,encounterId:m.enc});
    anchors.set(m.ref,{observer:true,kind:'ped',owned:true});
    profiles.push({characterId:m.char,promotion:{ownerAlias:owner(m).ownerAlias},status:'available'});
  }
  const ps2={epoch:ADAPTER,hostContext:{hostRunId:RUN,worldEpoch:2},
    observerIndex:rows,anchors,observations:{entries:entry},current:x=>anchors.has(x)};
  const state={writable:true,timeline:TIMELINE};
  const store={worldProfileId:WORLD,
    get activeTimelineId(){return state.timeline;},
    get timelineWritable(){return state.writable;},
    get verifiedHostContext(){return state.writable?{hostRunId:RUN,worldEpoch:2}:null;},
    get snapshot(){return {profiles};},
    get(characterId){return profiles.find(p=>p.characterId===characterId);},
    async withTimelineWrite(timeline,fn){
      if(!state.writable||timeline!==state.timeline)throw Error('timeline_suspended');
      return fn({appendJournalEvent(event,{hostContext,sourceEvidence}){
        assert.equal(hostContext.hostRunId,RUN);
        assert.equal(verifyM3DerivedEvent(event,sourceEvidence).valid,true);
        const key=`${event.characterId}:${event.observationId}:${event.revision}`;
        if(journal.has(key))return {recordId:event.recordId,inserted:false};
        journal.set(key,{event,sourceEvidence});
        return {recordId:event.recordId,inserted:true};
      },appendM3Coverage(){throw Error('negative_not_certified');}},
      {activeTimelineId:state.timeline});
    },
    appendJournalEvent(){throw Error('nonserialized_write');}
  };
  const adapter=createM3Ps2ObserverAdapter({ps2,p2:store,nativeAuthority:authority,limit,maxBytes,
    onLoss:(stage)=>losses.push(stage)});
  const frame=(entries,sequence=1,stream=id(40))=>{
    subscribe.fn({frame:{version:1,type:'m3_source_time',streamId:stream,
      adapterEpoch:ADAPTER,sequence,payload:{sourceProofVersion:1,hostRunId:RUN,
        worldEpoch:2,proofs:entries}}});
  };
  const native=(m,n=100,channel='visual')=>({
    sourceReceiptId:m.rid,signalId:m.signal,source:'original_native_ps2_witness_sample',
    hostRunId:RUN,worldEpoch:2,adapterEpoch:ADAPTER,observerCaptureRef:m.ref,
    ownerAlias:owner(m).ownerAlias,incarnationId:m.inc,encounterId:m.enc,
    sampledGameTick:n,status:channel==='report'?'reported':'witnessed',channel,
    basis:channel==='auditory'?'audibility_model':channel==='report'?'dialogue_report':'sampled_state'});
  const offer=o=>adapter.acceptedObservationTap({observation:o,hostRunId:RUN,worldEpoch:2,
    adapterEpoch:ADAPTER,observerIndex:rows.get(o.observer.captureRef)});
  return {frame,native,offer,adapter,authority,members,ps2,store,state,journal,losses,
    clock:(next)=>clock=next,subscribe};
}
test('W02: two concurrently promoted observers persist only their own accepted PS2 sidecars',async()=>{
  const x=setup();x.frame(x.members.map(m=>x.native(m)));
  for(const m of x.members)assert.equal(x.offer(observed(m)).queued,true);
  await x.adapter.idle();assert.equal(x.journal.size,2);
  assert.deepEqual(new Set([...x.journal.values()].map(v=>v.event.characterId)),
    new Set(x.members.map(m=>m.char)));
  for(const row of x.journal.values()){
    assert.equal(row.sourceEvidence.observation.claims[0].details.eventSignalId,
      x.members.find(m=>m.char===row.event.characterId).signal);
    assert.equal(verifyM3DerivedEvent(row.event,row.sourceEvidence).valid,true);
  }
});
test('W02: absent native signal, later owner snapshot and forged source field never prove prior witnessing',async()=>{
  const x=setup();assert.equal(x.offer(observed(x.members[0])).accepted,false);
  x.frame([x.native(x.members[1])]);
  assert.equal(x.offer(observed(x.members[0])).accepted,false);
  await x.adapter.idle();assert.equal(x.journal.size,0);
});
test('W02: mismatched observer, lifetime or witness tick fails closed',()=>{
  const x=setup();const m=x.members[0];x.frame([{...x.native(m),incarnationId:id(99)}]);
  assert.equal(x.offer(observed(m)).accepted,false);
  const y=setup();y.frame([{...y.native(m),sampledGameTick:101}]);
  assert.equal(y.offer(observed(m)).accepted,false);
});
test('W02: journal accepts exact signal once, rejects uncorrelated revised claims',async()=>{
  const x=setup();const m=x.members[0];x.frame([x.native(m)]);
  const orig=observed(m);assert.equal(x.offer(orig).queued,true);
  await x.adapter.idle();assert.equal(x.journal.size,1);
  assert.equal(x.offer(orig).queued,true);await x.adapter.idle();
  assert.equal(x.adapter.snapshot().duplicate,1);
  const modified={...orig,revision:2,claims:[{...orig.claims[0],
    details:{eventSignalId:id(999),reason:'native_witness'}}]};
  x.ps2.observations.entries.set(`${m.ref}:${EP}`,{value:modified});
  assert.equal(x.offer(modified).accepted,false);
  assert.equal(x.journal.size,1);
});
test('W02: reports are not upgraded to firsthand; unverified report remains unknown',async()=>{
  const x=setup(),m=x.members[0],o=observed(m,100,'report');
  x.ps2.observations.entries.set(`${m.ref}:${EP}`,{value:o});
  assert.equal(x.offer(o).accepted,false); // no source
  x.frame([x.native(m,100,'report')]); // explicitly sourced report only
  assert.equal(x.offer(o).queued,true);
  await x.adapter.idle();
  assert.equal(x.journal.size,1);
  const event=[...x.journal.values()][0].event;
  assert.equal(event.receiptStatus,'reported');
  assert.equal(event.claims[0].modality,'report');
});
test('W02: native frame conflict and replay revoke source ownership rather than retcon',()=>{
  const x=setup(),m=x.members[0];x.frame([x.native(m)]);
  x.frame([{...x.native(m),incarnationId:id(999)}],2);
  assert.equal(x.offer(observed(m)).accepted,false);
  assert.ok(x.authority.status().collision>0);
});
test('W02: epoch/stream retire, source TTL, timeline rollback revoke receipts',async()=>{
  const x=setup(),m=x.members[0];x.frame([x.native(m)]);
  x.subscribe.retire();
  assert.equal(x.offer(observed(m)).accepted,false);
  const y=setup();y.frame([y.native(m)]);
  y.state.writable=false;
  assert.equal(y.offer(observed(m)).accepted,false);
  const z=setup();z.frame([z.native(m)]);z.clock(125001);
  assert.equal(z.offer(observed(m)).accepted,false);
});
test('W02: missing PS2 receipt never certifies did_not_witness',async()=>{
  const x=setup(),m=x.members[0];x.frame([x.native(m)]);
  const candidate={characterId:m.char,worldProfileId:WORLD,timelineId:TIMELINE,
    adapterEpoch:ADAPTER,ownerProof:owner(m)};
  const receipt=await x.adapter.recordNegativeCoverage({candidate,
    observationId:observed(m).observationId,status:'did_not_witness'});
  assert.equal(receipt.accepted,false);
  assert.equal(x.authority.verifyNativeCoverage(),null);
});
test('W02: bounded native intake evicts rather than guessing missed history',()=>{
  const x=setup(),m=x.members[0];
  for(let i=0;i<70;i++){
    x.frame([{...x.native(m),signalId:id(2000+i),sourceReceiptId:id(3000+i)}],i+1);
  }
  assert.ok(x.authority.status().accepted>=70);
  assert.equal(x.authority.status().negativeCoverageSupported,false);
});
