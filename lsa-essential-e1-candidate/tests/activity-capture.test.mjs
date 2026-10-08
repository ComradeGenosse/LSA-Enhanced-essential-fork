import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {captureActivityKnowledge,releaseActivityKnowledge,assertActivityKnowledgeCurrent,projectActivityKnowledge} from '../src/activities/activityKnowledge.mjs';
import {ActivityFacts} from '../src/activities/activityFacts.mjs';
const fixture=()=>{
 const turn={pedId:'17',turnId:'turn',generationId:1,sessionNonce:1},hostContext={hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1},association={owned:true,captureRef:randomUUID(),encounterId:randomUUID(),incarnationId:randomUUID()};
 const knowledgeInputs={turn,association,hostRunId:hostContext.hostRunId,worldEpoch:1,reason:null},characterInputs={identity:turn,claim:{incarnationId:association.incarnationId},profile:{characterId:randomUUID()}};
 characterInputs.claim={...characterInputs.claim,worldProfileId:randomUUID(),sourceNamespace:'lsa.promoted-characters',sourceKey:'promoted.'+characterInputs.profile.characterId,adapterEpoch:randomUUID(),claimRevision:1};knowledgeInputs.ownerClaim={...characterInputs.claim};
 const binding={characterId:characterInputs.profile.characterId,encounterId:association.encounterId,incarnationId:association.incarnationId,hostContext},facts=new ActivityFacts(randomUUID,()=>1000);
 const add=()=>facts.record({characterId:binding.characterId,activityId:randomUUID(),goalId:randomUUID(),kind:'mode_established',intent:'accompany',evidence:'mode_flag'},{...hostContext,encounterId:association.encounterId,incarnationId:association.incarnationId});add();
 const activities={client:{runtime:{ready:true,nativeRun:randomUUID(),adapterEpoch:randomUUID(),hostContext}},factsForCharacter:b=>facts.factsForCharacter(b)};
 return {knowledgeInputs,characterInputs,activities,facts,binding,add};
};
test('ACT capture freezes P0 facts and releases only the original character without live refill',()=>{
 const f=fixture(),captured=captureActivityKnowledge(f);assert.equal(captured.facts.length,1);assert.ok(Object.isFrozen(captured.facts[0]));assert.deepEqual(projectActivityKnowledge(captured).facts,[]);
 f.add();f.characterInputs.profile.characterId=randomUUID();assert.equal(captured.facts.length,1);
 const released=releaseActivityKnowledge(captured,f.binding.characterId);assert.equal(released.ownerPendingProof,false);assert.equal(projectActivityKnowledge(released).facts.length,1);assert.equal(assertActivityKnowledgeCurrent(released,f.activities),null);
 assert.equal(releaseActivityKnowledge(captured,randomUUID()).reason,'owner_unverified');
 f.facts.retireEncounter(f.binding.encounterId);assert.equal(assertActivityKnowledgeCurrent(released,f.activities),'participant_retired');assert.equal(released.facts.length,1);
});
test('ACT capture excludes ordinary/mixed-host/mismatched-turn or unavailable profile, and currentness fences reconnect',()=>{
 for(const mutate of [f=>f.knowledgeInputs.association.owned=false,f=>f.characterInputs.identity={...f.characterInputs.identity,generationId:2},f=>f.characterInputs.profile=null,f=>f.characterInputs.claim.incarnationId=randomUUID(),f=>f.activities.client.runtime.hostContext={...f.binding.hostContext,worldEpoch:2},f=>f.activities.client.runtime.ready=false,f=>f.characterInputs.claim.sourceKey='other',f=>f.activities.factsForCharacter=()=>{throw new Error('optional failure');}]){const f=fixture();mutate(f);assert.equal(captureActivityKnowledge(f),null);}
 const f=fixture(),captured=releaseActivityKnowledge(captureActivityKnowledge(f),f.binding.characterId);f.activities.client.runtime.adapterEpoch=randomUUID();assert.equal(assertActivityKnowledgeCurrent(captured,f.activities),'channel_unhealthy');
 f.activities.client.runtime.adapterEpoch=captured.adapterEpoch;f.activities.factsForCharacter=()=>{throw new Error('optional read failure');};assert.equal(assertActivityKnowledgeCurrent(captured,f.activities),'channel_unhealthy');
});

test('ACT currentness validates only retained exact references and rejects replacement refs',()=>{
 const f=fixture();f.add();const inputs=releaseActivityKnowledge(captureActivityKnowledge(f),f.binding.characterId),retained=projectActivityKnowledge(inputs).references[0];
 f.facts.facts=f.facts.facts.slice(-1);assert.equal(assertActivityKnowledgeCurrent(inputs,f.activities),'participant_retired');assert.equal(assertActivityKnowledgeCurrent(inputs,f.activities,[retained]),null);assert.equal(assertActivityKnowledgeCurrent(inputs,f.activities,[{...retained,factId:randomUUID()}]),'revision_mismatch');
});
