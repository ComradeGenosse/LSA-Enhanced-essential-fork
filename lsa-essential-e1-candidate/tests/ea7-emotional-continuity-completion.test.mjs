import test from 'node:test';
import assert from 'node:assert/strict';
import { MoodStore } from '../src/voice/emotion/moodStore.mjs';
import { createSpeechDeliveryResolver } from '../src/voice/emotion/resolveSpeechDelivery.mjs';
import { createMoodRuntime } from '../src/voice/emotion/moodRuntime.mjs';
import { resolveDelivery } from '../src/voice/emotion/sceneDelivery.mjs';

const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12,'0');
const identity = generationId => Object.freeze({
  pedId:'17', sessionNonce:2, turnId:'turn-'+generationId, generationId,
});
const eligible = (value, source='dialogue_cue') => Object.freeze({
  version:1,value,source,confidence:'soft',intensity:'subtle',evidenceRef:null,
});
const nativeReceipt = id => ({
  ...id, type:'playback_ended', ok:true, reason:'completed',
  playbackStarted:true, hadAudio:true, wasInterrupted:false,
});
const config = mode => ({
  speechProvider:'elevenlabs',
  expressiveDelivery:{mode,intensity:'subtle',maxTaggedSegmentsPerTurn:2},
});
function speechFixture(mode='experimental', decisions={}) {
  const calls=[], id=identity(4);
  const resolver=createSpeechDeliveryResolver({
    config:config(mode), identity:id, source:'player_text',turn:{},
    isActive:()=>true,clock:()=>1000,
    adapter:{
      resolveDelivery:({segmentText}) => decisions[segmentText] ?? null,
      onSpeechCompleted:x=>calls.push(x),
    },
  });
  return {calls,id,resolver};
}
function moodContext(generationId=4) {
  const id=identity(generationId),cid=uuid(1),bid=uuid(2),host=uuid(3);
  const binding={
    characterId:cid,bindingId:bid,bindingRevision:1,serverRunId:uuid(4),
    pedId:id.pedId,sessionNonce:id.sessionNonce,
    claim:{worldProfileId:uuid(5),sourceNamespace:'comrade.authored',
      sourceKey:'promoted.1',adapterEpoch:uuid(6),
      incarnationId:uuid(7),claimRevision:1},
  };
  return {identity:id,binding,characterSnapshot:{
    nativeIdentity:id,bindingId:bid,bindingRevision:1,
    resolution:{kind:'persistent',characterId:cid},
  },hostContext:{hostContextVersion:1,hostRunId:host,worldEpoch:1},
  timelineId:uuid(8),protagonist:'franklin',isCurrent:()=>true};
}
const played = ctx => ({
  verified:true,playbackSucceeded:true,playbackStarted:true,hadAudio:true,
  wasInterrupted:false,...ctx.identity,
});

test('EA7 selects the last eligible audible intent, not the first native completion callback',()=>{
  const f=speechFixture('experimental',{first:eligible('sad'),last:eligible('amused')});
  const first=f.resolver.forSegment({text:'first',sequence:1});
  const last=f.resolver.forSegment({text:'last',sequence:2});
  assert.equal(first.value,'sad');
  assert.equal(last.value,'amused');
  f.resolver.synthesized(first,nativeReceipt(f.id));
  f.resolver.synthesized(last,nativeReceipt(f.id));
  f.resolver.synthesized(first,nativeReceipt(f.id));
  f.resolver.synthesized(last,nativeReceipt(f.id));
  assert.equal(f.calls.length,1,'exactly one completion from the complete turn');
  assert.equal(f.calls[0].delivery.value,'amused');
});

test('EA7 ignores re-derived ephemeral mood as a fresh origin',()=>{
  const f=speechFixture('experimental',{
    first:eligible('sad'),later:eligible('amused','ephemeral_mood'),
  });
  const a=f.resolver.forSegment({text:'first',sequence:1});
  const b=f.resolver.forSegment({text:'later',sequence:2});
  assert.equal(b.source,'ephemeral_mood');
  f.resolver.synthesized(a,nativeReceipt(f.id));
  f.resolver.synthesized(b,nativeReceipt(f.id));
  assert.deepEqual(f.calls.map(c=>c.delivery.value),['sad']);
});

test('EA7 never commits shadow-only or interrupted, failed, unplayed and foreign-native receipts',()=>{
  for(const mode of ['shadow','experimental']) {
    const f=speechFixture(mode,{first:eligible('amused')});
    const first=f.resolver.forSegment({text:'first',sequence:1});
    for(const delta of [{ok:false},{wasInterrupted:true},{hadAudio:false},
      {type:'playback_started'},{pedId:'other'},{turnId:'another-turn'},
      {generationId:99},{sessionNonce:4}])
      f.resolver.synthesized(first,{...nativeReceipt(f.id),...delta});
    assert.equal(f.calls.length,0);
    f.resolver.synthesized(first,nativeReceipt(f.id));
    assert.equal(f.calls.length,mode==='experimental'?1:0);
  }
});

test('EA7 resolver retirement and native callback replay are idempotent',()=>{
  const f=speechFixture('experimental',{first:eligible('amused')});
  const a=f.resolver.forSegment({text:'first',sequence:1});
  f.resolver.synthesized(a,nativeReceipt(f.id));
  f.resolver.synthesized(a,nativeReceipt(f.id));
  f.resolver.retire(true);
  f.resolver.retire(false);
  f.resolver.synthesized(a,nativeReceipt(f.id));
  assert.equal(f.calls.length,1);
});

test('EA7 direct store never resets TTL or replaces a mood on duplicate native receipt',()=>{
  const s=new MoodStore(),a=moodContext(4);
  assert.equal(s.commitPlayed({context:a,nowMs:1000,delivery:eligible('sad'),receipt:played(a)}),true);
  assert.equal(s.commitPlayed({context:a,nowMs:21000,delivery:eligible('amused'),receipt:played(a)}),false);
  assert.equal(s.take({context:moodContext(5),nowMs:21001})?.value,'sad');
  assert.equal(s.take({context:moodContext(5),nowMs:23000}),null,
    'expiration is based on original native accepted playback');
});

test('EA7 new generation can replace consumed mood but old playback cannot undo it',()=>{
  const s=new MoodStore(),a=moodContext(4),b=moodContext(5),c=moodContext(6);
  assert.equal(s.commitPlayed({context:a,nowMs:1000,delivery:eligible('sad'),receipt:played(a)}),true);
  assert.equal(s.take({context:b,nowMs:1001})?.value,'sad');
  assert.equal(s.commitPlayed({context:b,nowMs:1200,delivery:eligible('amused'),receipt:played(b)}),true);
  assert.equal(s.commitPlayed({context:a,nowMs:1300,delivery:eligible('sad'),receipt:played(a)}),false);
  assert.equal(s.take({context:c,nowMs:1400})?.value,'amused');
});

function runtimeFixture() {
  const H=uuid(10),R=uuid(11),O=uuid(12),I=uuid(13),C=uuid(14);
  const B=uuid(15),T=uuid(16),S=uuid(17);
  const hostContext=Object.freeze({hostContextVersion:1,hostRunId:H,worldEpoch:2});
  const claim=Object.freeze({worldProfileId:R,sourceNamespace:'comrade.authored',
    sourceKey:'p2.owned',adapterEpoch:R,incarnationId:I,claimRevision:1});
  const binding=Object.freeze({serverRunId:S,bindingId:B,bindingRevision:5,
    characterId:C,pedId:'17',sessionNonce:2,claim});
  const frame=Object.freeze({version:1,protagonist:'franklin',revision:1,
    source:'native_player_model',hostRunId:H,worldEpoch:2});
  let now=1000;
  const protagonistAuthority={readVerified:()=>frame,isCurrent:record=>record===frame};
  const perception={epoch:R,stream:'ea7',hostContext,
    channelFresh:()=>true,now:()=>10000,current:()=>true,
    anchors:new Map([[O,{kind:'ped'}]]),
    observerIndex:new Map([[O,{kind:'ped',owned:true,encounterId:R,incarnationId:I}]]),
    observations:{entries:new Map()},
    directorOwnerProofFor:()=>({speakerCaptureRef:O,hostRunId:H,worldEpoch:2,
      ownerIncarnationId:I,proofRevision:7})};
  const db={activeTimelineId:T,timelineSourceStatus:'verified',timelineWritable:true};
  const identityService={bindings:{get:()=>binding},evidence:{hostContext,
    isCurrent:()=>true},current:()=>true};
  const runtime={identityService,host:{isCurrent:()=>true},
    intelligence:{runtime:perception},characterService:{store:db}};
  const makeTurn=generationId=>{
    const id=identity(generationId);
    return {identity:id,turn:{identity:id,characterSnapshot:Object.freeze({
      nativeIdentity:id,bindingId:B,bindingRevision:5,
      resolution:Object.freeze({kind:'persistent',characterId:C})}),
      knowledgeInputs:Object.freeze({
        association:Object.freeze({owned:true,captureRef:O,
          encounterId:R,incarnationId:I}),
        ownerClaim:claim,ownerPendingProof:false,reason:null,turn:id,
        anchorStatus:'verified_observer',hostRunId:H,worldEpoch:2,
        psAdapterEpoch:R,psStreamId:'ea7',
      })}};
  };
  return {runtime,db,identityService,makeTurn,advance:t=>{now=t;},
    mood:createMoodRuntime({getRuntime:()=>runtime,protagonistAuthority,clock:()=>now})};
}

test('EA7 stale cancellation cannot erase a newer native generation mood',()=>{
  const f=runtimeFixture(),first=f.makeTurn(4),next=f.makeTurn(5),later=f.makeTurn(6);
  assert.equal(f.mood.onSpeechCompleted({...first,delivery:eligible('sad'),
    receipt:nativeReceipt(first.identity)}),true);
  assert.equal(f.mood.readMood(next)?.value,'sad');
  f.advance(1200);
  assert.equal(f.mood.onSpeechCompleted({...next,delivery:eligible('amused'),
    receipt:nativeReceipt(next.identity)}),true);
  // The host has now retired generation four. Its late finally callback
  // cannot turn failed proof into a global clear.
  f.runtime.host.isCurrent=id=>id.generationId!==4;
  f.mood.retireTurn({...first,completed:false});
  assert.equal(f.mood.readMood(later)?.value,'amused');
});

test('EA7 runtime still fails neutral on revoked M1 approval or native identity',()=>{
  const f=runtimeFixture(),a=f.makeTurn(4),b=f.makeTurn(5);
  assert.equal(f.mood.onSpeechCompleted({...a,delivery:eligible('amused'),
    receipt:nativeReceipt(a.identity)}),true);
  f.db.timelineWritable=false;
  assert.equal(f.mood.readMood(b),null);
  assert.equal(f.mood.size,0);
});

test('EA7 normal lifecycle never stores transcript, eyewitness facts or permanent personality',()=>{
  const s=new MoodStore(),a=moodContext(4),secret=eligible('amused');
  assert.equal(s.commitPlayed({context:a,nowMs:1000,delivery:{
    ...secret,evidenceRef:'PS2-observation',dialogue:'Secret sentence',
    modelFact:'Actor became a different person',
  },receipt:played(a)}),true);
  const hint=s.take({context:moodContext(5),nowMs:1001});
  assert.deepEqual(hint,{value:'amused',confidence:'soft',intensity:'subtle'});
  assert.equal(JSON.stringify(hint).includes('Secret'),false);
  assert.equal(hint.evidenceRef,undefined);
});

test('EA7 current NPC reassurance overrides old soft mood but ordinary speech can retain it',()=>{
  const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
  const actor=Object.freeze({
    characterId:uid(100),observerCaptureRef:uid(101),incarnationId:uid(102),
    ownerProofRevision:1,hostRunId:uid(103),worldEpoch:1,
    nativeRun:uid(104),pedId:'17',sessionNonce:2,
    turnId:'turn-5',generationId:5,timelineId:uid(105),
  });
  const projection=Object.freeze({
    verifiedOwner:true,lifetimeCurrent:true,channelHealthy:true,
    identity:Object.freeze({...actor}),observations:Object.freeze([]),
  });
  const prior=Object.freeze({value:'sad',confidence:'soft',intensity:'subtle'});
  const call=segmentText=>resolveDelivery({
    identity:actor,segmentText,source:'player_text',nowMonotonicMs:1000,
    currentSceneEvidence:projection,actorTraits:null,priorEphemeralMood:prior,
    config:{mode:'experimental',intensity:'subtle',maxTaggedSegmentsPerTurn:2},
  });
  assert.equal(call("I'm fine now.").value,'neutral');
  assert.equal(call("I'm not sad anymore.").value,'neutral');
  assert.equal(call("There's nothing to worry about.").value,'neutral');
  assert.equal(call('We should go to Sandy Shores.').source,'ephemeral_mood');
});

test('EA7 disconnected runtime supplier fails neutral without throwing or reviving stale state',()=>{
  const mood=createMoodRuntime({getRuntime:()=>{throw new Error('connection lost');},
    clock:()=>1000});
  const a={identity:identity(4),turn:{characterSnapshot:null}};
  assert.equal(mood.readMood(a),null);
  assert.equal(mood.onSpeechCompleted({...a,delivery:eligible('sad'),
    receipt:nativeReceipt(a.identity)}),false);
  mood.retireTurn({...a,completed:false});
  assert.equal(mood.size,0);
});
