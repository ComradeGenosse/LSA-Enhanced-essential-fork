import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { createFasterQwenSpeechProvider } from '../src/providers/qwen/speechProvider.mjs';

const identity = { pedId:'17', turnId:'qwen', generationId:1, sessionNonce:1 };
const base = {
  speechProvider:'faster-qwen3-tts',
  qwenTts: { baseUrl:'http://127.0.0.1:8000/v1',
    speechVoices:['nathan'], playbackBufferMode:'adaptive' },
};
const audio = ms => new Uint8Array(ms * 48);
const nextTick = () => new Promise(resolve=>setImmediate(resolve));

function gatedPcm(first, last) {
  let finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const response = new Response(new ReadableStream({
    start(controller) {
      for (const part of first) controller.enqueue(part);
      gate.then(() => {
        for (const part of last) controller.enqueue(part);
        controller.close();
      });
    },
  }), { headers:{'x-lsa-sample-rate':'24000','x-lsa-request-id':'rid_0123456789abcdef'} });
  return { response, finish };
}
function logCollector() {
  const events = [];
  return { events, telemetry:{ audioRaw() {}, event(name, data){ events.push({ name, data }); } } };
}
function whenEvent(log, name) {
  // Used after yielding the native PCM handoff to the microtask queue.
  return log.events.find(item=>item.name===name);
}

test('adaptive mode starts supplying native audio before Qwen completes when the measured buffer is safe', { timeout:4000 }, async()=>{
  const config = normalizeConfig(base,{});
  assert.equal(config.qwenTts.playbackBufferMode,'adaptive');
  const partial = gatedPcm([audio(1100),audio(1100),audio(1100)], [audio(700)]);
  const { events, telemetry } = logCollector();
  const forwarded = [];
  let clockMs = 0;
  const provider = createFasterQwenSpeechProvider({config,clock:()=>clockMs,
    fetchImpl:async()=>partial.response});
  const resultPromise = provider.synthesize({
    identity,dialogue:'Hello, I am Nathan and this is an ordinary dialogue.',
    telemetry,playbackStartedAt:()=>null,
    onPcm:async pcm=>{forwarded.push(pcm.byteLength);},
  });
  await nextTick();
  assert.ok(whenEvent({events},'qwen_tts_adaptive_start'));
  assert.ok(forwarded.length>0,'adaptive should forward before the response closes');
  assert.equal(whenEvent({events},'qwen_tts_timing_summary'),undefined);
  clockMs=100;
  partial.finish();
  const result=await resultPromise;
  assert.equal(result.bytes,audio(4000).length);
  assert.equal(forwarded.reduce((sum,n)=>sum+n,0),result.bytes);
  assert.equal(events.filter(e=>e.name==='qwen_tts_underrun_risk').length,0);
  assert.equal(events.find(e=>e.name==='qwen_tts_timing_summary').data.underrunRiskCount,0);
});

test('a native-backed estimated underrun latches the current voice to full buffering on the next turn', { timeout:4000 }, async()=>{
  const config = normalizeConfig(base,{});
  let clockMs=0, calls=0;
  const first=gatedPcm([audio(1000),audio(1000),audio(1000)],[audio(400)]);
  const second=gatedPcm([audio(1000),audio(1000),audio(1000)],[audio(400)]);
  const {events,telemetry}=logCollector();
  const sent=[];
  const provider=createFasterQwenSpeechProvider({config,clock:()=>clockMs,
    fetchImpl:async()=>++calls===1?first.response:second.response});
  const firstPromise=provider.synthesize({
    identity,dialogue:'Something cheerful.',
    playbackStartedAt:()=>0,telemetry,onPcm:async chunk=>{sent.push(chunk.length);},
  });
  await nextTick();
  assert.ok(sent.length>0);
  assert.ok(whenEvent({events},'qwen_tts_adaptive_start'));
  clockMs=5000;
  first.finish();
  await firstPromise;
  assert.equal(events.filter(e=>e.name==='qwen_tts_underrun_risk').length,1);
  assert.ok(events.some(e=>e.name==='qwen_tts_adaptive_fallback' && e.data.code==='estimated_underrun'));
  assert.equal(events.find(e=>e.name==='qwen_tts_timing_summary').data.underrunRiskCount,1);

  const before=sent.length;
  const secondPromise=provider.synthesize({
    identity:{...identity,turnId:'next'},
    dialogue:'The next utterance must be fully buffered.',
    playbackStartedAt:()=>null,telemetry,onPcm:async chunk=>{sent.push(chunk.length);},
  });
  await nextTick();
  assert.equal(sent.length,before,'latch must hold all subsequent audio until EOF');
  assert.ok(events.some(e=>e.name==='qwen_tts_adaptive_fallback' && e.data.code==='voice_latched'));
  second.finish();
  const outcome=await secondPromise;
  assert.equal(outcome.bytes,audio(3400).length);
  assert.ok(sent.length>before);
});

test('slow or uncertain generation stays fully buffered without creating playback gaps', { timeout:4000 }, async()=>{
  const config=normalizeConfig(base,{});
  let clockMs=0;
  let release;
  const gate=new Promise(resolve=>{release=resolve;});
  const {events,telemetry}=logCollector();
  const sent=[];
  const provider=createFasterQwenSpeechProvider({config,clock:()=>clockMs,fetchImpl:async()=>new Response(new ReadableStream({
    async start(controller){
      controller.enqueue(audio(1000));
      await nextTick();
      clockMs=2000;
      controller.enqueue(audio(1000));
      await nextTick();
      clockMs=4000;
      controller.enqueue(audio(1000));
      await gate;
      controller.close();
    },
  }),{headers:{'x-lsa-sample-rate':'24000'}})});
  const resultPromise=provider.synthesize({identity,telemetry,
    dialogue:'This is deliberately a rather long phrase whose future speech duration is uncertain enough to be conservative.',
    onPcm:async chunk=>sent.push(chunk.length),playbackStartedAt:()=>null,
  });
  await nextTick();
  await nextTick();
  assert.equal(sent.length,0,'conservative adaptive guard waits on a slow generator');
  release();
  const result=await resultPromise;
  assert.equal(result.bytes,audio(3000).length);
  assert.ok(sent.length>0);
  assert.ok(events.some(e=>e.name==='qwen_tts_adaptive_fallback' && e.data.code==='insufficient_headroom'));
});

test('configuration retains explicit full-buffer and streaming overrides, with strict adaptive bounds',()=>{
  const cfg = value => normalizeConfig({...base,qwenTts:{...base.qwenTts,...value}},{});
  assert.equal(cfg({playbackBufferMode:'complete-utterance'}).qwenTts.playbackBufferMode,'complete-utterance');
  assert.equal(cfg({playbackBufferMode:'streaming'}).qwenTts.playbackBufferMode,'streaming');
  assert.equal(cfg({adaptiveMinBufferMs:250,adaptiveMaxBufferMs:500,adaptiveSafetyMs:250}).qwenTts.adaptiveMinBufferMs,250);
  assert.throws(()=>cfg({adaptiveMinBufferMs:0}),/adaptiveMinBufferMs/);
  assert.throws(()=>cfg({adaptiveMinBufferMs:8000,adaptiveMaxBufferMs:5000}),/adaptiveMaxBufferMs/);
  assert.throws(()=>cfg({playbackBufferMode:'other'}),/playbackBufferMode/);
});
