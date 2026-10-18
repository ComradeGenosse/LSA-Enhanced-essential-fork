// Original pinned runner + real P2/PS4. Native frames and providers remain the
// existing explicit offline harness fixtures; these are not GTA receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {d01Harness} from './memory/d01-harness.mjs';
import {createConversationJournalRecorder} from '../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {createM5SqliteServices} from '../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';

for(const state of ['forgotten','damaged-ledger','corrected'])test(`E2/WS6 storage-only original runner excludes ${state} RAM history with M2–M9 off`,
 {timeout:45000},async t=>{
 const x=await d01Harness(t,{config:{memoryK:{profile:'storage-only'}}});
 const secret='Inside joke: the E2 confidential lilac bicycle.';
 const first=await x.typed(secret);assert.equal((await x.settled(first)).status,'completed');
 assert.equal((await x.journal()).players.length,0,'optional recording stays off');
 // Seed retained evidence through the existing recorder contract. This does
 // not enable production M2/F; the first turn also leaves genuine RAM history.
 const line=await createConversationJournalRecorder(x.store).recordPlayerAccepted({characterId:x.profile.characterId,
  identity:{pedId:17,turnId:'e2-retained',generationId:'g1',sessionNonce:'e2'},
  text:secret,source:state==='corrected'?'stt':'typed',attribution:{protagonist:'franklin'}});
 const scope={characterId:x.profile.characterId,worldProfileId:x.store.worldProfileId,
  timelineId:x.timelineId,protagonistKey:'franklin'};
 if(state==='corrected'){
  const text='I actually said the public blue bicycle.';
  const request=await createConversationJournalRecorder(x.store).recordPlayerAccepted({characterId:x.profile.characterId,
   identity:{pedId:17,turnId:'e2-correction',generationId:'g1',sessionNonce:'e2'},
   text,source:'typed',attribution:{protagonist:'franklin'}});
  const requested=(await x.store.readDialogueLines(scope)).find(r=>r.recordId===request.recordId);
  await x.store.commitCommand({scope,commandId:randomUUID(),operation:'correct',correctionMode:'transcript',
   requestedByLineId:requested.recordId,targetRecordId:line.recordId,evidenceRecordIds:[requested.recordId,line.recordId],
   content:text,contentHash:createHash('sha256').update(text).digest('hex'),requestedAtUtc:requested.committedAtUtc});
 }else await createM5SqliteServices({store:x.store,filePath:x.store.filePath,authorize:()=>true})
  .trash({scope,targetId:line.recordId,operationId:randomUUID()});
 if(state==='damaged-ledger')await x.store.withTimelineSqliteWrite(scope,db=>
  db.prepare('UPDATE memory_suppressions SET receipt_sha256=?').run('0'.repeat(64)));
 x.h.runtime.memoryD02=null;
 const turn=await x.typed('Can you repeat the old joke?');
 assert.equal((await x.settled(turn)).status,'completed');
 assert.ok(!JSON.stringify(x.replies.at(-1).knowledgeProjection.modelAllocation).includes(secret),
  'the WS6 persistent-history repair must survive unavailable optional preflight');
 assert.equal(x.h.runtime.memoryM3,undefined);
});
