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
