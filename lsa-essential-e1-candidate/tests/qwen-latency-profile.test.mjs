import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loopbackBaseUrl, percentile, summarize, runCase } from '../tools/qwen/profile_qwen_latency.mjs';

const args={scenario:'gta-closed',baseUrl:'http://127.0.0.1:8000/v1',
  voice:'nathan',gpuIndex:0,gpuSampleMs:500,noGpu:true};

test('strict loopback parser prevents credential/remote and non-API endpoints',()=>{
  assert.equal(loopbackBaseUrl('http://127.0.0.1:8000/v1/'),'http://127.0.0.1:8000/v1');
  assert.equal(loopbackBaseUrl('http://localhost:8000/v1'),'http://localhost:8000/v1');
  for (const url of ['http://192.168.0.10:8000/v1','https://127.0.0.1/v1',
    'http://127.0.0.1:8000/private','http://user:secret@localhost:8000/v1',
    'http://localhost:8000/v1?q=1','file:///v1'])
    assert.throws(()=>loopbackBaseUrl(url),/loopback/);
});
test('latency percentiles, real-time factors and GPU aggregates are deterministic',()=>{
  assert.equal(percentile([8,2,5,1],.5),2);
  assert.equal(percentile([8,2,5,1],.9),8);
  assert.equal(percentile([],.5),null);
  const s=summarize([{fixture:'short',status:'completed',firstPcmMs:10,totalMs:100,
    realtimeFactor:1.25,gpuSamples:[{utilizationPct:35,memoryUsedMiB:4096}]},
    {fixture:'short',status:'failed',gpuSamples:[]}]);
  assert.equal(s.short.successful,1);
  assert.equal(s.short.firstPcmMedianMs,10);
  assert.equal(s.short.gpuUtilMedianPct,35);
  assert.equal(s.short.gpuMemoryMaxMiB,4096);
  assert.equal(s.medium.successful,0);
  assert.equal(s.medium.gpuUtilMedianPct,null);
});
test('mock streaming sidecar returns fixed PCM duration and never sends credentials',async()=>{
  const calls=[];
  const row=await runCase(args,'short',1,async (url,request)=>{
    calls.push({url,request});
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(4800));
        controller.enqueue(new Uint8Array(4800));
        controller.close();
      },
    }),{headers:{'x-lsa-request-id':'rid_0123456789abcdef',
      'x-lsa-sample-rate':'24000'}});
  });
  assert.equal(row.status,'completed');
  assert.equal(row.audioMs,200);
  assert.ok(row.totalMs>=0 && row.firstPcmMs>=0);
  assert.equal(row.requestId,'rid_0123456789abcdef');
  assert.equal(calls[0].url,'http://127.0.0.1:8000/v1/audio/speech');
  assert.equal(JSON.parse(calls[0].request.body).input,'Hello. I can hear you clearly.');
  assert.equal(calls[0].request.headers.authorization,undefined);
  assert.deepEqual(row.gpuSamples,[]);
});
test('malformed PCM and HTTP failures report status without swallowing test runs',async()=>{
  const bad=await runCase(args,'medium',1,async()=>new Response(new Uint8Array([1]),{
    headers:{'x-lsa-sample-rate':'24000'}}));
  assert.equal(bad.status,'failed');
  assert.equal(bad.errorType,'Error');
  const unavailable=await runCase(args,'long',2,async()=>new Response('no',{
    status:503,headers:{'x-lsa-sample-rate':'24000'}}));
  assert.equal(unavailable.status,'failed');
});
test('help is offline and makes no sidecar or cloud API requests',()=>{
  const executable=fileURLToPath(new URL('../tools/qwen/profile_qwen_latency.mjs',import.meta.url));
  const output=execFileSync(process.execPath,[executable,'--help'],{encoding:'utf8'});
  assert.match(output,/gta-closed/);
  assert.match(output,/no API keys/);
});
