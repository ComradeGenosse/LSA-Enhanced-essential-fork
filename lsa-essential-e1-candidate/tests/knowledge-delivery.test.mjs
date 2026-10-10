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

test('pruning runs only before first send and acknowledges only the surviving exact item',()=>{
 let prunes=0;const calls=[];
 const frame={modelAllocation:{scene:'original',messages:[]},delivery:[{decisionKey:'stale'},{decisionKey:'retained'}]};
 const narrowed={modelAllocation:{scene:'narrowed',messages:[]},delivery:[frame.delivery[1]]};
 const delivery=createKnowledgeDelivery({frame,isCurrent:()=>true,prune:()=>{prunes++;return narrowed;},acknowledge:(...args)=>{calls.push(args);return true;}});
 assert.equal(delivery.prepare(),narrowed);delivery.beforeRequest({scene:'narrowed'});assert.equal(delivery.prepare(),narrowed);assert.equal(prunes,1);delivery.success(decision);assert.deepEqual(calls,[['retained','ps4_context','delivered']]);
});

test('in-flight invalidation cancels exactly the sent request and removes its listener',()=>{
 const f=fixture();let listener=null,disposed=0,cancelled=null;
 f.delivery.watch(callback=>{listener=callback;return ()=>{disposed++;};},error=>{cancelled=error;});
 f.setReason('participant_retired');listener();assert.equal(cancelled,null);
 f.setReason(null);f.delivery.beforeRequest({input:'enriched'});f.setReason('participant_retired');listener();
 assert.equal(cancelled.code,'knowledge_request_stale');assert.equal(cancelled.reason,'participant_retired');assert.equal(disposed,1);f.delivery.finish();assert.equal(disposed,1);assert.deepEqual(f.calls,[['exact-old-key','ps4_context','expired']]);
});
test('successful reasoning and explicit teardown release invalidation subscriptions',()=>{
 for(const complete of [true,false]){const f=fixture();let disposed=0;f.delivery.watch(()=>()=>{disposed++;},()=>{});f.delivery.beforeRequest({input:'enriched'});if(complete)f.delivery.success(decision);else f.delivery.dispose();assert.equal(disposed,1);f.delivery.dispose();assert.equal(disposed,1);}
});


test('ACT-only SELF validates request and success without consuming salience entitlements',()=>{
 const base={modelAllocation:{scene:'base',messages:[]},delivery:[],activityReferences:[]},frame={...base,modelAllocation:{scene:'ACT SELF',messages:[]},activityReferences:[{factId:'captured-fact'}]};
 let reason=null,checks=0,acks=0;const delivery=createKnowledgeDelivery({frame,baseFrame:base,isCurrent:()=>true,validate:()=>{checks++;return reason;},acknowledge:()=>{acks++;return true;}});
 assert.equal(delivery.prepare(),frame);delivery.beforeRequest({scene:'ACT SELF'});assert.ok(checks>=2);reason='participant_retired';assert.throws(()=>delivery.beforeRequest({scene:'ACT SELF'}),{code:'knowledge_request_stale'});assert.throws(()=>delivery.success(decision),{code:'knowledge_request_stale'});assert.equal(delivery.finish().outcome,'expired');assert.equal(acks,0);
 const fallback=createKnowledgeDelivery({frame,baseFrame:base,isCurrent:()=>true,validate:()=>reason});assert.equal(fallback.prepare(),base);fallback.beforeRequest({scene:'base'});assert.equal(fallback.success(decision).selectedObservations,0);
});
test('ACT-only in-flight watch cancels the exact request and disposes without PS4 acknowledgement',()=>{
 let listener,reason=null,cancelled=null,disposed=0;const frame={modelAllocation:{scene:'ACT SELF'},delivery:[],activityReferences:[{factId:'captured-fact'}]};
 const delivery=createKnowledgeDelivery({frame,isCurrent:()=>true,validate:()=>reason});delivery.watch(callback=>{listener=callback;return ()=>disposed++;},error=>{cancelled=error;});assert.equal(typeof listener,'function');delivery.beforeRequest({scene:'ACT SELF'});reason='channel_unhealthy';listener();assert.equal(cancelled.reason,'channel_unhealthy');assert.equal(disposed,1);assert.equal(delivery.finish().acknowledged,0);assert.equal(disposed,1);
});


test('C05-only SELF validates send, retry and completion without salience consumption',()=>{
 const base={modelAllocation:{scene:'base'},delivery:[],dialogueReferences:[]},frame={...base,modelAllocation:{scene:'receipt'},dialogueReferences:[{publicationId:'original'}]};
 let reason=null,checks=0,acks=0;const delivery=createKnowledgeDelivery({frame,baseFrame:base,isCurrent:()=>true,validate:()=>{checks++;return reason;},acknowledge:()=>{acks++;return true;}});
 assert.equal(delivery.prepare(),frame);delivery.beforeRequest({scene:'receipt'});delivery.beforeRequest({scene:'receipt'});assert.ok(checks>=3);
 reason='participant_retired';assert.throws(()=>delivery.beforeRequest({scene:'receipt'}),{code:'knowledge_request_stale'});assert.throws(()=>delivery.success(decision),{code:'knowledge_request_stale'});assert.equal(delivery.finish().outcome,'expired');assert.equal(acks,0);
 const fallback=createKnowledgeDelivery({frame,baseFrame:base,isCurrent:()=>true,validate:()=>reason});assert.equal(fallback.prepare(),base);fallback.beforeRequest({scene:'base'});assert.equal(fallback.success(decision).acknowledged,0);
});
test('C05-only in-flight channel invalidation cancels exact request and disposes once',()=>{
 let listener,reason=null,cancelled=null,disposed=0,acks=0;const frame={modelAllocation:{scene:'receipt'},delivery:[],dialogueReferences:[{publicationId:'original'}]};
 const delivery=createKnowledgeDelivery({frame,isCurrent:()=>true,validate:()=>reason,acknowledge:()=>{acks++;return true;}});
 delivery.watch(callback=>{listener=callback;return ()=>disposed++;},error=>cancelled=error);assert.equal(typeof listener,'function');listener();assert.equal(cancelled,null);
 delivery.beforeRequest({scene:'receipt'});reason='channel_unhealthy';listener();assert.equal(cancelled.reason,'channel_unhealthy');assert.equal(disposed,1);delivery.finish();assert.equal(disposed,1);assert.equal(acks,0);
});
test('C05 receipt pruning before send preserves frozen allocation and never refills evidence',()=>{
 const frame={modelAllocation:{scene:'two receipts'},delivery:[],dialogueReferences:[{publicationId:'a'},{publicationId:'b'}]},narrow={...frame,modelAllocation:{scene:'one receipt'},dialogueReferences:[frame.dialogueReferences[0]]};
 const delivery=createKnowledgeDelivery({frame,isCurrent:()=>true,prune:()=>narrow,validate:projection=>projection.dialogueReferences.some(ref=>ref.publicationId==='b')?'participant_retired':null});
 assert.equal(delivery.prepare(),narrow);delivery.beforeRequest({scene:'one receipt'});assert.throws(()=>delivery.beforeRequest({scene:'changed'}),{code:'knowledge_request_stale'});assert.equal(delivery.success(decision).selectedObservations,0);assert.equal(frame.dialogueReferences.length,2);
});
