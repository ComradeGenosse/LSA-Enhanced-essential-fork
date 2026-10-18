import test from 'node:test';
import assert from 'node:assert/strict';
import {createKnowledgeDelivery} from '../src/context/knowledgeDelivery.mjs';
import {createTelemetryRecord} from '../src/observability/eventContract.mjs';
import {randomUUID} from 'node:crypto';
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

test('stale memory pre-send and in-flight cancellation expose bounded reasons without changing enforcement',async()=>{
 const emitted=[];
 const onStale=d=>emitted.push(createTelemetryRecord({sequence:emitted.length+1,runId:randomUUID(),
  originMs:0,event:'knowledge_request_stale',source:'player_text',data:d}));
 const frame={modelAllocation:{scene:'private words'},delivery:[],memoryStamp:{marker:'a'}};
 const pre=createKnowledgeDelivery({frame,isCurrent:()=>true,memoryCurrent:()=>false,onStale});
 await assert.rejects(pre.verifyBeforeRequest(),{code:'knowledge_request_stale',reason:'memory_stale'});
 assert.deepEqual(emitted[0].data,{reason:'memory_stale',stage:'verify_before_request',requestGatePassed:false});
 const liveFrame={modelAllocation:{scene:'private words'},delivery:[],activityReferences:[{factId:'a'}]};
 let listener=null,reason=null,cancelled=null;
 const live=createKnowledgeDelivery({frame:liveFrame,isCurrent:()=>true,validate:()=>reason,onStale});
 live.watch(callback=>{listener=callback;return ()=>{};},e=>{cancelled=e;});
 live.beforeRequest({scene:'spoken content'});reason='participant_retired';listener();
 assert.equal(cancelled.reason,'participant_retired');
 assert.deepEqual(emitted[1].data,{reason:'participant_retired',stage:'watch',requestGatePassed:true});
 assert.equal(live.finish().outcome,'expired');
 assert.equal(emitted.length,2,'invalidation event emitted exactly once');
});
test('stale failure classification never logs arbitrary reasons or breaks cancellation',async()=>{
 const reported=[],frame={modelAllocation:{scene:'private words'},delivery:[],
  activityReferences:[{factId:'a'}]};
 let reason='private user text /Users/private/secret.sqlite';
 const d=createKnowledgeDelivery({frame,isCurrent:()=>true,validate:()=>reason,
  onStale:value=>{reported.push(value);throw new Error('telemetry down');}});
 await assert.rejects(d.verifyBeforeRequest(),{code:'knowledge_request_stale'});
 assert.deepEqual(reported,[{reason:'unclassified_stale_reason',stage:'verify_before_request',requestGatePassed:false}]);
 assert.equal(d.finish().outcome,'expired');
 assert(!JSON.stringify(reported).includes('/Users/private/'));
 const mismatch=[],valid=createKnowledgeDelivery({frame,isCurrent:()=>true,validate:()=>null,
  onStale:value=>mismatch.push(value)});
 valid.beforeRequest({scene:'same'});
 assert.throws(()=>valid.beforeRequest({scene:'changed'}),{code:'knowledge_request_stale'});
 assert.deepEqual(mismatch,[{reason:'revision_mismatch',stage:'before_request',requestGatePassed:true}]);
});

test('completed model decision does not report a later stale cleanup',()=>{
 const emitted=[];let current=true;
 const frame={modelAllocation:{scene:'reasoning'},delivery:[],activityReferences:[{factId:'a'}]};
 const d=createKnowledgeDelivery({frame,isCurrent:()=>current,validate:()=>null,
  onStale:record=>emitted.push(record)});
 d.beforeRequest({scene:'reasoning'});
 assert.equal(d.success(decision).outcome,'delivered');
 current=false;
 assert.equal(d.finish(),null,'terminal delivery is not re-examined');
 assert.deepEqual(emitted,[],'no stale event after successful model decision');
});

const stockReply = { dialogue: 'Yeah, I know that song.', command: '' };
const offer = { intent: 'hold_position', slots: {} };
const act5 = { act5Intents: ['hold_position'], act5Choices: { hold_position: [{}] } };

function request() {
  let current = true;
  const acknowledgements = [];
  const delivery = createKnowledgeDelivery({
    frame: {
      frameVersion: 1,
      modelAllocation: { scene: 'radio verified', messages: [] },
      delivery: [{ decisionKey: 'same-original-observation' }],
    },
    isCurrent: () => current,
    validate: () => null,
    acknowledge: (...args) => { acknowledgements.push(args); return true; },
  });
  delivery.beforeRequest({ model: 'gpt-6-luna', request: 'sealed' });
  return { delivery, acknowledgements, retire: () => { current = false; } };
}

test('October 18 voice fallback regression: ordinary dialogue with ACT5 activity:null is delivered', () => {
  // When ACT5 is available, even an ordinary response carries activity:null.
  const failureBeforeFix = request();
  assert.throws(() => failureBeforeFix.delivery.success({ ...stockReply, activity: null }),
    /only dialogue and command/);
  assert.deepEqual(failureBeforeFix.acknowledgements, []);
  assert.equal(failureBeforeFix.delivery.finish().outcome, 'rejected');

  const fixed = request();
  const result = fixed.delivery.success({ ...stockReply, activity: null }, act5);
  assert.equal(result.outcome, 'delivered');
  assert.equal(result.acknowledged, 1);
  assert.deepEqual(fixed.acknowledgements,
    [['same-original-observation', 'ps4_context', 'delivered']]);
  assert.equal(fixed.delivery.success({ ...stockReply, activity: null }, act5), null);

  // A currently active ACT5 turn may have zero offered intents.
  const empty = request();
  assert.equal(empty.delivery.success({ ...stockReply, activity: null },
    { act5Intents: [], act5Choices: {} }).outcome, 'delivered');
});

test('valid ACT5 proposal is delivered without granting activity execution authority', () => {
  const f = request();
  const decision = { dialogue: 'Want me to wait here?', command: '', activity: offer };
  assert.equal(f.delivery.success(decision, act5).outcome, 'delivered');
  // This is only a C-03 knowledge acknowledgement, not an ACT3 native command.
  assert.deepEqual(f.acknowledgements,
    [['same-original-observation', 'ps4_context', 'delivered']]);
});

test('stock dialogue still uses strict legacy shape, without implicit ACT5 opt-in', () => {
  const normal = request();
  assert.equal(normal.delivery.success(stockReply).outcome, 'delivered');
  const unsolicited = request();
  assert.throws(() => unsolicited.delivery.success({ ...stockReply, activity: null }),
    /only dialogue and command/);
  assert.equal(unsolicited.acknowledgements.length, 0);
  assert.equal(unsolicited.delivery.finish().outcome, 'rejected');
});

test('ACT5 invalid, unavailable, and conflicting decisions never consume knowledge', () => {
  const cases = [
    { name: 'missing activity key', decision: stockReply },
    { name: 'extra unrecognized field', decision: { ...stockReply, activity: null, extra: true } },
    { name: 'unoffered intent', decision: { ...stockReply, activity: { intent: 'accompany', slots: { person: { kind: 'player' } } } } },
    { name: 'unverified slots', decision: { ...stockReply, activity: { intent: 'hold_position', slots: { destination: 'arbitrary' } } } },
    { name: 'parallel stock command', decision: { ...stockReply, command: 'DO WaitHere', activity: offer } },
    { name: 'control command in speech', decision: { dialogue: 'DO WaitHere', command: '', activity: null } },
    { name: 'runtime removed choice', decision: { ...stockReply, activity: offer },
      context: { act5Intents: ['hold_position'], act5Choices: { hold_position: [] } } },
  ];
  for (const scenario of cases) {
    const f = request();
    assert.throws(() => f.delivery.success(scenario.decision, scenario.context ?? act5),
      undefined, scenario.name);
    assert.deepEqual(f.acknowledgements, [], scenario.name);
    assert.equal(f.delivery.finish().outcome, 'rejected', scenario.name);
  }
});

test('ACT5 replies still fail closed when original knowledge loses its owner', () => {
  const f = request();
  f.retire();
  assert.throws(() => f.delivery.success({ ...stockReply, activity: null }, act5),
    { code: 'knowledge_request_stale', reason: 'superseded' });
  assert.deepEqual(f.acknowledgements, []);
  assert.equal(f.delivery.finish().outcome, 'expired');
  assert.deepEqual(f.acknowledgements,
    [['same-original-observation', 'ps4_context', 'expired']]);
});
