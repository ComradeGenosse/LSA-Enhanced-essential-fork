import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './p2-fixtures.mjs';
import { actor,identity } from './identity-fixtures.mjs';
const setup=async t=>{
  const f=await fixture(t,{config:{actingEnabled:true}}),profile=await f.service.promote(),owned=f.native.owned.get(profile.promotion.ownerAlias),native=identity();
  const a=actor('17',owned.claim,{integrations:{sessionIdentity:owned.claim,characterProfile:{version:1,encounterId:owned.encounterId}}});
  const voice=f.voice.resolve(native,a);f.service.session(native,a,voice);
  const inputs=f.service.captureTurnInputs(native,a);
  const binding=f.identity.bindings.bind(native,owned.claim,{characterId:profile.characterId},()=>true).binding;
  const verified={resolution:{kind:'persistent',characterId:profile.characterId},bindingId:binding.bindingId};
  return {...f,profile,owned,native,a,voice,inputs,verified};
};
test('matching fresh proof releases the captured canon revision and acting direction after edits',async t=>{
  const f=await setup(t);await f.service.edit(f.profile.characterId,{name:'Changed after freeze',personality:{description:'Changed acting',traits:['bold']}},f.profile.revision);
  const turn={identity:f.native,characterInputs:f.inputs,context:{actor:f.a,listener:null,systemInstruction:'Essential rules'}};
  await f.service.prepareTurn(turn,f.verified,f.voice);
  assert.equal(turn.context.actor.characterProfile.canon.name,f.profile.name);assert.equal(turn.context.actor.characterProfile.profileRevision,f.profile.revision);
  assert.equal(turn.speechProfile.instructions.includes('Changed acting'),false);assert.equal(Object.isFrozen(f.inputs.profile.memories),true);
});
test('candidate never supplies persistent canon for a mismatched incarnation or revoked proof',async t=>{
  const f=await setup(t);
  const mismatch={identity:f.native,characterInputs:{...f.inputs,claim:{...f.inputs.claim,incarnationId:randomUUID()}},context:{actor:f.a,listener:null,systemInstruction:'Essential rules'}};
  await f.service.prepareTurn(mismatch,f.verified,f.voice);assert.notEqual(mismatch.context.actor.characterProfile?.authority,'player_authored');
  f.evidence.retire(f.owned.pedId);
  const turn={identity:f.native,characterInputs:f.inputs,context:{actor:f.a,listener:null,systemInstruction:'Essential rules'}};
  await f.service.prepareTurn(turn,f.verified,f.voice);assert.notEqual(turn.context.actor.characterProfile?.authority,'player_authored');
  assert.equal(JSON.stringify(turn.context).includes(f.profile.characterId),false);
});
test('profile absent at freeze stays absent even if loaded or found during preparation',async t=>{
  const f=await setup(t),inputs={...f.inputs,profile:null};
  const turn={identity:f.native,characterInputs:inputs,context:{actor:f.a,listener:null,systemInstruction:'Essential rules'}};
  await f.service.prepareTurn(turn,f.verified,f.voice);assert.equal(turn.context.actor.characterProfile.authority,'session_assigned');
});

import { stockHarness } from './stock-harness.mjs';
test('actual Luna request retains P0 canon across an edit while fresh owner proof is pending',async t=>{
  const f=await setup(t),{trustedNamespaces,...persistentIdentity}=f.config.persistentIdentity;
  const h=await stockHarness('openai',{identityEvidence:f.evidence,profileStore:f.store,nativeOwner:f.native,config:{persistentIdentity,promotedCharacters:f.config.promotedCharacters}});t.after(()=>h.runtime.identityService.close());
  await h.runtime.characterService.initialize();let release,reached;
  const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{reached=resolve;});
  const original=h.runtime.identityService.prepare.bind(h.runtime.identityService);
  let prepared,captured;const captureOriginal=h.runtime.captureCharacterInputs;h.runtime.captureCharacterInputs=(...args)=>{captured=captureOriginal(...args);return captured;};
  h.runtime.identityService.prepare=async options=>{reached();await gate;prepared=await original(options);return prepared;};let request;
  h.runtime.services.decide=async options=>{request=options;return {dialogue:'Hello.',command:''};};
  h.runtime.services.speak=async ({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
  const session=await h.openAIControllerSession({actorContext:f.a});session.autoNativeAcks();
  h.context.frozenInput={pedId:'17',speaker:f.a,text:'Hello.'};const turn=await h.evaluate('ib(frozenInput)');await waiting;
  await f.service.edit(f.profile.characterId,{name:'Late edited name'},f.profile.revision);release();
  const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
  assert.equal(result.status,'completed');assert.equal(prepared.snapshot.resolution.kind,'persistent',prepared.snapshot.resolution.reason);assert.ok(captured.profile,'P0 candidate missing');assert.equal(request.context.actor.characterProfile.canon.name,f.profile.name);assert.equal(request.context.actor.characterProfile.profileRevision,f.profile.revision);
  const lanes=JSON.parse(request.knowledgeProjection.modelAllocation.scene).lanes;
  assert.equal(lanes.SELF.canon.name,f.profile.name);
  assert.equal(JSON.stringify(request.knowledgeProjection.modelAllocation).includes(f.profile.characterId),false);
  assert.equal(request.context.systemInstruction.includes(f.profile.name),false,'canon must not also be embedded in the behavior instructions');
  session.connection.close();
});
