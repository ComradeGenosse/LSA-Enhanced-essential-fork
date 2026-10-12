import './memory-m5-closure.test.mjs'; // F closure adversarial suite, included by existing M5 CI
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {createM5SqliteServices} from '../src/memory/m5SqlitePrivacy.mjs';
import {handleExplicitMemoryCommand,handleMemoryClarificationReply,detectExplicitMemoryCommands,
  handleExplicitMemoryCommands} from '../src/memory/explicitCommands.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';
import {selectAutomaticMemories} from '../src/memory/selection.mjs';

const id=()=>randomUUID();
const identity=n=>({pedId:101,turnId:n,generationId:'g1',sessionNonce:'m5-completion'});
async function setup(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'m5-completion-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const filePath=path.join(dir,'p2.sqlite');
 const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
 await store.initialize();
 const p=await store.create(profile()),timelineId=await store.createTimeline({label:'M5'});
 const host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
 store.setVerifiedHostContext(host);await store.confirmTimeline(timelineId);
 const scope={characterId:p.characterId,worldProfileId,timelineId,protagonistKey:'franklin'};
 const recorder=createConversationJournalRecorder(store);
 const record=async(text,n,protagonist='franklin')=>{
   const result=await recorder.recordPlayerAccepted({characterId:p.characterId,identity:identity(n),
     text,source:'typed',attribution:{protagonist}});
   const row=(await store.readDialogueLines({characterId:p.characterId,timelineId})).find(x=>x.recordId===result.recordId);
   assert.ok(row);return row;
 };
 return {store,filePath,scope,record,host};
}
const allowed=()=>true;
test('M5 durable two-choice clarification survives reopen, rejects guessing and retains exact offered IDs',async t=>{
 const x=await setup(t);
 const first=await x.record('A red scooter by the alley','s1');
 const second=await x.record('A blue scooter near the pier','s2');
 const command=await x.record('Remember the scooter','cmd');
 const cid=id();
 let service=createM5SqliteServices({store:x.store,filePath:x.filePath,authorize:allowed});
 await service.ready(x.scope);
 const heard=[];
 const outcome=await handleExplicitMemoryCommand({line:command,scope:x.scope,commandId:cid,
   store:service.bindCommands(),onClarification:c=>heard.push(c)});
 assert.equal(outcome.outcome,'clarify');
 assert.equal(heard.length,1);
 assert.equal(heard[0].alternatives.length,2);
 assert.deepEqual(new Set(heard[0].alternatives.map(a=>a.recordId)),
   new Set([first.recordId,second.recordId]));
 const saved=await service.getClarification({scope:x.scope,commandId:cid});
 assert.deepEqual(saved.alternatives,heard[0].alternatives);
 await service.close();
 service=createM5SqliteServices({store:x.store,filePath:x.filePath,authorize:allowed});
 await service.ready(x.scope);
 const bad=await x.record('third','not-a-choice');
 assert.equal((await handleMemoryClarificationReply({line:bad,scope:x.scope,store:service.bindCommands(),
   clarificationId:cid})).outcome,'clarify');
 assert.equal((await x.store.verifyCommand({scope:x.scope,commandId:cid})),null);
 const reply=await x.record('first','choice');
 const resolved=await handleMemoryClarificationReply({line:reply,scope:x.scope,
   store:service.bindCommands(),clarificationId:cid});
 assert.equal(resolved.outcome,'saved');
 assert.equal(resolved.durableCommit,true);
 assert.ok(saved.alternatives.some(a=>resolved.evidenceRecordIds.includes(a.recordId)));
 assert.ok(resolved.evidenceRecordIds.includes(command.recordId));
 assert.ok(resolved.evidenceRecordIds.includes(reply.recordId));
 assert.equal(await service.getClarification({scope:x.scope,commandId:cid}),null);
 assert.deepEqual((await x.store.verifyCommand({scope:x.scope,commandId:cid})).evidenceRecordIds,
   resolved.evidenceRecordIds);
 await service.close();await x.store.close();
});
test('M5 pending clarification follows one player across avatars but still expires',async t=>{
 const x=await setup(t);await x.record('A scooter story','s1');await x.record('Another scooter story','s2');
 const cmd=await x.record('Remember the scooter','c');
 let now=Date.now();const clock=()=>new Date(now).toISOString();
 const m5=createM5SqliteServices({store:x.store,filePath:x.filePath,clock,authorize:allowed});
 await m5.ready(x.scope);
 const cid=id();assert.equal((await handleExplicitMemoryCommand({
   line:cmd,scope:x.scope,commandId:cid,store:m5.bindCommands()})).outcome,'clarify');
 const other={...x.scope,protagonistKey:'trevor'};
 assert.ok(await m5.getClarification({scope:other,commandId:cid}));
 now+=6*60*1000;
 assert.equal(await m5.getClarification({scope:x.scope,commandId:cid}),null);
 const reply=await x.record('first','late');
 assert.equal(await handleMemoryClarificationReply({line:reply,scope:x.scope,
   store:m5.bindCommands(),clarificationId:cid}),null);
 await m5.close();await x.store.close();
});
test('M5 trash suppresses recall instantly, restores inside window, physically purges after seven days',async t=>{
 const x=await setup(t);
 const target=await x.record('secret sauce on a purple scooter','private');
 const foreign=await x.record('trevor owns a yellow bike','foreign','trevor');
 let now=Date.now();const clock=()=>new Date(now).toISOString();
 const m5=createM5SqliteServices({store:x.store,filePath:x.filePath,clock,authorize:allowed});
 await m5.ready(x.scope);
 const op=id();
 const receipt=await m5.trash({scope:x.scope,targetId:target.recordId,operationId:op});
 assert.equal(receipt.durableCommit,true);
 assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(target.recordId));
 assert.equal((await x.store.findCandidates({scope:x.scope})).some(r=>r.recordId===target.recordId),false);
 const snap=await m5.exportArchive({scope:x.scope});
 assert.equal(snap.sha256.length,64);
 assert.ok(snap.json.includes('secret sauce'));
 await m5.restore({scope:x.scope,trashId:op,operationId:id()});
 assert.ok(!(await x.store.listSuppressedMemoryIds(x.scope)).includes(target.recordId));
 const later=await m5.trash({scope:x.scope,targetId:target.recordId,operationId:id()});
 assert.equal(later.operation,'trash');
 now+=8*86400000;
 const purged=await m5.purgeExpired({scope:x.scope});
 assert.ok(purged.purgedIds.includes(target.recordId));
 assert.equal((await x.store.findExactQuote({characterId:x.scope.characterId,timelineId:x.scope.timelineId,
   quote:target.content})).length,0);
 assert.equal((await x.store.findExactQuote({characterId:x.scope.characterId,timelineId:x.scope.timelineId,
   quote:foreign.content})).length,1);
 await m5.close();await x.store.close();
});
test('M5 refuses privacy operations without explicit authorization and without active native timeline authority',async t=>{
 const x=await setup(t);const row=await x.record('Never publish this','source');
 const unauthorized=createM5SqliteServices({store:x.store,filePath:x.filePath,authorize:()=>false});
 await unauthorized.ready(x.scope);
 await assert.rejects(unauthorized.trash({scope:x.scope,targetId:row.recordId}),/authorization/);
 await unauthorized.close();
 const m5=createM5SqliteServices({store:x.store,filePath:x.filePath,authorize:allowed});
 await m5.ready(x.scope);
 x.store.setVerifiedHostContext(null);
 await assert.rejects(m5.trash({scope:x.scope,targetId:row.recordId}),/timeline_write_suspended/);
 assert.equal((await x.store.listSuppressedMemoryIds(x.scope)).includes(row.recordId),false);
 await m5.close();await x.store.close();
});
test('M5 executes at most two explicitly segmented commands with exact accepted source line',async t=>{
 const x=await setup(t);
 const raw='Remember that I like olives; remember that I like bread';
 const line=await x.record(raw,'double');
 assert.equal(detectExplicitMemoryCommands(raw).length,2);
 assert.equal(detectExplicitMemoryCommands(raw+'; forget that'),null);
 const actions=await handleExplicitMemoryCommands({line,scope:x.scope,commandId:id(),store:x.store});
 assert.equal(actions.length,2);
 assert.deepEqual(actions.map(a=>a.outcome),['saved','saved']);
 assert.equal((await x.store.readDialogueLines({characterId:x.scope.characterId,timelineId:x.scope.timelineId}))[0].content,raw);
 await x.store.close();
});

test('M5 reconciles preexisting PR #61 forget tombstones into seven-day recoverable trash',async t=>{
 const x=await setup(t);
 const source=await x.record('a blue spaceship hidden in the alley','source');
 const cmd=await x.record('Forget that spaceship','cmd');
 const commandId=id(),content=source.content;
 const op={scope:x.scope,commandId,requestedByLineId:cmd.recordId,
   operation:'forget',origin:'explicit_player',recordType:'dialogue_line',
   content,contentHash:createHash('sha256').update(content).digest('hex'),
   pin:false,evidenceRecordIds:[source.recordId,cmd.recordId],targetRecordId:source.recordId,
   correctionMode:null,subjectCertainty:null,requestedAtUtc:cmd.committedAtUtc};
 assert.equal((await x.store.commitCommand(op)).durableCommit,true);
 const m5=createM5SqliteServices({store:x.store,filePath:x.filePath,authorize:allowed});
 await m5.ready(x.scope);
 const inspector=await m5.inspect({scope:x.scope});
 assert.ok(inspector.trash.some(item=>item.trashId===commandId&&item.targetId===source.recordId));
 assert.ok((await x.store.listSuppressedMemoryIds(x.scope)).includes(source.recordId));
 const restored=await m5.restore({scope:x.scope,trashId:commandId,operationId:id()});
 assert.equal(restored.operation,'restore');
 assert.equal((await m5.bindCommands().verifyCommand({scope:x.scope,commandId})).durableCommit,false);
 assert.ok(!(await x.store.listSuppressedMemoryIds(x.scope)).includes(source.recordId));
 await m5.close();await x.store.close();
});

test('M5 source tombstone cascades into deterministic derived memories without erasing source until purge',async t=>{
 const x=await setup(t);
 const source=await x.record('That was a hilarious and embarrassing scooter crash!','derivation');
 const proposals=selectAutomaticMemories([source]);
 assert.equal(proposals.length,1);
 const saved=await x.store.saveDeterministicMemory(proposals[0]);
 assert.equal(saved.inserted,true);
 const m5=createM5SqliteServices({store:x.store,filePath:x.filePath,authorize:allowed});
 await m5.ready(x.scope);
 await m5.trash({scope:x.scope,targetId:source.recordId,operationId:id()});
 const suppressed=await x.store.listSuppressedMemoryIds(x.scope);
 assert.ok(suppressed.includes(source.recordId));
 assert.ok(suppressed.includes(proposals[0].proposalId));
 assert.equal((await x.store.findExactQuote({characterId:x.scope.characterId,
   timelineId:x.scope.timelineId,quote:source.content})).length,1);
 await m5.close();await x.store.close();
});

test('M5 authorized scope-wide trash covers all avatars and restores atomically',async t=>{
 const x=await setup(t);
 const a=await x.record('Franklin secret alpha','a');
 const b=await x.record('Franklin secret beta','b');
 const other=await x.record('Trevor secret gamma','c','trevor');
 const m5=createM5SqliteServices({store:x.store,filePath:x.filePath,authorize:allowed});
 await m5.ready(x.scope);
 const op=id(),result=await m5.trashScope({scope:x.scope,operationId:op});
 assert.equal(result.operation,'trash_scope');
 assert.ok(result.targetIds.includes(a.recordId));
 assert.ok(result.targetIds.includes(b.recordId));
 assert.ok(result.targetIds.includes(other.recordId));
 const suppressed=await x.store.listSuppressedMemoryIds(x.scope);
 assert.ok(suppressed.includes(a.recordId)&&suppressed.includes(b.recordId));
 const foreign=await x.store.findCandidates({scope:{...x.scope,protagonistKey:'trevor'}});
 assert.ok(!foreign.some(item=>item.recordId===other.recordId));
 const trash=(await m5.inspect({scope:x.scope})).trash.filter(r=>!r.restoredAtUtc);
 assert.ok(trash.length>=2);
 const restored=await m5.restore({scope:x.scope,trashId:trash[0].trashId,operationId:id()});
 assert.equal(restored.operation,'restore');
 assert.ok(!(await x.store.listSuppressedMemoryIds(x.scope)).includes(a.recordId));
 await m5.close();await x.store.close();
});

test('M5 rejects source record ID paired with altered accepted bytes',async t=>{
 const x=await setup(t),line=await x.record('Remember that pizza is good','accepted');
 const m5=createM5SqliteServices({store:x.store,filePath:x.filePath,authorize:allowed});
 await m5.ready(x.scope);
 const cmd=id();
 const fake={...line,content:'Remember that pizza is terrible'};
 const denied=await handleExplicitMemoryCommand({line:fake,scope:x.scope,commandId:cmd,
   store:m5.bindCommands()});
 assert.equal(denied.outcome,'failed');
 assert.equal((await x.store.verifyCommand({scope:x.scope,commandId:cmd})),null);
 const accepted=await handleExplicitMemoryCommand({line,scope:x.scope,commandId:cmd,store:m5.bindCommands()});
 assert.equal(accepted.outcome,'saved');
 assert.equal(accepted.durableCommit,true);
 await m5.close();await x.store.close();
});

test('H: trash invalidates pending frozen clarification when offered evidence is revoked',async t=>{
 const x=await setup(t);
 const first=await x.record('The red scooter incident','source-one');
 await x.record('The blue scooter incident','source-two');
 const command=await x.record('Remember the scooter','clarify-command');
 const m5=createM5SqliteServices({store:x.store,filePath:x.filePath,authorize:allowed});
 try{
   await m5.ready(x.scope);
   const cid=id();
   const action=await handleExplicitMemoryCommand({line:command,
     scope:x.scope,commandId:cid,store:m5.bindCommands()});
   assert.equal(action.outcome,'clarify');
   const before=await m5.getClarification({scope:x.scope,commandId:cid});
   assert.ok(before?.alternatives?.some(a=>a.recordId===first.recordId));
   const privacy=await m5.trash({scope:x.scope,targetId:first.recordId,operationId:id()});
   assert.equal(privacy.durableCommit,true);
   assert.equal(await m5.getClarification({scope:x.scope,commandId:cid}),null);
 }finally{await m5.close();await x.store.close();}
});
