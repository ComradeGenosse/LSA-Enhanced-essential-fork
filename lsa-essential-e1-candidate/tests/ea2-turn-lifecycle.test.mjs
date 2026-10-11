import test from 'node:test';
import assert from 'node:assert/strict';
import {runSequentialTurn} from '../src/openai/runSequentialTurn.mjs';
import {DialogueHistory} from '../src/memory/dialogueHistory.mjs';

const ID=Object.freeze({pedId:'17',turnId:'turn-a',generationId:8,sessionNonce:2});
const DELIVERY=Object.freeze({version:1,value:'excited',source:'verified_scene',
  confidence:'supported',intensity:'subtle',evidenceRef:'opaque-receipt'});
const directorTicket=Object.freeze({schemaVersion:1,
  ticketId:'123e4567-e89b-42d3-a456-426614174000',
  dedupeKey:'ps:123e4567-e89b-42d3-a456-426614174000',
  priority:'director_urgent'});

async function execute({early=false,structured=false,source='player_text',
  action=false,cancelPcm=false,scene=null}={}) {
  const history=new DialogueHistory({maxMessages:8}),calls=[],events=[],emitted=[],moods=[];
  const controller=new AbortController();
  const canonical=structured?'One sentence. Two sentences.':'This is the canonical speech.';
  const decision={dialogue:canonical,command:action?'DO WaitHere':''};
  const status={current:true};
  const host={
    telemetry:{beginTurn:()=>({
      event:(name,data)=>events.push({name,data}),stage:()=>{},count:()=>{},
      startSpan:()=>()=>{},audioPcm:()=>{},native:()=>{},finish:()=>{},
    })},
    isCurrent:()=>status.current,assertCapabilities:()=>{},
    observe:()=>({
      authorization:async()=>({ok:true}),
      completion:async()=>({...ID,ok:true,type:'playback_ended',
        reason:'completed',wasInterrupted:false,hadAudio:true,playbackStarted:true}),
      dispose:()=>{},
    }),
    authorize:async()=>true,emit:async event=>{emitted.push(event);return true;},
    validateDecision:async()=>({identityValid:true,internalTranscript:canonical,
      actionCount:action?1:0}),
    failTurn:async()=>{},
  };
  const adapter={
    resolveDelivery:({segmentText,identity,source:origin,lunaHint})=>{
      calls.push({segmentText,identity,source:origin,lunaHint});
      return DELIVERY;
    },
    getSceneEvidence:()=>scene,
    onSpeechCompleted:({delivery})=>moods.push({completed:delivery.value}),
    retireTurn:()=>moods.push({retired:true}),
  };
  const speech=[],tokens=[];
  const services={
    config:{speechProvider:'elevenlabs',ttsVolume:1,turnDeadlineMs:3000,
      providerWorkDeadlineMs:3000,structuredStreamingEnabled:structured,
      earlyTtsEnabled:early,streamingMaxPcmBytes:200_000,streamingMaxSegments:6,
      expressiveDelivery:{mode:'experimental',intensity:'subtle',
        maxTaggedSegmentsPerTurn:2}},
    emotionalActing:adapter,
    providerStack:{
      reasoning:{id:'openai.reasoning'},speech:{id:'elevenlabs.speech'},
      transcription:{id:'openai.transcription'},
      decideStreaming:async ({onSegment})=>{
        if(onSegment) {
          await onSegment(Object.freeze({text:'One sentence.',sequence:1}),'dialogue_only');
          await onSegment(Object.freeze({text:'Two sentences.',sequence:2}),'dialogue_only');
        }
        return {decision,mode:'dialogue_only'};
      },
    },
    transcribe:async()=>'Microphone words unchanged.',
    decide:async()=>decision,
    speak:async ({dialogue,delivery,onPcm})=>{
      speech.push({dialogue,delivery});
      if(cancelPcm)controller.abort(new Error('superseded'));
      await onPcm(Uint8Array.from([1,0,2,0]));
      return {bytes:4,chunks:1,discardedTrailingByte:false};
    },
  };
  const turn={identity,source,input:'Typed words unchanged.',context:{},
    priorHistory:[],speechProfile:{provider:'elevenlabs',voice:'nathan'},
    ...(source==='player_mic' ? {pcm:Uint8Array.from([0,0]),sampleRate:16000} : {}),
    ...(source==='scene_director' ? {directorTicket} : {})};
  const result=await runSequentialTurn({
    connection:{detachAbort:()=>{}},turn,controller,services,history,host,
  });
  return {result,history,calls,speech,events,emitted,moods,canonical,turn};
}

test('buffered typed turn never changes text, transcript, command, memory history or native authorization',async()=>{
  const x=await execute();
  assert.equal(x.result.status,'completed');
  assert.deepEqual(x.speech.map(s=>s.dialogue),[x.canonical]);
  assert.equal(x.speech[0].delivery.value,'excited');
  assert.equal(x.calls.length,1);
  assert.equal(x.emitted.find(x=>x.type==='output_transcript').text,x.canonical);
  assert.deepEqual(x.history.readForSession('17',2),[
    {role:'user',content:'Typed words unchanged.'},
    {role:'assistant',content:x.canonical},
  ]);
  assert.equal(x.emitted.filter(e=>e.type==='audio').length,1);
  assert.deepEqual(x.moods.at(-1),{retired:true});
  assert.ok(x.events.some(e=>e.name==='acting_decision'));
});

test('early speech receives one hint per segment but never double-speaks buffered final answer',async()=>{
  const x=await execute({early:true,structured:true});
  assert.equal(x.result.status,'completed');
  assert.deepEqual(x.speech.map(x=>x.dialogue),['One sentence.','Two sentences.']);
  assert.deepEqual(x.speech.map(x=>x.delivery.value),['excited','excited']);
  assert.deepEqual(x.calls.map(x=>x.segmentText),['One sentence.','Two sentences.']);
  assert.equal(x.emitted.find(x=>x.type==='output_transcript').text,x.canonical);
  assert.equal(x.history.readForSession('17',2).at(-1).content,x.canonical);
  assert.equal(x.emitted.filter(e=>e.type==='audio').length,2);
  assert.equal(x.moods.filter(x=>x.completed).length,2);
});

test('buffered structured speech gets exactly one hint and one synthesis call',async()=>{
  const x=await execute({early:false,structured:true});
  assert.equal(x.result.status,'completed');
  assert.deepEqual(x.speech.map(s=>s.dialogue),[x.canonical]);
  assert.equal(x.calls.length,1);
  assert.deepEqual(x.history.readForSession('17',2).at(-1),{role:'assistant',content:x.canonical});
});

test('spontaneous scene-director speech uses same isolated delivery while keeping native ticket and command guard',async()=>{
  const x=await execute({source:'scene_director',scene:[{eventType:'threat',channel:'auditory'}]});
  assert.equal(x.result.status,'completed');
  assert.equal(x.calls[0].source,'scene_director');
  assert.equal(x.calls[0].identity,ID);
  assert.equal(x.speech[0].delivery.value,'excited');
  assert.equal(x.history.readForSession('17',2).at(-1).content,x.canonical);
});

test('STT path shares hint seam and stages original transcribed input separately',async()=>{
  const x=await execute({source:'player_mic'});
  assert.equal(x.result.status,'completed');
  assert.equal(x.speech[0].delivery.value,'excited');
  assert.equal(x.emitted.find(x=>x.type==='input_transcript').text,'Microphone words unchanged.');
  assert.equal(x.history.readForSession('17',2)[0].content,'Microphone words unchanged.');
});

test('interruption retires delivery state and does not commit assistant history',async()=>{
  const x=await execute({cancelPcm:true});
  assert.notEqual(x.result.status,'completed');
  assert.equal(x.speech.length,1);
  assert.deepEqual(x.moods,[{retired:true}]);
  assert.deepEqual(x.history.readForSession('17',2),[{role:'user',content:'Typed words unchanged.'}]);
  assert.equal(x.emitted.filter(x=>x.type==='turn_complete').length,0);
});
