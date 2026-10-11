import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {handleExplicitMemoryCommand} from '../src/memory/explicitCommands.mjs';
import {recallFromSharedJournal} from '../src/memory/integrationPorts.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

const id=()=>randomUUID();
const identity=(n)=>({pedId:101,turnId:n,generationId:'g1',sessionNonce:'test-session'});
const request=(scope,question)=>({version:1,kind:'recall_query',characterId:scope.characterId,
 worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,queryId:id(),
 turnIdentityHash:'b'.repeat(64),intent:'exact_quote',question,maxBytes:4096});
async function setup(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'memory-integration-'));
 t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const filePath=path.join(dir,'p2.sqlite');
 const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
 await store.initialize();
 const p=await store.create(profile());
 const timelineId=await store.createTimeline({label:'current'});
 const host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
 store.setVerifiedHostContext(host);
 await store.confirmTimeline(timelineId);
 const scope={characterId:p.characterId,worldProfileId,timelineId,protagonistKey:'franklin'};
 return {filePath,store,scope,recorder:createConversationJournalRecorder(store),host};
}
test('M2 -> real M5 command writes -> readback -> reopen without false acknowledgement',async t=>{
 const x=await setup(t);
 try {
  const record=await x.recorder.recordPlayerAccepted({
   characterId:x.scope.characterId,identity:identity('one'),source:'typed',
   text:'Remember that I hate olives',attribution:{protagonist:'franklin'}});
  const line=(await x.store.readDialogueLines({characterId:x.scope.characterId,timelineId:x.scope.timelineId}))[0];
  const commandId=id();
  const a=await handleExplicitMemoryCommand({line,scope:x.scope,commandId,store:x.store});
  assert.equal(a.outcome,'saved');assert.equal(a.durableCommit,true);
  assert.deepEqual(a.evidenceRecordIds,[record.recordId]);
  assert.deepEqual((await x.store.verifyCommand({scope:x.scope,commandId})).memoryId,a.memoryId);
  const rerun=await handleExplicitMemoryCommand({line,scope:x.scope,commandId,store:x.store});
  assert.deepEqual(rerun,a);
  await x.store.close();
  const second=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
  await second.initialize();
  try{
   assert.equal((await second.verifyCommand({scope:x.scope,commandId})).status,'committed');
   assert.ok((await second.inspect({scope:x.scope})).some(item=>item.content==='I hate olives'));
  }finally{await second.close()}
 }finally{await x.store.close()}
});
test('M4 reads real M2 bytes but excludes foreign protagonists and suppresses missing evidence',async t=>{
 const x=await setup(t);
 try{
  const text='  🚗 TWO spaces  with olives!  ';
  await x.recorder.recordPlayerAccepted({characterId:x.scope.characterId,identity:identity('phrase'),
    source:'typed',text,attribution:{protagonist:'franklin'}});
  await x.recorder.recordPlayerAccepted({characterId:x.scope.characterId,identity:identity('secret'),
    source:'typed',text:'trevor-only pineapple',attribution:{protagonist:'trevor'}});
  const found=await recallFromSharedJournal({store:x.store,query:request(x.scope,'what did I say about olives?'),
    protagonistKey:'franklin',nowUtc:new Date().toISOString()});
  assert.equal(found.bundle.status,'matched');
  assert.equal(found.bundle.items[0].content,text);
  const missing=await recallFromSharedJournal({store:x.store,query:request(x.scope,'what did I say about pineapple?'),
    protagonistKey:'franklin',nowUtc:new Date().toISOString()});
  assert.equal(missing.bundle.status,'unavailable');
 }finally{await x.store.close()}
});
test('M1 source revocation makes real M5 commit fail without acknowledging success',async t=>{
 const x=await setup(t);
 try{
  await x.recorder.recordPlayerAccepted({characterId:x.scope.characterId,identity:identity('revocation'),
   source:'typed',text:'Remember that I dislike bugs',attribution:{protagonist:'franklin'}});
  const line=(await x.store.readDialogueLines({characterId:x.scope.characterId,timelineId:x.scope.timelineId}))[0];
  x.store.setVerifiedHostContext(null);
  const response=await handleExplicitMemoryCommand({line,scope:x.scope,commandId:id(),store:x.store});
  assert.equal(response.outcome,'failed');assert.equal(response.durableCommit,false);
 }finally{await x.store.close()}
});
