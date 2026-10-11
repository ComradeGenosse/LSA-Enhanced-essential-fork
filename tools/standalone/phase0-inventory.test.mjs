import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { scan, SOURCE_ROOTS } from './phase0-inventory.mjs';

test('Phase 0 inventory detects direct native and companion seams deterministically without executing them', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lsa-standalone-phase0-'));
  try {
    const save = async (relative, content) => {
      const full = path.join(root, relative);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, content, 'utf8');
    };
    await save('native/host/Native.cs',
      'using LosSantosAlive.Input;\nNpcTargeting.GetPlayerConversationPed();\n');
    await save('native/host/Native.csproj',
      '<Reference Include="LosSantosAlive" />\n');
    await save('native/host/Unaffected.cs',
      'using System;\nusing Rage;\n');
    await save('native/host/Reflected.cs',
      'var member = type.GetMethod("StopMic");\n');
    await save('native/tests/Mock.cs',
      'LosSantosAlive.dll\nNpcPlaybackCoordinator\n');
    await save('lsa-essential-e1-candidate/src/plain.mjs',
      'export const ok = true;\n');
    await save('lsa-essential-e1-candidate/tools/buildCandidate.mjs',
      'const stock = "server.bundle.mjs";\nfunction patchSource(x) { return x; }\n');
    await save('lsa-essential-e1-candidate/tools/vendor/ignore.mjs',
      'server.bundle.mjs\n');

    const one = await scan(root);
    const two = await scan(root);
    assert.deepEqual(one, two);
    assert.equal(one.schemaVersion, 1);
    assert.deepEqual(one.sourceRoots, SOURCE_ROOTS);
    assert.equal(one.filesScanned, 6);
    assert.equal(one.filesWithMatches, 4);
    assert.equal(one.filesByRule.essentialNamespace, 1);
    assert.equal(one.filesByRule.essentialAssembly, 1);
    assert.equal(one.filesByRule.essentialNpcState, 1);
    assert.equal(one.filesByRule.nativeReflection, 1);
    assert.equal(one.filesByRule.patchedStockServer, 1);
    assert(!one.files.some(x => x.path.includes('/tests/') || x.path.includes('/vendor/')));
    assert.deepEqual(one.files.find(x => x.path.endsWith('/Native.cs')).matches.essentialNpcState, [2]);
    assert.deepEqual(one.files.find(x => x.path.endsWith('/Native.csproj')).matches.essentialAssembly, [1]);
    assert.deepEqual(one.files.find(x => x.path.endsWith('/Reflected.cs')).matches.nativeReflection, [1]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Missing source roots fail rather than claiming an empty dependency inventory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lsa-phase0-missing-'));
  try {
    await assert.rejects(scan(root), /Missing source root/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
