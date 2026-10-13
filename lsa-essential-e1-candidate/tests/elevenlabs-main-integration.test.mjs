import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {normalizeConfig} from '../src/config/e1Config.mjs';
import {createProviderStack} from '../src/providers/providerStack.mjs';
import {pcmToWav} from '../src/voice/pcmWav.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');

test('ElevenLabs main-integration gate preserves OpenAI default and rejects retired Qwen',()=>{
  const stock=normalizeConfig({});
  assert.equal(stock.speechProvider,'openai');
  assert.equal(createProviderStack(stock).speech.id,'openai.speech');
  assert.throws(()=>normalizeConfig({speechProvider:'faster-qwen3-tts'}),/speechProvider/);

  const vendor=normalizeConfig({
    speechProvider:'elevenlabs',
    elevenLabs:{voices:{nathan:'JBFqnCBsd6RMkjVDRZzb'}},
  });
  assert.equal(createProviderStack(vendor).speech.id,'elevenlabs.speech');
});

test('removed Qwen runtime and sidecar are absent from ship-ready source',()=>{
  for(const relative of [
    'src/providers/qwen/speechProvider.mjs',
    'tools/qwen/lsa_qwen_server.py',
    'tools/qwen/lsa_turn_smoke.mjs',
    'tools/qwen/profile_qwen_latency.mjs'
  ]) assert.equal(existsSync(path.join(root,relative)),false,relative);
});

test('ElevenLabs WAV preview uses standalone PCM writer, not deleted Qwen code',()=>{
  const wav=pcmToWav([Buffer.from([0,0,1,0])]);
  assert.equal(wav.toString('ascii',0,4),'RIFF');
  assert.equal(wav.toString('ascii',8,12),'WAVE');
  assert.equal(wav.readUInt32LE(40),4);
});
