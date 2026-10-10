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

import {normalizeActivityConfig} from '../src/activities/contracts.mjs';
test('C05 passive collection opt-in never changes ACT mode or enables dialogue dispatch',()=>{
 for(const mode of ['off','shadow','on'])for(const value of [undefined,false,true,'true',1]){const config=normalizeActivityConfig({mode,dialogueReceipts:value});assert.equal(config.mode,mode);assert.equal(config.dialogue,false);assert.equal(config.dialogueReceipts===true,value===true);}
 assert.equal(normalizeActivityConfig().dialogueReceipts,undefined);
});

import {readFile} from 'node:fs/promises';
import {verifyPerceptionContract} from '../tools/verifyPerceptionContract.mjs';
import {verifyNativeContract} from '../tools/verifyNativeContract.mjs';
import {createHash} from 'node:crypto';
test('C05 closed templates cover every pinned native registry action with handler-only semantics',async()=>{
 const catalog=JSON.parse(await readFile(new URL('../../docs/research/domains/essential/essential-action-catalog.json',import.meta.url),'utf8'));
 const pin=await verifyPerceptionContract();assert.equal(pin.dllSha256,catalog.pins.essentialDll);
 assert.equal((await verifyNativeContract(pin.dllSha256)).metadataSha256,catalog.pins.nativeMetadata);
 assert.equal(createHash('sha256').update(await readFile(new URL('../upstream/server.bundle.mjs',import.meta.url))).digest('hex'),catalog.pins.stockBundle);
 const rows=catalog.actions.filter(row=>row.sourceRegistrar);assert.equal(rows.length,65);assert.equal(new Set(rows.map(row=>row.canonical)).size,65);
 for(const row of rows)for(const accepted of [true,false]){
  const inputs=receiptFixture();Object.assign(inputs.receipts[0],{canonicalAction:row.canonical,state:accepted?'HANDLER_ACCEPTED':'FAILED',evidence:accepted?'handler_only':'none',reason:accepted?'handler_accepted':'handler_failed'});
  const result=project(inputs);assert.equal(result.facts.length,1,row.canonical);assert.equal(result.references.length,1);assert.equal(result.facts[0].evidence,accepted?'handler_only':'none');
  assert.match(result.facts[0].text,accepted?/physical execution or completion was not established/:/does not establish the resulting physical state/);assert.ok(!JSON.stringify(result.facts).includes(inputs.receipts[0].publicationId));
 }
});
test('C05 templates omit the catalog bridge-only entries and unpublished aliases',async()=>{
 const catalog=JSON.parse(await readFile(new URL('../../docs/research/domains/essential/essential-action-catalog.json',import.meta.url),'utf8'));
 const bridge=catalog.actions.filter(row=>!row.sourceRegistrar);assert.equal(bridge.length,5);
 const canonicals=new Set(catalog.actions.filter(row=>row.sourceRegistrar).map(row=>row.canonical));
 for(const name of [...bridge.map(row=>row.canonical),...catalog.actions.flatMap(row=>row.aliases??[]).filter(name=>!canonicals.has(name))]){const inputs=receiptFixture();inputs.receipts[0].canonicalAction=name;assert.equal(project(inputs).facts.length,0,name);}
});
