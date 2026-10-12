import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const read=p=>readFileSync(path.join(root,p),'utf8');
const hooks=JSON.parse(read('lsa-essential-e1-candidate/patches/essential-hooks.json'));
const inventory=JSON.parse(read('tools/memory-sim/closure-native-producers.v1.json'));
const verifier=read('tools/memory-sim/verify-pinned-production.mjs');
const project=read('native/promoted-characters/PromotedCharacters.csproj');
const builder=read('lsa-essential-e1-candidate/tools/buildCandidate.mjs');

test('original package validation has independent pinned original input hashes',()=>{
  assert.match(hooks.upstreamBundleSha256,/^[a-f0-9]{64}$/);
  assert.match(hooks.stockDllSha256,/^[a-f0-9]{64}$/);
  assert.ok(builder.includes(hooks.upstreamBundleSha256));
  assert.ok(builder.includes(hooks.stockDllSha256));
  assert.ok(verifier.includes('independent-ast-hook-reconciliation'));
  assert.ok(verifier.includes('a.label===p.id'));
  assert.ok(verifier.includes('a.start===p.sourceStart'));
  assert.ok(verifier.includes('a.end===p.sourceEnd'));
});
test('future backend AST edits cannot silently inherit a stale hardcoded 70-hook gate',()=>{
  assert.ok(Array.isArray(hooks.patches)&&hooks.patches.length>0);
  assert.equal(new Set(hooks.patches.map(x=>x.id)).size,hooks.patches.length);
  assert.ok(verifier.includes('compiledHooks.reduce'));
  assert.ok(!verifier.includes('patchCount:70'));
});
test('C01 is backend accepted input PLUS native owner; no native acceptance callback invented',()=>{
  assert.equal(inventory.schemaVersion,2);
  assert.deepEqual(inventory.required.map(x=>x.id),[
    'C01-dual-source-input-and-native-owner','M3-authenticated-source-time-owner',
    'M7-native-idle-and-priority','M9-gta-event-original-director']);
  assert.ok(Array.isArray(inventory.required[0].backendAcceptedSourcePaths));
  assert.ok(/post-acceptance/i.test(inventory.required[0].sourceContract));
  assert.ok(/native player/i.test(inventory.required[0].sourceContract));
  assert.ok(/promoted owner/i.test(inventory.required[0].sourceContract));
  assert.ok(verifier.includes('backend-C01-accepted-input-source'));
});
test('empty inventories remain explicitly blocking and never become evidence by prose',()=>{
  for(const producer of inventory.required) {
    assert.deepEqual(producer.sourcePaths,[]);
    assert.ok(producer.sourceContract.length>20);
  }
  assert.ok(verifier.includes('compiled.includes')===false);
  assert.ok(verifier.includes('compileSet.has(p)'));
  assert.ok(verifier.includes("valid?'pass':'blocked'"));
});
test('game-native production build rejects test-only M9 project producer paths',()=>{
  const compiled=[...project.matchAll(/<Compile Include="([^"]+)"/g)]
    .flatMap(x=>x[1].split(';')).map(x=>path.posix.normalize(path.posix.join('native/promoted-characters',x)));
  assert.ok(compiled.some(x=>x.endsWith('MemoryOwnerAuthority.cs')));
  assert.ok(!compiled.includes('native/intelligence/m9/M9NativeFrameAdapter.cs'));
  assert.ok(verifier.includes('production-compile-list'));
  assert.ok(verifier.includes('MISSING_EXTERNAL_PINNED_SDK'));
});
test('no arbitrary GTA path or no-hash compile reference is allowed',()=>{
  assert.ok(verifier.includes("w09-approved-sdk"));
  assert.ok(verifier.includes('W09_RPH_DLL_SHA256'));
  assert.ok(verifier.includes('W09_DAMAGE_DLL_SHA256'));
  assert.ok(verifier.includes('native-production-compile'));
  assert.ok(verifier.includes('report.gates.originalRunner'));
});
