import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { createProviderStack } from '../src/providers/providerStack.mjs';
import { createElevenLabsSpeechProvider, decodePcmAudio } from '../src/providers/elevenlabs/speechProvider.mjs';
import { createPersistentVoiceAssignment, resolvePersistentVoiceProfile } from '../src/voice/voiceProfile.mjs';
import { validateProfile } from '../src/characters/profileStore.mjs';
import { profile } from './p2-fixtures.mjs';

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
test('strict ElevenLabs config does not expose vendor key to Qwen or cloud providers',()=>{
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
test('persisted original OpenAI/Qwen voice references survive provider switching',()=>{
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
  const authored=createPersistentVoiceAssignment({characterId,worldProfileId,actor,config});
  assert.equal(authored.assignmentVersion,3);
  assert.equal(authored.provider,'elevenlabs');
  const old=validateProfile(profile({voiceReference:original}));
  assert.equal(old.voiceReference.provider,'faster-qwen3-tts');
});
