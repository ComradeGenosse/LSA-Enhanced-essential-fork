import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CAPABILITIES, normalizePerceptionConfig,validateFrame,validateSignal,validateObservation } from '../src/perception/contracts.mjs';
import { ShadowRuntime } from '../src/perception/shadowRuntime.mjs';
import { ObservationStore } from '../src/perception/observationStore.mjs';
import { verifyPerceptionContract } from '../tools/verifyPerceptionContract.mjs';
import { perceptionContractSupported } from '../src/perception/nativeSupport.mjs';

function fixture() {
  let now=0, sequence=0, producerSequence=0;const epoch=randomUUID(),stream=randomUUID(),ped=randomUUID(),player=randomUUID(),vehicle=randomUUID(),ambient=randomUUID();
  const runtime=new ShadowRuntime({mode:'shadow',now:()=>now});const caps=Object.fromEntries(CAPABILITIES.map(k=>[k,!['awareness','playerSpeech'].includes(k)]));
  const hello=()=>({version:1,type:'hello',adapterEpoch:epoch,streamId:stream,capabilities:caps});
  const frame=(type,payload)=>({version:1,type,adapterEpoch:epoch,streamId:stream,sequence:++sequence,payload});
  const ingest=v=>runtime.ingest(v,{authenticated:true});
  ingest(hello());ingest(frame('anchors',[{captureRef:ped,kind:'ped',observer:true},{captureRef:player,kind:'player',observer:false},{captureRef:vehicle,kind:'vehicle',observer:false},{captureRef:ambient,kind:'ped',observer:false}]));
  const signal=(patch={})=>({signalId:randomUUID(),producer:'ped_damage',producerSequence:++producerSequence,kind:'damage',target:ped,source:player,gameTick:1,ageMs:0,facts:{damage:5,armour:1,classification:'bullet'},...patch});
  return {runtime,caps,ped,player,vehicle,ambient,hello,frame,signal,ingest,advance:n=>now+=n};
}
test('perception defaults off and unsupported future modes cannot activate effects',()=>{
  assert.equal(normalizePerceptionConfig().mode,'off');assert.equal(normalizePerceptionConfig().radio,'off');assert.equal(normalizePerceptionConfig({mode:'shadow'}).mode,'shadow');
  assert.equal(normalizePerceptionConfig({mode:'shadow',radio:'shadow'}).radio,'shadow');assert.equal(normalizePerceptionConfig({mode:'off',radio:'shadow'}).radio,'off');assert.equal(normalizePerceptionConfig({mode:'shadow',radio:'context'}).radio,'off');
  for(const mode of ['context','memory','initiative','anything']) assert.equal(normalizePerceptionConfig({mode}).mode,'off');
  const f=fixture();const off=new ShadowRuntime();assert.equal(off.ingest(f.hello(),{authenticated:true}),false);assert.equal(off.anchors.size,0);
});
test('native perception metadata is pinned and drift fails closed',async()=>{
  const c=await verifyPerceptionContract();assert.equal(perceptionContractSupported(c),true);
  assert.equal((await verifyPerceptionContract('changed')).available,false);
  assert.equal((await verifyPerceptionContract(undefined,{damageText:'{}'})).available,false);
  assert.equal((await verifyPerceptionContract(undefined,{essentialText:'{}'})).available,false);
  assert.equal(perceptionContractSupported({...c,damageDllSha256:'changed'}),false);
});
test('copied frames do not authenticate an endpoint',()=>{
  const f=fixture(),r=new ShadowRuntime({mode:'shadow'});assert.equal(r.ingest(f.hello()),false);assert.equal(r.epoch,null);
});
test('primitive frames reject unknown keys, version, oversized, unrestricted identity and nonfinite facts',()=>{
  const f=fixture();assert.equal(validateFrame(f.hello()),true);
  for(const bad of [{...f.hello(),version:2},{...f.hello(),proof:'secret'},{...f.hello(),extra:'x'.repeat(8192)}]) assert.equal(validateFrame(bad),false);
  const s=f.signal();assert.equal(validateSignal(s),true);
  for(const bad of [{...s,CharacterId:randomUUID()},{...s,target:'12345'},{...s,facts:{...s.facts,nativeAddress:42}},{...s,facts:{...s.facts,damage:NaN}},{...s,producerSequence:-1}]) assert.equal(validateSignal(bad),false);
  assert.equal(validateFrame(f.frame('anchors',[{captureRef:f.player,kind:'player',observer:true}])),false);
  assert.equal(validateFrame(f.frame('anchors',Array(33).fill({captureRef:f.ped,kind:'ped',observer:false}))),false);
});
test('player ped vehicle damage supports unknown attacker without inferred attribution',()=>{
  const f=fixture();for(const [producer,kind,target] of [['ped_damage','damage',f.ped],['player_damage','damage',f.player],['vehicle_damage','vehicle_damage',f.vehicle]]) assert.equal(f.ingest(f.frame('signal',f.signal({producer,kind,target,source:null}))),true);
  assert.equal(f.runtime.signals.length,3);assert.equal(f.runtime.signals[2].value.source,null);
});
test('checked native visual witness receipts become immutable per-observer observations with exact attribution',()=>{
  const f=fixture(),signalId=randomUUID(),receipt={observer:{captureRef:f.ped,kind:'ped'},sampledGameTick:17,status:'witnessed',reason:'visual_clear',knowsSource:true,knowsTarget:false,evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:17}};
  const signal=f.signal({signalId,producer:'shooting',producerSequence:40,kind:'firing',target:null,source:f.player,gameTick:17,facts:{},witnessReceipts:[receipt]});
  assert.equal(validateSignal(signal),true);assert.equal(f.ingest(f.frame('signal',signal)),true);
  const observation=[...f.runtime.observations.entries.values()][0].value;
  assert.equal(validateObservation(observation),true);assert.equal(observation.claims[0].evidence.channel,'visual');assert.equal(observation.claims[0].source.captureRef,f.player);assert.equal(observation.claims[0].target,undefined);
  const replay=f.signal({signalId,producer:'shooting',producerSequence:41,kind:'firing',target:null,source:f.player,gameTick:17,facts:{},witnessReceipts:[receipt]});
  assert.equal(f.ingest(f.frame('signal',replay)),true);assert.equal(f.runtime.observations.entries.size,1);assert.equal(f.runtime.ps2Diagnostics.duplicates,1);
  assert.equal(validateSignal({...signal,witnessReceipts:[{...receipt,observer:{...receipt.observer,kind:'vehicle'}}]}),false);
});
test('duplicate/out of order envelope sequences cannot replay facts',()=>{
  const f=fixture(),v=f.frame('signal',f.signal());assert.equal(f.ingest(v),true);assert.equal(f.ingest(v),false);
  assert.equal(f.ingest({...v,sequence:1}),false);assert.equal(f.runtime.signals.length,1);assert.equal(f.runtime.counters.duplicate,2);
});
test('transport sequence loss invalidates anchors and queued facts',()=>{
  const f=fixture();f.ingest(f.frame('signal',f.signal()));const v=f.frame('signal',f.signal());assert.equal(f.ingest({...v,sequence:v.sequence+1}),false);
  assert.equal(f.runtime.epoch,null);assert.equal(f.runtime.anchors.size,0);assert.equal(f.runtime.signals.length,0);
});
test('producer ordering loss reports uncertainty without guessing missed outcomes',()=>{
  const f=fixture(),s=f.signal({producerSequence:3});assert.equal(f.ingest(f.frame('signal',s)),true);
  assert.equal(f.runtime.counters.gaps,1);assert.equal(f.ingest(f.frame('signal',s)),false);assert.equal(f.runtime.signals.length,1);
});
test('retained history pressure never drops valid critical signals before PS2/PS3',()=>{
  const f=fixture();for(let n=0;n<400;n++) assert.equal(f.ingest(f.frame('signal',f.signal())),true);
  assert.equal(f.runtime.signals.length,256);assert.equal(f.runtime.counters.received,400);assert.equal(f.runtime.counters.dropped,0);
  assert.equal(f.runtime.historyDiagnostics.skipped,144);assert.equal(f.runtime.historyDiagnostics.highWater,256);
});
test('routine signal history rotates while reserving space for critical involvement',()=>{
  const f=fixture();for(let n=0;n<400;n++) assert.equal(f.ingest(f.frame('signal',f.signal({target:f.ambient,source:null}))),true);
  assert.equal(f.runtime.signals.length,192);assert.equal(f.runtime.counters.received,400);assert.equal(f.runtime.counters.dropped,0);assert.equal(f.runtime.historyDiagnostics.evicted,208);
  for(let n=0;n<100;n++) assert.equal(f.ingest(f.frame('signal',f.signal())),true);
  assert.equal(f.runtime.signals.length,256);assert.equal(f.runtime.counters.received,500);assert.equal(f.runtime.counters.dropped,0);assert.ok(f.runtime.signals.some(s=>s.critical));
  assert.equal(f.runtime.historyDiagnostics.highWater,256);
});
test('retirement purges old lifetime facts; same handle replacement cannot use old random token',()=>{
  const f=fixture();f.ingest(f.frame('signal',f.signal()));f.ingest(f.frame('retire',{captureRef:f.ped}));assert.equal(f.runtime.signals.length,0);
  const replacement=randomUUID();f.ingest(f.frame('anchors',[{captureRef:replacement,kind:'ped',observer:true}]));assert.equal(f.ingest(f.frame('signal',f.signal())),false);assert.equal(f.runtime.current(replacement),true);
});
test('expiry and stalled native validation cannot revive anchors from queued frames',()=>{
  const f=fixture();f.advance(3001);f.runtime.expire();assert.equal(f.runtime.anchors.size,0);assert.equal(f.runtime.epoch,null);
  assert.equal(f.ingest(f.frame('signal',f.signal())),false);
});
test('history expiry is diagnostic ageing, not an expired input or semantic drop',()=>{
  const f=fixture();assert.equal(f.ingest(f.frame('signal',f.signal())),true);const inputExpired=f.runtime.counters.expired;
  f.runtime.signals[0].expires=0;f.runtime.expire();
  assert.equal(f.runtime.signals.length,0);assert.equal(f.runtime.historyDiagnostics.expired,1);assert.equal(f.runtime.counters.expired,inputExpired);assert.equal(f.runtime.counters.dropped,0);
});
test('PS2 and PS3 counters stay process-cumulative across lifecycle resets',()=>{
  const f=fixture();assert.equal(f.ingest(f.frame('signal',f.signal())),true);
  const ps2={...f.runtime.ps2Diagnostics},ps3={...f.runtime.ps3Diagnostics,reasons:{...f.runtime.ps3Diagnostics.reasons}};
  f.runtime.reset('disconnect');
  assert.equal(f.runtime.ps2Diagnostics.witnessed,ps2.witnessed);assert.equal(f.runtime.ps3Diagnostics.decisions,ps3.decisions);
  assert.equal(f.runtime.ps3Diagnostics.reasons.safetySelfDanger,ps3.reasons.safetySelfDanger);
  assert.equal(f.runtime.resetDiagnostics.disconnects,1);
});
test('old native epoch/stream cannot publish after feature reset',()=>{
  const f=fixture();f.runtime.reset();const other={...f.hello(),adapterEpoch:randomUUID(),streamId:randomUUID()};f.ingest(other);
  assert.equal(f.ingest(f.frame('signal',f.signal())),false);assert.equal(f.runtime.signals.length,0);
});
test('missing source capability fails closed while player speech stays explicitly unsupported',()=>{
  const f=fixture();f.runtime.capabilities=Object.freeze({...f.runtime.capabilities,pedDamage:false});
  assert.equal(f.ingest(f.frame('signal',f.signal({source:null}))),false);assert.equal(f.runtime.capabilities.witness,true);assert.equal(f.runtime.capabilities.playerSpeech,false);assert.equal(f.runtime.signals.length,0);
});
test('expired callback facts rejected and collision primitive copied immutably',()=>{
  const f=fixture();assert.equal(f.ingest(f.frame('signal',f.signal({ageMs:30000}))),false);
  const collision={x:1,y:2,z:3};const s=f.signal({producer:'vehicle_damage',kind:'vehicle_damage',target:f.vehicle,facts:{damage:1,armour:0,classification:'collision',collision}});
  assert.equal(f.ingest(f.frame('signal',s)),true);collision.x=99;assert.equal(f.runtime.signals[0].value.facts.collision.x,1);
});
test('damage callback and PS2 diagnostics distinguish bounded counters and unsupported speech receipt gate',()=>{
  const f=fixture(),p={anchors:4,observers:1,snapshotAgeMs:0,snapshotCadenceMs:200,dropped:0,staleRejected:0,retiredAnchors:0,deferredDiscovery:0,updateMicros:200,capabilities:f.caps,signals:{},damageCallbacks:{ped_damage:2,player_damage:1,vehicle_damage:0},witnessDeferred:0,witnessUnknown:0,witnessRejected:0,playerSpeechGate:'unsupported_capture_receipt'};
  assert.equal(validateFrame(f.frame('diagnostics',p)),true);
  assert.equal(validateFrame(f.frame('diagnostics',{...p,damageCallbacks:{ped_damage:2,player_damage:1}})),false);
  assert.equal(validateFrame(f.frame('diagnostics',{...p,damageCallbacks:{ped_damage:2,player_damage:1,vehicle_damage:0,handles:[1]}})),false);
});
function observation(observer,episodeId=randomUUID()) {return {version:1,observationId:randomUUID(),episodeId,revision:1,observer:{captureRef:observer,kind:'ped'},observedAt:{nativeRun:randomUUID(),gameTick:1,receivedUtc:'2026-10-03T00:00:00.000Z'},expiresAtMonotonicMs:30000,eventType:'injury',severity:'danger',claims:[{claimId:randomUUID(),kind:'injured',certainty:'supported',evidence:{channel:'self',basis:'native_callback',sampledGameTick:1},details:{damageDelta:1,armourDelta:0}}],recognizedCharacterIds:[]};}
test('observation revisions immutable, bounded, expire and retire with observer',()=>{
  let now=0,live=true;const observer=randomUUID(),store=new ObservationStore({now:()=>now,current:()=>live}),o=observation(observer);
  assert.equal(validateObservation(o),true);assert.equal(store.put(o),true);o.claims[0].details.damageDelta=9;assert.equal([...store.entries.values()][0].value.claims[0].details.damageDelta,1);
  assert.equal(store.put(o),false);assert.equal(store.put({...o,revision:2}),true);
  for(let n=0;n<127;n++) assert.equal(store.put(observation(observer)),true);assert.equal(store.put(observation(observer)),false);
  now=30001;store.expire();assert.equal(store.entries.size,0);now=0;store.put(observation(observer));live=false;store.expire();assert.equal(store.entries.size,0);assert.equal(store.bytes,0);
});
test('observations reject unsupported witness claims and private fields',()=>{
  const o=observation(randomUUID());for(const bad of [{...o,revision:0},{...o,recognizedCharacterIds:[randomUUID()]},{...o,prompt:'private'},{...o,claims:Array(5).fill(o.claims[0])}]) assert.equal(validateObservation(bad),false);
});
test('global observation count and serialized RAM budget are enforced',()=>{
  const refs=Array.from({length:16},()=>randomUUID());const store=new ObservationStore({now:()=>0,current:()=>true});
  for(let n=0;n<2048;n++) assert.equal(store.put(observation(refs[n%16])),true);
  assert.equal(store.put(observation(randomUUID())),false);assert.equal(store.entries.size,2048);assert.ok(store.bytes<=2*1024*1024);
  store.clear();let admitted=0;
  for(let n=0;n<2048;n++) {const o=observation(refs[n%16]);o.claims=Array.from({length:4},()=>({...o.claims[0],claimId:randomUUID(),source:{captureRef:refs[0],kind:'ped'},target:{captureRef:refs[1],kind:'ped'}}));if(store.put(o)) admitted++;}
  assert.ok(admitted<2048);assert.ok(store.bytes<=2*1024*1024);
});
test('action callbacks use Essential canonical names',()=>{
  const f=fixture();
  assert.equal(validateSignal(f.signal({producer:'action',kind:'action_callback',source:null,facts:{action:'followtarget',succeeded:true}})),true);
  assert.equal(validateSignal(f.signal({producer:'action',kind:'action_callback',source:null,facts:{action:'waithere',succeeded:false}})),true);
  assert.equal(validateSignal(f.signal({producer:'action',kind:'action_callback',source:null,facts:{action:'other',succeeded:true}})),true);
  for (const action of ['follow','wait','FollowTarget','WaitHere']) assert.equal(validateSignal(f.signal({producer:'action',kind:'action_callback',source:null,facts:{action,succeeded:true}})),false);
});
test('signal anchor kinds reject wrong entity addresses',()=>{
  const f=fixture();assert.equal(f.ingest(f.frame('signal',f.signal({target:f.vehicle}))),false);
  assert.equal(f.ingest(f.frame('signal',f.signal({source:f.vehicle}))),false);
  assert.equal(f.ingest(f.frame('signal',f.signal({kind:'vehicle_transition',producer:'state',facts:{vehicle:f.vehicle,driver:true},source:null}))),true);
});
test('PS0/PS1 production module boundary contains no model, memory or native action effect',async()=>{
  for(const file of ['contracts.mjs','shadowRuntime.mjs','observationStore.mjs','episodeCorrelator.mjs','witnessPolicy.mjs','speechContract.mjs','sharedTranscriptStore.mjs','intelligenceClient.mjs','salienceEngine.mjs']) {
    const source=await readFile(new URL('../src/perception/'+file,import.meta.url),'utf8');assert.doesNotMatch(source,/from ['"].*(?:openai|providers|profileStore|characterService|sceneDirector)/);assert.doesNotMatch(source,/writeFile|fetch\(|upsertExperience|\.request\(/);
  }
  const source=await readFile(new URL('../../native/intelligence/IntelligenceIntegration.cs',import.meta.url),'utf8');assert.doesNotMatch(source,/World\.GetAll|PerceptionSystem\.Update|PerceptionSnapshot\.Capture|GunshotReflexDetector|NpcActions\.|\.TASK|SpecialGeminiTurnScheduler/);assert.match(source,/public void EnrichActor\(Ped ped,ActorContext context\) \{\}/);
});


function radioRuntime(radio='shadow') {
  let sequence=0,producer=0;const epoch=randomUUID(),stream=randomUUID(),vehicle=randomUUID(),ped=randomUUID();
  const runtime=new ShadowRuntime({mode:'shadow',radio,now:()=>0});
  const caps=Object.fromEntries(CAPABILITIES.map(k=>[k,!['witness','awareness','playerSpeech'].includes(k)]));
  const ingest=v=>runtime.ingest(v,{authenticated:true});
  ingest({version:1,type:'hello',adapterEpoch:epoch,streamId:stream,capabilities:caps});
  const frame=(type,payload)=>({version:1,type,adapterEpoch:epoch,streamId:stream,sequence:++sequence,payload});
  ingest(frame('anchors',[{captureRef:vehicle,kind:'vehicle',observer:false},{captureRef:ped,kind:'ped',observer:true}]));
  const signal=(patch={})=>({signalId:randomUUID(),producer:'radio',producerSequence:++producer,kind:'radio_changed',target:vehicle,source:null,gameTick:1,ageMs:0,facts:{station:'RADIO_01_CLASS_ROCK',trackHash:1},...patch,facts:patch.facts??{station:'RADIO_01_CLASS_ROCK',trackHash:1}});
  return {runtime,ingest,frame,signal,vehicle,ped};
}
test('radio signals accept the closed station and hash contract',()=>{
  const r=radioRuntime(),ok=r.signal(),emptyFacts=r.signal();emptyFacts.facts=null;
  assert.equal(validateSignal(ok),true);assert.equal(validateSignal(r.signal({target:null})),true);assert.equal(validateSignal(r.signal({facts:{station:'RADIO_01_CLASS_ROCK',trackHash:0xffffffff}})),true);
  assert.equal(validateSignal(r.signal({kind:'radio_stopped',facts:{station:'',trackHash:0}})),true);
  for(const bad of [
    r.signal({kind:'radio_started'}),r.signal({producer:'state'}),r.signal({facts:{station:'radio_01',trackHash:1}}),
    r.signal({facts:{station:'',trackHash:1}}),r.signal({facts:{station:'RADIO_01_CLASS_ROCK',trackHash:-1}}),
    r.signal({facts:{station:'RADIO_01_CLASS_ROCK',trackHash:0x100000000}}),r.signal({kind:'radio_stopped',facts:{station:'',trackHash:1}}),
    r.signal({facts:{station:'RADIO_01_CLASS_ROCK',trackHash:1,artist:'secret'}}),r.signal({source:randomUUID()}),emptyFacts
  ]) assert.equal(validateSignal(bad),false);
  assert.equal(validateFrame(r.frame('signal',ok)),true);
});
test('radio facts remain raw and bypass PS2/PS3 correlation',()=>{
  const blocked=radioRuntime('off');
  assert.equal(blocked.ingest(blocked.frame('signal',blocked.signal())),false);assert.equal(blocked.runtime.signals.length,0);
  const live=radioRuntime();
  assert.equal(live.ingest(live.frame('signal',live.signal())),true);
  assert.equal(live.runtime.signals.length,1);assert.equal(live.runtime.signals[0].critical,false);
  assert.equal(live.runtime.signals[0].value.facts.station,'RADIO_01_CLASS_ROCK');
  assert.equal(live.runtime.observations.entries.size,0);assert.equal(live.runtime.ps2Diagnostics.correlated,0);assert.equal(live.runtime.ps3Diagnostics.decisions,0);
  assert.equal(live.ingest(live.frame('signal',live.signal({target:live.ped}))),false);
  assert.equal(live.ingest(live.frame('signal',live.signal({target:null}))),true);
});
test('radio diagnostics stay scalar and reject station content',()=>{
  const f=fixture(),radio={samples:2,edges:1,nativeFailures:0};
  const payload={anchors:1,observers:1,snapshotAgeMs:0,snapshotCadenceMs:250,dropped:0,staleRejected:0,retiredAnchors:0,deferredDiscovery:0,updateMicros:10,capabilities:f.caps,signals:{radio_changed:1,radio_stopped:1},damageCallbacks:{ped_damage:0,player_damage:0,vehicle_damage:0},witnessDeferred:0,witnessUnknown:0,witnessRejected:0,playerSpeechGate:'unsupported_capture_receipt',radio};
  assert.equal(validateFrame(f.frame('diagnostics',payload)),true);
  assert.equal(validateFrame(f.frame('diagnostics',{...payload,radio:{...radio,station:'RADIO_01_CLASS_ROCK'}})),false);
});
