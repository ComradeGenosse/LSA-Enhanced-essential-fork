import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stockHarness } from '../../tests/stock-harness.mjs';
import { loadPrivateEnvironment } from '../../src/config/privateEnvironment.mjs';
import { defaultConfigPath, normalizeConfig } from '../../src/config/e1Config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEFAULT_REPLY = "Hey, it's Nathan. I'm testing my new local voice, and I can hear myself just fine.";
const DEFAULT_PROMPT = 'Nathan, say something so I can test your voice.';
const MAX_PCM_BYTES = 12_000_000;

export function pcmToWav(chunks) {
  const pcm = Buffer.concat(chunks);
  if (!pcm.length || pcm.length > MAX_PCM_BYTES || pcm.length % 2 !== 0) {
    throw new Error('Qwen smoke rejected empty, oversized, or misaligned PCM.');
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Runs the production Luna decision / Qwen speech / patched stock native
// lifecycle in an offline GTA harness. Only the GTA-native acknowledgments
// and (by default) Luna's decision are simulated. The Qwen request is real
// unless a test explicitly injects fetchImpl.
export async function runQwenTurnSmoke({
  rawConfig = {},
  env = {},
  fetchImpl = globalThis.fetch,
  liveLuna = false,
  reply = DEFAULT_REPLY,
  prompt = DEFAULT_PROMPT,
  voice = null,
  outputPath,
} = {}) {
  if (!outputPath) throw new TypeError('Explicit outputPath required.');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1000 ||
      typeof reply !== 'string' || !reply.trim() || reply.length > 1200) {
    throw new TypeError('Prompt and simulated reply must be nonempty and bounded.');
  }
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    throw new TypeError('Invalid LSA configuration.');
  }

  // No edits to e1.config.json, identity stores, radio, or deployed files.
  // Keep this smoke buffered so a realistic single-response turn exercises
  // the existing validation -> streaming PCM -> native playback path.
  const registry = rawConfig.qwenTts || {};
  const pool = registry.speechVoices || ['nathan'];
  if (!Array.isArray(pool) || !pool.length) throw new TypeError('Configure at least one Qwen voice.');
  const selectedVoice = voice || pool[0];
  if (!pool.includes(selectedVoice)) throw new TypeError('Selected Qwen voice is not configured.');
  const configInput = {
    ...rawConfig,
    provider: 'openai',
    speechProvider: 'faster-qwen3-tts',
    qwenTts: {
      ...registry,
      speechVoices: [selectedVoice],
      speechVoiceProfiles: { [selectedVoice]: { genders: ['any'], ageBands: ['any'] } },
    },
    voiceAssignment: 'deterministic-session',
    actingEnabled: false,
    structuredStreamingEnabled: false,
    earlyTtsEnabled: false,
    intelligence: { mode: 'off' },
    spontaneousSpeech: { mode: 'off' },
    dialogueKnowledge: { mode: 'off' },
    activities: { mode: 'off' },
    persistentIdentity: { enabled: false },
    promotedCharacters: { enabled: false },
    dialogueLogging: { enabled: false },
    retry: { ...rawConfig.retry, enabled: false, maxAttempts: 1 },
  };
  const config = normalizeConfig(configInput, env);
  if (liveLuna && !config.reasoningKey) {
    throw new Error('Live Luna needs OPENAI_API_KEY or OPENAI_REASONING_API_KEY. Mock mode does not.');
  }

  const h = await stockHarness('openai', { config: configInput, env, fetchImpl });
  assert.equal(h.runtime.providerStack.speech.id, 'qwen.speech');
  const captured = [];
  const originalSpeak = h.runtime.services.speak;
  let firstPcmMs = null;
  const started = performance.now();
  let modelInvocations = 0;
  if (!liveLuna) {
    h.runtime.services.decide = async ({ input }) => {
      assert.equal(input, prompt);
      modelInvocations++;
      return { dialogue: reply, command: '' };
    };
  }
  h.runtime.services.speak = async options => {
    return originalSpeak({
      ...options,
      onPcm: async bytes => {
        // Native-handoff validation succeeds before the sample enters our
        // acceptance audio. A failed turn never writes an output WAV.
        await options.onPcm(bytes);
        if (firstPcmMs === null) firstPcmMs = performance.now() - started;
        const buffer = Buffer.from(bytes);
        const size = captured.reduce((n, item) => n + item.length, 0) + buffer.length;
        if (size > MAX_PCM_BYTES) throw new Error('Qwen smoke PCM exceeds size limit.');
        captured.push(buffer);
      },
    });
  };

  const session = await h.openAIControllerSession({
    pedId: '17', nonce: 1,
    actorContext: { pedId: '17', roleName: 'Civilian', gender: 'Male', ageRange: '30-40' },
  });
  try {
    session.autoNativeAcks();
    h.context.qwenSmokeInput = {
      pedId: '17', speaker: session.session.actorContext, text: prompt,
    };
    const turn = await h.evaluate('ib(qwenSmokeInput)');
    if (!turn?.id) throw new Error('Stock controller did not create a turn.');
    const result = await session.connection.whenSettled({
      pedId: turn.pedId, turnId: turn.id,
      generationId: turn.generationId, sessionNonce: 1,
    });
    if (result?.status !== 'completed') {
      throw new Error('LSA simulated turn failed: ' + String(result?.terminalReason || result?.status || 'unknown'));
    }
    const history = h.runtime.history.readForSession('17', 1);
    const spoken = history.filter(row => row.role === 'assistant');
    const input = history.filter(row => row.role === 'user');
    assert.equal(input.length, 1, 'Player utterance must commit exactly once.');
    assert.equal(input[0].content, prompt);
    assert.equal(spoken.length, 1, 'Assistant must commit only after simulated complete playback.');
    if (!liveLuna) {
      assert.equal(modelInvocations, 1, 'Simulated Luna must answer once.');
      assert.equal(spoken[0].content, reply);
    }
    assert.equal(h.actions.length, 0, 'Speech smoke must not dispatch world actions.');
    const events = h.sent.map(msg => msg.type);
    assert.ok(events.includes('npcAudioTurnStart'), 'Missing native audio authorization.');
    assert.ok(events.includes('npcAudioStreamEnded'), 'Missing native stream completion.');
    assert.ok(captured.length > 0, 'No Qwen PCM reached native playback.');
    const wav = pcmToWav(captured);
    await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    await writeFile(path.resolve(outputPath), wav);
    return Object.freeze({
      status: result.status, mode: liveLuna ? 'live_luna' : 'simulated_luna',
      voice: selectedVoice, transcript: spoken[0].content,
      qwenChunks: captured.length, pcmBytes: wav.length - 44,
      durationSeconds: (wav.length - 44) / 48000,
      firstPcmMs: Math.round(firstPcmMs), elapsedMs: Math.round(performance.now() - started),
      simulatedNativePlayback: true, outputPath: path.resolve(outputPath),
    });
  } finally {
    session.connection.close();
    h.runtime.identityService?.close();
  }
}

function parseArgs(argv) {
  const options = { liveLuna: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--live-luna') options.liveLuna = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (['--voice', '--reply', '--prompt', '--out'].includes(arg)) {
      if (!argv[i + 1]) throw new Error('Missing value for ' + arg);
      options[{ '--voice':'voice', '--reply':'reply', '--prompt':'prompt', '--out':'outputPath' }[arg]] = argv[++i];
    } else throw new Error('Unknown argument: ' + arg);
  }
  return options;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write([
      'LSA offline Luna -> Faster Qwen3-TTS conversation smoke',
      'Start the local Qwen server first. This does not launch GTA.',
      'node tools/qwen/lsa_turn_smoke.mjs [--voice nathan] [--reply "Hello there."]',
      '  [--prompt "Say hello."] [--out outputs/qwen-smoke/nathan.wav] [--live-luna]',
      'Default: simulated Luna response, real local Qwen, fake native playback ACKs.',
      '--live-luna makes ONE real OpenAI/Luna decision call (billable).',
    ].join('\n') + '\n');
    return;
  }
  const env = await loadPrivateEnvironment();
  let rawConfig;
  try { rawConfig = JSON.parse(await readFile(defaultConfigPath, 'utf8')); }
  catch { throw new Error('Missing or invalid local e1.config.json. Run with the private LSA config available.'); }
  const result = await runQwenTurnSmoke({
    ...args, rawConfig, env,
    outputPath: args.outputPath || path.join(root, 'outputs/qwen-smoke/nathan.wav'),
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.stdout.write('WAV is local; listen to it to verify voice quality. GTA was not launched.\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    process.stderr.write('Qwen turn smoke failed: ' + String(error?.message || 'unknown').slice(0, 260) + '\n');
    process.exitCode = 1;
  });
}
