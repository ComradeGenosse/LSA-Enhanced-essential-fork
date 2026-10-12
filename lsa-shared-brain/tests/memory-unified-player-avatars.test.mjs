// Regression: ONE human player, three authenticated historical GTA source avatars.
// This exercises the actual P2 SQLite owner and SQL, not a mocked memory adapter.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {createM5SqliteServices} from '../src/memory/m5SqlitePrivacy.mjs';
import {recallFromSharedJournal,createP2IntegratedRecallAdapter} from '../src/memory/integrationPorts.mjs';
import {recallMemory} from '../src/memory/recallEngine.mjs';
import {evaluateM8} from '../src/memory/m8Interpretation.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

const id=()=>randomUUID();
const sha=x=>createHash('sha256').update(x,'utf8').digest('hex');
const avatar=(s,protagonistKey)=>({...s,protagonistKey});
function query(s,question){return {version:1,kind:'recall_query',
  characterId:s.characterId,worldProfileId:s.worldProfileId,timelineId:s.timelineId,
  queryId:id(),turnIdentityHash:'b'.repeat(64),intent:'exact_quote',question,maxBytes:4096};}
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'unified-player-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const filePath=path.join(root,'p2.sqlite'),host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
  const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  const npc=await store.create(profile()),timelineId=await store.createTimeline({label:'unified player'});
  store.setVerifiedHostContext(host);await store.confirmTimeline(timelineId);
  const scope={characterId:npc.characterId,worldProfileId,timelineId,protagonistKey:'franklin'};
  const recorder=createConversationJournalRecorder(store);
  let turn=0;
  async function say(who,content){
    const receipt=await recorder.recordPlayerAccepted({characterId:npc.characterId,
      identity:{pedId:101,turnId:'player-turn-'+(++turn),generationId:'generation-1',sessionNonce:'avatar-source'},
      source:'typed',text:content,attribution:{protagonist:who}});
    const rows=await store.readDialogueLines({characterId:npc.characterId,timelineId,limit:500});
    const line=rows.find(x=>x.recordId===receipt.recordId);
    assert.ok(line);assert.equal(line.attribution.protagonist,who);
    return line;
  }
  return {root,filePath,host,store,scope,npc,say};
}
function command(scope,requestLine,operation,target=null,content=requestLine.content){
  return {scope,commandId:id(),requestedByLineId:requestLine.recordId,operation,
    content,contentHash:sha(content),pin:false,requestedAtUtc:requestLine.committedAtUtc,
    evidenceRecordIds:target?[requestLine.recordId,target.recordId]:[requestLine.recordId],
    targetRecordId:target?.recordId??null};
}
async function ask(store,scope,question){
  return recallFromSharedJournal({store,query:query(scope,question),
    protagonistKey:scope.protagonistKey,nowUtc:new Date().toISOString()});
}

test('one NPC remembers player dialogue and permanent memories across Franklin/Michael/Trevor',async t=>{
  const x=await fixture(t);try{
    const franklin=await x.say('franklin','My player name is Alex and I like blue cars.');
    const michael=await x.say('michael','I promised to help you with the red car.');
    const trevor=await x.say('trevor','We found a ridiculous purple scooter!');
    const saved=await x.store.commitCommand(command(avatar(x.scope,'franklin'),franklin,'remember'));
    assert.equal(saved.status,'committed');
    for(const who of ['franklin','michael','trevor','franklin']){
      const scope=avatar(x.scope,who);
      const records=await x.store.readPermanentMemoryRows(scope);
      assert.ok(records.some(r=>r.recordId===saved.memoryId));
      assert.equal(records.find(r=>r.recordId===saved.memoryId).protagonistKey,'franklin');
      const found=await x.store.findCandidates({scope});
      assert.ok([franklin,michael,trevor].every(line=>found.some(r=>r.recordId===line.recordId)));
      for(const phrase of ['Alex','promised','scooter']){
        const result=await ask(x.store,scope,'what did I say about '+phrase+'?');
        assert.equal(result.bundle.status,'matched',who+': '+phrase);
      }
    }
  }finally{await x.store.close();}
});

test('M5 forget/correct/inspect/export and reversible trash span historical source avatars',async t=>{
  const x=await fixture(t);try{
    const franklin=await x.say('franklin','My favorite car is a blue Comet.');
    const remember=await x.store.commitCommand(command(avatar(x.scope,'franklin'),franklin,'remember'));
    const trevorCorrect=await x.say('trevor','Correction: my favorite car is a red Comet.');
    const corrected=await x.store.commitCommand(command(avatar(x.scope,'trevor'),trevorCorrect,
      'correct',franklin,'My favorite car is a red Comet.'));
    assert.equal(corrected.status,'committed');
    const michael=avatar(x.scope,'michael');
    assert.ok((await x.store.readCorrectionOverlays(michael))
      .some(r=>r.targetId===franklin.recordId && r.protagonistKey==='trevor'));
    const m5=createM5SqliteServices({store:x.store,filePath:x.filePath,authorize:()=>true});
    await m5.ready(michael);
    const inspected=await m5.inspect({scope:michael});
    assert.ok(inspected.records.some(r=>r.recordId===remember.memoryId));
    const archive=JSON.parse((await m5.exportArchive({scope:michael})).json);
    assert.ok(archive.dialogue.some(r=>r.recordId===franklin.recordId));
    assert.ok(archive.dialogue.some(r=>r.recordId===trevorCorrect.recordId));
    assert.ok(archive.corrections.some(r=>r.command_id===corrected.commandId));
    const trashed=await m5.trash({scope:michael,targetId:franklin.recordId});
    assert.ok(trashed.targetIds.includes(franklin.recordId));
    assert.ok((await x.store.listSuppressedMemoryIds(avatar(x.scope,'trevor'))).includes(franklin.recordId));
    const restored=await m5.restore({scope:avatar(x.scope,'trevor'),trashId:trashed.operationId});
    assert.equal(restored.operation,'restore');
    assert.ok(!(await x.store.listSuppressedMemoryIds(x.scope)).includes(franklin.recordId));
    const michaelForget=await x.say('michael','Forget the blue Comet memory.');
    const forgot=await x.store.commitCommand(command(michael,michaelForget,'forget',franklin));
    assert.equal(forgot.status,'committed');
    for(const who of ['franklin','michael','trevor']){
      const c=avatar(x.scope,who);
      assert.ok((await x.store.listSuppressedMemoryIds(c)).includes(franklin.recordId));
      assert.ok(!(await x.store.findCandidates({scope:c})).some(r=>r.recordId===franklin.recordId));
    }
    await m5.close();
  }finally{await x.store.close();}
});

test('M6/P2 replay uses one durable cursor across source avatars and survives SQLite restart',async t=>{
  const x=await fixture(t);try{
    const first=await x.say('franklin','A helpful greeting to the NPC.');
    const second=await x.say('michael','We had a great evening together.');
    const third=await x.say('trevor','That was a funny car flip.');
    const scope=avatar(x.scope,'franklin'),consumerId='unified-player-regression';
    const start=await x.store.readCommittedEvidenceCursor({scope,consumerId});
    const page=await x.store.readCommittedEvidencePage({scope,cursor:start.cursor,limit:25});
    assert.deepEqual(new Set(page.items.map(r=>r.recordId)),new Set([first.recordId,second.recordId,third.recordId]));
    assert.equal((await x.store.ackCommittedEvidenceCursor({
      scope,consumerId,cursor:page.cursor,expectedCursor:start.cursor})).committed,true);
    const switched=await x.store.readCommittedEvidenceCursor({scope:avatar(scope,'trevor'),consumerId});
    assert.equal(switched.cursor,page.cursor);
    assert.equal((await x.store.readCommittedEvidencePage({scope:avatar(scope,'michael'),cursor:page.cursor})).items.length,0);
    await x.store.close();
    const secondStore=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
    await secondStore.initialize();try{
      secondStore.setVerifiedHostContext({hostContextVersion:1,hostRunId:id(),worldEpoch:2});
      await secondStore.confirmTimeline(scope.timelineId);
      const persisted=await secondStore.readCommittedEvidenceCursor({scope:avatar(scope,'michael'),consumerId});
      assert.equal(persisted.cursor,page.cursor);
      const oldV1=Buffer.from(JSON.stringify({v:1,scope:'invalid',after:1}),'utf8').toString('base64url');
      await assert.rejects(secondStore.readCommittedEvidencePage({scope,cursor:oldV1}),/invalid_cursor/);
    }finally{await secondStore.close();}
  }finally{await x.store.close();}
});

test('M6 consolidation and M8 interpretations share sources but keep immutable avatar provenance',async t=>{
  const x=await fixture(t);try{
    const franklin=await x.say('franklin','Thanks for helping me with the cars.');
    const michael=await x.say('michael','That was hilarious!');
    const trevor=await x.say('trevor','That was hilarious, friend!');
    const proposal={version:1,kind:'curation_proposal',provider:'deterministic',
      proposalId:id(),characterId:x.scope.characterId,worldProfileId,timelineId:x.scope.timelineId,
      evidenceRecordIds:[franklin.recordId,michael.recordId,trevor.recordId],
      groundedSummary:'The player thanked the NPC and joked together.',notability:.85};
    assert.equal((await x.store.saveDeterministicMemory(proposal)).inserted,true);
    const permanent=await x.store.readPermanentMemoryRows(avatar(x.scope,'trevor'));
    assert.ok(permanent.some(r=>r.recordId===proposal.proposalId));
    const sources=[franklin,michael,trevor].map(record=>({record,committed:true,sourceVerified:true}));
    const a=evaluateM8({scope:avatar(x.scope,'franklin'),sources,nowUtc:new Date().toISOString()});
    const b=evaluateM8({scope:avatar(x.scope,'trevor'),sources,nowUtc:new Date().toISOString()});
    assert.deepEqual(a.relationship.dimensions,b.relationship.dimensions);
    assert.ok(a.relationship.dimensions.trust>0);
    assert.deepEqual(a.jokes.map(j=>j.id),b.jokes.map(j=>j.id));
    assert.deepEqual(a.interpretations.map(j=>j.id),b.interpretations.map(j=>j.id));
    assert.ok(a.facts.some(f=>f.recordId===trevor.recordId));
  }finally{await x.store.close();}
});

test('same model and avatar do not leak records across NPC owners or save timelines',async t=>{
  const x=await fixture(t);try{
    const line=await x.say('franklin','Only this NPC knows the secret blue key.');
    const saved=await x.store.commitCommand(command(x.scope,line,'remember'));
    const other=await x.store.create(profile());
    const alienNpc={...x.scope,characterId:other.characterId,protagonistKey:'trevor'};
    assert.equal((await x.store.readPermanentMemoryRows(alienNpc)).length,0);
    const another=await x.store.createTimeline({label:'separate playthrough'});
    await x.store.confirmTimeline(another);
    const alternate={...x.scope,timelineId:another,protagonistKey:'michael'};
    assert.equal((await x.store.readPermanentMemoryRows(alternate)).length,0);
    assert.ok((await x.store.readPermanentMemoryRows(x.scope)).some(r=>r.recordId===saved.memoryId));
  }finally{await x.store.close();}
});
