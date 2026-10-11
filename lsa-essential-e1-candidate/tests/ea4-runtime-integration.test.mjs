import test from 'node:test';
import assert from 'node:assert/strict';
import { createMoodRuntime } from '../src/voice/emotion/moodRuntime.mjs';
import { createDelivery } from '../src/voice/emotion/deliveryContract.mjs';
import { emitTagged } from './helpers/eaFinalApplied.mjs';

const ID=Object.freeze({pedId:'17',sessionNonce:2,turnId:'turn-1',generationId:4});
const H='11111111-1111-4111-8111-111111111111';
const R='22222222-2222-4222-8222-222222222222';
const O='33333333-3333-4333-8333-333333333333';
const I='44444444-4444-4444-8444-444444444444';
const C='55555555-5555-4555-8555-555555555555';
const T='66666666-6666-4666-8666-666666666666';
const B='77777777-7777-4777-8777-777777777777';
const S='88888888-8888-4888-8888-888888888888';
const claim=Object.freeze({worldProfileId:R,sourceNamespace:'comrade.authored',
  sourceKey:'p2.owned',adapterEpoch:R,incarnationId:I,claimRevision:1});
const delivery=createDelivery({version:1,value:'amused',source:'dialogue_cue',
  confidence:'soft',intensity:'subtle',evidenceRef:null});
function receipt(identity){
  return {...identity,ok:true,type:'playback_ended',wasInterrupted:false,
    hadAudio:true,playbackStarted:true,reason:'completed'};
}
async function authorized(mood,args){
  const {result}=await emitTagged({identity:args.identity,delivery:args.delivery});
  return mood.onSpeechCompleted({...args,providerResult:result,historyAccepted:true});
}
function fixture({authority=true,sqlite=true}={}){
  const hc=Object.freeze({hostContextVersion:1,hostRunId:H,worldEpoch:2});
  const binding=Object.freeze({serverRunId:S,bindingId:B,bindingRevision:5,
    characterId:C,pedId:ID.pedId,sessionNonce:ID.sessionNonce,claim});
  const frame=Object.freeze({version:1,protagonist:'franklin',revision:1,
    source:'native_player_model',hostRunId:H,worldEpoch:2});
  let activeFrame=frame,authCurrent=true,now=1000;
  const protagonistAuthority=authority?{
    readVerified:()=>activeFrame,
    isCurrent:target=>authCurrent && target === activeFrame,
  }:null;
  const perception={epoch:R,stream:'test-stream',hostContext:hc,
    channelFresh:()=>true,now:()=>10000,current:()=>true,
    anchors:new Map([[O,{kind:'ped'}]]),
    observerIndex:new Map([[O,{kind:'ped',owned:true,encounterId:R,incarnationId:I}]]),
    observations:{entries:new Map()},
    directorOwnerProofFor:()=>({speakerCaptureRef:O,hostRunId:H,worldEpoch:2,
      ownerIncarnationId:I,proofRevision:7}),
  };
  const db={activeTimelineId:T,timelineSourceStatus:sqlite?'verified':'unavailable',
    timelineWritable:sqlite};
  const identityService={bindings:{get:()=>binding},evidence:{hostContext:hc,
    isCurrent:()=>true},current:()=>true};
  const runtime={identityService,host:{isCurrent:()=>true},
    intelligence:{runtime:perception},characterService:{store:db}};
  const makeTurn=(generation=4,characterId=C)=>{
    const identity=Object.freeze({...ID,turnId:'turn-'+(generation-3),
      generationId:generation});
    const snapshot=Object.freeze({nativeIdentity:identity,bindingId:B,
      bindingRevision:5,resolution:Object.freeze({kind:'persistent',characterId})});
    const knowledgeInputs=Object.freeze({association:Object.freeze({
      owned:true,captureRef:O,encounterId:R,incarnationId:I}),
      ownerClaim:claim,ownerPendingProof:false,reason:null,turn:identity,
      anchorStatus:'verified_observer',hostRunId:H,worldEpoch:2,
      psAdapterEpoch:R,psStreamId:'test-stream'});
    return {identity,turn:{identity,characterSnapshot:snapshot,knowledgeInputs}};
  };
  const mood=createMoodRuntime({getRuntime:()=>runtime,
    protagonistAuthority,clock:()=>now});
  return {runtime,mood,db,perception,identityService,frame,makeTurn,
    setNow:v=>{now=v;},revokeAuthority:()=>{authCurrent=false;},
    switchProtagonist:(protagonist,revision)=>{
      activeFrame=Object.freeze({...activeFrame,protagonist,revision});
    }};
}

test('EA4 carries only one next-generation soft hint after verified native playback',async()=>{
  const f=fixture(),first=f.makeTurn(),next=f.makeTurn(5),third=f.makeTurn(6);
  assert.equal(f.mood.readMood(first),null);
  assert.equal(await authorized(f.mood,{...first,delivery,
    receipt:receipt(first.identity)}),true);
  assert.equal(f.mood.size,1);
  assert.equal(f.mood.readMood(first),null);
  assert.deepEqual(f.mood.readMood(next),{
    value:'amused',confidence:'soft',intensity:'subtle',
  });
  assert.deepEqual(f.mood.readMood(next),f.mood.readMood(next));
  assert.equal(f.mood.readMood(third),null);
  f.mood.retireTurn({...first,completed:true});
  assert.equal(f.mood.size,1,'finished turns keep one next-turn hint');
  f.mood.retireTurn({...next,completed:false});
  assert.equal(f.mood.size,0,'failed follow-up clears consumed mood');
});
test('EA4 never persists mood without M1 verified timeline and native protagonist authority',async()=>{
  for(const variant of [{authority:false},{sqlite:false}]){
    const f=fixture(variant),first=f.makeTurn();
    assert.equal(await authorized(f.mood,{...first,delivery,
      receipt:receipt(first.identity)}),false);
    assert.equal(f.mood.readMood(f.makeTurn(5)),null);
  }
});
test('EA4 rejects unaccepted, interrupted and mismatched playback receipts',async()=>{
  const f=fixture(),first=f.makeTurn();
  for(const changes of [{ok:false},{wasInterrupted:true},{type:'playback_started'},
    {turnId:'other'},{sessionNonce:500},{hadAudio:false}]){
    assert.equal(await authorized(f.mood,{...first,delivery,
      receipt:{...receipt(first.identity),...changes}}),false);
  }
  assert.equal(f.mood.size,0);
});
test('EA4 invalidates on host epoch, timeline, protagonist revision, PS2 owner and P1 binding changes',async()=>{
  for(const invalidate of [
    f=>{f.db.activeTimelineId=R;},
    f=>{f.db.timelineWritable=false;},
    f=>{f.db.timelineSourceStatus='unavailable';},
    f=>{f.perception.epoch=I;},
    f=>{f.perception.observerIndex.clear();},
    f=>{f.identityService.current=()=>false;},
    f=>{f.revokeAuthority();},
    f=>{f.runtime.host.isCurrent=()=>false;},
    f=>{f.perception.hostContext={...f.perception.hostContext,worldEpoch:3};},
  ]){
    const f=fixture(),first=f.makeTurn(),next=f.makeTurn(5);
    assert.equal(await authorized(f.mood,{...first,delivery,
      receipt:receipt(first.identity)}),true);
    invalidate(f);
    assert.equal(f.mood.readMood(next),null);
  }
});
test('EA4 uses exact promoted owner and current native proof, never another character',async()=>{
  const f=fixture(),first=f.makeTurn(),next=f.makeTurn(5),foreign=f.makeTurn(5,R);
  assert.equal(await authorized(f.mood,{...first,delivery,
    receipt:receipt(first.identity)}),true);
  assert.equal(f.mood.readMood(next).value,'amused');
  // A failed/mismatched ownership attempt clears rather than borrowing mood.
  assert.equal(f.mood.readMood(foreign),null);
  assert.equal(f.mood.readMood(next),null);
});
test('EA4 expires without timers and refuses forged protobuf-style model data',async()=>{
  const f=fixture(),first=f.makeTurn(),next=f.makeTurn(5);
  assert.equal(await authorized(f.mood,{...first,delivery,
    receipt:receipt(first.identity)}),true);
  f.setNow(23000);
  assert.equal(f.mood.readMood(next),null);
  assert.throws(()=>{f.frame.protagonist='trevor';},TypeError);
});

test('EA4 protagonist switch including Franklin→Michael→Franklin ABA never resurrects mood',async()=>{
  const f=fixture(),first=f.makeTurn(),next=f.makeTurn(5);
  assert.equal(await authorized(f.mood,{...first,delivery,
    receipt:receipt(first.identity)}),true);
  f.switchProtagonist('michael',2);
  assert.equal(f.mood.readMood(next),null);
  f.switchProtagonist('franklin',3);
  assert.equal(f.mood.readMood(next),null);
  assert.equal(f.mood.size,0);
});
test('EA4 unavailable native protagonist report never fabricates a current hero',async()=>{
  const f=fixture(),first=f.makeTurn();
  f.switchProtagonist('unknown',2);
  assert.equal(await authorized(f.mood,{...first,delivery,
    receipt:receipt(first.identity)}),false);
  assert.equal(f.mood.size,0);
});
