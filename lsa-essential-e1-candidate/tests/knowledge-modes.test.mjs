import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeConfig} from '../src/config/e1Config.mjs';
import {normalizeDialogueKnowledge,dialogueKnowledgeContractSupported} from '../src/config/dialogueKnowledge.mjs';
import {createRuntime} from '../src/integration/essentialGlue.mjs';
import {verifyPerceptionContract} from '../tools/verifyPerceptionContract.mjs';
import {evaluateSalience,normalizeSalienceSituation} from '../src/perception/salienceEngine.mjs';
function fixture(){
 const observer=randomUUID(),run=randomUUID(),target=randomUUID();
 const observation={version:1,observationId:randomUUID(),episodeId:randomUUID(),revision:1,observer:{captureRef:observer,kind:'ped'},observedAt:{nativeRun:run,gameTick:10,receivedUtc:'2026-10-08T00:00:00.000Z'},expiresAtMonotonicMs:60000,eventType:'injury',severity:'danger',recognizedCharacterIds:[],claims:[{claimId:randomUUID(),kind:'injured',certainty:'supported',evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:10},target:{captureRef:target,kind:'ped'},details:{damageDelta:1,armourDelta:0}}]};
 const situation=normalizeSalienceSituation({nowMonotonicMs:1000});
 return {association:{captureRef:observer},psAdapterEpoch:run,frozenAt:1000,liveReferences:{[observer]:'ped',[target]:'ped'},pairs:[{observation,situation,decision:evaluateSalience(observation,situation)}]};
}

const contract={available:true,frameVersion:1,hostContextVersion:1,observerIndexVersion:1,observerSituationVersion:1};
test('dialogue knowledge is a closed independent default-off configuration',()=>{
 assert.deepEqual(normalizeConfig({},{}).dialogueKnowledge,{mode:'off'});
 for(const mode of ['off','shadow','active']){const config=normalizeConfig({dialogueKnowledge:{mode}},{});assert.equal(config.dialogueKnowledge.mode,mode);assert.equal(config.intelligence.mode,'off');assert.ok(Object.isFrozen(config.dialogueKnowledge));}
 for(const value of [null,[],true,{mode:'on'},{mode:'ACTIVE'},{enabled:true},{mode:'active',delivery:true}])assert.throws(()=>normalizeDialogueKnowledge(value),TypeError);
});
test('knowledge build support requires exact extension versions and existing perception pins',async()=>{
 const perception=await verifyPerceptionContract();assert.equal(dialogueKnowledgeContractSupported(contract,perception),true);
 for(const patch of [{available:false},{frameVersion:2},{observerIndexVersion:0},{observerSituationVersion:2},{hostContextVersion:2},{extra:true}])assert.equal(dialogueKnowledgeContractSupported({...contract,...patch},perception),false);
 assert.equal(dialogueKnowledgeContractSupported(contract,{...perception,dllSha256:'bad'}),false);
 assert.equal(dialogueKnowledgeContractSupported(undefined,perception),false);
});
test('off and shadow send identical base frames; supported preview exposes only immutable scalars',()=>{
 const inputs=fixture(),options={input:'What happened?',history:[],source:'player_text'};let before=null;
 for(const mode of ['off','shadow','active']){
  const runtime=createRuntime(normalizeConfig({dialogueKnowledge:{mode},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},{}));
  runtime.dialogueKnowledgeBuildSupported=true;
  runtime.intelligence={runtime:{observerIndexVersion:1,observerSituationVersion:1,hostContext:{hostContextVersion:1}},assertKnowledgeCurrent:()=>null};
  const turn={identity:{pedId:'17',turnId:'turn',generationId:1,sessionNonce:1},context:{actor:{pedId:'17'},listener:null,world:{},referenceMap:{}},knowledgeInputs:inputs};
  const frozen=JSON.stringify(inputs),frame=runtime.services.finalizeKnowledgeFrame(turn,options);
  const body=JSON.stringify(frame.modelAllocation);if(before)assert.equal(body,before);before=body;
  assert.equal(frame.delivery.length,0);assert.equal(JSON.parse(frame.modelAllocation.scene).lanes.PERCEIVED.observations.length,0);assert.equal(JSON.stringify(inputs),frozen);
  if(mode==='off'){assert.equal(turn.knowledgePreview,null);assert.equal(turn.knowledgeFallbackReason,'disabled');}
  else {assert.equal(turn.knowledgePreview.selectedObservations,1);assert.match(turn.knowledgePreview.frameHash,/^[a-f0-9]{64}$/);assert.ok(Object.isFrozen(turn.knowledgePreview));assert.deepEqual(Object.keys(turn.knowledgePreview).sort(),['frameBytes','frameHash','selectedObservations']);}
  if(mode==='active')assert.equal(turn.knowledgeFallbackReason,'unsupported_contract');
 }
});
test('missing support, stale join and failed projection preserve safe ordinary dialogue',()=>{
 const runtime=createRuntime(normalizeConfig({dialogueKnowledge:{mode:'shadow'},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},{}));
 const turn=()=>({identity:{pedId:'17',turnId:'turn',generationId:1,sessionNonce:1},context:{actor:{pedId:'17'},world:{}},knowledgeInputs:fixture()});
 const options={input:'Hello',history:[],source:'player_text'};
 let current=turn();runtime.services.finalizeKnowledgeFrame(current,options);assert.equal(current.knowledgeFallbackReason,'unsupported_contract');
 runtime.dialogueKnowledgeBuildSupported=true;runtime.intelligence={runtime:{observerIndexVersion:1,observerSituationVersion:1,hostContext:{hostContextVersion:1}},assertKnowledgeCurrent:()=> 'world_epoch_changed'};
 current=turn();const result=runtime.services.finalizeKnowledgeFrame(current,options);assert.equal(current.knowledgeFallbackReason,'world_epoch_changed');assert.equal(current.knowledgePreview,null);assert.equal(result.modelAllocation.messages[0].content,'Hello');
});

import {sanitizeTelemetryData} from '../src/observability/eventContract.mjs';
test('knowledge preview telemetry excludes all private payloads and freeform reasons',()=>{
 assert.deepEqual(sanitizeTelemetryData({knowledgeMode:'shadow',preview:true,selectedObservations:2,frameBytes:1024,frameHash:'a'.repeat(64),reason:'world_epoch_changed',pairs:[{secret:'private'}],canon:'private',prompt:'private',ownerClaim:'private'}),{knowledgeMode:'shadow',preview:true,selectedObservations:2,frameBytes:1024,frameHash:'a'.repeat(64),reason:'world_epoch_changed'});
 assert.deepEqual(sanitizeTelemetryData({reason:'private secret',frameHash:'private secret',knowledgeMode:'invented'}),{});
});
