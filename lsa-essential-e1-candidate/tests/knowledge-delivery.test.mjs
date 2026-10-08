import test from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeDelivery} from '../src/context/knowledgeDelivery.mjs';
const decision={dialogue:'Hello.',command:''};
function fixture(){
 let current=true,reason=null;const calls=[],reports=[];
 const base={frameVersion:1,modelAllocation:{scene:'base',messages:[]},delivery:[]};
 const frame={...base,modelAllocation:{scene:'enriched',messages:[]},delivery:[{observationId:'old',revision:1,decisionKey:'exact-old-key'}]};
 const delivery=createKnowledgeDelivery({frame,baseFrame:base,isCurrent:()=>current,validate:()=>reason,acknowledge:(...args)=>{calls.push(args);return args[0]==='exact-old-key';},onOutcome:value=>reports.push(value)});
 return {delivery,base,frame,calls,reports,setReason:value=>{reason=value;},setCurrent:value=>{current=value;}};
}
test('selection, preview and failed intermediate attempt never acknowledge delivery',()=>{
 const f=fixture();assert.equal(f.delivery.prepare(),f.frame);assert.deepEqual(f.calls,[]);
 f.delivery.beforeRequest({input:'same'});assert.deepEqual(f.calls,[]);
 f.delivery.prepare();f.delivery.beforeRequest({input:'same'});assert.deepEqual(f.calls,[]);
 const result=f.delivery.success(decision);assert.equal(result.outcome,'delivered');assert.equal(result.acknowledged,1);assert.match(result.requestHash,/^[a-f0-9]{64}$/);
 assert.deepEqual(f.calls,[['exact-old-key','ps4_context','delivered']]);assert.equal(f.delivery.success(decision),null);assert.equal(f.delivery.finish(),null);assert.equal(f.reports.length,1);
});
test('pre-send stale optional knowledge falls back to frozen basic input; post-send staleness rejects completion/retry',()=>{
 const f=fixture();f.setReason('observation_expired');assert.equal(f.delivery.prepare(),f.base);f.delivery.beforeRequest({input:'base'});assert.equal(f.delivery.success(decision).selectedObservations,0);assert.deepEqual(f.calls,[]);
 const sent=fixture();sent.delivery.prepare();sent.delivery.beforeRequest({input:'enriched'});sent.setReason('participant_retired');assert.throws(()=>sent.delivery.prepare(),{code:'knowledge_request_stale'});assert.throws(()=>sent.delivery.success(decision),{code:'knowledge_request_stale'});sent.delivery.finish();assert.deepEqual(sent.calls,[['exact-old-key','ps4_context','expired']]);
});
test('malformed, incomplete, unsent and superseded reasoning cannot acknowledge delivered',()=>{
 const f=fixture();f.delivery.beforeRequest({input:'enriched'});assert.throws(()=>f.delivery.success({dialogue:'Hello.'}));assert.deepEqual(f.calls,[]);f.delivery.finish();assert.deepEqual(f.calls,[['exact-old-key','ps4_context','rejected']]);
 const unsent=fixture();assert.equal(unsent.delivery.success(decision),null);assert.deepEqual(unsent.calls,[]);
 const stale=fixture();stale.delivery.beforeRequest({input:'enriched'});stale.setCurrent(false);assert.throws(()=>stale.delivery.success(decision),{code:'knowledge_request_stale'});stale.delivery.finish();assert.equal(stale.calls[0][2],'expired');
});
test('retired exact key reports false without acknowledging any successor',()=>{
 const calls=[];const f=fixture();const delivery=createKnowledgeDelivery({frame:f.frame,isCurrent:()=>true,acknowledge:(...args)=>{calls.push(args);return false;}});
 delivery.beforeRequest({input:'enriched'});const result=delivery.success(decision);assert.equal(result.retired,1);assert.equal(result.acknowledged,0);assert.deepEqual(calls,[['exact-old-key','ps4_context','delivered']]);
});
test('retry cannot replace final body bytes or projection metadata',()=>{
 const f=fixture();f.delivery.beforeRequest({input:'enriched'});assert.throws(()=>f.delivery.beforeRequest({input:'changed'}),{code:'knowledge_request_stale'});assert.deepEqual(f.calls,[]);
});
