import test from 'node:test';
import assert from 'node:assert/strict';
import {DialogueActionReceipts} from '../src/activities/dialogueActionReceipts.mjs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const binding={encounterId:id(1),incarnationId:id(2),hostContext:{hostContextVersion:1,hostRunId:id(3),worldEpoch:1}};
const tuple={pedId:'actor',turnId:'turn',generationId:1,sessionNonce:1};
const publication={tuple,binding,canonicalAction:'followtarget',publishedAtMs:100,allowedActions:['followtarget','waithere']};
const callback=row=>({...row,succeeded:true,atGameTick:0xffffffff,receivedAtMs:120});
test('C05 exact passive receipt distinguishes acceptance and failure without physical completion',()=>{
 const store=new DialogueActionReceipts(),row=store.publish(publication);
 tuple.generationId=2;assert.equal(row.tuple.generationId,1);tuple.generationId=1;
 assert.equal(store.callback({...callback(row),publicationId:id(99)}),null);
 const accepted=store.callback(callback(row));assert.equal(accepted.state,'HANDLER_ACCEPTED');assert.equal(accepted.evidence,'handler_only');assert.ok(Object.isFrozen(accepted.binding.hostContext));
 assert.equal(store.callback(callback(row)),null);
 const next=store.publish({...publication,canonicalAction:'waithere'});assert.equal(store.callback({...callback(next),succeeded:false}).state,'FAILED');
 assert.equal(store.read({...binding,incarnationId:id(4)}).length,0);assert.equal(store.read(binding).length,2);
});
test('C05 rejects stale, unannotated, overflowed and mismatched callback evidence',()=>{
 for(const mutate of [row=>({...callback(row),tuple:{...tuple,sessionNonce:2}}),row=>({...callback(row),binding:{...binding,hostContext:{...binding.hostContext,worldEpoch:2}}}),row=>({...callback(row),canonicalAction:'waithere'}),row=>({...callback(row),atGameTick:-1}),row=>({...callback(row),overflowed:true})]){
  const store=new DialogueActionReceipts(),row=store.publish(publication);assert.equal(store.callback(mutate(row)).state,'UNKNOWN');assert.equal(store.callback(callback(row)),null);
 }
 const store=new DialogueActionReceipts(),row=store.publish(publication);
 assert.equal(store.callback({...callback(row),publicationId:undefined}),null);assert.equal(store.pendingCount,1);
 assert.equal(store.callback({...callback(row),receivedAtMs:5101}),null);assert.equal(store.read(binding)[0].reason,'callback_timeout');
 const regression=store.publish({...publication,publishedAtMs:6000});store.expire(5999);assert.equal(store.callback({...callback(regression),receivedAtMs:6001}),null);
});
test('C05 overlap is quarantined and reset/retirement prevent receipt inheritance',()=>{
 const store=new DialogueActionReceipts(),first=store.publish(publication),second=store.publish(publication);
 assert.equal(second.state,'UNKNOWN');assert.equal(store.callback(callback(first)),null);assert.equal(store.pendingCount,0);
 assert.equal(store.publish({...publication,publishedAtMs:101}).reason,'ambiguous_publication');
 const frozen=store.read(binding);store.retire(binding);assert.equal(store.read(binding).length,0);assert.equal(frozen.length,3);
 const next=store.publish(publication);store.reset();assert.equal(store.callback(callback(next)),null);
});
test('C05 adapter bounds pending and receipts and rejects unvalidated publications',()=>{
 const store=new DialogueActionReceipts();
 assert.equal(store.publish({...publication,allowedActions:[]}),null);assert.equal(store.publish({...publication,tuple:{}}),null);
 for(let n=0;n<200;n++)store.publish({...publication,binding:{...binding,encounterId:id(n+10)}});
 assert.equal(store.pendingCount,32);store.expire(6000);assert.equal(store.pendingCount,0);
 for(let n=0;n<200;n++){const row=store.publish({...publication,publishedAtMs:7000+n});store.callback({...callback(row),receivedAtMs:7000+n});}
 assert.equal(store.read(binding).length,16);
});
