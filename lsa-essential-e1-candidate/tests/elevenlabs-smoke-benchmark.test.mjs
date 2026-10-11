import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, percentile, summarize, runBenchmark, reportMarkdown } from '../tools/elevenlabs/voice_smoke.mjs';

function fakeNow(){
  let t=0;
  return ()=>(t+=100);
}
function mockProvider({failAt=null, mode='normal'}={}){
  const calls=[], bytes=4800;
  return {
    calls,
    async synthesize({identity,dialogue,speechProfile,onPcm}){
      calls.push({identity,dialogue,speechProfile});
      if(failAt===calls.length){
        const error=new Error('DO_NOT_REVEAL_CREDENTIALS or dialogue');
        error.code='elevenlabs_credits_unavailable';
        throw error;
      }
      await onPcm(new Uint8Array(bytes));
      await onPcm(new Uint8Array(bytes));
      return {bytes, chunks:2, sampleRate:24000, channels:1};
    },
  };
}

test('CLI defaults to backward-compatible single request, no warmup and opt-in billing',()=>{
  assert.deepEqual(parseArgs([]),{runs:1,warmup:false,creditsPerCharacter:0.5});
  assert.deepEqual(parseArgs(['--runs','10','--voice','nathan','--allow-billing']),
    {runs:10,warmup:true,creditsPerCharacter:0.5,voice:'nathan',allowBilling:true});
  assert.equal(parseArgs(['--runs','10','--no-warmup']).warmup,false);
  assert.equal(parseArgs(['--runs','1','--no-warmup']).warmup,false);
  assert.equal(parseArgs(['--runs','20']).runs,20);
  for(const argv of [['--runs','0'],['--runs','21'],['--runs','1.1'],['--runs','garbage'],
    ['--runs'],['--voice','../../key'],['--report-dir'],['--credits-per-character','0'],
    ['--credits-per-character','NaN'],['--unknown']]) assert.throws(()=>parseArgs(argv));
});
test('summary statistics include mean, median, interpolated p90, minimum and maximum',()=>{
  assert.deepEqual(summarize([]),{count:0,min:null,mean:null,median:null,p90:null,max:null});
  assert.deepEqual(summarize([1,2,3,4,5,6,7,8,9,10]),
    {count:10,min:1,mean:5.5,median:5.5,p90:9.1,max:10});
  assert.equal(percentile([9,5,1,3],50),4);
  assert.deepEqual([1,2,3,4], [1,2,3,4]); // no shared sorting or mutation
  assert.throws(()=>summarize([1,NaN]));
});
test('10 measured + one warmup call, excluded warmup, same text and unique turn identities',async()=>{
  const provider=mockProvider(), events=[];
  const {report,previewChunks}=await runBenchmark({
    provider,voice:'nathan',runs:10,warmup:true,now:fakeNow(),
    onProgress:row=>events.push(row),
  });
  assert.equal(provider.calls.length,11);
  assert.equal(report.attemptedRequests,11);
  assert.equal(report.completedMeasuredRuns,10);
  assert.equal(report.failedMeasuredRuns,0);
  assert.equal(report.rows[0].phase,'warmup');
  assert.equal(report.rows[1].phase,'measured');
  assert.deepEqual(report.rows.slice(1).map(x=>x.run),[1,2,3,4,5,6,7,8,9,10]);
  assert.equal(report.metrics.totalMs.count,10);
  assert.equal(report.metrics.firstPcmMs.median,100);
  assert.equal(report.metrics.totalMs.median,200);
  assert.equal(report.metrics.audioMs.median,200);
  assert.equal(report.metrics.realtimeFactor.mean,1);
  assert.equal(events.length,11);
  assert.deepEqual(provider.calls.map(c=>c.identity.sessionNonce),
    [1,2,3,4,5,6,7,8,9,10,11]);
  assert.equal(new Set(provider.calls.map(c=>c.dialogue)).size,1);
  assert.ok(previewChunks && previewChunks.length===2);
  assert.equal(report.creditEstimate.attemptedCharacters,
    report.charactersPerRequest * 11);
  assert.equal(report.creditEstimate.estimatedCreditsOnSuccessfulRequests,
    report.charactersPerRequest * 11 * 0.5);
  assert.equal(report.creditEstimate.actualCreditsUsed,null);
  assert.ok(!JSON.stringify(report).includes('Hey, it is Nathan'));
  assert.ok(!JSON.stringify(report).includes('JBFqnCBsd6RMkjVDRZzb'));
  assert.ok(reportMarkdown(report).includes('Mean | Median | p90'));
  assert.ok(reportMarkdown(report).includes('not actual charges') ||
    reportMarkdown(report).includes('Not actual charges'));
});
test('single request preserves single WAV output and excludes warmup',async()=>{
  const provider=mockProvider();
  const {report,previewChunks}=await runBenchmark({provider,voice:'nathan',
    runs:1,warmup:false,now:fakeNow()});
  assert.equal(provider.calls.length,1);
  assert.equal(report.rows.length,1);
  assert.equal(report.metrics.firstPcmMs.count,1);
  assert.equal(previewChunks.reduce((a,b)=>a+b.byteLength,0),9600);
});
test('stop immediately on a failed measured request, keep partial measurements, suppress raw error',async()=>{
  const provider=mockProvider({failAt:4});
  const {report,previewChunks}=await runBenchmark({provider,voice:'nathan',
    runs:10,warmup:true,now:fakeNow()});
  assert.equal(provider.calls.length,4);
  assert.equal(report.stoppedEarly,true);
  assert.equal(report.completedMeasuredRuns,2);
  assert.equal(report.failedMeasuredRuns,1);
  assert.equal(report.rows.at(-1).errorCode,'elevenlabs_credits_unavailable');
  assert.equal(report.metrics.firstPcmMs.count,2);
  assert.ok(previewChunks);
  assert.ok(!JSON.stringify(report).includes('DO_NOT_REVEAL'));
  assert.ok(!reportMarkdown(report).includes('DO_NOT_REVEAL'));
});
test('failed warmup never starts measured requests or writes a pretend preview',async()=>{
  const provider=mockProvider({failAt:1});
  const {report,previewChunks}=await runBenchmark({provider,voice:'nathan',
    runs:10,warmup:true,now:fakeNow()});
  assert.equal(provider.calls.length,1);
  assert.equal(report.completedMeasuredRuns,0);
  assert.equal(report.metrics.firstPcmMs.median,null);
  assert.equal(report.stoppedEarly,true);
  assert.equal(previewChunks,null);
});
test('no-billing guard exits before loading config or creating any WebSocket',()=>{
  const tool=fileURLToPath(new URL('../tools/elevenlabs/voice_smoke.mjs',import.meta.url));
  const refused=spawnSync(process.execPath,[tool,'--runs','10'],{encoding:'utf8',timeout:5000});
  assert.equal(refused.status,1);
  assert.match(refused.stderr,/configuration_or_local_error/);
  assert.ok(!refused.stdout.includes('potentially billed requests'));
  const help=execFileSync(process.execPath,[tool,'--help'],{encoding:'utf8',timeout:5000});
  assert.match(help,/--runs 10/);
  assert.match(help,/--allow-billing/);
  assert.match(help,/additional billable warmup/);
});
