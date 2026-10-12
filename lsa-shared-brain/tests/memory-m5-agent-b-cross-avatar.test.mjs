// Agent B regressions: production-backed P2 SQLite, not the offline JSON fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {createM5SqliteServices} from '../src/memory/m5SqlitePrivacy.mjs';
import {handleExplicitMemoryCommand,handleMemoryClarificationReply} from '../src/memory/explicitCommands.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

const id=()=>randomUUID();
const sha=s=>createHash('sha256').update(s).digest('hex');
async function rig(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'m5-agent-b-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,'p2.sqlite');
  const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  const npc=await store.create(profile()),timelineId=await store.createTimeline({label:'agent-b'});
  store.setVerifiedHostContext({hostContextVersion:1,hostRunId:id(),worldEpoch:1});
  await store.confirmTimeline(timelineId);
  const who=protagonistKey=>({characterId:npc.characterId,worldProfileId,timelineId,protagonistKey});
  const recorder=createConversationJournalRecorder(store);
  let counter=0;
  async function say(avatar,text){
    const result=await recorder.recordPlayerAccepted({characterId:npc.characterId,
      identity:{pedId:101,turnId:'agent-b-'+(++counter),generationId:'g1',sessionNonce:'agent-b'},
      text,source:'typed',attribution:{protagonist:avatar}});
    const rows=await store.readDialogueLines({characterId:npc.characterId,timelineId});
    const found=rows.find(x=>x.recordId===result.recordId);
    assert.ok(found);
    return found;
  }
  const m5=createM5SqliteServices({store,filePath,authorize:()=>true});
  await m5.ready(who('franklin'));
  return {store,filePath,npc,who,say,m5};
}
function command(scope,line,operation,target,content=target?.content??line.content){
  return {scope,commandId:id(),requestedByLineId:line.recordId,operation,
    origin:'explicit_player',recordType:operation==='correct'?'correction':'dialogue_line',
    content,contentHash:sha(content),pin:false,
    evidenceRecordIds:target?[target.recordId,line.recordId]:[line.recordId],
    targetRecordId:target?.recordId??null,correctionMode:'counter_claim',
    subjectCertainty:null,requestedAtUtc:line.committedAtUtc};
}

test('M5: remember as Franklin, inspect/export as Michael, correct as Michael, suppress as Trevor',async t=>{
  const x=await rig(t);
  try{
    const name=await x.say('franklin','Remember that my name is Alex');
    const remembered=await handleExplicitMemoryCommand({line:name,scope:x.who('franklin'),
      store:x.m5.bindCommands(),commandId:id()});
    assert.equal(remembered.outcome,'saved');
    const michael=x.who('michael'),trevor=x.who('trevor');
    const inspected=await x.m5.inspect({scope:michael});
    assert.ok(inspected.records.some(row=>row.recordId===remembered.memoryId));
    const exported=JSON.parse((await x.m5.exportArchive({scope:trevor})).json);
    assert.ok(exported.memories.some(m=>m.memory_id===remembered.memoryId));
    assert.ok(exported.dialogue.some(d=>d.recordId===name.recordId));
    const correctLine=await x.say('michael','Correct that: my name is Alexa');
    const correction=await x.store.commitCommand(command(michael,correctLine,'correct',
      {recordId:remembered.memoryId,content:'my name is Alex'},'my name is Alexa'));
    assert.equal(correction.durableCommit,true);
    const overlays=await x.store.readCorrectionOverlays(trevor);
    assert.ok(overlays.some(row=>row.targetId===remembered.memoryId&&row.envelope.content.includes('Alexa')));
    const forgetLine=await x.say('trevor','Forget the old name');
    const forgotten=await x.store.commitCommand(command(trevor,forgetLine,'forget',
      {recordId:remembered.memoryId,content:'my name is Alex'}));
    assert.equal(forgotten.durableCommit,true);
    assert.ok((await x.store.listSuppressedMemoryIds(x.who('franklin'))).includes(remembered.memoryId));
    assert.ok(!(await x.store.findCandidates({scope:michael})).some(row=>row.recordId===remembered.memoryId));
    assert.ok((await x.m5.inspect({scope:michael})).records.some(row=>row.recordId===remembered.memoryId));
  }finally{await x.m5.close();await x.store.close();}
});

test('M5: a pending frozen clarification is resolved by the CURRENT accepted avatar reply',async t=>{
  const x=await rig(t);
  try{
    const original=await x.say('franklin','The first scooter was red');
    await x.say('michael','The second scooter was blue');
    const request=await x.say('franklin','Remember the scooter');
    const cid=id();
    assert.equal((await handleExplicitMemoryCommand({line:request,scope:x.who('franklin'),
      store:x.m5.bindCommands(),commandId:cid})).outcome,'clarify');
    const stored=await x.m5.getClarification({scope:x.who('trevor'),commandId:cid});
    assert.equal(stored.scope.protagonistKey,'franklin');
    assert.ok(stored.alternatives.some(a=>a.recordId===original.recordId));
    const reply=await x.say('trevor','first');
    const done=await handleMemoryClarificationReply({line:reply,scope:x.who('trevor'),
      store:x.m5.bindCommands(),clarificationId:cid});
    assert.equal(done.outcome,'saved');
    assert.equal(done.requestedByLineId,reply.recordId);
    assert.ok(done.evidenceRecordIds.includes(request.recordId));
    const durable=await x.store.verifyCommand({scope:x.who('michael'),commandId:cid});
    assert.equal(durable.requestedByLineId,reply.recordId);
    assert.ok(durable.evidenceRecordIds.includes(original.recordId) ||
      stored.alternatives.some(a=>durable.evidenceRecordIds.includes(a.recordId)));
    assert.equal(await x.m5.getClarification({scope:x.who('franklin'),commandId:cid}),null);
    const other=await x.say('michael','second');
    assert.equal(await handleMemoryClarificationReply({line:other,scope:x.who('michael'),
      store:x.m5.bindCommands(),clarificationId:cid}),null);
  }finally{await x.m5.close();await x.store.close();}
});

test('M5: stale, forged, and wrong-owner clarifications cannot mutate a memory',async t=>{
  const x=await rig(t);
  try{
    const early=await x.say('michael','first');
    await x.say('franklin','The red scooter');
    await x.say('trevor','The blue scooter');
    const request=await x.say('franklin','Remember the scooter'),cid=id();
    assert.equal((await handleExplicitMemoryCommand({line:request,scope:x.who('franklin'),
      store:x.m5.bindCommands(),commandId:cid})).outcome,'clarify');
    const stale=await handleMemoryClarificationReply({line:early,scope:x.who('michael'),
      store:x.m5.bindCommands(),clarificationId:cid});
    assert.equal(stale.outcome,'failed');
    const fake={...request,content:'first',protagonistKey:'trevor'};
    await assert.rejects(handleMemoryClarificationReply({line:fake,scope:x.who('trevor'),
      store:x.m5.bindCommands(),clarificationId:cid}),/invalid_memory_command_input/);
    assert.equal(await x.store.verifyCommand({scope:x.who('franklin'),commandId:cid}),null);
    const other={...x.who('trevor'),characterId:id()};
    await assert.rejects(x.m5.getClarification({scope:other,commandId:cid}),/owner|scope|timeline/i);
    const wrongTimeline={...x.who('michael'),timelineId:id()};
    await assert.rejects(x.m5.trashScope({scope:wrongTimeline,operationId:id()}),/timeline|owner/i);
    const denied=createM5SqliteServices({store:x.store,filePath:x.filePath,authorize:()=>false});
    await assert.rejects(denied.trashScope({scope:x.who('trevor'),operationId:id()}),/authorization/);
  }finally{await x.m5.close();await x.store.close();}
});

test('M5: trash/retry/restore is avatar-neutral; conflicting IDs fail; purge is physically verified',async t=>{
  const x=await rig(t);
  try{
    const a=await x.say('franklin','Shared secret A');
    const b=await x.say('trevor','Shared secret B');
    const op=id(),franklin=x.who('franklin'),michael=x.who('michael'),trevor=x.who('trevor');
    const first=await x.m5.trash({scope:franklin,targetId:a.recordId,operationId:op});
    const retry=await x.m5.trash({scope:michael,targetId:a.recordId,operationId:op});
    assert.deepEqual(retry,first);
    await assert.rejects(x.m5.trash({scope:trevor,targetId:b.recordId,operationId:op}),/replay_conflict/);
    assert.ok((await x.store.listSuppressedMemoryIds(trevor)).includes(a.recordId));
    const restoreId=id();
    const restored=await x.m5.restore({scope:michael,trashId:op,operationId:restoreId});
    assert.equal(restored.operation,'restore');
    assert.deepEqual(await x.m5.restore({scope:trevor,trashId:op,operationId:restoreId}),restored);
    assert.ok(!(await x.store.listSuppressedMemoryIds(franklin)).includes(a.recordId));
    const full=id(),deleted=await x.m5.trashScope({scope:trevor,operationId:full});
    assert.ok(deleted.targetIds.includes(a.recordId)&&deleted.targetIds.includes(b.recordId));
    assert.deepEqual(await x.m5.trashScope({scope:franklin,operationId:full}),deleted);
    const archive=JSON.parse((await x.m5.exportArchive({scope:michael})).json);
    assert.ok(archive.dialogue.some(d=>d.recordId===b.recordId));
    const due=new Date(Date.now()+8*86400000).toISOString();
    const expiring=createM5SqliteServices({store:x.store,filePath:x.filePath,clock:()=>due,authorize:()=>true});
    const bounded=await expiring.purgeExpired({scope:franklin,limit:1});
    assert.deepEqual(bounded.purgedIds,[],'a two-source bundle must never bypass limit=1');
    assert.ok((await x.store.findExactQuote({characterId:franklin.characterId,
      timelineId:franklin.timelineId,quote:a.content})).length>0);
    const gone=await expiring.purgeExpired({scope:franklin,limit:100});
    assert.ok(gone.purgedIds.includes(a.recordId)&&gone.purgedIds.includes(b.recordId));
    assert.deepEqual(await expiring.verifyPurge({scope:trevor,result:gone}),{confirmed:true});
    assert.deepEqual(await expiring.verifyPurge({scope:trevor,result:{
      ...gone,purgedIds:[a.recordId]}}),{confirmed:false},
      'a partial receipt for a completely purged bundle must not verify');
    assert.deepEqual(await expiring.verifyPurge({scope:trevor,result:{...gone,purgedIds:[id()]}}),{confirmed:false});
    assert.equal((await x.store.findExactQuote({characterId:franklin.characterId,
      timelineId:franklin.timelineId,quote:a.content})).length,0);
  }finally{await x.m5.close();await x.store.close();}
});

test('M5: restart retains cross-avatar command receipts, trash state, and authorized restore',async t=>{
  const x=await rig(t);
  try{
    const line=await x.say('franklin','Remember that I have a red scooter');
    const commandId=id();
    const result=await handleExplicitMemoryCommand({line,scope:x.who('franklin'),
      commandId,store:x.m5.bindCommands()});
    assert.equal(result.outcome,'saved');
    const trashId=id(),trash=await x.m5.trash({scope:x.who('michael'),
      targetId:result.memoryId,operationId:trashId});
    assert.equal(trash.durableCommit,true);
    await x.store.close();
    const reopened=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
    await reopened.initialize();
    try{
      reopened.setVerifiedHostContext({hostContextVersion:1,hostRunId:id(),worldEpoch:2});
      await reopened.confirmTimeline(x.who('trevor').timelineId);
      const m5=createM5SqliteServices({store:reopened,filePath:x.filePath,authorize:()=>true});
      await m5.ready(x.who('trevor'));
      assert.equal((await reopened.verifyCommand({scope:x.who('michael'),commandId})).memoryId,result.memoryId);
      assert.ok((await reopened.listSuppressedMemoryIds(x.who('franklin'))).includes(result.memoryId));
      const restored=await m5.restore({scope:x.who('trevor'),trashId,operationId:id()});
      assert.equal(restored.operation,'restore');
      assert.ok(!(await reopened.listSuppressedMemoryIds(x.who('michael'))).includes(result.memoryId));
      assert.ok((await m5.inspect({scope:x.who('franklin')})).records
        .some(row=>row.recordId===result.memoryId));
    }finally{await reopened.close();}
  }finally{await x.m5.close();await x.store.close();}
});
