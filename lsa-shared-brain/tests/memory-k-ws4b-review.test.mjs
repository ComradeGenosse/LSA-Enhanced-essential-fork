// WS-4b review: exercise the real P2 store, not a standalone mock database.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {DatabaseSync} from 'node:sqlite';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

const id=()=>randomUUID(),sha=x=>createHash('sha256').update(x).digest('hex');
async function setup(t,journalLimits={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'ws4b-review-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,'p2.sqlite');
  const store=createP2MemoryStorage({filePath,worldProfileId,journalLimits});
  await store.initialize();
  const owner=await store.create(profile());
  const timelineId=await store.createTimeline({label:'live'});
  await store.confirmTimeline(timelineId);
  const scope={worldProfileId,characterId:owner.characterId,timelineId,protagonistKey:'franklin'};
  const recorder=createConversationJournalRecorder(store);
  let seq=0;
  async function player(text,source='typed'){
    const receipt=await recorder.recordPlayerAccepted({characterId:scope.characterId,
      identity:{pedId:31,turnId:'ws4b-review-'+(++seq),generationId:'g',sessionNonce:'session-a'},
      text,source,attribution:{protagonist:'franklin'}});
    const lines=await store.readDialogueLines(scope);
    return lines.find(row=>row.recordId===receipt.recordId);
  }
  return {filePath,store,scope,owner,player,recorder};
}
async function command(x,operation,target,mode=null){
  const source=await x.player(operation==='forget'?'Please forget that':'Correction to my previous line');
  const content=operation==='correct'?'actually blue':'forget '+target.recordId;
  return x.store.commitCommand({scope:x.scope,commandId:id(),
    requestedByLineId:source.recordId,operation,origin:'explicit_player',
    recordType:operation==='correct'?'correction':'dialogue_line',
    content:operation==='forget'?target.content:content,
    contentHash:sha(operation==='forget'?target.content:content),
    pin:false,evidenceRecordIds:[target.recordId,source.recordId],
    targetRecordId:target.recordId,correctionMode:mode,subjectCertainty:operation==='correct'?'reported':null,
    requestedAtUtc:source.committedAtUtc});
}
async function reopened(x){
  await x.store.close();
  const next=createP2MemoryStorage({filePath:x.filePath,worldProfileId});
  await next.initialize();
  return next;
}
function present(lines,record){return lines.some(r=>r.recordId===record.recordId);}
test('WS-4b forgetting receipts and STT supersession survive restart; counter-claim does not erase',async t=>{
  const x=await setup(t);
  const forgotten=await x.player('unwanted raspberry secret');
  assert.equal((await command(x,'forget',forgotten)).status,'committed');
  const mistaken=await x.player('the answer was brue','stt');
  assert.equal((await command(x,'correct',mistaken,'transcript')).status,'committed');
  const disputed=await x.player('the bus was purple');
  assert.equal((await command(x,'correct',disputed,'counter_claim')).status,'committed');
  const before=(await x.store.readFreeRecallWindow(x.scope)).lines;
  assert.equal(present(before,forgotten),false);
  assert.equal(present(before,mistaken),false);
  assert.equal(present(before,disputed),true);
  assert.ok(before.some(r=>r.attribution.protagonist==='franklin'));
  const next=await reopened(x);
  try{
    const after=(await next.readFreeRecallWindow(x.scope)).lines;
    assert.equal(present(after,forgotten),false);
    assert.equal(present(after,mistaken),false);
    assert.equal(present(after,disputed),true);
    // Raw audit journal remains immutable, but must never be offered as free recall.
    assert.equal((await next.findExactQuote({...x.scope,quote:forgotten.content})).length,1);
  }finally{await next.close();}
});
test('WS-4b NPC failures and interruptions are not reported as spoken; completed evidence keeps native receipt',async t=>{
  const x=await setup(t);
  const makeNpc=async(status,text)=>{
    const row={version:1,characterId:x.scope.characterId,worldProfileId,
      timelineId:x.scope.timelineId,kind:'dialogue_line',recordId:id(),speaker:'npc',
      source:'npc_generated',content:text,delivery:status,
      committedAtUtc:new Date().toISOString(),turnIdentityHash:sha(id()),
      utteranceId:null,transcription:null,deliveryReceiptId:status==='failed'?null:id()};
    await x.store.appendDialogueLine(row,{sessionId:id(),protagonist:'franklin',hostRunId:null,worldEpoch:null});
    return row;
  };
  const completed=await makeNpc('completed','I definitely said this');
  const interrupted=await makeNpc('interrupted','I might have started this');
  const failed=await makeNpc('failed','I never played this');
  for(const store of [x.store]){
    try{
      const lines=(await store.readFreeRecallWindow(x.scope)).lines;
      assert.equal(present(lines,completed),true);
      assert.equal(present(lines,interrupted),false);
      assert.equal(present(lines,failed),false);
      const played=lines.find(row=>row.recordId===completed.recordId);
      assert.equal(played.delivery,'completed');
      assert.equal(played.deliveryReceiptId,completed.deliveryReceiptId);
      assert.equal(played.source,'npc_generated');
      assert.equal(played.attribution.protagonist,'franklin');
    }finally{if(store!==x.store)await store.close();}
  }
  const afterRestart=await reopened(x);
  try{
    const lines=(await afterRestart.readFreeRecallWindow(x.scope)).lines;
    assert.equal(present(lines,completed),true);
    assert.equal(present(lines,interrupted),false);
    assert.equal(present(lines,failed),false);
  }finally{await afterRestart.close();}
});
test('WS-4b extension-only index repair creates checked pre-migration snapshot',async t=>{
  const x=await setup(t);
  await x.store.close();
  const db=new DatabaseSync(x.filePath);
  try{db.exec('DROP INDEX p2_memory_replay_identity');}finally{db.close();}
  const prefix=await fs.readdir(x.filePath+'.snapshots');
  const next=createP2MemoryStorage({filePath:x.filePath,worldProfileId});
  await next.initialize();
  try{
    const after=await fs.readdir(x.filePath+'.snapshots');
    const added=after.filter(n=>n.startsWith('pre-migration-')&&!prefix.includes(n));
    assert.equal(added.length,1);
    const inspect=new DatabaseSync(path.join(x.filePath+'.snapshots',added[0]),{readOnly:true});
    try{
      assert.equal(inspect.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='p2_memory_replay_identity'").get(),undefined);
      assert.equal(inspect.prepare('PRAGMA quick_check').get().quick_check,'ok');
    }finally{inspect.close();}
    const active=new DatabaseSync(x.filePath,{readOnly:true});
    try{assert.ok(active.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='p2_memory_replay_identity'").get());}
    finally{active.close();}
  }finally{await next.close();}
});
test('WS-4b actual P2 M3 event admission stops exactly at configured event cap across restart',async t=>{
  const x=await setup(t,{events:2});
  const event=()=>({
    version:1,characterId:x.scope.characterId,worldProfileId,timelineId:x.scope.timelineId,
    kind:'journal_event',recordId:id(),observationId:id(),revision:1,eventType:'gunfire',
    receivedAtUtc:new Date().toISOString(),sourceHash:sha(id()),receiptStatus:'witnessed',
    ownerProof:{ownerAlias:x.owner.promotion.ownerAlias,incarnationId:id(),encounterId:id(),
      hostRunId:id(),worldEpoch:1,observerCaptureRef:id()},
    claims:[{kind:'gunfire',modality:'auditory',certainty:'direct',
      durableSubject:'player',sourceEvidenceId:id()}]
  });
  const a=event(),b=event(),c=event();
  assert.equal((await x.store.appendJournalEvent(a)).inserted,true);
  assert.equal((await x.store.appendJournalEvent(b)).inserted,true);
  assert.equal((await x.store.appendJournalEvent(b)).inserted,false,'duplicate does not spend quota');
  await assert.rejects(x.store.appendJournalEvent(c),/sqlite_journal_character_event_cap/);
  assert.equal(x.store.durabilityStatus.warning,'sqlite_journal_character_event_cap');
  const next=await reopened(x);
  try{
    assert.equal((await next.readJournalEvents(x.scope)).length,2);
    // Production defaults always permit at least as much as the configured
    // stricter test cap; cap persistence itself is a runtime policy, not DB state.
    assert.equal((await next.appendJournalEvent(c)).inserted,true);
  }finally{await next.close();}
});
test('WS-4b P2 byte and global limits fail closed with visible warning; original journal survives restart',async t=>{
  const x=await setup(t,{characterBytes:1400});
  let committed=0;
  for(let i=0;i<12;i++){
    try{await x.player('byte-boundary-'+i+' '+('x'.repeat(130)));committed++;}
    catch(e){assert.match(e.message,/sqlite_journal_character_byte_cap/);break;}
  }
  assert.ok(committed>0&&committed<12);
  assert.equal(x.store.durabilityStatus.warning,'sqlite_journal_character_byte_cap');
  const next=await reopened(x);
  try{assert.equal((await next.readDialogueLines(x.scope)).length,committed);}
  finally{await next.close();}
  const y=await setup(t,{globalBytes:1});
  await assert.rejects(y.player('cannot fit into one SQLite byte'),/sqlite_journal_global_byte_cap/);
  assert.equal(y.store.durabilityStatus.warning,'sqlite_journal_global_byte_cap');
  assert.equal((await y.store.readDialogueLines(y.scope)).length,0);
  await y.store.close();
});
test('WS-4b busy P2 event journal performance sample (real serialized writer, no mocks)',async t=>{
  const x=await setup(t);
  const N=550,started=performance.now();
  for(let i=0;i<N;i++){
    await x.store.appendJournalEvent({
      version:1,characterId:x.scope.characterId,worldProfileId,timelineId:x.scope.timelineId,
      kind:'journal_event',recordId:id(),observationId:id(),revision:1,eventType:'gunfire',
      receivedAtUtc:new Date().toISOString(),sourceHash:sha(id()),receiptStatus:'witnessed',
      ownerProof:{ownerAlias:x.owner.promotion.ownerAlias,incarnationId:id(),encounterId:id(),
        hostRunId:id(),worldEpoch:1,observerCaptureRef:id()},
      claims:[{kind:'gunfire',modality:'auditory',certainty:'direct',durableSubject:'player',sourceEvidenceId:id()}]
    });
  }
  const ms=performance.now()-started;
  console.log('WS4B_BUSY_JOURNAL',JSON.stringify({events:N,elapsedMs:Math.round(ms),eventsPerSecond:Math.round(N*1000/ms)}));
  assert.equal((await x.store.readJournalEvents(x.scope)).length,200);
  assert.ok(ms<90000,'busy journal exceeded 90s regression budget');
  await x.store.close();
});
