import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Phase 0 only: static evidence discovery, NOT a proven or complete call graph.
// No external process, network, game assembly, generated artifacts or writes.
export const SOURCE_ROOTS = Object.freeze([
  'native',
  'lsa-essential-e1-candidate/src',
  'lsa-essential-e1-candidate/tools',
]);

export const RULES = Object.freeze({
  essentialNamespace: /\b(?:using\s+LosSantosAlive(?:\.[A-Za-z]\w*)*(?:;|\s)|LosSantosAlive\.[A-Z]\w*)/,
  essentialAssembly: /(?:LosSantosAlive\.dll|<Reference\s+Include=["']LosSantosAlive["'])/,
  essentialNpcState: /\b(?:NpcStateStore|NpcActions|NpcTargeting|NpcFocus)\b/,
  essentialInput: /\b(?:InputController|EssentialMicState|TextInputService)\b/,
  essentialPlayback: /\b(?:NpcPlaybackCoordinator|NpcAudioQueue|NpcAudioProtocol)\b/,
  essentialSpecialTurn: /\b(?:SpecialGeminiTurnScheduler|SpecialGeminiTurnService)\b/,
  essentialIntegration: /\b(?:IntegrationManager|IIntegration|ActorContextProvider|PerceptionSystem)\b/,
  patchedStockServer: /(?:server\.bundle\.mjs|patchSource\s*\(|expectedPatchCount|__LSA_E1_RUNTIME)/,
  nativeReflection: /\b(?:GetMethod|GetField|GetType|CreateInstanceFromAndUnwrap|Assembly\.LoadFrom|HarmonyLib|0Harmony)\b/,
});

const SKIP_PARTS = new Set([
  '.git', 'node_modules', 'dist', 'vendor', 'tests', 'test', 'fixtures',
  'input-tests', 'bridge-tests', 'facts-tests', 'host-tests', 'runtime-tests',
  'lifecycle-tests', 'integration-tests', 'director-tests',
  'ps-host-tests', 'host-context-tests',
]);
const EXT = new Set(['.cs', '.csproj', '.mjs']);

export async function scan(root, sourceRoots = SOURCE_ROOTS) {
  const files = [];
  async function walk(relative) {
    const abs = path.join(root, relative);
    let entries;
    try { entries = await readdir(abs, { withFileTypes: true }); }
    catch (error) {
      if (error.code === 'ENOENT') throw new Error('Missing source root: ' + relative);
      throw error;
    }
    entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const e of entries) {
      if (SKIP_PARTS.has(e.name) || e.name.startsWith('.')) continue;
      const next = path.join(relative, e.name);
      if (e.isDirectory()) await walk(next);
      else if (e.isFile() && EXT.has(path.extname(e.name))) files.push(next);
    }
  }
  for (const base of sourceRoots) await walk(base);
  files.sort();
  const counts = Object.fromEntries(Object.keys(RULES).map(k => [k, 0]));
  const results = [];
  for (const file of files) {
    const text = await readFile(path.join(root, file), 'utf8');
    const lines = text.split(/\r?\n/);
    const matches = {};
    for (const [rule, pattern] of Object.entries(RULES)) {
      const at = [];
      for (let i = 0; i < lines.length; i++) if (pattern.test(lines[i])) at.push(i + 1);
      if (at.length) { matches[rule] = at; counts[rule]++; }
    }
    if (Object.keys(matches).length) results.push({
      path: file.split(path.sep).join('/'),
      matches,
    });
  }
  return {
    schemaVersion: 1,
    note: 'Pattern/line inventory only. Review false positives, reflection and implicit protocol dependencies; does not prove runtime parity.',
    sourceRoots: [...sourceRoots],
    scannedFiles: files.map(file => file.split(path.sep).join('/')),
    filesScanned: files.length,
    filesWithMatches: results.length,
    filesByRule: counts,
    files: results,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  scan(root).then(data => process.stdout.write(JSON.stringify(data, null, 2) + '\n'))
    .catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
}
