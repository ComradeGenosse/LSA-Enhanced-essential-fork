import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {normalizeMemoryKConfig,MEMORY_K_CAPABILITIES} from '../src/memory/capabilityPolicy.mjs';
import {normalizeConfig} from '../src/config/e1Config.mjs';
import {createRuntimeForBundle} from '../src/bootstrap.mjs';
import * as glue from '../src/integration/essentialGlue.mjs';
import {worldProfileId} from './identity-fixtures.mjs';

test('storage-only profile expands existing optional descriptors to explicit off',()=>{
  const config=normalizeMemoryKConfig({profile:'storage-only'});
  assert.equal(config.profile,'storage-only');
  for(const descriptor of MEMORY_K_CAPABILITIES.filter(row=>row.id.startsWith('memory.')||row.id.startsWith('events.')))
    assert.equal(config.capabilities[descriptor.id],'off');
  assert.ok(Object.isFrozen(config.capabilities));
  assert.deepEqual(normalizeMemoryKConfig({}).capabilities,{});
});
test('storage-only refuses consumer activation or unknown profiles/modes',()=>{
  for(const id of ['memory.dialogue.player','memory.events','memory.cloudCuration','memory.interpretation','memory.callbacks','events.rollover'])
    assert.throws(()=>normalizeMemoryKConfig({profile:'storage-only',capabilities:{[id]:'on'}}),/requires .* off/);
  assert.throws(()=>normalizeMemoryKConfig({profile:'enable-all'}),/profile is unsupported/);
  assert.throws(()=>normalizeMemoryKConfig({profile:'storage-only',capabilities:{'memory.events':'shadow'}}),/requires .* off/);
});
test('storage-only requires explicit SQLite/P1 and fails before constructing any runtime resources',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'memory-storage-contract-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const configPath=path.join(directory,'config.json');let effects=0;
  const forbidden=()=>{effects++;throw new Error('unexpected effect');};
  await writeFile(configPath,JSON.stringify({memoryK:{profile:'storage-only'}}));
  await assert.rejects(createRuntimeForBundle({configPath,env:{},profileStore:{initialize:forbidden},
    fetchImpl:forbidden,intelligenceOptions:{connect:forbidden}}),/storage_only_requires_openai_p1_p2_sqlite/);
  assert.equal(effects,0);
});
test('storage-only refuses the accepted pre-C checkout rather than silently enabling legacy bundles',async t=>{
  const config={provider:'openai',persistentIdentity:{enabled:true,worldProfileId},
    promotedCharacters:{enabled:true,storageMode:'sqlite'},memoryK:{profile:'storage-only'}};
  assert.equal(normalizeConfig(config,{}).memoryK.profile,'storage-only');
  if(glue.MEMORY_K_COMPOSITION_VERSION===1) {
    assert.equal(glue.MEMORY_K_COMPOSITION_VERSION,1);return;
  }
  const directory=await mkdtemp(path.join(tmpdir(),'memory-storage-prerequisite-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const configPath=path.join(directory,'config.json');await writeFile(configPath,JSON.stringify(config));
  let effects=0;const forbidden=()=>{effects++;throw new Error('unexpected effect');};
  await assert.rejects(createRuntimeForBundle({configPath,env:{},enableTelemetry:false,
    profileStore:{initialize:forbidden},fetchImpl:forbidden}),/storage_only_composition_unavailable/);
  assert.equal(effects,0);
});
