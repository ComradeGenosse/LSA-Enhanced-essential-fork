import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ShadowRuntime } from '../src/perception/shadowRuntime.mjs';
import { CAPABILITIES } from '../src/perception/contracts.mjs';
import { captureKnowledgeInputs,assertKnowledgeCurrent,validateActorCapture } from '../src/context/knowledgeInputs.mjs';
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
  const f=fixture();h.runtime.intelligence={captureKnowledgeInputs:input=>captureKnowledgeInputs({...input,perception:f.perception})};let request=null;
  h.runtime.services.decide=async options=>{request=options;return {dialogue:'Hello.',command:''};};
  h.runtime.services.speak=async ({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
  const session=await h.openAIControllerSession({actorContext:f.p0Snapshot.actor});session.autoNativeAcks();
  h.context.knowledgeInput={pedId:'17',speaker:f.p0Snapshot.actor,text:'Hello.'};const turn=await h.evaluate('ib(knowledgeInput)');
  const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
  assert.equal(result.status,'completed');assert.ok(request);
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
