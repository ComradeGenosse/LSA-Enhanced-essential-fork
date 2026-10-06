import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config/e1Config.mjs';
import { createRuntime } from './integration/essentialGlue.mjs';
import { loadPrivateEnvironment } from './config/privateEnvironment.mjs';
import { createFileSink } from './observability/fileSink.mjs';
import { Telemetry, createNoopTelemetry } from './observability/telemetry.mjs';
import { identityContractSupported } from './identity/nativeSupport.mjs';
import { startCharacterEditor } from './characters/editorServer.mjs';
import { defaultControlEndpointPath } from './control/endpointFile.mjs';
import { characterContractSupported } from './characters/nativeSupport.mjs';
import { IntelligenceClient } from './perception/intelligenceClient.mjs';
import { loadRadioTrackCatalog } from './perception/radioTrackCatalog.mjs';
import { ActivityClient } from './activities/activityClient.mjs';
import { ActivityRuntime } from './activities/activityRuntime.mjs';
import { perceptionContractSupported } from './perception/nativeSupport.mjs';
import { createDialogueTrace, createNoopDialogueTrace } from './observability/dialogueTrace.mjs';

const shutdownClosers = new Set();
let shutdownFlushRegistered = false;

export async function createRuntimeForBundle(options = {}) {
  // Explicit test/embedding environments remain isolated from local secrets.
  const env = options.env !== undefined && options.envFilePath === undefined
    ? options.env
    : await loadPrivateEnvironment(options);
  let config = await loadConfig({ ...options, env });
  if (config.persistentIdentity.enabled) {
    let contract = options.identityContract;
    if (contract === undefined) {
      try { contract = JSON.parse(await readFile(new URL('../build-manifest.json', import.meta.url), 'utf8')).identityContract; } catch {}
    }
    if (!identityContractSupported(contract)) {
      config = Object.freeze({ ...config, persistentIdentity: Object.freeze({ ...config.persistentIdentity, enabled: false }) });
      try { console.warn('[P1] Persistence disabled (optional_identity_contract_unavailable).'); } catch {}
    }
  }
  if (config.promotedCharacters.enabled) {
    let contract = options.characterContract;
    if (contract === undefined) try { contract = JSON.parse(await readFile(new URL('../build-manifest.json',import.meta.url),'utf8')).characterContract; } catch {}
    config = Object.freeze({ ...config,promotedCharacters:Object.freeze({ ...config.promotedCharacters,nativeSupported:characterContractSupported(contract) }) });
  }
  let telemetry = options.telemetry;
  if (!telemetry) {
    const entry = path.basename(process.argv[1] || '');
    const enabled = options.enableTelemetry === true || (!Object.hasOwn(options, 'enableTelemetry') && entry === 'server.bundle.mjs');
    if (enabled && config.observabilityEnabled) {
      try {
        let manifest = {};
        try { manifest = JSON.parse(await readFile(path.resolve(process.cwd(), 'build-manifest.json'), 'utf8')); } catch {}
        const sink = await createFileSink({
          directory: options.telemetryDirectory || path.resolve(process.cwd(), 'logs'),
          maxFileBytes: config.observabilityMaxFileBytes,
          maxTotalBytes: config.observabilityMaxTotalBytes,
          maxFiles: config.observabilityMaxFiles,
          onFailure: ({ code }) => { try { console.warn(`[E1 telemetry] persistent logging disabled (${code}).`); } catch {} },
        });
        telemetry = new Telemetry({ sink, run: {
          provider: config.provider, model: config.reasoningModel, nodeVersion: process.version,
          parentPid: process.ppid, bundleHash: options.bundleHash, dllHash: options.dllHash,
          providerWorkDeadlineMs: config.providerWorkDeadlineMs, playbackCompletionMaxMs: config.playbackCompletionMaxMs,
          credentialAvailable: Boolean(config.reasoningKey || config.transcriptionKey || config.ttsKey),
          bundleHash: manifest.builtBundleSha256, dllHash: manifest.nativeContract?.dllSha256,
        } });
        shutdownClosers.add(telemetry);
      } catch (error) {
        try { console.warn(`[E1 telemetry] persistent logging unavailable (${/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'initialization_failed'}).`); } catch {}
        telemetry = createNoopTelemetry();
      }
    } else telemetry = createNoopTelemetry();
  }
  let dialogueTrace = options.dialogueTrace || createNoopDialogueTrace();
  if (!options.dialogueTrace && config.provider === 'openai' && config.dialogueLogging.enabled) {
    try {
      const sink = await createFileSink({
        directory: options.dialogueDirectory || path.resolve(process.cwd(), 'logs', 'dialogue'),
        maxFileBytes: config.dialogueLogging.maxFileBytes,
        maxTotalBytes: config.dialogueLogging.maxTotalBytes,
        maxFiles: config.dialogueLogging.maxFiles,
        onFailure: ({ code }) => { try { console.warn(`[E1 dialogue] persistent logging disabled (${code}).`); } catch {} },
      });
      dialogueTrace = createDialogueTrace({ sink, telemetryRunId: telemetry?.runId || null, config: config.dialogueLogging,
        secrets: [config.reasoningKey, config.transcriptionKey, config.ttsKey] });
      shutdownClosers.add(dialogueTrace);
    } catch (error) {
      try { console.warn(`[E1 dialogue] persistent logging unavailable (${/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'initialization_failed'}).`); } catch {}
      dialogueTrace = createNoopDialogueTrace();
    }
  }
  if (!shutdownFlushRegistered) {
    shutdownFlushRegistered = true;
    process.once('beforeExit', async () => { for (const closer of shutdownClosers) await closer.close().catch(() => {}); });
  }
  const runtime = createRuntime(config, { ...options, telemetry, dialogueTrace });
  if(config.intelligence.mode==='shadow') {
    let contract=options.perceptionContract;
    if(contract===undefined) try {contract=JSON.parse(await readFile(new URL('../build-manifest.json',import.meta.url),'utf8')).perceptionContract;}catch{}
    if(perceptionContractSupported(contract)) {
      try {
        const suppliedIntelligenceTelemetry=options.intelligenceOptions?.telemetry;
        let radioCatalog=options.intelligenceOptions?.radioCatalog;
        if(radioCatalog===undefined && config.intelligence.radio==='shadow') {
          try { radioCatalog=loadRadioTrackCatalog(await readFile(new URL('../data/radioTracks.v1.json',import.meta.url),'utf8')); } catch {}
        }
        const intelligenceOptions={...options.intelligenceOptions,radioCatalog,telemetry:(event,data)=>{
          try { suppliedIntelligenceTelemetry?.(event,data); } catch {}
          try { telemetry?.emit?.(event,null,'internal',data,'internal'); } catch {}
        }};
        runtime.intelligence=new IntelligenceClient(config.intelligence,intelligenceOptions);runtime.intelligence.start();
      }catch{try{console.warn('[PS] optional_channel_unavailable');}catch{}}
    } else try {console.warn('[PS] optional_perception_contract_unavailable');}catch{}
  }
  runtime.services.acceptPlayerTranscript = input => runtime.intelligence?.acceptPlayerTranscript(input) ?? {accepted:false,reason:'unsupported_capture_receipt'};
  if(config.activities.mode==='shadow' || config.activities.mode==='on') {
    try {
      const onEvent = (event, data) => { try { telemetry?.emit?.(event, null, 'system', data); } catch {} };
      runtime.activities = config.activities.mode === 'on'
        ? new ActivityRuntime(config.activities, { ...options.activityOptions, onEvent })
        : new ActivityClient(config.activities, { ...options.activityOptions, onEvent });
      runtime.activities.start();
      runtime.characterService?.bindActivities?.(runtime.activities);
    } catch { try { console.warn('[ACT] optional_channel_unavailable'); } catch {} }
  }
  if (runtime.characterService) {
    await runtime.characterService.initialize();
    if (runtime.characterService.ready && options.startCharacterEditor !== false) try {
      // Per-user endpoint file for the native console bridge; null disables it.
      // The resolved environment keeps explicit test/embedding envs isolated.
      const endpointPath = options.controlEndpointPath !== undefined ? options.controlEndpointPath : defaultControlEndpointPath({ env });
      runtime.characterEditor = await startCharacterEditor(runtime.characterService,{ endpointPath });
      try { console.info('[P2] Character editor: ' + runtime.characterEditor.url); } catch {}
      if (endpointPath && !runtime.characterEditor.endpointPublished) try { console.warn('[UX] Control endpoint file unavailable; native clients use the page handshake.'); } catch {}
    } catch { runtime.characterService.emit('character_safe_failure',{reason:'owner_unavailable'}); }
  }
  return runtime;
}
