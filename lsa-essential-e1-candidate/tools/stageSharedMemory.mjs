// Stage the canonical shared-brain source next to the Essential E1 runtime.
// Source imports resolve to the repository's one shared implementation during
// development; staged imports are rewritten ONLY in the copied payload so
// standalone distribution of Essential does not require the repository tree.
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const RELATIVE_SOURCE = '../../../lsa-shared-brain/src/';
const RELATIVE_STAGE = '../_shared/';
const ADAPTERS = [
  'profileStore.mjs','sqliteFoundation.mjs','timelineGuard.mjs','memoryStorageAdapter.mjs'
];

export async function stageSharedMemory({ projectRoot, stagedE1 }) {
  const canonical = path.resolve(projectRoot, '../lsa-shared-brain/src');
  const destination = path.join(stagedE1, '_shared');
  // cp fails if the shared source is unavailable; never ship unresolved imports.
  await cp(canonical, destination, { recursive:true, force:false, errorOnExist:true });
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
  return Object.freeze({ staged:patched.length, sharedDirectory:'e1/_shared' });
}
