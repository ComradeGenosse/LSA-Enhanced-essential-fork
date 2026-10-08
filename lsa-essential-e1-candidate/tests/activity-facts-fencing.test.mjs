import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ActivityFacts,FACT_LIMIT} from '../src/activities/activityFacts.mjs';
const fixture=()=>({characterId:randomUUID(),encounterId:randomUUID(),incarnationId:randomUUID(),hostContext:{hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1}});
const add=(facts,binding,patch={})=>facts.record({characterId:binding.characterId,activityId:randomUUID(),goalId:randomUUID(),kind:'mode_established',intent:'accompany',evidence:'mode_flag',...patch},{...binding.hostContext,encounterId:binding.encounterId,incarnationId:binding.incarnationId});
test('ACT frozen fact read requires exact host/world/body and preserves the existing evidence strength',()=>{
 const facts=new ActivityFacts(randomUUID,()=>10),binding=fixture();add(facts,binding,{kind:'completed'});const frozen=facts.factsForCharacter(binding);
 assert.equal(frozen.length,1);assert.equal(frozen[0].kind,'mode_established');assert.equal(frozen[0].evidence,'mode_flag');assert.ok(Object.isFrozen(frozen[0].provenance));
 add(facts,binding,{kind:'completed',evidence:'world_strong'});assert.equal(facts.factsForCharacter(binding).at(-1).kind,'completed');assert.equal(frozen.length,1);
 for(const patch of [{characterId:randomUUID()},{encounterId:randomUUID()},{incarnationId:randomUUID()},{hostContext:{...binding.hostContext,hostRunId:randomUUID()}},{hostContext:{...binding.hostContext,worldEpoch:2}},{hostContext:null}])assert.deepEqual(facts.factsForCharacter({...binding,...patch}),[]);
});
test('legacy UI facts cannot become knowledge; scoped reads stay bounded and retire exact encounters',()=>{
 const facts=new ActivityFacts(randomUUID,()=>10),binding=fixture(),other={...binding,encounterId:randomUUID(),incarnationId:randomUUID()};
 facts.record({characterId:binding.characterId,kind:'accepted',intent:'accompany'});assert.equal(facts.forCharacter(binding.characterId).length,1);assert.deepEqual(facts.factsForCharacter(binding),[]);
 for(let n=0;n<FACT_LIMIT+20;n++)add(facts,n%2?binding:other);assert.equal(facts.facts.length,FACT_LIMIT);assert.equal(facts.factsForCharacter(binding).length,16);
 const frozen=facts.factsForCharacter(binding);facts.retireEncounter(binding.encounterId);assert.deepEqual(facts.factsForCharacter(binding),[]);assert.equal(facts.factsForCharacter(other).length,16);assert.equal(frozen.length,16);facts.clear();assert.equal(facts.facts.length,0);
});

import {ActivityEngine} from '../src/activities/activityEngine.mjs';
import {loadCapabilityRegistry} from '../src/activities/capabilityRegistry.mjs';
import {normalizeActivityConfig} from '../src/activities/contracts.mjs';
test('actual ACT engine annotates admitted facts and clears reads on reset or retirement',()=>{
 const registry=loadCapabilityRegistry(),binding=fixture();const capabilities={hold_position:true,follow_person:true,resume_ambient:true,sit_on_ground:true};
 const engine=new ActivityEngine({registry,config:normalizeActivityConfig({mode:'on',passedProbes:registry.get('hold_position').probes}),id:randomUUID,now:()=>1000,onCommand:()=>{}});
 engine.noteHello({type:'hello',nativeRun:randomUUID(),adapterEpoch:randomUUID(),capabilities,...binding.hostContext});
 const owned={...binding,ownerAlias:'promoted.'+binding.characterId,ownershipToken:randomUUID()};
 const proposal={proposalVersion:1,proposalId:randomUUID(),source:'player_ux',subject:{characterId:binding.characterId},intent:'hold_position',slots:{},priority:'ambient',origin:{},proposedAtMs:1000};
 assert.equal(engine.assign(proposal,owned).ok,true);const frozen=engine.factsForCharacter(binding);assert.equal(frozen.length,2);assert.deepEqual(frozen.map(f=>f.kind),['instructed','accepted']);assert.equal(frozen[0].provenance.incarnationId,binding.incarnationId);
 engine.ingest({type:'lease.changed',encounterId:binding.encounterId,reason:'retired',leaseEpoch:2});assert.deepEqual(engine.factsForCharacter(binding),[]);
 add(engine.facts,binding);engine.clockReset();assert.deepEqual(engine.factsForCharacter(binding),[]);assert.equal(frozen.length,2);
 add(engine.facts,binding);engine.noteHello({clientRestart:true});assert.deepEqual(engine.factsForCharacter(binding),[]);assert.equal(engine.facts.facts.length,0);
});
