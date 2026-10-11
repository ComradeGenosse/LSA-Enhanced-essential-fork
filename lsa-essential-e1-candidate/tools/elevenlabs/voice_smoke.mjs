#!/usr/bin/env node
// Opt-in, potentially billed ElevenLabs v4 Turbo TTS latency benchmark.
// No Luna, GTA, Qwen, raw dialogue logging, or credential output.
// Each sample opens the real production Text-to-Dialogue WebSocket provider.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { defaultConfigPath, normalizeConfig } from '../../src/config/e1Config.mjs';
import { loadPrivateEnvironment } from '../../src/config/privateEnvironment.mjs';
import { createElevenLabsSpeechProvider } from '../../src/providers/elevenlabs/speechProvider.mjs';
import { pcmToWav } from '../qwen/lsa_turn_smoke.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const LINE = 'Hey, it is Nathan. I am ready to get moving whenever you are.';
const DEFAULT_CREDITS_PER_CHAR = 0.5; // Estimate only, NOT account usage or guaranteed pricing.
const MAX_RUNS = 20;
const FAILURE_CODE = /^[a-z][a-z0-9_]{0,63}$/;
const round = value => Math.round(value * 10) / 10;

export function parseArgs(argv) {
  const options = { runs: 1, warmup: null, creditsPerCharacter: DEFAULT_CREDITS_PER_CHAR };
  const known = new Set(['--voice','--out','--report-dir','--runs','--credits-per-character']);
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') { options.help = true; continue; }
    if (flag === '--allow-billing') { options.allowBilling = true; continue; }
    if (flag === '--no-warmup') { options.warmup = false; continue; }
    if (!known.has(flag)) throw new Error('Unknown argument.');
    if (i + 1 >= argv.length || argv[i + 1].startsWith('--'))
      throw new Error('Missing argument value.');
    const value = argv[++i];
    if (flag === '--voice') options.voice = value;
    if (flag === '--out') options.out = value;
    if (flag === '--report-dir') options.reportDir = value;
    if (flag === '--runs') options.runs = Number(value);
    if (flag === '--credits-per-character') options.creditsPerCharacter = Number(value);
  }
  if (options.voice && !/^[a-z][a-z0-9_-]{0,31}$/.test(options.voice))
    throw new Error('Invalid voice alias.');
  if (!Number.isSafeInteger(options.runs) || options.runs < 1 || options.runs > MAX_RUNS)
    throw new Error('runs must be an integer from 1 to 20.');
  if (!Number.isFinite(options.creditsPerCharacter) || options.creditsPerCharacter <= 0 ||
      options.creditsPerCharacter > 10)
    throw new Error('credits-per-character must be between 0 and 10.');
  if (options.warmup === null) options.warmup = options.runs > 1;
  return options;
}

export function percentile(values, p) {
  if (!Array.isArray(values) || !values.length || values.some(v => !Number.isFinite(v)))
    return null;
  if (!Number.isFinite(p) || p < 0 || p > 100) throw new RangeError('Invalid percentile.');
  const ordered = [...values].sort((a, b) => a - b);
  const position = (ordered.length - 1) * p / 100;
  const left = Math.floor(position), right = Math.ceil(position);
  return round(ordered[left] + (ordered[right] - ordered[left]) * (position - left));
}
export function summarize(values) {
  if (!values.length) return {count:0,min:null,mean:null,median:null,p90:null,max:null};
  if (values.some(v => !Number.isFinite(v))) throw new TypeError('Invalid measurements.');
  return {
    count:values.length,
    min:round(Math.min(...values)),
    mean:round(values.reduce((total, value) => total + value, 0) / values.length),
    median:percentile(values,50),
    p90:percentile(values,90),
    max:round(Math.max(...values)),
  };
}
function sanitizedError(error) {
  // Do not emit raw vendor errors: they may include account or dialogue text.
  return typeof error?.code === 'string' && FAILURE_CODE.test(error.code)
    ? error.code : 'elevenlabs_smoke_failed';
}
async function oneSample({provider, voice, index, warmup, now, captureWav}) {
  const started = now(), buffers = [];
  let first = null, bytes = 0;
  const row = {run: index, phase:warmup ? 'warmup' : 'measured', status:'failed'};
  try {
    const result = await provider.synthesize({
      identity:{pedId:'offline-nathan-preview',turnId:'preview-'+index,
        generationId:index + 1,sessionNonce:index + 1},
      dialogue:LINE, speechProfile:{provider:'elevenlabs',voice},
      onPcm:async part => {
        if (first === null) first = now();
        bytes += part.byteLength;
        if (captureWav) buffers.push(Buffer.from(part));
      },
    });
    if (first === null || bytes <= 0 || bytes !== result.bytes || bytes % 2)
      throw Object.assign(new Error('Invalid streaming PCM'),{code:'elevenlabs_invalid_audio'});
    const total = now() - started, audio = result.bytes / 48;
    if (!Number.isFinite(total) || total <= 0 || first < started)
      throw new TypeError('Invalid benchmark clock.');
    Object.assign(row, {
      status:'completed', firstPcmMs:round(first - started),
      totalMs:round(total), audioMs:round(audio),
      realtimeFactor:round(audio / total), pcmBytes:result.bytes,
    });
  } catch (error) {
    row.errorCode = sanitizedError(error);
  }
  return {row, buffers};
}

/**
 * Pure orchestration with an injected speech provider: offline tests cost
 * nothing. On failure, stop immediately to avoid burning more credits.
 * The warmup is a REAL synth request and may be billed, but excluded from stats.
 */
export async function runBenchmark({
  provider, voice, modelId='eleven_v4_turbo', runs=1, warmup=runs>1,
  creditsPerCharacter=DEFAULT_CREDITS_PER_CHAR, now=()=>performance.now(),
  onProgress=()=>{},
} = {}) {
  if (!provider || typeof provider.synthesize !== 'function')
    throw new TypeError('A speech provider is required.');
  if (!Number.isSafeInteger(runs) || runs < 1 || runs > MAX_RUNS)
    throw new RangeError('Invalid run count.');
  if (typeof warmup !== 'boolean' ||
      !Number.isFinite(creditsPerCharacter) || creditsPerCharacter <= 0 || creditsPerCharacter > 10)
    throw new TypeError('Invalid benchmark settings.');
  const rows = [];
  let previewChunks = null;
  const phases = [...(warmup ? [{index:0,warmup:true}] : []),
    ...Array.from({length:runs}, (_,i)=>({index:i+1,warmup:false}))];
  for (const phase of phases) {
    const captureWav = !phase.warmup && previewChunks === null;
    const {row,buffers} = await oneSample({
      provider,voice,index:phase.index,warmup:phase.warmup,now,captureWav,
    });
    rows.push(row);
    if (captureWav && row.status === 'completed') previewChunks = buffers;
    onProgress({...row});
    if (row.status !== 'completed') break;
  }
  const measured = rows.filter(r=>r.phase==='measured');
  const good = measured.filter(r=>r.status==='completed');
  const completed = rows.filter(r=>r.status==='completed');
  const metrics = {
    firstPcmMs:summarize(good.map(r=>r.firstPcmMs)),
    totalMs:summarize(good.map(r=>r.totalMs)),
    audioMs:summarize(good.map(r=>r.audioMs)),
    realtimeFactor:summarize(good.map(r=>r.realtimeFactor)),
  };
  const report = {
    schemaVersion:1,
    provider:'elevenlabs',
    modelId,
    voiceAlias:voice,
    fixture:'nathan-fixed-line',
    charactersPerRequest:LINE.length,
    warmupRequested:warmup,
    requestedMeasuredRuns:runs,
    completedMeasuredRuns:good.length,
    failedMeasuredRuns:measured.filter(r=>r.status==='failed').length,
    stoppedEarly:rows.length < phases.length,
    attemptedRequests:rows.length,
    successfullyGeneratedRequests:completed.length,
    creditEstimate:{
      assumedCreditsPerCharacter:creditsPerCharacter,
      attemptedCharacters:LINE.length * rows.length,
      estimatedCreditsOnSuccessfulRequests:round(LINE.length * completed.length * creditsPerCharacter),
      estimatedCreditsIfAllAttemptsWereCharged:round(LINE.length * rows.length * creditsPerCharacter),
      actualCreditsUsed:null,
      note:'Estimates only; billing depends on account/model and rejected or interrupted requests. Check ElevenLabs Usage for actual credits.',
    },
    metrics,rows,
  };
  return {report, previewChunks};
}

export function reportMarkdown(report) {
  const {metrics,creditEstimate:credits}=report;
  const lines=[
    '# ElevenLabs v4 Turbo — direct speech benchmark',
    '',
    'Fixed Nathan fixture; real sequential Text-to-Dialogue requests; **not** Luna, GTA or native audible latency.',
    'Warmup is a potentially billable request and excluded from latency statistics.',
    '',
    '| Metric | Min | Mean | Median | p90 | Max | Completed |',
    '|---|---:|---:|---:|---:|---:|---:|',
  ];
  for (const [key,value] of Object.entries(metrics)) {
    lines.push('| '+key+' | '+[value.min,value.mean,value.median,value.p90,value.max,value.count]
      .map(x=>x??'—').join(' | ')+' |');
  }
  lines.push('','Measured successes: '+report.completedMeasuredRuns+'/'+report.requestedMeasuredRuns+
    '; attempts including warmup: '+report.attemptedRequests+
    '; early stop on failure: '+report.stoppedEarly+'.',
    '',
    'Estimated credit usage if all attempted requests were charged: **'+
      credits.estimatedCreditsIfAllAttemptsWereCharged+'** (assumed '+
      credits.assumedCreditsPerCharacter+' credits/character).',
    'Credits estimated for completed synthesis: '+credits.estimatedCreditsOnSuccessfulRequests+'.',
    '**Not actual charges.** Check the ElevenLabs usage dashboard for exact debits.',
    '',
    '| Phase | Run | Status | First PCM (ms) | Total (ms) | Audio (ms) | RTF | Failure code |',
    '|---|---:|---|---:|---:|---:|---:|---|');
  for (const row of report.rows) {
    lines.push('| '+[row.phase,row.run,row.status,row.firstPcmMs??'—',
      row.totalMs??'—',row.audioMs??'—',row.realtimeFactor??'—',row.errorCode??'—'].join(' | ')+' |');
  }
  return lines.join('\n')+'\n';
}

export async function main(argv=process.argv.slice(2)) {
  const options=parseArgs(argv);
  if (options.help) {
    process.stdout.write(
      'ElevenLabs paid voice preview / repeated latency benchmark; no GTA or Luna.\n'+
      'node tools/elevenlabs/voice_smoke.mjs --voice nathan --runs 10 --allow-billing\n'+
      '  [--no-warmup] [--out local-preview.wav] [--report-dir local-folder]\n'+
      '  [--credits-per-character 0.5]\n'+
      'Default: 1 request, no warmup; multi-run: 1 additional billable warmup.\n'+
      'Writes first successful measured WAV and, for multi-run, JSON/Markdown reports.\n'+
      'Requires private .env ELEVENLABS_API_KEY and e1.config.json voice alias.\n'
    );
    return;
  }
  if (!options.allowBilling) throw new Error('Live ElevenLabs synthesis requires --allow-billing.');
  // Before any network activity, show the maximum possible request count.
  const potentialRequests = options.runs + Number(options.warmup);
  process.stdout.write('ElevenLabs: '+potentialRequests+' potentially billed requests ('+
    options.runs+' measured, '+Number(options.warmup)+' warmup). Stop on first failure.\n');
  const env=await loadPrivateEnvironment();
  const raw=JSON.parse(await readFile(defaultConfigPath,'utf8'));
  const config=normalizeConfig({...raw,speechProvider:'elevenlabs'},env);
  const voice=options.voice || config.ttsVoice;
  if (!config.elevenLabs.voices[voice]) throw new Error('Selected ElevenLabs voice alias is missing.');
  const speech=createElevenLabsSpeechProvider({config});
  const {report,previewChunks}=await runBenchmark({
    provider:speech,voice,modelId:config.elevenLabs.modelId,runs:options.runs,
    warmup:options.warmup,creditsPerCharacter:options.creditsPerCharacter,
    onProgress:row=>process.stdout.write(row.phase+' '+row.run+' '+row.status+
      (row.status==='completed' ? ' first='+row.firstPcmMs+'ms total='+row.totalMs+'ms'
        : ' error='+row.errorCode)+'\n'),
  });
  const base=path.join(ROOT,'outputs','elevenlabs-smoke');
  const wavPath=path.resolve(options.out || path.join(base,'nathan.wav'));
  if (previewChunks) {
    await mkdir(path.dirname(wavPath),{recursive:true});
    await writeFile(wavPath,pcmToWav(previewChunks));
  }
  if (options.runs>1 || options.reportDir) {
    const directory=path.resolve(options.reportDir || path.join(base,'benchmark'));
    await mkdir(directory,{recursive:true});
    await writeFile(path.join(directory,'results.json'),JSON.stringify(report,null,2)+'\n');
    await writeFile(path.join(directory,'report.md'),reportMarkdown(report));
    process.stdout.write('Report: '+path.join(directory,'report.md')+'\n');
  }
  process.stdout.write(JSON.stringify({
    provider:report.provider,modelId:report.modelId,voiceAlias:voice,
    firstPcmMs:report.metrics.firstPcmMs.median,
    totalMs:report.metrics.totalMs.median,
    measuredSuccesses:report.completedMeasuredRuns,requestedRuns:report.requestedMeasuredRuns,
    summary:report.metrics,creditEstimate:report.creditEstimate,
    wav:previewChunks ? wavPath : null,
  },null,2)+'\n');
  if (report.stoppedEarly || report.completedMeasuredRuns !== options.runs) process.exitCode=1;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(()=>{process.stderr.write('ElevenLabs benchmark failed: configuration_or_local_error\n');process.exitCode=1;});
