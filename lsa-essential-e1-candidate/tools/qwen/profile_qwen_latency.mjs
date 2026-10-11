#!/usr/bin/env node
/**
 * Controlled no-cloud Qwen profiler. Direct sidecar calls isolate synthesis +
 * HTTP streaming from Luna, companion buffering, and GTA/native playback.
 * Output never stores request text, raw PCM, credentials, or conversation data.
 */
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURES = Object.freeze({
  short: 'Hello. I can hear you clearly.',
  medium: 'We should take the next street and stay close together. I can keep an eye on the traffic while you drive.',
  long: 'I remember the last time we came through this neighborhood. The streets were quiet, the radio was playing, and nobody seemed to be in a hurry. Let us take it slowly and see what happens around the next corner.',
});
const DIR = path.dirname(fileURLToPath(import.meta.url));

export function loopbackBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.username || url.password || url.search || url.hash || !/^\/v1\/?$/.test(url.pathname))
    throw new Error('The profiler accepts only unauthenticated loopback http://host:port/v1 URLs.');
  return url.origin + '/v1';
}
export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a,b)=>a-b);
  return sorted[Math.ceil(p * sorted.length) - 1];
}
export function summarize(rows) {
  return Object.fromEntries(Object.keys(FIXTURES).map(name => {
    const subset = rows.filter(r=>r.fixture===name && r.status==='completed');
    const median = key => percentile(subset.map(r=>r[key]), .5);
    return [name, { successful:subset.length, firstPcmMedianMs:median('firstPcmMs'),
      firstPcmP90Ms:percentile(subset.map(r=>r.firstPcmMs),.9),
      totalMedianMs:median('totalMs'), realtimeFactorMedian:median('realtimeFactor'),
      gpuUtilMedianPct:percentile(subset.flatMap(r=>r.gpuSamples.map(g=>g.utilizationPct)),.5),
      gpuMemoryMaxMiB:subset.length ? Math.max(...subset.flatMap(r=>r.gpuSamples.map(g=>g.memoryUsedMiB)),0) : null }];
  }));
}
function flags(argv) {
  const args={runs:3, baseUrl:'http://127.0.0.1:8000/v1', gpuIndex:0, gpuSampleMs:500};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if (key==='--help'||key==='-h') { args.help=true;continue; }
    if (!['--scenario','--voice','--runs','--base-url','--out','--gpu-index','--gpu-sample-ms','--no-gpu'].includes(key))
      throw new Error('Unknown argument '+key);
    if(key==='--no-gpu') { args.noGpu=true;continue; }
    if(i+1===argv.length) throw new Error('Missing value for '+key);
    const prop={'--scenario':'scenario','--voice':'voice','--runs':'runs','--base-url':'baseUrl',
      '--out':'out','--gpu-index':'gpuIndex','--gpu-sample-ms':'gpuSampleMs'}[key];
    args[prop]=argv[++i];
  }
  if (args.help) return args;
  if(!['gta-closed','gta-idle','gta-gameplay','cuda-sync'].includes(args.scenario))
    throw new Error('Choose --scenario gta-closed|gta-idle|gta-gameplay|cuda-sync');
  if(!/^[a-z][a-z0-9_-]{0,31}$/.test(args.voice||''))
    throw new Error('Supply registered --voice id');
  args.baseUrl=loopbackBaseUrl(args.baseUrl);
  for(const [name,min,max] of [['runs',1,12],['gpuIndex',0,15],['gpuSampleMs',250,2000]]) {
    args[name]=Number(args[name]);
    if(!Number.isInteger(args[name])||args[name]<min||args[name]>max)
      throw new Error(name+' must be an integer in '+min+'..'+max);
  }
  args.out=path.resolve(args.out || path.join(DIR,'..','..','outputs','qwen-profile',args.scenario));
  return args;
}
function sampleGpu(index) {
  return new Promise(resolve=>{
    execFile('nvidia-smi',['--query-gpu=index,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,clocks.sm',
      '--format=csv,noheader,nounits'],{timeout:2500,windowsHide:true},(error,stdout)=>{
      if(error) return resolve(null);
      const line=stdout.trim().split(/\r?\n/).map(x=>x.split(',').map(v=>v.trim()))
        .find(v=>Number(v[0])===index);
      if(!line||line.length<7||line.slice(1).some(x=>!Number.isFinite(Number(x)))) return resolve(null);
      resolve({ utilizationPct:Number(line[1]),memoryUsedMiB:Number(line[2]),
        memoryTotalMiB:Number(line[3]),temperatureC:Number(line[4]),
        powerW:Number(line[5]),clockMHz:Number(line[6])});
    });
  });
}
async function runCase(args,fixture,run,fetchImpl=globalThis.fetch) {
  const samples=[], t0=performance.now();
  let sampling=true, busy=false;
  const tick=async()=>{
    if(!sampling||busy) return;
    busy=true;
    try { const value=await sampleGpu(args.gpuIndex); if(value && sampling)samples.push(value); }
    finally { busy=false; }
  };
  const timer=args.noGpu?null:setInterval(tick,args.gpuSampleMs);
  timer?.unref();
  if(timer) tick();
  const row={scenario:args.scenario,fixture,run,status:'failed',gpuSamples:samples};
  try {
    const abort=new AbortController(), timeout=setTimeout(()=>abort.abort(),120000);
    let response;
    try {
      response=await fetchImpl(args.baseUrl+'/audio/speech',{
        method:'POST',headers:{'content-type':'application/json'},signal:abort.signal,
        body:JSON.stringify({model:'qwen3-tts',input:FIXTURES[fixture],voice:args.voice,response_format:'pcm'}),
      });
      row.headersMs=+(performance.now()-t0).toFixed(1);
      row.requestId=response.headers.get('x-lsa-request-id');
      if(!response.ok||response.headers.get('x-lsa-sample-rate')!=='24000'||!response.body)
        throw new Error('Invalid Qwen HTTP response '+response.status);
      let bytes=0,firstPcmMs=null,prevMs=null,maxGapMs=0,reads=0;
      for await(const chunk of response.body) {
        const now=performance.now();
        if(firstPcmMs===null) firstPcmMs=now-t0;
        if(prevMs!==null) maxGapMs=Math.max(maxGapMs,now-prevMs);
        prevMs=now; bytes+=chunk.byteLength; reads++;
      }
      if(bytes===0||bytes%2!==0) throw new Error('Empty or unaligned PCM');
      const elapsed=performance.now()-t0;
      row.status='completed';
      Object.assign(row,{bytes,reads,firstPcmMs:+firstPcmMs.toFixed(1),
        maxReadGapMs:+maxGapMs.toFixed(1),totalMs:+elapsed.toFixed(1),
        audioMs:+(bytes/48).toFixed(1),
        realtimeFactor:+((bytes/48)/elapsed).toFixed(3)});
    } finally { clearTimeout(timeout); }
  } catch(e) { row.errorType=e.name||'Error';row.errorCode=e.code||null; }
  finally { sampling=false;clearInterval(timer); }
  return row;
}
function report(data) {
  const {scenario,summary,rows}=data;
  const lines=['# Qwen GPU/latency profiling — '+scenario,'',
    'Direct 24 kHz Qwen sidecar HTTP, NOT Luna→LSA→native playback. Same fixed fixtures across scenarios.',
    'No raw dialogue or PCM retained. RTF = audio duration / total HTTP time; greater than 1 is faster than real time.',
    'GPU utilization/memory are device-wide nvidia-smi samples, not isolated to Qwen. Null = sampler unavailable.',
    'The first request is an untimed model warmup; server tts_profile logs separately report load and warmup phases.','',
    '| Fixture | Completed | First PCM median/p90 (ms) | Total median (ms) | RTF median | GPU util median | GPU mem max (MiB) |',
    '|---|---:|---:|---:|---:|---:|---:|'];
  for(const [name,s] of Object.entries(summary))lines.push(
    '| '+name+' | '+s.successful+' | '+[s.firstPcmMedianMs,s.firstPcmP90Ms].join(' / ')+
    ' | '+s.totalMedianMs+' | '+s.realtimeFactorMedian+' | '+s.gpuUtilMedianPct+
    ' | '+s.gpuMemoryMaxMiB+' |');
  lines.push('','Failures: '+rows.filter(r=>r.status!=='completed').length+
    '. Compare the SAME fixture between gta-closed, gta-idle and gta-gameplay; use server request IDs for phases.',
    'For intrusive GPU synchronization only, restart the sidecar with --profile-cuda-sync and label --scenario cuda-sync.',
    'CUDA synchronization alters scheduling; never compare cuda-sync values as if they were standard timings.');
  return lines.join('\n')+'\n';
}
export async function main(argv=process.argv.slice(2)) {
  const args=flags(argv);
  if(args.help) {
    process.stdout.write('Local Qwen latency profiler (no API keys, no GTA modifications).\n'+
      'node tools/qwen/profile_qwen_latency.mjs --scenario gta-closed|gta-idle|gta-gameplay|cuda-sync --voice nathan\n'+
      '  [--runs 3] [--base-url http://127.0.0.1:8000/v1] [--gpu-index 0] [--gpu-sample-ms 500] [--no-gpu] [--out directory]\n');
    return;
  }
  const health=await fetch(args.baseUrl.replace(/\/v1$/,'')+'/health',{signal:AbortSignal.timeout(5000)});
  if(!health.ok) throw new Error('Qwen sidecar health check failed');
  process.stdout.write('Warming Qwen with the short fixture (excluded from measurements)...\n');
  const warm=await runCase({...args,noGpu:true},'short',0);
  if(warm.status!=='completed')throw new Error('Qwen warmup failed: '+warm.errorType);
  const rows=[];
  for(let i=1;i<=args.runs;i++){
    for(const fixture of Object.keys(FIXTURES)) {
      const row=await runCase(args,fixture,i);
      rows.push(row);
      process.stdout.write(args.scenario+' '+fixture+' '+i+'/'+args.runs+' '+row.status+
        ' first='+row.firstPcmMs+'ms total='+row.totalMs+'ms RTF='+row.realtimeFactor+'\n');
    }
  }
  const data={timestamp:new Date().toISOString(),scenario:args.scenario,
    voice:args.voice, warmup:{firstPcmMs:warm.firstPcmMs,totalMs:warm.totalMs},
    runs:args.runs,summary:summarize(rows),rows};
  await mkdir(args.out,{recursive:true});
  await writeFile(path.join(args.out,'results.json'),JSON.stringify(data,null,2)+'\n');
  await writeFile(path.join(args.out,'report.md'),report(data));
  process.stdout.write('Wrote '+path.join(args.out,'report.md')+'\n');
  if(rows.some(r=>r.status!=='completed'))process.exitCode=1;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(e=>{process.stderr.write('Profiling error: '+e.message+'\n');process.exitCode=1;});
