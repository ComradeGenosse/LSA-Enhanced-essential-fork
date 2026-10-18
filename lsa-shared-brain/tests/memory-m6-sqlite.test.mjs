import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {createM6SelectionCoordinator} from '../src/memory/m6Coordinator.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

test('M6 committed SQLite journal creates a permanent memory and replays exactly once after restart',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'m6-sqlite-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 const filePath=path.join(dir,'p2.sqlite');
 const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
 await store.initialize();
 const p=await store.create(profile());
 const timelineId=await store.createTimeline({label:'test'});
 const host={hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:4};
 store.setVerifiedHostContext(host);
 await store.confirmTimeline(timelineId,{confirmation:timelineId});
 const scope={characterId:p.characterId,worldProfileId,timelineId};
 const text='That was hilarious! The car completely flipped.';
 let originalId;
 try{
  const journal=createConversationJournalRecorder(store);
  const result=await journal.recordPlayerAccepted({
   characterId:p.characterId,identity:{pedId:10,turnId:'m6-real',generationId:'gen-1',
    sessionNonce:'m6-test'},text,source:'typed',
   attribution:{protagonist:'franklin'}});
  originalId=result.recordId;
  const coordinator=createM6SelectionCoordinator({store,allowLegacyBoundedReplay:true});
  const checkpoint=await coordinator.onSceneClose({scope,atUtc:new Date().toISOString()});
  assert.equal(checkpoint.saved.length,1);
  assert.equal(checkpoint.saved[0].inserted,true);
  const saved=await store.readPermanentMemoryRows({...scope,protagonistKey:'franklin'});
  assert.equal(saved.length,1);
  assert.deepEqual(saved[0].envelope.sourceEvidenceIds,[originalId]);
  assert.match(saved[0].envelope.content,/Player said:/);
  assert.equal((await coordinator.onSceneClose({scope,atUtc:new Date().toISOString()})).saved.length,0);
 }finally{await store.close();}
 const reopened=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
 await reopened.initialize();
 try{
  await assert.rejects(createM6SelectionCoordinator({store:reopened,allowLegacyBoundedReplay:true})
   .recover({scope,atUtc:new Date(Date.now()+120000).toISOString()}),/m6_timeline_not_writable/);
  reopened.setVerifiedHostContext({...host,hostRunId:randomUUID(),worldEpoch:5});
  await reopened.confirmTimeline(timelineId,{confirmation:timelineId});
  const recovered=await createM6SelectionCoordinator({store:reopened,allowLegacyBoundedReplay:true})
   .recover({scope,atUtc:new Date(Date.now()+120000).toISOString()});
  assert.equal(recovered.saved.length,0);
  const rows=await reopened.readPermanentMemoryRows({...scope,protagonistKey:'franklin'});
  assert.equal(rows.length,1);
  assert.deepEqual(rows[0].envelope.sourceEvidenceIds,[originalId]);
 }finally{await reopened.close();}
});
