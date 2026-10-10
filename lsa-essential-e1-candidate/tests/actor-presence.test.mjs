import test from 'node:test';
import assert from 'node:assert/strict';
import {ActorPresenceStore} from '../src/context/actorPresence.mjs';
import {projectCompatibility} from '../src/context/knowledgeRenderer.mjs';
import {stockHarness} from './stock-harness.mjs';

test('private presence tracks exact values, rejects malformed alias winners and does not serialize',()=>{
 const store=new ActorPresenceStore(),actor={isArmed:false,hasHeldItem:false,gender:'male'};
 store.capture(actor,{pedArmed:false,pedGender:'male',hasHeldItem:'invalid',pedHasHeldItem:false},'actor');
 assert.deepEqual(store.read(actor),['gender','isArmed']);
 assert.equal(JSON.stringify(actor),'{"isArmed":false,"hasHeldItem":false,"gender":"male"}');
 const next={...actor};store.copy(actor,next);assert.deepEqual(store.read(next),['gender','isArmed']);
 actor.isArmed=true;assert.deepEqual(store.read(actor),['gender']);
 store.capture({...actor},actor);assert.deepEqual(store.read(actor),['gender']);
 assert.deepEqual(store.read(next),['gender','isArmed']);
});
test('stock AO/CO/direct and hydrated normalizers retain explicit false and omission semantics',async()=>{
 const h=await stockHarness();
 for(const [code,expected] of [
  ['AO({pedId:"17"})',[]],['AO({pedId:"17",pedArmed:false,isIndoors:false,pedHasHeldItem:false,pedGender:"male",pedAgeRange:"old"})',['gender','ageRange','isArmed','isIndoors','hasHeldItem']],
  ['CO({playerArmed:false,playerHasHeldItem:false})',['isArmed','hasHeldItem']],
  ['ia({pedId:"17",isArmed:false},"speaker")',['isArmed']],
  ['eo({pedId:"17",isArmed:false,armed:true},"speaker")',['isArmed']],
  ['eo({pedId:"17",armed:true},"speaker")',['isArmed']],
  ['eo({pedId:"17"},"speaker")',[]],
  ['ia(AO({pedId:"17"}),"speaker")',[]],
  ['pd(AO({pedId:"17",pedArmed:false}))',['isArmed']],
  ['pd(AO({pedId:"17"}))',[]],
  ['eo(eo({pedId:"17"},"speaker"),"speaker")',[]],
 ]){
  const actor=h.evaluate(code),presence=h.runtime.actorSourcePresence(actor);assert.deepEqual(presence,expected,code);
  const view=projectCompatibility({actor,presence});assert.equal(view.actor.isArmed,expected.includes('isArmed')?actor.isArmed:'unknown');
  const clean=h.runtime.modelActor(actor);assert.deepEqual(h.runtime.actorSourcePresence(clean),expected);
  assert.ok(!JSON.stringify(clean).includes('sourcePresence'));
 }
});
test('actual P0 snapshot preserves presence privately across clone and later source mutations',async()=>{
 const h=await stockHarness('openai',{config:{persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}}});
 const actor=h.evaluate('AO({pedId:"17",pedArmed:false,pedGender:"female",pedAgeRange:"young"})');
 let captured=null;h.runtime.captureKnowledgeInputs=input=>{captured=input;return null;};
 const session=await h.openAIControllerSession({actorContext:actor});
 session.connection.beginTurn({identity:{pedId:'17',turnId:'presence-freeze',generationId:1,sessionNonce:1},source:'player_mic',context:{actor}});
 assert.deepEqual(h.runtime.actorSourcePresence(captured.p0Snapshot.actor),['gender','ageRange','isArmed']);
 actor.isArmed=true;assert.equal(captured.p0Snapshot.actor.isArmed,false);assert.ok(h.runtime.actorSourcePresence(captured.p0Snapshot.actor).includes('isArmed'));
 assert.ok(!JSON.stringify(captured.p0Snapshot).includes('sourcePresence'));
 session.connection.close();
});
test('launched real Essential turn carries frozen presence outside the model context',async()=>{
 const h=await stockHarness('openai',{config:{persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}}});
 const actor=h.evaluate('ia({pedId:"17",isArmed:false,gender:"male"},"speaker")');
 const hostFor=h.runtime.hostFor;let seen=null,modelContext=null;
 h.runtime.hostFor=connection=>{const host=hostFor(connection);return {...host,prepareTurn:async(turn,...args)=>{seen=turn.sourcePresence;assert.ok(Object.isFrozen(seen));return host.prepareTurn(turn,...args);}};};
 h.runtime.services.decide=async options=>{modelContext=options.context;return {dialogue:'Hello.',command:''};};
 h.runtime.services.speak=async({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const session=await h.openAIControllerSession({actorContext:actor});session.autoNativeAcks();
 h.context.presenceTurn={pedId:'17',speaker:actor,text:'Hello.'};const turn=await h.evaluate('ib(presenceTurn)');
 const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.equal(result.status,'completed');assert.deepEqual(seen,['gender','isArmed']);assert.ok(!JSON.stringify(modelContext).includes('sourcePresence'));
 session.connection.close();
});
