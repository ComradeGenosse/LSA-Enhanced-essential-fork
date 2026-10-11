import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { directory } from './identity-fixtures.mjs';
import { pcmToWav, runQwenTurnSmoke } from '../tools/qwen/lsa_turn_smoke.mjs';

const configured = {
  qwenTts: {
    baseUrl: 'http://127.0.0.1:8000/v1',
    speechVoices: ['nathan'],
  },
  providerWorkDeadlineMs: 15000,
};

function qwenResponse() {
  return new Response(new ReadableStream({
    start(controller) {
      // Two chunks straddle a PCM16 sample boundary.
      controller.enqueue(Uint8Array.from([1,2,3]));
      controller.enqueue(Uint8Array.from([4,5,6]));
      controller.close();
    },
  }), { status: 200, headers: {'x-lsa-sample-rate':'24000'} });
}

test('offline simulated Luna -> actual Qwen adapter -> patched native turn -> WAV', async t => {
  const outputPath = path.join(await directory(t), 'nathan.wav');
  const network = [];
  const result = await runQwenTurnSmoke({
    rawConfig: configured,
    outputPath, prompt: 'Nathan, can you hear me?',
    reply: 'Yes, I hear you. My Qwen voice is working.',
    fetchImpl: async (url, request) => {
      network.push({url, request});
      return qwenResponse();
    },
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.mode, 'simulated_luna');
  assert.equal(result.voice, 'nathan');
  assert.equal(result.transcript, 'Yes, I hear you. My Qwen voice is working.');
  assert.equal(result.pcmBytes, 6);
  assert.equal(result.qwenChunks, 1); // Full-utterance buffering sends a single aligned frame.
  assert.equal(result.simulatedNativePlayback, true);
  assert.equal(network.length, 1);
  assert.equal(network[0].url, 'http://127.0.0.1:8000/v1/audio/speech');
  assert.equal(network[0].request.headers.authorization, undefined);
  const sent = JSON.parse(network[0].request.body);
  assert.equal(sent.input, result.transcript);
  assert.equal(sent.voice, 'nathan');
  assert.equal(sent.response_format, 'pcm');
  const wav = await fs.readFile(outputPath);
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.deepEqual([...wav.subarray(44)], [1,2,3,4,5,6]);
});

test('optional live Luna routing keeps decision remote but Qwen voice local (mock HTTP)', async t => {
  const outputPath = path.join(await directory(t), 'luna.wav');
  const requests = [];
  const result = await runQwenTurnSmoke({
    rawConfig: configured, outputPath, liveLuna:true,
    prompt:'Nathan, respond with a short greeting.',
    env: {OPENAI_API_KEY:'test-only-not-sent-to-qwen'},
    fetchImpl: async (url, init) => {
      requests.push({url,init});
      if (url.endsWith('/audio/speech')) return qwenResponse();
      if (url.endsWith('/responses')) return Response.json({
        status:'completed',
        output:[{type:'message',content:[{type:'output_text',
          text:JSON.stringify({dialogue:'Hello! Local Qwen is working.',command:''})}]}],
      });
      throw new Error('Unexpected endpoint');
    },
  });
  assert.equal(result.mode, 'live_luna');
  assert.equal(result.transcript,'Hello! Local Qwen is working.');
  assert.equal(requests.length,2);
  assert.ok(requests[0].url.endsWith('/responses'));
  assert.ok(requests[1].url.endsWith('/audio/speech'));
  assert.equal(requests[1].init.headers.authorization,undefined);
  assert.ok(!JSON.stringify(requests[1]).includes('test-only-not-sent-to-qwen'));
});

test('invalid voice fails before any network or WAV output', async t => {
  const outputPath = path.join(await directory(t), 'should-not-exist.wav');
  let calls = 0;
  await assert.rejects(runQwenTurnSmoke({
    rawConfig: configured, outputPath, voice:'shimmer',
    fetchImpl: async () => {calls++;throw Error('network must not be used');},
  }), /not configured/);
  assert.equal(calls,0);
  await assert.rejects(fs.stat(outputPath),{code:'ENOENT'});
});

test('empty PCM is never saved or reported as a successful GTA playback', async t => {
  const outputPath = path.join(await directory(t), 'never.wav');
  await assert.rejects(runQwenTurnSmoke({
    rawConfig:configured,outputPath,fetchImpl:async ()=>new Response(
      new ReadableStream({start(controller){controller.close();}}),
      {status:200,headers:{'x-lsa-sample-rate':'24000'}}),
  }), /simulated turn failed|empty/);
  await assert.rejects(fs.stat(outputPath),{code:'ENOENT'});
});

test('WAV wrapper refuses empty or odd PCM instead of writing fake audio',()=>{
  assert.throws(()=>pcmToWav([]),/empty/);
  assert.throws(()=>pcmToWav([Buffer.from([1,2,3])]),/misaligned/);
});
