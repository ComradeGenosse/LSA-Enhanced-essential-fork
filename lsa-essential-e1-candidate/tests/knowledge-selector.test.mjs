import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {selectKnowledge} from '../src/context/knowledgeSelector.mjs';
import {evaluateSalience,normalizeSalienceSituation} from '../src/perception/salienceEngine.mjs';
function fixture(){
 const observer=randomUUID(),run=randomUUID(),target=randomUUID();
 const observation={version:1,observationId:randomUUID(),episodeId:randomUUID(),revision:1,observer:{captureRef:observer,kind:'ped'},observedAt:{nativeRun:run,gameTick:10,receivedUtc:'2026-10-08T00:00:00.000Z'},expiresAtMonotonicMs:60000,eventType:'injury',severity:'danger',recognizedCharacterIds:[],claims:[{claimId:randomUUID(),kind:'injured',certainty:'supported',evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:10},target:{captureRef:target,kind:'ped'},details:{damageDelta:1,armourDelta:0}}]};
 const situation=normalizeSalienceSituation({nowMonotonicMs:1000});
 return {association:{captureRef:observer},psAdapterEpoch:run,frozenAt:1000,liveReferences:{[observer]:'ped',[target]:'ped'},pairs:[{observation,situation,decision:evaluateSalience(observation,situation)}]};
}
test('context candidates reach projection even when autonomous response is none',()=>{
 const inputs=fixture(),result=selectKnowledge(inputs);
 assert.equal(inputs.pairs[0].decision.response,'none');
 assert.equal(result.observations.length,1);
 assert.equal(result.observations[0].claims[0].subject,'anonymous person');
 assert.equal(result.selected[0].decisionKey,inputs.pairs[0].decision.decisionKey);
 const text=JSON.stringify(result.observations);
 assert.ok(!text.includes(inputs.pairs[0].observation.observationId));
 assert.ok(!text.includes(inputs.pairs[0].observation.claims[0].target.captureRef));
 assert.ok(Object.isFrozen(result.observations));
});
test('malformed decisions fail closed without crashing ranking',()=>{
 for(const patch of [{reasons:null},{reasons:['invented']},{memory:'write'},{extra:true}]){
  const inputs=fixture();Object.assign(inputs.pairs[0],{decision:{...inputs.pairs[0].decision,...patch}});
  const result=selectKnowledge(inputs);assert.equal(result.observations.length,0);assert.equal(result.omissions.no_matching_salience,1);
 }
});
test('expired, mismatched revision, duplicate, and retired target evidence is excluded',()=>{
 for(const mutate of [i=>{i.frozenAt=60000;},i=>{i.pairs[0].decision={...i.pairs[0].decision,revision:2};},i=>{i.pairs.push(i.pairs[0]);},i=>{i.liveReferences={};}]){
  const inputs=fixture();mutate(inputs);assert.equal(selectKnowledge(inputs).observations.length,0);
 }
});
test('disabled perceived lane has no selected keys',()=>{
 assert.deepEqual(selectKnowledge(fixture(),{includePerceived:false}).selected,[]);
});
