// Requires the reviewed C composition prerequisite. No skip/fake positive when
// run against a pre-C tree. Native evidence/provider behavior is offline doubles.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {EventEmitter} from 'node:events';
import {createServer} from 'node:net';
import {createRuntimeForBundle} from '../src/bootstrap.mjs';
import {createEssentialMemoryStorage} from '../src/characters/memoryStorageAdapter.mjs';
import {ProfileStore} from '../src/characters/profileStore.mjs';
import {createConversationJournalRecorder} from '../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {profile} from './p2-fixtures.mjs';
import {worldProfileId,TestOwnerEvidence} from './identity-fixtures.mjs';
import {IDENTITY_DLL_SHA256,IDENTITY_METADATA_SHA256} from '../src/identity/nativeSupport.mjs';
import {CHARACTER_METADATA_SHA256} from '../src/characters/nativeSupport.mjs';
import {verifyPerceptionContract} from '../tools/verifyPerceptionContract.mjs';
import {d01Harness} from './memory/d01-harness.mjs';

async function setup(t,{source=false,editor=false}={}) {
  const directory=await mkdtemp(path.join(tmpdir(),'memory-storage-only-'));
  const runtimes=[];
  t.after(async()=>{for(const runtime of runtimes.reverse()) await runtime.dispose();await rm(directory,{recursive:true,force:true});});
  const sqlite=path.join(directory,'p2.sqlite'),legacy=path.join(directory,'profiles.v1.json');
  const config={provider:'openai',persistentIdentity:{enabled:true,worldProfileId,storePath:path.join(directory,'identity.json')},
    promotedCharacters:{enabled:true,storageMode:'sqlite',storePath:legacy,sqliteStorePath:sqlite},
    intelligence:{mode:source?'shadow':'off'},memoryK:{profile:'storage-only'}};
  if(editor) {
    const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
    config.promotedCharacters.editorPort=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  }
  const configPath=path.join(directory,'config.json');await writeFile(configPath,JSON.stringify(config));
  let effects=0,connects=0;
  const forbidden=()=>{effects++;throw new Error('provider_or_native_effect_forbidden');};
  const options={configPath,env:{},enableTelemetry:false,startCharacterEditor:editor,
    controlEndpointPath:null,identityEvidence:new TestOwnerEvidence(),
    identityContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,
      metadataSha256:IDENTITY_METADATA_SHA256,nativeProtocolChanged:false},
    characterContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,
      metadataSha256:CHARACTER_METADATA_SHA256,nativeProtocolChanged:false},
    fetchImpl:forbidden,nativeOwner:{request:async()=>({owned:[]})},
    intelligenceOptions:{connect:()=>{connects++;const socket=new EventEmitter();socket.destroy=()=>socket.emit('close');return socket;}}};
  if(source)options.perceptionContract=await verifyPerceptionContract();
  return {directory,sqlite,legacy,configPath,options,runtimes,effects:()=>effects,connects:()=>connects,
    start:async()=>{const runtime=await createRuntimeForBundle(options);runtimes.push(runtime);return runtime;}};
}
function rows(file) {
  const db=new DatabaseSync(file,{readOnly:true});
  try {
    const names=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
    return Object.fromEntries(names.map(name=>[name,db.prepare(`SELECT * FROM "${name.replaceAll('"','""')}"`).all()
      .sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
  }finally{db.close();}
}

test('canonical SQLite startup owns one writer and optional consumers cause no rows or cloud processing',async t=>{
  const f=await setup(t),runtime=await f.start();
  assert.equal(runtime.characterService.ready,true);
  assert.equal(runtime.services.memoryKRuntimeDiagnostics().capabilities['p2.sqlite'].state,'operational');
  for(const [id,row] of Object.entries(runtime.services.memoryKRuntimeDiagnostics().capabilities))
    if(id.startsWith('memory.')) {assert.equal(row.state,'stopped',id);assert.equal(row.effectiveMode,'off',id);}
  const before=rows(f.sqlite),turn={get m2Capture(){throw new Error('disabled_capture_touched');}};
  assert.equal(runtime.services.bindM2Turn({turn}),null);
  assert.equal(await runtime.services.recordM2Player({turn,source:'player_text',text:'not recorded'}),null);
  assert.equal(await runtime.services.recordM2Npc({turn}),null);
  assert.equal(await runtime.services.prepareLiveTurnMemory({turn}),null);
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(rows(f.sqlite),before);
  assert.equal(runtime.memoryM3,undefined);assert.equal(runtime.director,undefined);
  assert.equal(f.effects(),0);assert.equal(f.connects(),0);
  await assert.rejects(f.start(),/p2_sqlite_startup_failed/);
  assert.equal(runtime.characterService.ready,true,'failed sibling cannot retire the original writer');
  await runtime.dispose();assert.equal(runtime.characterService.ready,false);
  await assert.rejects(stat(f.sqlite+'.writer.lock'),{code:'ENOENT'});
});

test('storage-only keeps ordinary promoted profile/editor operations and persists them across fresh restart',async t=>{
  const f=await setup(t,{editor:true}),runtime=await f.start();
  const created=await runtime.characterService.store.create(profile());
  const html=await(await fetch(runtime.characterEditor.url)).text();
  const token=html.match(/const auth="([a-f0-9]{64})"/)?.[1];assert.ok(token);
  const response=await fetch(runtime.characterEditor.url+'/api',{method:'POST',
    headers:{'content-type':'application/json','x-lsa-editor':token,origin:runtime.characterEditor.url},
    body:JSON.stringify({action:'edit',characterId:created.characterId,expectedRevision:created.revision,patch:{biography:'Edited with optional memory off'}})});
  assert.equal(response.status,200);await response.json();
  const restarted=await runtime.restart();f.runtimes.push(restarted);
  assert.notEqual(restarted.characterService.store,runtime.characterService.store);
  assert.equal(restarted.characterService.store.get(created.characterId).biography,'Edited with optional memory off');
  assert.equal(restarted.memoryM3,undefined);assert.equal(f.effects(),0);
  const dbRows=rows(f.sqlite);assert.equal(dbRows.dialogue_journal.length,0);assert.equal(dbRows.event_journal.length,0);
});

test('JSON migration preserves profiles/manual memory, source JSON and backup without enabling capture',async t=>{
  const f=await setup(t),legacy=new ProfileStore({filePath:f.legacy,worldProfileId});await legacy.initialize();
  const created=await legacy.create(profile());
  const manual=await legacy.memory(created.characterId,'create',{expectedRevision:created.revision,
    patch:{text:'Existing manual note',importance:50,selectedForContext:true}});
  const before=await readFile(f.legacy,'utf8'),runtime=await f.start();
  assert.deepEqual(runtime.characterService.store.get(created.characterId),manual.profile);
  assert.equal(await readFile(f.legacy,'utf8'),before);
  assert.equal(await readFile(f.legacy+'.pre-sqlite.bak','utf8'),before);
  assert.equal(runtime.characterService.store.timelineWritable,false,'no automatic timeline confirmation');
  assert.equal(rows(f.sqlite).dialogue_journal.length,0);assert.equal(runtime.memoryM3,undefined);
});

test('retained journals, suppression records, schema and durability snapshots survive storage-only reopen',async t=>{
  const f=await setup(t),seed=createEssentialMemoryStorage({filePath:f.sqlite,worldProfileId,sourceRequired:true});
  await seed.initialize();const p=await seed.create(profile());const timelineId=await seed.createTimeline({label:'retained'});
  seed.setVerifiedHostContext({hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1});await seed.confirmTimeline(timelineId,{confirmation:timelineId});
  const recorder=createConversationJournalRecorder(seed),identity=n=>({pedId:101,turnId:n,generationId:'g1',sessionNonce:'seed'});
  await recorder.recordPlayerAccepted({characterId:p.characterId,identity:identity('original'),text:'private retained text',source:'typed',attribution:{protagonist:'franklin'}});
  await recorder.recordPlayerAccepted({characterId:p.characterId,identity:identity('forget'),text:'forget this',source:'typed',attribution:{protagonist:'franklin'}});
  const lines=await seed.readDialogueLines({characterId:p.characterId,timelineId}),original=lines.find(row=>row.content==='private retained text'),requestLine=lines.find(row=>row.content==='forget this');
  await seed.commitCommand({scope:{characterId:p.characterId,worldProfileId,timelineId,protagonistKey:'franklin'},
    commandId:randomUUID(),requestedByLineId:requestLine.recordId,operation:'forget',
    origin:'explicit_player',recordType:'dialogue_line',content:original.content,
    contentHash:createHash('sha256').update(original.content).digest('hex'),pin:false,
    evidenceRecordIds:[original.recordId,requestLine.recordId],targetRecordId:original.recordId,
    correctionMode:null,subjectCertainty:null,requestedAtUtc:requestLine.committedAtUtc});
  await seed.close();const before=rows(f.sqlite),snapshots=await readdir(f.sqlite+'.snapshots');
  const stableSnapshots=await Promise.all(snapshots.filter(name=>!name.startsWith('daily-')).map(async name=>
    ({name,bytes:await readFile(path.join(f.sqlite+'.snapshots',name))})));
  assert.ok(before.memory_tombstones.length>0);assert.ok(snapshots.length>0);
  const runtime=await f.start(),after=rows(f.sqlite);
  for(const table of ['dialogue_journal','event_journal','memory_tombstones','m5_trash']) assert.deepEqual(after[table],before[table],table);
  assert.equal(runtime.characterService.store.timelineWritable,false,'reopened retained data is not source authority');
  await runtime.dispose();
  // Existing durability policy coalesces same-day daily snapshots. Preserve
  // immutable weekly/pre-migration bytes and verify the replacement daily copy
  // retains both journal and suppression, rather than weakening retention.
  for(const {name,bytes} of stableSnapshots) assert.deepEqual(await readFile(path.join(f.sqlite+'.snapshots',name)),bytes);
  const daily=(await readdir(f.sqlite+'.snapshots')).find(name=>name.startsWith('daily-'));
  assert.ok(daily);const durable=rows(path.join(f.sqlite+'.snapshots',daily));
  assert.deepEqual(durable.dialogue_journal,before.dialogue_journal);
  assert.deepEqual(durable.memory_tombstones,before.memory_tombstones);
  assert.equal(f.effects(),0);
});

test('storage-only preserves independent authenticated source subscriptions without installing M3 event/coverage sinks',async t=>{
  const f=await setup(t,{source:true}),runtime=await f.start();
  assert.equal(f.connects(),1);assert.ok(runtime.intelligence);assert.ok(runtime.memoryD02);
  assert.equal(runtime.memoryM3,undefined);
  assert.equal(runtime.intelligence.memoryAuthoritySubscriptions.size,0,'no M3 authority/coverage subscription');
  assert.equal(runtime.intelligence.currentOwnerPlayerSubscriptions.size,1,'existing independent D02 remains');
  await runtime.dispose();
  assert.equal(runtime.intelligence.memoryAuthoritySubscriptions.size,0);
  assert.equal(runtime.intelligence.currentOwnerPlayerSubscriptions.size,0);assert.equal(f.effects(),0);
});

test('SQLite corruption fails explicitly and never creates replacement JSON or overwrites the database',async t=>{
  const f=await setup(t),bytes=Buffer.from('corrupt SQLite sentinel');await writeFile(f.sqlite,bytes);
  await assert.rejects(f.start(),/p2_sqlite_startup_failed/);
  assert.deepEqual(await readFile(f.sqlite),bytes);
  await assert.rejects(stat(f.legacy),{code:'ENOENT'});assert.equal(f.effects(),0);
});

test('original typed and mic turns still complete with storage-only and cannot record dialogue or invoke foreground consumers',
  {timeout:45000},async t=>{
  const x=await d01Harness(t,{config:{memoryK:{profile:'storage-only'}}});
  let foreground=0;
  x.h.runtime.services.prepareLiveTurnMemory=()=>{foreground++;throw new Error('foreground_must_remain_off');};
  const typed=await x.typed('Ordinary typed conversation with storage-only.');
  assert.equal((await x.settled(typed)).status,'completed');
  x.h.runtime.services.transcribe=async()=> 'Ordinary mic conversation with storage-only.';
  const mic=await x.mic();assert.equal((await x.settled(mic)).status,'completed');
  const journal=await x.journal();
  assert.equal(x.replies.length,2,'existing Essential provider/turn path stays usable');
  assert.equal(foreground,0);
  assert.deepEqual(journal.rows,[]);assert.deepEqual(journal.sources,[]);assert.deepEqual(journal.npcSources,[]);
});
