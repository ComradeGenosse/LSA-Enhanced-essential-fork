import test from 'node:test';
import assert from 'node:assert/strict';
import { runSequentialTurn } from '../src/openai/runSequentialTurn.mjs';
import { executeProviderOperation } from '../src/reliability/providerExecutor.mjs';
import { createElevenLabsSpeechProvider, wasElevenTagApplied } from '../src/providers/elevenlabs/speechProvider.mjs';
import { renderElevenSpeech } from '../src/voice/emotion/elevenTags.mjs';
import { createDelivery } from '../src/voice/emotion/deliveryContract.mjs';
import { DialogueHistory } from '../src/memory/dialogueHistory.mjs';

// EA118 R2: Offline integration regression. No network or paid vendor request.
// These tests MUST use the original runner, original provider executor and
// actual ElevenLabs provider; only the WebSocket and native host are faked.
const ID = Object.freeze({pedId:'ea118-ped', sessionNonce:71, turnId:'ea118-r2', generationId:5});
const VOICE = 'JBFqnCBsd6RMkjVDRZzb';
const FIRST = 'First joke.';
const SECOND = 'Second joke.';
const PCM = Buffer.alloc(4800, 0x12).toString('base64');
const delivery = () => createDelivery({
  value:'amused', source:'dialogue_cue', confidence:'soft', intensity:'subtle',
});

function fakeTransport(behavior = 'silent') {
  const sockets = [];
  class FakeWebSocket {
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.closed = 0;
      this.listeners = new Map();
      sockets.push(this);
      if (behavior !== 'no_open') queueMicrotask(() => this.emit('open', {}));
    }
    addEventListener(type, listener) {
      const list = this.listeners.get(type) || [];
      list.push(listener);
      this.listeners.set(type, list);
    }
    emit(type, event) {
      for (const listener of this.listeners.get(type) || []) listener(event);
    }
    send(text) {
      this.sent.push(text); // raw serialized WebSocket frames, not reconstructed payloads
      if (!JSON.parse(text).close_socket) return;
      queueMicrotask(() => {
        if (behavior === 'error_after_input') this.emit('error', {});
        if (behavior === 'partial') this.emit('message', {data:JSON.stringify({audio:PCM})});
        if (behavior === 'success') {
          this.emit('message', {data:JSON.stringify({audio:PCM})});
          this.emit('message', {data:JSON.stringify({is_final:true})});
        }
      });
    }
    close() { this.closed++; }
  }
  return {FakeWebSocket, sockets};
}

async function runCase({
  early = false, behavior = 'silent', mode = 'experimental',
  speechProvider = 'elevenlabs', retryEnabled = true, modelFailures = 0,
  sttFailures = 0, ttsFailures = 0, partialThenFailure = false,
  transcript = false, intervene = null, historyReject = false,
  actions = 0, segments = [FIRST, SECOND],
} = {}) {
  const transport = fakeTransport(behavior);
  const history = new DialogueHistory({maxMessages:8});
  if (historyReject) history.acceptPlaybackResult = () => false;
  const events = [], nativeEvents = [], moods = [], successfulSpeech = [];
  let current = true, completionCalls = 0, authorizationCalls = 0;
  let modelAttempts = 0, sttAttempts = 0, ttsAttempts = 0;
  const text = early ? segments.join(' ') : FIRST;
  const config = {
    speechProvider, speechVoices:['nathan'], ttsVoice:'nathan',
    elevenLabs:{apiKey:'FAKE-NEVER-SEND', modelId:'eleven_v4_turbo', voices:{nathan:VOICE}},
    expressiveDelivery:{mode,intensity:'subtle',maxTaggedSegmentsPerTurn:2},
    ttsVolume:1, structuredStreamingEnabled:early, earlyTtsEnabled:early,
    streamingMaxPcmBytes:200000, streamingMaxSegments:6,
    providerWorkDeadlineMs:650,
  };
  const provider = createElevenLabsSpeechProvider({
    config, WebSocketImpl:transport.FakeWebSocket, renderSpeech:renderElevenSpeech,
  });
  const host = {
    isCurrent:()=>current, assertCapabilities:()=>{}, prepareTurn:async()=>{},
    telemetry:{beginTurn:()=>({
      event:(name,data)=>events.push({name,data}), stage:()=>{}, count:()=>{},
      startSpan:()=>()=>{}, audioPcm:()=>{}, native:()=>{}, finish:()=>{},
    })},
    observe:()=>({
      authorization:async()=>({ok:true}),
      completion:async()=>{completionCalls++;return {...ID, ok:true, type:'playback_ended',
        reason:'completed', wasInterrupted:false, hadAudio:true, playbackStarted:true};},
      dispose:()=>{},
    }),
    authorize:async()=>{authorizationCalls++;return true;},
    emit:async event=>{nativeEvents.push(event);return true;},
    validateDecision:async decision=>({
      identityValid:true, internalTranscript:decision.dialogue, actionCount:actions,
    }),
    failTurn:async()=>{},
  };
  const emotionalActing = {
    resolveDelivery:()=>delivery(),
    onSpeechCompleted:args=>{moods.push(args);return true;},
    retireTurn:()=>{},
  };
  const retryConfig = {
    enabled:retryEnabled, maxAttempts:2, baseDelayMs:0, maxDelayMs:0,
    minAttemptBudgetMs:1, attemptTimeoutMs:45, jitter:'bounded',
  };
  const failTransient = () => Object.assign(new Error('timeout'), {code:'timeout'});
  const services = {
    config, emotionalActing,
    executeProvider:request=>executeProviderOperation({
      ...request, retryConfig, random:()=>0,
    }),
    providerStack:{
      reasoning:{id:'openai.reasoning'},
      speech:{id:speechProvider === 'elevenlabs' ? 'elevenlabs.speech' : speechProvider+'.speech'},
      transcription:{id:'openai.transcription'},
      decideStreaming:async({onSegment})=>{
        modelAttempts++;
        if (modelAttempts <= modelFailures) throw failTransient();
        for (const [i, segment] of segments.entries())
          await onSegment({sequence:i+1,text:segment}, 'dialogue_only');
        return {decision:{dialogue:text,command:''},mode:'dialogue_only'};
      },
    },
    decide:async()=>{
      modelAttempts++;
      if (modelAttempts <= modelFailures) throw failTransient();
      return {dialogue:text,command:''};
    },
    transcribe:async()=>{
      sttAttempts++;
      if (sttAttempts <= sttFailures) throw failTransient();
      return 'Recognized player speech.';
    },
    speak:async({identity,dialogue,delivery:resolved,speechProfile,signal,timeoutMs,telemetry,onPcm})=>{
      ttsAttempts++;
      if (speechProvider === 'elevenlabs') {
        const result = await provider.synthesize({
          identity, dialogue, delivery:resolved, speechProfile,
          signal, timeoutMs, telemetry, onPcm,
        });
        successfulSpeech.push({dialogue, result, resolved,
          genuineBrand:wasElevenTagApplied(result, {delivery:resolved,identity})});
        return result;
      }
      if (partialThenFailure) {
        await onPcm(Uint8Array.from([1,0,2,0]));
        throw failTransient();
      }
      if (ttsAttempts <= ttsFailures) throw failTransient();
      await onPcm(Uint8Array.from([1,0,2,0]));
      return {bytes:4,chunks:1,discardedTrailingByte:false};
    },
  };
  const turn = {identity:ID, source:transcript?'player_mic':'player_text',
    input:transcript?'':'Hello NPC', context:{}, priorHistory:[],
    speechProfile:{provider:speechProvider,voice:'nathan'},
    ...(transcript?{pcm:Uint8Array.from([1,0]),sampleRate:16000}:{}),
  };
  const controller = new AbortController();
  if (intervene) setTimeout(()=>{
    if (intervene === 'supersede') current = false;
    controller.abort(new Error(intervene === 'supersede' ? 'superseded' : 'cancelled'));
  }, 12);
  const result = await runSequentialTurn({
    connection:{detachAbort:()=>{}}, turn, controller, services, history, host,
  });
  return {result,transport,history,events,nativeEvents,moods,successfulSpeech,
    get completionCalls(){return completionCalls;},
    get authorizationCalls(){return authorizationCalls;},
    modelAttempts,sttAttempts,ttsAttempts,text,controller};
}
function textSubmissions(x) {
  return x.transport.sockets.flatMap(s=>s.sent
    .map(raw=>JSON.parse(raw)).filter(frame=>frame.inputs).map(frame=>frame.inputs[0].text));
}
function ttsAttemptStarts(x) {
  return x.events.filter(e=>e.name==='provider_attempt_started' && e.data.operation==='tts');
}
function assertNoFalseCompletion(x) {
  assert.notEqual(x.result.status,'completed');
  assert.equal(x.completionCalls,0,'no fabricated native playback completion');
  assert.equal(x.nativeEvents.some(e=>e.type==='audio_turn_accepted'),false);
  assert.equal(x.nativeEvents.some(e=>e.type==='generation_complete'),false);
  assert.equal(x.nativeEvents.some(e=>e.type==='turn_complete'),false);
  assert.equal(x.nativeEvents.some(e=>e.type==='audio'),false);
  assert.equal(x.history.readForSession(ID.pedId,ID.sessionNonce)
    .some(message=>message.role==='assistant'),false);
  assert.equal(x.moods.length,0,'no EA4 mood commit without native playback and history');
}
function assertClosed(x) {
  assert.ok(x.transport.sockets.every(s=>s.closed === 1),'each socket closed once');
}

test('R2.01/R2.09 buffered accepted ElevenLabs input times out once despite two-attempt policy',async()=>{
  const x=await runCase();
  assert.deepEqual(textSubmissions(x),['[laughs] '+FIRST],
    'a second WebSocket text submission is a duplicate paid-request risk');
  assert.equal(x.transport.sockets.length,1);
  assert.equal(ttsAttemptStarts(x).length,1,'real executor MUST observe retry denial');
  assert.ok(x.events.some(e=>e.name==='provider_retry_skipped' && e.data.operation==='tts'));
  assert.equal(x.result.terminalReason,'provider_timeout');
  assertNoFalseCompletion(x);
  assertClosed(x);
});

test('R2.02/R2.09 structured early segment cannot be submitted twice or advance on failure',async()=>{
  const x=await runCase({early:true});
  assert.deepEqual(textSubmissions(x),['[laughs] '+FIRST]);
  assert.equal(ttsAttemptStarts(x).length,1);
  assert.equal(x.transport.sockets.length,1);
  assertNoFalseCompletion(x);
  assertClosed(x);
});

test('R2.03 failed before input and error after input never retries ElevenLabs',async()=>{
  for (const behavior of ['no_open','error_after_input','silent']) {
    const x=await runCase({behavior});
    assert.equal(ttsAttemptStarts(x).length,1,behavior);
    assert.equal(x.transport.sockets.length,1,behavior);
    assert.ok(textSubmissions(x).length <= 1,behavior);
    assertNoFalseCompletion(x);
    assertClosed(x);
  }
});

test('R2.04 failure after partial audio never commits assistant, mood or playback',async()=>{
  const x=await runCase({behavior:'partial'});
  assert.deepEqual(textSubmissions(x),['[laughs] '+FIRST]);
  assert.equal(ttsAttemptStarts(x).length,1);
  assert.notEqual(x.result.status,'completed');
  assert.equal(x.completionCalls,0);
  assert.ok(x.nativeEvents.some(e=>e.type==='audio'),
    'partial PCM really crossed the native side-effect boundary');
  assert.equal(x.nativeEvents.some(e=>e.type==='turn_complete'),false);
  assert.equal(x.history.readForSession(ID.pedId,ID.sessionNonce)
    .some(m=>m.role==='assistant'),false);
  assert.equal(x.moods.length,0);
  assertClosed(x);
});

test('R2.05 successful tagged synthesis uses real WeakMap brand, history and native acceptance',async()=>{
  const x=await runCase({behavior:'success'});
  assert.equal(x.result.status,'completed');
  assert.deepEqual(textSubmissions(x),['[laughs] '+FIRST]);
  assert.equal(x.successfulSpeech.length,1);
  assert.equal(x.successfulSpeech[0].genuineBrand,true);
  assert.equal(x.completionCalls,1);
  assert.equal(x.authorizationCalls,1);
  assert.equal(x.moods.length,1);
  assert.equal(x.moods[0].providerResult,x.successfulSpeech[0].result);
  assert.equal(x.history.readForSession(ID.pedId,ID.sessionNonce).at(-1).content,FIRST);
  assertClosed(x);
  const rejected=await runCase({behavior:'success',historyReject:true});
  assert.notEqual(rejected.result.status,'completed');
  assert.equal(rejected.moods.length,0);
});

test('R2.06 off/shadow serialized WebSocket frames are byte identical and untagged',async()=>{
  const off=await runCase({behavior:'success',mode:'off'});
  const shadow=await runCase({behavior:'success',mode:'shadow'});
  assert.equal(off.result.status,'completed');
  assert.equal(shadow.result.status,'completed');
  assert.deepEqual(off.transport.sockets[0].sent,shadow.transport.sockets[0].sent);
  assert.deepEqual(textSubmissions(off),[FIRST]);
  assert.deepEqual(textSubmissions(shadow),[FIRST]);
  assert.equal(off.moods.length,0);
  assert.equal(shadow.moods.length,0);
  assertClosed(off);
  assertClosed(shadow);
  const early=await runCase({early:true,behavior:'success'});
  assert.equal(early.result.status,'completed');
  assert.deepEqual(textSubmissions(early),['[laughs] '+FIRST,'[laughs] '+SECOND]);
  assert.equal(ttsAttemptStarts(early).length,2,
    'distinct valid speech segments still have independent vendor operations');
  assert.equal(early.moods.length,1);
  assertClosed(early);
});

test('R2.07 reasoning, transcription and stock OpenAI/Qwen speech retain retries',async()=>{
  for (const speechProvider of ['openai','faster-qwen3-tts']) {
    const x=await runCase({
      speechProvider, transcript:true, modelFailures:1, sttFailures:1, ttsFailures:1,
    });
    assert.equal(x.result.status,'completed',speechProvider);
    assert.equal(x.sttAttempts,2,speechProvider+' STT');
    assert.equal(x.modelAttempts,2,speechProvider+' reasoning');
    assert.equal(x.ttsAttempts,2,speechProvider+' speech');
    for (const operation of ['stt','model','tts']) {
      assert.equal(x.events.filter(e=>e.name==='provider_retry_recovered' &&
        e.data.operation===operation).length,1,speechProvider+' '+operation);
    }
    assert.equal(x.transport.sockets.length,0);
  }
  const sideEffect=await runCase({speechProvider:'openai',partialThenFailure:true});
  assert.notEqual(sideEffect.result.status,'completed');
  assert.equal(sideEffect.ttsAttempts,1,'native PCM side-effect fence still blocks retries');
  const action=await runCase({speechProvider:'openai',ttsFailures:1,actions:1});
  assert.notEqual(action.result.status,'completed');
  assert.equal(action.ttsAttempts,1,'published action still blocks pre-PCM retry');
});

test('R2.08 cancellation and stale-generation retirement close sockets and do not retry',async()=>{
  for (const intervene of ['cancel','supersede']) {
    const x=await runCase({intervene});
    assert.ok(['cancelled','superseded'].includes(x.result.terminalReason),intervene);
    assert.ok(x.transport.sockets.length <= 1);
    assert.ok(textSubmissions(x).length <= 1);
    assert.equal(ttsAttemptStarts(x).length,1);
    assertNoFalseCompletion(x);
    assertClosed(x);
    for (const socket of x.transport.sockets) {
      socket.emit('message',{data:JSON.stringify({audio:PCM})});
      socket.emit('message',{data:JSON.stringify({is_final:true})});
    }
    await Promise.resolve();
    assert.equal(x.nativeEvents.some(e=>e.type==='audio'),false,
      'retired socket cannot forward stale PCM after cancellation');
  }
});
