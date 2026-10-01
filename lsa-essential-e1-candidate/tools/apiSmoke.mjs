import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { loadConfig } from '../src/config/e1Config.mjs';
import { createRuntime } from '../src/integration/essentialGlue.mjs';
import { sameIdentity } from '../src/integration/nativeDelivery.mjs';
import { validateStockDecision } from '../src/context/decisionValidator.mjs';
import { pcm16Wav } from '../src/openai/transcribe.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportJsonPath = path.join(projectRoot, 'E1-API-SMOKE.json');
const reportMarkdownPath = path.join(projectRoot, 'E1-API-SMOKE.md');
const audioOutputDirectory = path.join(projectRoot, 'outputs', 'api-smoke');

if (process.env.E1_LIVE_API_SMOKE !== '1') {
  process.stderr.write('Live API smoke is billable. Set E1_LIVE_API_SMOKE=1 to opt in; no request was sent.\n');
  process.exit(2);
}
const smokePhase = process.env.E1_LIVE_API_SMOKE_PHASE || 'all';

function scrubbedCode(value) {
  const text = String(value || '');
  return /^[A-Za-z0-9_.-]{1,64}$/.test(text) ? text : 'other';
}

function safeEndpoint(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return 'unavailable';
  }
}

function contentType(response) {
  return String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
}

function safeUsage(value) {
  if (!value || typeof value !== 'object') return null;
  const usage = {};
  for (const key of ['input_tokens', 'output_tokens', 'total_tokens', 'input_audio_tokens', 'output_audio_tokens']) {
    if (Number.isFinite(value[key])) usage[key] = value[key];
  }
  return Object.keys(usage).length ? usage : null;
}

function safeApiError(body) {
  const error = body?.error && typeof body.error === 'object' ? body.error : body;
  return {
    apiErrorCode: scrubbedCode(error?.code),
    apiErrorType: scrubbedCode(error?.type),
    apiErrorParam: scrubbedCode(error?.param),
  };
}

const originalFetch = globalThis.fetch;
let activeProbe = '';
const httpRecords = [];

async function observedFetch(input, init) {
  const url = typeof input === 'string' ? input : input?.url;
  const startedAt = Date.now();
  try {
    const response = await originalFetch(input, init);
    const record = {
      probe: activeProbe,
      endpoint: safeEndpoint(url),
      httpStatus: response.status,
      latencyMs: Date.now() - startedAt,
      contentType: contentType(response) || null,
    };
    if (record.endpoint.endsWith('/responses') || !response.ok) {
      try {
        const body = await response.clone().json();
        if (record.endpoint.endsWith('/responses')) {
          record.responseStatus = typeof body?.status === 'string' ? body.status : null;
          record.responseModel = typeof body?.model === 'string' ? scrubbedCode(body.model) : null;
          record.usage = safeUsage(body?.usage);
        }
        if (!response.ok) Object.assign(record, safeApiError(body));
      } catch {
        if (!response.ok) Object.assign(record, safeApiError(null));
      }
    }
    httpRecords.push(record);
    return response;
  } catch (error) {
    httpRecords.push({
      probe: activeProbe,
      endpoint: safeEndpoint(url),
      latencyMs: Date.now() - startedAt,
      networkErrorType: scrubbedCode(error?.cause?.code || error?.name),
    });
    throw error;
  }
}

function requestRecords(probe) { return httpRecords.filter(record => record.probe === probe); }
function lastRequest(probe) { return requestRecords(probe).at(-1) || null; }

function classifyFailure(error, probe) {
  const request = lastRequest(probe);
  const status = Number(error?.status || request?.httpStatus || 0);
  const code = String(error?.code || request?.apiErrorCode || '').toLowerCase();
  const localCode = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (status === 401) return 'authentication_error';
  if (status === 403) return 'model_permission_or_access_error';
  if (status === 404) return code.includes('model') ? 'model_unavailable' : 'endpoint_incompatibility';
  if (status === 400) return code.includes('model') ? 'model_unavailable' : 'bad_request_or_schema_error';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'provider_server_error';
  if (code === 'timeout' || message.includes('timeout')) return 'provider_timeout';
  if (code === 'network_error' || request?.networkErrorType) return 'network_error';
  if (message.includes('refused')) return 'model_refusal';
  if (message.includes('invalid decision') || message.includes('decision must') || message.includes('decision fields') ||
      message.includes('dialogue must') || message.includes('command must') || message.includes('control command') ||
      message.includes('currently available') || message.includes('current actor snapshot') || message.includes('verified weapon')) return 'e1_validation_failure';
  if (probe === 'luna_decision' && status === 200 && error?.name === 'TypeError') return 'e1_validation_failure';
  if (localCode.includes('validation') || localCode.includes('decision')) return 'e1_validation_failure';
  if (localCode.includes('tts_format')) return 'tts_format_mismatch';
  if (localCode.includes('stt_format')) return 'stt_format_mismatch';
  if (localCode.includes('tts')) return 'tts_failure';
  if (localCode.includes('stt')) return 'stt_failure';
  if (localCode.includes('lifecycle') || localCode.includes('native')) return 'e1_native_lifecycle_failure';
  if (probe.includes('validation')) return 'e1_validation_failure';
  return 'e1_or_provider_error';
}

function safeFailure(error, probe) {
  const request = lastRequest(probe);
  const message = String(error?.message || '').toLowerCase();
  const diagnostic = message.includes('refused') ? 'model_refusal' :
    message.includes('invalid decision json') ? 'invalid_decision_json' :
    message.includes('decision must be a json object') ? 'invalid_decision_shape' :
    message.includes('decision must contain only') ? 'unexpected_decision_fields' :
    message.includes('decision fields must be strings') ? 'invalid_decision_field_type' :
    message.includes('dialogue must contain') ? 'invalid_dialogue' :
    message.includes('command must be empty') ? 'invalid_command' :
    message.includes('control command') ? 'control_text_in_dialogue' :
    message.includes('currently available') ? 'unsupported_action' :
    message.includes('target is not in the current actor snapshot') ? 'unresolved_target' :
    message.includes('vehicle reference') ? 'unresolved_vehicle' :
    message.includes('weapon') ? 'unverified_weapon' :
    message.includes('no decision text') ? 'missing_decision_text' :
    ['invalid_decision', 'model_refusal', 'model_error', 'stt_error', 'tts_error', 'native_auth_rejected', 'playback_ack_timeout'].includes(String(error?.code || '').toLowerCase()) ? String(error.code).toLowerCase() :
    error?.name === 'TypeError' ? 'unclassified_type_error' : null;
  return {
    classification: classifyFailure(error, probe),
    diagnostic,
    ...(error?.safeDetails && typeof error.safeDetails === 'object' ? { lifecycle: error.safeDetails } : {}),
    errorType: scrubbedCode(error?.name),
    providerCode: scrubbedCode(error?.code || request?.apiErrorCode),
    httpStatus: Number(error?.status || request?.httpStatus || 0) || null,
  };
}

async function probe(name, operation) {
  activeProbe = name;
  const startedAt = Date.now();
  try {
    const details = await operation();
    return { ...details, status: 'PASS', latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { status: 'FAIL', latencyMs: Date.now() - startedAt, ...safeFailure(error, name) };
  } finally {
    activeProbe = '';
  }
}

function assertSmoke(condition, message, code = 'smoke_assertion_failed') {
  if (condition) return;
  const error = new Error(message);
  error.code = code;
  throw error;
}

function actionParser(command) {
  const match = String(command || '').trim().match(/^DO\s+([A-Za-z][A-Za-z0-9_]*)(?:\s+(.*))?$/i);
  if (!match) return [];
  const name = match[1].toLowerCase();
  const tail = String(match[2] || '').trim();
  const person = tail.match(/\bP\d{3}\b/i)?.[0] || '';
  const vehicle = tail.match(/\bV\d{3}\b/i)?.[0] || '';
  return [{ actionName: name, target: person, parameter: vehicle || tail }];
}

const allowedActionNames = new Set(['waithere']);
const smokeIdentity = Object.freeze({ pedId: 'smoke-ped-1', turnId: 'smoke-turn-1', generationId: 1, sessionNonce: 1 });
const actor = Object.freeze({
  pedId: smokeIdentity.pedId,
  name: 'Test NPC',
  roleName: 'Civilian',
  location: 'sidewalk in Los Santos',
  availableActions: ['WaitHere'],
  availableWeapons: [],
  availableWeaponsContext: 'Available weapons: none',
});
const listener = Object.freeze({ pedId: 'smoke-player', name: 'Player', isPlayer: true });
const world = Object.freeze({ location: 'sidewalk in Los Santos', immediateDanger: false, playerNearby: true });
const systemInstruction = 'You are a brief, grounded Los Santos NPC. Do not claim to have performed an action. Use only an explicitly allowed stock action, and keep dialogue to one short sentence.';
const decisionContext = Object.freeze({
  systemInstruction, actor, listener, world,
  contextText: 'The NPC is standing on a sidewalk. The player is nearby. There is no immediate danger.',
  source: 'player_text',
});

function validateDecision(decision, context = decisionContext, identity = smokeIdentity) {
  return validateStockDecision(decision, {
    identity,
    actor: context.actor,
    parseActions: actionParser,
    allowedActionNames,
    resolvePerson: () => false,
    resolveVehicle: () => false,
  });
}

function actionToken(command) {
  return String(command || '').match(/^DO\s+([A-Za-z][A-Za-z0-9_]*)/i)?.[1] || null;
}

function wordSet(text) {
  const ignored = new Set(['the', 'is', 'a', 'an', 'to', 'of', 'and', 'beside']);
  return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(word => word && !ignored.has(word));
}

function phraseSimilarity(reference, transcript) {
  const expected = wordSet(reference);
  const actual = new Set(wordSet(transcript));
  const matched = expected.filter(word => actual.has(word)).length;
  return { matchedWords: matched, expectedContentWords: expected.length, ratio: expected.length ? matched / expected.length : 0 };
}

function resampleMonoPcm16(pcm, sourceRate, targetRate) {
  const source = Buffer.from(pcm);
  if (source.length < 2 || source.length % 2 !== 0 || sourceRate <= targetRate) throw new TypeError('Invalid PCM resampling input.');
  const sourceFrames = source.length / 2;
  const targetFrames = Math.floor(sourceFrames * targetRate / sourceRate);
  const output = Buffer.allocUnsafe(targetFrames * 2);
  for (let index = 0; index < targetFrames; index++) {
    const position = index * sourceRate / targetRate;
    const left = Math.floor(position);
    const right = Math.min(left + 1, sourceFrames - 1);
    const fraction = position - left;
    const a = source.readInt16LE(left * 2);
    const b = source.readInt16LE(right * 2);
    const sample = Math.max(-32768, Math.min(32767, Math.round(a + (b - a) * fraction)));
    output.writeInt16LE(sample, index * 2);
  }
  return output;
}

let report = {
  schemaVersion: 1,
  utcTimestamp: new Date().toISOString(),
  runMode: 'explicit-live-billable-smoke',
  phase: smokePhase,
  offlineTests: 'not run by this command',
  gta: 'NOT TESTED',
  configured: null,
  probes: {},
  requests: httpRecords,
  summary: 'incomplete',
};

async function writeReports() {
  report.requests = httpRecords;
  await writeFile(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const probeRows = Object.entries(report.probes).map(([name, value]) => `| ${name} | ${value.status || 'SKIP'} | ${value.httpStatus ?? '—'} | ${value.latencyMs ?? '—'} ms | ${value.classification || value.reason || '—'} |`).join('\n');
  const md = [
    '# E1.1 Live OpenAI API Smoke',
    '',
    `- UTC timestamp: ${report.utcTimestamp}`,
    `- Overall: **${report.summary}**`,
    `- Offline suite: ${report.offlineTests}`,
    '- GTA: **NOT TESTED**',
    '- No credentials, authorization headers, or hidden reasoning are recorded.',
    '',
    '## Configuration',
    '',
    '```json',
    JSON.stringify(report.configured, null, 2),
    '```',
    '',
    '## Probe results',
    '',
    '| Probe | Status | HTTP | Latency | Failure/result |',
    '|---|---:|---:|---:|---|',
    probeRows || '| — | SKIP | — | — | — |',
    '',
    '## Probe details',
    '',
    ...Object.entries(report.probes).flatMap(([name, value]) => [
      `### ${name}`,
      '',
      '```json',
      JSON.stringify(value, null, 2),
      '```',
      '',
    ]),
    '## HTTP request summary',
    '',
    '```json',
    JSON.stringify(report.requests, null, 2),
    '```',
    '',
  ].join('\n');
  await writeFile(reportMarkdownPath, md, 'utf8');
}

async function main() {
  const envPath = path.join(projectRoot, '.env');
  if (!process.env.OPENAI_API_KEY) {
    try {
      const privateEnv = parseEnv(await readFile(envPath, 'utf8'));
      for (const [name, value] of Object.entries(privateEnv)) {
        if (process.env[name] === undefined) process.env[name] = value;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const loaded = await loadConfig({ env: process.env });
  const config = Object.freeze({ ...loaded, maxOutputTokens: Math.min(loaded.maxOutputTokens, 128) });
  if (!config.reasoningKey || !config.transcriptionKey || !config.ttsKey) {
    process.stdout.write('LIVE SMOKE NOT RUN\nreason: OPENAI_API_KEY unavailable\n');
    process.exitCode = 2;
    return;
  }
  if (config.provider !== 'openai') {
    report.summary = 'FAIL: configured provider is not openai; no provider fallback was attempted';
    report.configured = { provider: config.provider };
    await writeReports();
    process.exitCode = 1;
    return;
  }
  if (!['all', 'pipeline'].includes(smokePhase)) {
    report.summary = 'FAIL: unknown smoke phase; no provider request was sent';
    report.configured = { provider: config.provider };
    await writeReports();
    process.exitCode = 1;
    return;
  }

  report.configured = {
    provider: config.provider,
    reasoning: { endpoint: safeEndpoint(`${config.reasoningBaseUrl}/responses`), model: config.reasoningModel, effort: config.reasoningEffort, maxOutputTokens: config.maxOutputTokens },
    transcription: { endpoint: safeEndpoint(`${config.transcriptionBaseUrl}/audio/transcriptions`), model: config.transcriptionModel },
    speech: { endpoint: safeEndpoint(`${config.ttsBaseUrl}/audio/speech`), model: config.ttsModel, voice: config.ttsVoice, responseFormat: 'pcm' },
    automaticRetries: 0,
    automaticProviderFallback: false,
  };
  process.stdout.write('LIVE BILLABLE E1.1 API SMOKE ENABLED: using configured models; retries and fallback are disabled.\n');

  await mkdir(audioOutputDirectory, { recursive: true });
  const runtime = createRuntime(config, { fetchImpl: observedFetch });
  const emptyHistory = [];
  const smokeInput = 'Hey, can you wait here for a second?';
  const knownPhrase = 'The blue car is parked beside the store.';
  let ttsPcm = null;
  let ttsMetadata = null;
  let transcript = '';

  if (smokePhase === 'pipeline') {
    try {
      const previous = JSON.parse(await readFile(reportJsonPath, 'utf8'));
      const sameModels = previous.configured?.provider === 'openai' &&
        previous.configured?.transcription?.model === config.transcriptionModel &&
        previous.configured?.speech?.model === config.ttsModel;
      assertSmoke(sameModels && previous.probes?.tts?.status === 'PASS' && previous.probes?.stt?.status === 'PASS',
        'Pipeline-only mode requires prior passing TTS/STT probes with the same configured models.', 'pipeline_fixture_unavailable');
      ttsPcm = await readFile(path.join(audioOutputDirectory, 'tts-smoke.pcm'));
      assertSmoke(ttsPcm.length > 0 && ttsPcm.length % 2 === 0, 'The prior TTS fixture is not aligned PCM16.', 'tts_format_mismatch');
      ttsMetadata = { bytes: ttsPcm.length, sampleRate: 24_000, channels: 1, bitsPerSample: 16, durationSeconds: ttsPcm.length / 48_000 };
      report.priorRunUtcTimestamp = previous.utcTimestamp;
      report.probes.tts = { ...previous.probes.tts, reusedFromPreviousRun: true };
      report.probes.stt = { ...previous.probes.stt, reusedFromPreviousRun: true };
    } catch (error) {
      report.summary = `FAIL: ${error?.code === 'ENOENT' ? 'prior TTS fixture unavailable' : 'prior passing TTS/STT evidence unavailable'}`;
      report.configured = { provider: config.provider };
      await writeReports();
      process.exitCode = 1;
      return;
    }
  }

  report.probes.luna_decision = smokePhase === 'pipeline' ? {
    status: 'SKIP', reason: 'The real Luna decision is exercised inside the end-to-end pipeline below.'
  } : await probe('luna_decision', async () => {
    const decision = await runtime.services.decide({
      context: decisionContext,
      source: 'player_text',
      input: smokeInput,
      history: emptyHistory,
      signal: AbortSignal.timeout(config.providerWorkDeadlineMs),
    });
    const checked = validateDecision(decision);
    assertSmoke(checked.identityValid === true, 'E1 rejected the native identity.', 'e1_validation_failure');
    assertSmoke(typeof checked.internalTranscript === 'string' && checked.internalTranscript.length > 0, 'E1 produced no validated dialogue.', 'e1_validation_failure');
    const request = lastRequest('luna_decision');
    assertSmoke(request?.httpStatus === 200 && request.responseStatus === 'completed', 'Responses did not return a completed response.', 'provider_response_incomplete');
    return {
      model: config.reasoningModel,
      responseStatus: request.responseStatus,
      httpStatus: request.httpStatus,
      dialogueLength: decision.dialogue.length,
      decision: { dialogue: decision.dialogue, command: decision.command, actionCount: checked.actionCount, actionToken: actionToken(decision.command), validated: true },
      usage: request.usage || null,
    };
  });

  if (smokePhase !== 'pipeline') report.probes.tts = await probe('tts', async () => {
    const chunks = [];
    const audio = await runtime.services.speak({
      dialogue: knownPhrase,
      signal: AbortSignal.timeout(config.providerWorkDeadlineMs),
      onPcm: async chunk => { chunks.push(Buffer.from(chunk)); },
    });
    ttsPcm = Buffer.concat(chunks);
    const request = lastRequest('tts');
    assertSmoke(request?.httpStatus === 200, 'TTS did not return HTTP success.', 'tts_http_failure');
    assertSmoke(ttsPcm.length > 0 && ttsPcm.length === audio.bytes && ttsPcm.length % 2 === 0, 'TTS returned empty or unaligned PCM.', 'tts_format_mismatch');
    assertSmoke(audio.sampleRate === 24_000 && audio.channels === 1, 'E1.1 TTS contract was not PCM16 mono 24 kHz.', 'tts_format_mismatch');
    assertSmoke(ttsPcm.some(byte => byte !== 0), 'TTS returned silent PCM.', 'tts_format_mismatch');
    const durationSeconds = ttsPcm.length / (24_000 * 2);
    assertSmoke(durationSeconds >= 0.1 && durationSeconds <= 30, 'TTS duration is outside the plausible smoke range.', 'tts_format_mismatch');
    const mime = request.contentType || '';
    assertSmoke(!mime || mime.startsWith('audio/') || mime === 'application/octet-stream', 'Unexpected TTS media type.', 'tts_format_mismatch');
    ttsMetadata = { bytes: ttsPcm.length, sampleRate: audio.sampleRate, channels: audio.channels, bitsPerSample: 16, durationSeconds };
    await writeFile(path.join(audioOutputDirectory, 'tts-smoke.pcm'), ttsPcm);
    await writeFile(path.join(audioOutputDirectory, 'tts-smoke.wav'), pcm16Wav(ttsPcm, audio.sampleRate));
    return { model: config.ttsModel, voice: config.ttsVoice, httpStatus: request.httpStatus, contentType: request.contentType, audio: ttsMetadata, artifacts: ['outputs/api-smoke/tts-smoke.pcm', 'outputs/api-smoke/tts-smoke.wav'] };
  });

  if (smokePhase !== 'pipeline') report.probes.stt = ttsPcm ? await probe('stt', async () => {
    transcript = await runtime.services.transcribe({
      pcm: ttsPcm,
      sampleRate: ttsMetadata.sampleRate,
      signal: AbortSignal.timeout(config.providerWorkDeadlineMs),
    });
    const similarity = phraseSimilarity(knownPhrase, transcript);
    const request = lastRequest('stt');
    assertSmoke(request?.httpStatus === 200, 'Transcription did not return HTTP success.', 'stt_http_failure');
    assertSmoke(transcript.trim().length > 0, 'Transcription was empty.', 'stt_format_mismatch');
    assertSmoke(similarity.ratio >= 0.7, 'Transcription did not substantially match the known speech fixture.', 'stt_format_mismatch');
    return { model: config.transcriptionModel, httpStatus: request.httpStatus, transcript, knownPhrase, similarity, inputWav: { sampleRate: ttsMetadata.sampleRate, channels: 1, bitsPerSample: 16, bytes: ttsPcm.length + 44 } };
  }) : { status: 'SKIP', reason: 'TTS fixture unavailable' };

  report.probes.failure_validation = await probe('failure_validation', async () => {
    let rejected = false;
    try {
      validateDecision({ dialogue: 'I will wait here.', command: 'DO RemoveWantedLevel' });
    } catch (error) {
      rejected = /currently available/.test(String(error.message));
    }
    assertSmoke(rejected, 'The real E1 stock decision validator did not reject an unsupported action.', 'e1_validation_failure');
    return { probeType: 'local stock-validator failure-path check', rejectedUnsupportedAction: true, networkRequests: 0, nextLiveProbeContinues: true };
  });

  if (ttsPcm && (smokePhase === 'pipeline' || (report.probes.stt.status === 'PASS' && report.probes.luna_decision.status === 'PASS'))) {
    report.probes.end_to_end = await probe('end_to_end', async () => {
      const inputPcm16 = resampleMonoPcm16(ttsPcm, ttsMetadata.sampleRate, 16_000);
      assertSmoke(inputPcm16.length > 0 && inputPcm16.length % 2 === 0, 'Could not prepare a valid PTT PCM fixture.', 'stt_format_mismatch');
      const identity = Object.freeze({ pedId: 'smoke-ped-1', turnId: 'smoke-turn-1', generationId: 1, sessionNonce: 1 });
      const native = { listeners: new Set(), authorized: 0, pcmBytes: 0, pcmChunks: 0, streamEnds: 0, playbackStarted: 0, playbackEnded: 0, terminalLogs: [], outputTranscriptCount: 0, beforePlayback: null, decision: null };
      const sendNative = event => {
        for (const listenerFn of [...native.listeners]) listenerFn({ ...identity, ...event });
      };
      const bridge = {
        assertCapabilities: () => true,
        isCurrent: value => sameIdentity(value, identity),
        onNativeEvent(listenerFn) { native.listeners.add(listenerFn); return () => native.listeners.delete(listenerFn); },
        authorize: async value => {
          if (!sameIdentity(value, identity)) return false;
          native.authorized++;
          sendNative({ type: 'audio_turn_accepted' });
          return true;
        },
        validateDecision: (decision, context, value) => {
          const validated = validateDecision(decision, context, value);
          native.command = validated.decision.command;
          native.decision = validated.decision;
          return validated;
        },
        routePinnedEvent: async event => {
          if (!sameIdentity(event, identity) || event.provider !== 'openai') return false;
          if (event.type === 'audio') {
            assertSmoke(native.authorized === 1, 'Tagged PCM arrived before simulated native authorization.', 'native_authorization_failure');
            native.pcmChunks++;
            native.pcmBytes += event.chunk?.byteLength || 0;
          }
          if (event.type === 'output_transcript') native.outputTranscriptCount++;
          if (event.type === 'turn_complete') {
            native.streamEnds++;
            native.beforePlayback = {
              history: runtime.history.readForSession(identity.pedId, identity.sessionNonce),
              assistantStaged: staged.assistantStaged,
              stagedDialogue: staged.dialogue,
            };
            native.playbackStarted++;
            sendNative({ type: 'playback_started', reason: 'started' });
            native.playbackEnded++;
            sendNative({ type: 'playback_ended', reason: 'completed', wasInterrupted: false, hadAudio: native.pcmBytes > 0, playbackStarted: true });
          }
          return true;
        },
        failMatchingTurn: () => true,
        log: (loggedIdentity, event, details) => {
          if (event === 'terminal') native.terminalLogs.push({ identity: loggedIdentity, ...details });
        },
      };
      runtime.attachBridge(bridge);

      const staged = { assistantStaged: false, dialogue: '' };
      const stage = runtime.history.stage.bind(runtime.history);
      runtime.history.stage = entry => {
        staged.assistantStaged = true;
        staged.dialogue = entry.spokenReply;
        return stage(entry);
      };

      const transport = runtime.createTransport(() => { throw new Error('Gemini must not be constructed in the live OpenAI smoke.'); });
      const connection = await transport.connect({ systemInstruction, actorContext: actor, targetContext: listener, diagnosticContext: { pedId: identity.pedId, sessionNonce: identity.sessionNonce } });
      try {
        await connection.beginTurn({ identity, source: 'player_mic', context: { systemInstruction, actor, listener, world, contextText: 'The player is nearby. No immediate danger is present.' } });
        assertSmoke(await connection.startRealtimeInput() === true, 'E1.1 did not begin the PTT turn.', 'e1_lifecycle_failure');
        assertSmoke(await connection.sendRealtimeAudio(inputPcm16, 16_000) === true, 'E1.1 did not accept the 16 kHz PTT fixture.', 'stt_format_mismatch');
        assertSmoke(await connection.endRealtimeInput() === true, 'E1.1 did not end the PTT turn.', 'e1_lifecycle_failure');
        const result = await connection.whenSettled(identity);
        if (result?.status !== 'completed' || result.terminalReason !== 'completed') {
          const failure = new Error('The E1.1 live pipeline did not reach native-confirmed completion.');
          failure.code = result?.terminalReason || 'e1_lifecycle_failure';
          failure.safeDetails = {
            stage: result?.stage || null,
            terminalReason: result?.terminalReason || null,
            causeType: scrubbedCode(result?.cause?.name),
            causeCode: scrubbedCode(result?.cause?.code),
          };
          throw failure;
        }
        const responseRequest = requestRecords('end_to_end').findLast(record => record.endpoint.endsWith('/responses'));
        assertSmoke(responseRequest?.httpStatus === 200 && responseRequest.responseStatus === 'completed', 'The E1.1 pipeline did not receive a completed Responses result.', 'provider_response_incomplete');
        const messagesBeforePlayback = native.beforePlayback?.history || [];
        const finalHistory = runtime.history.readForSession(identity.pedId, identity.sessionNonce);
        const userMessages = finalHistory.filter(message => message.role === 'user');
        const assistantMessages = finalHistory.filter(message => message.role === 'assistant');
        assertSmoke(native.authorized === 1 && native.pcmBytes > 0 && native.streamEnds === 1, 'Fake native authorization/tagged PCM/stream-end contract failed.', 'native_lifecycle_failure');
        assertSmoke(native.playbackStarted === 1 && native.playbackEnded === 1, 'Fake native playback acknowledgements were not exactly once.', 'native_lifecycle_failure');
        assertSmoke(native.beforePlayback?.assistantStaged === true && messagesBeforePlayback.length === 1 && messagesBeforePlayback[0].role === 'user', 'History was not staged before native success as expected.', 'history_semantics_failure');
        assertSmoke(userMessages.length === 1 && assistantMessages.length === 1 && finalHistory.length === 2, 'Successful E1 history contains duplicates or missing turns.', 'history_semantics_failure');
        assertSmoke(native.terminalLogs.length === 1 && native.terminalLogs[0].reason === 'completed' && sameIdentity(native.terminalLogs[0].identity, identity), 'E1 did not record exactly one terminal success for the exact identity.', 'native_lifecycle_failure');
        assertSmoke(native.outputTranscriptCount === 1, 'E1 did not emit one validated output transcript.', 'e1_lifecycle_failure');
        return {
          status: result.status,
          identity,
          source: 'player_mic',
          transcriptionModel: config.transcriptionModel,
          transcript: userMessages[0].content,
          reasoningModel: config.reasoningModel,
          decision: { dialogue: assistantMessages[0].content, command: native.command, actionToken: actionToken(native.command), validated: true },
          reasoningResponse: { httpStatus: responseRequest.httpStatus, responseStatus: responseRequest.responseStatus, usage: responseRequest.usage || null },
          ttsModel: config.ttsModel,
          audio: { pcmBytesReceived: native.pcmBytes, pcmChunksReceived: native.pcmChunks, sampleRate: 24_000, channels: 1, bitsPerSample: 16, durationSeconds: native.pcmBytes / 48_000 },
          native: { fakeEndpoint: true, authorizedStartCount: native.authorized, streamEndCount: native.streamEnds, playbackStartedCount: native.playbackStarted, playbackEndedCount: native.playbackEnded, terminalOutcomeCount: native.terminalLogs.length },
          history: { beforePlayback: messagesBeforePlayback, assistantStagedBeforePlayback: native.beforePlayback.assistantStaged, final: finalHistory, userCount: userMessages.length, assistantCount: assistantMessages.length },
        };
      } finally {
        connection.close();
      }
    });
  } else {
    report.probes.end_to_end = { status: 'SKIP', reason: 'A prerequisite TTS, STT, or Luna probe failed.' };
  }

  if (smokePhase === 'pipeline' && report.probes.end_to_end.status === 'PASS') {
    const pipeline = report.probes.end_to_end;
    const responseRequest = requestRecords('end_to_end').findLast(record => record.endpoint.endsWith('/responses'));
    report.probes.luna_decision = {
      status: 'PASS',
      model: config.reasoningModel,
      responseStatus: responseRequest?.responseStatus || null,
      httpStatus: responseRequest?.httpStatus || null,
      dialogueLength: pipeline.decision.dialogue.length,
      decision: { ...pipeline.decision, actionCount: pipeline.decision.command ? 1 : 0 },
      usage: responseRequest?.usage || null,
      exercisedAs: 'end_to_end_pipeline',
      latencyMs: responseRequest?.latencyMs || null,
    };
  }

  const probeValues = Object.values(report.probes);
  const failed = probeValues.some(value => value.status === 'FAIL');
  const skippedRequired = ['luna_decision', 'tts', 'stt', 'end_to_end'].some(name => report.probes[name]?.status !== 'PASS');
  report.summary = failed || skippedRequired ? 'FAIL or INCOMPLETE; inspect sanitized probe results' : 'PASS';
  report.offlineTests = 'PASS before live smoke; final rerun pending';
  await writeReports();
  process.stdout.write(`E1.1 live smoke ${report.summary}. Sanitized reports: E1-API-SMOKE.json and E1-API-SMOKE.md.\n`);
  if (failed || skippedRequired) process.exitCode = 1;
}

main().catch(async error => {
  report.summary = 'FAIL: smoke harness error';
  report.harnessFailureType = scrubbedCode(error?.name);
  try { await writeReports(); } catch { /* Keep only the safe console summary. */ }
  process.stderr.write(`E1.1 live smoke harness failed (${report.harnessFailureType}); sanitized report files were updated if writable.\n`);
  process.exitCode = 1;
});
