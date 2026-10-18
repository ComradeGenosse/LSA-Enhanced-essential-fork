// Stage the canonical shared-brain source next to the Essential E1 runtime.
// Source imports resolve to the repository's one shared implementation during
// development; staged imports are rewritten ONLY in the copied payload so
// standalone distribution of Essential does not require the repository tree.
import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RELATIVE_SOURCE = '../../../lsa-shared-brain/src/';
const RELATIVE_STAGE = '../_shared/';
const ADAPTERS = [
  'profileStore.mjs','sqliteFoundation.mjs','timelineGuard.mjs','memoryStorageAdapter.mjs'
];
// Any relative specifier that climbs out of the staged tree into the repository's
// shared-brain source, at any depth (static import, dynamic import or URL).
const SHARED_SPECIFIER = /(?:\.\.\/)+lsa-shared-brain\/src\//g;
const RESIDUAL_REFERENCE = 'lsa-shared-brain/src';
const SOURCE_EXTENSION = /\.(?:mjs|js|cjs)$/;
// Runtime contracts read from disk by staged code via `new URL('../../../contracts/<name>', import.meta.url)`.
// Both readers (e1/activities and e1/_shared/memory) resolve to <server root>/contracts/.
const RUNTIME_CONTRACTS = ['memory.v1.json', 'activity-capabilities.v1.json'];

async function* walkFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes:true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walkFiles(full);
    else if (entry.isFile()) yield full;
  }
}

function toPosix(value) { return value.split(path.sep).join('/'); }

// Rewrite every shared-brain specifier in a staged source file to the staged copy,
// relative to that file's own directory. Returns the number of rewritten references.
export function rewriteSharedSpecifiers(source, file, sharedDirectory) {
  let relative = toPosix(path.relative(path.dirname(file), sharedDirectory));
  if (!relative.startsWith('.')) relative = './' + relative;
  let count = 0;
  const rewritten = source.replace(SHARED_SPECIFIER, () => { count += 1; return relative + '/'; });
  return { rewritten, count };
}

export async function stageSharedMemory({ projectRoot, stagedE1 }) {
  const canonical = path.resolve(projectRoot, '../lsa-shared-brain/src');
  const destination = path.join(stagedE1, '_shared');
  // cp fails if the shared source is unavailable; never ship unresolved imports.
  // The candidate test harness can invoke concurrent builds into the same
  // preexisting output directory. Source files are byte-identical; directory
  // existence is not an installation conflict. Only invalid adapter imports
  // are fatal.
  await cp(canonical, destination, { recursive:true, force:true, errorOnExist:false });
  const patched = [];
  for (const name of ADAPTERS) {
    const file = path.join(stagedE1, 'characters', name);
    const original = await readFile(file, 'utf8');
    if (!original.includes(RELATIVE_SOURCE)) throw new Error('shared_memory_adapter_missing_reference:' + name);
    const transformed = original.replaceAll(RELATIVE_SOURCE, RELATIVE_STAGE);
    if (transformed.includes(RELATIVE_SOURCE)) throw new Error('shared_memory_adapter_unresolved:' + name);
    await writeFile(file, transformed, 'utf8');
    patched.push(name);
  }
  // Rewrite the remaining references (bootstrap, memory/*, any depth) and fail the build
  // if anything in the payload would still resolve into the repository tree.
  let rewrittenFiles = 0;
  for await (const file of walkFiles(stagedE1)) {
    if (!SOURCE_EXTENSION.test(file)) continue;
    const original = await readFile(file, 'utf8');
    if (!original.includes(RESIDUAL_REFERENCE)) continue;
    const { rewritten, count } = rewriteSharedSpecifiers(original, file, destination);
    if (count > 0) { await writeFile(file, rewritten, 'utf8'); rewrittenFiles += 1; }
    if (rewritten.includes(RESIDUAL_REFERENCE)) throw new Error('shared_memory_unresolved_reference:' + toPosix(path.relative(stagedE1, file)));
  }
  // Stage the runtime contracts next to the payload so the package needs no repository files.
  const contractsSource = path.resolve(projectRoot, '../contracts');
  const contractsDestination = path.join(path.dirname(stagedE1), 'contracts');
  await mkdir(contractsDestination, { recursive:true });
  for (const name of RUNTIME_CONTRACTS) {
    await cp(path.join(contractsSource, name), path.join(contractsDestination, name), { force:true });
  }
  return Object.freeze({ staged:patched.length, rewrittenFiles, contracts:RUNTIME_CONTRACTS.length, sharedDirectory:'e1/_shared' });
}
