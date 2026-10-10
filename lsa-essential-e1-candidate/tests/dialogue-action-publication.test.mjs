import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {prepareDialogueActionPublication} from '../src/activities/dialogueActionPublication.mjs';
import {createRuntime} from '../src/integration/essentialGlue.mjs';
import {normalizeConfig} from '../src/config/e1Config.mjs';
const fixture=()=>{
 const identity={pedId:'17',turnId:'turn',generationId:1,sessionNonce:1},hostContext={hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1};
 const association={captureRef:randomUUID(),kind:'ped',owned:false};
 const perception={epoch:randomUUID(),stream:randomUUID(),hostContext,lastReceipt:100,now:()=>120,current:()=>true,observerIndex:new Map([[association.captureRef,association]]),anchors:new Map([[association.captureRef,{kind:'ped',observer:true}]])};
 const turn={identity,knowledgeInputs:{turn:identity,reason:null,anchorStatus:'verified_observer',ownerPendingProof:false,association,hostRunId:hostContext.hostRunId,worldEpoch:1,psAdapterEpoch:perception.epoch,psStreamId:perception.stream}};
 return {turn,perception,validated:{identityValid:true,validatedFor:{...identity},actionCount:1,actionNames:['waithere']},publishedAtMs:150,activities:{client:{runtime:{ready:true,dialogueActionVersion:1,hostContext}}}};
};
test('C05 publication uses original frozen ordinary capture and validated canonical action only',()=>{
 const f=fixture(),publication=prepareDialogueActionPublication(f);assert.ok(publication);assert.equal(publication.binding.captureRef,f.turn.knowledgeInputs.association.captureRef);assert.equal(Object.hasOwn(publication.binding,'encounterId'),false);
 f.validated.actionNames[0]='followtarget';f.turn.identity.generationId=2;assert.equal(publication.canonicalAction,'waithere');assert.equal(publication.tuple.generationId,1);assert.ok(Object.isFrozen(publication.binding.hostContext));
});
test('C05 publication omits stale, mismatched, unvalidated and unavailable original inputs',()=>{
 for(const change of [f=>f.validated.actionCount=0,f=>f.validated.actionCount=2,f=>f.validated.validatedFor.pedId='other',f=>f.validated.actionNames.push('followtarget'),f=>f.turn.knowledgeInputs.ownerPendingProof=true,f=>f.turn.knowledgeInputs.reason='owner_unverified',f=>f.perception.current=()=>false,f=>f.perception.epoch=randomUUID(),f=>f.activities.client.runtime.ready=false,f=>f.activities.client.runtime.dialogueActionVersion=null,f=>f.activities.client.runtime.hostContext={...f.perception.hostContext,worldEpoch:2},f=>f.publishedAtMs=-1]){const f=fixture();change(f);assert.equal(prepareDialogueActionPublication(f),null);}
});
test('C05 owned publication requires original matching current P1 proof and adds exact pair',()=>{
 const f=fixture(),association=f.turn.knowledgeInputs.association;Object.assign(association,{owned:true,encounterId:randomUUID(),incarnationId:randomUUID()});
 const claim={worldProfileId:randomUUID(),sourceNamespace:'lsa.promoted-characters',sourceKey:'promoted.'+randomUUID(),adapterEpoch:randomUUID(),incarnationId:association.incarnationId,claimRevision:1};
 f.turn.knowledgeInputs.ownerClaim=claim;const characterId=randomUUID();f.turn.characterSnapshot={nativeIdentity:{...f.turn.identity},resolution:{kind:'persistent',characterId},bindingId:'binding',bindingRevision:1};
 f.identityService={bindings:{get:()=>({claim,characterId,bindingId:'binding',bindingRevision:1})},evidence:{hostContext:f.perception.hostContext,isCurrent:()=>true}};
 const publication=prepareDialogueActionPublication(f);assert.equal(publication.binding.encounterId,association.encounterId);assert.equal(publication.binding.incarnationId,association.incarnationId);
 f.identityService.evidence.isCurrent=()=>false;assert.equal(prepareDialogueActionPublication(f),null);
});
test('C05 real runtime publication service requires matching build and validated original scope',()=>{
 const f=fixture(),calls=[];
 const runtime=createRuntime(normalizeConfig({activities:{mode:'shadow',dialogueReceipts:true}}, {OPENAI_API_KEY:'test-key'}),{fetchImpl:()=>{throw Error('No provider call allowed');}});
 runtime.intelligence={runtime:f.perception};runtime.activities={...f.activities,recordDialogueActionPublication:input=>{calls.push(input);return input;}};
 const input={turn:f.turn,validated:f.validated,publishedAtMs:f.publishedAtMs};
 assert.equal(runtime.services.recordDialogueActionPublication(input),null);assert.equal(calls.length,0);
 runtime.dialogueKnowledgeBuildSupported=true;assert.equal(runtime.services.recordDialogueActionPublication(input).binding.captureRef,f.turn.knowledgeInputs.association.captureRef);assert.equal(calls.length,1);
 f.perception.current=()=>false;assert.equal(runtime.services.recordDialogueActionPublication(input),null);assert.equal(calls.length,1);
});

test('C05 runtime default collection control omits publication even with matching negotiated support',()=>{
 const f=fixture(),runtime=createRuntime(normalizeConfig({}, {OPENAI_API_KEY:'test-key'}),{fetchImpl:()=>{throw Error('No provider call allowed');}});let calls=0;
 runtime.intelligence={runtime:f.perception};runtime.activities={...f.activities,recordDialogueActionPublication:()=>{calls++;}};runtime.dialogueKnowledgeBuildSupported=true;
 assert.equal(runtime.services.recordDialogueActionPublication({turn:f.turn,validated:f.validated,publishedAtMs:f.publishedAtMs}),null);assert.equal(calls,0);
});
