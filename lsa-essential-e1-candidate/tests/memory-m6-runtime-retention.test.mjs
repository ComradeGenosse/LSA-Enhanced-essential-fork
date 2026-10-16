// Memory K J-B: production runtime activation of the EXISTING M6 retention.
// Real createRuntimeForBundle + real P2 SQLite + the unmodified M6 coordinator,
// P2 replay adapter and cursor (proved independently in J-A). Offline source
// simulation: recorded conversations stand in for native/GTA turns. Nothing
// here is a GTA receipt; see docs/plans/memory-k-jb-m6-runtime-activation-20261016.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID as id} from 'node:crypto';
import {createRuntimeForBundle} from '../src/bootstrap.mjs';
import {IDENTITY_DLL_SHA256,IDENTITY_METADATA_SHA256} from '../src/identity/nativeSupport.mjs';
import {CHARACTER_METADATA_SHA256} from '../src/characters/nativeSupport.mjs';
import {worldProfileId,TestOwnerEvidence} from './identity-fixtures.mjs';
import {profile} from './p2-fixtures.mjs';
import {createConversationJournalRecorder} from '../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {DatabaseSync} from 'node:sqlite';
import {createM5SqliteServices} from '../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';
import {createM6RuntimeRetention} from '../src/memory/m6RuntimeRetention.mjs';
import {memoryKConsumersAllowed,memoryKDialogueActivation,memoryKH1Activation,memoryKH2Activation,memoryKM5Activation} from '../src/memory/runtimeComposition.mjs';
import {memoryKM3Activation} from '../src/memory/m3Activation.mjs';
import {memoryKSourceActivation} from '../src/memory/sourceActivation.mjs';

const BASE=Date.parse('2026-10-16T12:00:00.000Z');
const at=s=>new Date(BASE+s*1000).toISOString();
const FUNNY='That was hilarious! The car completely flipped over the fence.';
const NPC_FUNNY='Ha, that was the funniest crash I have ever seen, I will never forget it!';
const MUNDANE='What time is it right now?';
const MUNDANE_NPC='It is around noon, I think.';
const turn=(label,pedId=101)=>({pedId,turnId:label,generationId:'gen-'+label,sessionNonce:'jb-session'});
const completed=i=>({...i,type:'playback_ended',reason:'completed',ok:true,
  wasInterrupted:false,hadAudio:true,playbackStarted:true});

// Controllable clock and timers: no real interval/timeout ever fires in a test.
function harness(){
  const h={nowMs:BASE+6*3600e3,timers:[],cleared:[]};
  h.options={now:()=>h.nowMs,
    setIntervalFn:(fn,ms)=>{const t={fn,ms,kind:'interval',unref(){t.unrefd=true;}};h.timers.push(t);return t;},
    setTimeoutFn:(fn,ms)=>{const t={fn,ms,kind:'timeout',unref(){t.unrefd=true;}};h.timers.push(t);return t;},
    clearIntervalFn:t=>h.cleared.push(t),clearTimeoutFn:t=>h.cleared.push(t)};
  return h;
}
async function boot(t,{root,capabilities,h=harness()}){
  const configPath=path.join(root,'config.json');
  await writeFile(configPath,JSON.stringify({provider:'openai',
    persistentIdentity:{enabled:true,worldProfileId,storePath:path.join(root,'identity.json')},
    promotedCharacters:{enabled:true,storageMode:'sqlite',sqliteStorePath:path.join(root,'p2.sqlite'),
      storePath:path.join(root,'profiles.json')},
    ...capabilities?{memoryK:{capabilities}}:{}}));
  const runtime=await createRuntimeForBundle({configPath,env:{},enableTelemetry:false,startCharacterEditor:false,
    identityEvidence:new TestOwnerEvidence(),
    identityContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,metadataSha256:IDENTITY_METADATA_SHA256,nativeProtocolChanged:false},
    characterContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,metadataSha256:CHARACTER_METADATA_SHA256,nativeProtocolChanged:false},
    fetchImpl:()=>{throw new Error('unexpected_provider_call');},
    m6RetentionOptions:h.options});
  t.after(()=>runtime.dispose());
  return {runtime,store:runtime.characterService.store,h};
}
async function confirm(store,timelineId){
  store.setVerifiedHostContext({hostContextVersion:1,hostRunId:id(),worldEpoch:1});
  await store.confirmTimeline(timelineId);
}
async function exchange(store,characterId,label,sec,playerText,npcText){
  const journal=createConversationJournalRecorder(store);
  const p=turn(label+'-p'),n=turn(label+'-n');
  const player=await journal.recordPlayerAccepted({characterId,identity:p,text:playerText,source:'typed',
    attribution:{protagonist:'franklin'},committedAtUtc:at(sec)});
  const npc=await journal.recordNpcCompleted({characterId,identity:n,text:npcText,receipt:completed(n),
    attribution:{protagonist:'franklin'},committedAtUtc:at(sec+5)});
  return {playerId:player.recordId,npcId:npc.recordId};
}
const retained=(store,scope)=>store.readPermanentMemoryRows({...scope,protagonistKey:'franklin'});
const recall=(store,scope)=>store.readIntegratedRecall({scope:{...scope,protagonistKey:'franklin'},sourceKind:'permanent_memory',limit:20});

test('J-B: M6 runtime is off by default and never constructs cloud curation',async t=>{
  for(const capabilities of [undefined,{},{'memory.dialogue.player':'on'},{'memory.deterministic':'off'}]){
    const root=await mkdtemp(path.join(tmpdir(),'memory-jb-off-'));
    const {runtime,h}=await boot(t,{root,capabilities});
    t.after(()=>rm(root,{recursive:true,force:true}));
    assert.equal(runtime.retention??null,null,'no retention runtime unless explicitly enabled');
    assert.equal(h.timers.length,0,'no timer is created');
    const row=runtime.services.memoryRetentionDiagnostics();
    assert.equal(row.state,'stopped');assert.equal(row.effectiveMode,'off');
    await runtime.dispose();
  }
  // Requesting M7 does not enable it: M6 reports it off and registers no queue.
  const root=await mkdtemp(path.join(tmpdir(),'memory-jb-m7-'));
  const {runtime}=await boot(t,{root,capabilities:{'memory.deterministic':'on','memory.cloudCuration':'on'}});
  t.after(()=>rm(root,{recursive:true,force:true}));
  assert.ok(runtime.retention);
  assert.equal(runtime.services.memoryRetentionDiagnostics().cloudCuration,'off');
  const caps=runtime.services.memoryKRuntimeDiagnostics().capabilities;
  assert.equal(caps['memory.cloudCuration'].effectiveMode,null,'M7 stays unavailable and independently optional');
  assert.equal(caps['memory.cloudCuration'].state,'unavailable');
});

test('J-B: M6-only opt-in keeps legacy recording, recall, M3, PS and M5 enabled',()=>{
  const config={memoryK:{capabilities:{'memory.deterministic':'on'}}};
  assert.equal(memoryKConsumersAllowed(config),true);
  assert.equal(memoryKDialogueActivation(config).player,true);
  assert.equal(memoryKDialogueActivation(config).npc,true);
  assert.equal(memoryKH1Activation(config).mode,'on');
  assert.equal(memoryKH2Activation(config).mode,'on');
  assert.equal(memoryKM5Activation(config).mode,'on');
  assert.equal(memoryKM3Activation(config).events.mode,'on');
  assert.equal(memoryKM3Activation(config).coverage.mode,'on');
  assert.equal(memoryKSourceActivation(config).ps2.enabled,true);
  assert.equal(memoryKSourceActivation(config).ps3.enabled,true);
  assert.equal(memoryKConsumersAllowed({memoryK:{capabilities:{
    'memory.deterministic':'on','memory.recall':'off'}}}),false,
    'explicit sibling gates still disable inheritance');
});

test('J-B: persistent failure of one NPC cannot be masked by successful NPC work',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'memory-jb-failures-'));
  const {runtime,store,h}=await boot(t,{root,capabilities:{'memory.deterministic':'off'}});
  t.after(()=>rm(root,{recursive:true,force:true}));
  const bad=await store.create(profile({name:'Broken NPC'}));
  const good=await store.create(profile({name:'Healthy NPC'}));
  const timelineId=await store.createTimeline({label:'J-B failures'});
  await confirm(store,timelineId);
  let badAttempts=0;
  const faultingStore=new Proxy(store,{get(target,key){
    if(key==='readM6Checkpoint')return args=>{
      if(args.scope.characterId===bad.characterId){badAttempts++;throw new Error('m6_test_scope_failure');}
      return target.readM6Checkpoint(args);
    };
    const value=Reflect.get(target,key,target);
    return typeof value==='function'?value.bind(target):value;
  }});
  const retention=createM6RuntimeRetention({store:faultingStore,now:()=>h.nowMs,maxConsecutiveFailures:3});
  t.after(()=>retention.dispose());
  for(let i=0;i<3;i++){
    const tick=await retention.tick();
    assert.equal(tick.processed,1,'healthy scope is still processed');
    assert.equal(tick.recovered,false,'failed recovery is not certified');
  }
  assert.equal(badAttempts,3);
  assert.equal(retention.diagnostics().degradedScopes,1);
  assert.equal(retention.diagnostics().state,'degraded');
  // The failing scope is quarantined, not retried on every tick, while the
  // other NPC remains eligible. Recovery never claims to be fully complete.
  const tick=await retention.tick();
  assert.equal(tick.processed,1);
  assert.equal(badAttempts,3);
  assert.equal(tick.recovered,false);
  assert.equal(retention.diagnostics().degradedScopes,1);
});

test('J-B: startup recovery retains qualifying conversations without "remember", survives restart and stays recallable by M4',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'memory-jb-restart-'));
  const h=harness();
  let {runtime,store}=await boot(t,{root,capabilities:{'memory.deterministic':'on'},h});
  assert.equal(h.timers.filter(x=>x.kind==='interval'&&x.unrefd).length,1,'one unref\'d idle timer');
  const npc=await store.create(profile());
  const timelineId=await store.createTimeline({label:'J-B'});
  const scope={characterId:npc.characterId,worldProfileId,timelineId};
  // Waiting until a timeline is confirmed: no work, no writes.
  assert.equal(runtime.services.memoryRetentionDiagnostics().state,'waiting');
  assert.equal((await runtime.retention.tick()).skipped,'timeline_not_writable');
  await confirm(store,timelineId);
  const funny=await exchange(store,npc.characterId,'funny',0,FUNNY,NPC_FUNNY);
  const mundane=await exchange(store,npc.characterId,'mundane',1200,MUNDANE,MUNDANE_NPC);
  assert.equal((await retained(store,scope)).length,0,'nothing retained before the runtime acts');

  const first=await runtime.retention.tick(); // first writable tick = startup recovery
  assert.equal(first.recovered,true);
  let rows=await retained(store,scope);
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0].envelope.sourceEvidenceIds.slice().sort(),[funny.playerId,funny.npcId].sort());
  assert.ok(!rows[0].envelope.sourceEvidenceIds.some(x=>x===mundane.playerId||x===mundane.npcId));
  assert.equal((await recall(store,scope)).rows.some(r=>r.recordId===rows[0].recordId),true,'M4 recall sees it');
  const before=JSON.stringify(rows.map(r=>[r.recordId,r.envelope.content]));
  {
    // M7 independence: retention enqueued no cloud-curation job.
    const db=new DatabaseSync(path.join(root,'p2.sqlite'),{readOnly:true});
    try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_curation_jobs').get().n,0);}
    finally{db.close();}
  }
  assert.equal(runtime.services.memoryRetentionDiagnostics().retention.retained,1);
  await runtime.retention.tick(); // idempotent
  assert.equal((await retained(store,scope)).length,1);

  // GTA restart: fresh process state, same SQLite file, new host run.
  await runtime.dispose();
  const h2=harness();
  ({runtime,store}=await boot(t,{root,capabilities:{'memory.deterministic':'on'},h:h2}));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await confirm(store,timelineId);
  assert.equal(JSON.stringify((await retained(store,scope)).map(r=>[r.recordId,r.envelope.content])),before,
    'retained memory exists after restart before any M6 work');
  assert.equal((await recall(store,scope)).rows.some(r=>r.recordId===rows[0].recordId),true,
    'existing M4 recall reads it after restart');
  const again=await runtime.retention.tick(); // startup recovery after restart
  assert.equal(again.recovered,true);
  assert.equal(JSON.stringify((await retained(store,scope)).map(r=>[r.recordId,r.envelope.content])),before,
    'recovery after restart creates no duplicate or new memory');
});

test('J-B: privacy safeguards hold through the runtime path (forgotten sources, pause)',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'memory-jb-privacy-'));
  const h=harness();
  const {runtime,store}=await boot(t,{root,capabilities:{'memory.deterministic':'on'},h});
  t.after(()=>rm(root,{recursive:true,force:true}));
  const npc=await store.create(profile());
  const timelineId=await store.createTimeline({label:'J-B privacy'});
  const scope={characterId:npc.characterId,worldProfileId,timelineId};
  await confirm(store,timelineId);
  const keep=await exchange(store,npc.characterId,'keep',0,FUNNY,NPC_FUNNY);
  const gone=await exchange(store,npc.characterId,'gone',600,
    'Remember when we blew up that gas station? That was absolutely incredible!',
    'Incredible! I will never forget that explosion, it was the best day of my life!');
  const privacy=createM5SqliteServices({store,filePath:path.join(root,'p2.sqlite'),authorize:()=>true});
  await privacy.ready({...scope,protagonistKey:'franklin'});
  for(const target of [gone.playerId,gone.npcId])
    await privacy.trash({scope:{...scope,protagonistKey:'franklin'},targetId:target,operationId:id()});
  await runtime.retention.tick();
  let ids=(await retained(store,scope)).flatMap(r=>r.envelope.sourceEvidenceIds);
  assert.ok(ids.includes(keep.playerId),'ordinary conversation retained');
  assert.ok(!ids.includes(gone.playerId)&&!ids.includes(gone.npcId),'forgotten conversation never retained');
  // Forgetting a retained memory's source after the fact removes it; later runs do not resurrect it.
  await privacy.trash({scope:{...scope,protagonistKey:'franklin'},targetId:keep.playerId,operationId:id()});
  assert.equal((await retained(store,scope)).length,0);
  runtime.retention.noteCommitted({characterId:npc.characterId});
  h.nowMs+=3600e3;
  await runtime.retention.tick();
  assert.equal((await retained(store,scope)).length,0,'replay does not resurrect a forgotten source');
  // Pause latch: no further retention work.
  const more=await exchange(store,npc.characterId,'more',2400,FUNNY+' Again!',NPC_FUNNY+' Again!');
  runtime.pauseLearnedMemory();
  runtime.retention.noteCommitted({characterId:npc.characterId});
  assert.equal((await runtime.retention.tick()).skipped,'unavailable');
  assert.ok(!(await retained(store,scope)).flatMap(r=>r.envelope.sourceEvidenceIds).includes(more.playerId));
});

test('J-B: foreground and scene timing - idle yields, scene close does not wait for quiet, dispose stops work',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'memory-jb-timing-'));
  const h=harness();
  const {runtime,store}=await boot(t,{root,capabilities:{'memory.deterministic':'on'},h});
  t.after(()=>rm(root,{recursive:true,force:true}));
  const npc=await store.create(profile());
  const timelineId=await store.createTimeline({label:'J-B timing'});
  const scope={characterId:npc.characterId,worldProfileId,timelineId};
  await confirm(store,timelineId);
  await runtime.retention.tick(); // startup recovery on an empty timeline
  // A conversation that just ended, inside M6's 90s quiet window.
  h.nowMs=BASE+100e3;
  const live=await exchange(store,npc.characterId,'live',70,FUNNY,NPC_FUNNY);
  const identity={pedId:101,sessionNonce:'jb-session'};
  runtime.retention.noteCommitted({characterId:npc.characterId,identity});
  assert.equal((await runtime.retention.tick()).skipped,'foreground_active','idle work yields to a live turn');
  h.nowMs=BASE+130e3; // grace passed? not yet (90s) -> still yielding
  assert.equal((await runtime.retention.tick()).skipped,'foreground_active');
  assert.equal((await retained(store,scope)).length,0);
  // Native session detach = scene close: retains immediately, off the detach path.
  runtime.retention.sceneClosed(identity);
  assert.equal((await retained(store,scope)).length,0,'detach itself does no M6 work synchronously');
  await new Promise(r=>setImmediate(r));
  for(let i=0;i<50&&(await retained(store,scope)).length===0;i++)await new Promise(r=>setImmediate(r));
  const rows=await retained(store,scope);
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0].envelope.sourceEvidenceIds.slice().sort(),[live.playerId,live.npcId].sort());
  // Dispose cancels timers and later hooks are inert.
  await runtime.dispose();
  assert.ok(h.cleared.length>=1,'idle timer cleared on dispose');
  runtime.retention.noteCommitted({characterId:npc.characterId,identity});
  assert.equal((await runtime.retention.tick()).skipped,'unavailable');
});
