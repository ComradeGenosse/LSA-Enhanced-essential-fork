import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {captureDialogueActionKnowledge as capture,releaseDialogueActionKnowledge as release,assertDialogueActionKnowledgeCurrent as current} from '../src/activities/dialogueActionKnowledge.mjs';
function fixture(){
 const hostContext={hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1};
 const knowledgeInputs={hostRunId:hostContext.hostRunId,worldEpoch:1,association:{captureRef:randomUUID(),owned:false},turn:{pedId:'17',turnId:'t',generationId:1,sessionNonce:1},ownerPendingProof:false};
 const rows=[{publicationId:randomUUID(),state:'HANDLER_ACCEPTED',evidence:'handler_only'}];
 const activities={client:{runtime:{ready:true,dialogueActionVersion:1,nativeRun:randomUUID(),adapterEpoch:randomUUID(),hostContext}},readDialogueActionReceipts:()=>rows};
 return {knowledgeInputs,activities,rows};
}
test('C05 P0 freezes ordinary actor receipts and never incorporates later publications',()=>{
 const f=fixture(),inputs=capture(f);assert.ok(inputs);assert.equal(Object.hasOwn(inputs.binding,'encounterId'),false);assert.ok(Object.isFrozen(inputs.receipts[0]));
 f.rows.push({publicationId:randomUUID(),state:'FAILED'});assert.equal(inputs.receipts.length,1);assert.equal(current(inputs,f.activities),null);
 f.rows[0].state='FAILED';assert.equal(inputs.receipts[0].state,'HANDLER_ACCEPTED');assert.equal(current(inputs,f.activities),'participant_retired');
});
test('C05 owned release retains original receipt set and currentness checks channel and selected references',()=>{
 const f=fixture();Object.assign(f.knowledgeInputs.association,{owned:true,encounterId:randomUUID(),incarnationId:randomUUID()});f.knowledgeInputs.ownerPendingProof=true;
 const inputs=capture(f);assert.equal(current(inputs,f.activities),'owner_unverified');f.rows.push({publicationId:randomUUID()});const ready=release(inputs);assert.equal(ready.receipts.length,1);assert.equal(current(ready,f.activities),null);
 assert.equal(current(ready,f.activities,[{publicationId:randomUUID()}]),'revision_mismatch');f.activities.client.runtime.adapterEpoch=randomUUID();assert.equal(current(ready,f.activities),'channel_unhealthy');
});
test('C05 capture fails closed for unavailable negotiation, host, parent and owned scope',()=>{
 for(const change of [f=>f.activities.client.runtime.dialogueActionVersion=null,f=>f.activities.client.runtime.ready=false,f=>f.activities.client.runtime.hostContext.worldEpoch=2,f=>f.knowledgeInputs.reason='participant_retired',f=>f.knowledgeInputs.association.owned=true,f=>f.activities.readDialogueActionReceipts=()=>{throw Error('unavailable');}]){const f=fixture();change(f);assert.equal(capture(f),null);}
});

import {projectDialogueActionKnowledge as project} from '../src/activities/dialogueActionKnowledge.mjs';
import {renderKnowledge,pruneKnowledgeFrame} from '../src/context/knowledgeRenderer.mjs';
function receiptFixture(){
 const f=fixture(),inputs=capture(f);
 const receipt={publicationId:randomUUID(),binding:inputs.binding,tuple:{...inputs.turn},canonicalAction:'waithere',publishedAtMs:10,atGameTick:20,state:'HANDLER_ACCEPTED',evidence:'handler_only',reason:'handler_accepted',privateLabel:'PRIVATE_CANARY'};
 return {...inputs,receipts:[receipt]};
}
test('C05 projection uses closed outcome templates and keeps private provenance out of model facts',()=>{
 const inputs=receiptFixture(),result=project(inputs);assert.equal(result.facts.length,1);assert.match(result.facts[0].text,/handler accepted/);assert.match(result.facts[0].text,/completion was not established/);
 const text=JSON.stringify(result.facts);for(const value of [inputs.binding.captureRef,inputs.binding.hostContext.hostRunId,inputs.receipts[0].publicationId,'PRIVATE_CANARY'])assert.ok(!text.includes(value));
 const failed=project({...inputs,receipts:[{...inputs.receipts[0],state:'FAILED',evidence:'none',reason:'handler_failed'}]});assert.match(failed.facts[0].text,/handler reported/);assert.ok(Object.isFrozen(result.facts[0]));
});
test('C05 projection omits unknown, forged strength, unsupported names and wrong actor lifetimes',()=>{
 for(const change of [r=>r.state='UNKNOWN',r=>r.evidence='world_strong',r=>r.reason='callback_mismatch',r=>r.canonicalAction='PRIVATE_CANARY',r=>r.binding={...r.binding,captureRef:randomUUID()},r=>r.binding={...r.binding,encounterId:randomUUID(),incarnationId:randomUUID()},r=>r.atGameTick=-1,r=>r.tuple={...r.tuple,sessionNonce:0}]){const inputs=receiptFixture();change(inputs.receipts[0]);assert.equal(project(inputs).facts.length,0);}
 const inputs=receiptFixture();assert.equal(project({...inputs,ownerPendingProof:true}).facts.length,0);assert.equal(project({...inputs,receipts:[inputs.receipts[0],inputs.receipts[0]]}).facts.length,1);
});
test('single renderer keeps C05 off by default and prunes receipt facts by aligned private references',()=>{
 const dialogueInputs=receiptFixture(),options={dialogueInputs,input:'Hi',source:'player_text'};
 assert.equal(JSON.parse(renderKnowledge(options).modelAllocation.scene).lanes.SELF.selfFacts.length,0);
 const frame=renderKnowledge({...options,includeDialogueReceipts:true});assert.equal(frame.dialogueReferences.length,1);assert.equal(frame.activityReferences.length,0);assert.equal(JSON.parse(frame.modelAllocation.scene).lanes.SELF.selfFacts.length,1);
 assert.ok(!JSON.stringify(frame.modelAllocation).includes(dialogueInputs.binding.captureRef));
 const pruned=pruneKnowledgeFrame(frame,()=>true,()=>true,()=>false);assert.equal(pruned.dialogueReferences.length,0);assert.equal(JSON.parse(pruned.modelAllocation.scene).lanes.SELF.selfFacts.length,0);assert.equal(pruned.diagnostics.staleDialogueReceiptDrops,1);
});
test('mixed ACT and C05 pruning preserves the other contributor and its exact reference',()=>{
 const dialogueInputs=receiptFixture(),binding={characterId:randomUUID(),encounterId:randomUUID(),incarnationId:randomUUID(),hostContext:dialogueInputs.binding.hostContext};
 const activityInputs={binding,facts:[{factVersion:1,factId:randomUUID(),activityId:randomUUID(),goalId:randomUUID(),characterId:binding.characterId,kind:'instructed',intent:'accompany',evidence:'none',atMs:1,provenance:{...binding.hostContext,encounterId:binding.encounterId,incarnationId:binding.incarnationId}}]};
 const frame=renderKnowledge({dialogueInputs,activityInputs,includeDialogueReceipts:true,includeActivityFacts:true,input:'Hi',source:'player_text'});
 const onlyDialogue=pruneKnowledgeFrame(frame,()=>true,()=>false,()=>true);assert.equal(onlyDialogue.activityReferences.length,0);assert.equal(onlyDialogue.dialogueReferences.length,1);assert.match(JSON.parse(onlyDialogue.modelAllocation.scene).lanes.SELF.selfFacts[0].text,/handler accepted/);
 const onlyActivity=pruneKnowledgeFrame(frame,()=>true,()=>true,()=>false);assert.equal(onlyActivity.activityReferences.length,1);assert.equal(onlyActivity.dialogueReferences.length,0);assert.match(JSON.parse(onlyActivity.modelAllocation.scene).lanes.SELF.selfFacts[0].text,/was asked/);
});
