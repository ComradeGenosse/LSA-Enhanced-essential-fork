// Memory K: independent runtime activation of the EXISTING M7 Luna curation.
// Real createRuntimeForBundle + real P2 SQLite + the unmodified bridge, idle
// scheduler, lunaCurator and durable queue/ledger. The cloud is a fake fetch and
// native idle is a fake authenticated source: this is an offline source
// simulation. Nothing here is a GTA, native, paid-OpenAI or soak receipt; see
// docs/plans/memory-k-m7-independent-cloud-curation-20261016.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID as id} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createRuntimeForBundle} from '../src/bootstrap.mjs';
import {IDENTITY_DLL_SHA256,IDENTITY_METADATA_SHA256} from '../src/identity/nativeSupport.mjs';
import {CHARACTER_METADATA_SHA256} from '../src/characters/nativeSupport.mjs';
import {worldProfileId,TestOwnerEvidence} from './identity-fixtures.mjs';
import {profile} from './p2-fixtures.mjs';
import {createConversationJournalRecorder} from '../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {createM5SqliteServices} from '../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';
import {readCurationAppraisals} from '../../lsa-shared-brain/src/memory/curationSqlite.mjs';
import {M7_PRIORITY_QUIET_FIELDS} from '../../lsa-shared-brain/src/memory/m7Consent.mjs';
import {createInspectorControls} from '../src/memory/inspectorControls.mjs';
import {memoryKConsumersAllowed,memoryKM7Activation} from '../src/memory/runtimeComposition.mjs';
import {normalizeMemoryKConfig} from '../src/memory/capabilityPolicy.mjs';

const BASE=Date.parse('2026-10-16T12:00:00.000Z');
const at=s=>new Date(BASE+s*1000).toISOString();
const FUNNY='That was hilarious! The car completely flipped over the fence.';
const NPC_FUNNY='Ha, that was the funniest crash I have ever seen, I will never forget it!';
const FUNNY2='Remember the gas station? That was absolutely incredible and hilarious!';
const NPC_FUNNY2='Incredible! I will never forget that explosion, it was hilarious!';
const SECRET_KEY='sk-test-m7-credential';
const PRICING=Object.freeze({model:'gpt-6-luna',source:'operator_verified',
  verifiedAtUtc:'2026-10-12T00:00:00.000Z',officialPricingUrl:'https://developers.openai.com/api/docs/pricing',
  pricingTier:'standard',inputUsdPerMillionTokens:0.20,outputUsdPerMillionTokens:0.75});
const LIMITS=Object.freeze({dailyUsd:0.5,monthlyUsd:5,maxBatchUsd:0.05});
const runtimesByTest=new WeakMap();
async function cleanupRoot(t,root){
  // Node's after hooks run in registration order. Dispose every SQLite owner
  // before removing any shared test root, including restart/crash fixtures.
  for(const runtime of runtimesByTest.get(t)??[])await runtime.dispose();
  runtimesByTest.delete(t);
  await rm(root,{recursive:true,force:true});
}
const M7_ONLY={'memory.cloudCuration':'on','memory.recall':'off','memory.journalContext':'off',
  'memory.interpretation':'off','memory.deterministic':'off'};
const M6_AND_M7={'memory.deterministic':'on','memory.cloudCuration':'on'};
const turn=(label,pedId=101)=>({pedId,turnId:label,generationId:'gen-'+label,sessionNonce:'m7-session'});
const completed=i=>({...i,type:'playback_ended',reason:'completed',ok:true,
  wasInterrupted:false,hadAudio:true,playbackStarted:true});
const tick=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const settle=async()=>{for(let i=0;i<20;i++)await new Promise(resolve=>setImmediate(resolve));};

// One controllable clock shared by M6, M7 and the scheduler. No interval ever fires.
function harness(){
  const h={nowMs:BASE+6*3600e3,timers:[],cleared:[]};
  const base={now:()=>h.nowMs,
    setIntervalFn:(fn,ms)=>{const t={fn,ms,kind:'interval',unref(){t.unrefd=true;}};h.timers.push(t);return t;},
    setTimeoutFn:(fn,ms)=>{const t={fn,ms,kind:'timeout',unref(){t.unrefd=true;}};h.timers.push(t);return t;},
    clearIntervalFn:t=>h.cleared.push(t),clearTimeoutFn:t=>h.cleared.push(t)};
  h.m6=base;h.m7={...base,startupDelayMs:10_000};
  h.advance=sec=>{h.nowMs+=sec*1000;};
  return h;
}

// Fake Luna transport: echoes the proposals it was sent as valid grounded appraisals.
function fakeCloud(){
  const cloud={calls:[],hold:false,failStatus:0,waiters:[],started:[]};
  cloud.retryAfter=null;
  cloud.fetch=async(url,init)=>{
    const body=JSON.parse(init.body);
    const call={url,body,aborted:false,items:JSON.parse(body.input).items};
    cloud.calls.push(call);
    for(const resolve of cloud.started.splice(0))resolve(call);
    init.signal.addEventListener('abort',()=>{call.aborted=true;call.abortReason=String(init.signal.reason?.message);},{once:true});
    if(cloud.hold)await new Promise((resolve,reject)=>{
      cloud.waiters.push(resolve);
      init.signal.addEventListener('abort',()=>reject(init.signal.reason??new Error('aborted')),{once:true});
    });
    if(cloud.failStatus)return {ok:false,status:cloud.failStatus,
      headers:{get:name=>name==='retry-after'&&cloud.retryAfter?String(cloud.retryAfter):null},json:async()=>({})};
    const items=call.items.map(item=>({...item,candidate:'episode',notability:0.9,
      inCharacterTake:'I thought that was hilarious.'}));
    return {ok:true,status:200,headers:{get:()=>null},
      json:async()=>({output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({items})}]}],
        usage:{input_tokens:100,output_tokens:50}})};
  };
  cloud.nextCall=()=>new Promise(resolve=>cloud.started.push(resolve));
  cloud.release=()=>{cloud.hold=false;for(const resolve of cloud.waiters.splice(0))resolve();};
  return cloud;
}

// Fake AUTHENTICATED native idle producer. Real GTA has none yet (W07); this stands
// in for the future C-13 producer so the runtime path can be exercised offline.
function fakeNative(h){
  const native={quiet:true,characterId:null,worldProfileId,timelineId:null,hostRunId:null,issued:new WeakSet(),
    listeners:new Set(),ids:{session:id(),incarnation:id(),encounter:id()}};
  native.snapshot=()=>{
    if(!native.characterId||!native.timelineId||!native.hostRunId)return null;
    const proof={kind:'verified_native_idle_v1',nativeVerified:true,observedAtUtc:new Date(h.nowMs).toISOString(),
      hostRunId:native.hostRunId,worldEpoch:1,sessionId:native.ids.session,incarnationId:native.ids.incarnation,
      encounterId:native.ids.encounter,observerIndex:0,characterId:native.characterId,
      worldProfileId:native.worldProfileId,timelineId:native.timelineId,
      priorityEvidence:Object.fromEntries(M7_PRIORITY_QUIET_FIELDS.map(k=>[k,true])),
      idle:native.quiet,idleForMs:5000,micActive:false,playerSpeechActive:false,directorBusy:false,gamePaused:false};
    native.issued.add(proof);return proof;
  };
  native.verifyAuthenticatedSource=proof=>native.issued.has(proof);
  native.subscribeInvalidation=fn=>{native.listeners.add(fn);return ()=>native.listeners.delete(fn);};
  native.interrupt=()=>{native.quiet=false;for(const fn of [...native.listeners])fn();};
  return native;
}

async function boot(t,{root,capabilities,h=harness(),cloud=fakeCloud(),native=null,pricing=PRICING,
  env={OPENAI_REASONING_API_KEY:SECRET_KEY},model,extraMemoryK={}}){
  const configPath=path.join(root,'config.json');
  await writeFile(configPath,JSON.stringify({provider:'openai',...model?{reasoningModel:model}:{},
    persistentIdentity:{enabled:true,worldProfileId,storePath:path.join(root,'identity.json')},
    promotedCharacters:{enabled:true,storageMode:'sqlite',sqliteStorePath:path.join(root,'p2.sqlite'),
      storePath:path.join(root,'profiles.json')},
    memoryK:{capabilities,...pricing?{cloudCuration:{pricing}}:{},...extraMemoryK}}));
  const runtime=await createRuntimeForBundle({configPath,env,enableTelemetry:false,startCharacterEditor:false,
    identityEvidence:new TestOwnerEvidence(),
    identityContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,metadataSha256:IDENTITY_METADATA_SHA256,nativeProtocolChanged:false},
    characterContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,metadataSha256:CHARACTER_METADATA_SHA256,nativeProtocolChanged:false},
    fetchImpl:cloud.fetch,m6RetentionOptions:h.m6,m7CloudCurationOptions:h.m7,
    ...native?{m7NativeIdleSource:native}:{}});
  const runtimes=runtimesByTest.get(t)??[];runtimes.push(runtime);runtimesByTest.set(t,runtimes);
  return {runtime,store:runtime.characterService.store,h,cloud,native,configPath};
}
async function confirm(store,timelineId,native=null){
  const hostRunId=id();
  store.setVerifiedHostContext({hostContextVersion:1,hostRunId,worldEpoch:1});
  await store.confirmTimeline(timelineId);
  if(native){native.hostRunId=hostRunId;native.timelineId=timelineId;native.quiet=true;}
  return hostRunId;
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
const grant=(store,over={})=>store.grantM7Consent({...LIMITS,offTurnEvidenceUploadAccepted:true,
  model:'gpt-6-luna',...over});
const sql=(root,query,...params)=>{
  const db=new DatabaseSync(path.join(root,'p2.sqlite'),{readOnly:true});
  try{return db.prepare(query).all(...params).map(row=>({...row}));}finally{db.close();}
};
const jobStates=root=>sql(root,'SELECT state,attempt FROM memory_curation_jobs ORDER BY job_id');
const appraisals=root=>sql(root,'SELECT proposal_id FROM memory_luna_appraisals');
const reservations=root=>sql(root,'SELECT state,amount_usd FROM memory_budget_reservations ORDER BY reserved_at_utc');
// The request must be cut by M7's own synchronous cancel, not by a transport timeout.
const promptlyAborted=call=>{
  assert.equal(call.aborted,true,'in-flight request was aborted');
  assert.equal(call.abortReason,'m7_activity_or_source_changed','aborted by M7 cancel, not by a timeout');
};
const diag=runtime=>runtime.services.memoryCloudCurationDiagnostics();

// Phase A: M6 deterministic retention queues durable jobs, as a prior session would.
async function seed(t,{root,exchanges=[[FUNNY,NPC_FUNNY]],capabilities=M6_AND_M7}={}){
  const booted=await boot(t,{root,capabilities});
  const {runtime,store,h}=booted;
  const npcs=[];
  const timelineId=await store.createTimeline({label:'M7'});
  await confirm(store,timelineId);
  for(const [i,[p,n]] of exchanges.entries()){
    const npc=await store.create(profile({name:'NPC '+i}));
    npcs.push({characterId:npc.characterId,...await exchange(store,npc.characterId,'seed'+i,i*1200,p,n)});
  }
  assert.equal((await runtime.retention.tick()).recovered,true);
  assert.equal(jobStates(root).length,exchanges.length,'M6 queued one durable job per qualifying conversation');
  await runtime.dispose();
  return {timelineId,npcs,h};
}
// Phase B (restart): a new process, same SQLite file, new authenticated host run.
async function restart(t,{root,timelineId,npc,capabilities=M7_ONLY,...rest}){
  const h=rest.h??harness();
  const native=rest.native??fakeNative(h);
  const booted=await boot(t,{root,capabilities,h,native,...rest});
  await confirm(booted.store,timelineId,native);
  native.characterId=npc;
  return booted;
}
const nextTick=async(runtime,h,seconds=61)=>{h.advance(seconds);return runtime.cloudCuration.tick();};

test('activation: off by default, no timers, no network; M7 alone keeps the legacy foreground path',async t=>{
  for(const capabilities of [undefined,{},{'memory.deterministic':'on'},{'memory.cloudCuration':'off'}]){
    const root=await mkdtemp(path.join(tmpdir(),'m7-off-'));t.after(()=>cleanupRoot(t,root));
    const {runtime,h,cloud}=await boot(t,{root,capabilities});
    assert.equal(runtime.cloudCuration??null,null,'not constructed unless explicitly on');
    assert.equal(h.timers.filter(x=>x.ms===60_000&&x.kind==='interval').length,capabilities?.['memory.deterministic']==='on'?1:0);
    assert.equal(diag(runtime).state,'stopped');assert.equal(diag(runtime).effectiveMode,'off');
    assert.equal(cloud.calls.length,0);
    await runtime.dispose();
  }
  assert.equal(memoryKM7Activation({memoryK:{capabilities:{'memory.cloudCuration':'on'}}}).mode,'on');
  assert.equal(memoryKM7Activation({memoryK:{capabilities:{}}}).mode,'off');
  assert.equal(memoryKConsumersAllowed({memoryK:{capabilities:{'memory.cloudCuration':'on'}}}),true,
    'requesting M7 alone must not switch off existing memory');
  assert.equal(memoryKConsumersAllowed({memoryK:{capabilities:{'memory.cloudCuration':'on','memory.recall':'off'}}}),false);
  assert.throws(()=>normalizeMemoryKConfig({capabilities:{'memory.cloudCuration':'shadow'}}),/mode is unsupported/);
  assert.throws(()=>normalizeMemoryKConfig({cloudCuration:{pricing:{model:'x'}}}),/pricing is invalid/);
});

test('activation: awaiting consent makes no network request; unsupported Luna configuration is blocked with a reason',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'m7-await-'));t.after(()=>cleanupRoot(t,root));
  const seeded=await seed(t,{root});
  const {runtime,h,cloud}=await restart(t,{root,timelineId:seeded.timelineId,npc:seeded.npcs[0].characterId});
  assert.equal(diag(runtime).state,'starting','nothing evaluated before the first tick');
  assert.equal(h.timers.filter(x=>x.kind==='interval'&&x.unrefd&&x.ms===60_000).length,1,'one unref\'d timer');
  const first=await runtime.cloudCuration.tick();
  assert.equal(first.skipped,'consent_not_granted');
  assert.equal(diag(runtime).state,'awaiting_consent');assert.equal(diag(runtime).effectiveMode,null);
  assert.equal(diag(runtime).cloudCuration.consent.state,'not_granted');
  assert.equal(cloud.calls.length,0,'no consent => no request, with eligible queued work and idle proof present');
  assert.deepEqual(jobStates(root).map(j=>j.state),['pending']);
  assert.equal(reservations(root).length,0);

  // Every unsupported provider/pricing/credential case is blocked before any scheduler exists.
  const stale={...PRICING,verifiedAtUtc:'2026-08-01T00:00:00.000Z'};
  const cheap={...PRICING,inputUsdPerMillionTokens:0.01};
  const cases=[
    ['no pricing',{pricing:null},'luna_pricing_missing'],
    ['stale price attestation',{pricing:stale},'m7_official_standard_luna_price_attestation_required'],
    ['price below the reviewed upper bound',{pricing:cheap},'m7_official_standard_luna_price_attestation_required'],
    ['non-Luna model',{model:'gpt-5'},'curation_requires_luna_model'],
    ['missing credential',{env:{}},'luna_credential_missing'],
  ];
  for(const [label,over,reason] of cases){
    const r2=await mkdtemp(path.join(tmpdir(),'m7-unsupported-'));t.after(()=>cleanupRoot(t,r2));
    const s2=await seed(t,{root:r2});
    const b=await restart(t,{root:r2,timelineId:s2.timelineId,npc:s2.npcs[0].characterId,...over});
    await grant(b.store);
    const out=await b.runtime.cloudCuration.tick();
    assert.equal(out.skipped,reason,label);
    assert.equal(diag(b.runtime).state,'blocked',label);assert.equal(b.cloud.calls.length,0,label);
    assert.equal(reservations(r2).length,0,label);
  }
});

test('independence: queued jobs are processed with M6, M4 recall, H1 history and M8 interpretation all off; results survive restart',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'m7-indep-'));t.after(()=>cleanupRoot(t,root));
  const seeded=await seed(t,{root});
  const npcId=seeded.npcs[0].characterId;
  const {runtime,store,h,cloud}=await restart(t,{root,timelineId:seeded.timelineId,npc:npcId});
  assert.equal(runtime.retention??null,null,'M6 is disabled');
  const caps=runtime.services.memoryKRuntimeDiagnostics().capabilities;
  for(const id2 of ['memory.recall','memory.journalContext','memory.interpretation','memory.deterministic'])
    assert.equal(caps[id2].requestedMode,'off',id2+' is off');
  await grant(store);
  const out=await runtime.cloudCuration.tick();
  assert.equal(out.status,'completed');assert.equal(out.processed,1);
  assert.equal(cloud.calls.length,1,'exactly one Luna request');
  assert.equal(cloud.calls[0].url,'https://api.openai.com/v1/responses');
  assert.equal(cloud.calls[0].body.model,'gpt-6-luna');
  assert.deepEqual(jobStates(root),[{state:'completed',attempt:0}]);
  assert.equal(appraisals(root).length,1);
  const d=diag(runtime);
  assert.equal(d.state,'idle');assert.equal(d.effectiveMode,'on');
  assert.equal(d.cloudCuration.curatedThisRun,1);assert.equal(d.cloudCuration.queue.completed,1);
  assert.equal(d.cloudCuration.consent.state,'granted');
  assert.ok(d.cloudCuration.budget.spentTodayUsd>0&&d.cloudCuration.budget.spentTodayUsd<=LIMITS.maxBatchUsd);
  assert.equal(reservations(root).every(r=>r.state==='settled'),true);
  // Diagnostics are content-free: no memory text, credentials or ids.
  const text=JSON.stringify(runtime.services.memoryKRuntimeDiagnostics());
  for(const secret of [SECRET_KEY,FUNNY,NPC_FUNNY,npcId])assert.ok(!text.includes(secret),'diagnostics leak');
  await runtime.dispose();

  // GTA restart: appraisal persists, the completed job is not curated (or billed) again.
  const second=await restart(t,{root,timelineId:seeded.timelineId,npc:npcId});
  assert.equal(appraisals(root).length,1,'curated memory persisted across restart');
  const db=new DatabaseSync(path.join(root,'p2.sqlite'),{readOnly:true});
  try{
    const rows=readCurationAppraisals(db,{characterId:npcId,timelineId:seeded.timelineId,protagonistKey:'franklin'},worldProfileId);
    assert.equal(rows.length,1);assert.equal(rows[0].epistemicStatus,'character_opinion');
  }finally{db.close();}
  assert.equal(diag(second.runtime).cloudCuration.consent.state==='granted'||diag(second.runtime).state==='starting',true);
  const again=await second.runtime.cloudCuration.tick();
  assert.equal(again.status,'empty');assert.equal(second.cloud.calls.length,0,'idempotent: no duplicate request');
  assert.equal(diag(second.runtime).cloudCuration.consent.state,'granted','consent survived the restart');
});

test('M6 enqueues for M7 only when M7 is independently on; both can run together',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'m7-m6-'));t.after(()=>cleanupRoot(t,root));
  const m6only=await mkdtemp(path.join(tmpdir(),'m7-m6only-'));t.after(()=>cleanupRoot(t,m6only));
  const a=await boot(t,{root:m6only,capabilities:{'memory.deterministic':'on'}});
  assert.equal(diag(a.runtime).state,'stopped');
  assert.equal(a.runtime.services.memoryRetentionDiagnostics().cloudCuration,'off');
  await a.runtime.dispose();
  const seeded=await seed(t,{root});
  assert.equal(jobStates(root).length,1,'M6 queued a durable job because M7 is on');
  // Both on, in one process: M6 keeps retaining; M7 curates what M6 queued.
  const h=seeded.h,native=fakeNative(h);
  const both=await boot(t,{root,capabilities:M6_AND_M7,native,h});
  await confirm(both.store,seeded.timelineId,native);native.characterId=seeded.npcs[0].characterId;
  await grant(both.store);
  assert.equal(both.runtime.services.memoryRetentionDiagnostics().cloudCuration,'queueing');
  const out=await both.runtime.cloudCuration.tick();
  assert.equal(out.status,'completed');
  assert.equal(both.runtime.retention.diagnostics().state,'ready');
});

test('consent withdrawal mid-flight cancels the request, commits nothing stale and stays withdrawn after restart',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'m7-withdraw-'));t.after(()=>cleanupRoot(t,root));
  const seeded=await seed(t,{root});const npcId=seeded.npcs[0].characterId;
  const {runtime,store,h,cloud}=await restart(t,{root,timelineId:seeded.timelineId,npc:npcId});
  await grant(store);
  cloud.hold=true;
  const started=cloud.nextCall();
  const running=runtime.cloudCuration.tick();
  await started;
  assert.equal(diag(runtime).state,'processing');
  await store.withdrawM7Consent({});
  await settle();promptlyAborted(cloud.calls[0]);
  const out=await running;
  assert.equal(out.status,'cancelled');
  cloud.release();await settle();
  assert.equal(appraisals(root).length,0,'a late provider result is never committed');
  assert.notEqual(jobStates(root)[0].state,'completed');
  // The transport had started, so the uncertain spend stays charged at the ceiling.
  assert.deepEqual(reservations(root),[{state:'settled',amount_usd:LIMITS.maxBatchUsd}]);
  const next=await nextTick(runtime,h);
  assert.equal(next.skipped,'consent_withdrawn');
  assert.equal(diag(runtime).state,'awaiting_consent');assert.equal(cloud.calls.length,1,'no further requests');
  await runtime.dispose();
  const again=await restart(t,{root,timelineId:seeded.timelineId,npc:npcId});
  assert.equal((await again.runtime.cloudCuration.tick()).skipped,'consent_withdrawn');
  assert.equal(again.cloud.calls.length,0,'withdrawal persists across restart');
  // An explicit new approval is a new revision and resumes the retained job.
  await grant(again.store);
  const resumed=await nextTick(again.runtime,again.h);
  assert.equal(resumed.status,'completed');assert.equal(appraisals(root).length,1);
});

test('idle interruption: native activity, a turn starting and shutdown all abort in-flight cloud work without committing',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'m7-idle-'));t.after(()=>cleanupRoot(t,root));
  const seeded=await seed(t,{root});const npcId=seeded.npcs[0].characterId;
  const {runtime,store,h,cloud,native}=await restart(t,{root,timelineId:seeded.timelineId,npc:npcId});
  await grant(store);
  cloud.hold=true;
  // 1. Gameplay resumes (native producer reports activity).
  let started=cloud.nextCall();
  let running=runtime.cloudCuration.tick();await started;
  native.interrupt();
  await settle();promptlyAborted(cloud.calls.at(-1));
  assert.equal((await running).status,'cancelled');
  assert.equal(diag(runtime).state,'idle');assert.equal(diag(runtime).reason,'interrupted_by_activity');
  assert.equal(appraisals(root).length,0);
  // While the world is not idle, nothing is claimed or sent.
  const before=cloud.calls.length;
  h.advance(61);assert.equal((await runtime.cloudCuration.tick()).status,'source_unverified');
  assert.equal(cloud.calls.length,before);assert.equal(diag(runtime).reason,'awaiting_idle_window');
  // 2. A new player/NPC turn begins in the host (same hook the glue calls).
  native.quiet=true;h.advance(61);
  started=cloud.nextCall();running=runtime.cloudCuration.tick();await started;
  await runtime.services.prepareLiveTurnMemory({});
  await settle();promptlyAborted(cloud.calls.at(-1));
  assert.equal((await running).status,'cancelled');
  // Recently active turn keeps M7 quiet even if the native source says idle.
  assert.equal((await runtime.cloudCuration.tick()).skipped,'foreground_active');
  // 3. Orderly shutdown.
  h.advance(120);started=cloud.nextCall();running=runtime.cloudCuration.tick();await started;
  await runtime.dispose();
  promptlyAborted(cloud.calls.at(-1));
  assert.equal(['cancelled','failed_closed'].includes((await running).status),true);
  assert.equal(appraisals(root).length,0);
  assert.ok(h.cleared.length>=1,'timers cleared');
  cloud.release();
  // 4. After all of that the interrupted job is still eligible and completes once idle returns.
  const final=await restart(t,{root,timelineId:seeded.timelineId,npc:npcId,cloud:fakeCloud()});
  await final.cloud.release();
  const done=await nextTick(final.runtime,final.h,600);
  assert.equal(done.status,'completed');assert.equal(appraisals(root).length,1);
});

test('learned-memory pause cancels in-flight curation and latches M7 off',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'m7-pause-'));t.after(()=>cleanupRoot(t,root));
  const seeded=await seed(t,{root});
  const {runtime,store,cloud}=await restart(t,{root,timelineId:seeded.timelineId,npc:seeded.npcs[0].characterId});
  await grant(store);cloud.hold=true;
  const started=cloud.nextCall();const running=runtime.cloudCuration.tick();await started;
  runtime.pauseLearnedMemory();
  await settle();promptlyAborted(cloud.calls[0]);
  assert.notEqual((await running).status,'completed');
  cloud.release();await settle();
  assert.equal(appraisals(root).length,0);
  assert.equal(diag(runtime).state,'paused');assert.equal(diag(runtime).effectiveMode,'off');
  assert.equal((await runtime.cloudCuration.tick()).skipped,'learned_memory_paused');
  assert.equal(cloud.calls.length,1);
});

test('privacy: forgetting a source mid-flight or before claim is never curated or resurrected',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'m7-forget-'));t.after(()=>cleanupRoot(t,root));
  const seeded=await seed(t,{root,exchanges:[[FUNNY,NPC_FUNNY],[FUNNY2,NPC_FUNNY2]]});
  const [a,b]=seeded.npcs;
  const {runtime,store,h,cloud,native}=await restart(t,{root,timelineId:seeded.timelineId,npc:a.characterId});
  await grant(store);
  const scope=c=>({characterId:c,worldProfileId,timelineId:seeded.timelineId,protagonistKey:'franklin'});
  const privacy=createM5SqliteServices({store,filePath:path.join(root,'p2.sqlite'),authorize:()=>true});
  await privacy.ready(scope(a.characterId));
  // Forgotten BEFORE the claim: never sent, dead-lettered, not resurrected.
  await privacy.trash({scope:scope(a.characterId),targetId:a.playerId,operationId:id()});
  const none=await runtime.cloudCuration.tick();
  assert.notEqual(none.status,'completed');assert.equal(cloud.calls.length,0,'forgotten source is not uploaded');
  assert.ok(jobStates(root).some(j=>j.state==='dead_letter'));
  // The other NPC is unaffected and curated alone (per-NPC isolation).
  native.characterId=b.characterId;
  const ok=await nextTick(runtime,h);
  assert.equal(ok.status,'completed');assert.equal(cloud.calls.length,1);
  assert.ok(cloud.calls[0].items.every(item=>item.characterId===b.characterId),'one NPC per request');
  assert.ok(!JSON.stringify(cloud.calls[0].body).includes(a.playerId),'other NPC memories are never transmitted');
  // Forgotten AFTER curation: the opinion disappears and later runs cannot revive it.
  await privacy.ready(scope(b.characterId));
  await privacy.trash({scope:scope(b.characterId),targetId:b.playerId,operationId:id()});
  const db=new DatabaseSync(path.join(root,'p2.sqlite'),{readOnly:true});
  try{assert.equal(readCurationAppraisals(db,{characterId:b.characterId,timelineId:seeded.timelineId,protagonistKey:'franklin'},worldProfileId).length,0);}
  finally{db.close();}
  await nextTick(runtime,h);await nextTick(runtime,h);
  assert.equal(cloud.calls.length,1,'no new request resurrects forgotten memories');
});

test('privacy: forgetting a source while the request is in flight prevents the stale result from committing',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'m7-forget-flight-'));t.after(()=>cleanupRoot(t,root));
  const seeded=await seed(t,{root});const [a]=seeded.npcs;
  const {runtime,store,h,cloud}=await restart(t,{root,timelineId:seeded.timelineId,npc:a.characterId});
  await grant(store);cloud.hold=true;
  const started=cloud.nextCall();const running=runtime.cloudCuration.tick();await started;
  const scope={characterId:a.characterId,worldProfileId,timelineId:seeded.timelineId,protagonistKey:'franklin'};
  const privacy=createM5SqliteServices({store,filePath:path.join(root,'p2.sqlite'),authorize:()=>true});
  await privacy.ready(scope);
  await privacy.trash({scope,targetId:a.playerId,operationId:id()});
  cloud.release();
  const out=await running;
  assert.notEqual(out.status,'completed');
  assert.equal(appraisals(root).length,0,'stale result for a forgotten source is rejected');
  const later=await nextTick(runtime,h);
  assert.notEqual(later.status,'completed');assert.equal(cloud.calls.length,1);
  assert.equal(appraisals(root).length,0);
});

test('cloud outage: conversations and deterministic retention continue, retry is durable, spend is conservative, then recovers',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'m7-outage-'));t.after(()=>cleanupRoot(t,root));
  const seeded=await seed(t,{root});const npcId=seeded.npcs[0].characterId;
  const h=seeded.h,native=fakeNative(h),cloud=fakeCloud();
  const {runtime,store}=await boot(t,{root,capabilities:M6_AND_M7,native,h,cloud});
  await confirm(store,seeded.timelineId,native);native.characterId=npcId;
  await grant(store,{dailyUsd:0.12,monthlyUsd:5,maxBatchUsd:0.05});
  cloud.failStatus=429;cloud.retryAfter=600;
  const out=await runtime.cloudCuration.tick();
  assert.equal(out.status,'retry_scheduled');
  assert.deepEqual(jobStates(root),[{state:'pending',attempt:1}],'durable retry with a persisted attempt');
  assert.equal(diag(runtime).state,'idle');assert.equal(diag(runtime).reason,'cloud_unavailable_retry_scheduled');
  assert.deepEqual(reservations(root),[{state:'settled',amount_usd:0.05}],'failed transport is charged at the ceiling');
  const [pending]=sql(root,'SELECT next_attempt_at_utc AS due FROM memory_curation_jobs');
  assert.ok(Date.parse(pending.due)>=h.nowMs+599_000,'provider Retry-After is honoured durably');
  // Provider recovers but the retry window has not opened: nothing is sent.
  cloud.failStatus=0;
  const early=await nextTick(runtime,h,61);
  assert.equal(early.status,'empty');assert.equal(cloud.calls.length,1,'no request before Retry-After elapses');
  // Normal capture and deterministic retention are untouched by the outage.
  const fresh=await exchange(store,npcId,'during-outage',2400,FUNNY2,NPC_FUNNY2);
  runtime.retention.noteCommitted({characterId:npcId});
  h.advance(3600);
  assert.equal((await runtime.retention.tick()).processed>=1,true);
  const rows=await store.readPermanentMemoryRows({characterId:npcId,worldProfileId,timelineId:seeded.timelineId,protagonistKey:'franklin'});
  assert.ok(rows.some(r=>r.envelope.sourceEvidenceIds.includes(fresh.playerId)),'new memory retained during outage');
  // The retry window is open: the retained job and the one M6 queued meanwhile are curated
  // together in ONE request (same NPC); spend never exceeds the caps.
  const ok=await runtime.cloudCuration.tick();
  assert.equal(ok.status,'completed');assert.equal(ok.processed,2);assert.equal(cloud.calls.length,2);
  assert.equal(cloud.calls[1].items.length,2);
  assert.ok(diag(runtime).cloudCuration.budget.spentTodayUsd<=0.12);
  assert.equal(jobStates(root).filter(j=>j.state==='completed').length,2);
  assert.equal(appraisals(root).length,2);
});

test('crash recovery: stale leases are re-claimed once and unresolved reservations stay charged at the ceiling',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'m7-crash-'));t.after(()=>cleanupRoot(t,root));
  const seeded=await seed(t,{root});const npcId=seeded.npcs[0].characterId;
  // A previous process leased the job and reserved budget, then died mid-request.
  const first=await restart(t,{root,timelineId:seeded.timelineId,npc:npcId});
  const lease=await first.store.claimCurationDue({limit:1,nowUtc:new Date(first.h.nowMs).toISOString(),
    leaseUntilUtc:new Date(first.h.nowMs+90_000).toISOString(),ownerId:id(),characterId:npcId});
  assert.equal(lease.length,1);
  assert.equal(await first.store.reserveCurationBudget({batchKey:'crashed-batch',maxUsd:0.05,
    nowUtc:new Date(first.h.nowMs).toISOString()},{dailyUsd:LIMITS.dailyUsd,monthlyUsd:LIMITS.monthlyUsd}),true);
  await grant(first.store);
  await first.runtime.dispose();
  assert.equal(reservations(root)[0].state,'reserved');
  // Restart: recovery settles the uncertain reservation at its ceiling (never a refund).
  const h=harness();h.nowMs+=3600e3; // after the dead process's lease expired
  const second=await restart(t,{root,timelineId:seeded.timelineId,npc:npcId,h});
  const out=await second.runtime.cloudCuration.tick();
  assert.equal(out.status,'completed');assert.equal(second.cloud.calls.length,1,'processed exactly once');
  const resv=reservations(root);
  assert.equal(resv.find(r=>true).state,'settled');assert.equal(resv.find(r=>true).amount_usd,0.05);
  assert.equal(resv.filter(r=>r.state==='reserved').length,0);
  assert.equal(second.runtime.cloudCuration.diagnostics().recovered,true);
  assert.equal(appraisals(root).length,1);
});

test('budget exhaustion blocks further requests until the cap allows another batch',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'m7-budget-'));t.after(()=>cleanupRoot(t,root));
  const seeded=await seed(t,{root});const npcId=seeded.npcs[0].characterId;
  const {runtime,store,h,cloud}=await restart(t,{root,timelineId:seeded.timelineId,npc:npcId});
  await grant(store,{dailyUsd:0.05,monthlyUsd:0.05,maxBatchUsd:0.05});
  cloud.failStatus=503;
  assert.equal((await runtime.cloudCuration.tick()).status,'retry_scheduled');
  cloud.failStatus=0;
  const blocked=await nextTick(runtime,h,120);
  assert.equal(blocked.status,'budget_blocked');
  assert.equal(diag(runtime).state,'blocked');assert.equal(diag(runtime).reason,'budget_exhausted');
  assert.equal(cloud.calls.length,1,'no request without budget headroom');
  assert.notEqual(jobStates(root)[0].state,'completed');
});

test('multi-NPC isolation, missing native source and the inspector consent controls',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'m7-controls-'));t.after(()=>cleanupRoot(t,root));
  const seeded=await seed(t,{root});const npcId=seeded.npcs[0].characterId;
  // No authenticated native producer registered (the pinned-Core reality today): blocked, no network.
  const h=harness(),cloud=fakeCloud();
  const noSource=await boot(t,{root,capabilities:M7_ONLY,h,cloud});
  await confirm(noSource.store,seeded.timelineId);
  await grant(noSource.store);
  const blocked=await noSource.runtime.cloudCuration.tick();
  assert.equal(blocked.skipped,'native_idle_source_unavailable');
  assert.equal(diag(noSource.runtime).state,'blocked');assert.equal(cloud.calls.length,0);
  assert.equal(diag(noSource.runtime).cloudCuration.nativeIdle,'source_unavailable');
  // A caller-built proof that the source cannot authenticate is never enough.
  const forged=fakeNative(h);
  forged.verifyAuthenticatedSource=()=>false;
  await noSource.runtime.dispose();
  const f2=await restart(t,{root,timelineId:seeded.timelineId,npc:npcId,native:forged,h,cloud});
  assert.equal((await f2.runtime.cloudCuration.tick()).status,'source_unverified');
  assert.equal(cloud.calls.length,0);await f2.runtime.dispose();

  // Inspector: explicit approval flows, confirmation is mandatory, withdrawal always works.
  const b=await restart(t,{root,timelineId:seeded.timelineId,npc:npcId});
  const controls=createInspectorControls({runtime:b.runtime,configPath:b.configPath});
  const view=await controls.snapshot();
  assert.equal(view.cloudCuration.requestedMode,'on');
  assert.equal(view.cloudCuration.consent.state==='granted'||view.cloudCuration.consent.state==='not_granted',true);
  await assert.rejects(controls.change({operation:'cloud_consent',action:'grant',...LIMITS}),/confirmation_required/);
  await assert.rejects(controls.change({operation:'cloud_consent',action:'grant',confirmation:'approve_off_turn_evidence_upload',
    dailyUsd:0.01,monthlyUsd:1,maxBatchUsd:0.5}),/consent_and_budget/);
  const granted=await controls.change({operation:'cloud_consent',action:'grant',
    confirmation:'approve_off_turn_evidence_upload',...LIMITS});
  assert.equal(granted.cloudCuration.consent.state,'granted');
  assert.deepEqual(granted.cloudCuration.consent.limits,LIMITS);
  const withdrawn=await controls.change({operation:'cloud_consent',action:'withdraw'});
  assert.equal(withdrawn.cloudCuration.consent.state,'withdrawn');
  await assert.rejects(controls.change({operation:'cloud_consent',action:'bogus'}),/invalid_cloud_consent/);
});
