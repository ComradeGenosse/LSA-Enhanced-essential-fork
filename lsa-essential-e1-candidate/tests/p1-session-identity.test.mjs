import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { stockHarness } from './stock-harness.mjs';
import { claim, actor, worldProfileId, directory, TestOwnerEvidence } from './identity-fixtures.mjs';
import { VoiceResolver } from '../src/voice/voiceResolver.mjs';
import { normalizeConfig } from '../src/config/e1Config.mjs';
import { Telemetry } from '../src/observability/telemetry.mjs';

async function fixture(t, { config = {}, mode = 'voices', enabled = true, evidence = new TestOwnerEvidence(), storeBytes = null } = {}) {
  const filePath = path.join(await directory(t), 'registry.json');
  if (storeBytes) await fs.writeFile(filePath, storeBytes);
  const records = [], requests = [], profiles = [];
  const telemetry = new Telemetry({ sink: { emit(record) { records.push(record); return true; } } });
  const h = await stockHarness('openai', { identityEvidence: evidence, telemetry, config: {
    speechVoices: ['nova','onyx','echo'], ...config,
    persistentIdentity: { enabled, mode, worldProfileId, storePath: filePath, prepareTimeoutMs: 1000, ...config.persistentIdentity },
  } });
  h.runtime.services.decide = async options => { requests.push(options); return { dialogue: 'Hello there.', command: '' }; };
  h.runtime.services.speak = async ({ onPcm, speechProfile }) => { profiles.push(speechProfile); await onPcm(new Uint8Array([1,2])); return { bytes: 2 }; };
  t.after(() => { h.runtime.identityService?.close(); });
  return { h, evidence, filePath, records, requests, profiles };
}
async function open(f, pedId = '17', nonce = 1, evidence = f.evidence.register(pedId), extras = {}) {
  const session = await f.h.openAIControllerSession({ pedId, nonce, actorContext: actor(pedId, evidence, extras) });
  session.autoNativeAcks(); return session;
}
async function typed(f, session, extras = {}) {
  const pedId = session.session.pedId;
  f.h.context.identityRequest = { pedId, speaker: session.session.actorContext, text: 'Hello.', ...extras };
  const turn = await f.h.evaluate('ib(identityRequest)');
  const native = { pedId: turn.pedId, turnId: turn.id, generationId: turn.generationId, sessionNonce: session.session.nonce };
  const result = await session.connection.whenSettled(native);
  return { turn, native, result };
}

test('real stock controller recreates character on new ped/session with same ID/voice and empty history; old work stays rejected', async t => {
  const f = await fixture(t);
  const a = await open(f);
  const first = await typed(f,a);
  assert.equal(first.result.status, 'completed');
  const snapshot = a.connection.characterSnapshot, voice = f.profiles[0];
  const oldIncarnation = f.evidence.current.get('17').incarnationId;
  assert.equal(snapshot.resolution.kind, 'persistent'); assert.ok(Object.isFrozen(snapshot));
  assert.equal(f.h.runtime.history.readForSession('17',1).length, 2);
  await f.h.evaluate('Ei("17","test_recreation")');
  assert.equal(f.h.runtime.identityService.bindings.values().length, 0);
  f.evidence.retire('17');
  const b = await open(f,'92',7);
  const second = await typed(f,b);
  assert.equal(second.result.status, 'completed');
  const returning = b.connection.characterSnapshot;
  assert.equal(returning.resolution.characterId, snapshot.resolution.characterId);
  assert.notEqual(returning.bindingId, snapshot.bindingId);
  assert.equal(f.profiles[1].voice, voice.voice); assert.equal(f.profiles[1].profileId, voice.profileId);
  assert.deepEqual(f.requests[1].history, []);
  assert.notEqual(f.evidence.current.get('92').incarnationId, oldIncarnation);
  assert.equal(await f.h.runtime.host.routePinnedEvent({ ...first.native, provider: 'openai', type: 'audio', chunk: new Uint8Array([3,4]) }), false);
  assert.equal(await f.h.runtime.host.routePinnedEvent({ ...first.native, provider: 'openai', type: 'output_transcript', text: 'DO RequestBackup' }), false);
  assert.equal(f.h.runtime.history.acceptPlaybackResult({ ...first.native, playbackSucceeded: true, hadAudio: true, playbackStarted: true }), false);
  assert.equal(f.h.runtime.history.readForSession('17',1).length, 0);
  assert.equal(JSON.stringify(f.requests[0].context).includes('companion.alex'), false);
  assert.ok(a.connection.turnSnapshot.actor.integrations.sessionIdentity, 'complete P0 snapshot retains original evidence privately');
  b.connection.close();
});

test('real sessions reload persisted character/voice only after fresh owner proof after companion restart', async t => {
  const f = await fixture(t); const first = await open(f); await typed(f, first);
  const id = first.connection.characterSnapshot.resolution.characterId, voice = f.profiles[0].voice;
  first.connection.close(); f.h.runtime.identityService.close();
  const freshOwner = new TestOwnerEvidence(); freshOwner.register('93', claim({ adapterEpoch: claim().incarnationId }));
  const { trustedNamespaces, ...publicIdentityConfig } = f.h.runtime.config.persistentIdentity;
  const h = await stockHarness('openai', { identityEvidence: freshOwner, config: {
    speechVoices: ['echo','onyx','nova'], persistentIdentity: publicIdentityConfig,
  } });
  // Pass the public config fields only, never runtime-derived trust settings.
  h.runtime.services.decide = async options => { assert.deepEqual(options.history, []); return { dialogue: 'Returned.', command: '' }; };
  let restoredVoice;
  h.runtime.services.speak = async ({ onPcm,speechProfile }) => { restoredVoice = speechProfile.voice; await onPcm(new Uint8Array([1,2])); return { bytes: 2 }; };
  const next = await h.openAIControllerSession({ pedId: '93', nonce: 1, actorContext: actor('93',freshOwner.current.get('93')) }); next.autoNativeAcks();
  const f2 = { ...f, h, evidence: freshOwner };
  assert.equal(h.runtime.identityService.bindings.values().length, 0);
  assert.equal((await typed(f2,next)).result.status, 'completed');
  assert.equal(next.connection.characterSnapshot.resolution.characterId, id); assert.equal(restoredVoice, voice);
  next.connection.close(); h.runtime.identityService.close();
});

test('identical-looking unregistered ambient actors stay ephemeral with the exact existing voice algorithm', async t => {
  const f = await fixture(t);
  const extras = { pedModel: 'identical', personaName: 'Alex', locationContext: 'same corner' };
  const a = await open(f,'17',1,null,extras); const b = await open(f,'92',7,null,extras);
  await typed(f,a); await typed(f,b);
  for (const [session,index] of [[a,0],[b,1]]) {
    assert.equal(session.connection.characterSnapshot.resolution.kind, 'ephemeral');
    assert.equal(session.connection.characterSnapshot.resolution.characterId, null);
    assert.deepEqual(f.profiles[index], new VoiceResolver(f.h.runtime.config).resolve(session.connection.sessionIdentity, session.session.actorContext));
    session.connection.close();
  }
  await assert.rejects(fs.stat(f.filePath), { code: 'ENOENT' });
});

test('an incompatible stored voice falls back at a fresh session boundary without rewriting the character assignment', async t => {
  const f = await fixture(t,{config:{speechVoices:['ballad']}});
  const first = await open(f); await typed(f,first);
  const saved = await fs.readFile(f.filePath,'utf8');
  const id = first.connection.characterSnapshot.resolution.characterId;
  assert.equal(f.profiles[0].voice,'ballad');
  first.connection.close(); f.h.runtime.identityService.close();
  const evidence = new TestOwnerEvidence(); evidence.register('92');
  const {trustedNamespaces, ...persistentIdentity} = f.h.runtime.config.persistentIdentity;
  const h = await stockHarness('openai',{identityEvidence:evidence,config:{ttsModel:'tts-1',speechVoices:['nova'],persistentIdentity}});
  t.after(() => h.runtime.identityService.close());
  h.runtime.services.decide = async () => ({dialogue:'Returned.',command:''});
  let profile;
  h.runtime.services.speak = async ({onPcm,speechProfile}) => { profile=speechProfile; await onPcm(new Uint8Array([1,2])); return {bytes:2}; };
  const next = await open({...f,h,evidence},'92',7,evidence.current.get('92'));
  assert.equal((await typed({...f,h,evidence},next)).result.status,'completed');
  assert.equal(next.connection.characterSnapshot.resolution.characterId,id);
  assert.equal(profile.voice,'nova'); assert.equal(profile.selectionMode,'deterministic-session');
  assert.equal(await fs.readFile(f.filePath,'utf8'),saved,'the incompatible canonical assignment remains intact');
  next.connection.close();
});

test('simultaneous live claims cannot steal a character binding or merge histories', async t => {
  const f = await fixture(t); const a = await open(f); await typed(f,a);
  const binding = f.h.runtime.identityService.bindings.get(a.connection.sessionIdentity);
  const b = await open(f,'92',7); await typed(f,b);
  assert.equal(f.h.runtime.identityService.bindings.get(a.connection.sessionIdentity).bindingId, binding.bindingId);
  assert.equal(f.h.runtime.identityService.bindings.get(b.connection.sessionIdentity), null);
  assert.ok(f.records.some(row => row.event === 'identity_conflict' && row.data.reason === 'character_already_active'));
  assert.equal(b.connection.closed, true);
  a.connection.close();
});

test('known incarnation mismatch retires the exact stock session/history before any new model work', async t => {
  const f = await fixture(t); const a = await open(f); await typed(f,a);
  f.evidence.register('17', claim()); // Contradictory lifetime inside nonce 1.
  const updatedActor = actor('17', f.evidence.current.get('17'));
  await typed(f,a,{ speaker:updatedActor });
  assert.equal(a.connection.closed, true);
  assert.equal(f.h.evaluate('A.sessionsByPedId.has("17")'), false);
  assert.equal(f.requests.length, 1);
  assert.equal(f.h.runtime.history.readForSession('17',1).length, 0);
  assert.ok(f.records.some(row => row.event === 'identity_conflict' && row.data.reason === 'incarnation_mismatch'));
});

test('owner retirement while reasoning is pending prevents delayed transcript/action/PCM and closes exact native session', async t => {
  const f = await fixture(t); const a = await open(f);
  let release, started;
  const modelStarted = new Promise(resolve => { started = resolve; });
  f.h.runtime.services.decide = async () => { started(); return await new Promise(resolve => { release = resolve; }); };
  f.h.context.identityRequest = { pedId:'17',speaker:a.session.actorContext,text:'Wait.' };
  const turn = await f.h.evaluate('ib(identityRequest)'); await modelStarted;
  f.evidence.retire('17');
  release({ dialogue: 'Too late.', command: 'DO RequestBackup' });
  await a.connection.whenSettled({ pedId:'17',turnId:turn.id,generationId:turn.generationId,sessionNonce:1 });
  assert.equal(a.connection.closed,true); assert.equal(f.profiles.length,0); assert.equal(f.h.actions.length,0);
  assert.equal(f.h.sent.some(message => message.type === 'npcAudioChunk'),false);
  assert.equal(f.h.runtime.history.readForSession('17',1).length,0);
});

test('old nonce detach and incarnation revoke cannot remove a new binding on the same full handle', async t => {
  const f = await fixture(t); const a = await open(f); await typed(f,a);
  const oldClaim = f.evidence.current.get('17');
  await f.h.evaluate('Ei("17","replacement")');
  const b = await open(f,'17',3); await typed(f,b);
  const binding = f.h.runtime.identityService.bindings.get(b.connection.sessionIdentity);
  f.h.runtime.identityService.detach(a.connection.sessionIdentity);
  f.evidence.retire('17',oldClaim);
  assert.equal(f.h.runtime.identityService.bindings.get(b.connection.sessionIdentity).bindingId,binding.bindingId);
  assert.equal(b.connection.closed,false);
  assert.equal(await f.h.runtime.host.retireMatchingSession(a.connection.sessionIdentity),false);
  b.connection.close();
});

test('late storage completion cannot publish a binding/voice into a replacement generation', async t => {
  const f = await fixture(t); const a = await open(f);
  let release, started;
  const enteredStore = new Promise(resolve => { started = resolve; });
  const registry = f.h.runtime.identityService.registry;
  const original = registry.resolveOrCreate.bind(registry);
  registry.resolveOrCreate = async (...args) => { started(); await new Promise(resolve => { release = resolve; }); return original(...args); };
  f.h.context.identityRequest = { pedId:'17',speaker:a.session.actorContext,text:'Old.' };
  const old = await f.h.evaluate('ib(identityRequest)'); await enteredStore;
  const oldPending = a.connection.whenSettled({ pedId:'17',turnId:old.id,generationId:old.generationId,sessionNonce:1 });
  registry.resolveOrCreate = original;
  const next = await typed(f,a,{ text:'New.' });
  const snapshot = a.connection.characterSnapshot;
  release(); await oldPending;
  assert.equal(next.result.status,'completed');
  assert.equal(a.connection.characterSnapshot,snapshot);
  assert.equal(snapshot.nativeIdentity.turnId,next.turn.id);
  assert.equal(f.requests.length,1);
  a.connection.close();
});

test('late owner proof for a superseded turn cannot publish into the current generation', async t => {
  const evidence = new TestOwnerEvidence(); const original = evidence.verify.bind(evidence);
  let release, started, count = 0;
  const enteredProof = new Promise(resolve => { started = resolve; });
  evidence.verify = async (...args) => { if (++count === 1) { started(); await new Promise(resolve => { release = resolve; }); } return original(...args); };
  const f = await fixture(t,{ evidence }); const a = await open(f);
  f.h.context.identityRequest = { pedId:'17',speaker:a.session.actorContext,text:'Old.' };
  const old = await f.h.evaluate('ib(identityRequest)'); await enteredProof;
  const pending = a.connection.whenSettled({ pedId:'17',turnId:old.id,generationId:old.generationId,sessionNonce:1 });
  const next = await typed(f,a,{ text:'New.' });
  const snapshot = a.connection.characterSnapshot; release(); await pending;
  assert.equal(next.result.status,'completed'); assert.equal(a.connection.characterSnapshot,snapshot); assert.equal(f.requests.length,1);
  a.connection.close();
});

for (const storeBytes of ['{broken','{"schemaVersion":2}']) {
  test('unavailable registry keeps ordinary dialogue and the legacy voice usable', async t => {
    const f = await fixture(t,{ storeBytes }); const a = await open(f);
    assert.equal((await typed(f,a)).result.status,'completed');
    assert.equal(a.connection.characterSnapshot.resolution.kind,'ephemeral');
    assert.equal(a.connection.characterSnapshot.resolution.reason,'store_unavailable');
    assert.deepEqual(f.profiles[0],new VoiceResolver(f.h.runtime.config).resolve(a.connection.sessionIdentity,a.session.actorContext));
    assert.equal(await fs.readFile(f.filePath,'utf8'),storeBytes); a.connection.close();
  });
}

test('shadow mode resolves metadata and persists aliases while preserving session voice behavior', async t => {
  const f = await fixture(t,{ mode:'shadow' }); const a = await open(f); await typed(f,a);
  assert.equal(a.connection.characterSnapshot.resolution.kind,'persistent');
  assert.deepEqual(f.profiles[0],new VoiceResolver(f.h.runtime.config).resolve(a.connection.sessionIdentity,a.session.actorContext));
  assert.equal(JSON.parse(await fs.readFile(f.filePath,'utf8')).characters[0].voiceAssignment,null);
  a.connection.close();
});

test('feature disabled performs no owner/store calls and has identical session voice/history behavior', async t => {
  const evidence = new TestOwnerEvidence(); evidence.verify = () => { throw new Error('disabled identity was accessed'); };
  const f = await fixture(t,{ enabled:false,evidence }); const a = await open(f); await typed(f,a);
  assert.equal(f.h.runtime.identityService,null); assert.equal(a.connection.characterSnapshot,null);
  assert.deepEqual(f.profiles[0],new VoiceResolver(f.h.runtime.config).resolve(a.connection.sessionIdentity,a.session.actorContext));
  assert.equal(f.h.runtime.history.readForSession('17',1).length,2);
  await assert.rejects(fs.stat(f.filePath),{ code:'ENOENT' }); a.connection.close();
});

test('late identity availability cannot switch voice within a session', async t => {
  const f = await fixture(t); const a = await open(f,'17',1,null); await typed(f,a);
  const firstVoice = f.profiles[0]; const proof = f.evidence.register('17');
  await typed(f,a,{ speaker:actor('17',proof) });
  assert.equal(a.connection.characterSnapshot.resolution.kind,'persistent'); assert.equal(f.profiles[1],firstVoice);
  assert.equal(JSON.parse(await fs.readFile(f.filePath,'utf8')).characters[0].voiceAssignment,null);
  a.connection.close();
});

test('native identity still rejects wrong ped/turn/generation/nonce with persistent identity enabled', async t => {
  const f = await fixture(t); const a = await open(f); const current = await typed(f,a);
  for (const overrides of [{pedId:'92'},{turnId:'foreign'},{generationId:99},{sessionNonce:99}]) {
    assert.equal(await f.h.runtime.host.routePinnedEvent({ ...current.native,...overrides,provider:'openai',type:'audio',chunk:new Uint8Array([3,4]) }),false);
    assert.equal(f.h.runtime.history.acceptPlaybackResult({ ...current.native,...overrides,playbackSucceeded:true,hadAudio:true,playbackStarted:true }),false);
  }
  a.connection.close();
});

test('identity telemetry drops raw claims, owner aliases and private context', async t => {
  const f = await fixture(t); const proof = f.evidence.register('17',claim({ sourceKey:'PRIVATE_OWNER_PERSON_KEY' }));
  const a = await open(f,'17',1,proof); await typed(f,a);
  const encoded = JSON.stringify(f.records);
  for (const privateData of ['PRIVATE_OWNER_PERSON_KEY',proof.incarnationId,proof.adapterEpoch,'Hello there.']) assert.equal(encoded.includes(privateData),false);
  assert.ok(f.records.some(record => record.event === 'identity_binding_created')); a.connection.close();
});

test('E6 segments and a pre-effect TTS retry keep one frozen persistent speech profile', async t => {
  const f = await fixture(t,{config:{structuredStreamingEnabled:true,earlyTtsEnabled:true,retry:{baseDelayMs:0,maxDelayMs:0}}});
  const a = await open(f), profiles = [];
  f.h.runtime.services.providerStack = { ...f.h.runtime.providerStack, decideStreaming: async ({ onSegment }) => {
    await onSegment({sequence:0,text:'First sentence.'},'dialogue_only');
    await onSegment({sequence:1,text:'Second sentence.'},'dialogue_only');
    return {decision:{dialogue:'First sentence. Second sentence.',command:''},mode:'dialogue_only'};
  } };
  f.h.runtime.services.speak = async ({speechProfile,onPcm}) => {
    profiles.push(speechProfile);
    if (profiles.length === 1) throw Object.assign(new Error('offline temporary failure'),{status:503});
    await onPcm(new Uint8Array([1,2])); return {bytes:2,chunks:1};
  };
  const result = await typed(f,a);
  assert.equal(result.result.status,'completed'); assert.equal(profiles.length,3);
  assert.ok(profiles.every(profile => profile === profiles[0] && Object.isFrozen(profile)));
  assert.equal(profiles[0].selectionMode,'persistent-character');
  assert.equal(f.h.sent.filter(message => message.type === 'npcAudioTurnStart').length,1);
  assert.equal(f.h.sent.filter(message => message.type === 'npcAudioStreamEnded').length,1);
  assert.equal(f.h.runtime.history.readForSession('17',1).filter(message => message.role === 'assistant').length,1);
  assert.equal(f.h.runtime.identityService.bindings.values().length,1,'PlaybackEnded does not retire character binding');
  a.connection.close();
});

test('retirement while tagged audio is authorized sends the exact existing Essential interrupt', async t => {
  const f = await fixture(t); const a = await open(f);
  let firstPcm, release;
  const pcmStarted = new Promise(resolve => { firstPcm = resolve; });
  f.h.runtime.services.speak = async ({onPcm}) => { await onPcm(new Uint8Array([1,2])); firstPcm(); await new Promise(resolve => { release = resolve; }); await onPcm(new Uint8Array([3,4])); return {bytes:4}; };
  f.h.context.identityRequest = {pedId:'17',speaker:a.session.actorContext,text:'Speak.'};
  const turn = await f.h.evaluate('ib(identityRequest)'); await pcmStarted;
  const native = {pedId:'17',turnId:turn.id,generationId:turn.generationId,sessionNonce:1};
  f.evidence.retire('17'); release(); await a.connection.whenSettled(native);
  const interrupts = f.h.sent.filter(message => message.type === 'npcSpeechInterrupted');
  assert.ok(interrupts.some(message => message.turnId === turn.id && message.generationId === turn.generationId && message.pedId === '17'));
  assert.equal(a.connection.closed,true); assert.equal(f.h.actions.length,0);
  assert.equal(f.h.runtime.history.readForSession('17',1).length,0);
});

test('P0 P/V reference fencing still rejects a changed target with persistent character metadata', async t => {
  const f = await fixture(t); const a = await open(f,'17',1,f.evidence.register('17'),{nearbyVehicleReferences:{V001:'beef'}});
  let started, release;
  const modelStarted = new Promise(resolve => { started = resolve; });
  f.h.runtime.services.decide = async () => { started(); await new Promise(resolve => { release = resolve; }); return {dialogue:'Proceed.',command:'DO EnterDriverSeat V001'}; };
  f.h.context.identityRequest = {pedId:'17',speaker:a.session.actorContext,text:'Enter it.'};
  const turn = await f.h.evaluate('ib(identityRequest)'); await modelStarted;
  f.h.useStockActionDispatcher();
  f.h.evaluate('A.activeActor={...A.activeActor,nearbyVehicleReferences:{V001:"cafe"}}');
  release();
  const result = await a.connection.whenSettled({pedId:'17',turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
  assert.notEqual(result.status,'completed'); assert.deepEqual(f.h.actions,[]);
  assert.ok(f.records.some(record => record.event === 'target_changed'));
  a.connection.close();
});

test('contradictory normalized and raw trusted identity blocks retire an already active exact session', async t => {
  const f = await fixture(t), a = await open(f); await typed(f,a);
  const evidence = f.evidence.current.get('17');
  const forged = actor('17',evidence); forged.integrations.raw = {sessionIdentity:{...evidence,sourceKey:'contradictory'}};
  await typed(f,a,{speaker:forged});
  assert.equal(a.connection.closed,true); assert.equal(f.requests.length,1);
  assert.ok(f.records.some(record => record.event === 'identity_conflict' && record.data.reason === 'contradictory_claim'));
});

test('stale owner observation cannot publish a durable binding or access character voice', async t => {
  const evidence = new TestOwnerEvidence();
  evidence.verify = async ped => ({kind:'verified',claim:{...evidence.current.get(ped),observationSequence:1}});
  const f = await fixture(t,{evidence}), a = await open(f); await typed(f,a);
  assert.equal(a.connection.characterSnapshot.resolution.kind,'ephemeral');
  assert.equal(f.h.runtime.identityService.bindings.values().length,0);
  assert.equal(f.profiles[0].selectionMode,'deterministic-session'); a.connection.close();
});

test('preparation timeout does not reset the provider deadline or allow a late identity result to switch speech', async t => {
  const evidence = new TestOwnerEvidence(), original = evidence.verify.bind(evidence);
  let release, providerDeadline;
  evidence.verify = async (...args) => { await new Promise(resolve => { release = resolve; }); return original(...args); };
  const f = await fixture(t,{evidence,config:{persistentIdentity:{prepareTimeoutMs:25},providerWorkDeadlineMs:5000}}), a = await open(f);
  const execute = f.h.runtime.services.executeProvider;
  f.h.runtime.services.executeProvider = args => { providerDeadline ||= args.deadlineAt; return execute(args); };
  const started = performance.now();
  assert.equal((await typed(f,a)).result.status,'completed');
  assert.ok(providerDeadline <= started + 5010);
  const snapshot = a.connection.characterSnapshot, voice = f.profiles[0];
  release(); await new Promise(resolve => setTimeout(resolve,0));
  assert.equal(a.connection.characterSnapshot,snapshot); assert.equal(f.h.runtime.identityService.bindings.values().length,0);
  assert.equal(voice.selectionMode,'deterministic-session'); a.connection.close();
});

test('lost owner channel retires exact sessions; unrelated ephemeral sessions stay usable', async t => {
  const f = await fixture(t), persistent = await open(f); await typed(f,persistent);
  const ambient = await open(f,'92',7,null); await typed(f,ambient);
  f.evidence.close();
  assert.equal(persistent.connection.closed,true); assert.equal(ambient.connection.closed,false);
  assert.equal((await typed(f,ambient)).result.status,'completed'); ambient.connection.close();
});

test('microphone and real special-event hydration resolve fresh actor evidence before provider/history work', async t => {
  const f = await fixture(t), a = await open(f);
  f.h.runtime.services.transcribe = async () => 'Microphone input.';
  const mic = f.h.evaluate(`(() => { const value=Xi({pedId:'17',speakerPedId:'17',listenerPedId:'player',source:Ht.PLAYER_MIC,input:{transcript:'',contextText:''},metadata:{}}); A.mic=ND(); A.mic.activeTurnId=value.id; A.mic.status='listening'; A.mic.pendingChunks=[]; A.mic.sendChain=Promise.resolve(); return value; })()`);
  f.h.context.micHydration = {speaker:a.session.actorContext,target:null,world:{streetName:'Mic street'}};
  f.h.evaluate('Te=()=>{}; hb=()=>{}; OK=false');
  await f.h.evaluate('wd(micHydration)');
  await a.connection.sendRealtimeAudio(new Uint8Array([1,2])); await a.connection.endRealtimeInput();
  assert.equal((await a.connection.whenSettled({pedId:'17',turnId:mic.id,generationId:mic.generationId,sessionNonce:1})).status,'completed');
  assert.equal(a.connection.characterSnapshot.resolution.kind,'persistent');
  const id = a.connection.characterSnapshot.resolution.characterId, voice = f.profiles[0];
  f.h.useStockSpecialHydration({sendInput:true});
  f.h.context.hydrationResponses = {'17':{success:true,speaker:a.session.actorContext,world:{streetName:'Actor street'}},'player':{success:true,speaker:{pedId:'player'},world:{streetName:'Listener street'}}};
  f.h.evaluate('var Nb=1000; Od=async ped=>hydrationResponses[ped]');
  const special = await f.h.evaluate('kb({speakerPedId:"17",listenerPedId:"player",content:"An alarm is sounding."})');
  assert.equal((await a.connection.whenSettled({pedId:'17',turnId:special.id,generationId:special.generationId,sessionNonce:1})).status,'completed');
  assert.equal(a.connection.characterSnapshot.resolution.characterId,id); assert.equal(f.profiles[1],voice);
  assert.equal(f.requests[1].input,''); assert.equal(f.requests[1].context.world.streetName,'Actor street');
  assert.equal(f.h.runtime.history.readForSession('17',1).filter(message => message.role === 'user').length,1);
  a.connection.close();
});
