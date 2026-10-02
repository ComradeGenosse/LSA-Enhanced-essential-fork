import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { validateClaim, actorClaim, normalizeIdentityConfig } from '../src/identity/identityContract.mjs';
import { RuntimeBindings } from '../src/identity/runtimeBindings.mjs';
import { validateIdentityEvidence, verifyIdentityContract, IDENTITY_DLL_SHA256 } from '../tools/verifyIdentityContract.mjs';
import { stockHarness } from './stock-harness.mjs';
import { claim, worldProfileId, actor, identity, directory, TestOwnerEvidence } from './identity-fixtures.mjs';
import { createRuntimeForBundle } from '../src/bootstrap.mjs';
import { createRuntime } from '../src/integration/essentialGlue.mjs';

test('only strict supported owner evidence can grant identity; ambient attributes and unknown fields grant nothing', () => {
  const valid = claim(), config = { worldProfileId };
  assert.ok(validateClaim(valid,config));
  for (const patch of [{schemaVersion:2},{sourceContractVersion:2},{sourceNamespace:'policingRedefined'},{worldProfileId:claim().incarnationId},
    {sourceKey:''},{sourceKey:'a'.repeat(129)},{sourceKey:'x\ny'},{incarnationId:'17'},{adapterEpoch:17},
    {claimRevision:'1'},{observationSequence:-1},{observedGameTime:NaN},{pedId:'92'},{actionCapabilities:{}},{model:'same'},{name:'Alex'}]) {
    assert.equal(validateClaim({ ...valid,...patch },config),null,JSON.stringify(patch));
  }
  assert.equal(validateClaim([valid,valid],config),null);
  assert.equal(actorClaim(actor('17',null,{ personaName:'Alex',pedModel:'same' }),config).reason,'no_evidence');
  const conflicting = actor('17',valid); conflicting.integrations.raw = { sessionIdentity: { ...valid,sourceKey:'other' } };
  assert.equal(actorClaim(conflicting,config).conflict,true);
});

test('feature flags have explicit world scope, bounded preparation and one trusted owner namespace', () => {
  assert.equal(normalizeConfig({},{}).persistentIdentity.enabled,false);
  assert.equal(normalizeIdentityConfig({ enabled:true,worldProfileId }).mode,'shadow');
  for (const value of [{enabled:1},{enabled:true},{worldProfileId:'save1'},{mode:'fuzzy'},{pipeName:'../game'},
    {prepareTimeoutMs:1001},{prepareTimeoutMs:0},{trustedNamespaces:['arbitrary']},{sourceContractVersion:99}]) assert.throws(() => normalizeIdentityConfig(value));
});

test('runtime binding publication requires native currency and compare-and-delete cannot remove a replacement binding', () => {
  const bindings = new RuntimeBindings(), proof = claim(), session = identity(), record = { characterId:claim().incarnationId };
  assert.equal(bindings.bind(session,proof,record,() => false).binding,null);
  const first = bindings.bind(session,proof,record,() => true).binding;
  assert.equal(bindings.bind(identity('92'),claim(),record,() => true).reason,'character_already_active');
  assert.equal(bindings.retire({ ...first,bindingId:claim().incarnationId }),false);
  assert.equal(bindings.retire(first),true);
  const next = bindings.bind(session,claim(),record,() => true).binding;
  assert.equal(bindings.retire(first),false);
  assert.deepEqual(bindings.revoke({ ...proof,pedId:'17' }),[]);
  assert.equal(bindings.get(next),next);
});

test('optional identity signatures fail closed without relaxing the mandatory playback pins', async () => {
  const bytes = await readFile(new URL('../docs/session-identity-native-metadata.json',import.meta.url));
  assert.equal((await verifyIdentityContract()).available,true);
  assert.equal((await verifyIdentityContract(IDENTITY_DLL_SHA256,Buffer.from(bytes+' '))).available,false);
  const evidence = JSON.parse(bytes);
  evidence.types.find(type => type.name.endsWith('IIntegration')).methods.push({ name:'EnrichActor',returns:'Void',parameters:['Rage.Ped','LosSantosAlive.Context.ActorContext'] });
  assert.throws(() => validateIdentityEvidence(evidence,IDENTITY_DLL_SHA256),/signature/);
});

test('native claim survives real Essential actor hydration/normalization and remains namespaced; forged capabilities/ped are inert', async () => {
  const h = await stockHarness();
  h.context.claimFromAddon = JSON.parse(await readFile(new URL('fixtures/native-identity-claim.json',import.meta.url),'utf8')).claim;
  const normalized = h.evaluate('ia({exists:true,pedId:"17",roleName:"Civilian",integrations:{sessionIdentity:claimFromAddon}},"speaker")');
  assert.deepEqual(JSON.parse(JSON.stringify(normalized.integrations.sessionIdentity)),h.context.claimFromAddon);
  assert.equal(normalized.pedId,'17');
  h.context.normalizedActor = normalized;
  const hydrated = h.evaluate('eo(normalizedActor,"speaker")');
  assert.deepEqual(JSON.parse(JSON.stringify(hydrated.integrations.sessionIdentity)),h.context.claimFromAddon);
  const capabilities = JSON.stringify(normalized.actionCapabilities);
  for (const bad of [null,[],{schemaVersion:99,pedId:'92',roleName:'Police Officer',isArmed:true,actionCapabilities:{arbitrary:true},claim:{pedId:'93'}}]) {
    h.context.forgedBlock = bad;
    const rejected = h.evaluate('ia({exists:true,pedId:"17",roleName:"Civilian",integrations:{sessionIdentity:forgedBlock}},"speaker")');
    assert.equal(rejected.pedId,'17'); assert.equal(rejected.roleName,'Civilian');
    assert.equal(JSON.stringify(rejected.actionCapabilities),capabilities);
    assert.equal(actorClaim(rejected,{worldProfileId}).claim,null);
  }
});

test('bootstrap disables only optional identity on unsupported contracts; Gemini never enters identity services', async t => {
  const dir = await directory(t), configPath = path.join(dir,'e1.config.json');
  await writeFile(configPath,JSON.stringify({persistentIdentity:{enabled:true,worldProfileId,storePath:path.join(dir,'registry.json')}}));
  const unavailable = await createRuntimeForBundle({configPath,env:{},identityContract:{available:false},enableTelemetry:false});
  assert.equal(unavailable.identityService,null); assert.equal(unavailable.config.persistentIdentity.enabled,false);
  const available = await createRuntimeForBundle({configPath,env:{},identityContract:await verifyIdentityContract(),identityEvidence:new TestOwnerEvidence(),enableTelemetry:false});
  assert.ok(available.identityService); available.identityService.close();
  const gemini = createRuntime(normalizeConfig({provider:'gemini',persistentIdentity:{enabled:true,worldProfileId}},{}),{identityEvidence:{verify(){throw new Error('Gemini identity must not run');}}});
  assert.equal(gemini.identityService,null);
});
