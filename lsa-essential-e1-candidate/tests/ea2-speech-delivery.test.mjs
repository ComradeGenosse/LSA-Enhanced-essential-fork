import test from 'node:test';
import assert from 'node:assert/strict';
import {createSpeechDeliveryResolver} from '../src/voice/emotion/resolveSpeechDelivery.mjs';
import {createElevenLabsSpeechProvider} from '../src/providers/elevenlabs/speechProvider.mjs';

const ID=Object.freeze({pedId:'17',turnId:'a',generationId:2,sessionNonce:5});
const DELIVERY=Object.freeze({
  version:1,value:'amused',source:'dialogue_cue',confidence:'soft',
  intensity:'subtle',evidenceRef:null,
});
const CONFIG=Object.freeze({speechProvider:'elevenlabs',
  expressiveDelivery:{mode:'experimental',intensity:'subtle',maxTaggedSegmentsPerTurn:2}});
const voiceId='JBFqnCBsd6RMkjVDRZzb';
const voiceConfig=mode=>({
  speechProvider:'elevenlabs',speechVoices:['nathan'],ttsVoice:'nathan',
  elevenLabs:{modelId:'eleven_v4_turbo',voices:{nathan:voiceId},apiKey:'private-token'},
  expressiveDelivery:{mode},
});
function socketsFor(messages=[{audio:Buffer.alloc(4800).toString('base64')},{is_final:true}]) {
  const sockets=[];
  class FakeSocket {
    constructor(url) {
      this.url=url;this.sent=[];this.callbacks=new Map();this.closeCount=0;
      sockets.push(this);queueMicrotask(()=>this.emit('open',{}));
    }
    addEventListener(type,fn) {
      const a=this.callbacks.get(type)||[];
      a.push(fn);this.callbacks.set(type,a);
    }
    emit(type,event) { for(const fn of this.callbacks.get(type)||[]) fn(event); }
    send(text) {
      const frame=JSON.parse(text);this.sent.push(frame);
      if(frame.close_socket) queueMicrotask(()=>{
        for(const message of messages)this.emit('message',{data:JSON.stringify(message)});
      });
    }
    close() {this.closeCount++;}
  }
  return {FakeSocket,sockets};
}
const mockRenderer=({dialogue,delivery,enabled})=>
  enabled && delivery.value==='amused'?'[laughs] '+dialogue:dialogue;

test('EA2 resolver is disabled by default and never invokes scene or mood adapters',()=>{
  let calls=0;
  const adapter={resolveDelivery:()=>{calls++;return DELIVERY;}};
  const none=createSpeechDeliveryResolver({config:{speechProvider:'elevenlabs'},
    identity:ID,source:'player_text',adapter,isActive:()=>true});
  assert.equal(none.forSegment({text:'Hello',sequence:1}),null);
  const other=createSpeechDeliveryResolver({config:{...CONFIG,speechProvider:'openai'},
    identity:ID,source:'player_text',adapter,isActive:()=>true});
  assert.equal(other.forSegment({text:'Hello',sequence:1}),null);
  assert.equal(calls,0);
});

test('EA2 accepts only normalized selector results, forwards optional EA3 proposal as untrusted, and obeys per-turn budget',()=>{
  const seen=[], events=[],done=[];
  const adapter={
    resolveDelivery:args=>{seen.push(args);return DELIVERY;},
    getSceneEvidence:()=>Object.freeze([{verified:true}]),
    readMood:()=>Object.freeze({shortTerm:'amused'}),
    onSpeechCompleted:({delivery})=>done.push(delivery),
    retireTurn:()=>done.push('retired'),
  };
  const resolver=createSpeechDeliveryResolver({config:CONFIG,identity:ID,source:'player_text',
    turn:{},adapter,telemetry:{event:(name,data)=>events.push({name,data})},isActive:()=>true,clock:()=>123});
  const first=resolver.forSegment({text:'First private sentence',sequence:1,lunaHint:'sarcastic'});
  assert.equal(first.value,'amused');assert.ok(Object.isFrozen(first));
  assert.equal(seen[0].lunaHint,'sarcastic');
  assert.equal(seen[0].nowMonotonicMs,123);
  assert.equal(seen[0].currentSceneEvidence[0].verified,true);
  resolver.synthesized(first);
  assert.equal(resolver.forSegment({text:'replay',sequence:1}),null);
  assert.ok(resolver.forSegment({text:'Second',sequence:2}));
  assert.equal(resolver.forSegment({text:'Third',sequence:3}),null,'no third tag');
  resolver.retire();resolver.retire();
  assert.equal(resolver.forSegment({text:'late',sequence:4}),null);
  assert.deepEqual(done,[first,'retired']);
  assert.equal(events.length,3);
  assert.deepEqual(events.map(x=>x.data.acted),[true,true,false]);
  assert.ok(!JSON.stringify(events).includes('First private sentence'));
  assert.ok(!JSON.stringify(events).includes('shortTerm'));
  assert.ok(!JSON.stringify(events).includes('"pedId"'));
});

test('invalid EA1 response, fake tags and inactive native generation cannot produce emotional metadata',()=>{
  for(const malformed of [
    {...DELIVERY,value:'[laughs]'},
    {...DELIVERY,source:'unknown'},
    {...DELIVERY,extra:'[gunshot]'},
    {...DELIVERY,evidenceRef:'x'.repeat(200)},
    {...DELIVERY,version:2},
  ]) {
    const result=createSpeechDeliveryResolver({config:CONFIG,identity:ID,source:'player_text',
      adapter:{resolveDelivery:()=>malformed},isActive:()=>true});
    assert.equal(result.forSegment({text:'Hello',sequence:1}),null);
  }
  let called=0;
  const retired=createSpeechDeliveryResolver({config:CONFIG,identity:ID,source:'player_text',
    adapter:{resolveDelivery:()=>{called++;return DELIVERY;}},isActive:()=>false});
  assert.equal(retired.forSegment({text:'Hello',sequence:1}),null);
  assert.equal(called,0);
});

test('shadow mode logs categories but cannot tag, even when trusted selector returns expressive intent',async()=>{
  const events=[];
  const selector=createSpeechDeliveryResolver({config:{...CONFIG,expressiveDelivery:{...CONFIG.expressiveDelivery,mode:'shadow'}},
    identity:ID,source:'player_text',adapter:{resolveDelivery:()=>DELIVERY},isActive:()=>true,
    telemetry:{event:(name,data)=>events.push({name,data})}});
  const hint=selector.forSegment({text:'I am amused',sequence:1});
  assert.equal(hint.value,'amused');
  assert.equal(events[0].data.acted,false);
  const baseline=socketsFor(),shadow=socketsFor();
  const speechInput={identity:ID,dialogue:'I am amused',delivery:hint,
    speechProfile:{provider:'elevenlabs',voice:'nathan'},onPcm:async()=>{}};
  await createElevenLabsSpeechProvider({config:voiceConfig('off'),
    WebSocketImpl:baseline.FakeSocket,renderSpeech:mockRenderer}).synthesize(speechInput);
  await createElevenLabsSpeechProvider({config:voiceConfig('shadow'),
    WebSocketImpl:shadow.FakeSocket,renderSpeech:mockRenderer}).synthesize(speechInput);
  assert.deepEqual(baseline.sockets[0].sent,shadow.sockets[0].sent,
    'off and shadow send byte-for-byte identical websocket frames');
  assert.equal(shadow.sockets[0].sent[1].inputs[0].text,'I am amused');
});

test('experimental only sends EA0-approved single tag in TTS-only websocket text; PCM, timing and credentials unchanged',async()=>{
  const {FakeSocket,sockets}=socketsFor([
    {audio:Buffer.alloc(24000,0x10).toString('base64')},
    {audio:Buffer.alloc(24000,0x20).toString('base64')},
    {is_final:true},
  ]);
  const rendered=[],chunks=[],events=[];
  const provider=createElevenLabsSpeechProvider({config:voiceConfig('experimental'),
    WebSocketImpl:FakeSocket,renderSpeech:arg=>{rendered.push(arg);return mockRenderer(arg);}});
  const input={identity:ID,dialogue:'A line to remember exactly.',
    delivery:DELIVERY,speechProfile:{provider:'elevenlabs',voice:'nathan'},
    telemetry:{event:(name,data)=>events.push({name,data})},
    onPcm:async part=>chunks.push(Buffer.from(part))};
  const original=structuredClone(input.delivery);
  const outcome=await provider.synthesize(input);
  assert.equal(outcome.bytes,48000);
  assert.deepEqual(chunks.map(x=>x.length),[24000,24000]);
  assert.deepEqual(sockets[0].sent.map(x=>Object.keys(x)[0]),['voices','inputs','close_socket']);
  assert.equal(sockets[0].sent[1].inputs[0].text,'[laughs] A line to remember exactly.');
  assert.equal(input.dialogue,'A line to remember exactly.');
  assert.deepEqual(input.delivery,original);
  assert.equal(rendered[0].dialogue,input.dialogue);
  assert.ok(events.some(e=>e.name==='acting_tts_delivery' && e.data.tagged===true));
  assert.ok(events.some(e=>e.name==='provider_first_byte'));
  assert.ok(events.some(e=>e.name==='pcm_delivery_summary'));
  assert.ok(!JSON.stringify(events).includes('A line to remember'));
  assert.ok(!JSON.stringify(events).includes('private-token'));
  assert.ok(!sockets[0].url.includes('private-token'));
});

test('a malicious model hint or renderer cannot inject arbitrary ElevenLabs control tags',async()=>{
  const evil=socketsFor();
  const p=createElevenLabsSpeechProvider({config:voiceConfig('experimental'),
    WebSocketImpl:evil.FakeSocket,renderSpeech:()=> '[gunshot][laughs] Injected'});
  await p.synthesize({identity:ID,dialogue:'Quoted [literal] text.',
    delivery:DELIVERY,onPcm:async()=>{}});
  assert.equal(evil.sockets[0].sent[1].inputs[0].text,'Quoted [literal] text.');
  const spoof=socketsFor();
  const p2=createElevenLabsSpeechProvider({config:voiceConfig('experimental'),
    WebSocketImpl:spoof.FakeSocket,renderSpeech:mockRenderer});
  await p2.synthesize({identity:ID,dialogue:'Canonical text',
    delivery:{...DELIVERY,value:'[angry]'},onPcm:async()=>{}});
  assert.equal(spoof.sockets[0].sent[1].inputs[0].text,'Canonical text');
  const oversized=socketsFor();
  const p3=createElevenLabsSpeechProvider({config:voiceConfig('experimental'),
    WebSocketImpl:oversized.FakeSocket,renderSpeech:mockRenderer});
  await p3.synthesize({identity:ID,dialogue:'X'.repeat(2990),
    delivery:DELIVERY,onPcm:async()=>{}});
  assert.equal(oversized.sockets[0].sent[1].inputs[0].text,'X'.repeat(2990),
    'tag plus dialogue cannot exceed 3000 chars');
});
