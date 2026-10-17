// W04 acceptance: SQLite file-backed P2 store, NOT mocked command or privacy receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {createM5SqliteServices} from '../src/memory/m5SqlitePrivacy.mjs';
import {createM5RuntimeCoordinator,stableM5CommandId} from '../src/memory/m5RuntimeCoordinator.mjs';
import {createM5ScopedPrivacyFacade} from '../src/memory/m5ScopedPrivacyFacade.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

const id=()=>randomUUID();
const at=(ms)=>new Date(ms).toISOString();
async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'memory-k-w04-'));
 t.after(async()=>{await store.close();await fs.rm(root,{recursive:true,force:true});});
 const filePath=path.join(root,'p2.sqlite');
 const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
 await store.initialize();
 const first=await store.create(profile());
 const timelineId=await store.createTimeline({label:'W04 source'});
 const host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
 store.setVerifiedHostContext(host);
 await store.confirmTimeline(timelineId,{confirmation:timelineId});
 const scope={worldProfileId,characterId:first.characterId,timelineId,protagonistKey:'franklin'};
 let now=Date.now();
 const service=createM5SqliteServices({store,filePath,authorize:({scope:requested})=>requested.worldProfileId===scope.worldProfileId&&requested.characterId===scope.characterId&&requested.timelineId===scope.timelineId&&requested.protagonistKey===scope.protagonistKey,clock:()=>at(now)});
 await service.ready(scope);
 const commands=service.bindCommands();
 const proof={hostRunId:host.hostRunId,worldEpoch:1,turn:'verified_fixture'};
 const authority={assertCurrent:({line,scope:requested,sourceProof})=>
   store.verifiedHostContext?.hostRunId===host.hostRunId &&
   sourceProof===proof && requested.characterId===scope.characterId &&
   requested.protagonistKey===scope.protagonistKey &&
   line.attribution?.hostRunId===host.hostRunId &&
   line.attribution?.worldEpoch===1};
 const runtime=createM5RuntimeCoordinator({commandStore:commands,authority});
 const recorder=createConversationJournalRecorder(store);
 let number=0;
 async function accept(text,source='typed',protagonist='franklin') {
   await recorder.recordPlayerAccepted({characterId:scope.characterId,
     identity:{pedId:101,turnId:'w04-'+(++number),generationId:'g1',sessionNonce:'w04-session'},
     source,text,attribution:{protagonist}});
   const lines=await store.readDialogueLines({characterId:scope.characterId,timelineId:scope.timelineId});
   const line=lines.find(x=>x.content===text&&x.attribution.protagonist===protagonist);
   assert.ok(line,'original committed SQLite dialogue available');
   return line;
 }
 const dispatch=async line=>runtime.acceptAcceptedPlayerLine({line,scope,sourceProof:proof});
 const counts=async()=>store.withP2SqliteRead(scope,db=>({
   commands:db.prepare('SELECT count(*) AS n FROM memory_commands').get().n,
   memories:db.prepare('SELECT count(*) AS n FROM memory_records').get().n,
   tombstones:db.prepare('SELECT count(*) AS n FROM memory_tombstones').get().n
 }));
 return {filePath,root,store,scope,host,service,commands,runtime,proof,accept,dispatch,counts,
   advance:ms=>{now+=ms;}};
}
const assertNoSaved=r=>assert.equal((r.acknowledgements??[]).some(a=>
  a.durableCommit===true&&a.outcome==='saved'),false);

test('W04 original accepted M2 P2 line precedes single command and duplicate is exactly once',async t=>{
 const x=await fixture(t);
 const line=await x.accept('Remember that I drink tea 🫖');
 const first=await x.dispatch(line);
 assert.equal(first.handled,true);
 assert.equal(first.acknowledgements[0].outcome,'saved');
 assert.equal(first.acknowledgements[0].durableCommit,true);
 assert.equal((await x.counts()).memories,1);
 const again=await x.dispatch(line);
 assert.equal(again.acknowledgements[0].outcome,'saved');
 assert.equal((await x.counts()).commands,1);
 assert.equal(first.acknowledgements[0].commandId,stableM5CommandId({line,scope:x.scope}));
 const tamper={...line,content:'Remember that I drink coffee'};
 assertNoSaved(await x.dispatch(tamper));
 assert.equal((await x.counts()).memories,1);
});

test('W04 two independent commands are atomic and readback-verified',async t=>{
 const x=await fixture(t);
 const line=await x.accept('Remember that I like tea; remember that I like coffee');
 const first=await x.dispatch(line);
 assert.equal(first.acknowledgements.length,2);
 assert.deepEqual(first.acknowledgements.map(a=>a.outcome),['saved','saved']);
 assert.equal((await x.counts()).memories,2);
 const again=await x.dispatch(line);
 assert.equal(again.acknowledgements.length,2);
 assert.equal((await x.counts()).memories,2);
});

test('W04 a SQL failure during second compound member rolls back first and says no saved',async t=>{
 const x=await fixture(t);
 await x.store.withTimelineSqliteWrite(x.scope,db=>db.exec(
   "CREATE TRIGGER w04_block_second BEFORE INSERT ON memory_records WHEN NEW.content LIKE '%coffee%' BEGIN SELECT RAISE(ABORT,'forced_second_member_failure'); END"));
 const line=await x.accept('Remember that I like tea; remember that I like coffee');
 const r=await x.dispatch(line);
 assertNoSaved(r);
 assert.equal((await x.counts()).commands,0);
 assert.equal((await x.counts()).memories,0);
});

test('W04 no source receipt, native source loss and wrong protagonist never create commands',async t=>{
 const x=await fixture(t);
 const fake={kind:'dialogue_line',recordId:id(),characterId:x.scope.characterId,
   worldProfileId,timelineId:x.scope.timelineId,speaker:'player',source:'stt',
   delivery:'accepted',content:'Remember that this is uncommitted',committedAtUtc:at(Date.now()),
   attribution:{protagonist:'franklin',hostRunId:x.host.hostRunId,worldEpoch:1}};
 assertNoSaved(await x.dispatch(fake));
 const line=await x.accept('Remember that I need a blue umbrella');
 x.store.setVerifiedHostContext(null);
 assertNoSaved(await x.dispatch(line));
 assert.equal((await x.counts().catch(()=>({commands:0}))).commands,0);
});

test('W04 ambiguous command is a durable bounded clarification and scope-current choice',async t=>{
 const x=await fixture(t);
 await x.accept('I drove a sedan through town');
 await x.accept('I drove a truck through town');
 const ambiguous=await x.accept('Forget that');
 const first=await x.dispatch(ambiguous);
 assert.equal(first.handled,true);
 assert.equal(first.acknowledgements[0].outcome,'clarify');
 assert.equal((await x.commands.findPendingClarification({scope:x.scope,
   atUtc:ambiguous.committedAtUtc,excludeLineId:id()})).commandId,first.actions[0].commandId);
 const choice=await x.accept('first');
 const chosen=await x.dispatch(choice);
 assert.equal(chosen.handled,true);
 assert.equal(chosen.acknowledgements[0].outcome,'forgotten');
 assert.equal((await x.counts()).tombstones>=1,true);
});

test('W04 source-linked STT mishearing correction preserves original bytes',async t=>{
 const x=await fixture(t);
 const original=await x.accept('I like brue', 'stt');
 const corrective=await x.accept('No, I actually said blue');
 const result=await x.dispatch(corrective);
 assert.equal(result.acknowledgements[0].outcome,'corrected');
 assert.equal(result.acknowledgements[0].durableCommit,true);
 const linked=await x.store.withP2SqliteRead(x.scope,db=>db.prepare(
   'SELECT target_id AS id,preferred_text AS text FROM memory_corrections LIMIT 1').get());
 assert.equal(linked.id,original.recordId);
 assert.equal(linked.text,'blue');
 const originalRows=await x.store.readDialogueLines({characterId:x.scope.characterId,timelineId:x.scope.timelineId});
 assert.ok(originalRows.some(l=>l.recordId===original.recordId&&l.content==='I like brue'));
});

test('W04 privacy trash suppresses immediately, restore is scoped and purge after 7 days is verified',async t=>{
 const x=await fixture(t);
 const line=await x.accept('Remember that I ordered ramen');
 assert.equal((await x.dispatch(line)).acknowledgements[0].outcome,'saved');
 const memoryId=stableM5CommandId({line,scope:x.scope});
 const port=x.service;
 const facade=createM5ScopedPrivacyFacade({privacyPort:port,
   authorize:async({access})=>access==='owner',
   assertScopeCurrent:async({scope})=>scope.characterId===x.scope.characterId&&
     scope.worldProfileId===x.scope.worldProfileId&&scope.timelineId===x.scope.timelineId&&
     scope.protagonistKey===x.scope.protagonistKey&&x.store.timelineWritable});
 const request=(operation,other={})=>facade.execute({scope:x.scope,access:'owner',
   operation,operationId:id(),...other});
 assert.equal((await request('inspect',{access:'intruder'})).status,'denied');
 assert.equal((await request('inspect')).data.records.length,1);
 const trash=await request('trash',{recordId:memoryId});
 assert.equal(trash.status,'ok');
 assert.equal((await x.store.listSuppressedMemoryIds(x.scope)).includes(memoryId),true);
 const ticket=(await port.inspect({scope:x.scope})).trash.find(row=>row.targetId===memoryId);
 assert.ok(ticket);
 assert.equal((await request('restore',{trashId:ticket.trashId})).status,'ok');
 assert.equal((await x.store.listSuppressedMemoryIds(x.scope)).includes(memoryId),false);
 const trash2=await request('trash',{recordId:memoryId});
 assert.equal(trash2.status,'ok');
 x.advance(8*86400000);
 const purge=await request('purge',{limit:100});
 assert.equal(purge.status,'ok');
 assert.equal((await x.counts()).memories,0);
 // Purge cannot remove only the derivative and expose its original source
 // journal text to the M4 retriever after seven days.
 const sourceRows=await x.store.readDialogueLines({
   characterId:x.scope.characterId,timelineId:x.scope.timelineId});
 assert.equal(sourceRows.some(item=>item.recordId===line.recordId),false);
 assert.notEqual((await request('restore',{trashId:ticket.trashId})).status,'ok');
 assert.equal((await port.verifyPurge({scope:x.scope,result:await port.purgeExpired({
   scope:x.scope,limit:100,operationId:id()})})).confirmed,true);
});

test('W04 multi-character, wrong-world and cross-protagonist scope veto',async t=>{
 const x=await fixture(t);
 const line=await x.accept('Remember that I am Franklin');
 assert.equal((await x.dispatch(line)).acknowledgements[0].outcome,'saved');
 for(const wrong of [
   {...x.scope,protagonistKey:'trevor'},
   {...x.scope,characterId:id()},
   {...x.scope,worldProfileId:id()},
   {...x.scope,timelineId:id()}
 ]){
   await assert.rejects(()=>x.service.inspect({scope:wrong}));
   const rejected=await x.runtime.acceptAcceptedPlayerLine({line,scope:wrong,sourceProof:x.proof});
   assertNoSaved(rejected);
 }
});
