import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFile as sourceFile } from 'node:fs/promises';
import { Telemetry } from '../src/observability/telemetry.mjs';
import { createRuntimeForBundle } from '../src/bootstrap.mjs';
import { createTelemetryRecord,EVENT_NAMES } from '../src/observability/eventContract.mjs';
import { CAPABILITY_IDS } from '../src/activities/contracts.mjs';
import { MEMORY_K_CAPABILITIES } from '../src/memory/capabilityPolicy.mjs';
import { HEALTH_CAPABILITIES } from '../src/observability/capabilityHealth.mjs';
import { REACTION_NAMES } from '../src/reactions/reactionCatalog.mjs';
import { createM7RuntimeCuration } from '../src/memory/m7RuntimeCuration.mjs';
import { BOOTSTRAP_RESOURCES,CORE_SYSTEMS,buildSystemInventory,createSystemHealthMonitor,
  evidenceFromTelemetry,persistSystemInventory } from '../src/observability/systemHealth.mjs';

const sample={observabilityEnabled:true,provider:'openai',speechProvider:'elevenlabs',
  promotedCharacters:{enabled:true},persistentIdentity:{enabled:true},
  intelligence:{mode:'shadow'},spontaneousSpeech:{mode:'experimental'},
  activities:{mode:'on',act6Capabilities:['drive_to'],act3Capabilities:[],passedProbes:[]},
  reactions:{mode:'off',enabled:[]},memoryK:{capabilities:{'memory.cloudCuration':'on'}}};
function memorySink(){
  return {runId:randomUUID(),records:[],droppedCount:0,emit(record){this.records.push(record);return true;},
    async flush(){},async close(){}};
}
test('OBS2 inventory derives ACT, memory, reactions and health registries including disabled/absent',()=>{
  const rows=buildSystemInventory(sample),map=new Map(rows.map(row=>[row.id,row]));
  assert.equal(map.size,rows.length);
  for(const name of CORE_SYSTEMS)assert.ok(map.has(name),name);
  for(const name of BOOTSTRAP_RESOURCES)assert.ok(map.has('resource.'+name),name);
  for(const row of MEMORY_K_CAPABILITIES)assert.ok(map.has('mk.'+row.id),row.id);
  for(const id of CAPABILITY_IDS)assert.ok(map.has('act.'+id),id);
  for(const id of REACTION_NAMES)assert.ok(map.has('reaction.'+id),id);
  for(const id of HEALTH_CAPABILITIES)assert.ok(map.has('readiness.'+id),id);
  assert.equal(map.get('act.drive_to').configuredMode,'on');
  assert.equal(map.get('act.walk_to').configuredMode,'off');
  assert.equal(map.get('reaction.nod').configuredMode,'off');
  assert.equal(map.get('mk.memory.promotionGrace').implemented,false);
  assert.equal(map.get('mk.memory.cloudCuration').configuredMode,'on');
  assert.equal(map.get('mk.memory.events').configuredMode,'off');
  assert.equal(map.get('conversation.tts').configuredMode,'elevenlabs');
  assert.ok(rows.every(row=>row.installed==='unknown'&&row.initialization==='unknown'),
    'registry existence must not assert native install or successful startup');
});
test('OBS2 missing deployed ACT source registry still yields full safe inventory',async t=>{
  // The deployed bundle may contain contracts.mjs but not the repo-root
  // activity-capabilities.v1.json. This was the production-only OBS2 failure.
  const rows=buildSystemInventory(sample,null);
  const fallback=rows.filter(row=>row.id.startsWith('act.'));
  assert.equal(fallback.length,CAPABILITY_IDS.length);
  assert.ok(fallback.every(row=>row.implemented==='unknown' &&
    row.source==='compiled_contract_fallback' &&
    row.installed==='unknown' && row.initialization==='unknown'));
  assert.equal(rows.find(row=>row.id==='act.drive_to').configuredMode,'on');
  assert.ok(rows.some(row=>row.id==='native.rph'));
  const dir=await mkdtemp(path.join(tmpdir(),'lsa-obs2-deploy-fallback-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const sink=memorySink(),telemetry=new Telemetry({sink});
  const persisted=await persistSystemInventory({directory:dir,runId:telemetry.runId,inventory:rows});
  const manifest=JSON.parse(await readFile(persisted.file,'utf8'));
  assert.equal(manifest.systems.filter(row=>row.id.startsWith('act.')).length,CAPABILITY_IDS.length);
  assert.ok(manifest.systems.some(row=>row.id==='act.drive_to' &&
    row.implemented==='unknown' && row.configuredMode==='on'));
  const monitor=createSystemHealthMonitor({config:sample,telemetry,inventory:rows});
  monitor.note('companion.telemetry','initialized',{proof:'resource_lifecycle'});
  assert.equal(sink.records.at(-1).data.systemId,'companion.telemetry');
});

test('OBS2 failure stage reason codes survive closed telemetry, without private data',()=>{
  for(const code of ['inventory_build_failed','inventory_write_failed','health_monitor_attach_failed']){
    const record=createTelemetryRecord({runId:'test',sequence:1,originMs:0,
      event:'system_health_gap',source:'internal',provider:'internal',
      data:{code,exception:'PRIVATE_API_KEY',path:'C:\\PRIVATE\\config.json'}});
    assert.equal(record.data.code,code);
    assert.ok(!JSON.stringify(record).includes('PRIVATE'));
  }
});

test('OBS2 resource inventory stays aligned to real bootstrap resource ownership',async()=>{
  const source=await sourceFile(new URL('../src/bootstrap.mjs',import.meta.url),'utf8');
  const actual=[...new Set([...source.matchAll(/owner\.(?:own|starting|failed)\('([^']+)'/g)].map(x=>x[1]))];
  assert.deepEqual(actual.filter(name=>!BOOTSTRAP_RESOURCES.includes(name)),[]);
});
test('OBS2 validates telemetry health proof and never infers action completion from readiness',()=>{
  const sink=memorySink(),telemetry=new Telemetry({sink});
  const monitor=createSystemHealthMonitor({config:sample,telemetry});
  const off=telemetry.subscribe(row=>monitor.onEvent(row));
  telemetry.emit('reaction_channel_ready',null,'internal',{nativeMode:'on'},'internal');
  assert.equal(monitor.snapshot().systems.find(r=>r.id==='reaction.transport').state,'ready');
  assert.equal(monitor.snapshot().systems.find(r=>r.id==='reaction.transport').lastSuccessfulOperation,null);
  telemetry.emit('activity_receipt',null,'system',{receiptState:'HANDLER_ACCEPTED'},'internal');
  assert.equal(monitor.snapshot().systems.find(r=>r.id==='act.drive_to').lastSuccessfulOperation,undefined);
  telemetry.emit('activity_terminal',null,'system',{status:'failed',capability:'drive_to',
    proofLevel:'none',reason:'navigation_failed'},'internal');
  assert.equal(monitor.snapshot().systems.find(r=>r.id==='act.drive_to').state,undefined);
  telemetry.emit('activity_terminal',null,'system',{status:'completed',capability:'drive_to',
    proofLevel:'world_strong',activityId:'11111111-1111-4111-8111-111111111111'},'internal');
  const after=monitor.snapshot().systems.find(r=>r.id==='act.drive_to');
  assert.equal(after.state,'verified');
  assert.equal(after.lastSuccessfulOperation.proof,'world_strong');
  const health=sink.records.filter(row=>row.event==='system_health');
  assert.equal(health.at(-1).data.healthState,'verified');
  assert.equal(health.at(-1).data.activityId,'11111111-1111-4111-8111-111111111111');
  assert.equal(sink.records.some(row=>row.event==='system_health'&&row.data.systemId==='act.walk_to'),false);
  off();
});
test('OBS2 health is transition only and remains bounded on noisy status callbacks',()=>{
  const sink=memorySink(),t=new Telemetry({sink});
  const monitor=createSystemHealthMonitor({config:sample,telemetry:t,maxTransitions:3});
  for(let n=0;n<1000;n++)monitor.note('reaction.transport','ready',{proof:'transport'});
  assert.equal(sink.records.filter(row=>row.event==='system_health').length,1);
  monitor.note('reaction.transport','degraded',{code:'connection_closed',proof:'transport'});
  monitor.note('reaction.transport','ready',{proof:'transport'});
  monitor.note('reaction.transport','degraded',{code:'connection_closed',proof:'transport'});
  assert.equal(sink.records.filter(row=>row.event==='system_health').length,3);
  assert.equal(sink.records.filter(row=>row.event==='system_health_gap').length,1);
});
test('OBS2 M7 transition observer reports shutdown without exposing queue or consent',async()=>{
  const changes=[];
  const store={readM7Consent(){return null;},subscribeM7ConsentInvalidation(){return ()=>{};},
    reconcileCurationBudget(){return Promise.resolve();}};
  const m7=createM7RuntimeCuration({config:sample,store,
    nativeIdleSource:()=>null,onStatusChange:row=>changes.push(row),
    setIntervalFn:()=>({unref(){}}),setTimeoutFn:()=>({unref(){}}),
    clearIntervalFn:()=>{},clearTimeoutFn:()=>{}});
  m7.start();await m7.dispose();
  assert.ok(changes.some(row=>row.state==='stopped'&&row.reason==='runtime_stopped'));
  assert.ok(!JSON.stringify(changes).includes('reasoningKey'));
});

test('OBS2 bundle startup writes an inventory and health lifecycle without browser/F11',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'lsa-obs2-bootstrap-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const cfgPath=path.join(dir,'config.json'),logs=path.join(dir,'logs');
  await writeFile(cfgPath,JSON.stringify({provider:'openai',intelligence:{mode:'off'},
    activities:{mode:'off'},reactions:{mode:'off'},
    promotedCharacters:{enabled:false},persistentIdentity:{enabled:false}}));
  const runtime=await createRuntimeForBundle({configPath:cfgPath,env:{},
    enableTelemetry:true,telemetryDirectory:logs,startCharacterEditor:false});
  try{
    const status=runtime.services.systemHealth();
    assert.ok(status.systems.length>70);
    assert.equal(status.systems.find(row=>row.id==='act.drive_to').configuredMode,'off');
    const files=await readdir(logs),manifest=files.find(name=>name.startsWith('obs2-inventory-'));
    assert.ok(manifest,'startup must persist a versioned inventory with no menu interaction');
    const rows=JSON.parse((await readFile(path.join(logs,manifest),'utf8')).trim());
    assert.ok(rows.systems.some(row=>row.id==='mk.memory.cloudCuration'));
    assert.ok(rows.systems.some(row=>row.id==='native.rph'&&row.installed==='unknown'));
    assert.equal(JSON.stringify(rows).includes('reasoningKey'),false);
  }finally{await runtime.dispose();}
});

test('OBS2 persisted inventory survives zero events, contains no secrets, and has bounded file retention',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'lsa-obs2-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const inventory=buildSystemInventory({...sample,reasoningKey:'sk-secret',
    memoryK:{capabilities:{'memory.cloudCuration':'on'},secret:'SECRET PRIVATE MEMORY'}});
  const one=await persistSystemInventory({directory:dir,runId:randomUUID(),inventory,maxFiles:2});
  assert.equal(one.count,inventory.length);
  const rows=JSON.parse((await readFile(one.file,'utf8')).trim());
  assert.equal(rows.systems.length,inventory.length);
  assert.equal(rows.kind,'obs2_system_inventory');
  assert.equal(rows.systems.some(row=>row.id==='reaction.nod'&&row.configuredMode==='off'),true);
  assert.ok(!(await readFile(one.file,'utf8')).includes('SECRET PRIVATE'));
  assert.ok(!(await readFile(one.file,'utf8')).includes('sk-secret'));
  for(let i=0;i<3;i++)await persistSystemInventory({directory:dir,runId:randomUUID(),inventory,maxFiles:2});
  assert.ok((await readdir(dir)).filter(name=>name.startsWith('obs2-inventory-')).length<=2);
});
test('OBS2 native channel health retains verified host/epoch correlation',()=>{
  const sink=memorySink(),t=new Telemetry({sink});
  const h=createSystemHealthMonitor({config:sample,telemetry:t});
  t.subscribe(row=>h.onEvent(row));
  const hostRunId='11111111-1111-4111-8111-111111111111';
  t.emit('activity_channel_ready',null,'internal',{hostRunId,worldEpoch:7},'internal');
  const row=sink.records.find(x=>x.event==='system_health'&&x.data.systemId==='activity.transport');
  assert.equal(row.data.hostRunId,hostRunId);
  assert.equal(row.data.worldEpoch,7);
  assert.equal(row.data.healthState,'ready');
  assert.equal(h.snapshot().systems.find(x=>x.id==='activity.transport').lastSuccessfulOperation,null);
});

test('OBS2 new fallback events retain safe categories and mark only completed native recovery',()=>{
  const sink=memorySink(),t=new Telemetry({sink});
  const inventory=buildSystemInventory({...sample,localVoiceFallback:{enabled:true}});
  const health=createSystemHealthMonitor({config:sample,telemetry:t,inventory});
  t.subscribe(row=>health.onEvent(row));
  t.emit('voice_fallback_selected',null,'internal',{category:'misheard',
    assetId:'PRIVATE_ASSET',characterId:'PRIVATE_NPC'},'internal');
  assert.equal(health.snapshot().systems.find(x=>x.id==='conversation.voiceFallback').state,undefined);
  t.emit('voice_fallback_playback_completed',null,'internal',{category:'misheard',pcmBytes:100},'internal');
  assert.equal(health.snapshot().systems.find(x=>x.id==='conversation.voiceFallback').state,'verified');
  assert.ok(!JSON.stringify(sink.records).includes('PRIVATE_ASSET'));
  assert.equal(sink.records.find(x=>x.event==='voice_fallback_playback_completed').data.category,'misheard');
});

test('OBS2 producer coverage includes reaction and fallback life-cycle events',()=>{
  for(const name of ['reaction_selected','reaction_sent','reaction_dropped',
    'reaction_ack','reaction_channel_ready','reaction_channel_closed',
    'voice_fallback_requested','voice_fallback_selected','voice_fallback_playback_started',
    'voice_fallback_playback_completed','voice_fallback_playback_failed',
    'voice_fallback_recovery_completed'])assert.equal(EVENT_NAMES.has(name),true,name);
});
test('OBS2 PS4 projected frames are verified only as projection, UX4 target changes as readiness',()=>{
  const sink=memorySink(),telemetry=new Telemetry({sink});
  const h=createSystemHealthMonitor({config:sample,telemetry});
  telemetry.subscribe(record=>h.onEvent(record));
  telemetry.emit('target_changed',null,'internal',{reason:'changed'},'internal');
  assert.equal(h.snapshot().systems.find(x=>x.id==='conversation.ux4').state,'ready');
  telemetry.emit('knowledge_frame_projected',null,'internal',{frameBytes:120},'internal');
  const ps4=h.snapshot().systems.find(x=>x.id==='perception.ps4');
  assert.equal(ps4.state,'verified');
  assert.equal(ps4.lastSuccessfulOperation.proof,'frame_projected');
});

test('OBS2 telemetry only accepts bounded safe system health identifiers and proof tokens',()=>{
  const row=createTelemetryRecord({runId:'test',sequence:1,originMs:0,now:1,
    event:'system_health',source:'internal',provider:'internal',data:{
      systemId:'act.drive_to',healthState:'verified',proofLevel:'world_strong',
      evidenceEvent:'activity_terminal',activityId:'11111111-1111-4111-8111-111111111111',
      memory:'PRIVATE',dialogue:'VERY PRIVATE'}});
  assert.equal(row.data.systemId,'act.drive_to');
  assert.equal(row.data.proofLevel,'world_strong');
  assert.ok(!JSON.stringify(row).includes('PRIVATE'));
  const invalid=createTelemetryRecord({runId:'test',sequence:2,originMs:0,now:1,
    event:'system_health',source:'internal',provider:'internal',data:{
      systemId:'private conversation here',healthState:'probably healthy',
      proofLevel:'arbitrary secret',evidenceEvent:'not_registered'}});
  assert.deepEqual(invalid.data,{});
  assert.equal(evidenceFromTelemetry({event:'activity_channel_counter',data:{receiptState:'HANDLER_ACCEPTED'}}),null);
});
