import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runSequentialTurn} from '../src/openai/runSequentialTurn.mjs';
import {DialogueHistory} from '../src/memory/dialogueHistory.mjs';
import {pcmToWav} from '../src/voice/pcmWav.mjs';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const CHARACTER='12345678-1234-4123-8123-123456789abc';
const ID={pedId:'17',turnId:'recovery-test',generationId:1,sessionNonce:1};
const clips=[
  {id:'misheard',category:'misheard',asset:'misheard.wav',text:'What did you say?'},
  {id:'thought',category:'lost_thought',asset:'thought.wav',text:'Lost my train of thought.'},
  {id:'speech',category:'speech_lost',asset:'speech.wav',text:'My voice cut out.'},
  {id:'action',category:'action_unconfirmed',asset:'action.wav',text:'Hang on, let me check.'},
];
async function withAssets(run) {
  const directory=await mkdtemp(path.join(ROOT,'FallbackTest_'));
  const folder=path.basename(directory);
  try {
    await mkdir(path.join(directory,CHARACTER));
    await writeFile(path.join(directory,'manifest.json'),JSON.stringify({
      version:1,characters:[{characterId:CHARACTER,voice:'nathan_voice',clips}],
    }));
    for(const clip of clips)
      await writeFile(path.join(directory,CHARACTER,clip.asset),pcmToWav([Buffer.alloc(4800)]));
    return await run(folder);
  } finally {await rm(directory,{recursive:true,force:true});}
}
async function turnRun(assetDirectory,{fail='model',action=false,abort=false}={}) {
  const history=new DialogueHistory(),controller=new AbortController(),events=[];
  let failedNative=0,attemptedCommand=0;
  const nativeReceipt={...ID,ok:true,type:'playback_ended',reason:'completed',
    wasInterrupted:false,hadAudio:true,playbackStarted:true};
  const host={
    isCurrent:()=>true,
    assertCapabilities:()=>{},
    observe:()=>({
      authorization:async()=>({ok:true}),
      completion:async()=>nativeReceipt,
      dispose:()=>{},
    }),
    authorize:async()=>true,
    validateDecision:async decision=>({identityValid:true,
      internalTranscript:decision.command?'DO WaitHere\n'+decision.dialogue:decision.dialogue,
      actionCount:decision.command?1:0}),
    emit:async event=>{
      events.push(event);
      if(event.type==='output_transcript'&&event.text.startsWith('DO WaitHere'))attemptedCommand++;
      return true;
    },
    failTurn:async()=>{failedNative++;return true;},
  };
  const services={
    config:{
      localVoiceFallback:{enabled:true,assetDirectory,maxRecoveryDelayMs:1000},
      providerWorkDeadlineMs:3000,turnDeadlineMs:3000,
      structuredStreamingEnabled:false,speechProvider:'elevenlabs',ttsVolume:1,
      playbackCompletionGraceMs:5000,playbackCompletionMinMs:100,playbackCompletionMaxMs:60000,
    },
    providerStack:{reasoning:{id:'openai.reasoning'},speech:{id:'elevenlabs.speech'},
      transcription:{id:'openai.transcription'}},
    transcribe:async()=>{if(fail==='stt')throw Error('stt unavailable');return 'I said hello';},
    decide:async()=>{
      if(fail==='model')throw Error('model unavailable');
      return {dialogue:'Original answer was not said.',command:action?'DO WaitHere':''};
    },
    speak:async ({onPcm})=>{
      if(fail==='tts')throw Error('tts unavailable');
      if(fail==='partial'){
        await onPcm(Buffer.from([0,0]));
        throw Error('tts interrupted after native PCM');
      }
      if(abort){controller.abort(Error('superseded'));throw Error('tts interrupted');}
      await onPcm(Buffer.from([0,0]));return {bytes:2,chunks:1};
    },
  };
  const turn={identity:ID,source:fail==='stt'?'player_mic':'player_text',
    input:'Please wait.',...(fail==='stt'?{pcm:Buffer.from([0,0]),sampleRate:16000}:{}),
    context:{systemInstruction:'fixture',actor:{pedId:ID.pedId},listener:{pedId:'player'}},
    speechProfile:{voice:'nathan_voice',provider:'elevenlabs'},
    characterSnapshot:{resolution:{kind:'persistent',characterId:CHARACTER}},
    characterInputs:{profile:{characterId:CHARACTER}},
  };
  const result=await runSequentialTurn({
    connection:{detachAbort(){}},turn,controller,services,history,host,
  });
  return {result,events,history,failedNative,attemptedCommand};
}

test('Luna failure yields exactly one local native audio stream and only recorded spoken words in history',async()=>{
  await withAssets(async folder=>{
    const x=await turnRun(folder,{fail:'model'});
    assert.equal(x.result.status,'completed',JSON.stringify(x.result));
    assert.equal(x.result.fallback,true);
    assert.equal(x.events.filter(e=>e.type==='turn_complete').length,1);
    assert.equal(x.events.filter(e=>e.type==='audio').length,2);
    assert.equal(x.events.filter(e=>e.type==='output_transcript').length,1);
    assert.equal(x.history.readForSession(ID.pedId,ID.sessionNonce).at(-1).content,'Lost my train of thought.');
    assert.equal(x.failedNative,0);
  });
});

test('failed TTS after action publication speaks neutral line without replaying DO',async()=>{
  await withAssets(async folder=>{
    const x=await turnRun(folder,{fail:'tts',action:true});
    assert.equal(x.result.status,'completed',JSON.stringify(x.result));
    assert.equal(x.attemptedCommand,1);
    assert.equal(x.events.filter(e=>e.type==='output_transcript').length,1);
    assert.equal(x.events.filter(e=>e.type==='turn_complete').length,1);
    assert.equal(x.history.readForSession(ID.pedId,ID.sessionNonce).at(-1).content,'Hang on, let me check.');
  });
});

test('transcription failure selects misheard line without model calls',async()=>{
  await withAssets(async folder=>{
    const x=await turnRun(folder,{fail:'stt'});
    assert.equal(x.result.fallback,true);
    assert.equal(x.history.readForSession(ID.pedId,ID.sessionNonce).at(-1).content,'What did you say?');
    assert.equal(x.history.readForSession(ID.pedId,ID.sessionNonce).some(m=>m.role==='user'),false);
  });
});

test('post-native-PCM corruption and explicit cancellation must never start fallback',async()=>{
  await withAssets(async folder=>{
    const partial=await turnRun(folder,{fail:'partial'});
    assert.notEqual(partial.result.status,'completed');
    assert.equal(partial.events.filter(e=>e.type==='turn_complete').length,0);
    assert.equal(partial.failedNative,1);
    const cancelled=await turnRun(folder,{fail:'no',abort:true});
    assert.notEqual(cancelled.result.status,'completed');
    assert.equal(cancelled.events.filter(e=>e.type==='turn_complete').length,0);
    assert.equal(cancelled.failedNative,1);
  });
});
