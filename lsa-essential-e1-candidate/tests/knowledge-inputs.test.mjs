import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ShadowRuntime } from '../src/perception/shadowRuntime.mjs';
import { CAPABILITIES } from '../src/perception/contracts.mjs';
import { captureKnowledgeInputs,assertKnowledgeCurrent,validateActorCapture,releaseOwnedKnowledge,assertOwnedKnowledgeCurrent,assertKnowledgeItemsCurrent } from '../src/context/knowledgeInputs.mjs';
const fixture=()=>{
  let now=1;const perception=new ShadowRuntime({mode:'shadow',now:()=>now});
  const hello={version:1,type:'hello',adapterEpoch:randomUUID(),streamId:randomUUID(),hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1,observerIndexVersion:1,capabilities:Object.fromEntries(CAPABILITIES.map(k=>[k,k==='shooting']))};
  perception.ingest(hello,{authenticated:true});const captureRef=randomUUID();let sequence=0;
  const send=(type,payload)=>perception.ingest({version:1,type,adapterEpoch:hello.adapterEpoch,streamId:hello.streamId,sequence:++sequence,payload},{authenticated:true});
  send('anchors',[{captureRef,kind:'ped',observer:true,owned:false}]);send('observer_index',[{captureRef,kind:'ped',owned:false}]);
  const identity={pedId:'17',turnId:'turn-1',generationId:1,sessionNonce:1};
  const block={version:1,hostRunId:hello.hostRunId,worldEpoch:1,captureRef,sampledGameTick:10};
  const p0Snapshot={identity,revision:1,actor:{pedId:'17',integrations:{turnKnowledge:block}}};
  const capture=()=>captureKnowledgeInputs({identity,source:'player_text',p0Snapshot,perception});
  return {perception,hello,captureRef,identity,block,p0Snapshot,send,capture,setNow:value=>{now=value;}};
};
test('ordinary P0 actor joins independently current observer without P1 or promotion',()=>{
  const f=fixture(),inputs=f.capture();assert.equal(inputs.reason,null);assert.equal(inputs.association.captureRef,f.captureRef);assert.equal(inputs.ownerClaim,null);
  assert.equal(Object.isFrozen(inputs.association),true);assert.equal(Object.isFrozen(inputs.turn),true);assert.equal(assertKnowledgeCurrent(inputs,f.perception),null);
  f.send('retire_batch',[f.captureRef]);assert.equal(assertKnowledgeCurrent(inputs,f.perception),'participant_retired');
});
test('missing and forged capture cannot use raw namespaces or live conversation flags',()=>{
  const f=fixture();delete f.p0Snapshot.actor.integrations.turnKnowledge;f.p0Snapshot.actor.integrations.raw={turnKnowledge:f.block};
  assert.equal(f.capture().reason,'no_actor_capture');
  f.p0Snapshot.actor.integrations.turnKnowledge=f.block;f.p0Snapshot.actor.integrations.raw.turnKnowledge={...f.block,captureRef:randomUUID()};assert.equal(f.capture().reason,'no_actor_capture');
  delete f.p0Snapshot.actor.integrations.raw;f.p0Snapshot.actor.pedId='18';assert.equal(f.capture().reason,'wrong_actor');
});
test('host/world/stream and lease changes invalidate frozen knowledge',()=>{
  const f=fixture(),inputs=f.capture();f.block.hostRunId=randomUUID();assert.equal(f.capture().reason,'host_mismatch');f.block.hostRunId=f.hello.hostRunId;
  f.block.worldEpoch=2;assert.equal(f.capture().reason,'world_epoch_changed');f.block.worldEpoch=1;
  f.send('world_epoch',{epoch:2,reason:'timeline_change'});assert.equal(assertKnowledgeCurrent(inputs,f.perception),'world_epoch_changed');
  const other=fixture(),frozen=other.capture();other.setNow(3002);assert.equal(assertKnowledgeCurrent(frozen,other.perception),'channel_unhealthy');
});
test('observer observations and matching salience revisions freeze before later arrivals',()=>{
  const f=fixture();const fire=()=>f.send('signal',{signalId:randomUUID(),producer:'shooting',producerSequence:f.perception.producers.get('shooting')+1||1,kind:'firing',target:null,source:f.captureRef,gameTick:10,ageMs:0,facts:{}});
  assert.equal(fire(),true);const frozen=f.capture();assert.ok(frozen.pairs.length>0);const before=JSON.stringify(frozen);
  f.setNow(100);fire();f.block.sampledGameTick=100;assert.equal(JSON.stringify(frozen),before);assert.equal(frozen.association.sampledGameTick,10);
  for(const pair of frozen.pairs) {assert.equal(pair.observation.revision,pair.decision.revision);assert.equal(Object.isFrozen(pair.observation.claims),true);assert.equal(pair.situation.activity,'unknown');assert.equal(Object.isFrozen(pair.situation),true);}
});
test('actor capture schema is closed and ownership cannot be inferred',()=>{
  const f=fixture();for(const patch of [{version:2},{characterId:randomUUID()},{worldEpoch:0},{sampledGameTick:-1},{encounterId:randomUUID()}]) assert.equal(Boolean(validateActorCapture({...f.block,...patch})),false);
  f.perception.observerIndex.set(f.captureRef,Object.freeze({captureRef:f.captureRef,kind:'ped',owned:true,encounterId:randomUUID(),incarnationId:randomUUID()}));assert.equal(f.capture().reason,'owner_unverified');
});

import { stockHarness } from './stock-harness.mjs';
test('actual OpenAI P0 boundary freezes private inputs synchronously before preparation',async()=>{
  const h=await stockHarness('openai',{config:{persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}}});
  const f=fixture();let captured=null;h.runtime.captureKnowledgeInputs=input=>{captured=input;return f.capture();};
  const session=await h.openAIControllerSession({actorContext:f.p0Snapshot.actor});
  const native={pedId:'17',turnId:'p0-freeze',generationId:1,sessionNonce:1};
  const result=session.connection.beginTurn({identity:native,source:'player_mic',context:{actor:f.p0Snapshot.actor,revision:7}});
  assert.equal(captured.identity.turnId,'p0-freeze');assert.equal(captured.p0Snapshot.revision,7);assert.equal(Object.isFrozen(captured.p0Snapshot.actor.integrations.turnKnowledge),true);
  f.block.sampledGameTick=99;assert.equal(captured.p0Snapshot.actor.integrations.turnKnowledge.sampledGameTick,10);
  await result;assert.equal(typeof h.runtime.hostFor(session.connection).prepareTurn,'function');session.connection.close();
});

test('disabled-service actual Luna decision context excludes captured private join evidence',async()=>{
  const h=await stockHarness('openai',{config:{persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}}});
  const f=fixture();let prior=[{role:'assistant',content:'History at P0'}];
  h.runtime.history.readForSession=()=>prior;
  h.runtime.intelligence={captureKnowledgeInputs:input=>{prior=[{role:'assistant',content:'Later history'}];return captureKnowledgeInputs({...input,perception:f.perception});}};let request=null;
  h.runtime.services.decide=async options=>{request=options;return {dialogue:'Hello.',command:''};};
  h.runtime.services.speak=async ({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
  const session=await h.openAIControllerSession({actorContext:f.p0Snapshot.actor});session.autoNativeAcks();
  h.context.knowledgeInput={pedId:'17',speaker:f.p0Snapshot.actor,text:'Hello.'};const turn=await h.evaluate('ib(knowledgeInput)');
  const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
  assert.equal(result.status,'completed');assert.ok(request);
  assert.deepEqual(request.history,[{role:'assistant',content:'History at P0'}]);
  const text=JSON.stringify(request.context);for(const secret of ['turnKnowledge',f.captureRef,f.hello.hostRunId,'knowledgeInputs','psStreamId']) assert.equal(text.includes(secret),false);
  session.connection.close();
});

import { claim,worldProfileId } from './identity-fixtures.mjs';
import { normalizeIdentityConfig } from '../src/identity/identityContract.mjs';
test('owned candidate requires captured encounter/incarnation and independent P1 host without doing proof work',()=>{
  const f=fixture(),proof=claim(),encounterId=randomUUID();
  f.perception.anchors.get(f.captureRef).owned=true;
  f.perception.observerIndex.set(f.captureRef,Object.freeze({captureRef:f.captureRef,kind:'ped',owned:true,encounterId,incarnationId:proof.incarnationId}));
  Object.assign(f.block,{encounterId,incarnationId:proof.incarnationId});
  Object.assign(f.p0Snapshot.actor.integrations,{characterProfile:{version:1,encounterId},sessionIdentity:proof});
  const ownerEvidence={hostContext:f.hello,verify:()=>{throw new Error('freeze cannot await proof');}};
  const input={identity:f.identity,source:'player_text',p0Snapshot:f.p0Snapshot,perception:f.perception,identityConfig:normalizeIdentityConfig({enabled:true,worldProfileId}),ownerEvidence};
  const frozen=captureKnowledgeInputs(input);assert.equal(frozen.reason,null);assert.equal(frozen.ownerClaim.incarnationId,proof.incarnationId);assert.equal(Object.hasOwn(frozen,'characterId'),false);
  ownerEvidence.hostContext={...f.hello,hostRunId:randomUUID()};assert.equal(captureKnowledgeInputs(input).reason,'owner_unverified');
  ownerEvidence.hostContext=f.hello;proof.incarnationId=randomUUID();assert.equal(captureKnowledgeInputs(input).reason,'owner_unverified');assert.notEqual(frozen.ownerClaim.incarnationId,proof.incarnationId);
});


import {selectKnowledge} from '../src/context/knowledgeSelector.mjs';
test('first owned candidate stays private until matching fresh P1 proof and never resamples',()=>{
 const f=fixture(),proof=claim(),encounterId=randomUUID();
 f.perception.anchors.get(f.captureRef).owned=true;
 f.perception.observerIndex.set(f.captureRef,Object.freeze({captureRef:f.captureRef,kind:'ped',owned:true,encounterId,incarnationId:proof.incarnationId}));
 Object.assign(f.block,{encounterId,incarnationId:proof.incarnationId});
 Object.assign(f.p0Snapshot.actor.integrations,{characterProfile:{version:1,encounterId},sessionIdentity:proof});
 f.send('signal',{signalId:randomUUID(),producer:'shooting',producerSequence:1,kind:'firing',target:null,source:f.captureRef,gameTick:10,ageMs:0,facts:{}});
 const evidence={hostContext:null,isCurrent:()=>true},binding={bindingId:randomUUID(),bindingRevision:1,characterId:randomUUID(),claim:proof};
 const identityService={evidence,bindings:{get:()=>binding}};
 const inputs=captureKnowledgeInputs({identity:f.identity,source:'player_text',p0Snapshot:f.p0Snapshot,perception:f.perception,identityConfig:normalizeIdentityConfig({enabled:true,worldProfileId}),ownerEvidence:evidence});
 assert.ok(inputs.pairs.length);assert.equal(inputs.ownerPendingProof,true);assert.equal(selectKnowledge(inputs).selected.length,0);
 const snapshot={nativeIdentity:f.identity,bindingId:binding.bindingId,bindingRevision:1,resolution:{kind:'persistent',characterId:binding.characterId}};
 const release=(patch={})=>releaseOwnedKnowledge(inputs,{identity:f.identity,snapshot,identityService,perception:f.perception,...patch});
 assert.equal(release().reason,'owner_unverified');evidence.hostContext=f.hello;
 const captured=JSON.stringify(inputs.pairs);
 f.send('signal',{signalId:randomUUID(),producer:'shooting',producerSequence:2,kind:'firing',target:null,source:f.captureRef,gameTick:11,ageMs:0,facts:{}});
 const released=release();assert.equal(assertOwnedKnowledgeCurrent(released,{identity:f.identity,snapshot,identityService,perception:f.perception}),null);assert.equal(released.reason,null);assert.equal(released.ownerPendingProof,false);assert.equal(JSON.stringify(released.pairs),captured);assert.ok(selectKnowledge(released).selected.length);
 for(const patch of [{snapshot:{...snapshot,bindingId:randomUUID()}},{snapshot:{...snapshot,bindingRevision:2}},{snapshot:{...snapshot,nativeIdentity:{...f.identity,generationId:2}}},{identity:{...f.identity,sessionNonce:2}}])assert.equal(release(patch).reason,'owner_unverified');
 evidence.isCurrent=()=>false;assert.equal(assertOwnedKnowledgeCurrent(released,{identity:f.identity,snapshot,identityService,perception:f.perception}),'owner_unverified');assert.equal(release().reason,'owner_unverified');evidence.isCurrent=()=>true;
 binding.claim={...proof,incarnationId:randomUUID()};assert.equal(release().reason,'owner_unverified');binding.claim=proof;
 evidence.hostContext={...f.hello,worldEpoch:2};assert.equal(release().reason,'owner_unverified');evidence.hostContext=f.hello;
 f.send('retire_batch',[f.captureRef]);assert.equal(release().reason,'owner_unverified');assert.equal(inputs.ownerPendingProof,true);
});


test('actual Essential preparation releases the captured candidate into the launched private turn',async()=>{
 const h=await stockHarness('openai',{config:{persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}}});
 const candidate=Object.freeze({version:1,ownerPendingProof:true,pairs:Object.freeze([])}),released=Object.freeze({...candidate,ownerPendingProof:false});
 let releaseCall=null,finalized=null;
 h.runtime.captureKnowledgeInputs=()=>candidate;
 h.runtime.releaseOwnedKnowledge=(inputs,identity,snapshot)=>{releaseCall={inputs,identity,snapshot};return released;};
 const finalize=h.runtime.services.finalizeKnowledgeFrame;
 h.runtime.services.finalizeKnowledgeFrame=(turn,options)=>{finalized=turn.knowledgeInputs;return finalize(turn,options);};
 h.runtime.services.decide=async()=>({dialogue:'Hello.',command:''});
 h.runtime.services.speak=async({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const session=await h.openAIControllerSession();session.autoNativeAcks();
 h.context.ownedReleaseInput={pedId:'17',speaker:{pedId:'17'},text:'Hello.'};const turn=await h.evaluate('ib(ownedReleaseInput)');
 const identity={pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1};
 const result=await session.connection.whenSettled(identity);
 assert.equal(result.status,'completed');assert.equal(releaseCall.inputs,candidate);assert.deepEqual(releaseCall.identity,identity);assert.equal(releaseCall.snapshot,undefined);assert.equal(finalized,released);
 session.connection.close();
});


test('delivery item fences use captured revisions, current source lifetimes and original expiry',()=>{
 const f=fixture();f.send('signal',{signalId:randomUUID(),producer:'shooting',producerSequence:1,kind:'firing',target:null,source:f.captureRef,gameTick:10,ageMs:0,facts:{}});
 const inputs=f.capture(),frame={delivery:selectKnowledge(inputs).selected};assert.ok(frame.delivery.length);assert.equal(assertKnowledgeItemsCurrent(inputs,frame,f.perception),null);
 assert.equal(assertKnowledgeItemsCurrent(inputs,{delivery:[{...frame.delivery[0],revision:2}]},f.perception),'revision_mismatch');
 const shortLived={...inputs,pairs:inputs.pairs.map(pair=>({...pair,observation:{...pair.observation,expiresAtMonotonicMs:100}}))};f.setNow(100);
 assert.equal(assertKnowledgeItemsCurrent(shortLived,frame,f.perception),'observation_expired');
 f.setNow(1);f.perception.lastReceipt=1;f.send('retire_batch',[f.captureRef]);assert.equal(assertKnowledgeItemsCurrent(inputs,frame,f.perception),'participant_retired');
});


test('pending proof cannot upgrade a missing or unowned association',()=>{
 for(const association of [null,{owned:false}])assert.equal(releaseOwnedKnowledge({ownerPendingProof:true,association},{}).reason,'owner_unverified');
 assert.equal(assertOwnedKnowledgeCurrent({association:{owned:false}},{}),null);
});


test('capture counts missing salience metadata without evaluating or consuming grants',()=>{
 const f=fixture();f.send('signal',{signalId:randomUUID(),producer:'shooting',producerSequence:1,kind:'firing',target:null,source:f.captureRef,gameTick:10,ageMs:0,facts:{}});
 const first=f.capture();assert.equal(first.captureDiagnostics.retainedPairs,1);assert.ok(first.captureDiagnostics.poolBytes>0);
 const ledger=[...f.perception.salience.ledger.values()][0];delete ledger.pair;f.perception.salience.decisions.clear();
 const frozen=f.capture();assert.equal(frozen.pairs.length,0);assert.equal(frozen.captureDiagnostics.noMatchingSalience,1);assert.equal(ledger.consumedBy.size,0);assert.ok(Object.isFrozen(frozen.captureDiagnostics));
});
