import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {CAPABILITIES,validateFrame} from '../src/perception/contracts.mjs';
import {ShadowRuntime} from '../src/perception/shadowRuntime.mjs';
import {normalizeSpeechReceiptV2} from '../src/perception/speechReceiptV2.mjs';
import {validateActorCapture} from '../src/context/knowledgeInputs.mjs';
import {projectKnowledgeClaim} from '../src/context/knowledgeSelector.mjs';

const make=()=>{
  let now=20000,seq=0;
  const actor=randomUUID(),player=randomUUID(),heard=randomUUID(),far=randomUUID();
  const hostRunId=randomUUID(),worldEpoch=1,adapterEpoch=randomUUID(),streamId=randomUUID();
  const hello={version:1,type:'hello',adapterEpoch,streamId,
    hostContextVersion:1,hostRunId,worldEpoch,utteranceLifecycleVersion:1,
    observerIndexVersion:1,
    capabilities:Object.fromEntries(CAPABILITIES.map(c=>[c,
      c==='playerSpeech'||c==='witness']))};
  const runtime=new ShadowRuntime({mode:'shadow',now:()=>now});
  const frame=(type,payload)=>({version:1,type,adapterEpoch,streamId,sequence:++seq,payload});
  const send=(type,payload)=>runtime.ingest(frame(type,payload),{authenticated:true});
  assert.equal(runtime.ingest(hello,{authenticated:true}),true);
  assert.equal(send('anchors',[
    {captureRef:actor,kind:'ped',observer:true,owned:true},
    {captureRef:heard,kind:'ped',observer:true,owned:true},
    {captureRef:far,kind:'ped',observer:true,owned:true},
    {captureRef:player,kind:'player',observer:false,owned:false}
  ]),true);
  assert.equal(send('observer_index',[actor,heard,far].map(captureRef=>({
    captureRef,kind:'ped',owned:true,
    encounterId:randomUUID(),incarnationId:randomUUID()
  }))),true);
  const utteranceId=randomUUID(),identity={pedId:'17',sessionNonce:2,turnId:'mic-42',generationId:3};
  const fact=(phase,terminal,monotonicMs,gameTick)=>({
    utteranceVersion:1,utteranceId,phase,terminal,hostRunId,worldEpoch,
    monotonicMs,gameTick,inputSource:'essential_mic',micPedRef:actor});
  const witness=(ref,hearing,range=4)=>{
    const full=hearing==='heard';
    return {observer:{captureRef:ref,kind:'ped'},sampledGameTick:105,
      distanceMeters:range,acousticPath:full?'clear':'blocked',
      audibleIntervalsMs:full?[{start:0,end:900}]:[],hearing,
      reasonCodes:full?['sampled_speech']:['out_of_range'],
      acousticContext:{occlusion:full?'clear':'blocked',interior:'same',
        sourceVehicle:'on_foot',observerVehicle:'on_foot',
        sourceFacingToObserver:'unknown',attention:'unknown'}};
  };
  const receipt=({id=utteranceId,observer=heard,hearing='heard'}={})=>({
    speechVersion:2,nativeHostRunId:hostRunId,worldEpoch,utteranceId:id,
    source:{captureRef:player,kind:'player'},startGameTick:100,endGameTick:110,
    startMonotonicMs:5000,endMonotonicMs:5900,durationMs:900,ageMs:0,
    producerSequence:1,captureReceiptRef:randomUUID(),
    observers:[witness(observer,hearing),witness(far,'did_not_hear',20)]
  });
  return {runtime,send,frame,hello,actor,player,heard,far,utteranceId,
    identity,fact,receipt,host:{hostRunId,worldEpoch},now:v=>{now=v;}};
};

test('C-01 native-host clocks are normalized without cross-clock absolute comparisons',()=>{
 const f=make(),p=f.receipt(),local=normalizeSpeechReceiptV2(p,{
   host:f.host,adapterEpoch:f.hello.adapterEpoch,now:20000});
 assert.ok(local);assert.equal(local.startMonotonicMs,19100);
 assert.equal(local.endMonotonicMs,20000);
 assert.equal(local.durationMs,900);
 assert.equal(normalizeSpeechReceiptV2({...p,nativeHostRunId:randomUUID()},{
   host:f.host,adapterEpoch:f.hello.adapterEpoch,now:20000}),null);
 assert.equal(normalizeSpeechReceiptV2({...p,source:{captureRef:f.player,kind:'ped'}},{
   host:f.host,adapterEpoch:f.hello.adapterEpoch,now:20000}),null);
 assert.equal(validateFrame(f.frame('speech_receipt',{...p,text:'ILLEGAL'})),false);
});

test('C-01 verified one-STT transcript reaches only the fully heard NPC after terminal',()=>{
 const f=make(),text='Nathan, follow me to the store.';
 const captured={version:1,hostRunId:f.host.hostRunId,worldEpoch:1,
   captureRef:f.actor,sampledGameTick:100,micUtteranceId:f.utteranceId};
 assert.equal(validateActorCapture(captured),true);
 assert.equal(validateActorCapture({...captured,micUtteranceId:randomUUID(),unknown:true}),false);
 assert.equal(f.runtime.utterances.reserveMicTurn({identity:f.identity,
   actorRef:f.actor,utteranceId:f.utteranceId,...f.host},f.host),true);
 assert.equal(f.send('utterance',f.fact('started',null,5000,100)),true);
 assert.equal(f.runtime.utterances.finishPcm(f.identity,12000),true);
 assert.equal(f.send('speech_receipt',f.receipt()),true);
 assert.equal(f.runtime.transcripts.entries.size,0,'STT and mic terminal must arrive first');
 assert.equal(f.send('utterance',f.fact('ended','released',5900,110)),true);
 assert.equal(f.runtime.transcripts.entries.size,0,'no STT yet');
 assert.equal(f.runtime.acceptCapturedPlayerUtterance({identity:f.identity,text}).accepted,true);
 assert.equal(f.runtime.transcripts.entries.size,1);
 assert.equal(f.runtime.speechDiagnostics.accepted,1);
 assert.equal(f.runtime.speechDiagnostics.observations,1);
 assert.equal(f.runtime.observations.entries.size,1);
 const observation=[...f.runtime.observations.entries.values()][0].value;
 assert.equal(observation.observer.captureRef,f.heard);
 assert.equal(observation.eventType,'speech_heard');
 assert.equal(observation.claims[0].kind,'sound');
 assert.equal(projectKnowledgeClaim(observation.claims[0],observation,f.heard).kind,
   'overheard_speech_presence');
 assert.equal(f.runtime.resolveSpeechForObserver(observation.observationId,f.heard),text);
 assert.equal(f.runtime.resolveSpeechForObserver(observation.observationId,f.far),null);
 assert.equal(f.runtime.resolveSpeechForObserver(observation.observationId,f.actor),null);
 assert.equal(JSON.stringify(observation).includes(text),false);
 assert.equal(f.runtime.acceptCapturedPlayerUtterance({identity:f.identity,text:'changed'}).accepted,false);
 assert.equal(f.runtime.observations.entries.size,1,'no duplicate broadcasting');
});

test('C-01 cancelled microphone, wrong actor or stale host never distributes speech',()=>{
 const f=make();
 assert.equal(f.runtime.utterances.reserveMicTurn({identity:f.identity,
   actorRef:f.actor,utteranceId:randomUUID(),...f.host},f.host),true);
 assert.equal(f.send('utterance',f.fact('started',null,5000,100)),true);
 assert.equal(f.runtime.utterances.diagnostics.joined,0);
 assert.equal(f.runtime.utterances.finishPcm(f.identity,12000),true);
 assert.equal(f.send('speech_receipt',f.receipt()),true);
 assert.equal(f.send('utterance',f.fact('ended','released',5900,110)),true);
 assert.equal(f.runtime.acceptCapturedPlayerUtterance({identity:f.identity,text:'confidential'}).accepted,false);
 assert.equal(f.runtime.transcripts.entries.size,0);
 assert.equal(f.runtime.observations.entries.size,0);
});

test('C-01 partial intervals authorize speech presence, never words',()=>{
 const f=make();const p=f.receipt();
 p.observers[0].audibleIntervalsMs=[{start:200,end:600}];
 assert.equal(f.runtime.utterances.reserveMicTurn({identity:f.identity,
   actorRef:f.actor,utteranceId:f.utteranceId,...f.host},f.host),true);
 assert.equal(f.send('utterance',f.fact('started',null,5000,100)),true);
 assert.equal(f.runtime.utterances.finishPcm(f.identity,10000),true);
 assert.equal(f.send('speech_receipt',p),true);
 assert.equal(f.send('utterance',f.fact('ended','released',5900,110)),true);
 assert.equal(f.runtime.acceptCapturedPlayerUtterance({identity:f.identity,text:'private words'}).accepted,true);
 const observation=[...f.runtime.observations.entries.values()][0].value;
 assert.equal(observation.eventType,'speech_heard');
 assert.equal(f.runtime.resolveSpeechForObserver(observation.observationId,f.heard),null);
 assert.equal(JSON.stringify(observation).includes('private words'),false);
});

test('C-01 failed acoustic evidence cannot cause PS3/PS4 speech or transcript output',()=>{
 const f=make(),p=f.receipt();
 p.observers[0].acousticContext.interior='different';
 assert.equal(f.runtime.utterances.reserveMicTurn({identity:f.identity,
   actorRef:f.actor,utteranceId:f.utteranceId,...f.host},f.host),true);
 assert.equal(f.send('utterance',f.fact('started',null,5000,100)),true);
 assert.equal(f.runtime.utterances.finishPcm(f.identity,10000),true);
 assert.equal(f.send('speech_receipt',p),false);
 assert.equal(f.send('utterance',f.fact('ended','released',5900,110)),true);
 assert.equal(f.runtime.acceptCapturedPlayerUtterance({identity:f.identity,text:'Private'}).accepted,true);
 assert.equal(f.runtime.transcripts.entries.size,0);
 assert.equal(f.runtime.observations.entries.size,0);
});

test('C-01 ordinary GTA pedestrians cannot enter even a well-formed speech receipt',()=>{
  const f=make(),ordinary=randomUUID();
  assert.equal(f.send('anchors',[{captureRef:ordinary,kind:'ped',
    observer:true,owned:false}]),true);
  assert.equal(f.send('observer_index',[{captureRef:ordinary,kind:'ped',
    owned:false}]),true);
  const p=f.receipt({observer:ordinary});
  assert.equal(f.send('speech_receipt',p),false);
  assert.equal(f.runtime.transcripts.entries.size,0);
  assert.equal(f.runtime.speechDiagnostics.rejected,1);
});

test('C-01 demoted promoted NPC loses hearing before STT can authorize words',()=>{
  const f=make(),text='Do not give this to a retired observer.';
  assert.equal(f.runtime.utterances.reserveMicTurn({identity:f.identity,
    actorRef:f.actor,utteranceId:f.utteranceId,...f.host},f.host),true);
  assert.equal(f.send('utterance',f.fact('started',null,5000,100)),true);
  assert.equal(f.runtime.utterances.finishPcm(f.identity,12000),true);
  assert.equal(f.send('speech_receipt',f.receipt()),true);
  assert.equal(f.send('anchors',[{captureRef:f.heard,kind:'ped',
    observer:false,owned:true}]),true);
  assert.equal(f.send('utterance',f.fact('ended','released',5900,110)),true);
  assert.equal(f.runtime.acceptCapturedPlayerUtterance({identity:f.identity,text}).accepted,true);
  assert.equal(f.runtime.speechDiagnostics.observations,0);
  assert.equal(f.runtime.observations.entries.size,0);
});
