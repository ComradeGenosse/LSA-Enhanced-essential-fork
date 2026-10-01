import path from 'node:path';
import { lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const candidateRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const windowsProtected = [
  'C:/Program Files (x86)/Steam/steamapps/common/Grand Theft Auto V',
  'C:/Program Files (x86)/Steam/steamapps/common/Grand Theft Auto V Enhanced',
  'C:/Users/Chris.COMRADE/Documents/Codex/2026-09-28/i-wa/work/lsa-phase0-1/LosSantosAliveServer',
];

export function assertCandidateWriteTarget(target) {
  const resolved = path.resolve(target);
  const relative = path.relative(candidateRoot, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('E1 writes must stay inside the candidate directory.');
  const first = relative.split(path.sep)[0];
  if (first !== 'dist' && !/^\.build-check-[A-Za-z0-9_-]+$/.test(first)) throw new Error('E1 output must be dist or an isolated build-check directory.');
  const normalized = resolved.replaceAll('\\', '/').toLowerCase();
  if (windowsProtected.some(root => normalized === root.toLowerCase() || normalized.startsWith(`${root.toLowerCase()}/`))) {
    throw new Error('E1 candidate build refuses GTA and protected development paths.');
  }
  return resolved;
}

export function candidateRootPath() { return candidateRoot; }

export async function assertNoLinkedOutput(target) {
  const resolved = assertCandidateWriteTarget(target);
  let current = candidateRoot;
  for (const part of ['', ...path.relative(candidateRoot, resolved).split(path.sep)]) {
    if (part) current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error('E1 output cannot traverse a link or junction.'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return resolved;
}
