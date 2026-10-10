import {renderKnowledge} from '../src/context/knowledgeRenderer.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,profile } from './p2-fixtures.mjs';
import { actor,identity } from './identity-fixtures.mjs';
import { buildRequest } from '../src/context/essentialDecision.mjs';
import { validateStockDecision } from '../src/context/decisionValidator.mjs';
import { Telemetry } from '../src/observability/telemetry.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { decide } from '../src/openai/decide.mjs';

test('player-authored canon outranks generated Persona while only qualified objective affordances reach the frame',async t => {
  const f = await fixture(t,{config:{actingEnabled:true}});
  const p = await f.store.create(profile({name:'Nathan JustNate',biography:'Criminal contract killer.',
    personality:{description:'Fearless, loyal, and willing to fight with the player.',traits:['extremely loyal','comfortable using violence']},
    relationship:{state:'trusted',description:'Has committed crimes with the player since childhood.'},
    playerNotes:'PRIVATE PLAYER NOTES'}));
  const sourceActor = actor('17',null,{personaDescription:'Ordinary cautious civilian',archetypeDescription:'Timid civilian',personaName:'Cautious Persona',archetypeName:'Civilian',
    emotionalState:'Afraid',currentActivity:'Taking cover',restrained:false,availableWeapons:['Pistol']});
  const voice = f.voice.resolve(identity(),sourceActor);
  const turn = {identity:identity(),source:'player_text',speechProfile:voice,knowledgeFramePreparation:true,context:{actor:sourceActor,listener:null,world:{streetName:'Forum Dr'},systemInstruction:'Base runtime instruction'}};
  await f.service.prepareTurn(turn,{resolution:{kind:'persistent',characterId:p.characterId}},voice);

  const projected = turn.context.actor;
  assert.equal(projected.characterProfile.authority,'player_authored');
  assert.equal(projected.characterProfile.profileRevision,p.revision);
  assert.equal(projected.characterProfile.canon.name,'Nathan JustNate');
  assert.ok(!('personaDescription' in projected)); assert.ok(!('archetypeDescription' in projected));
  assert.ok(!('personaName' in projected)); assert.ok(!('archetypeName' in projected)); assert.ok(!('roleName' in projected));
  assert.deepEqual(projected.availableWeapons,['Pistol']);
  assert.equal(projected.emotionalState,'Afraid'); assert.equal(projected.currentActivity,'Taking cover');
  assert.equal(turn.speechProfile.voice,voice.voice);
  assert.match(turn.speechProfile.instructions,/willing to fight with the player/);
  assert.match(turn.speechProfile.instructions,/dialogue words are fixed/);

  const frame=renderKnowledge({profile:turn.characterProjection.profile,persistent:true,actor:projected,listener:null,world:turn.context.world,source:'player_text',input:'Will you fight with me?',history:[]});
  const request = buildRequest({knowledgeProjection:frame,model:'test',effort:'low',systemInstruction:turn.context.systemInstruction,actor:projected,listener:null,
    world:turn.context.world,source:'player_text',input:'Will you fight with me?',history:[]});
  const finalSystem = request.input[0].content;
  assert.match(finalSystem,/player-authored promoted-character canon is authoritative/i);
  assert.equal(projected.characterProfile.generatedPersonaPolicy,'suppressed');
  assert.match(finalSystem,/Do not reinterpret\s+inability as moral unwillingness/i);
  assert.match(finalSystem,/Nathan JustNate/); assert.match(finalSystem,/Fearless, loyal/);
  assert.doesNotMatch(finalSystem,/emotionalState|Afraid|Taking cover/);
  assert.equal(finalSystem.split('Nathan JustNate').length-1,1);
  assert.ok(!finalSystem.includes(p.characterId));
  assert.match(finalSystem,/pistol/i); assert.doesNotMatch(finalSystem,/Ordinary cautious civilian|PRIVATE PLAYER NOTES/);
});

test('character willingness never adds weapon or target capability and validator remains authoritative',async t => {
  const f = await fixture(t),p = await f.store.create(profile({personality:{description:'Willing to attack the target.',traits:['fearless']}}));
  const sourceActor = actor('17',null,{personaDescription:'Cautious civilian',emotionalState:'Afraid',availableWeapons:['Pistol'],nearbyPersonReferences:{P001:'23'}});
  const turn = {identity:identity(),context:{actor:sourceActor,listener:null,world:{},systemInstruction:'base'}};
  await f.service.prepareTurn(turn,{resolution:{kind:'persistent',characterId:p.characterId}},null);
  const canonicalActor = turn.context.actor;
  const decision = {dialogue:'I am willing, but I need a weapon.',command:'DO AttackTargetWithWeapon P001 USING Pistol'};
  const common = {identity:identity(),actor:canonicalActor,referenceSnapshot:{persons:{P001:'23'},vehicles:{}},
    parseActions:()=>[{actionName:'attacktargetwithweapon',target:'P001',parameter:'Pistol'}],
    allowedActionNames:new Set(['attacktargetwithweapon']),resolvePerson:ref=>ref==='P001'};
  assert.equal(validateStockDecision(decision,common).actionCount,1);
  assert.throws(()=>validateStockDecision(decision,{...common,actor:{...canonicalActor,availableWeapons:[]}}),/weapon/);
  assert.throws(()=>validateStockDecision(decision,{...common,allowedActionNames:new Set()}),/available to this actor/);
  assert.throws(()=>validateStockDecision(decision,{...common,referenceSnapshot:{persons:{},vehicles:{}}}),/target/);
  const restrained = {...canonicalActor,restrained:true,availableWeapons:['Pistol']};
  assert.equal(restrained.restrained,true);
  assert.equal(restrained.characterProfile.canon.personality.description,'Willing to attack the target.');
  assert.throws(()=>validateStockDecision(decision,{...common,actor:restrained,allowedActionNames:new Set()}),/available to this actor/);
  assert.match(turn.context.systemInstruction,/current temporary state for this moment only/i);
  assert.match(turn.context.systemInstruction,/without redefining\s+durable canon/i);
});

test('canon diagnostics identify projection without recording profile text',async t => {
  const f = await fixture(t),rows=[];
  const p = await f.store.create(profile({name:'Private Canon Name',biography:'PRIVATE BIOGRAPHY',personality:{description:'PRIVATE PERSONALITY',traits:['PRIVATE TRAIT']},playerNotes:'PRIVATE NOTES'}));
  f.service.telemetry = new Telemetry({sink:{emit(row){rows.push(row);return true;}}});
  const turn = {identity:identity(),source:'player_text',context:{actor:actor('17',null,{personaDescription:'private generated persona'}),listener:null,world:{},systemInstruction:'PRIVATE BASE PROMPT'}};
  await f.service.prepareTurn(turn,{resolution:{kind:'persistent',characterId:p.characterId}},null);
  const row = rows.find(item=>item.event==='character_canon_projected');
  assert.ok(row); assert.equal(row.data.generatedPersonaPolicy,'suppressed'); assert.ok(row.data.canonHash); assert.ok(row.data.systemPromptHash); assert.ok(row.data.runtimePromptHash);
  assert.ok(row.data.bytes > 0); assert.equal(row.data.profileRevision,p.revision);
  const safe = JSON.stringify(row); for (const secret of ['Private Canon Name','PRIVATE BIOGRAPHY','PRIVATE PERSONALITY','PRIVATE TRAIT','PRIVATE NOTES','private generated persona']) assert.ok(!safe.includes(secret));
});

test('actual reasoning request receives a content-free provenance hash',async () => {
  const rows=[],config=normalizeConfig({}, {OPENAI_API_KEY:'test-key'}),telemetry=new Telemetry({sink:{emit(row){rows.push(row);return true;}}}),id=identity();
  const metrics=telemetry.beginTurn(id,'player_text');
  await decide({config,context:{systemInstruction:'private system',actor:{characterProfile:{authority:'player_authored',profileRevision:7}},listener:null,world:{}},
    input:'private current input',history:[{role:'user',content:'private history'}],source:'player_text',signal:new AbortController().signal,telemetry:metrics,
    fetchImpl:async()=>new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"dialogue":"Ready.","command":""}'}]}]}),{status:200,headers:{'content-type':'application/json'}})});
  const row=rows.find(item=>item.event==='character_reasoning_request_composed');
  assert.ok(row); assert.equal(row.data.profileRevision,7); assert.match(row.data.finalReasoningRequestHash,/^[a-f0-9]{64}$/);
  const serialized=JSON.stringify(row); for (const secret of ['private system','private current input','private history']) assert.ok(!serialized.includes(secret));
});

test('LSA_PROMPT_AUDIT is opt-in and prints the complete assembled request context',() => {
  const before = process.env.LSA_PROMPT_AUDIT,original = console.info,rows=[];
  try {
    delete process.env.LSA_PROMPT_AUDIT; console.info=(...args)=>rows.push(args.join(' '));
    const options={model:'test',effort:'low',systemInstruction:'FINAL SYSTEM',actor:{characterProfile:{authority:'player_authored'}},listener:{id:'player'},world:{weather:'clear'},contextText:'WORLD TEXT',internalEvent:'EVENT',source:'special_event',input:'secret current input',history:[{role:'assistant',content:'secret history'}]};
    buildRequest(options); assert.equal(rows.length,0,'audit output is disabled by default');
    process.env.LSA_PROMPT_AUDIT='true'; buildRequest(options);
  } finally {
    console.info=original;
    if (before===undefined) delete process.env.LSA_PROMPT_AUDIT; else process.env.LSA_PROMPT_AUDIT=before;
  }
  assert.equal(rows.length,1); for (const expected of ['FINAL SYSTEM','secret history','No player utterance was received']) assert.ok(rows[0].includes(expected));
  for(const excluded of ['player_authored','WORLD TEXT','EVENT','secret current input'])assert.ok(!rows[0].includes(excluded));
});
