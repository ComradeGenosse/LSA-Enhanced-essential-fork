import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config/e1Config.mjs';
import { createRuntime } from './integration/essentialGlue.mjs';
import { loadPrivateEnvironment } from './config/privateEnvironment.mjs';
import { createFileSink } from './observability/fileSink.mjs';
import { Telemetry, createNoopTelemetry } from './observability/telemetry.mjs';
import { identityContractSupported } from './identity/nativeSupport.mjs';
import { startCharacterEditor } from './characters/editorServer.mjs';
import { characterContractSupported } from './characters/nativeSupport.mjs';

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
        if (!shutdownFlushRegistered) {
          shutdownFlushRegistered = true;
          process.once('beforeExit', () => { telemetry.close().catch(() => {}); });
        }
      } catch (error) {
        try { console.warn(`[E1 telemetry] persistent logging unavailable (${/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'initialization_failed'}).`); } catch {}
        telemetry = createNoopTelemetry();
      }
    } else telemetry = createNoopTelemetry();
  }
  const runtime = createRuntime(config, { ...options, telemetry });
  if (runtime.characterService) {
    await runtime.characterService.initialize();
    if (runtime.characterService.ready && options.startCharacterEditor !== false) try {
      runtime.characterEditor = await startCharacterEditor(runtime.characterService);
      try { console.info('[P2] Character editor: ' + runtime.characterEditor.url); } catch {}
    } catch { runtime.characterService.emit('character_safe_failure',{reason:'owner_unavailable'}); }
  }
  return runtime;
}
