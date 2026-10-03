import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fixture,profile } from './p2-fixtures.mjs';
import { actor,identity,worldProfileId,claim } from './identity-fixtures.mjs';
import { ProfileStore } from '../src/characters/profileStore.mjs';
import { validateStore } from '../src/identity/characterStore.mjs';
import { stockHarness } from './stock-harness.mjs';
import { CharacterService } from '../src/characters/characterService.mjs';
import { createRuntime } from '../src/integration/essentialGlue.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { Telemetry } from '../src/observability/telemetry.mjs';
import { isUuid } from '../src/identity/identityContract.mjs';

test('explicit promotion creates exactly one durable profile and is idempotent',async t => {
  const f = await fixture(t),first = await f.service.promote(),second = await f.service.promote();
  assert.equal(first.characterId,second.characterId); assert.equal(f.store.list().length,1); assert.equal(f.native.owned.size,1);
  const restarted = new ProfileStore({filePath:f.store.filePath,worldProfileId}); await restarted.initialize(); assert.deepEqual(restarted.get(first.characterId),first);
  assert.ok(first.promotion.ownerAlias.startsWith('promoted.')); assert.ok(isUuid(first.promotion.ownerAlias.slice(9)));
});
test('similar models and deliberately identical names never merge persistent characters',async t => {
  const f = await fixture(t),first = await f.service.promote(); f.native.selected = f.native.encounter('18'); const second = await f.service.promote();
  assert.notEqual(first.characterId,second.characterId); assert.notEqual(first.promotion.ownerAlias,second.promotion.ownerAlias); assert.equal(first.modelHash,second.modelHash);
  await f.service.edit(first.characterId,{name:'Ray'},1); await f.service.edit(second.characterId,{name:'Ray'},1);
  assert.equal(f.store.list().length,2); assert.notEqual(f.store.list()[0].characterId,f.store.list()[1].characterId);
});
test('promotion copies the real encounter voice into canonical P1 without changing its session',async t => {
  const f = await fixture(t),selected = f.native.selected,native = identity(selected.pedId),a = actor(selected.pedId,null,{integrations:{characterProfile:{encounterId:selected.encounterId}}}),voice = f.voice.resolve(native,a);
  const session = f.service.session(native,a,voice),p = await f.service.promote();
  assert.equal(p.name,session.name); assert.equal(p.voiceReference.voice,voice.voice); assert.equal(f.service.session(native,a).speechProfile.voice,voice.voice);
  const stored = validateStore(JSON.parse(await fs.readFile(f.config.persistentIdentity.storePath,'utf8')),worldProfileId);
  assert.deepEqual(Object.keys(stored).sort(),['characters','registryRevision','schemaVersion','worldProfileId']);
  assert.deepEqual(Object.keys(stored.characters[0]).sort(),['aliases','characterId','createdAtUtc','recordRevision','updatedAtUtc','voiceAssignment']);
  assert.equal(JSON.stringify(stored).includes(session.name),false); assert.equal(JSON.stringify(stored).includes('personality'),false);
});
test('dismissal and explicit recreation preserve CharacterId, durable profile, voice, and edits',async t => {
  const f = await fixture(t),p = await f.service.promote(),original = f.native.owned.get(p.promotion.ownerAlias);
  await f.service.edit(p.characterId,{name:'Returning'},1); await f.service.control(p.characterId,'dismiss'); assert.equal(f.store.list().length,1);
  await f.service.control(p.characterId,'summon'); const recreated = f.native.owned.get(p.promotion.ownerAlias);
  assert.notEqual(recreated.pedId,original.pedId); assert.notEqual(recreated.ownershipToken,original.ownershipToken); assert.notEqual(recreated.claim.incarnationId,original.claim.incarnationId);
  assert.equal(f.store.get(p.characterId).name,'Returning'); assert.deepEqual(f.store.get(p.characterId).voiceReference,p.voiceReference);
  assert.equal((await f.identity.resolveOwnerRegistration(recreated)).characterId,p.characterId);
  await assert.rejects(f.native.request('follow',{ownerAlias:p.promotion.ownerAlias,ownershipToken:original.ownershipToken}),/native_stale/);
});
test('summon binds only through fresh explicit P1 authored proof',async t => {
  const f = await fixture(t),p = await f.service.promote(); await f.service.control(p.characterId,'dismiss');
  const verify = f.evidence.verify.bind(f.evidence); let verified = 0; f.evidence.verify = async (...args) => { verified++; return verify(...args); };
  await f.service.control(p.characterId,'summon'); assert.equal(verified,1);
  const spawned = f.native.requests.find(row => row.operation === 'spawn'); assert.equal(spawned.args.ownerAlias,p.promotion.ownerAlias); assert.ok(!('characterId' in spawned.args));
  assert.ok(!('sessionNonce' in spawned.args)); assert.ok(!('turnId' in spawned.args));
});
test('player control captures an exact owner token instead of addressing effects to CharacterId',async t => {
  const f = await fixture(t),p = await f.service.promote(); await f.service.control(p.characterId,'follow'); await f.service.control(p.characterId,'wait');
  for (const operation of ['follow','wait']) {
    const request = f.native.requests.find(row => row.operation === operation); assert.equal(request.args.ownershipToken,f.native.owned.get(p.promotion.ownerAlias).ownershipToken); assert.ok(!('characterId' in request.args));
  }
});

test('console current-character controls never promote implicitly and reject a replaced selected incarnation',async t => {
  const f = await fixture(t);
  await assert.rejects(f.service.controlCurrent('follow'),/character_not_promoted/); assert.equal(f.store.list().length,0); assert.equal(f.native.owned.size,0);
  const p = await f.service.promote(); await f.service.controlCurrent('follow'); await f.service.controlCurrent('wait');
  const owned = f.native.owned.get(p.promotion.ownerAlias);
  for (const request of f.native.requests.filter(row => ['follow','wait'].includes(row.operation))) {
    assert.equal(request.args.ownershipToken,owned.ownershipToken); assert.equal(request.args.ownerAlias,p.promotion.ownerAlias); assert.ok(!('characterId' in request.args));
  }
  const count = f.native.requests.filter(row => row.operation === 'follow').length,request = f.native.request.bind(f.native);
  f.native.request = async (operation,args) => { const result = await request(operation,args); return operation === 'inspect' ? {...result,encounterId:randomUUID(),ownershipToken:randomUUID()} : result; };
  await assert.rejects(f.service.controlCurrent('follow'),/native_stale/); assert.equal(f.native.requests.filter(row => row.operation === 'follow').length,count);
  await assert.rejects(f.service.controlCurrent('summon'),/invalid_owner_operation/);
});
test('changed selection rejects promotion without a profile or identity record',async t => {
  const f = await fixture(t),request = f.native.request.bind(f.native); f.native.request = async (operation,args) => { const result = await request(operation,args); if (operation === 'capture') f.native.selected = f.native.encounter('18'); return result; };
  await assert.rejects(f.service.promote(),/native_stale/); assert.equal(f.store.list().length,0); await assert.rejects(fs.stat(f.config.persistentIdentity.storePath),{code:'ENOENT'});
});
test('unknown owner proof fails closed and rolls back only the newly owned incarnation',async t => {
  const f = await fixture(t); f.evidence.verify = async () => ({kind:'verified',claim:claim({sourceKey:'different.owner'})});
  await assert.rejects(f.service.promote(),/evidence_unavailable/); assert.equal(f.native.owned.size,0); assert.equal(f.store.list().length,0);
  assert.ok(f.native.requests.some(row => row.operation === 'release'));
});
test('failed profile commit cannot publish a promotion or corrupt the P1 store',async t => {
  const f = await fixture(t); f.store.create = async () => { throw new Error('profile_store_unavailable'); };
  await assert.rejects(f.service.promote(),/profile_store_unavailable/); assert.equal(f.native.owned.size,0);
  assert.equal(validateStore(JSON.parse(await fs.readFile(f.config.persistentIdentity.storePath,'utf8')),worldProfileId).characters.length,1);
});
test('scripted state defers promotion, summon, follow, and deletion without losing profiles',async t => {
  const f = await fixture(t); f.native.scripted = true; await assert.rejects(f.service.promote(),/scripted_state/); f.native.scripted = false;
  const p = await f.service.promote(); f.native.scripted = true;
  for (const operation of ['follow','wait','dismiss','summon']) await assert.rejects(f.service.control(p.characterId,operation),/scripted_state/);
  await assert.rejects(f.service.remove(p.characterId,p.characterId,1),/scripted_state/); assert.equal(f.store.list().length,1);
});
test('unpromotion is explicit, retires the native association, and leaves strict P1 identity intact',async t => {
  const f = await fixture(t),p = await f.service.promote(),bytes = await fs.readFile(f.config.persistentIdentity.storePath,'utf8');
  await assert.rejects(f.service.remove(p.characterId,'yes',1),/explicit_confirmation_required/);
  await f.service.remove(p.characterId,p.characterId,1); assert.equal(f.store.list().length,0); assert.equal(f.native.owned.size,0);
  assert.equal(await fs.readFile(f.config.persistentIdentity.storePath,'utf8'),bytes);
});
test('persistent narration projects edits and selected memories, with no private proof in actor or listener',async t => {
  const f = await fixture(t),p = await f.service.promote(); let edited = await f.service.edit(p.characterId,{name:'Jordan',relationship:{state:'friend',description:'Knows the player'}},1);
  edited = (await f.service.memory(p.characterId,'create',{expectedRevision:edited.revision,patch:{text:'Remember the beach',selectedForContext:true}})).profile;
  const proof = f.native.owned.get(p.promotion.ownerAlias).claim,a = actor('17',proof,{integrations:{sessionIdentity:proof,raw:{sessionIdentity:proof,characterProfile:{encounterId:f.native.selected.encounterId}},characterProfile:{encounterId:f.native.selected.encounterId}}});
  const turn = {identity:identity(),context:{actor:a,listener:a,systemInstruction:'Essential rules'},speechProfile:null};
  await f.service.prepareTurn(turn,{resolution:{kind:'persistent',characterId:p.characterId}},f.voice.resolve(identity(),a));
  assert.equal(turn.context.actor.characterProfile.canon.name,'Jordan'); assert.equal(turn.context.actor.characterProfile.canon.memories[0].text,'Remember the beach');
  const projected = JSON.stringify(turn.context); for (const secret of ['sessionIdentity','adapterEpoch','incarnationId',p.characterId,p.promotion.ownerAlias,f.native.selected.encounterId]) assert.ok(!projected.includes(secret));
  assert.ok(a.integrations.sessionIdentity,'private original snapshot remains intact');
});
test('optional corrupt profiles still permit ambient names and normal ephemeral dialogue context',async t => {
  const f = await fixture(t); const broken = new ProfileStore({filePath:f.store.filePath,worldProfileId}); await fs.writeFile(f.store.filePath,'corrupt');
  const service = new CharacterService(f.config,{identityService:f.identity,voiceResolver:f.voice,store:broken,nativeOwner:f.native}); await service.initialize(); assert.equal(service.ready,false);
  const turn = {identity:identity(),context:{actor:actor('17',null),listener:null,systemInstruction:'Essential rules'}}; await service.prepareTurn(turn,null,f.voice.resolve(identity(),turn.context.actor));
  assert.ok(turn.context.actor.characterProfile.canon.name); await assert.rejects(service.promote(),/profile_store_unavailable/);
});

test('P2 refuses a profile path shared with the strict P1 registry without writing either store',async t => {
  const f = await fixture(t),config = {...f.config,persistentIdentity:{...f.config.persistentIdentity,storePath:f.store.filePath}};
  const service = new CharacterService(config,{identityService:f.identity,voiceResolver:f.voice,store:f.store,nativeOwner:f.native});
  assert.equal(await service.initialize(),false); await assert.rejects(service.promote(),/profile_store_unavailable/); assert.equal(f.native.requests.length,0);
  await assert.rejects(fs.stat(f.store.filePath),{code:'ENOENT'});
});
test('disabled P2 and stock Gemini preserve existing behavior and create no optional service',() => {
  for (const provider of ['openai','gemini']) {
    const runtime = createRuntime(normalizeConfig({provider,promotedCharacters:{enabled:false}},{})); assert.equal(runtime.characterService,null); const a = actor('17',null); assert.equal(runtime.modelActor(a),a);
  }
  const gemini = createRuntime(normalizeConfig({provider:'gemini',promotedCharacters:{enabled:true}},{})); assert.equal(gemini.characterService,null);
});
test('privacy-safe events cannot retain character names, memories, notes, claims, or owner keys',async t => {
  const f = await fixture(t),rows = [],telemetry = new Telemetry({sink:{emit(row){rows.push(row);return true;}}}); f.service.telemetry = telemetry;
  const p = await f.service.promote(); await f.service.memory(p.characterId,'create',{expectedRevision:1,patch:{text:'PRIVATE MEMORY'}});
  f.service.emit('character_profile_edited',{name:p.name,memory:'PRIVATE MEMORY',ownerAlias:p.promotion.ownerAlias,claim:'PRIVATE PROOF',profileRevision:2});
  const text = JSON.stringify(rows); for (const secret of [p.name,'PRIVATE MEMORY','PRIVATE PROOF',p.promotion.ownerAlias]) assert.ok(!text.includes(secret));
  assert.ok(rows.some(row=>row.event==='promotion_completed')); assert.ok(rows.some(row=>row.event==='character_memory_created'));
});

test('real stock controller: promote, edit, dismiss, recreate with new native session; old PCM/actions/history stay rejected',async t => {
  const f = await fixture(t),{trustedNamespaces,...persistentIdentity} = f.config.persistentIdentity;
  const h = await stockHarness('openai',{identityEvidence:f.evidence,nativeOwner:f.native,profileStore:f.store,config:{speechVoices:['nova','onyx','echo'],persistentIdentity,promotedCharacters:f.config.promotedCharacters}});
  await h.runtime.characterService.initialize(); t.after(()=>h.runtime.identityService.close());
  const requests = [],voices = []; h.runtime.services.decide = async options => { requests.push(options); return {dialogue:'Hello.',command:''}; };
  h.runtime.services.speak = async ({onPcm,speechProfile}) => {voices.push(speechProfile);await onPcm(new Uint8Array([1,2]));return {bytes:2};};
  const contextFor = binding => actor(binding.pedId,binding.claim,{integrations:{...(binding.claim?{sessionIdentity:binding.claim}:{}),characterProfile:{version:1,encounterId:binding.encounterId}}});
  const open = async (binding,nonce) => { const s = await h.openAIControllerSession({pedId:binding.pedId,nonce,actorContext:contextFor(binding)});s.autoNativeAcks();return s; };
  const typed = async (s,binding) => {h.context.p2Input={pedId:binding.pedId,speaker:contextFor(binding),text:'Hello.'};const turn=await h.evaluate('ib(p2Input)');const native={pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:s.session.nonce};return {native,result:await s.connection.whenSettled(native)};};
  const ambient = await open(f.native.selected,1),first = await typed(ambient,f.native.selected);assert.equal(first.result.status,'completed');
  const name = requests[0].context.actor.characterProfile.canon.name,p = await h.runtime.characterService.promote(); assert.equal(p.name,name);assert.equal(p.voiceReference.voice,voices[0].voice);
  const owned = f.native.owned.get(p.promotion.ownerAlias); const promoted = await typed(ambient,owned);assert.equal(promoted.result.status,'completed');assert.equal(ambient.connection.characterSnapshot.resolution.characterId,p.characterId);assert.equal(voices[1].voice,voices[0].voice);
  await h.runtime.characterService.edit(p.characterId,{name:'Alex Returned'},1);await h.runtime.characterService.control(p.characterId,'dismiss');assert.equal(ambient.connection.closed,true);
  await h.runtime.characterService.control(p.characterId,'summon');const rebound=f.native.owned.get(p.promotion.ownerAlias),next=await open(rebound,9),second=await typed(next,rebound);assert.equal(second.result.status,'completed');
  assert.equal(next.connection.characterSnapshot.resolution.characterId,p.characterId);assert.equal(requests[2].context.actor.characterProfile.canon.name,'Alex Returned');assert.equal(requests[2].context.actor.characterProfile.profileRevision,2);assert.equal(voices[2].voice,voices[0].voice);assert.deepEqual(requests[2].history,[]);
  assert.equal(await h.runtime.host.routePinnedEvent({...promoted.native,provider:'openai',type:'audio',chunk:new Uint8Array([3,4])}),false);
  assert.equal(await h.runtime.host.routePinnedEvent({...promoted.native,provider:'openai',type:'output_transcript',text:'DO RequestBackup'}),false);
  assert.equal(h.runtime.history.acceptPlaybackResult({...promoted.native,playbackSucceeded:true,hadAudio:true,playbackStarted:true}),false);assert.equal(h.runtime.history.readForSession('17',1).length,0);
  next.connection.close();
});

test('real stock controller keeps dialogue and private-proof filtering when optional profile projection throws',async t => {
  const f = await fixture(t),p = await f.service.promote(),binding = f.native.owned.get(p.promotion.ownerAlias),{trustedNamespaces,...persistentIdentity} = f.config.persistentIdentity;
  const h = await stockHarness('openai',{identityEvidence:f.evidence,nativeOwner:f.native,profileStore:f.store,config:{persistentIdentity,promotedCharacters:f.config.promotedCharacters}});
  t.after(()=>h.runtime.identityService.close()); h.runtime.characterService.prepareTurn = async () => { throw new Error('offline projection failure'); };
  let projected; h.runtime.services.decide = async options => { projected = JSON.stringify(options.context); return {dialogue:'Hello.',command:''}; };
  h.runtime.services.speak = async ({onPcm}) => { await onPcm(new Uint8Array([1,2])); return {bytes:2}; };
  const a = actor(binding.pedId,binding.claim,{integrations:{sessionIdentity:binding.claim,raw:{sessionIdentity:binding.claim,characterProfile:{encounterId:binding.encounterId}},characterProfile:{encounterId:binding.encounterId}}});
  const s = await h.openAIControllerSession({pedId:binding.pedId,nonce:1,actorContext:a}); s.autoNativeAcks();
  h.context.p2Input = {pedId:binding.pedId,speaker:a,text:'Hello.'}; const turn = await h.evaluate('ib(p2Input)');
  assert.equal((await s.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1})).status,'completed');
  for (const secret of ['sessionIdentity','adapterEpoch','incarnationId','encounterId',binding.encounterId,p.characterId,p.promotion.ownerAlias]) assert.ok(!projected.includes(secret));
  s.connection.close();
});

test('real stock controller applies the same promoted canon to microphone and special-event turns',async t => {
  const f = await fixture(t),p = await f.service.promote(),binding = f.native.owned.get(p.promotion.ownerAlias),
    {trustedNamespaces,...persistentIdentity} = f.config.persistentIdentity;
  const h = await stockHarness('openai',{identityEvidence:f.evidence,nativeOwner:f.native,profileStore:f.store,
    config:{persistentIdentity,promotedCharacters:f.config.promotedCharacters}});
  await h.runtime.characterService.initialize(); t.after(()=>h.runtime.identityService.close());
  h.runtime.services.transcribe = async () => 'Will you fight with me?';
  const requests=[];
  h.runtime.services.decide = async options => { requests.push(options); return {dialogue:'I am willing.',command:''}; };
  h.runtime.services.speak = async ({onPcm}) => { await onPcm(new Uint8Array([1,2])); return {bytes:2}; };
  const a = actor(binding.pedId,binding.claim,{personaDescription:'Ordinary cautious civilian',integrations:{sessionIdentity:binding.claim,characterProfile:{encounterId:binding.encounterId}}});
  const s = await h.openAIControllerSession({pedId:binding.pedId,nonce:1,actorContext:a,targetContext:null}); s.autoNativeAcks();
  const mic = h.evaluate(`(() => { const value=Xi({pedId:'${binding.pedId}',speakerPedId:'${binding.pedId}',listenerPedId:'player',source:Ht.PLAYER_MIC,input:{transcript:'',contextText:''},metadata:{}}); A.mic=ND(); A.mic.activeTurnId=value.id; A.mic.status='listening'; A.mic.pendingChunks=[]; A.mic.sendChain=Promise.resolve(); return value; })()`);
  h.context.micHydration = {speaker:a,target:null,world:{streetName:'Mic street'}};
  h.evaluate('Te=()=>{}; hb=()=>{}; OK=false');
  await h.evaluate('wd(micHydration)');
  await s.connection.sendRealtimeAudio(new Uint8Array([1,2])); await s.connection.endRealtimeInput();
  assert.equal((await s.connection.whenSettled({pedId:binding.pedId,turnId:mic.id,generationId:mic.generationId,sessionNonce:1})).status,'completed');
  h.useStockSpecialHydration({sendInput:true});
  h.context.hydrationResponses = {[binding.pedId]:{success:true,speaker:a,world:{streetName:'Actor street'}},player:{success:true,speaker:{pedId:'player'},world:{streetName:'Listener street'}}};
  h.evaluate('var Nb=1000; Od=async ped=>hydrationResponses[ped]');
  const special = await h.evaluate(`kb({speakerPedId:"${binding.pedId}",listenerPedId:"player",content:"An alarm is sounding."})`);
  assert.equal((await s.connection.whenSettled({pedId:binding.pedId,turnId:special.id,generationId:special.generationId,sessionNonce:1})).status,'completed');
  assert.equal(requests.length,2);
  for (const request of requests) {
    assert.equal(request.context.actor.characterProfile.authority,'player_authored');
    assert.equal(request.context.actor.characterProfile.profileRevision,p.revision);
    assert.match(request.context.systemInstruction,/PROMOTED CHARACTER AUTHORITY/);
    assert.match(request.context.systemInstruction,/player-authored promoted-character canon is authoritative/i);
    assert.ok(!('personaDescription' in request.context.actor));
  }
  assert.equal(requests[0].source,'player_mic'); assert.equal(requests[1].source,'special_event');
  s.connection.close();
});
