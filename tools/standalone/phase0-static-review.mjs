import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scan } from './phase0-inventory.mjs';

// Phase 0 audit: machine-reproducible *static* callsite census. No code execution
// from the inspected project, no game, no network and no original DLL load.
// Reflection and private stock protocol semantics remain explicit review gates.
const REFS = /\b(NpcStateStore|NpcActions|NpcTargeting|NpcFocus|InputController|NpcPlaybackCoordinator|NpcAudioQueue|NpcSpatialAudio|NpcLipSync|PerceptionSystem|IntegrationManager|ActorContextProvider|SpecialGeminiTurnScheduler|SpecialGeminiTurnService|NpcActionRegistry|NpcActionQueue|TextInputService|MovementBehavior|FollowBehavior|VehicleBehavior|CombatBehavior)\.([A-Za-z_]\w*)/g;
const REVIEW = Object.freeze({
  runtimeDomain: /(?:FindEssential\(|CoreStatus|PreInitializedDomain_|LosSantosAlive_AppDomain|CreateInstanceFromAndUnwrap)/,
  nativeReflection: /(?:GetMethod\(|GetField\(|GetType\(|Assembly\.LoadFrom|HarmonyLib|0Harmony)/,
  nativeProtocol: /(?:NpcPlaybackCoordinator|SpecialGeminiTurnScheduler|InputController|IntegrationManager|PerceptionSystem|NpcTargeting)/,
  stockPatch: /(?:patchSource\(|__LSA_E1_RUNTIME|expectedPatchCount|server\.bundle\.mjs)/,
  turnLifecycle: /(?:beginTurn\(|routePinnedEvent|observeNative|sessionNonce|generationId|directorTurnPrioritySnapshot)/,
  physicalTask: /(?:NpcActions|FollowBehavior|VehicleBehavior|CombatBehavior|TASK_|NativeFunction\.Call)/,
});
export async function audit(root) {
  const inventory = await scan(root);
  const symbolSites = {};
  const hotspots = [];
  const families = {};
  for (const entry of inventory.files) {
    const relative = entry.path;
    const contents = await readFile(path.join(root, relative), 'utf8');
    const lines = contents.split(/\r?\n/);
    const familiesHere = [];
    for (const [family, expression] of Object.entries(REVIEW)) {
      const hits = [];
      for (let i = 0; i < lines.length; i++) if (expression.test(lines[i])) hits.push(i + 1);
      if (hits.length) { familiesHere.push(family); (families[family] ??= []).push({ path: relative, lines: hits }); }
    }
    for (let i = 0; i < lines.length; i++) {
      REFS.lastIndex = 0;
      for (const match of lines[i].matchAll(REFS)) {
        const name = match[1] + '.' + match[2];
        (symbolSites[name] ??= []).push({ path: relative, line: i + 1 });
      }
    }
    if (familiesHere.length) hotspots.push({ path: relative, reviewFamilies: familiesHere });
  }
  const sorted = Object.fromEntries(Object.entries(symbolSites).sort(([a],[b]) => a.localeCompare(b)));
  return {
    schemaVersion: 1,
    proofScope: 'source-only',
    note: 'Enumerates textual direct named callsites and review heuristics. Dynamic/reflection and stock runtime semantics require manual source/physical evidence; counts are not behavioral proof.',
    filesScanned: inventory.filesScanned,
    candidateDependencyFiles: inventory.filesWithMatches,
    rawRules: inventory.filesByRule,
    directSymbolCount: Object.keys(sorted).length,
    directSymbolSites: sorted,
    reviewFamilies: families,
    reviewHotspots: hotspots,
    missingPhysicalProof: [
      'installed GTA and RAGE build hashes', 'real-game task ownership',
      'physical spatial audio and lip-sync', 'native voice capture timing',
    ],
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  audit(root).then(result => process.stdout.write(JSON.stringify(result, null, 2) + '\n'))
    .catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
}
