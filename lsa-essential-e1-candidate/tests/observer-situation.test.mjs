import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ShadowRuntime } from '../src/perception/shadowRuntime.mjs';
import { CAPABILITIES } from '../src/perception/contracts.mjs';
const fixture=()=>{
  let now=1;const runtime=new ShadowRuntime({mode:'shadow',now:()=>now,situationFor:()=>({profile:{revision:2,personality:{traits:[' Protective ','brave prose']}},bindings:[{recognized:true,captureRef:randomUUID()}]})});
  const hello={version:1,type:'hello',adapterEpoch:randomUUID(),streamId:randomUUID(),hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1,observerIndexVersion:1,observerSituationVersion:1,capabilities:Object.fromEntries(CAPABILITIES.map(k=>[k,k==='state'||k==='shooting']))};
  assert.equal(runtime.ingest(hello,{authenticated:true}),true);let sequence=0;const captureRef=randomUUID();
  const send=(type,payload)=>runtime.ingest({version:1,type,adapterEpoch:hello.adapterEpoch,streamId:hello.streamId,sequence:++sequence,payload},{authenticated:true});
  send('anchors',[{captureRef,kind:'ped',observer:true,owned:false}]);send('observer_index',[{captureRef,kind:'ped',owned:false}]);
  return {runtime,captureRef,send,setNow:value=>{now=value;}};
};
test('qualified physical situation feeds PS3 and preserves original paired inputs',()=>{
  const f=fixture();assert.equal(f.send('observer_situation',[{captureRef:f.captureRef,sampledGameTick:10,activity:'driving',situationRevision:1}]),true);
  f.send('signal',{signalId:randomUUID(),producer:'shooting',producerSequence:1,kind:'firing',target:null,source:f.captureRef,gameTick:10,ageMs:0,facts:{}});
  const pairs=f.runtime.salience.snapshotForObserver(f.captureRef,f.runtime.observations);assert.ok(pairs.length);
  assert.equal(pairs[0].situation.activity,'driving');assert.equal(pairs[0].situation.situationRevision,1);assert.deepEqual(pairs[0].situation.traitPolicies,['protective']);assert.deepEqual(pairs[0].situation.recognized,{});
  f.send('observer_situation',[{captureRef:f.captureRef,sampledGameTick:11,activity:'conversation',situationRevision:2}]);
  assert.equal(pairs[0].situation.activity,'driving');assert.equal(f.runtime.situationFor(f.captureRef).activity,'conversation');
  f.runtime.salience.decisions.clear();assert.equal(f.runtime.salience.snapshotForObserver(f.captureRef,f.runtime.observations)[0].situation.activity,'conversation');
});
test('sample expiry and retirement cannot leave a fabricated physical mode',()=>{
  const f=fixture();f.send('observer_situation',[{captureRef:f.captureRef,sampledGameTick:10,activity:'passenger',situationRevision:1}]);f.setNow(3002);assert.equal(f.runtime.situationFor(f.captureRef).activity,'unknown');
  f.runtime.retire(f.captureRef);assert.equal(f.runtime.observerSituations.size,0);
});
test('self injury_state is observer knowledge with its supported target and sampled basis',()=>{
  const f=fixture();assert.equal(f.send('signal',{signalId:randomUUID(),producer:'state',producerSequence:1,kind:'injury_state',target:f.captureRef,source:null,gameTick:10,ageMs:0,facts:{health:50,armour:0,injured:true}}),true);
  const observation=[...f.runtime.observations.entries.values()][0]?.value;assert.ok(observation);assert.equal(observation.claims[0].target.captureRef,f.captureRef);assert.equal(observation.claims[0].evidence.channel,'self');assert.equal(observation.claims[0].evidence.basis,'sampled_state');assert.deepEqual(observation.recognizedCharacterIds,[]);
});

import { fixture as characterFixture } from './p2-fixtures.mjs';
import { createRuntime } from '../src/integration/essentialGlue.mjs';
test('runtime provider requires independently current owned incarnation and loaded profile',async t=>{
  const c=await characterFixture(t),profile=await c.service.promote(),owned=c.native.owned.get(profile.promotion.ownerAlias);
  const runtime=createRuntime(c.config,{identityEvidence:c.evidence,identityStore:c.identity.registry.store,profileStore:c.store,nativeOwner:c.native});t.after(()=>runtime.identityService.close());
  const f=fixture();runtime.intelligence={runtime:f.runtime};c.evidence.hostContext=f.runtime.hostContext;
  f.runtime.observerIndex.set(f.captureRef,Object.freeze({captureRef:f.captureRef,kind:'ped',owned:true,encounterId:owned.encounterId,incarnationId:owned.claim.incarnationId}));
  assert.deepEqual(runtime.situationFor(f.captureRef),{});
  runtime.identityService.bindings.bind({pedId:owned.pedId,sessionNonce:1},owned.claim,{characterId:profile.characterId},()=>true);
  assert.equal(runtime.situationFor(f.captureRef).profile.revision,profile.revision);assert.deepEqual(runtime.situationFor(f.captureRef).bindings,[]);assert.equal(runtime.situationFor(f.captureRef).profile.relationship,null);
  c.evidence.hostContext={...f.runtime.hostContext,hostRunId:randomUUID()};assert.deepEqual(runtime.situationFor(f.captureRef),{});
  c.evidence.hostContext=f.runtime.hostContext;c.evidence.retire(owned.pedId);assert.deepEqual(runtime.situationFor(f.captureRef),{});
});


test('policy refresh evaluates only changed current pairs and preserves frozen inputs',()=>{
 const f=fixture();f.send('signal',{signalId:randomUUID(),producer:'shooting',producerSequence:1,kind:'firing',target:null,source:f.captureRef,gameTick:10,ageMs:0,facts:{}});
 const original=f.runtime.salience.snapshotForObserver(f.captureRef,f.runtime.observations)[0];let evaluations=0;
 const evaluate=f.runtime.salience.evaluate.bind(f.runtime.salience);f.runtime.salience.evaluate=(...args)=>{evaluations++;return evaluate(...args);};
 f.runtime.refreshSalience();assert.equal(evaluations,0);
 f.runtime.situationProvider=()=>({profile:{revision:3,personality:{traits:['loyal']}}});f.runtime.refreshSalience();assert.equal(evaluations,1);
 const updated=f.runtime.salience.snapshotForObserver(f.captureRef,f.runtime.observations)[0];assert.equal(updated.situation.profileRevision,3);assert.equal(original.situation.profileRevision,2);assert.deepEqual(original.situation.traitPolicies,['protective']);
 f.runtime.refreshSalience();assert.equal(evaluations,1);
});
