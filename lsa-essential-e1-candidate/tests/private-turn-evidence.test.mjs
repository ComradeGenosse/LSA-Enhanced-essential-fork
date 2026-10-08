import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntime } from '../src/integration/essentialGlue.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { withoutCharacterTransport } from '../src/characters/characterService.mjs';

test('private actor capture and owner namespaces are stripped even with optional services disabled',()=>{
  const proof={version:1,captureRef:'PRIVATE_CAPTURE',encounterId:'PRIVATE_ENCOUNTER'};
  const actor={pedId:'17',name:'Civilian',turnKnowledge:proof,sessionIdentity:proof,characterProfile:proof,
    integrations:{turnKnowledge:proof,sessionIdentity:proof,characterProfile:proof,ordinary:{capability:'kept'},raw:{turnKnowledge:proof,sessionIdentity:proof,characterProfile:proof,ordinary:'kept'}}};
  const original=JSON.stringify(actor);
  for(const provider of ['openai','gemini']) {
    const runtime=createRuntime(normalizeConfig({provider,persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},{}));
    const clean=runtime.modelActor(actor);
    assert.equal(JSON.stringify(clean).includes('PRIVATE_'),false);
    assert.equal(clean.integrations.ordinary.capability,'kept');assert.equal(clean.integrations.raw.ordinary,'kept');
    assert.equal(JSON.stringify(actor),original);
  }
});

test('stripping retains ordinary actor identity and treats unsupported blocks as private',()=>{
  const actor={pedId:'17',integrations:{ordinary:{value:1}}};assert.equal(withoutCharacterTransport(actor),actor);
  for(const evidence of [null,'forged',[],{version:99},false]) {
    const clean=withoutCharacterTransport({...actor,integrations:{...actor.integrations,turnKnowledge:evidence,raw:{turnKnowledge:evidence}}});
    assert.equal(Object.hasOwn(clean.integrations,'turnKnowledge'),false);
    assert.equal(Object.hasOwn(clean.integrations.raw,'turnKnowledge'),false);
  }
});

import { stockHarness } from './stock-harness.mjs';
test('rebuilt Essential prompt path strips reserved capture namespaces for both providers',async()=>{
  for(const provider of ['openai','gemini']) {
    const harness=await stockHarness(provider,{config:{persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}}});
    harness.context.privateActor={pedId:'17',roleName:'Civilian',turnKnowledge:{captureRef:'PRIVATE_CAPTURE'},integrations:{turnKnowledge:{captureRef:'PRIVATE_CAPTURE'},characterProfile:{encounterId:'PRIVATE_ENCOUNTER'},sessionIdentity:{ownerAlias:'PRIVATE_OWNER'},raw:{turnKnowledge:{captureRef:'PRIVATE_RAW'}}}};
    harness.evaluate('ET=()=>"fixture system instruction"');
    const prompt=harness.evaluate('BK(privateActor,null,"conversation",{gameTime:"noon",weather:"clear"})');
    for(const value of ['PRIVATE_CAPTURE','PRIVATE_ENCOUNTER','PRIVATE_OWNER','PRIVATE_RAW','turnKnowledge','sessionIdentity']) assert.equal(JSON.stringify(prompt).includes(value),false);
  }
});
