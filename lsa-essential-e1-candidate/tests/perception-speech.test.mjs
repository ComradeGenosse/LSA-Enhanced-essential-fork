import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SharedTranscriptStore } from '../src/perception/sharedTranscriptStore.mjs';
import { validateCaptureReceipt } from '../src/perception/speechContract.mjs';

function receipt({run,source,utterance=randomUUID(),sequence=1,start=10000,startTick=40,conversationRef,observers}={}) {
  return {speechVersion:1,nativeRun:run,producerId:'player_mic',producerSequence:sequence,utteranceId:utterance,captureReceiptRef:randomUUID(),source:{captureRef:source,kind:'player'},...(conversationRef?{conversationRef}:{}),startGameTick:startTick,endGameTick:(startTick+1)>>>0,startMonotonicMs:start,endMonotonicMs:start+1000,durationMs:1000,observers};
}
function observer(ref,hearing,intervals=[],tick=41) {
  return {observer:{captureRef:ref,kind:'ped'},sampledGameTick:tick,distanceMeters:hearing==='did_not_hear'?20:3,acousticPath:hearing==='unknown'?'unknown':hearing==='did_not_hear'?'clear':'clear',audibleIntervalsMs:intervals,hearing,reasonCodes:[hearing==='heard'?'speech_audible':hearing==='did_not_hear'?'out_of_range':'path_unknown'],acousticContext:{occlusion:'clear',interior:'same',sourceVehicle:'on_foot',observerVehicle:'on_foot',sourceFacingToObserver:'outside_cone',attention:'unknown'}};
}

test('unsupported capture UUID/native-time gate drops STT without affecting dialogue or storing text',()=>{
  let now=11500;const run=randomUUID(),source=randomUUID(),listener=randomUUID(),store=new SharedTranscriptStore({now:()=>now,current:()=>true,activeRun:run});
  const r=receipt({run,source,observers:[observer(listener,'heard',[{start:0,end:1000}]) ]});
  assert.equal(validateCaptureReceipt(r),true);
  assert.equal(store.accept({capability:false,receipt:r,text:'do not publish'}).reason,'unsupported_capture_receipt');
  assert.equal(store.entries.size,0);assert.equal(store.diagnostics.unsupported,1);
});

test('one accepted STT transcript is shared only with source-time qualified observers',()=>{
  let now=11500;const run=randomUUID(),source=randomUUID(),full=randomUUID(),partial=randomUUID(),negative=randomUUID(),unknown=randomUUID(),late=randomUUID();
  const store=new SharedTranscriptStore({now:()=>now,current:()=>true,activeRun:run,knownNamesByObserver:()=>['Marcus']});
  const r=receipt({run,source,conversationRef:randomUUID(),observers:[observer(full,'heard',[{start:0,end:1000}]),observer(partial,'heard',[{start:250,end:700}]),observer(negative,'did_not_hear'),observer(unknown,'unknown')]});
  assert.equal(validateCaptureReceipt(r),true,JSON.stringify(r));
  const result=store.accept({capability:true,receipt:r,text:'Hey Marcus, you guys listen.'});
  assert.equal(result.accepted,true,JSON.stringify(result));assert.equal(result.duplicate,false);assert.equal(result.perceptions.length,2);
  const complete=result.perceptions.find(p=>p.observer.captureRef===full),incomplete=result.perceptions.find(p=>p.observer.captureRef===partial);
  assert.equal(complete.coverage,'full');assert.ok(complete.authorizedTextRef);assert.equal(complete.addressEvidence.hint,'group_candidate');
  assert.equal(incomplete.coverage,'partial');assert.equal(incomplete.authorizedTextRef,undefined);assert.equal(incomplete.addressEvidence,undefined);
  assert.equal(store.resolveForObserver(complete.authorizedTextRef,full).text,'Hey Marcus, you guys listen.');
  assert.equal(store.resolveForObserver(complete.authorizedTextRef,partial),null);
  assert.equal(result.perceptions.some(p=>p.observer.captureRef===late),false);
  const replay=store.accept({capability:true,receipt:r,text:'Hey Marcus, you guys listen.'});assert.equal(replay.duplicate,true);assert.equal(replay.perceptions.length,2);
  assert.equal(store.accept({capability:true,receipt:r,text:'Changed transcript'}).reason,'conflicting_accepted_text');
  now=41500;store.expire();assert.equal(store.resolveForObserver(complete.authorizedTextRef,full),null);
  assert.equal(store.accept({capability:true,receipt:r,text:'Hey Marcus, you guys listen.'}).accepted,false);
  assert.equal(store.diagnostics.overflow,0);
});

test('conversation correlation is explicit, bounded and does not merge concurrent conversations',()=>{
  let now=11500;const run=randomUUID(),source=randomUUID(),listener=randomUUID(),oneConversation=randomUUID(),otherConversation=randomUUID();
  const store=new SharedTranscriptStore({now:()=>now,current:()=>true,activeRun:run});
  const firstReceipt=receipt({run,source,sequence:1,conversationRef:oneConversation,observers:[observer(listener,'heard',[{start:0,end:1000}])]});
  const first=store.accept({capability:true,receipt:firstReceipt,text:'Hello.'});
  now=13500;
  const continuedReceipt=receipt({run,source,sequence:2,start:12000,startTick:42,conversationRef:oneConversation,observers:[observer(listener,'heard',[{start:0,end:1000}],43)]});
  const continued=store.accept({capability:true,receipt:continuedReceipt,text:'Still here.'});
  assert.equal(continued.perceptions[0].episodeId,first.perceptions[0].episodeId);
  const simultaneous=receipt({run,source,sequence:3,start:12500,startTick:44,conversationRef:otherConversation,observers:[observer(listener,'heard',[{start:0,end:1000}],45)]});
  const separate=store.accept({capability:true,receipt:simultaneous,text:'Different exchange.'});
  assert.notEqual(separate.perceptions[0].episodeId,first.perceptions[0].episodeId);
  assert.ok(Object.isFrozen(continued.perceptions[0]));
});
