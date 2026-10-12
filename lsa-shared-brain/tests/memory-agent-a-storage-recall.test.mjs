// Agent A: real P2 SQLite regressions for ONE player across three source avatars.
// Keep the umbrella integration test unmodified.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {recallFromSharedJournal,createP2IntegratedRecallAdapter} from '../src/memory/integrationPorts.mjs';
import {recallMemory} from '../src/memory/recallEngine.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

const id=()=>randomUUID();
const sha=s=>createHash('sha256').update(s).digest('hex');
const avatar=(scope,who)=>({...scope,protagonistKey:who});
const query=(s,word)=>({version:1,kind:'recall_query',queryId:id(),
  characterId:s.characterId,worldProfileId:s.worldProfileId,timelineId:s.timelineId,
  turnIdentityHash:'b'.repeat(64),intent:'exact_quote',
  question:'what did I say about '+word+'?',maxBytes:4096});
async function fixture(t){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'memory-agent-a-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,'p2.sqlite'),host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
  const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  const npc=await store.create(profile());
  const timelineId=await store.createTimeline({label:'one human'});
  store.setVerifiedHostContext(host);
  await store.confirmTimeline(timelineId);
  const scope={characterId:npc.characterId,worldProfileId,timelineId,protagonistKey:'franklin'};
  const recorder=createConversationJournalRecorder(store);
  let turn=0;
  async function say(who,content){
    const written=await recorder.recordPlayerAccepted({
      characterId:scope.characterId,source:'typed',text:content,
      identity:{pedId:101,turnId:'agent-a-turn-'+(++turn),generationId:'a',sessionNonce:'a'},
      attribution:{protagonist:who}});
    const lines=await store.readDialogueLines({characterId:scope.characterId,timelineId,limit:500});
    const line=lines.find(l=>l.recordId===written.recordId);
    assert.ok(line);
    assert.equal(line.attribution.protagonist,who);
    return line;
  }
  return {store,filePath,host,scope,say};
}
function command(scope,line,operation,target=null,content=line.content){
  return {scope,commandId:id(),requestedByLineId:line.recordId,operation,
    content,contentHash:sha(content),pin:false,requestedAtUtc:line.committedAtUtc,
    evidenceRecordIds:target?[line.recordId,target.recordId]:[line.recordId],
    targetRecordId:target?.recordId??null};
}
async function ask(store,scope,word,integrated=false){
  const args={query:query(scope,word),protagonistKey:scope.protagonistKey,
    nowUtc:new Date().toISOString()};
  return integrated?recallMemory({...args,readAdapter:createP2IntegratedRecallAdapter(store)}):
    recallFromSharedJournal({...args,store});
}
test('A: Franklin memory -> Michael correction -> Trevor shared M4 recall, no stale duplicate',async t=>{
  const x=await fixture(t);
  try{
    const franklin=await x.say('franklin','My zephyr passphrase is cobalt.');
    const remembered=await x.store.commitCommand(command(avatar(x.scope,'franklin'),franklin,'remember'));
    assert.equal(remembered.status,'committed');
    for(const who of ['franklin','michael','trevor']){
      const s=avatar(x.scope,who);
      const rows=await x.store.readPermanentMemoryRows(s);
      assert.equal(rows.filter(r=>r.recordId===remembered.memoryId).length,1);
      assert.equal(rows.find(r=>r.recordId===remembered.memoryId).protagonistKey,'franklin');
      for(const integrated of [false,true]){
        const result=(await ask(x.store,s,'zephyr',integrated)).bundle;
        assert.equal(result.status,'matched');
        assert.ok(result.items.some(r=>r.recordId===franklin.recordId));
        assert.equal(new Set(result.items.map(r=>r.recordId)).size,result.items.length);
      }
    }
    const michael=await x.say('michael','Correction: the zephyr passphrase is emerald.');
    const corrected=await x.store.commitCommand(command(avatar(x.scope,'michael'),michael,
      'correct',franklin,'The zephyr passphrase is emerald.'));
    assert.equal(corrected.status,'committed');
    for(const who of ['franklin','michael','trevor']){
      const s=avatar(x.scope,who);
      assert.ok(!(await x.store.readPermanentMemoryRows(s)).some(r=>r.recordId===remembered.memoryId));
      for(const integrated of [false,true]){
        const result=(await ask(x.store,s,'zephyr',integrated)).bundle;
        assert.ok(result.items.some(r=>r.recordId===corrected.commandId&&r.mode==='reported_claim'));
        assert.ok(!result.items.some(r=>r.recordId===franklin.recordId));
        assert.equal(new Set(result.items.map(r=>r.recordId)).size,result.items.length);
      }
    }
    const overlays=await x.store.readCorrectionOverlays(avatar(x.scope,'trevor'));
    assert.equal(overlays.find(r=>r.recordId===corrected.commandId)?.protagonistKey,'michael');
  }finally{await x.store.close();}
});

test('A: Trevor dialogue persists through reopen for Franklin; Michael forget crosses avatars',async t=>{
  const x=await fixture(t);
  const trevor=await x.say('trevor','A yellow albatross follows the same human player.');
  const saved=await x.store.commitCommand(command(avatar(x.scope,'trevor'),trevor,'remember'));
  await x.store.close();
  const restored=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
  await restored.initialize();
  try{
    const scope=avatar(x.scope,'franklin');
    assert.equal((await restored.readPermanentMemoryRows(scope))
      .find(r=>r.recordId===saved.memoryId)?.protagonistKey,'trevor');
    assert.ok((await ask(restored,scope,'albatross')).bundle.items.some(r=>r.recordId===trevor.recordId));
    restored.setVerifiedHostContext(x.host);
    await restored.confirmTimeline(scope.timelineId);
    const recorder=createConversationJournalRecorder(restored);
    const receipt=await recorder.recordPlayerAccepted({characterId:scope.characterId,
      identity:{pedId:101,turnId:'forget-after-reopen',generationId:'a',sessionNonce:'a'},
      text:'Forget that yellow albatross memory.',source:'typed',
      attribution:{protagonist:'michael'}});
    const lines=await restored.readDialogueLines({characterId:scope.characterId,timelineId:scope.timelineId});
    const michael=lines.find(l=>l.recordId===receipt.recordId);
    assert.ok(michael);
    assert.equal((await restored.commitCommand(command(avatar(scope,'michael'),michael,'forget',trevor))).status,'committed');
    for(const who of ['franklin','michael','trevor']){
      const s=avatar(scope,who);
      assert.ok((await restored.listSuppressedMemoryIds(s)).includes(trevor.recordId));
      assert.ok(!(await restored.readPermanentMemoryRows(s)).some(r=>r.recordId===saved.memoryId));
      const bundle=(await ask(restored,s,'albatross')).bundle;
      assert.ok(!bundle.items.some(r=>r.recordId===trevor.recordId||r.recordId===saved.memoryId));
    }
  }finally{await restored.close();}
});

test('A: altered accepted-line SQLite delivery cannot certify derived player memory',async t=>{
  const x=await fixture(t);
  const franklin=await x.say('franklin','The immutable narwhal phrase is indigo.');
  const saved=await x.store.commitCommand(command(x.scope,franklin,'remember'));
  await x.store.close();
  const raw=new DatabaseSync(x.filePath);
  try{
    raw.prepare('UPDATE dialogue_journal SET delivery=? WHERE record_id=?')
      .run('rejected',franklin.recordId);
  }finally{raw.close();}
  const reopened=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
  await reopened.initialize();
  try{
    for(const who of ['franklin','michael','trevor']){
      const s=avatar(x.scope,who);
      assert.ok(!(await reopened.readPermanentMemoryRows(s)).some(r=>r.recordId===saved.memoryId));
      assert.ok(!(await reopened.findCandidates({scope:s})).some(r=>r.recordId===franklin.recordId));
      const bundle=(await ask(reopened,s,'narwhal')).bundle;
      assert.equal(bundle.status,'unavailable');
    }
  }finally{await reopened.close();}
});

test('A: corrected grandparent suppresses every derived descendant and limit counts visible memories',async t=>{
  const x=await fixture(t);
  try{
    const prior=await x.say('franklin','The unrelated marmalade secret remains valid.');
    const kept=await x.store.commitCommand(command(x.scope,prior,'remember'));
    const origin=await x.say('franklin','The old nested token is copper.');
    const first=await x.store.commitCommand(command(x.scope,origin,'remember'));
    const michael=await x.say('michael','Remember the earlier nested copper token.');
    const derived=await x.store.commitCommand({...command(avatar(x.scope,'michael'),michael,'remember'),
      evidenceRecordIds:[michael.recordId,first.memoryId]});
    const trevor=await x.say('trevor','The nested token used to be copper.');
    const grandchild=await x.store.commitCommand({...command(avatar(x.scope,'trevor'),trevor,'remember'),
      evidenceRecordIds:[trevor.recordId,derived.memoryId]});
    assert.equal(derived.status,'committed');assert.equal(grandchild.status,'committed');
    const correction=await x.say('michael','Correct that: nested token is silver.');
    assert.equal((await x.store.commitCommand(command(avatar(x.scope,'michael'),correction,
      'correct',origin,'The nested token is silver.'))).status,'committed');
    for(const who of ['franklin','michael','trevor']){
      const scope=avatar(x.scope,who);
      const visible=await x.store.readPermanentMemoryRows(scope,{limit:1});
      assert.equal(visible.length,1,'revoked newest rows must not consume the SQL page limit');
      assert.equal(visible[0].recordId,kept.memoryId);
      const candidates=await x.store.findCandidates({scope});
      for(const hidden of [first.memoryId,derived.memoryId,grandchild.memoryId])
        assert.ok(!candidates.some(row=>row.recordId===hidden),'transitive source was corrected');
      const m4=await x.store.readIntegratedRecall({scope,sourceKind:'permanent_memory',limit:2});
      assert.ok(m4.rows.every(row=>![first.memoryId,derived.memoryId,grandchild.memoryId].includes(row.recordId)));
      assert.ok(m4.rows.some(row=>row.recordId===kept.memoryId));
    }
  }finally{await x.store.close();}
});
