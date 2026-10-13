import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { MEMORY_K_CAPABILITIES, normalizeMemoryKConfig, resolveMemoryKCapabilities } from '../src/memory/capabilityPolicy.mjs';
import { createRuntimeForBundle } from '../src/bootstrap.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ids = Object.fromEntries(MEMORY_K_CAPABILITIES.map(row=>[row.id,row]));
const registered = Object.fromEntries(MEMORY_K_CAPABILITIES.map(row=>[row.id,true]));
const resolve = capabilities => resolveMemoryKCapabilities({
  config:normalizeConfig({memoryK:{capabilities}},{}),available:registered
});

test('closed capability catalog, unsupported modes, and minimal graph', () => {
  assert.equal(Object.keys(ids).length,MEMORY_K_CAPABILITIES.length);
  for (const row of MEMORY_K_CAPABILITIES) {
    assert.ok(row.modes.length);
    for (const dep of row.dependencies) assert.ok(ids[dep],`${row.id} -> ${dep}`);
  }
  assert.deepEqual(ids['ps2.observations'].dependencies,['source.core']);
  assert.ok(!ids['ps1.producers'].dependencies.includes('p2.sqlite'));
  assert.ok(!ids['ps6.speech'].dependencies.includes('privacy.core'));
  assert.ok(!ids['ps6.speech'].dependencies.includes('p2.sqlite'));
  assert.ok(ids['ps6.speech'].dependencies.includes('ps3.salience'));
  assert.ok(ids['memory.events'].dependencies.includes('ps2.observations'));
  assert.ok(!ids['memory.events'].dependencies.includes('ps3.salience'));
  assert.ok(!ids['memory.coverage'].dependencies.includes('memory.events'));
  assert.ok(!ids['memory.deterministic'].dependencies.includes('memory.events'));
  assert.ok(!ids['memory.cloudCuration'].dependencies.includes('memory.deterministic'));
  for (const family of ['rollover','wasted','busted']) {
    assert.ok(!ids[`events.${family}`].dependencies.includes('memory.events'));
  }
  assert.ok(ids['memory.dialogue.npc'].dependencies.includes('memory.dialogue.player'));
  assert.throws(()=>normalizeMemoryKConfig({surprise:true}),/supports only capabilities/);
  assert.throws(()=>normalizeMemoryKConfig({capabilities:{'memory.cloudCuration':'shadow'}}),/mode is unsupported/);
  assert.throws(()=>normalizeMemoryKConfig({capabilities:{'source.core':'on'}}),/unsupported capability/);
  assert.throws(()=>normalizeMemoryKConfig({capabilities:{'not.a-capability':'on'}}),/unsupported capability/);
});

test('requested vs operational state never manufactures a runtime toggle', () => {
  const state=resolve({'memory.dialogue.player':'on','memory.recall':'on'});
  for(const id of ['memory.dialogue.player','memory.recall']) {
    assert.equal(state[id].requestedMode,'on');
    assert.equal(state[id].state,'unverified');
    assert.equal(state[id].effectiveMode,null);
    assert.equal(state[id].actualRuntimeState,'unknown');
    assert.equal(state[id].registrationStatus,'registered');
    assert.ok(state[id].blockers.includes('operational_receipt_unverified'));
  }
  const off=resolve({});
  assert.equal(off['memory.dialogue.player'].state,'not_requested');
  assert.equal(off['memory.dialogue.player'].actualRuntimeState,'unknown');
  assert.equal(off['memory.dialogue.player'].effectiveMode,null);
  // An explicit request for off does not tear down the existing bootstrap.
  assert.equal(resolve({'memory.dialogue.player':'off'})['memory.dialogue.player'].state,'not_requested');
  const unknown=resolveMemoryKCapabilities({config:{capabilities:{'memory.dialogue.player':'on'}}});
  assert.equal(unknown['memory.dialogue.player'].registrationStatus,'unverified');
  assert.ok(unknown['memory.dialogue.player'].blockers.includes('runtime_registration_unverified:memory.dialogue.player'));
});

test('NPC reply requires the durable player line, but player capture can stand alone', () => {
  const npcOnly=resolve({'memory.dialogue.npc':'on'});
  assert.equal(npcOnly['memory.dialogue.npc'].state,'blocked');
  assert.deepEqual(npcOnly['memory.dialogue.npc'].missingDependencies,['memory.dialogue.player']);
  assert.ok(npcOnly['memory.dialogue.npc'].blockers.includes('d03_reply_to_durable_player_unverified'));
  const playerOnly=resolve({'memory.dialogue.player':'on','memory.dialogue.npc':'off'});
  assert.equal(playerOnly['memory.dialogue.player'].state,'unverified');
  assert.deepEqual(playerOnly['memory.dialogue.player'].missingDependencies,[]);
  assert.equal(playerOnly['memory.dialogue.npc'].state,'not_requested');
  assert.equal(resolve({'memory.dialogue.player':'on','memory.dialogue.npc':'on'})['memory.dialogue.npc'].state,'unverified');
});

test('ordinary perception and M3 do not inherit unrelated SQLite/privacy or PS3 dependencies', () => {
  const state=resolve({'ps2.observations':'on','memory.events':'on'});
  assert.equal(state['ps2.observations'].state,'unverified');
  assert.equal(state['memory.events'].state,'unverified');
  assert.ok(!state['memory.events'].missingDependencies.includes('ps3.salience'));
  assert.ok(state['memory.events'].blockers.includes('ps2_accepted_observation_unverified'));
  const speech=resolve({'ps2.observations':'on','ps3.salience':'on','ps6.speech':'on'});
  assert.equal(speech['ps6.speech'].state,'unverified');
  assert.deepEqual(speech['ps6.speech'].missingDependencies,[]);
});

test('background workers and producer policy are independent of active capture/consumers', () => {
  const state=resolve({'memory.deterministic':'on','memory.cloudCuration':'on','events.rollover':'on'});
  assert.ok(!state['memory.deterministic'].missingDependencies.includes('memory.events'));
  assert.ok(!state['memory.cloudCuration'].missingDependencies.includes('memory.deterministic'));
  assert.ok(!state['events.rollover'].missingDependencies.includes('memory.events'));
  assert.ok(state['memory.deterministic'].blockers.includes('retained_evidence_eligibility_unverified'));
  assert.ok(state['memory.cloudCuration'].blockers.includes('persisted_consent_unverified'));
  for (const id of ['memory.deterministic','memory.cloudCuration','events.rollover']) {
    assert.equal(state[id].state,'unavailable'); // no production worker/compiled producer
    assert.equal(state[id].effectiveMode,null);
  }
  const blocked=resolve({'memory.callbacks':'on','ps6.speech':'on'});
  assert.ok(blocked['memory.callbacks'].missingDependencies.includes('memory.events'));
  assert.ok(blocked['memory.callbacks'].missingDependencies.includes('ps3.salience'));
});

test('registration is not proof of source freshness, confirmed timeline, writer health or consent', () => {
  const state=resolve({'memory.dialogue.player':'on','memory.cloudCuration':'on'});
  const player=state['memory.dialogue.player'];
  assert.ok(player.blockers.includes('native_owner_proof_unverified'));
  assert.ok(player.blockers.includes('sqlite_writer_health_unverified'));
  assert.ok(player.blockers.includes('timeline_confirmation_unverified'));
  assert.ok(player.blockers.includes('source_freshness_unverified'));
  assert.equal(state['source.core'].operationalState,'unverified');
  assert.ok(state['memory.cloudCuration'].blockers.includes('native_idle_unverified'));
  const missing=resolveMemoryKCapabilities({config:{capabilities:{'memory.dialogue.player':'on'}},available:{...registered,'p2.sqlite':false}});
  assert.equal(missing['p2.sqlite'].registrationStatus,'missing');
  assert.equal(missing['memory.dialogue.player'].effectiveMode,null);
});

test('legacy config is unchanged and omitted policy makes no new runtime request', () => {
  const legacy=normalizeConfig({promotedCharacters:{storageMode:'sqlite'},intelligence:{mode:'shadow'}},{});
  assert.equal(legacy.promotedCharacters.storageMode,'sqlite');
  assert.equal(legacy.intelligence.mode,'shadow');
  assert.deepEqual(legacy.memoryK.capabilities,{});
  assert.equal(resolveMemoryKCapabilities({config:legacy,available:registered})['memory.dialogue.player'].state,'not_requested');
});

test('bootstrap exposes read-only registration and explicitly unverified health', async t => {
  const directory=await mkdtemp(path.join(tmpdir(),'lsa-memory-capability-policy-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const configPath=path.join(directory,'config.json');
  await writeFile(configPath,JSON.stringify({
    persistentIdentity:{enabled:false},promotedCharacters:{enabled:false},
    memoryK:{capabilities:{'memory.dialogue.player':'on'}}
  }));
  let effects=0;
  const forbidden=()=>{effects++;throw new Error('diagnostics must not start services')};
  const runtime=await createRuntimeForBundle({configPath,env:{},enableTelemetry:false,startCharacterEditor:false,
    capabilityValidationPath:path.join(directory,'missing.json'),fetchImpl:forbidden,
    intelligenceOptions:{connect:forbidden},activityOptions:{connect:forbidden}});
  const capabilities=runtime.services.memoryKCapabilities();
  const diagnostic=runtime.services.memoryKDiagnostics();
  assert.equal(capabilities['memory.dialogue.player'].requestedMode,'on');
  assert.notEqual(capabilities['memory.dialogue.player'].state,'enabled');
  assert.equal(capabilities['memory.dialogue.player'].actualRuntimeState,'unknown');
  assert.equal(capabilities['memory.dialogue.player'].effectiveMode,null);
  assert.equal(capabilities['memory.cloudCuration'].state,'not_requested');
  assert.equal(diagnostic.environment.source.freshness,'unverified');
  assert.equal(diagnostic.environment.storage.writerHealth,'unverified');
  assert.equal(diagnostic.environment.storage.timelineConfirmation,'unverified');
  assert.equal(diagnostic.environment.native.currentOwnerProof,'unverified');
  assert.equal(diagnostic.environment.privacy.enforcement,'unverified');
  assert.equal(effects,0);
});
