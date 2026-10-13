// K-01: the packaged backend must start with no repository tree behind it.
// Builds the candidate, copies ONLY the release payload into an empty directory
// outside the repository, and imports e1/bootstrap.mjs plus every e1/**/*.mjs there.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCandidate } from '../tools/buildCandidate.mjs';
import { rewriteSharedSpecifiers } from '../tools/stageSharedMemory.mjs';
import { candidateRootPath } from '../tools/checkIsolation.mjs';

async function* walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.isFile()) yield full;
  }
}

test('rewriteSharedSpecifiers resolves any depth to the staged _shared copy', () => {
  const shared = path.join('/pkg', 'e1', '_shared');
  const cases = [
    [path.join('/pkg', 'e1', 'bootstrap.mjs'), "from '../../lsa-shared-brain/src/events/a.mjs'", "from './_shared/events/a.mjs'"],
    [path.join('/pkg', 'e1', 'memory', 'x.mjs'), "from '../../../lsa-shared-brain/src/memory/b.mjs'", "from '../_shared/memory/b.mjs'"],
    [path.join('/pkg', 'e1', 'a', 'b', 'c.mjs'), "import('../../../../lsa-shared-brain/src/m/d.mjs')", "import('../../_shared/m/d.mjs')"],
  ];
  for (const [file, input, expected] of cases) {
    const { rewritten, count } = rewriteSharedSpecifiers(input, file, shared);
    assert.equal(count, 1);
    assert.equal(rewritten, expected);
  }
});

test('packaged backend imports from an empty directory without any repository file', async () => {
  const candidateRoot = candidateRootPath();
  const buildRoot = await mkdtemp(path.join(candidateRoot, '.build-check-k01-'));
  const isolated = await mkdtemp(path.join(os.tmpdir(), 'lsa-k01-empty-'));
  const scriptDirectory = await mkdtemp(path.join(os.tmpdir(), 'lsa-k01-script-'));
  try {
    const { target } = await buildCandidate({ outputPath: path.join(buildRoot, 'plugins/LosSantosAliveServer') });

    // Build-time gate: no staged file may still point at the repository's shared source.
    for await (const file of walk(target)) {
      if (!/\.(?:mjs|js|cjs)$/.test(file)) continue;
      assert.ok(!(await readFile(file, 'utf8')).includes('lsa-shared-brain/src'), 'residual repository reference in ' + path.relative(target, file));
    }
    for (const name of ['memory.v1.json', 'activity-capabilities.v1.json']) {
      JSON.parse(await readFile(path.join(target, 'contracts', name), 'utf8'));
    }

    const server = path.join(isolated, 'plugins/LosSantosAliveServer');
    await cp(target, server, { recursive: true });
    const modules = [];
    for await (const file of walk(path.join(server, 'e1'))) if (file.endsWith('.mjs')) modules.push(file);
    assert.ok(modules.length > 50, 'expected the full e1 tree to be staged');

    const script = path.join(scriptDirectory, 'import-all.mjs');
    await writeFile(script, `
      import { pathToFileURL } from 'node:url';
      const failures = [];
      const files = JSON.parse(process.argv[2]);
      const bootstrap = files.find(f => f.endsWith('/e1/bootstrap.mjs'));
      for (const file of [bootstrap, ...files.filter(f => f !== bootstrap)]) {
        try { await import(pathToFileURL(file).href); }
        catch (error) { failures.push({ file, code: error.code ?? null, message: String(error.message).slice(0, 300) }); }
      }
      process.stdout.write(JSON.stringify({ imported: files.length, failures }));
    `);
    const run = spawnSync(process.execPath, [script, JSON.stringify(modules.map(file => file.split(path.sep).join('/')))], { cwd: isolated, encoding: 'utf8', timeout: 120000 });
    assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout);
    assert.deepEqual(result.failures, []);
    assert.equal(result.imported, modules.length);
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
    await rm(isolated, { recursive: true, force: true });
    await rm(scriptDirectory, { recursive: true, force: true });
  }
});
