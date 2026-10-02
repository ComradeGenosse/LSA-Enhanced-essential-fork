import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { CharacterStore, validateStore } from '../src/identity/characterStore.mjs';
import { CharacterRegistry } from '../src/identity/characterRegistry.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { VoiceResolver } from '../src/voice/voiceResolver.mjs';
import { claim, worldProfileId, directory } from './identity-fixtures.mjs';

test('canonical alias creates once under concurrent resolution and survives registry restart', async t => {
  const filePath = path.join(await directory(t), 'registry.json');
  const registry = new CharacterRegistry(new CharacterStore({ filePath, worldProfileId }));
  const proof = claim();
  const records = await Promise.all(Array.from({ length: 12 }, () => registry.resolveOrCreate(proof)));
  assert.equal(new Set(records.map(record => record.characterId)).size, 1);
  const reloaded = new CharacterRegistry(new CharacterStore({ filePath, worldProfileId }));
  assert.equal((await reloaded.resolveOrCreate(claim({ incarnationId: claim().incarnationId }))).characterId, records[0].characterId);
  const bytes = await fs.readFile(filePath, 'utf8');
  for (const field of ['pedId','sessionNonce','bindingId','incarnationId','adapterEpoch','observationSequence','turnId','generationId','history']) assert.equal(bytes.includes(field), false);
});

test('alias encoding separates arbitrary delimiters and world scopes', async t => {
  const filePath = path.join(await directory(t), 'registry.json');
  const registry = new CharacterRegistry(new CharacterStore({ filePath, worldProfileId }));
  const a = await registry.resolveOrCreate(claim({ sourceKey: 'a:b' }));
  const b = await registry.resolveOrCreate(claim({ sourceKey: 'a|b' }));
  assert.notEqual(a.characterId, b.characterId);
  const otherWorld = '33333333-3333-4333-8333-333333333333';
  await assert.rejects(new CharacterStore({ filePath, worldProfileId: otherWorld }).load(), /unavailable/);
});

test('persisted actual voice/profile survives pool reorder and removal without rewriting the assignment', async t => {
  const filePath = path.join(await directory(t), 'registry.json');
  const voices = ['nova','onyx','echo'];
  const first = new VoiceResolver(normalizeConfig({ speechVoices: voices }, {}));
  const registry = new CharacterRegistry(new CharacterStore({ filePath, worldProfileId }));
  const record = await registry.resolveOrCreate(claim(), id => first.createPersistentAssignment(id, worldProfileId, {}));
  const bytes = await fs.readFile(filePath, 'utf8');
  const second = new VoiceResolver(normalizeConfig({ speechVoices: voices.toReversed() }, {}));
  assert.equal(first.resolvePersistent(record).voice, second.resolvePersistent(record).voice);
  const removed = new VoiceResolver(normalizeConfig({ speechVoices: ['shimmer'] }, {}));
  assert.equal(removed.resolvePersistent(record).voice, record.voiceAssignment.voice);
  assert.equal(await fs.readFile(filePath, 'utf8'), bytes);
});

test('backup contains prior committed registry; absent primary recovers atomically', async t => {
  const filePath = path.join(await directory(t), 'registry.json');
  const registry = new CharacterRegistry(new CharacterStore({ filePath, worldProfileId }));
  const first = await registry.resolveOrCreate(claim());
  await registry.resolveOrCreate(claim({ sourceKey: 'other' }));
  const previous = JSON.parse(await fs.readFile(filePath + '.bak', 'utf8'));
  assert.equal(previous.characters.length, 1);
  assert.equal(previous.characters[0].characterId, first.characterId);
  await fs.unlink(filePath);
  const restored = await new CharacterStore({ filePath, worldProfileId }).load();
  assert.deepEqual(restored, previous);
  assert.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf8')), previous);
  assert.equal((await fs.readdir(path.dirname(filePath))).some(file => file.endsWith('.tmp')), false);
});

for (const defect of ['malformed','unsupported','duplicate_id','duplicate_alias','runtime_data','bad_voice','too_large']) {
  test(`store ${defect} fails persistence closed and preserves the original bytes`, async t => {
    const filePath = path.join(await directory(t), 'registry.json');
    const registry = new CharacterRegistry(new CharacterStore({ filePath, worldProfileId }));
    await registry.resolveOrCreate(claim());
    const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
    if (defect === 'unsupported') data.schemaVersion = 2;
    if (defect === 'duplicate_id') data.characters.push({ ...data.characters[0], aliases: [{ ...data.characters[0].aliases[0], sourceKey: 'other' }] });
    if (defect === 'duplicate_alias') data.characters.push({ ...data.characters[0], characterId: claim().incarnationId });
    if (defect === 'runtime_data') data.characters[0].pedId = '17';
    if (defect === 'bad_voice') data.characters[0].voiceAssignment = { voice: 'nova' };
    const corrupted = defect === 'malformed' ? '{broken' : defect === 'too_large' ? ' '.repeat(1_048_577) : JSON.stringify(data);
    await fs.writeFile(filePath + '.bak', JSON.stringify({ ...data, schemaVersion: 1 }));
    await fs.writeFile(filePath, corrupted);
    const store = new CharacterStore({ filePath, worldProfileId });
    await assert.rejects(store.load(), /unavailable/);
    assert.equal(store.available, false);
    assert.equal(await fs.readFile(filePath, 'utf8'), corrupted);
  });
}

test('Windows sharing failures retry replacement without an unlink gap', async t => {
  const filePath = path.join(await directory(t), 'registry.json');
  let failures = 0, unlinked = false;
  const store = new CharacterStore({ filePath, worldProfileId, fileSystem: { ...fs,
    rename: async (from, to) => { if (to === filePath && failures++ < 2) throw Object.assign(new Error(), { code: 'EPERM' }); return fs.rename(from,to); },
    unlink: async () => { unlinked = true; throw new Error('forbidden'); } } });
  await new CharacterRegistry(store).resolveOrCreate(claim());
  assert.equal(failures, 3); assert.equal(unlinked, false);
  assert.equal(JSON.parse(await fs.readFile(filePath, 'utf8')).characters.length, 1);
});

for (const boundary of ['write','sync','backup','replace']) {
  test(`failure at ${boundary} does not publish a new record or overwrite the committed primary`, async t => {
    const filePath = path.join(await directory(t), 'registry.json');
    const original = new CharacterRegistry(new CharacterStore({ filePath, worldProfileId }));
    await original.resolveOrCreate(claim());
    const before = await fs.readFile(filePath, 'utf8');
    const fail = () => { throw Object.assign(new Error('private detail'), { code: 'EIO' }); };
    const store = new CharacterStore({ filePath, worldProfileId, fileSystem: { ...fs,
      open: async (file, mode) => { const handle = await fs.open(file, mode); if (mode === 'wx' && ['write','sync'].includes(boundary)) return {
        writeFile: boundary === 'write' ? fail : (...args) => handle.writeFile(...args),
        sync: boundary === 'sync' ? fail : () => handle.sync(), close: () => handle.close() }; return handle; },
      copyFile: boundary === 'backup' ? fail : fs.copyFile,
      rename: boundary === 'replace' ? fail : fs.rename } });
    const registry = new CharacterRegistry(store);
    await assert.rejects(registry.resolveOrCreate(claim({ sourceKey: 'new' })), /unavailable/);
    assert.equal(store.available, false);
    assert.equal(await fs.readFile(filePath, 'utf8'), before);
    assert.equal((await fs.readdir(path.dirname(filePath))).some(file => file.endsWith('.tmp')), false);
  });
}

test('strict store rejects invalid revisions and unknown voice/runtime properties', () => {
  for (const registryRevision of [-1, 0.5, '1']) assert.throws(() => validateStore({ schemaVersion: 1, worldProfileId, registryRevision, characters: [] }, worldProfileId));
});
