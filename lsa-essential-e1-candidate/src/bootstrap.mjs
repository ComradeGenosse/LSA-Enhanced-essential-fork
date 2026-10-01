import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config/e1Config.mjs';
import { createRuntime } from './integration/essentialGlue.mjs';
import { loadPrivateEnvironment } from './config/privateEnvironment.mjs';
import { createFileSink } from './observability/fileSink.mjs';
import { Telemetry, createNoopTelemetry } from './observability/telemetry.mjs';

let shutdownFlushRegistered = false;

export async function createRuntimeForBundle(options = {}) {
  // Explicit test/embedding environments remain isolated from local secrets.
  const env = options.env !== undefined && options.envFilePath === undefined
    ? options.env
    : await loadPrivateEnvironment(options);
  const config = await loadConfig({ ...options, env });
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
  return createRuntime(config, { ...options, telemetry });
}
