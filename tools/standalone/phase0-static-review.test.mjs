import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { audit } from './phase0-static-review.mjs';

test('source census includes direct callsites even in files with no base scanner keyword hits', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lsa-review-'));
  try {
    const put = async (relative, contents) => {
      const file = path.join(root, relative);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, contents, 'utf8');
    };
    await put('native/one/Calls.cs', [
      'using LosSantosAlive.NPC;',
      'NpcStateStore.TryGetState(ped, out var state);',
      'InputController.SendMicStop();',
      'NpcPlaybackCoordinator.PlaybackStarted += Started;',
    ].join('\n'));
    await put('native/one/OnlyAudio.cs', 'NpcSpatialAudio.InterruptTurn();\n');
    await put('native/one/Reflection.cs', 'var m = target.GetMethod("Hidden");\n');
    await put('native/tests/Ignore.cs', 'NpcActions.FollowTarget();\n');
    await put('lsa-essential-e1-candidate/src/essentialGlue.mjs', 'const generationId = 1;\n');
    await put('lsa-essential-e1-candidate/tools/buildCandidate.mjs', 'const expectedPatchCount=70;\nfunction patchSource(x){return x;}\n');
    const a = await audit(root);
    const b = await audit(root);
    assert.deepEqual(a, b, 'deterministic');
    assert.equal(a.filesScanned, 5, 'all five production sources, including those without old scanner rule hits');
    assert(a.directSymbolSites['NpcStateStore.TryGetState'].some(x => x.path.endsWith('Calls.cs') && x.line === 2));
    assert(a.directSymbolSites['InputController.SendMicStop'].some(x => x.line === 3));
    assert(a.directSymbolSites['NpcPlaybackCoordinator.PlaybackStarted'].some(x => x.line === 4));
    assert(a.directSymbolSites['NpcSpatialAudio.InterruptTurn'].some(x => x.path.endsWith('OnlyAudio.cs')));
    assert(!a.directSymbolSites['NpcActions.FollowTarget']);
    assert(a.reviewFamilies.nativeReflection.some(x => x.path.endsWith('Reflection.cs')));
    assert(a.reviewFamilies.stockPatch.some(x => x.path.endsWith('buildCandidate.mjs')));
    assert(a.missingPhysicalProof.includes('physical spatial audio and lip-sync'));
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});
