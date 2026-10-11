// Opt-in, local-only provider A/B benchmark. No network access until --allow-billing.
// A: identical dialogue, real provider PCM. B: real Luna + stock controller, with
// OpenAI early segmented streaming vs Qwen's production buffered route.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockHarness } from '../../tests/stock-harness.mjs';
import { createProviderStack } from '../../src/providers/providerStack.mjs';
import { normalizeConfig, defaultConfigPath } from '../../src/config/e1Config.mjs';
import { loadPrivateEnvironment } from '../../src/config/privateEnvironment.mjs';
import { pcmToWav } from './lsa_turn_smoke.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PROVIDERS = ['openai', 'qwen'];
const MAX_CHARS = 1200;
export const SAMPLES = Object.freeze([
  { id: '01-greeting', prompt: 'Nathan, say hi.', dialogue: 'Hey, man. Good to see you.' },
  { id: '02-question', prompt: 'What do you think of this place?', dialogue: 'This place? Honestly, I have seen cleaner parking garages.' },
  { id: '03-warning', prompt: 'Is something wrong?', dialogue: 'Wait. Did you hear that? Stay right here. Something is moving behind us.' },
  { id: '04-amused', prompt: 'Why are you laughing?', dialogue: 'You drove straight into the only parked car on this entire street. That is impressive.' },
  { id: '05-angry', prompt: 'Why are you upset?', dialogue: 'You have got to be kidding me! I told you not to touch that!' },
  { id: '06-direction', prompt: 'Where are we going?', dialogue: 'Take the next left, drive two blocks, and pull over by the blue building.' },
  { id: '07-radio', prompt: 'How is the music?', dialogue: 'I like this song. Turn it up a little, unless you are trying to hear the traffic.' },
  { id: '08-reflection', prompt: 'Do you like Los Santos?', dialogue: 'Sometimes it feels like this city never sleeps. Even when the roads are empty, you know somebody is awake and making trouble.' },
  { id: '09-long', prompt: 'Tell me what happened.', dialogue: 'We were waiting outside the diner when a car came around the corner too fast. It clipped the curb, nearly took out a mailbox, and kept going. Nobody got hurt, but that was close.' },
  { id: '10-sarcastic', prompt: 'Any final thoughts?', dialogue: 'Oh, sure. Excellent plan. Absolutely nothing could possibly go wrong with this one.' },
]);
export function orderedProviders(index) {
  if (!Number.isInteger(index) || index < 0) throw new TypeError('invalid sample index');
  return index % 2 ? ['qwen', 'openai'] : ['openai', 'qwen'];
}
export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (p < 0 || p > 100) throw new RangeError('invalid percentile');
  const position = (sorted.length - 1) * p / 100;
  const lo = Math.floor(position), hi = Math.ceil(position);
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo)) * 10) / 10;
}
export function summarize(rows, phase) {
  const successful = rows.filter(r => r.phase === phase && r.status === 'completed');
  const failures = rows.filter(r => r.phase === phase && r.status !== 'completed');
  const result = {};
  for (const provider of PROVIDERS) {
    const subset = successful.filter(r => r.provider === provider);
    result[provider] = {
      completed: subset.length,
      failed: failures.filter(r => r.provider === provider).length,
      firstPcmMedianMs: percentile(subset.map(r => r.first_pcm_ms), 50),
      firstPcmP90Ms: percentile(subset.map(r => r.first_pcm_ms), 90),
      totalMedianMs: percentile(subset.map(r => r.total_ms), 50),
      totalP90Ms: percentile(subset.map(r => r.total_ms), 90),
    };
  }
  const pairs = SAMPLES.map(sample => {
    const a = successful.find(r => r.id === sample.id && r.provider === 'openai');
    const b = successful.find(r => r.id === sample.id && r.provider === 'qwen');
    return a && b ? { id: sample.id, openai: a.first_pcm_ms, qwen: b.first_pcm_ms } : null;
  }).filter(Boolean);
  return {
    ...result, pairedSamples: pairs.length,
    firstPcmWins: {
      openai: pairs.filter(p => p.openai < p.qwen).length,
      qwen: pairs.filter(p => p.qwen < p.openai).length,
      ties: pairs.filter(p => p.qwen === p.openai).length,
    },
    pairedFirstPcmMedianDifferenceMs: percentile(pairs.map(p => p.qwen - p.openai), 50),
  };
}

function configFor(raw, env, provider, { openaiVoice, qwenVoice, conversation = false }) {
  const qwen = provider === 'qwen';
  const voice = qwen ? qwenVoice : openaiVoice;
  const input = {
    ...raw, provider: 'openai',
    speechProvider: qwen ? 'faster-qwen3-tts' : 'openai',
    speechVoices: qwen ? raw.speechVoices : [voice],
    ttsVoice: qwen ? raw.ttsVoice : voice,
    qwenTts: { ...(raw.qwenTts || {}), speechVoices: [qwenVoice],
      speechVoiceProfiles: { [qwenVoice]: { genders: ['any'], ageBands: ['any'] } } },
    speechVoiceProfiles: { [voice]: { genders: ['any'], ageBands: ['any'] } },
    voiceAssignment: 'deterministic-session',
    actingEnabled: false,
    structuredStreamingEnabled: conversation && !qwen,
    earlyTtsEnabled: conversation && !qwen,
    intelligence: { mode: 'off' }, spontaneousSpeech: { mode: 'off' },
    activities: { mode: 'off' }, dialogueKnowledge: { mode: 'off' },
    persistentIdentity: { enabled: false }, promotedCharacters: { enabled: false },
    dialogueLogging: { enabled: false },
    retry: { ...(raw.retry || {}), enabled: false, maxAttempts: 1 },
  };
  return { input, config: normalizeConfig(input, env) };
}
function failureCode(error) {
  const candidate = String(error?.code || error?.name || 'error');
  return /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(candidate) ? candidate : 'error';
}
function clock() { return performance.now(); }
function recorder(started) {
  let first = null, previous = null, maxGap = 0;
  let size = 0;
  const chunks = [];
  return {
    async receive(bytes) {
      const at = clock();
      if (first === null) first = at - started;
      if (previous !== null) maxGap = Math.max(maxGap, at - previous);
      previous = at;
      const chunk = Buffer.from(bytes);
      if (chunk.length % 2 || !chunk.length) throw new Error('malformed_pcm');
      size += chunk.length;
      if (size > 12_000_000) throw new Error('pcm_too_large');
      chunks.push(chunk);
    },
    metrics() { return {
      first_pcm_ms: first === null ? null : Math.round(first * 10) / 10,
      max_interchunk_gap_ms: Math.round(maxGap * 10) / 10,
      pcm_chunks: chunks.length, pcm_bytes: size, audio_seconds: Math.round(size / 48000 * 100) / 100,
    }; },
    wav() { return pcmToWav(chunks); },
  };
}
function profile(config) {
  return { provider: config.speechProvider, model: config.ttsModel,
    voice: config.ttsVoice, speed: 1, instructions: '' };
}
async function saveWav(dir, phase, provider, id, r) {
  const relative = path.join(phase, provider, id + '.wav');
  const absolute = path.join(dir, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, r.wav());
  return relative.replaceAll('\\', '/');
}
function validateSamples(samples) {
  if (!Array.isArray(samples) || samples.length !== 10 || new Set(samples.map(s => s.id)).size !== 10)
    throw new TypeError('Benchmark requires exactly ten unique paired fixtures');
  for (const s of samples)
    if (!/^[a-z0-9-]+$/.test(s.id) || !s.prompt?.trim() || !s.dialogue?.trim() ||
        s.prompt.length > MAX_CHARS || s.dialogue.length > MAX_CHARS)
      throw new TypeError('Invalid benchmark fixture');
}
async function warmProviders({ rawConfig, env, fetchImpl, voices }) {
  const warm = {};
  for (const provider of PROVIDERS) {
    const { config } = configFor(rawConfig, env, provider, voices);
    const stack = createProviderStack(config, { fetchImpl });
    const started = clock();
    let bytes = 0;
    await stack.speech.synthesize({ identity: { pedId: '17', turnId: 'warmup', generationId: 1, sessionNonce: 1 },
      dialogue: 'Ready for the test.', speechProfile: profile(config), signal: new AbortController().signal,
      onPcm: async data => { bytes += data.length; } });
    if (!bytes) throw new Error('warmup_empty_pcm');
    warm[provider] = Math.round(clock() - started);
  }
  return warm;
}

export async function runTtsOnly({ rawConfig, env = {}, fetchImpl = globalThis.fetch, outputDir,
  voices, samples = SAMPLES }) {
  validateSamples(samples);
  if (!outputDir || !voices) throw new TypeError('Missing outputDir or voices');
  const rows = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    for (const provider of orderedProviders(i)) {
      const { config } = configFor(rawConfig, env, provider, voices);
      const stack = createProviderStack(config, { fetchImpl });
      const started = clock(), audio = recorder(started);
      const row = { phase: 'tts', provider, id: sample.id, dialogue_chars: sample.dialogue.length };
      try {
        const result = await stack.speech.synthesize({
          identity: { pedId: '17', turnId: 'tts-' + sample.id, generationId: 1, sessionNonce: 1 },
          dialogue: sample.dialogue, speechProfile: profile(config),
          signal: new AbortController().signal, onPcm: data => audio.receive(data),
        });
        assert.ok(result.bytes > 0 && audio.metrics().pcm_bytes > 0);
        Object.assign(row, audio.metrics(), { status: 'completed', total_ms: Math.round(clock() - started),
          wav: await saveWav(outputDir, 'tts', provider, sample.id, audio) });
        row.audio_over_wall = Math.round(row.audio_seconds / (row.total_ms / 1000) * 100) / 100;
      } catch (error) { row.status = 'failed'; row.error_code = failureCode(error); }
      rows.push(row);
    }
  }
  return rows;
}

// The real patched Essential stock-controller fixture is used for both routes.
// Only native GTA audio receipts are simulated; model and TTS requests are real.
export async function runConversations({ rawConfig, env = {}, fetchImpl = globalThis.fetch, outputDir,
  voices, samples = SAMPLES }) {
  validateSamples(samples);
  if (!outputDir || !voices) throw new TypeError('Missing outputDir or voices');
  if (!(env.OPENAI_API_KEY || env.OPENAI_REASONING_API_KEY))
    throw new Error('Missing Luna credentials for live conversation benchmark');
  const rows = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    for (const provider of orderedProviders(i)) {
      const { input } = configFor(rawConfig, env, provider, { ...voices, conversation: true });
      const mark = { model_sent: null, model_end: null, tts_sent: null, tts_requests: 0 };
      let started = null;
      const monitoredFetch = async (url, opts) => {
        const target = String(url);
        const isModel = target.endsWith('/responses');
        const isTts = target.endsWith('/audio/speech');
        if (isModel && mark.model_sent === null) mark.model_sent = clock() - started;
        if (isTts) {
          mark.tts_requests++;
          if (mark.tts_sent === null) mark.tts_sent = clock() - started;
        }
        const response = await fetchImpl(url, opts);
        if (!isModel || !response.body) return response;
        // Record the last consumed model chunk. SSE consumers can stop at
        // response.completed and cancel without ever reaching stream flush().
        const stream = response.body.pipeThrough(new TransformStream({
          transform(chunk, controller) {
            mark.model_end = clock() - started;
            controller.enqueue(chunk);
          },
        }));
        return new Response(stream, { status: response.status, statusText: response.statusText,
          headers: response.headers });
      };
      const h = await stockHarness('openai', { config: input, env, fetchImpl: monitoredFetch });
      const initialSpeak = h.runtime.services.speak;
      let audio;
      h.runtime.services.speak = options => initialSpeak({
        ...options,
        onPcm: async data => {
          await options.onPcm(data);
          await audio.receive(data);
        },
      });
      const row = { phase: 'conversation', provider, id: sample.id, prompt_chars: sample.prompt.length,
        model_mode: provider === 'openai' ? 'structured_early_streaming' : 'buffered' };
      let session;
      try {
        session = await h.openAIControllerSession({
          pedId: '17', nonce: 1,
          actorContext: { pedId: '17', roleName: 'Civilian', gender: 'Male', ageRange: '30-40' },
        });
        session.autoNativeAcks();
        started = clock();
        audio = recorder(started);
        h.context.benchmarkInput = { pedId: '17', speaker: session.session.actorContext, text: sample.prompt };
        const turn = await h.evaluate('ib(benchmarkInput)');
        if (!turn?.id) throw new Error('no_turn');
        const settled = await session.connection.whenSettled({
          pedId: turn.pedId, turnId: turn.id, generationId: turn.generationId, sessionNonce: 1,
        });
        if (settled?.status !== 'completed') throw Object.assign(new Error('turn_failed'),
          { code: String(settled?.terminalReason || 'turn_failed') });
        const history = h.runtime.history.readForSession('17', 1);
        assert.equal(history.filter(x => x.role === 'user').length, 1);
        const spoken = history.filter(x => x.role === 'assistant');
        assert.equal(spoken.length, 1);
        assert.equal(h.actions.length, 0);
        assert.ok(h.sent.some(x => x.type === 'npcAudioTurnStart'));
        assert.ok(h.sent.some(x => x.type === 'npcAudioStreamEnded'));
        assert.ok(mark.model_sent !== null && mark.model_end !== null && mark.tts_sent !== null);
        assert.ok(audio.metrics().pcm_bytes > 0);
        const total = clock() - started;
        Object.assign(row, audio.metrics(), {
          status: 'completed', dialogue_chars: spoken[0].content.length,
          model_sent_ms: Math.round(mark.model_sent),
          model_stream_end_ms: Math.round(mark.model_end),
          first_tts_request_ms: Math.round(mark.tts_sent), tts_requests: mark.tts_requests,
          total_ms: Math.round(total), wav: await saveWav(outputDir, 'conversation', provider, sample.id, audio),
          simulated_native_playback: true,
        });
      } catch (error) { row.status = 'failed'; row.error_code = failureCode(error); }
      finally { session?.connection.close(); h.runtime.identityService?.close(); }
      rows.push(row);
    }
  }
  return rows;
}
function csvText(rows) {
  const cols = ['phase','id','provider','status','model_mode','prompt_chars','dialogue_chars',
    'first_pcm_ms','total_ms','model_sent_ms','model_stream_end_ms','first_tts_request_ms',
    'tts_requests','audio_seconds','audio_over_wall','pcm_chunks','pcm_bytes',
    'max_interchunk_gap_ms','simulated_native_playback','wav','error_code'];
  const cell = value => {
    if (value === undefined || value === null) return '';
    const s = String(value);
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return cols.join(',') + '\n' + rows.map(r => cols.map(key => cell(r[key])).join(',')).join('\n') + '\n';
}
export function renderReport(rows, { warmup, head, mode }) {
  const parts = [
    '# LSA OpenAI vs Faster Qwen3-TTS: local benchmark',
    '',
    'Source: ' + head + ' | mode: ' + mode,
    'All first-PCM times are measured at the production PCM callback; GTA playback is simulated.',
    'TTS phase: identical ten text fixtures and ten paired calls per provider; alternated request order.',
    'Conversation phase: ten identical user prompts per provider but **different live Luna calls/outputs**.',
    'OpenAI conversation uses production structured early streaming; Qwen conversation uses production buffering.',
    '**Do not interpret conversation time differences as pure TTS performance.** No microphone or GTA audio latency is measured.',
    '', 'Warmup before measured cases (ms): OpenAI ' + (warmup?.openai ?? 'n/a') +
      ', Qwen ' + (warmup?.qwen ?? 'n/a') + '. Warmup speech can be billable on OpenAI.',
  ];
  for (const phase of ['tts','conversation']) {
    if (!rows.some(r => r.phase === phase)) continue;
    const stats = summarize(rows, phase);
    parts.push('', '## ' + phase, '',
      '| Provider | Success | Failed | First PCM median | First PCM p90 | Total median | Total p90 |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const provider of PROVIDERS) {
      const x = stats[provider];
      parts.push('| ' + provider + ' | ' + x.completed + ' | ' + x.failed + ' | ' +
        (x.firstPcmMedianMs ?? 'n/a') + ' ms | ' + (x.firstPcmP90Ms ?? 'n/a') +
        ' ms | ' + (x.totalMedianMs ?? 'n/a') + ' ms | ' + (x.totalP90Ms ?? 'n/a') + ' ms |');
    }
    parts.push('', 'Paired first-PCM wins: OpenAI ' + stats.firstPcmWins.openai +
      ', Qwen ' + stats.firstPcmWins.qwen + ', ties ' + stats.firstPcmWins.ties +
      ' across ' + stats.pairedSamples + ' complete pairs. ' +
      'Median paired (Qwen − OpenAI): ' + (stats.pairedFirstPcmMedianDifferenceMs ?? 'n/a') + ' ms.',
      '', '| Prompt | OpenAI first PCM | Qwen first PCM | OpenAI total | Qwen total |',
      '| --- | ---: | ---: | ---: | ---: |');
    for (const s of SAMPLES) {
      const a = rows.find(r => r.phase === phase && r.id === s.id && r.provider === 'openai');
      const b = rows.find(r => r.phase === phase && r.id === s.id && r.provider === 'qwen');
      const val = (r, key) => r?.status === 'completed' ? r[key] + ' ms' : 'FAIL';
      parts.push('| ' + s.id + ' | ' + val(a, 'first_pcm_ms') + ' | ' +
        val(b, 'first_pcm_ms') + ' | ' + val(a, 'total_ms') + ' | ' +
        val(b, 'total_ms') + ' |');
    }
  }
  return parts.join('\n') + '\n';
}
export function parseArgs(argv) {
  const options = { mode: 'tts', allowBilling: false, openaiVoice: null, qwenVoice: 'nathan', out: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--allow-billing') options.allowBilling = true;
    else if (['--mode','--openai-voice','--qwen-voice','--out'].includes(arg)) {
      const value = argv[++i];
      if (!value) throw new Error('Missing value for ' + arg);
      options[{ '--mode':'mode','--openai-voice':'openaiVoice','--qwen-voice':'qwenVoice','--out':'out' }[arg]] = value;
    } else throw new Error('Unknown argument: ' + arg);
  }
  if (!['tts','conversation','both'].includes(options.mode)) throw new Error('Invalid --mode');
  if (options.openaiVoice && !/^[a-z][a-z0-9_-]{0,31}$/.test(options.openaiVoice))
    throw new Error('Invalid --openai-voice');
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(options.qwenVoice)) throw new Error('Invalid --qwen-voice');
  return options;
}
export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write([
      'LSA production TTS A/B benchmark; no GTA or deployment.',
      'node tools/qwen/compare_tts_benchmark.mjs --mode tts|conversation|both --allow-billing',
      '  [--openai-voice ash] [--qwen-voice nathan] [--out ignored-local-output-dir]',
      'tts (default): 10 identical text pairs, 20 billable/real provider requests plus OpenAI warmup.',
      'conversation: 10 player prompt pairs, 20 billable Luna calls and 10+ OpenAI TTS calls.',
      'both: runs both phases. Qwen server must already be running at the configured loopback URL.',
      'Uses private e1.config.json and existing .env in memory; writes local WAV/CSV/JSON/Markdown.',
      'No real API calls without --allow-billing. Early streaming for OpenAI, buffered for Qwen.',
    ].join('\n') + '\n');
    return;
  }
  if (!args.allowBilling) throw new Error('Refusing billable OpenAI calls without --allow-billing');
  const rawConfig = JSON.parse(await readFile(defaultConfigPath, 'utf8'));
  const env = await loadPrivateEnvironment();
  const voices = { openaiVoice: args.openaiVoice || rawConfig.ttsVoice || 'ash', qwenVoice: args.qwenVoice };
  if (!(env.OPENAI_API_KEY || env.OPENAI_TTS_API_KEY)) throw new Error('Missing OpenAI TTS credential');
  if (args.mode !== 'tts' && !(env.OPENAI_API_KEY || env.OPENAI_REASONING_API_KEY))
    throw new Error('Missing Luna credential');
  if (!rawConfig.qwenTts?.baseUrl || !rawConfig.qwenTts.baseUrl.startsWith('http://127.0.0.1:'))
    throw new Error('Configure local Qwen URL in checkout-local e1.config.json');
  const outputDir = path.resolve(args.out || path.join(ROOT, 'outputs', 'qwen-benchmark',
    new Date().toISOString().replace(/[:.]/g, '-')));
  await mkdir(outputDir, { recursive: true });
  const warmed = await warmProviders({ rawConfig, env, fetchImpl: globalThis.fetch, voices });
  let rows = [];
  if (args.mode === 'tts' || args.mode === 'both')
    rows = rows.concat(await runTtsOnly({ rawConfig, env, outputDir, voices }));
  if (args.mode === 'conversation' || args.mode === 'both')
    rows = rows.concat(await runConversations({ rawConfig, env, outputDir, voices }));
  await writeFile(path.join(outputDir, 'results.csv'), csvText(rows));
  await writeFile(path.join(outputDir, 'results.json'), JSON.stringify({
    mode: args.mode, warmupMs: warmed, timestamp: new Date().toISOString(),
    note: 'Local results: do not commit WAVs/credentials/transcripts.', rows,
  }, null, 2) + '\n');
  await writeFile(path.join(outputDir, 'report.md'), renderReport(rows, {
    warmup: warmed, mode: args.mode, head: 'PR #39 provider integration',
  }));
  process.stdout.write('Local benchmark report: ' + path.join(outputDir, 'report.md') + '\n');
  if (rows.some(r => r.status !== 'completed')) process.exitCode = 1;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write('Benchmark failed: ' + failureCode(error) + '\n');
    process.exitCode = 1;
  });
}
