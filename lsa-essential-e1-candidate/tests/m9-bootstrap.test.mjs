// Production bootstrap (createRuntimeForBundle) with the real pipe parser, PS2,
// M3, P2 SQLite and the Director pump. Only the GTA pipe peer is simulated.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {randomUUID as id} from 'node:crypto';
import {createRuntimeForBundle} from '../src/bootstrap.mjs';
import {CAPABILITIES} from '../src/perception/contracts.mjs';
import {verifyPerceptionContract} from '../tools/verifyPerceptionContract.mjs';
import {IDENTITY_DLL_SHA256,IDENTITY_METADATA_SHA256} from '../src/identity/nativeSupport.mjs';
import {CHARACTER_METADATA_SHA256} from '../src/characters/nativeSupport.mjs';
import {worldProfileId,TestOwnerEvidence} from './identity-fixtures.mjs';
import {profile} from './p2-fixtures.mjs';

const hop = () => new Promise(r => setImmediate(() => setImmediate(r)));
const UP = {'ps1.producers':'on','ps2.observations':'on','ps3.salience':'on','memory.dialogue.player':'off',
  'memory.dialogue.npc':'off','memory.events':'on','memory.coverage':'off','ps6.speech':'on'};

async function fixture(t,{caps = {},spontaneous = 'experimental',negotiate = true,legacy = false} = {}) {
  const root = await mkdtemp(path.join(tmpdir(),'m9-bootstrap-'));
  let runtime = null;
  t.after(async () => {await runtime?.dispose();await rm(root,{recursive:true,force:true});});
  const configPath = path.join(root,'config.json');
  await writeFile(configPath,JSON.stringify({provider:'openai',intelligence:{mode:'shadow'},
    persistentIdentity:{enabled:true,worldProfileId,storePath:path.join(root,'identity.json')},
    promotedCharacters:{enabled:true,storageMode:'sqlite',sqliteStorePath:path.join(root,'p2.sqlite'),
      storePath:path.join(root,'profiles.json')},
    spontaneousSpeech:{mode:spontaneous},
    ...(legacy ? {} : {memoryK:{capabilities:{...UP,...caps}}})}));
  let socket, streamId = id(), adapterEpoch = id(), seq = 0, clock = 1_000_000;
  const host = {hostContextVersion:1,hostRunId:id(),worldEpoch:1};
  runtime = await createRuntimeForBundle({configPath,env:{},enableTelemetry:false,startCharacterEditor:false,
    identityEvidence:new TestOwnerEvidence(),
    identityContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,
      metadataSha256:IDENTITY_METADATA_SHA256,nativeProtocolChanged:false},
    characterContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,
      metadataSha256:CHARACTER_METADATA_SHA256,nativeProtocolChanged:false},
    perceptionContract:await verifyPerceptionContract(),
    fetchImpl:() => {throw new Error('unexpected_provider_call');},
    intelligenceOptions:{now:() => clock,report:() => {},connect:() => {
      socket = new EventEmitter();socket.write = () => true;
      socket.destroy = () => {if (socket.destroyed) return;socket.destroyed = true;socket.emit('close');};
      return socket;
    }}});
  const store = runtime.characterService.store;
  const npc = await store.create(profile()), ref = id(), incarnationId = id(), encounterId = id(),
    player = id(), vehicle = id();
  const raw = async f => {socket.emit('data',Buffer.from(JSON.stringify(f) + '\n'));await hop();};
  const send = (type,payload) => raw({version:1,type,adapterEpoch,streamId,sequence:++seq,payload});
  const anchors = () => send('anchors',[{captureRef:ref,kind:'ped',observer:true,owned:true},
    {captureRef:player,kind:'player',observer:false},{captureRef:vehicle,kind:'vehicle',observer:false}]);
  const establish = async () => {
    await raw({version:1,type:'hello',adapterEpoch,streamId,...host,observerIndexVersion:1,
      ...(negotiate ? {m9SampleVersion:1} : {}),
      capabilities:Object.fromEntries(CAPABILITIES.map(k => [k,k !== 'playerSpeech']))});
    await anchors();
    await send('observer_index',[{captureRef:ref,kind:'ped',owned:true,incarnationId,encounterId}]);
  };
  await establish();
  const timelineId = await store.createTimeline({label:'M9 bootstrap'});
  await store.confirmTimeline(timelineId);
  const owner = () => send('memory_authority',{memoryProofVersion:1,hostRunId:host.hostRunId,worldEpoch:1,
    sampledGameTick:clock,owners:[{ownerAlias:npc.promotion.ownerAlias,observerCaptureRef:ref,
      hostRunId:host.hostRunId,worldEpoch:1,incarnationId,encounterId,sampledGameTick:clock}],
    protagonist:null,acceptedTurns:[]});
  const sample = async (vehicleState = {},{receipt = null,witness = true} = {}) => {
    clock += 100;
    if (clock % 1000 === 0) await anchors();
    await owner();
    await send('m9_sample',{m9SampleVersion:1,hostRunId:host.hostRunId,worldEpoch:1,sampledGameTick:clock,
      ageMs:0,playerCaptureRef:player,vehicleCaptureRef:vehicle,wantedLevel:0,
      vehicle:{airborne:false,inWater:false,submerged:false,grounded:true,rollDegrees:0,speedKph:60,
        collision:receipt,...vehicleState},outcome:null,
      witnessReceipts:witness ? [{observer:{captureRef:ref,kind:'ped'},status:'witnessed',sampledGameTick:clock,
        reason:'visual_clear',knowsSource:false,knowsTarget:false,
        evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:clock}}] : []});
    for (let i = 0; i < 6; i++) await hop();
  };
  const collision = (damage = 60,nativeReceiptId = id()) =>
    ({nativeReceiptId,sourceType:'damage_tracker_vehicle_collision',damage});
  const events = () => store.readJournalEvents({characterId:npc.characterId,timelineId});
  return {runtime,store,npc,timelineId,sample,collision,events,
    async reconnect() {socket.destroy();streamId = id();adapterEpoch = id();seq = 0;
      runtime.intelligence.start();await establish();await store.confirmTimeline(timelineId);},
    diag:() => runtime.services.memoryKRuntimeDiagnostics().capabilities};
}

test('M9 is inert by default: legacy config builds no M9 runtime and ignores samples',async t => {
  const f = await fixture(t,{legacy:true,negotiate:true});
  assert.equal(f.runtime.m9Events ?? null,null);
  assert.equal(f.runtime.m9Callbacks ?? null,null);
  await f.sample();await f.sample({},{receipt:f.collision()});
  assert.equal((await f.events()).length,0);
  assert.equal(f.diag()['events.crash'].requestedMode,'off');
});

test('explicit events.crash journals through the production bootstrap; callbacks stay off unless requested',async t => {
  const f = await fixture(t,{caps:{'events.crash':'on'}});
  assert.ok(f.runtime.m9Events);
  assert.equal(f.runtime.m9Callbacks ?? null,null,'callbacks are separately requested');
  await f.sample();await f.sample({},{receipt:f.collision()});
  const rows = await f.events();
  assert.equal(rows.length,1);
  assert.equal(rows[0].eventType,'vehicle_crash');
  assert.equal(f.diag()['events.crash'].state,'operational');
  assert.equal(f.diag()['events.rollover'].requestedMode,'off');
  assert.equal(f.diag()['memory.callbacks'].requestedMode,'off');
});

test('families are independent: crash on, wasted off ignores outcome candidates',async t => {
  const f = await fixture(t,{caps:{'events.crash':'on','events.wasted':'off'}});
  await f.sample();await f.sample({},{receipt:f.collision()});
  assert.equal((await f.events()).length,1);
  assert.equal(f.runtime.m9Events.snapshot().modes.wasted,'off');
});

test('a companion reconnect that re-presents the same native receipt does not duplicate it',async t => {
  const f = await fixture(t,{caps:{'events.crash':'on'}});
  const receipt = f.collision();
  await f.sample();await f.sample({},{receipt});
  assert.equal((await f.events()).length,1);
  await f.reconnect();
  await f.sample();await f.sample({},{receipt});await f.sample({},{receipt});
  assert.equal((await f.events()).length,1);
  assert.ok((f.runtime.m9Events.snapshot().counters.replaysBlocked ?? 0) >= 1);
});

test('callbacks wire into the Director pump only when requested, and stop with the runtime',async t => {
  const f = await fixture(t,{caps:{'events.crash':'on','memory.callbacks':'on'}});
  assert.ok(f.runtime.m9Callbacks,'wrapped coordinator is installed for the pump');
  assert.equal(f.runtime.m9Callbacks.mode,'on');
  assert.equal(f.diag()['memory.callbacks'].requestedMode,'on');
  await f.runtime.dispose();
  assert.equal(f.diag()['memory.callbacks'].effectiveMode,'off');
  assert.equal(f.diag()['events.crash'].effectiveMode,'off');
});

test('callbacks requested in shadow mode never become on, and need the Director pump',async t => {
  const shadow = await fixture(t,{caps:{'events.crash':'on','memory.callbacks':'shadow'}});
  assert.equal(shadow.runtime.m9Callbacks.mode,'shadow');
  const noPump = await fixture(t,{caps:{'events.crash':'on','memory.callbacks':'on'},spontaneous:'off'});
  assert.equal(noPump.runtime.m9Callbacks ?? null,null,'no spontaneous speech => no callback runtime');
  assert.equal((noPump.diag()['memory.callbacks']).state,'blocked');
});

test('learned-memory pause stops M9 journaling and revokes callbacks',async t => {
  const f = await fixture(t,{caps:{'events.crash':'on','memory.callbacks':'on'}});
  await f.sample();await f.sample({},{receipt:f.collision()});
  assert.equal((await f.events()).length,1);
  f.runtime.memoryPause.pause();
  await f.sample({},{receipt:f.collision()});
  assert.equal((await f.events()).length,1,'no new write after pause');
  assert.equal(f.diag()['events.crash'].state,'paused');
  assert.equal(f.diag()['memory.callbacks'].state,'paused');
});
