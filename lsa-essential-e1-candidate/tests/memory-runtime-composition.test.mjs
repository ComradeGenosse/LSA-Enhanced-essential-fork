import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {EventEmitter} from 'node:events';
import {RuntimeResourceScope,createMemoryKRuntimeComposition,memoryKConsumersAllowed} from '../src/memory/runtimeComposition.mjs';
import {createRuntimeForBundle} from '../src/bootstrap.mjs';
import {verifyPerceptionContract} from '../tools/verifyPerceptionContract.mjs';
import {IDENTITY_DLL_SHA256,IDENTITY_METADATA_SHA256} from '../src/identity/nativeSupport.mjs';
import {CHARACTER_METADATA_SHA256} from '../src/characters/nativeSupport.mjs';
import {worldProfileId,TestOwnerEvidence} from './identity-fixtures.mjs';

async function bundle(t,config={},options={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'memory-k-composition-'));
  t.after(()=>rm(directory,{recursive:true,force:true}));
  const configPath=path.join(directory,'config.json');
  await writeFile(configPath,JSON.stringify({persistentIdentity:{enabled:false},promotedCharacters:{enabled:false},...config}));
  return {directory,options:{configPath,env:{},enableTelemetry:false,startCharacterEditor:false,
    fetchImpl:()=>{throw new Error('external_effect_forbidden');},...options}};
}
const contracts={identityContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,
  metadataSha256:IDENTITY_METADATA_SHA256,nativeProtocolChanged:false},
  characterContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,
    metadataSha256:CHARACTER_METADATA_SHA256,nativeProtocolChanged:false}};

test('scope closes in reverse acquisition order and repeated disposal shares one completion',async()=>{
  const scope=new RuntimeResourceScope(),calls=[];
  scope.starting('store');assert.equal(scope.snapshot().resources.store.state,'starting');
  scope.own('store',{},()=>calls.push('store'));
  scope.own('consumer',{},()=>calls.push('consumer'));
  const first=scope.dispose(),second=scope.dispose();assert.equal(first,second);
  assert.deepEqual((await first).failures,[]);assert.deepEqual(calls,['consumer','store']);
  assert.equal(scope.snapshot().ownedResources,0);
  assert.throws(()=>scope.own('late',{},()=>{}),/runtime_scope_stopped/);
});
test('partial startup rollback preserves an already operational sibling',async()=>{
  const scope=new RuntimeResourceScope(),calls=[];
  scope.own('sibling',{},()=>calls.push('sibling'));
  const checkpoint=scope.checkpoint();scope.starting('broken');
  scope.own('partial',{},()=>calls.push('partial'));
  await scope.rollback(checkpoint);scope.failed('broken');
  assert.equal(scope.snapshot().resources.sibling.state,'operational');
  assert.equal(scope.snapshot().resources.broken.state,'failed');
  assert.deepEqual(calls,['partial']);await scope.dispose();assert.deepEqual(calls,['partial','sibling']);
});
test('disposal failure remains visible and does not prevent other resource cleanup',async()=>{
  const scope=new RuntimeResourceScope(),calls=[];
  scope.own('store',{},()=>calls.push('store'));
  scope.own('broken',{},()=>{throw new Error('sensitive_exception');});
  assert.deepEqual((await scope.dispose()).failures,['broken']);assert.deepEqual(calls,['store']);
  assert.equal(scope.snapshot().resources.broken.reason,'disposal_failed');
  assert.equal(scope.snapshot().ownedResources,1);
  assert.equal(scope.snapshot().state,'failed');
  assert.deepEqual((await scope.dispose()).failures,['broken']);
});

test('failed rollback retains ownership, blocks acquisition and retries without closing a sibling twice',async()=>{
  const scope=new RuntimeResourceScope(),calls=[];let attempts=0;
  scope.own('sibling',{},()=>calls.push('sibling'));
  const checkpoint=scope.checkpoint();
  scope.own('optional',{},()=>{if(++attempts===1)throw new Error('close_failed');calls.push('optional');});
  assert.deepEqual((await scope.rollback(checkpoint)).failures,['optional']);
  assert.equal(scope.snapshot().ownedResources,2);
  assert.throws(()=>scope.own('new',{},()=>{}),/cleanup_failed/);
  await scope.rollback(checkpoint);
  scope.own('new',{},()=>calls.push('new'));
  await scope.dispose();
  assert.equal(attempts,2);assert.deepEqual(calls,['optional','new','sibling']);
});
test('duplicate initialization cannot acquire a second resource owner',async()=>{
  const scope=new RuntimeResourceScope();scope.own('writer',{},()=>{});
  assert.throws(()=>scope.starting('writer'),/already_started/);
  assert.throws(()=>scope.own('writer',{},()=>{}),/duplicate/);await scope.dispose();
});
test('policy is reused, explicit off is enforced, unfinished on requests remain unavailable',()=>{
  const config={memoryK:{capabilities:{'memory.events':'off','memory.cloudCuration':'on'}}};
  assert.equal(memoryKConsumersAllowed(config),false);
  const rows=createMemoryKRuntimeComposition(config).snapshot().capabilities;
  assert.equal(rows['memory.events'].state,'stopped');assert.equal(rows['memory.events'].effectiveMode,'off');
  assert.equal(rows['memory.cloudCuration'].state,'unavailable');
  assert.equal(rows['memory.cloudCuration'].effectiveMode,null);
  assert.equal(rows['source.core'].state,'unverified','missing source proof is not missing production wiring');
  assert.equal(memoryKConsumersAllowed({memoryK:{capabilities:{}}}),true);
});
test('bootstrap owns one beforeExit listener and isolated instances dispose independently',async t=>{
  const f=await bundle(t),before=process.listenerCount('beforeExit');
  const a=await createRuntimeForBundle(f.options),b=await createRuntimeForBundle(f.options);
  t.after(async()=>{await a.dispose();await b.dispose();});
  assert.equal(process.listenerCount('beforeExit'),before+2);
  await a.dispose();assert.equal(a.closed,true);assert.equal(b.closed,undefined);
  assert.equal(process.listenerCount('beforeExit'),before+1);
  await b.dispose();assert.equal(process.listenerCount('beforeExit'),before);
});
test('restart coalesces, closes old resources and returns a fresh usable runtime',async t=>{
  const f=await bundle(t),runtime=await createRuntimeForBundle(f.options);
  const first=runtime.restart(),second=runtime.restart();assert.equal(first,second);
  const restarted=await first;t.after(()=>restarted.dispose());
  assert.notEqual(runtime,restarted);assert.equal(runtime.closed,true);
  assert.equal(restarted.services.memoryKRuntimeDiagnostics().lifecycle.state,'running');
  const transport=runtime.createTransport();
  await assert.rejects(transport.connect({systemInstruction:'test'}),/runtime_stopped/);
});
test('disabled optional consumers cannot touch capture/foreground write ports',async t=>{
  const f=await bundle(t,{memoryK:{capabilities:{'memory.events':'off'}}});
  const runtime=await createRuntimeForBundle(f.options);t.after(()=>runtime.dispose());
  const turn={get m2Capture(){throw new Error('disabled_port_touched');}};
  assert.equal(runtime.services.bindM2Turn({turn}),null);
  assert.equal(await runtime.services.recordM2Player({turn,text:'unused',source:'player_text'}),null);
  assert.equal(await runtime.services.recordM2Npc({turn}),null);
  assert.equal(await runtime.services.prepareLiveTurnMemory({turn}),null);
  assert.equal(runtime.memoryM3,undefined);
});
test('source channel stays independent of optional memory and stops on disposal',async t=>{
  const contract=await verifyPerceptionContract();let starts=0,stops=0;
  const f=await bundle(t,{intelligence:{mode:'shadow'},memoryK:{capabilities:{'memory.events':'off'}}},
    {perceptionContract:contract,intelligenceOptions:{connect:()=>{
      starts++;const socket=new EventEmitter();socket.destroy=()=>{stops++;socket.emit('close');};return socket;
    }}});
  const runtime=await createRuntimeForBundle(f.options);t.after(()=>runtime.dispose());
  assert.equal(starts,1);assert.ok(runtime.intelligence);assert.equal(runtime.memoryM3,undefined);
  await runtime.dispose();assert.equal(stops,1);assert.equal(runtime.intelligence.closed,true);
  assert.equal(runtime.intelligence.hostContextListeners.size,0);
});
test('SQLite partial startup failure closes store and unsubscribes only this runtime',async t=>{
  let initializes=0,closes=0;
  const evidence=new TestOwnerEvidence();
  const store={filePath:'test.sqlite',initialize:async()=>{initializes++;throw new Error('failed');},
    close:async()=>{closes++;},list:()=>[]};
  const f=await bundle(t,{persistentIdentity:{enabled:true,worldProfileId},
    promotedCharacters:{enabled:true,storageMode:'sqlite'}},{...contracts,identityEvidence:evidence,profileStore:store});
  const before=process.listenerCount('beforeExit');
  await assert.rejects(createRuntimeForBundle(f.options),/p2_sqlite_startup_failed/);
  assert.equal(initializes,1);assert.equal(closes,1);assert.equal(evidence.listeners.size,0);
  assert.equal(evidence.available,true);assert.equal(process.listenerCount('beforeExit'),before);
});

for(const channel of ['activities','source.intelligence']) {
  test(`real optional ${channel} startup fails closed and retains a failing transport for explicit retry`,async t=>{
    let attempts=0,closed=false,siblingStops=0,starts=0;
    const broken=new EventEmitter();
    broken.on=(event,listener)=>{
      if(event==='error')throw new Error('startup_failed');
      return EventEmitter.prototype.on.call(broken,event,listener);
    };
    broken.destroy=()=>{attempts++;if(!closed)throw new Error('close_failed');broken.emit('close');};
    const sibling=new EventEmitter();
    sibling.destroy=()=>{siblingStops++;sibling.emit('close');};
    const contract=await verifyPerceptionContract();
    const config={intelligence:{mode:'shadow'},activities:{mode:channel==='activities'?'shadow':'off'}};
    const f=await bundle(t,config,{perceptionContract:contract,
      intelligenceOptions:{connect:()=>{starts++;return channel==='activities'?sibling:broken;}},
      activityOptions:{connect:()=>broken}});
    const before=process.listenerCount('beforeExit');
    let failure;
    await assert.rejects(createRuntimeForBundle(f.options),error=>{
      failure=error;return error.message==='runtime_startup_cleanup_failed';
    });
    assert.deepEqual(failure.failures,[channel]);
    assert.equal(attempts,2,'rollback and whole-startup cleanup both try the retained closer');
    assert.equal(failure.cleanup.snapshot().ownedResources,1);
    assert.equal(failure.cleanup.snapshot().resources[channel].reason,'disposal_failed');
    assert.equal(failure.cleanup.snapshot().state,'failed');
    assert.equal(process.listenerCount('beforeExit'),before);
    assert.doesNotThrow(()=>broken.emit('data',Buffer.alloc(200000)),
      'quarantined transport cannot schedule frames or effects after stop');
    if(channel==='activities')assert.equal(siblingStops,1,'healthy source sibling is closed on failed startup');
    closed=true;
    assert.deepEqual((await failure.cleanup.retry()).failures,[]);
    assert.equal(attempts,3);assert.equal(failure.cleanup.snapshot().ownedResources,0);
    assert.equal(failure.cleanup.snapshot().state,'stopped');
    await new Promise(resolve=>setTimeout(resolve,1100));
    assert.equal(starts,1,'no reconnect after failed startup cleanup');
    assert.equal(siblingStops,channel==='activities'?1:0);
  });
}

test('failed restart cannot start a replacement until the original transport closes',async t=>{
  let starts=0,failClose=true,attempts=0;
  const contract=await verifyPerceptionContract();
  const f=await bundle(t,{intelligence:{mode:'shadow'}},{perceptionContract:contract,
    intelligenceOptions:{connect:()=>{
      starts++;const socket=new EventEmitter();
      socket.destroy=()=>{attempts++;if(failClose)throw new Error('close_failed');socket.emit('close');};
      return socket;
    }}});
  const runtime=await createRuntimeForBundle(f.options);
  await assert.rejects(runtime.restart(),/runtime_disposal_failed/);
  assert.equal(starts,1);
  assert.equal(runtime.services.memoryKRuntimeDiagnostics().lifecycle.ownedResources,1);
  failClose=false;
  const replacement=await runtime.restart();t.after(()=>replacement.dispose());
  assert.equal(starts,2);assert.equal(attempts,2);
});
