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
test('PS4 candidate projection is independent of autonomous speech eligibility',()=>{
 const inputs=fixture(),result=selectKnowledge(inputs);
 assert.equal(inputs.pairs[0].decision.response,'eligible',
   'a witnessed stranger injury can now prompt speech without changing PS4 context priority');
 assert.equal(inputs.pairs[0].decision.context,'candidate');
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


test('perceived selection explicitly reserves safety bytes before routine context',()=>{
 const routine=selectKnowledge(fixture());assert.deepEqual(routine.safetyBudget,{reservedBytes:2048,usedBytes:0,remainingBytes:2048});
 const inputs=fixture();inputs.pairs[0].observation.claims[0].target={captureRef:inputs.association.captureRef,kind:'ped'};inputs.pairs[0].observation.claims[0].evidence.channel='self';inputs.pairs[0].decision=evaluateSalience(inputs.pairs[0].observation,inputs.pairs[0].situation);
 assert.equal(inputs.pairs[0].decision.context,'must_include');const selected=selectKnowledge(inputs);assert.equal(selected.selected.length,1);assert.ok(selected.safetyBudget.usedBytes>0);assert.equal(selected.safetyBudget.remainingBytes,Math.max(0,2048-selected.safetyBudget.usedBytes));assert.ok(Object.isFrozen(selected.safetyBudget));
});

test('routine pressure preserves safety priority and deterministic whole-item omissions',()=>{
 const inputs=fixture(),original=inputs.pairs[0];inputs.pairs=[];
 for(let index=0;index<101;index++){
  const observation=structuredClone(original.observation);observation.observationId=randomUUID();observation.episodeId=randomUUID();
  if(index===100){observation.claims[0].target={captureRef:inputs.association.captureRef,kind:'ped'};observation.claims[0].evidence.channel='self';}
  inputs.pairs.push({observation,situation:original.situation,decision:evaluateSalience(observation,original.situation)});
 }
 const before=JSON.stringify(inputs),result=selectKnowledge(inputs);assert.equal(result.selected.length,8);assert.equal(result.selected[0].observationId,inputs.pairs[100].observation.observationId);assert.equal(result.omissions.budget_excluded,93);assert.equal(result.omissions.safety_overflow,0);assert.ok(result.safetyBudget.usedBytes>0);assert.deepEqual(selectKnowledge(inputs),result);assert.equal(JSON.stringify(inputs),before);
});


import {renderKnowledge} from '../src/context/knowledgeRenderer.mjs';
import {buildRequest} from '../src/context/essentialDecision.mjs';
import {jsonBytes,KNOWLEDGE_LIMITS} from '../src/context/knowledgeSelector.mjs';
test('PR21 T44 T45 safety survives combined canon/history/event pressure with deterministic serialized requests',()=>{
 const inputs=fixture(),original=inputs.pairs[0];inputs.pairs=[];
 for(let index=0;index<101;index++){
  const observation=structuredClone(original.observation);observation.observationId=randomUUID();observation.episodeId=randomUUID();
  if(index===100){observation.claims[0].target={captureRef:inputs.association.captureRef,kind:'ped'};observation.claims[0].evidence.channel='self';}
  inputs.pairs.push({observation,situation:original.situation,decision:evaluateSalience(observation,original.situation)});
 }
 const safety=inputs.pairs.at(-1);assert.equal(safety.decision.context,'must_include');
 const profile={name:'Mira',gender:'female',ageBand:'adult',nicknames:[],personality:{description:'Reserved',traits:[]},biography:'Authored biography',relationship:{state:'neutral',description:''},memories:Array.from({length:128},(_,index)=>({memoryId:'pin-'+String(index).padStart(3,'0'),selectedForContext:true,importance:50,category:'event',text:('Pinned '+index+' '+ '\u0001😀').repeat(70)}))};
 const history=Array.from({length:30},(_,index)=>({role:index%2?'assistant':'user',content:'History '+index+' '+ '\u0001😀'.repeat(500)}));
 const args={knowledgeInputs:inputs,includePerceived:true,profile,persistent:true,history,source:'player_text',input:'Player '+ '\u0001'.repeat(10000)};
 const before=JSON.stringify(args),frame=renderKnowledge(args),lanes=JSON.parse(frame.modelAllocation.scene).lanes;
 assert.equal(frame.delivery[0].decisionKey,safety.decision.decisionKey);assert.deepEqual(lanes.PERCEIVED.observations[0].claims[0],{modality:'self',certainty:'supported',kind:'injured',subject:'self'});
 assert.ok(frame.diagnostics.droppedMemoryCount>0);assert.ok(frame.diagnostics.droppedHistoryCount>0);assert.equal(frame.diagnostics.omissions.budget_excluded,93);assert.equal(frame.diagnostics.omissions.safety_overflow,0);
 assert.ok(jsonBytes(frame.modelAllocation)<=KNOWLEDGE_LIMITS.frameBytes);assert.ok(jsonBytes({SELF:lanes.SELF,RECALLED:lanes.RECALLED})<=KNOWLEDGE_LIMITS.canonBytes);
 const reordered={...args,profile:{...profile,memories:[...profile.memories].reverse()},knowledgeInputs:{...inputs,pairs:[...inputs.pairs].reverse(),liveReferences:Object.fromEntries(new Map(Object.entries(inputs.liveReferences).reverse()))}};
 const alternate=renderKnowledge(reordered);assert.deepEqual(frame.modelAllocation,alternate.modelAllocation);assert.deepEqual(frame.delivery,alternate.delivery);assert.equal(JSON.stringify(args),before);
 for(const structuredSegments of [false,true]){
  const options={model:'test',effort:'low',systemInstruction:'Trusted rules',structuredSegments};
  const body=buildRequest({...options,knowledgeProjection:frame}),other=buildRequest({...options,knowledgeProjection:alternate});
  assert.equal(JSON.stringify(body),JSON.stringify(other));assert.ok(jsonBytes(body)<=KNOWLEDGE_LIMITS.requestBytes);assert.equal(body.input.at(-1).content,args.input);
  assert.equal(JSON.stringify(body).includes(safety.decision.decisionKey),false);assert.equal(JSON.stringify(body).includes('pin-000'),false);
 }
 const allSafety={...inputs,pairs:inputs.pairs.map(pair=>{const observation=structuredClone(pair.observation);observation.claims[0].target={captureRef:inputs.association.captureRef,kind:'ped'};observation.claims[0].evidence.channel='self';return {observation,situation:pair.situation,decision:evaluateSalience(observation,pair.situation)};})};
 const overflow=selectKnowledge(allSafety);assert.equal(overflow.selected.length,8);assert.equal(overflow.omissions.safety_overflow,93);assert.deepEqual(selectKnowledge({...allSafety,pairs:[...allSafety.pairs].reverse()}),overflow);
});


test('PR21 T20 observer/run/expiry/identity/key and source/target scope reject optional evidence',()=>{
 const cases=[
  input=>{input.pairs[0].observation.observer.captureRef=randomUUID();},
  input=>{input.pairs[0].observation.observedAt.nativeRun=randomUUID();},
  input=>{input.pairs[0].observation.expiresAtMonotonicMs=input.frozenAt;},
  input=>{input.pairs[0].decision={...input.pairs[0].decision,expiresAtMonotonicMs:input.frozenAt};},
  input=>{input.pairs[0].observation.observationId=randomUUID();},
  input=>{input.pairs[0].decision={...input.pairs[0].decision,revision:2};},
  input=>{input.pairs[0].decision={...input.pairs[0].decision,decisionKey:'mismatched:'+input.pairs[0].decision.decisionKey};},
  input=>{delete input.liveReferences[input.pairs[0].observation.claims[0].target.captureRef];},
 ];
 for(const mutate of cases){const input=fixture();assert.equal(selectKnowledge(input).selected.length,1);mutate(input);const result=selectKnowledge(input);assert.deepEqual(result.observations,[]);assert.deepEqual(result.selected,[]);}
 const input=fixture();input.pairs[0].observation.claims[0].source={captureRef:input.association.captureRef,kind:'ped'};
 assert.equal(selectKnowledge(input).selected.length,1);delete input.liveReferences[input.association.captureRef];assert.equal(selectKnowledge(input).selected.length,0);
});
