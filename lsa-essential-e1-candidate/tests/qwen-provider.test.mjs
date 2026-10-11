import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { createProviderStack } from '../src/providers/providerStack.mjs';
import { VoiceResolver } from '../src/voice/voiceResolver.mjs';
import { validateProfile } from '../src/characters/profileStore.mjs';
import { profile } from './p2-fixtures.mjs';
import { CharacterStore } from '../src/identity/characterStore.mjs';
import { CharacterRegistry } from '../src/identity/characterRegistry.mjs';
import { claim, worldProfileId, directory } from './identity-fixtures.mjs';
import * as fs from 'node:fs/promises';
import path from 'node:path';

const identity = {pedId:'nathan-ped',turnId:'turn-1',generationId:1,sessionNonce:7};
const qwen = {
  speechProvider:'faster-qwen3-tts', voiceAssignment:'character-aware-session',
  qwenTts:{baseUrl:'http://127.0.0.1:8000/v1',speechVoices:['nathan','aiden_local'],
    speechVoiceProfiles:{nathan:{genders:['male'],ageBands:['any']},
      aiden_local:{genders:['any'],ageBands:['any']}}},
};

test('provider toggle preserves cloud credentials, reasoning, STT, and separate voice pools',()=>{
  const config = normalizeConfig({
    ...qwen, ttsModel:'gpt-4o-mini-tts',ttsVoice:'nova',
    speechVoices:['nova','ash'], actingEnabled:true,
  },{OPENAI_API_KEY:'secret-cloud-only'});
  assert.equal(config.speechProvider,'faster-qwen3-tts');
  assert.equal(config.reasoningModel,'gpt-6-luna');
  assert.equal(config.transcriptionModel,'gpt-transcribe');
  assert.equal(config.ttsModel,'qwen3-tts');
  assert.deepEqual(config.speechVoices,['nathan','aiden_local']);
  assert.equal(config.reasoningKey,'secret-cloud-only');
  const old = normalizeConfig({ttsModel:'gpt-4o-mini-tts',ttsVoice:'nova'}, {});
  assert.equal(old.speechProvider,'openai');
  assert.deepEqual(old.speechVoices,['nova']);
});

test('Qwen configuration rejects remote endpoints and malformed local voices',()=>{
  for (const url of ['https://evil.example/v1','http://192.168.1.1:8000/v1',
    'http://user:password@localhost:8000/v1','file:///localhost']) {
    assert.throws(()=>normalizeConfig({...qwen,qwenTts:{...qwen.qwenTts,baseUrl:url}},{}),
      /loopback|HTTP/);
  }
  assert.throws(()=>normalizeConfig({...qwen,qwenTts:{speechVoices:['nathan','nathan']}},{}),/unique/);
  assert.throws(()=>normalizeConfig({...qwen,qwenTts:{speechVoices:[]}},{}),/1–32/);
});

test('Qwen streams 24kHz PCM with split-sample alignment and never forwards OpenAI key',async()=>{
  const config=normalizeConfig(qwen,{OPENAI_API_KEY:'secret-cloud-only'});
  const requests=[], pcm=[];
  const fetchImpl=async(url,options)=>{
    requests.push({url,options});
    return new Response(new ReadableStream({start(controller){
      controller.enqueue(Uint8Array.from([1,2,3]));
      controller.enqueue(Uint8Array.from([4,5,6]));
      controller.close();
    }}),{status:200,headers:{'x-lsa-sample-rate':'24000'}});
  };
  const stack=createProviderStack(config,{fetchImpl});
  const sound=await stack.speak({identity,dialogue:'Hello Nathan.',
    speechProfile:new VoiceResolver(config).resolve(identity,{gender:'Male'}),
    signal:new AbortController().signal,onPcm:async chunk=>pcm.push([...chunk])});
  assert.equal(stack.reasoning.id,'openai.reasoning');
  assert.equal(stack.transcription.id,'openai.transcription');
  assert.equal(stack.speech.id,'qwen.speech');
  assert.equal(sound.bytes,6);
  assert.deepEqual(pcm,[[1,2],[3,4,5,6]]);
  assert.equal(requests[0].url,'http://127.0.0.1:8000/v1/audio/speech');
  assert.ok(!JSON.stringify(requests[0]).includes('secret-cloud-only'));
  assert.equal(requests[0].options.headers.authorization,undefined);
  assert.equal(JSON.parse(requests[0].options.body).response_format,'pcm');
});

test('Qwen rejects empty, malformed, foreign or interrupted audio',async()=>{
  const config=normalizeConfig(qwen,{});
  const fake=body=>createProviderStack(config,{fetchImpl:async()=>new Response(
    new ReadableStream({start(controller){for(const b of body)controller.enqueue(Uint8Array.from(b));controller.close();}}),
    {status:200,headers:{'x-lsa-sample-rate':'24000'}})});
  await assert.rejects(fake([]).speak({identity,dialogue:'Test',onPcm:async()=>{}}),/empty PCM/);
  await assert.rejects(fake([[1]]).speak({identity,dialogue:'Test',onPcm:async()=>{}}),/malformed/);
  await assert.rejects(fake([[1,2]]).speak({identity,dialogue:'Test',
    speechProfile:{provider:'openai',voice:'nathan'},onPcm:async()=>{}}),/mismatch/);
  const abort=new AbortController();abort.abort();
  await assert.rejects(fake([[1,2]]).speak({identity,dialogue:'Test',signal:abort.signal,onPcm:async()=>{}}),/cancelled/);
});

test('switching TTS providers preserves authored character and produces deterministic alternate voices',()=>{
  const cloud=normalizeConfig({speechVoices:['nova','ash'],ttsVoice:'nova'}, {});
  const local=normalizeConfig(qwen,{});
  const actor={gender:'Male',ageRange:'35-45'};
  const characterId='b9951130-7950-41b1-89a8-b93fe26d058d';
  const worldId='758c56f9-9740-484c-a696-14f3be9bbb55';
  const cloudResolver=new VoiceResolver(cloud),qwenResolver=new VoiceResolver(local);
  const original=cloudResolver.createPersistentAssignment(characterId,worldId,actor);
  const localVoice=qwenResolver.resolvePersistent({voiceAssignment:original},worldId,actor);
  const localRepeat=qwenResolver.resolvePersistent({voiceAssignment:original},worldId,actor);
  const back=cloudResolver.resolvePersistent({voiceAssignment:original},worldId,actor);
  assert.deepEqual(localVoice,localRepeat);
  assert.equal(localVoice.provider,'faster-qwen3-tts');
  assert.ok(local.speechVoices.includes(localVoice.voice));
  assert.equal(back.voice,original.voice);
  assert.equal(back.profileId,original.profileId);
  const qwenAssignment=qwenResolver.createPersistentAssignment(characterId,worldId,actor);
  assert.equal(qwenAssignment.assignmentVersion,2);
  assert.equal(qwenAssignment.provider,'faster-qwen3-tts');
  assert.equal(validateProfile(profile({voiceReference:qwenAssignment})).voiceReference.provider,'faster-qwen3-tts');
  assert.ok(cloud.speechVoices.includes(
    cloudResolver.resolvePersistent({voiceAssignment:qwenAssignment},worldId,actor).voice));
});

test('P1 durable registry accepts versioned Qwen voices and reloads them after restart',async t=>{
  const filePath=path.join(await directory(t),'registry.json');
  const resolver=new VoiceResolver(normalizeConfig(qwen,{}));
  const registry=new CharacterRegistry(new CharacterStore({filePath,worldProfileId}));
  const record=await registry.resolveOrCreate(claim(),
    id=>resolver.createPersistentAssignment(id,worldProfileId,{}));
  assert.equal(record.voiceAssignment.assignmentVersion,2);
  const bytes=await fs.readFile(filePath,'utf8');
  const restarted=await new CharacterStore({filePath,worldProfileId}).load();
  assert.deepEqual(restarted.characters[0].voiceAssignment,record.voiceAssignment);
  assert.equal(await fs.readFile(filePath,'utf8'),bytes);
});
