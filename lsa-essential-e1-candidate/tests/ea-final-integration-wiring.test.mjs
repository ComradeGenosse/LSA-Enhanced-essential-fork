import test from 'node:test';
import assert from 'node:assert/strict';
import {runSequentialTurn} from '../src/openai/runSequentialTurn.mjs';
import {DialogueHistory} from '../src/memory/dialogueHistory.mjs';
import {createDelivery} from '../src/voice/emotion/deliveryContract.mjs';
import {emitTagged} from './helpers/eaFinalApplied.mjs';

// EA-F: exercises the ACTUAL turn runner with the ACTUAL ElevenLabs provider
// and fake socket, not just the independent selector's synthesized() calls.
const ID=Object.freeze({pedId:'17',sessionNonce:2,turnId:'ea-f-turn',generationId:12});
async function run({early=false,mode='experimental',historyReject=false,source='player_text'}={}) {
  const history=new DialogueHistory({maxMessages:8});
  const originalAccept=history.acceptPlaybackResult.bind(history);
  if(historyReject)history.acceptPlaybackResult=()=>false;
  else history.acceptPlaybackResult=(...args)=>originalAccept(...args);
  const utterance=early?'First sad. Final joke.':'Final joke.';
  const spoken=[],nativeEvents=[],moods=[],calls=[];
  const host={
    isCurrent:()=>true,assertCapabilities:()=>{},
    prepareTurn:async()=>{},
    telemetry:{beginTurn:()=>({
      event:()=>{},stage:()=>{},count:()=>{},startSpan:()=>()=>{},
      audioPcm:()=>{},native:()=>{},finish:()=>{},
    })},
    observe:()=>({
      authorization:async()=>({ok:true}),
      completion:async()=>({...ID,ok:true,type:'playback_ended',
        reason:'completed',wasInterrupted:false,hadAudio:true,playbackStarted:true}),
      dispose:()=>{},
    }),
    authorize:async()=>true,emit:async e=>{nativeEvents.push(e);return true;},
    validateDecision:async()=>({identityValid:true,internalTranscript:utterance,actionCount:0}),
    failTurn:async()=>{},
  };
  const emotionalActing={
    resolveDelivery:({segmentText})=>createDelivery({
      version:1,value:segmentText.includes('Final')?'amused':'sad',
      source:'dialogue_cue',confidence:'soft',intensity:'subtle',
      evidenceRef:null,
    }),
    onSpeechCompleted:args=>{moods.push(args);return true;},
    retireTurn:()=>calls.push('retired'),
  };
  const services={
    config:{speechProvider:'elevenlabs',elevenLabs:{modelId:'eleven_v4_turbo'},
      ttsVolume:1,providerWorkDeadlineMs:10000,
      structuredStreamingEnabled:early,earlyTtsEnabled:early,
      streamingMaxPcmBytes:200000,streamingMaxSegments:6,
      expressiveDelivery:{mode,intensity:'subtle',maxTaggedSegmentsPerTurn:2}},
    emotionalActing,
    providerStack:{
      reasoning:{id:'openai.reasoning'},speech:{id:'elevenlabs.speech'},
      decideStreaming:async({onSegment})=>{
        await onSegment({text:'First sad.',sequence:1},'dialogue_only');
        await onSegment({text:'Final joke.',sequence:2},'dialogue_only');
        return {decision:{dialogue:utterance,command:''},mode:'dialogue_only'};
      },
    },
    decide:async()=>({dialogue:utterance,command:''}),
    transcribe:async()=> 'microphone source',
    speak:async({identity,dialogue,delivery,signal,onPcm})=>{
      const produced=await emitTagged({identity,dialogue,delivery,signal,onPcm,mode});
      spoken.push({dialogue,delivery,produced});
      return produced.result;
    },
  };
  const turn={identity:ID,source,input:'player text',context:{},priorHistory:[],
    speechProfile:{provider:'elevenlabs',voice:'nathan'},
    ...(source==='player_mic'?{pcm:Uint8Array.from([0,0]),sampleRate:16000}:{})};
  const result=await runSequentialTurn({connection:{detachAbort:()=>{}},
    turn,services,history,host});
  return {result,spoken,moods,nativeEvents,history,utterance,calls};
}
test('EA-F buffered real provider tag + accepted native history create exactly one mood',async()=>{
  const x=await run();
  assert.equal(x.result.status,'completed');
  assert.equal(x.spoken.length,1);
  assert.equal(x.spoken[0].produced.result.tagApplied,true);
  assert.equal(x.spoken[0].produced.sockets[0].frames[1].inputs[0].text,'[laughs] Final joke.');
  assert.equal(x.moods.length,1);
  assert.equal(x.moods[0].delivery.value,'amused');
  assert.equal(x.moods[0].historyAccepted,true);
  assert.equal(x.moods[0].providerResult,x.spoken[0].produced.result);
  assert.equal(x.nativeEvents.find(e=>e.type==='output_transcript').text,x.utterance);
  assert.equal(x.history.readForSession('17',2).at(-1).content,x.utterance);
});
test('EA-F early streaming retains distinct applied provider returns and last audible mood',async()=>{
  const x=await run({early:true});
  assert.equal(x.result.status,'completed');
  assert.equal(x.spoken.length,2);
  assert.equal(x.spoken[0].produced.result.tagApplied,true);
  assert.equal(x.spoken[1].produced.result.tagApplied,true);
  assert.equal(x.moods.length,1);
  assert.equal(x.moods[0].delivery.value,'amused');
  assert.equal(x.moods[0].providerResult,x.spoken[1].produced.result);
  assert.equal(x.history.readForSession('17',2).at(-1).content,x.utterance);
});
test('EA-F history rejection never authorizes mood even if native audio finished',async()=>{
  const x=await run({historyReject:true});
  assert.notEqual(x.result.status,'completed');
  assert.equal(x.moods.length,0);
});
test('EA-F shadow keeps WebSocket speech untagged and never seeds mood',async()=>{
  const x=await run({mode:'shadow'});
  assert.equal(x.result.status,'completed');
  assert.equal(x.spoken[0].produced.sockets[0].frames[1].inputs[0].text,x.utterance);
  assert.equal(x.moods.length,0);
});
