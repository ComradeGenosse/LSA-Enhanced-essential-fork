import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { createProviderStack } from '../src/providers/providerStack.mjs';

test('retired Qwen provider cannot be selected',()=>{
  assert.throws(()=>normalizeConfig({speechProvider:'faster-qwen3-tts'}),/speechProvider must be openai or elevenlabs/);
});
test('old private Qwen settings are inert; OpenAI remains available',()=>{
  const config=normalizeConfig({qwenTts:{baseUrl:'http://127.0.0.1:8000/v1'}});
  assert.equal(config.speechProvider,'openai');
  assert.equal(config.qwenTts,undefined);
  assert.equal(createProviderStack(config).speech.id,'openai.speech');
});
