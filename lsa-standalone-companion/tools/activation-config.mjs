#!/usr/bin/env node
// Offline side-effect-free launcher preflight. Prints ONLY non-secret switches
// and capability states for the PowerShell parent to apply to both processes.
import { presetEnvironment, resolveActivation, PRESETS } from '../src/activation/capabilities.mjs';

const args = process.argv.slice(2);
const stage = args[0] ?? 'host';
const enable = [], disable = [];
for (const argument of args.slice(1)) {
  const match = /^--(enable|disable)=([a-z_]+)$/.exec(argument);
  if (!match) {
    console.error('Standalone preflight: invalid activation argument');
    process.exit(2);
  }
  (match[1] === 'enable' ? enable : disable).push(match[2]);
}
try {
  if (!Object.hasOwn(PRESETS, stage)) throw Error('unknown_stage:' + stage);
  const settings = presetEnvironment(stage, { enable, disable });
  const report = resolveActivation({ ...process.env, ...settings });
  if (!report.valid) throw Error(report.errors.join('; '));
  console.log(JSON.stringify({
    stage, settings,
    capabilities: report.capabilities,
    nativeActorMode: report.nativeActorMode,
    note: 'preflight_only_no_runtime_or_GTA_acceptance'
  }));
} catch (error) {
  // Errors are bounded, predetermined activation/configuration names.
  console.error('Standalone preflight: ' + error.message);
  process.exitCode = 2;
}
