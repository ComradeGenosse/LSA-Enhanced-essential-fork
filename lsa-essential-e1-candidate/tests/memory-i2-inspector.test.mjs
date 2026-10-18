import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {writeFile,readFile} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {p2Fixture} from './memory/h2-p2-fixture.mjs';
import {fixture,profile} from './p2-fixtures.mjs';
import {createRuntimeForBundle} from '../src/bootstrap.mjs';
import {createInspectorControls} from '../src/memory/inspectorControls.mjs';
import {createInspectorAdministration} from '../src/memory/inspectorAdministration.mjs';
import {createLearnedMemoryPause} from '../src/memory/learnedMemoryPause.mjs';
import {startCharacterEditor} from '../src/characters/editorServer.mjs';
import {createM5SqliteServices} from '../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';
import {IDENTITY_DLL_SHA256,IDENTITY_METADATA_SHA256} from '../src/identity/nativeSupport.mjs';
import {CHARACTER_METADATA_SHA256} from '../src/characters/nativeSupport.mjs';
import {MEMORY_K_CAPABILITIES} from '../src/memory/capabilityPolicy.mjs';
import {createHarness} from './m3-production-harness.mjs';
import {makeQueueJob} from '../../lsa-shared-brain/src/memory/queueContract.mjs';
import {prepareH1ConversationHistory} from '../src/memory/h1ConversationHistory.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const contract=metadataSha256=>({available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,metadataSha256,nativeProtocolChanged:false});
const request=(url,{headers={},body=null}={})=>new Promise((resolve,reject)=>{
  const req=http.request(url,{method:body===null?'GET':'POST',headers},res=>{
    const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString('utf8')}));
  });req.on('error',reject);req.end(body===null?'':JSON.stringify(body));
});
async function setup(t,{editor=false,pauseLearned=false}={}){
  const f=await p2Fixture(t);
  const configPath=path.join(path.dirname(f.filePath),'i2.config.json');
  const config={provider:'openai',persistentIdentity:{enabled:true,worldProfileId:f.store.worldProfileId,storePath:configPath+'.identity'},
    promotedCharacters:{enabled:true,storageMode:'sqlite',sqliteStorePath:f.filePath,storePath:configPath+'.profiles'},
    memoryK:{profile:'storage-only',capabilities:{'memory.inspector':'on'},pauseLearned},intelligence:{mode:'off'}};
  await writeFile(configPath,JSON.stringify(config));
  const x=await fixture(t,{store:f.store,config});
  const options={configPath,env:{},profileStore:f.store,identityEvidence:x.evidence,nativeOwner:x.native,
    identityContract:contract(IDENTITY_METADATA_SHA256),characterContract:contract(CHARACTER_METADATA_SHA256),
    startCharacterEditor:false,enableTelemetry:false,fetchImpl:()=>{throw Error('unexpected_provider');}};
  const runtime=await createRuntimeForBundle(options);t.after(()=>runtime.dispose());
  const controls=createInspectorControls({runtime,configPath});
  let access=true;
  const admin=createInspectorAdministration(runtime.characterService,{accessCurrent:()=>access});
  const scope=f.scope(0,'unknown');
  const inspect=(kind='facts',extra={})=>admin.execute({operation:'inspect',scope,kind,offset:0,...extra});
  const change=(operation,recordId,extra={})=>admin.execute({operation,scope,recordId,
    confirmation:recordId,operationId:randomUUID(),...extra});
  const keep=async(content,character=0)=>{
    const source=await f.say(content,{character});
    const sc=f.scope(character);
    const line=(await f.store.readDialogueLines({...sc,limit:10})).find(r=>r.recordId===source.recordId);
    const commandId=randomUUID();
    await f.store.commitCommand({scope:sc,commandId,operation:'remember',requestedByLineId:line.recordId,
      evidenceRecordIds:[line.recordId],content,contentHash:hash(content),requestedAtUtc:line.committedAtUtc});
    return commandId;
  };
  let server,call,page;
  if(editor){
    server=await startCharacterEditor(runtime.characterService,{port:0,inspectorControls:controls});t.after(()=>server.close());
    page=await request(server.url);const token=page.text.match(/const auth="([a-f0-9]{64})"/)[1];
    call=async(body,headers={})=>{
      const r=await request(server.url+'/api',{headers:{origin:server.url,'content-type':'application/json','x-lsa-editor':token,...headers},body});
      return {...r,json:JSON.parse(r.text)};
    };
  }
  return {...f,configPath,runtime,controls,admin,scope,inspect,change,keep,server,call,page,revoke:()=>{access=false;}};
}

test('I2 real editor lists NPCs and separates raw conversations, NPC speech, facts, events and empty states with I1/H1/H2/M6/M7/M8 off',async t=>{
  const f=await setup(t,{editor:true});
  const fact=await f.keep('I2 private factual claim');
  await f.say('I2 raw conversation');await f.say('I2 NPC reply',{speaker:'npc'});await f.say('Other NPC secret',{character:1});
  await f.event(1);
  assert.equal(f.page.status,200);assert.ok(f.page.text.includes('Pause Learned Memory'));
  assert.ok(f.page.text.includes('Stored learned memory inspector'));
  const list=await f.call({action:'list'});assert.equal(list.json.length,2);
  const context=await f.call({action:'inspector_context'});assert.equal(context.json.ready,true);
  for(const kind of ['facts','conversations','npc_dialogue','events','corrections','suppressed']){
    const r=await f.call({action:'inspector_memory',operation:'inspect',scope:f.scope,kind,offset:0});
    assert.equal(r.status,200,r.text);assert.ok(!r.text.includes('Other NPC secret'));
    if(['corrections','suppressed'].includes(kind))assert.deepEqual(r.json.items,[]);
    if(kind==='facts'){assert.equal(r.json.items[0].recordId,fact);assert.equal(r.json.items[0].mode,'reported_claim');assert.equal(r.json.items[0].recall,'eligible_in_p2');}
    if(kind==='conversations')assert.ok(r.json.items.every(r=>r.category.endsWith('_raw')));
    if(kind==='events')assert.equal(r.json.items[0].category,'event_memory');
  }
  const status=await f.controls.snapshot();
  for(const {id} of MEMORY_K_CAPABILITIES.filter(d=>(d.id.startsWith('memory.')||d.id.startsWith('events.'))&&d.id!=='memory.inspector'))
    assert.equal(f.runtime.services.memoryKRuntimeDiagnostics().capabilities[id].effectiveMode,'off',id);
  assert.equal(status.capabilities.find(r=>r.id==='memory.inspector').effectiveMode,'on');
});

test('I2 authorized factual correction supersedes old fact and descendants, preserves raw source and provenance, and is idempotent',async t=>{
  const f=await setup(t),recordId=await f.keep('I2 old red garage');
  const source=(await f.inspect('conversations')).items[0].recordId;
  const proposal={...f.scope,proposalId:randomUUID(),kind:'curation_proposal',provider:'deterministic',
    evidenceRecordIds:[source],groundedSummary:'I2 old red garage derived sibling',notability:.6};
  await f.store.saveDeterministicMemory(proposal);
  const nowUtc=new Date().toISOString();
  await f.store.enqueueCurationJob({job:makeQueueJob(proposal,nowUtc)});
  const [lease]=await f.store.claimCurationDue({limit:1,ownerId:randomUUID(),nowUtc,
    leaseUntilUtc:new Date(Date.now()+60000).toISOString()});assert.ok(lease);
  const row=(await f.inspect()).items.find(r=>r.recordId===recordId),operationId=randomUUID();
  const correction={expectedHash:row.checksum,content:'The garage is blue (player correction).',operationId};
  const receipt=await f.change('correct',recordId,correction);assert.equal(receipt.kind,'p2_admin_fact_revision');
  assert.deepEqual(await f.change('correct',recordId,correction),receipt);
  const facts=await f.inspect();assert.ok(facts.items.every(r=>r.superseded));assert.ok(facts.items.every(r=>!r.canCorrect));
  const overlays=await f.inspect('corrections');assert.equal(overlays.items[0].supersedesTarget,true);
  const recalled=await f.store.readIntegratedRecall({scope:f.scope,sourceKind:'permanent_memory'});
  assert.ok(!JSON.stringify(recalled).includes('I2 old red garage'));
  assert.ok(JSON.stringify(recalled).includes('garage is blue'));
  await assert.rejects(f.store.saveDeterministicMemory({...proposal,proposalId:randomUUID()}),/forgotten/);
  await assert.rejects(f.store.verifyCurationLease({jobId:proposal.proposalId,leaseToken:lease.leaseToken}),/authorized/);
  assert.deepEqual((await f.store.readCommittedEvidencePage({scope:f.scope})).items,[]);
  assert.ok((await f.inspect('conversations')).items.some(r=>r.content==='I2 old red garage'));
  await assert.rejects(f.change('correct',recordId,{...correction,content:'conflicting retry'}),/conflict/);
});

test('I2 fact revision withdraws original player dialogue from H1 after private correction, with H2 and history intact',async t=>{
  const f=await setup(t);
  const oldText='My I2 garage is red — obsolete source words';
  const memoryId=await f.keep(oldText);
  await f.say('Unrelated safe conversation',{avatar:'trevor'});
  const question='What can you tell me about my garage?';
  const questionReceipt=await f.say(question,{avatar:'michael'});
  const args={store:f.store,turn:f.turnFor(),acceptedReceipt:{status:'stored',durable:true,
      recordId:questionReceipt.recordId,protagonistKey:'michael'},
    input:question,source:'player_text',isCurrent:()=>true,nowUtc:new Date().toISOString()};
  const before=await prepareH1ConversationHistory(args);
  assert.equal(before.status,'ready','the original dialogue is legitimate H1 context before correction');
  assert.ok(JSON.stringify(before.conversationJournal).includes(oldText));
  assert.equal((await before.verifyPrepared()).status,'ready');
  assert.equal(before.sendCurrent(),true);

  const oldFact=(await f.inspect('facts')).items.find(row=>row.recordId===memoryId);
  assert.ok(oldFact?.canCorrect);
  const correctedText='My garage is blue (verified private revision).';
  await f.change('correct',memoryId,{content:correctedText,expectedHash:oldFact.checksum});
  const original=(await f.inspect('conversations')).items.find(row=>row.content===oldText);
  assert.ok(original,'original journal source remains privately inspectable');
  const hidden=await f.store.listSuppressedMemoryIds(f.scope,{includeCorrections:true});
  assert.ok(hidden.includes(original.recordId),'P2 returns the entire withdrawn source closure');
  assert.ok(!(await f.store.listSuppressedMemoryIds(f.scope)).includes(original.recordId),
    'legacy suppression-only reader remains unchanged');

  assert.equal(before.sendCurrent(),false,'previously sealed H1 context is revoked by the correction');
  assert.equal((await before.verifyPrepared()).status,'invalidated');
  const after=await prepareH1ConversationHistory(args);
  assert.equal(after.status,'ready');
  const history=JSON.stringify(after.conversationJournal);
  assert.ok(!history.includes(oldText),'superseded source cannot be sent as recent or archived H1 context');
  assert.ok(history.includes('Unrelated safe conversation'),'unrelated conversation remains available');
  assert.equal((await after.verifyPrepared()).status,'ready');
  assert.equal(after.sendCurrent(),true);
  const recalled=JSON.stringify(await f.store.readIntegratedRecall({scope:f.scope,sourceKind:'permanent_memory'}));
  assert.ok(recalled.includes(correctedText),'revised claim remains available to H2');
  assert.ok(!recalled.includes(oldText),'old claim stays withdrawn from H2');
});

test('I2 forget uses permanent P2 suppression including source/replay and safe seven-day restore',async t=>{
  const f=await setup(t),id=await f.keep('I2 forget this private phrase');
  const result=await f.change('forget',id);assert.equal(result.durableCommit,true);
  assert.equal((await f.inspect()).items[0].suppressed,true);
  assert.ok(!JSON.stringify(await f.store.readIntegratedRecall({scope:f.scope})).includes('I2 forget this private phrase'));
  assert.deepEqual((await f.store.readCommittedEvidencePage({scope:f.scope})).items,[]);
  const trash=(await f.inspect('suppressed')).items.find(r=>r.recordId===id);
  assert.equal(trash.restoreSupported,true);
  const restored=await f.admin.execute({operation:'restore',scope:f.scope,trashId:trash.trashId,
    operationId:randomUUID(),confirmation:trash.trashId});
  assert.equal(restored.durableCommit,true);
  assert.equal((await f.inspect()).items[0].suppressed,false);
});

test('I2 denies unauthenticated HTTP, wrong scope, cross-NPC targets, wrong world/timeline, unsafe correction and unconfirmed destruction',async t=>{
  const f=await setup(t,{editor:true}),id=await f.keep('I2 confidential');
  const body={action:'inspector_memory',operation:'inspect',scope:f.scope,kind:'facts'};
  for(const headers of [{'x-lsa-editor':''},{origin:'https://example.org'},{host:'evil.example'},{'content-type':'text/plain'}])
    assert.equal((await f.call(body,headers)).status,403);
  for(const scope of [{...f.scope,worldProfileId:randomUUID()},{...f.scope,timelineId:randomUUID()},
    {...f.scope,characterId:randomUUID()},{...f.scope,protagonistKey:'franklin'}])
    await assert.rejects(f.inspect('facts',{scope}),/scope/);
  const cross=f.scope;await assert.rejects(f.change('forget',id,{scope:{...cross,characterId:f.chars[1].characterId}}),/target|evidence/);
  await assert.rejects(f.change('forget',id,{confirmation:null}),/confirmation/);
  const line=await f.say('raw dialogue');
  await assert.rejects(f.change('correct',line.recordId,{expectedHash:hash('raw dialogue'),content:'replacement'}),/target/);
  f.revoke();await assert.rejects(f.inspect(),/scope/);
});

test('I2 selected private export only includes selected current-page rows and rejects foreign IDs',async t=>{
  const f=await setup(t);const id=await f.keep('I2 selected secret');await f.keep('I2 unselected secret');
  const result=await f.admin.execute({operation:'export',scope:f.scope,kind:'facts',offset:0,recordIds:[id]});
  assert.equal(hash(result.json),result.sha256);assert.ok(result.json.includes('I2 selected secret'));
  assert.ok(!result.json.includes('I2 unselected secret'));
  await assert.rejects(f.admin.execute({operation:'export',scope:f.scope,kind:'facts',offset:0,recordIds:[randomUUID()]}),/selection/);
});

test('I2 factual correction cannot indirectly supersede NPC speech or witnessed events',async t=>{
  const f=await setup(t),said=await f.say('NPC original evidence',{speaker:'npc'}),event=await f.event(5);
  for(const source of [said.recordId,event.event.recordId]){
    const proposal={...f.scope,proposalId:randomUUID(),kind:'curation_proposal',provider:'deterministic',
      evidenceRecordIds:[source],groundedSummary:'Protected source summary '+source,notability:.6};
    await f.store.saveDeterministicMemory(proposal);
    const row=(await f.inspect()).items.find(r=>r.recordId===proposal.proposalId);
    assert.equal(row.canCorrect,false);
    await assert.rejects(f.change('correct',row.recordId,{expectedHash:row.checksum,content:'Unsupported rewrite'}),/target/);
  }
});

test('I2 capability settings are validated, CAS protected, persisted for restart and never activate dependencies',async t=>{
  const f=await setup(t);const initial=await f.controls.snapshot();
  // storage-only refuses optional producers, preserving existing profile rules.
  await assert.rejects(f.controls.change({operation:'capability',id:'memory.recall',mode:'on',revision:initial.revision}),/storage-only/);
  const file=JSON.parse(await readFile(f.configPath));delete file.memoryK.profile;await writeFile(f.configPath,JSON.stringify(file));
  const start=await f.controls.snapshot();
  const result=await f.controls.change({operation:'capability',id:'memory.recall',mode:'on',revision:start.revision});
  const recall=result.capabilities.find(r=>r.id==='memory.recall');
  assert.equal(recall.requestedMode,'on');assert.equal(recall.effectiveMode,'off');assert.equal(recall.restartRequired,true);
  assert.equal(f.runtime.config.memoryK.capabilities['memory.dialogue.player'],'off');
  const saved=JSON.parse(await readFile(f.configPath));assert.equal(saved.memoryK.capabilities['memory.recall'],'on');
  assert.equal(saved.memoryK.capabilities['memory.dialogue.player'],undefined);
  await assert.rejects(f.controls.change({operation:'capability',id:'memory.events',mode:'on',revision:start.revision}),/config_changed/);
  await assert.rejects(f.controls.change({operation:'capability',id:'source.core',mode:'off',revision:result.revision}),/invalid_capability/);
});

test('I2 live pause blocks queued optional reads/writes, preserves admin, persists, and cannot resume in this process',async t=>{
  const f=await setup(t),id=await f.keep('I2 pause private');
  const optional=f.runtime.memoryPause.optionalStore(f.store);
  // Admission happens before the queue microtask, so these are revoked before SQL.
  let readExecuted=false,writeExecuted=false;
  const queuedRead=optional.withP2SqliteRead(f.scope,()=>{readExecuted=true;});
  const queuedWrite=optional.withTimelineWrite(f.timelineId,()=>{writeExecuted=true;});
  const rejectedRead=assert.rejects(queuedRead,/learned_memory_paused/),rejectedWrite=assert.rejects(queuedWrite,/learned_memory_paused/);
  f.runtime.pauseLearnedMemory();await Promise.all([rejectedRead,rejectedWrite]);
  assert.equal(readExecuted,false);assert.equal(writeExecuted,false);
  const start=await f.controls.snapshot();
  let view=await f.controls.change({operation:'pause',paused:true,revision:start.revision});
  assert.equal(view.pause.operationalState,'paused');
  assert.equal((await f.inspect()).items.length,1);
  assert.equal((await f.change('forget',id)).durableCommit,true);
  assert.equal(f.runtime.services.memoryKRuntimeDiagnostics().capabilities['privacy.core'].effectiveMode,'on');
  view=await f.controls.change({operation:'pause',paused:false,revision:view.revision});
  assert.equal(view.pause.effective,true);assert.equal(view.pause.requested,false);assert.equal(view.pause.restartRequired,true);
  assert.throws(()=>optional.readDialogueLines(f.scope),/learned_memory_paused/);
  assert.equal(JSON.parse(await readFile(f.configPath)).memoryK.pauseLearned,false);
});

test('I2 startup pause is latched, inspection survives it, and source loss/reconfirmation rejects old requests',async t=>{
  const f=await setup(t,{pauseLearned:true});await f.say('retained before optional startup');
  assert.equal(f.runtime.memoryPause.paused,true);assert.equal((await f.inspect('conversations')).items.length,1);
  const pending=f.inspect('conversations');f.newHost();await f.store.confirmTimeline(f.timelineId,{confirmation:f.timelineId});
  await assert.rejects(pending,/scope|suspended|authorization/);
  assert.equal((await f.inspect('conversations')).items.length,1);
  f.store.setVerifiedHostContext(null);await assert.rejects(f.inspect(),/scope/);
});

test('I2 an externally saved pause request is pending until actually enforced by this runtime',async t=>{
  const f=await setup(t),data=JSON.parse(await readFile(f.configPath));
  data.memoryK.pauseLearned=true;await writeFile(f.configPath,JSON.stringify(data));
  const status=await f.controls.snapshot();
  assert.equal(status.pause.requested,true);assert.equal(status.pause.effective,false);
  assert.equal(status.pause.restartRequired,true);assert.equal(status.pause.operationalState,'running');
});

test('I2 pause at actual P2 transaction execution rolls back optional work and does not poison admin queue context',async t=>{
  const f=await setup(t),optional=f.runtime.memoryPause.optionalStore(f.store);
  const before=f.store.snapshot.revision;
  await assert.rejects(optional.withP2SqliteTransaction(f.scope,()=>{f.runtime.pauseLearnedMemory();return 'blocked';}),/learned_memory_paused/);
  assert.equal(f.store.snapshot.revision,before);
  assert.deepEqual((await f.inspect()).items,[]);
});

test('I2 default gate is per runtime and cannot accidentally resume or poison a sibling runtime',()=>{
  const a=createLearnedMemoryPause(),b=createLearnedMemoryPause();const stamp=a.stamp();
  a.pause();assert.equal(a.current(stamp),false);assert.equal(b.current(b.stamp()),true);
});

test('I2 pause continues revocation after a failed notification and reports incomplete cleanup honestly',async t=>{
  const f=await setup(t);let notified=false;
  f.runtime.memoryPause.subscribe(()=>{throw Error('listener failure');});
  f.runtime.memoryPause.subscribe(()=>{notified=true;});
  const view=await f.controls.snapshot();
  await assert.rejects(f.controls.change({operation:'pause',paused:true,revision:view.revision}),/cleanup_failed/);
  assert.equal(notified,true);assert.equal(f.runtime.memoryPause.paused,true);
  assert.equal((await f.controls.snapshot()).pause.operationalState,'blocked_cleanup_failed');
  assert.deepEqual((await f.inspect()).items,[]);
});

test('I2 M3 event and coverage queues stop across live pause using real source parser, PS2 and original P2',async t=>{
  const pause=createLearnedMemoryPause();
  const h=await createHarness(t,{npcCount:1,memoryStoreView:store=>pause.optionalStore(store)});
  t.after(()=>h.close());await h.connect();await h.advance(2000);await h.fire(h.npcs);await h.drain();
  const before=(await h.journal(h.npcs[0])).length;assert.ok(before>0);
  pause.pause();h.m3.adapter.close();await h.m3.close();
  await h.advance(2000);await h.fire(h.npcs);await h.drain();
  assert.equal((await h.journal(h.npcs[0])).length,before);
  assert.equal(h.m3.snapshot().closed,true);
  assert.equal(h.store.timelineWritable,true,'mandatory administration/source remains available');
});
