import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCandidate, patchSource } from '../tools/buildCandidate.mjs';
import { EXPECTED_NATIVE_METADATA_SHA256, validateNativeEvidence, verifyNativeContract } from '../tools/verifyNativeContract.mjs';
import { assertCandidateWriteTarget, candidateRootPath } from '../tools/checkIsolation.mjs';

test('build is source-pinned, syntactically valid, deterministic, and writes only within the candidate', async () => {
  const candidateRoot = candidateRootPath();
  const tempRoot = await mkdtemp(path.join(candidateRoot, '.build-check-'));
  try {
    const first = await buildCandidate({ outputPath: path.join(tempRoot, 'first') });
    const second = await buildCandidate({ outputPath: path.join(tempRoot, 'second') });
    assert.equal(first.manifest.upstreamBundleSha256, '5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2');
    assert.equal(first.manifest.stockDllReferenceSha256, '9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653');
    assert.equal(first.manifest.builtBundleSha256, second.manifest.builtBundleSha256);
    assert.equal(first.manifest.e1SourceTreeSha256, second.manifest.e1SourceTreeSha256);
    assert.equal(first.manifest.releasePayloadSha256, second.manifest.releasePayloadSha256);
    assert.equal(first.manifest.astPatchCount, first.manifest.astPatches.length);
    assert.ok(first.manifest.astPatches.some(patch => patch.label === 'CP body hook'));
    assert.equal(first.manifest.realApiCalls, false);
    assert.equal(first.manifest.gtaRuntimeTest, false);
    assert.equal(first.manifest.features.intelligence.radioIdentity, 'trackTextId_v2');
    assert.equal(first.manifest.features.intelligence.radioSoundHashRole, 'secondary_container_evidence');
    assert.equal(first.manifest.features.intelligence.radioCatalog, 'research_candidate_gta_validation_pending');
    const radioCatalog = JSON.parse(await readFile(path.join(first.target, 'data', 'radioTrackTextIds.v2.json'), 'utf8'));
    assert.equal(radioCatalog.version, 2);
    assert.equal(radioCatalog.key, 'trackTextId');
    assert.equal(radioCatalog.counts.entries, 1058);
    await assert.rejects(readFile(path.join(first.target, 'data', 'radioTracks.v1.json'), 'utf8'), /ENOENT/);
    const bundle = await readFile(path.join(first.target, 'server.bundle.mjs'), 'utf8');
    const configModule = await import(pathToFileURL(path.join(first.target, 'e1/config/e1Config.mjs')).href);
    assert.equal(configModule.defaultConfigPath, path.join(first.target, 'e1.config.json'));
    assert.match(bundle, /__LSA_E1_RUNTIME\.createTransport/);
    assert.match(bundle, /routePinnedEvent/);
    assert.equal(first.manifest.launcherEntry, 'server.bundle.mjs');
    assert.throws(() => assertCandidateWriteTarget('C:/Program Files (x86)/Steam/steamapps/common/Grand Theft Auto V Enhanced/plugins/LosSantosAliveServer'));
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test('build rejects source changes and protects source/input directories',async()=>{
  const {writeFile}=await import('node:fs/promises');
  const root=candidateRootPath(); const temp=await mkdtemp(path.join(root,'.build-check-'));
  try {
    const input=path.join(temp,'changed.mjs');await writeFile(input,'// incorrect upstream');
    await assert.rejects(buildCandidate({sourcePath:input,outputPath:path.join(temp,'out')}),/Pinned Essential backend changed/);
    for(const protectedPath of ['upstream','src','tools','tests','docs']) assert.throws(()=>assertCandidateWriteTarget(path.join(root,protectedPath)),/output must be/);
  } finally { await rm(temp,{recursive:true,force:true}); }
});

test('native verification pins the metadata bytes as well as the claimed stock DLL', async () => {
  const dll = '9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653';
  const verified = await verifyNativeContract(dll);
  assert.equal(verified.metadataSha256, EXPECTED_NATIVE_METADATA_SHA256);
  const metadataText = await readFile(new URL('../docs/native-metadata.json', import.meta.url), 'utf8');
  const modified = JSON.parse(metadataText);
  modified.types[0].name = 'Altered.Type';
  await assert.rejects(verifyNativeContract(dll, { metadataText: JSON.stringify(modified) }), /metadata artifact fingerprint mismatch/);
  await assert.rejects(verifyNativeContract('0'.repeat(64)), /DLL fingerprint mismatch/);
});

test('native contract fails closed on missing or ambiguous required capabilities', async () => {
  const dll = '9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653';
  const evidence = JSON.parse(await readFile(new URL('../docs/native-metadata.json', import.meta.url), 'utf8'));
  const playback = evidence.types.find(type => type.name === 'LosSantosAlive.Audio.NpcPlaybackCoordinator');
  const complete = structuredClone(evidence);
  complete.types.find(type => type.name === 'LosSantosAlive.Audio.NpcPlaybackCoordinator').methods = playback.methods.filter(method => method.name !== 'MarkStreamEnded');
  assert.throws(() => validateNativeEvidence(complete, dll), /MarkStreamEnded/);
  const ambiguous = structuredClone(evidence);
  const methods = ambiguous.types.find(type => type.name === 'LosSantosAlive.Audio.NpcPlaybackCoordinator').methods;
  methods.push(structuredClone(methods.find(method => method.name === 'TryAuthorizeTurn')));
  assert.throws(() => validateNativeEvidence(ambiguous, dll), /expected one exact match; found 2/);
});

test('source patch rejects an ambiguous duplicate stock controller hook', async () => {
  const stock = await readFile(new URL('../upstream/server.bundle.mjs', import.meta.url), 'utf8');
  const registration = 'tP({pedId:i.pedId,turnId:i.id,generationId:i.generationId,sessionNonce:e.nonce,allowReplace:!0})';
  assert.ok(stock.includes(registration));
  assert.throws(() => patchSource(stock.replace(registration, `${registration},${registration}`)), /Xn native owner registration: expected one exact AST match; found 2/);
});
