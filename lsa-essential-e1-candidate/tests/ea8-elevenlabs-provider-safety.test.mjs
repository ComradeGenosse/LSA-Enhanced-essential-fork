import test from 'node:test';
import assert from 'node:assert/strict';
import { createDelivery, DELIVERY_VALUES, NEUTRAL_DELIVERY } from '../src/voice/emotion/deliveryContract.mjs';
import {
  ELEVEN_TAG_FOR_DELIVERY, ELEVEN_V4_VERIFIED_TAG_FOR_DELIVERY,
  ELEVEN_SPEECH_MAX_CHARS, renderElevenSpeech, sanitizeElevenSpeechDialogue,
} from '../src/voice/emotion/elevenTags.mjs';
import { createElevenLabsSpeechProvider } from '../src/providers/elevenlabs/speechProvider.mjs';

const identity = Object.freeze({pedId:'1', turnId:'EA8', generationId:1, sessionNonce:9});
const voice = 'JBFqnCBsd6RMkjVDRZzb';
const config = (mode='off', modelId='eleven_v4_turbo') => ({
  speechProvider:'elevenlabs', speechVoices:['nathan'], ttsVoice:'nathan',
  elevenLabs:{modelId,voices:{nathan:voice},apiKey:'TEST-SECRET'},
  expressiveDelivery:{mode,intensity:'subtle',maxTaggedSegmentsPerTurn:2},
});
const intent = value => createDelivery({
  value, source:'dialogue_cue', confidence:'soft', intensity:'subtle',
});
const pcm = n => Buffer.alloc(n, 0x35).toString('base64');
function wsFactory({messages=[{audio:pcm(6000)},{is_final:true}],silent=false}={}) {
  const sockets=[];
  class FakeWS {
    constructor(url) {
      this.url=url;this.frames=[];this.listeners=new Map();this.closed=0;
      sockets.push(this);
      queueMicrotask(() => this.emit('open',{}));
    }
    addEventListener(name,fn) {
      const list=this.listeners.get(name)||[];
      list.push(fn);this.listeners.set(name,list);
    }
    emit(name,value) { for(const fn of this.listeners.get(name)||[]) fn(value); }
    send(payload) {
      const frame=JSON.parse(payload);this.frames.push(frame);
      if(frame.close_socket && !silent) queueMicrotask(() => {
        for(const msg of messages) {
          if(msg === 'DISCONNECT') {this.emit('close',{code:1006});break;}
          this.emit('message',{data:JSON.stringify(msg)});
        }
      });
    }
    close() {this.closed++;}
  }
  return {FakeWS,sockets};
}
async function speak({mode='experimental',modelId='eleven_v4_turbo',
  dialogue='Stay close.',delivery=intent('fearful'),socket=null,
  renderSpeech=renderElevenSpeech,signal,telemetry,onPcm=async()=>{}}={}) {
  const transport=socket??wsFactory();
  const provider=createElevenLabsSpeechProvider({
    config:config(mode,modelId),WebSocketImpl:transport.FakeWS,renderSpeech,
  });
  const output=await provider.synthesize({identity,dialogue,delivery,signal,telemetry,onPcm});
  return {output,sockets:transport.sockets};
}

test('EA8 documented v4 Turbo map includes only a verified fearful style, not fabricated concern',()=>{
  assert.equal(ELEVEN_TAG_FOR_DELIVERY.fearful,undefined,
    'EA0 compatibility map is frozen until EA2 integration updates its budget');
  assert.equal(ELEVEN_V4_VERIFIED_TAG_FOR_DELIVERY.fearful,'[scared]');
  assert.equal(Object.hasOwn(ELEVEN_V4_VERIFIED_TAG_FOR_DELIVERY,'concerned'),false);
  for(const value of DELIVERY_VALUES) {
    const d=value==='neutral'?NEUTRAL_DELIVERY:
      value==='concerned' ? createDelivery({value,source:'verified_scene',confidence:'supported'}):
      intent(value);
    const tag=ELEVEN_V4_VERIFIED_TAG_FOR_DELIVERY[value];
    assert.equal(renderElevenSpeech({dialogue:'Okay.',delivery:d,enabled:true,modelId:'eleven_v4_turbo'}),
      tag ? tag+' Okay.' : 'Okay.');
  }
  assert.equal(Object.isFrozen(ELEVEN_V4_VERIFIED_TAG_FOR_DELIVERY),true);
});

test('raw dialogue and forged delivery cannot introduce bracket instructions',async()=>{
  const original='He said [gunshot], ［laughs］, 【explosion】 and ﹝hiss﹞.';
  const safe='He said “gunshot”, “laughs”, “explosion” and “hiss”.';
  assert.equal(sanitizeElevenSpeechDialogue(original),safe);
  assert.equal(renderElevenSpeech({dialogue:original,enabled:false}),original);
  assert.equal(renderElevenSpeech({dialogue:original,enabled:true}),safe);
  assert.equal(renderElevenSpeech({dialogue:original,delivery:{...intent('amused')},
    enabled:true}),safe);
  assert.equal(renderElevenSpeech({dialogue:original,delivery:intent('amused'),
    enabled:true}),'[laughs] '+safe);
  const {sockets}=await speak({dialogue:original,delivery:{...intent('fearful')}});
  assert.equal(sockets[0].frames[1].inputs[0].text,safe);
  assert.equal(original,'He said [gunshot], ［laughs］, 【explosion】 and ﹝hiss﹞.');
});

test('Unicode is conservatively bounded without truncation or surrogate splits',async()=>{
  const smile='🙂', max=ELEVEN_SPEECH_MAX_CHARS;
  const text=smile.repeat(max/2);
  assert.equal(text.length,max);
  assert.equal(renderElevenSpeech({dialogue:text,delivery:intent('fearful'),
    enabled:true,modelId:'eleven_v4_turbo'}),text,'tag omitted when it would cross 3000 UTF-16 units');
  for(const malformed of ['x\ud800','\udc00x','ok\ud83d x']) {
    assert.throws(()=>renderElevenSpeech({dialogue:malformed,enabled:false}),/Unicode/);
    const socket=wsFactory();
    await assert.rejects(speak({dialogue:malformed,socket}),/Unicode/);
    assert.equal(socket.sockets.length,0,'invalid UTF-16 rejected before paid socket');
  }
  for(const invalid of ['x'.repeat(max+1),'🙂'.repeat(max/2+1)]) {
    const socket=wsFactory();
    await assert.rejects(speak({dialogue:invalid,socket}),/3000/);
    assert.equal(socket.sockets.length,0);
  }
  assert.equal(renderElevenSpeech({dialogue:'x'.repeat(2992),
    delivery:intent('fearful'),enabled:true,modelId:'eleven_v4_turbo'}),'x'.repeat(2992));
});

test('early-segment and buffered/final calls take the same trusted provider path',async()=>{
  for(const dialogue of ['Look out!', 'This is a longer buffered line about the approaching car.']) {
    const {output,sockets}=await speak({dialogue});
    assert.equal(sockets.length,1);
    assert.equal(sockets[0].frames.length,3);
    assert.equal(sockets[0].frames[1].inputs[0].text,'[scared] '+dialogue);
    assert.equal(sockets[0].frames[1].inputs[0].voice_id,voice);
    assert.equal(sockets[0].frames[1].inputs[0].new_turn,false);
    assert.equal(sockets[0].url.includes('output_format=pcm_24000'),true);
    assert.equal(sockets[0].url.includes('TEST-SECRET'),false);
    assert.equal(output.bytes,6000);
    assert.equal(output.sampleRate,24000);
    assert.equal(output.channels,1);
  }
});

test('off and shadow preserve exact raw websocket request, with no extra socket or acting request',async()=>{
  const dialogue='Literal [angry] and ［scared］ transcript 🙂';
  const frames=[];
  for(const mode of ['off','shadow']) {
    const {sockets}=await speak({mode,dialogue,delivery:intent('fearful')});
    assert.equal(sockets.length,1);
    frames.push(sockets[0].frames);
    assert.equal(sockets[0].frames[1].inputs[0].text,dialogue);
  }
  assert.deepEqual(frames[0],frames[1]);
  const {sockets:experimental}=await speak({dialogue,delivery:intent('fearful')});
  assert.equal(experimental[0].frames[1].inputs[0].text,
    '[scared] Literal “angry” and “scared” transcript 🙂');
  assert.equal(experimental.length,1);
});

test('unknown or alternate model IDs cannot receive unverified acting directions',async()=>{
  const {sockets}=await speak({modelId:'unverified_model',dialogue:'[angry] Oh no.'});
  assert.equal(sockets[0].frames[1].inputs[0].text,'“angry” Oh no.');
  const unrendered=await speak({renderSpeech:null,dialogue:'[scared] Ah!'});
  assert.equal(unrendered.sockets[0].frames[1].inputs[0].text,'“scared” Ah!');
  const unexpected=await speak({renderSpeech:()=> '[explosion] INJECTED',dialogue:'Original words.'});
  assert.equal(unexpected.sockets[0].frames[1].inputs[0].text,'Original words.');
});

test('invalid or accessor-based intents fail neutral; source text remains canonical',async()=>{
  const dialogue='The quoted [laughs] survives in canonical history.';
  for(const delivery of [
    {value:'[gunshot]'}, {value:'fearful',vendorTag:'[scared]'},
    Object.defineProperty({},'value',{get(){throw Error('boom');},enumerable:true}),
  ]) {
    const {sockets}=await speak({dialogue,delivery});
    assert.equal(sockets[0].frames[1].inputs[0].text,
      'The quoted “laughs” survives in canonical history.');
    assert.equal(dialogue,'The quoted [laughs] survives in canonical history.');
  }
  const concerned=createDelivery({value:'concerned',source:'verified_scene',confidence:'supported'});
  const {sockets}=await speak({dialogue:'Are you hurt?',delivery:concerned});
  assert.equal(sockets[0].frames[1].inputs[0].text,'Are you hurt?');
});

test('PCM streaming remains 24 kHz, awaits asynchronous callbacks and drains fully',async()=>{
  const chunks=[],telemetry=[];
  const socket=wsFactory({messages:[
    {audio:pcm(28000)}, {audio:pcm(4000)}, {is_final:true},
  ]});
  const {output}=await speak({socket,onPcm:async block=>{
    await Promise.resolve();
    chunks.push(Buffer.from(block));
  },telemetry:{event(name,data){telemetry.push({name,data});}}});
  assert.deepEqual(chunks.map(c=>c.length),[24000,4000,4000]);
  assert.equal(output.bytes,32000);
  assert.ok(telemetry.some(t=>t.name==='provider_first_byte'));
  assert.ok(telemetry.some(t=>t.name==='pcm_delivery_summary' && t.data.sampleRate===24000));
  assert.ok(!JSON.stringify(telemetry).includes('TEST-SECRET'));
});

test('cancel after final WebSocket marker but during PCM callback cannot report success',async()=>{
  const controller=new AbortController();
  const socket=wsFactory({messages:[{audio:pcm(30000)},{is_final:true}]});
  let callbacks=0;
  await assert.rejects(speak({socket,signal:controller.signal,onPcm:async()=>{
    callbacks++;
    if(callbacks===1) controller.abort();
  }}),/cancelled/);
  assert.equal(callbacks,1,'no later PCM chunk forwarded after abort');
  assert.equal(socket.sockets.length,1);
  assert.equal(socket.sockets[0].closed,1);
});

test('malformed or partial PCM never produces a completed synthesis receipt',async()=>{
  for(const messages of [
    [{audio:'AAAAA'},{is_final:true}],
    [{audio:pcm(4000)},'DISCONNECT'],
    [{audio:pcm(3000)},{audio:'garbage'},{is_final:true}],
  ]) {
    const socket=wsFactory({messages});
    await assert.rejects(speak({socket}),/elevenlabs_/);
    assert.equal(socket.sockets.length,1);
    assert.equal(socket.sockets[0].closed,1);
  }
});
