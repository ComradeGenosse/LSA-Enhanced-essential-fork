import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { MEMORY_K_CAPABILITIES, normalizeMemoryKConfig, resolveMemoryKCapabilities } from '../src/memory/capabilityPolicy.mjs';
import { createRuntimeForBundle } from '../src/bootstrap.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ready = Object.fromEntries(['source.core', 'p2.sqlite', 'authority.native', 'privacy.core', 'memory.dialogue.player', 'memory.recall'].map(id => [id, true]));

test('Memory K descriptors are closed, declare modes and protect authority/privacy as prerequisites', () => {
  const ids = MEMORY_K_CAPABILITIES.map(row => row.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const row of MEMORY_K_CAPABILITIES) {
    assert.ok(row.modes.length > 0);
    for (const dependency of row.dependencies) assert.ok(ids.includes(dependency), `${row.id} -> ${dependency}`);
    if (row.kind !== 'prerequisite') {
      assert.ok(row.dependencies.includes('authority.native'));
      assert.ok(row.dependencies.includes('privacy.core'));
    }
  }
  assert.throws(() => normalizeMemoryKConfig({ surprise: true }), /supports only capabilities/);
  assert.throws(() => normalizeMemoryKConfig({ capabilities: { 'memory.cloudCuration': 'shadow' } }), /mode is unsupported/);
  assert.throws(() => normalizeMemoryKConfig({ capabilities: { 'not.a-capability': 'on' } }), /unsupported capability/);
});

test('requested capabilities resolve through explicit prerequisites with useful blocked diagnostics', () => {
  const config = normalizeConfig({ memoryK: { capabilities: { 'memory.dialogue.player': 'on', 'memory.recall': 'on' } } }, {});
  let state = resolveMemoryKCapabilities({ config, available: ready });
  assert.equal(state['memory.dialogue.player'].state, 'enabled');
  assert.equal(state['memory.dialogue.player'].requestedMode, 'on');
  assert.equal(state['memory.dialogue.player'].effectiveMode, 'on');
  assert.equal(state['memory.recall'].state, 'enabled');
  const recallOnly = normalizeConfig({ memoryK: { capabilities: { 'memory.recall': 'on' } } }, {});
  state = resolveMemoryKCapabilities({ config: recallOnly, available: ready });
  assert.equal(state['memory.recall'].state, 'blocked');
  assert.equal(state['memory.recall'].reason, 'dependency_not_enabled:memory.dialogue.player');

  state = resolveMemoryKCapabilities({ config, available: { ...ready, 'authority.native': false } });
  assert.equal(state['authority.native'].state, 'unavailable');
  assert.equal(state['memory.dialogue.player'].state, 'blocked');
  assert.match(state['memory.dialogue.player'].reason, /dependency_not_enabled:authority.native/);
});

test('capabilities can be disabled or advanced independently and unavailable producers stay closed', () => {
  const config = normalizeConfig({ memoryK: { capabilities: {
    'memory.dialogue.player': 'off',
    'memory.dialogue.npc': 'on',
    'memory.events': 'on',
    'events.rollover': 'on',
  } } }, {});
  const state = resolveMemoryKCapabilities({ config, available: {
    ...ready,
    'memory.dialogue.npc': true,
    'memory.events': true,
    'events.rollover': true,
  } });
  assert.equal(state['memory.dialogue.player'].state, 'disabled');
  assert.equal(state['memory.dialogue.npc'].state, 'enabled');
  assert.equal(state['memory.events'].state, 'enabled');
  assert.equal(state['events.rollover'].state, 'unavailable');
  assert.equal(state['events.rollover'].reason, 'native_producer_not_in_production_build');
});

test('legacy configuration defaults remain intact and no capability request is added implicitly', () => {
  const legacy = normalizeConfig({ promotedCharacters: { storageMode: 'sqlite' }, intelligence: { mode: 'shadow' } }, {});
  const baseline = normalizeConfig({}, {});
  assert.equal(legacy.promotedCharacters.storageMode, 'sqlite');
  assert.equal(legacy.intelligence.mode, 'shadow');
  assert.deepEqual(legacy.memoryK.capabilities, {});
  assert.deepEqual(baseline.memoryK.capabilities, {});
  const state = resolveMemoryKCapabilities({ config: legacy, available: ready });
  assert.equal(state['memory.dialogue.player'].state, 'disabled');
  assert.equal(state['memory.cloudCuration'].state, 'disabled');
});

test('bootstrap diagnostics are read-only and explain an unavailable requested integration', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lsa-memory-capability-policy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, 'config.json');
  await writeFile(configPath, JSON.stringify({
    persistentIdentity: { enabled: false },
    promotedCharacters: { enabled: false },
    memoryK: { capabilities: { 'memory.dialogue.player': 'on' } },
  }));
  let effects = 0;
  const forbidden = () => { effects++; throw new Error('diagnostics must not start external services'); };
  const runtime = await createRuntimeForBundle({ configPath, env: {}, enableTelemetry: false, startCharacterEditor: false,
    capabilityValidationPath: path.join(directory, 'missing.json'), fetchImpl: forbidden,
    intelligenceOptions: { connect: forbidden }, activityOptions: { connect: forbidden } });
  const state = runtime.services.memoryKCapabilities();
  assert.equal(state['memory.dialogue.player'].requestedMode, 'on');
  assert.notEqual(state['memory.dialogue.player'].state, 'enabled');
  assert.ok(state['memory.dialogue.player'].reason);
  assert.equal(state['memory.cloudCuration'].state, 'disabled');
  assert.equal(effects, 0);
});
