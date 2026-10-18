import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { createProviderStack } from '../src/providers/providerStack.mjs';
import { createElevenLabsSpeechProvider, decodePcmAudio, classifyElevenLabsError } from '../src/providers/elevenlabs/speechProvider.mjs';
import { createPersistentVoiceAssignment, resolvePersistentVoiceProfile } from '../src/voice/voiceProfile.mjs';
import { validateProfile } from '../src/characters/profileStore.mjs';
import { profile } from './p2-fixtures.mjs';
import { checkElevenLabs } from '../tools/elevenlabs/preflight.mjs';

const voiceId='JBFqnCBsd6RMkjVDRZzb';
const identity={pedId:'npc-1', turnId:'turn-1', generationId:1, sessionNonce:7};
const base={speechProvider:'elevenlabs',voiceAssignment:'character-aware-session',
  elevenLabs:{modelId:'eleven_v4_turbo',voices:{nathan:voiceId},
    speechVoiceProfiles:{nathan:{genders:['any'],ageBands:['any']}}},actingEnabled:true};
function configured(env={ELEVENLABS_API_KEY:'private-eleven-key',OPENAI_API_KEY:'openai-secret'}) {
  return normalizeConfig(base,env);
}
function socketFactory(messages=[{audio:Buffer.alloc(4800).toString('base64')},
  {audio:Buffer.alloc(4800).toString('base64')},{is_final:true}], options={}) {
  const sockets=[];
  class FakeSocket {
    constructor(url) { this.url=url;this.outgoing=[];this.handlers=new Map();this.closeCount=0;
      sockets.push(this);queueMicrotask(()=>this.emit('open',{})); }
    addEventListener(name,fn) { if(!this.handlers.has(name))this.handlers.set(name,[]);this.handlers.get(name).push(fn); }
    send(data) {
      const frame=JSON.parse(data);
      this.outgoing.push(frame);
      if(frame.close_socket===true && !options.silent) {
        queueMicrotask(()=>{
          for(const m of messages) {
            if(options.disconnect && m===messages[0]) {this.emit('close',{});break;}
            this.emit('message',{data:JSON.stringify(m)});
          }
        });
      }
    }
    emit(name,e) {for(const fn of this.handlers.get(name)||[])fn(e);}
    close() {this.closeCount++;this.emit('close',{});}
  }
  return {sockets,FakeSocket};
}
test('strict ElevenLabs config isolates vendor key from OpenAI providers',()=>{
  const c=configured();
  assert.equal(c.speechProvider,'elevenlabs');
  assert.equal(c.ttsModel,'eleven_v4_turbo');
  assert.equal(c.ttsVoice,'nathan');
  assert.equal(c.reasoningModel,'gpt-6-luna');
  assert.equal(c.transcriptionModel,'gpt-transcribe');
  assert.equal(c.elevenLabs.apiKey,'private-eleven-key');
  assert.equal(c.ttsKey,'openai-secret');
  assert.equal(c.speechInstructionsSupported,false);
  assert.equal(c.actingEnabled,true);
  assert.throws(()=>normalizeConfig({...base,elevenLabs:{...base.elevenLabs,modelId:'eleven_flash_v2_5'}},{}),/modelId/);
  assert.throws(()=>normalizeConfig({...base,elevenLabs:{voices:{nathan:'INVALID'}}},{}),/voices/);
  assert.throws(()=>normalizeConfig({...base,elevenLabs:{voices:{}}},{}),/voice alias/);
  assert.throws(()=>normalizeConfig({...base,elevenLabs:{voices:{nathan:voiceId},apiKey:'do_not_put_keys_in_json'}},{}),/unknown/);
});
test('real stack routes to dialogue WS, provides aligned PCM to native, and isolates credentials',async()=>{
  const config=configured(), {sockets,FakeSocket}=socketFactory();
  const stack=createProviderStack(config,{WebSocketImpl:FakeSocket});
  assert.equal(stack.reasoning.id,'openai.reasoning');
  assert.equal(stack.transcription.id,'openai.transcription');
  assert.equal(stack.speech.id,'elevenlabs.speech');
  const frames=[],events=[];
  const result=await stack.speak({identity,dialogue:'Hey, are we going somewhere today?',
    telemetry:{event(name,value){events.push({name,value})}},
    speechProfile:{provider:'elevenlabs',voice:'nathan'},
    onPcm:async pcm=>frames.push(Buffer.from(pcm))});
  assert.equal(result.bytes,9600);assert.equal(frames.length,2);
  assert.equal(sockets.length,1);
  assert.equal(sockets[0].url,
    'wss://api.elevenlabs.io/v1/text-to-dialogue/stream-input?model_id=eleven_v4_turbo&output_format=pcm_24000');
  assert.deepEqual(sockets[0].outgoing.map(x=>Object.keys(x)[0]),['voices','inputs','close_socket']);
  assert.deepEqual(sockets[0].outgoing[0].voices,[voiceId]);
  assert.equal(sockets[0].outgoing[0].xi_api_key,'private-eleven-key');
  assert.equal(sockets[0].outgoing[1].inputs[0].voice_id,voiceId);
  assert.ok(!sockets[0].url.includes('private-eleven-key'));
  assert.ok(!JSON.stringify(events).includes('private-eleven-key'));
  assert.ok(!JSON.stringify(events).includes('Hey, are we'));
  assert.ok(events.some(x=>x.name==='provider_first_byte'));
  assert.ok(events.some(x=>x.name==='elevenlabs_tts_timing_summary' && x.value.outcome==='finished'));
});
test('malformed audio, premature socket close and remote errors fail closed',async()=>{
  for(const [messages,options] of [
    [[{audio:'!!'},{is_final:true}],{}],
    [[{audio:Buffer.from([1]).toString('base64')},{is_final:true}],{}],
    [[{error:{message:'credits',code:'payment_required'}}],{}],
    [[{audio:Buffer.alloc(100).toString('base64')}],{disconnect:true}],
  ]) {
    const {FakeSocket}=socketFactory(messages,options),p=createElevenLabsSpeechProvider({
      config:configured(),WebSocketImpl:FakeSocket});
    await assert.rejects(p.synthesize({identity,dialogue:'Hello there',onPcm:async()=>{}}));
  }
  assert.throws(()=>decodePcmAudio('not valid',100),/invalid_audio/);
});
test('cancels the exact socket and does not forward late audio',async()=>{
  const {FakeSocket,sockets}=socketFactory([],{silent:true});
  const controller=new AbortController(),frames=[];
  const p=createElevenLabsSpeechProvider({config:configured(),WebSocketImpl:FakeSocket});
  const outcome=p.synthesize({identity,dialogue:'This is a test.',signal:controller.signal,
    onPcm:async part=>frames.push(part)});
  await new Promise(resolve=>setImmediate(resolve));
  controller.abort();
  await assert.rejects(outcome,/cancelled/);
  assert.equal(frames.length,0);assert.equal(sockets[0].closeCount,1);
});
test('missing ElevenLabs key errors before network and never falls back silently',async()=>{
  const {FakeSocket}=socketFactory();
  const p=createElevenLabsSpeechProvider({config:configured({}),WebSocketImpl:FakeSocket});
  await assert.rejects(p.synthesize({identity,dialogue:'Hello',onPcm:async()=>{}}),/missing_key/);
});
test('historical voice assignments remain readable when switching providers',()=>{
  const config=configured(),actor={gender:'Male',ageRange:'35-45'};
  const characterId='b9951130-7950-41b1-89a8-b93fe26d058d';
  const worldProfileId='758c56f9-9740-484c-a696-14f3be9bbb55';
  const original={assignmentVersion:2,profileId:'vp_0123456789abcdefabcd',
    provider:'faster-qwen3-tts',voice:'nathan',poolVersion:'a'.repeat(64)};
  const resolved=resolvePersistentVoiceProfile({assignment:original,actor,config});
  assert.equal(resolved.provider,'elevenlabs');
  assert.equal(resolved.voice,'nathan');
  assert.equal(original.provider,'faster-qwen3-tts');
  assert.equal(original.profileId,resolved.profileId);
  assert.throws(()=>normalizeConfig({speechProvider:'faster-qwen3-tts'}),/speechProvider must be openai or elevenlabs/);
  assert.equal(normalizeConfig({...base,qwenTts:{baseUrl:'http://127.0.0.1:8000/v1'}}).qwenTts,undefined);
  const authored=createPersistentVoiceAssignment({characterId,worldProfileId,actor,config});
  assert.equal(authored.assignmentVersion,3);
  assert.equal(authored.provider,'elevenlabs');
  const old=validateProfile(profile({voiceReference:original}));
  assert.equal(old.voiceReference.provider,'faster-qwen3-tts');
});


test('safe error classifier inspects provider details without revealing raw messages',async()=>{
  const cases=[
    [{error:{code:'insufficient_credits',message:'secret-key-123 account email'}},'elevenlabs_credits_unavailable'],
    [{error:{status:'invalid_api_key',message:'private-eleven-key'}},'elevenlabs_auth_failed'],
    [{error:'The output_format pcm_24000 is not supported'},'elevenlabs_output_format_unavailable'],
    [{error:{code:'model_not_found'}},'elevenlabs_model_unavailable'],
    [{error:{code:'validation_error'}},'elevenlabs_request_rejected'],
    [{error:{message:'loud_unknown_failure'}},'elevenlabs_remote_error'],
    [{detail:{status:'error',code:'concurrency_limit'}},'elevenlabs_rate_limited'],
  ];
  for(const [frame,expected] of cases){
    assert.equal(classifyElevenLabsError(frame),expected);
    // All emitted errors must be fixed categories, never arbitrary vendor text.
    const {FakeSocket}=socketFactory([frame]);
    const p=createElevenLabsSpeechProvider({config:configured(),WebSocketImpl:FakeSocket});
    await assert.rejects(p.synthesize({identity,dialogue:'Hello there',onPcm:async()=>{}}),e=>{
      assert.equal(e.code,expected);
      assert.ok(!String(e).includes('secret-key'));
      assert.ok(!String(e).includes('private-eleven-key'));
      return true;
    });
  }
});

test('free preflight calls only vendor GET model and voice endpoints, never synthesizes',async()=>{
  const requests=[];
  const mockFetch=async (url,options)=>{
    requests.push({url,options});
    if(url==='https://api.elevenlabs.io/v1/models')
      return new Response(JSON.stringify([{model_id:'eleven_v4_turbo',requires_alpha_access:false}]),{status:200});
    if(url==='https://api.elevenlabs.io/v1/voices/'+voiceId)
      return new Response(JSON.stringify({voice_id:voiceId,name:'Nathan'}),{status:200});
    throw new Error('Unexpected network call');
  };
  const result=await checkElevenLabs({config:configured(),voiceAlias:'nathan',fetchImpl:mockFetch});
  assert.deepEqual(requests.map(x=>x.options.method),['GET','GET']);
  assert.equal(result.modelListed,true);
  assert.equal(result.voiceAccessible,true);
  assert.equal(result.readyToAttemptSpeech,true);
  assert.equal(result.modelRequiresAlphaAccess,false);
  assert.ok(result.caveat.includes('cannot confirm'));
  assert.ok(!JSON.stringify(result).includes('private-eleven-key'));
  assert.ok(!JSON.stringify(result).includes(voiceId));
  assert.ok(!requests.some(x=>x.url.includes('stream-input')||x.url.includes('text-to-speech')));
});
test('preflight reports model unavailable or voice restricted without billing',async()=>{
  const result=await checkElevenLabs({config:configured(),fetchImpl:async (url)=>{
    if(url.endsWith('/models')) return new Response('[]',{status:200});
    return new Response('hidden',{status:403});
  }});
  assert.equal(result.modelListed,false);
  assert.equal(result.voiceAccessible,false);
  assert.equal(result.readyToAttemptSpeech,false);
  assert.equal(result.voiceLookupHttp,403);
});

test('ElevenLabs reassembles PCM16 split between WS frames and accepts empty final marker',async()=>{
  const bytes=Buffer.from([1,2,3,4,5,6]);
  const {FakeSocket}=socketFactory([
    {audio:bytes.subarray(0,3).toString('base64')},
    {audio:bytes.subarray(3).toString('base64')},
    {audio:'',is_final:true},
  ]);
  const frames=[];
  const p=createElevenLabsSpeechProvider({config:configured(),WebSocketImpl:FakeSocket});
  const result=await p.synthesize({identity,dialogue:'Say the names',onPcm:async b=>frames.push(Buffer.from(b))});
  assert.equal(result.bytes,6);
  assert.deepEqual(Buffer.concat(frames),bytes);
  assert(frames.every(b=>b.length%2===0),'native PCM chunks must remain sample-aligned');
});

test('ElevenLabs rejects dangling PCM halves and malformed/empty nonfinal audio',async()=>{
  for(const messages of [
    [{audio:Buffer.from([1,2,3]).toString('base64')},{audio:'',is_final:true}],
    [{audio:''},{is_final:true}],
    [{audio:'!!',is_final:true}],
  ]){
    const {FakeSocket}=socketFactory(messages);
    const p=createElevenLabsSpeechProvider({config:configured(),WebSocketImpl:FakeSocket});
    await assert.rejects(p.synthesize({identity,dialogue:'Hi',onPcm:async()=>{}}),
      {code:'elevenlabs_invalid_audio'});
  }
});



// October 18, 2026 GTA reproduction: native playback started and 83,202 PCM
// bytes crossed the bridge before a later elevenlabs_invalid_audio. The old
// logs cannot distinguish invalid base64, a zero-byte marker or a dangling
// PCM16 sample; preserve all three as distinct, bounded diagnostic stages.
function steppedSocket(script) {
  const sockets=[];
  class Socket {
    constructor(url) {
      this.url=url;this.handlers=new Map();this.sent=[];this.closed=0;
      sockets.push(this);
      queueMicrotask(()=>this.emit('open',{}));
    }
    addEventListener(name,fn) {
      this.handlers.set(name,[...(this.handlers.get(name)||[]),fn]);
    }
    emit(name,event) { for(const fn of this.handlers.get(name)||[]) fn(event); }
    send(raw) {
      const frame=JSON.parse(raw);this.sent.push(frame);
      if(!frame.close_socket)return;
      void (async()=>{
        for(const item of script) {
          await new Promise(resolve=>setImmediate(resolve));
          if(item==='CLOSE') { this.emit('close',{code:1006});return; }
          if(item==='ERROR') { this.emit('error',{});return; }
          this.emit('message',{data:JSON.stringify(item)});
        }
      })();
    }
    close() {this.closed++;this.emit('close',{code:1000});}
  }
  return {Socket,sockets};
}
function recoveryHarness(script,opts={}) {
  const transport=steppedSocket(script);
  const events=[],heard=[];
  const provider=createElevenLabsSpeechProvider({
    config:configured(),WebSocketImpl:transport.Socket,
  });
  const controller=new AbortController();
  const run=(overrides={})=>provider.synthesize({
    identity,dialogue:'Take us to the waypoint.',
    signal:controller.signal,timeoutMs:250,
    telemetry:{event:(name,value)=>events.push({name,value})},
    onPcm:async chunk=>heard.push(Buffer.from(chunk)),
    ...overrides,
  });
  const lastFailure=()=>events.find(e=>e.name==='elevenlabs_tts_timing_summary'&&e.value.outcome==='failed')?.value;
  return {run,events,heard,controller,transport,lastFailure};
}
const b64 = bytes=>Buffer.from(bytes).toString('base64');
test('Oct18: streaming keeps native PCM progressive and survives an empty control marker',async()=>{
  const h=recoveryHarness([
    {audio:b64(Buffer.alloc(1518))},
    {audio:''},
    {audio:b64(Buffer.alloc(81684))},
    {is_final:true},
  ]);
  let beforeFinal=false;
  const originalRun=h.run;
  const result=await originalRun({onPcm:async chunk=>{
    assert.equal(h.events.some(e=>e.name==='elevenlabs_stream_stage'&&e.value.stage==='provider_final'),false);
    beforeFinal=true;h.heard.push(Buffer.from(chunk));
  }});
  assert.equal(beforeFinal,true);
  assert.equal(result.bytes,83202);
  assert.equal(Buffer.concat(h.heard).length,83202);
  assert(h.heard.every(c=>c.length%2===0));
  assert(h.events.some(e=>e.name==='elevenlabs_stream_stage'&&e.value.stage==='empty_audio_marker'));
  assert(h.events.some(e=>e.name==='elevenlabs_stream_stage'&&e.value.stage==='socket_cleanup'));
  assert.equal(h.transport.sockets[0].closed,1);
});
test('Oct18: invalid later payload fails at decoder after prior PCM was forwarded',async()=>{
  const h=recoveryHarness([
    {audio:b64(Buffer.alloc(1518))},
    {audio:b64(Buffer.alloc(81684))},
    {audio:'invalid!'},
    {is_final:true},
  ]);
  await assert.rejects(h.run(),{code:'elevenlabs_invalid_audio'});
  assert.equal(Buffer.concat(h.heard).length,83202);
  assert.equal(h.lastFailure()?.stage,'audio_decode');
  assert.equal(h.lastFailure()?.pcmBytes,83202);
  assert.equal(h.transport.sockets[0].closed,1);
});
test('invalid first PCM has zero forwarded bytes and precise stage',async()=>{
  const h=recoveryHarness([{audio:'%%%%'},{is_final:true}]);
  await assert.rejects(h.run(),{code:'elevenlabs_invalid_audio'});
  assert.equal(h.heard.length,0);
  assert.equal(h.lastFailure()?.stage,'audio_decode');
});
test('missing all audio rejects at empty_stream rather than committing a success',async()=>{
  const h=recoveryHarness([{audio:''},{is_final:true}]);
  await assert.rejects(h.run(),{code:'elevenlabs_invalid_audio'});
  assert.equal(h.lastFailure()?.stage,'empty_stream');
  assert.equal(h.heard.length,0);
});
test('truncated PCM16 final sample fails without padding or forged playback receipt',async()=>{
  const h=recoveryHarness([{audio:b64([1,2,3])},{is_final:true}]);
  await assert.rejects(h.run(),{code:'elevenlabs_invalid_audio'});
  assert.equal(h.lastFailure()?.stage,'pcm_alignment');
  assert.equal(Buffer.concat(h.heard).length,2);
});
test('canonical unpadded base64 is decoded without extra latency or corruption',async()=>{
  assert.deepEqual(decodePcmAudio('AQI',2),Buffer.from([1,2]));
  assert.deepEqual(decodePcmAudio('AQ',1,{allowOddLength:true}),Buffer.from([1]));
  for(const invalid of ['A','AQI=bad','AQ==AA','AQ I','AQI_']) {
    assert.throws(()=>decodePcmAudio(invalid,10),{code:'elevenlabs_invalid_audio'});
  }
  const h=recoveryHarness([{audio:'AQI'},{is_final:true}]);
  assert.equal((await h.run()).bytes,2);
  assert.deepEqual(Buffer.concat(h.heard),Buffer.from([1,2]));
});
test('premature WebSocket close is stage-distinguished and closes resources',async()=>{
  const h=recoveryHarness([{audio:b64(Buffer.alloc(4000))},'CLOSE']);
  await assert.rejects(h.run(),{code:'elevenlabs_connection_closed'});
  assert.equal(h.lastFailure()?.stage,'socket_closed');
  assert.equal(h.transport.sockets[0].closed,1);
});
test('provider error and disconnect never leak provider details into telemetry',async()=>{
  const h=recoveryHarness([{error:{code:'payment_required',message:'private-eleven-key text'}}]);
  await assert.rejects(h.run(),{code:'elevenlabs_credits_unavailable'});
  assert.equal(h.lastFailure()?.stage,'provider_rejected');
  assert(!JSON.stringify(h.events).includes('private-eleven-key'));
  const d=recoveryHarness(['ERROR']);
  await assert.rejects(d.run(),{code:'elevenlabs_connection_error'});
  assert.equal(d.lastFailure()?.stage,'socket_error');
});
test('provider timeout is bounded and releases WebSocket',async()=>{
  const h=recoveryHarness([]);
  await assert.rejects(h.run({timeoutMs:15}),{code:'timeout'});
  assert.equal(h.lastFailure()?.stage,'provider_timeout');
  assert.equal(h.transport.sockets[0].closed,1);
});
test('native PCM rejection is not incorrectly diagnosed as invalid provider audio',async()=>{
  const h=recoveryHarness([{audio:b64(Buffer.alloc(2000))},{is_final:true}]);
  const nativeError=Object.assign(Error('native stale'),{code:'stale_or_cancelled'});
  await assert.rejects(h.run({onPcm:async()=>{throw nativeError;}}),e=>e===nativeError);
  assert.equal(h.lastFailure()?.stage,'native_pcm');
  assert.equal(h.transport.sockets[0].closed,1);
});
test('player interruption closes current socket; future frames cannot replay',async()=>{
  const h=recoveryHarness([
    {audio:b64(Buffer.alloc(2000))},
    {audio:b64(Buffer.alloc(2000))},
    {is_final:true},
  ]);
  await assert.rejects(h.run({onPcm:async chunk=>{
    h.heard.push(Buffer.from(chunk));h.controller.abort();
  }}),{code:'cancelled'});
  assert.equal(h.heard.length,1);
  assert.equal(h.transport.sockets[0].closed,1);
});
test('superseded and overlapping speech never carry old PCM into the new request',async()=>{
  const {Socket,sockets}=steppedSocket([{audio:b64(Buffer.alloc(4800))},{is_final:true}]);
  const p=createElevenLabsSpeechProvider({config:configured(),WebSocketImpl:Socket});
  const oldAbort=new AbortController();
  const old=[];
  const first=p.synthesize({identity,dialogue:'First voice',signal:oldAbort.signal,
    onPcm:async x=>old.push(Buffer.from(x))});
  const later=[];
  const second=p.synthesize({identity:{...identity,turnId:'turn-2',generationId:2},
    dialogue:'Second voice',onPcm:async x=>later.push(Buffer.from(x))});
  oldAbort.abort();
  await assert.rejects(first,{code:'cancelled'});
  assert.equal((await second).bytes,4800);
  assert.equal(old.length,0);
  assert.equal(later.length,1);
  assert.equal(sockets.length,2);
  assert(sockets.every(s=>s.closed===1));
});
test('new voice turn succeeds immediately after failed audio without provider restart',async()=>{
  let calls=0;
  const sockets=[];
  class NextTurnSocket {
    constructor(url) {
      this.handlers=new Map();this.closed=0;sockets.push(this);
      queueMicrotask(()=>this.emit('open',{}));
    }
    addEventListener(n,fn){this.handlers.set(n,[...(this.handlers.get(n)||[]),fn]);}
    emit(n,e){for(const fn of this.handlers.get(n)||[])fn(e);}
    send(payload){
      if(!JSON.parse(payload).close_socket)return;
      const frames=++calls===1?[{audio:'!!'}]:[{audio:b64(Buffer.alloc(2000))},{is_final:true}];
      queueMicrotask(()=>frames.forEach(f=>this.emit('message',{data:JSON.stringify(f)})));
    }
    close(){this.closed++;this.emit('close',{code:1000});}
  }
  const p=createElevenLabsSpeechProvider({config:configured(),WebSocketImpl:NextTurnSocket});
  const played=[];
  await assert.rejects(p.synthesize({identity,dialogue:'First',onPcm:async c=>played.push(c)}),
    {code:'elevenlabs_invalid_audio'});
  const result=await p.synthesize({identity:{...identity,generationId:2,turnId:'next'},
    dialogue:'Second',onPcm:async c=>played.push(c)});
  assert.equal(result.bytes,2000);
  assert.equal(played.length,1);
  assert.equal(sockets.length,2);
  assert(sockets.every(s=>s.closed===1));
});
