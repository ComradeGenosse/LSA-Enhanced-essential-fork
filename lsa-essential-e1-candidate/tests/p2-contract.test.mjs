import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fixture } from './p2-fixtures.mjs';
import { identity,actor } from './identity-fixtures.mjs';
import { createRuntimeForBundle } from '../src/bootstrap.mjs';
import { verifyIdentityContract } from '../tools/verifyIdentityContract.mjs';
import { verifyCharactersContract } from '../tools/verifyCharactersContract.mjs';
import { characterContractSupported } from '../src/characters/nativeSupport.mjs';

test('P2 native signatures remain an independent optional pinned contract',async () => {
  const contract = await verifyCharactersContract(),bytes = await readFile(new URL('../docs/promoted-characters-native-metadata.json',import.meta.url));
  assert.equal(characterContractSupported(contract),true);
  assert.equal((await verifyCharactersContract('0'.repeat(64),bytes)).available,false);
  assert.equal((await verifyCharactersContract(undefined,Buffer.from(bytes+' '))).available,false);
  for (const patch of [{metadataSha256:'0'.repeat(64)},{nativeProtocolChanged:true},{requiredGameTarget:'net10.0'},{available:false}]) assert.equal(characterContractSupported({...contract,...patch}),false);
  assert.equal((await verifyIdentityContract()).available,true);
});

test('bootstrap gates native management without losing ambient grounding or changing supported P1 behavior',async t => {
  const f = await fixture(t),configPath = path.join(f.root,'e1.config.json');
  await writeFile(configPath,JSON.stringify({persistentIdentity:{enabled:true,mode:'voices',worldProfileId:f.config.persistentIdentity.worldProfileId,storePath:f.config.persistentIdentity.storePath},promotedCharacters:f.config.promotedCharacters}));
  const options = {configPath,env:{},enableTelemetry:false,startCharacterEditor:false,identityContract:await verifyIdentityContract(),identityEvidence:f.evidence,nativeOwner:f.native,profileStore:f.store};
  const unavailable = await createRuntimeForBundle({...options,characterContract:{available:false}}); t.after(()=>unavailable.identityService.close());
  assert.ok(unavailable.identityService); assert.equal(unavailable.characterService.ready,false);
  const turn = {identity:identity(),context:{actor:actor('17',null),listener:null,systemInstruction:'Essential rules'}};
  await unavailable.characterService.prepareTurn(turn,null,unavailable.voiceResolver.resolve(turn.identity,turn.context.actor));
  assert.ok(turn.context.actor.characterProfile.name); assert.equal(f.native.requests.length,0);
  await assert.rejects(unavailable.characterService.promote(),/profile_store_unavailable/);
  const available = await createRuntimeForBundle({...options,characterContract:await verifyCharactersContract()}); t.after(()=>available.identityService.close());
  assert.equal(available.characterService.ready,true); assert.equal(available.config.persistentIdentity.enabled,true); assert.equal(available.characterEditor,undefined);
});
