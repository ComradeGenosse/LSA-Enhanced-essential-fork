import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createEssentialMemoryStorage} from '../src/characters/memoryStorageAdapter.mjs';
import {createStandaloneMemoryStorage} from '../../lsa-standalone-companion/src/memory/memoryStorageAdapter.mjs';
import {createConversationJournalRecorder} from '../../lsa-shared-brain/src/memory/conversationRecorder.mjs';
import {JOURNAL_SCHEMA_VERSION} from '../../lsa-shared-brain/src/memory/journalSqlite.mjs';
import {worldProfileId} from './identity-fixtures.mjs';
import {profile} from './p2-fixtures.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
const native=(hostRunId=randomUUID(),worldEpoch=1)=>({hostContextVersion:1,hostRunId,worldEpoch});
const turn=(id='t1')=>({pedId:101,turnId:id,generationId:'g1',sessionNonce:'session-one'});
const receipt=i=>({...i,type:'playback_ended',reason:'completed',ok:true,
  wasInterrupted:false,hadAudio:true,playbackStarted:true});
async function setup(t,{standalone=false,sourceRequired=true}={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'m2-journal-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,'profiles.sqlite');
  const Factory=standalone?createStandaloneMemoryStorage:createEssentialMemoryStorage;
  const store=Factory({filePath,worldProfileId,sourceRequired});
  await store.initialize();
  const a=await store.create(profile());
  const timeline=await store.createTimeline({label:'Save A'});
  const host=native();
  store.setVerifiedHostContext(host);
  await store.confirmTimeline(timeline);
  const recorder=createConversationJournalRecorder(store);
  return {dir,filePath,store,Factory,a,timeline,host,recorder};
}
function player(x,options={}){
  return x.recorder.recordPlayerAccepted({characterId:x.a.characterId,identity:turn(),
    source:'typed',text:'The exact words I accepted.',...options});
}
const read=(x,extra={})=>x.store.readDialogueLines({characterId:x.a.characterId,timelineId:x.timeline,...extra});
test('M2 single store migrates to v3, retains M1 profiles, and supports both adapters',async t=>{
  const x=await setup(t);
  try{
    const raw=x.store.get(x.a.characterId);
    const sqlite=new DatabaseSync(x.filePath);
    assert.equal(sqlite.prepare('PRAGMA user_version').get().user_version,JOURNAL_SCHEMA_VERSION);
    assert.equal(sqlite.prepare('SELECT count(*) n FROM dialogue_journal').get().n,0);
    sqlite.close();
    assert.deepEqual(x.store.get(x.a.characterId),raw);
    await player(x);
    await x.store.close();
    const second=createStandaloneMemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
    await second.initialize();
    try{
      assert.equal(second.timelineWritable,false,'host handoff never restores source approval');
      assert.equal((await second.readDialogueLines({characterId:x.a.characterId,timelineId:x.timeline}))[0].content,
        'The exact words I accepted.');
      await assert.rejects(second.appendDialogueLine({},{}),/timeline_write_suspended/);
    }finally{await second.close();}
  }finally{await x.store.close();}
});
test('M2 player accepted text is byte-exact, scoped, source-qualified, searchable, and persisted',async t=>{
  const x=await setup(t);
  const raw="  YOU said: \u201cDon't touch my car\u201d!\nFuck that. 🚗  ";
  try{
    const first=await player(x,{text:raw,attribution:{protagonist:'franklin'}});
    assert.equal(first.inserted,true);
    const lines=await read(x);
    assert.equal(lines.length,1);
    assert.equal(Buffer.compare(Buffer.from(lines[0].content),Buffer.from(raw)),0);
    assert.equal(lines[0].speaker,'player');assert.equal(lines[0].source,'typed');
    assert.equal(lines[0].attribution.protagonist,'franklin');
    assert.equal(lines[0].attribution.hostRunId,x.host.hostRunId);
    assert.equal((await x.store.findExactQuote({characterId:x.a.characterId,timelineId:x.timeline,quote:raw})).length,1);
    assert.equal((await x.store.findExactQuote({characterId:x.a.characterId,timelineId:x.timeline,quote:raw.trim()})).length,0);
    assert.equal((await x.store.searchDialogue({characterId:x.a.characterId,timelineId:x.timeline,query:'touch my car'})).length,1);
    assert.equal((await x.store.searchDialogue({characterId:x.a.characterId,timelineId:randomUUID(),query:'touch my car'})).length,0);
    assert.equal((await x.store.readDialogueLines({characterId:randomUUID(),timelineId:x.timeline})).length,0);
    // Return a different session/source record, and preserve the original line.
    const stt='I said \u201cdo NOT go in!\u201d';
    await player(x,{identity:turn('t2'),source:'stt',text:stt,
      transcription:{provider:'openai',model:'gpt-transcribe',confidence:null}});
    const records=await read(x);
    assert.equal(records[0].source,'stt');assert.equal(records[0].transcription.confidence,null);
    assert.equal(records[1].content,raw);
  }finally{await x.store.close();}
});
test('M2 idempotent replay across reconnect, retry, and restart; conflicts fail',async t=>{
  const x=await setup(t);
  try{
    const one=await player(x);
    const replay=await player(x);
    assert.equal(replay.inserted,false);
    assert.equal(replay.recordId,one.recordId);
    assert.equal((await read(x)).length,1);
    await assert.rejects(player(x,{text:'Different words, same turn.'}),/journal_replay_conflict/);
    assert.equal((await read(x)).length,1);
    x.store.setVerifiedHostContext(null);
    await assert.rejects(player(x,{identity:turn('t3')}),/timeline_write_suspended/);
    x.store.setVerifiedHostContext(x.host);
    await assert.rejects(player(x,{identity:turn('t3')}),/timeline_write_suspended/);
    await x.store.confirmTimeline(x.timeline);
    await player(x,{identity:turn('t3')});
    assert.equal((await read(x)).length,2);
  }finally{await x.store.close();}
});
test('M2 NPC lines require source-matched *completed* native audio receipt',async t=>{
  const x=await setup(t);
  try{
    const i=turn('npc1'),text='Nathan actually said this.';
    const put=r=>x.recorder.recordNpcCompleted({characterId:x.a.characterId,identity:i,text,receipt:r});
    for(const bad of [
      {...receipt(i),type:'output_transcript'},
      {...receipt(i),reason:'interrupted'},
      {...receipt(i),playbackStarted:false},
      {...receipt(i),hadAudio:false},
      {...receipt(i),wasInterrupted:true},
      {...receipt(i),turnId:'wrong'},
      {...receipt(i),ok:false}
    ]) await assert.rejects(put(bad),/journal_unverified_playback/);
    assert.equal((await read(x)).length,0);
    const written=await put(receipt(i));
    assert.equal(written.inserted,true);
    assert.equal((await put(receipt(i))).inserted,false);
    const line=(await read(x))[0];
    assert.equal(line.content,text);
    assert.equal(line.source,'npc_generated');assert.equal(line.delivery,'completed');
    assert.match(line.deliveryReceiptId,/^[0-9a-f]{8}-/);
    assert.equal((await x.store.findExactQuote({characterId:x.a.characterId,timelineId:x.timeline,quote:text})).length,1);
  }finally{await x.store.close();}
});
test('M2 rejects nonexistent owners and lineage/source changes at the actual write queue',async t=>{
  const x=await setup(t);
  try{
    await assert.rejects(x.recorder.recordPlayerAccepted({characterId:randomUUID(),identity:turn(),
      source:'typed',text:'unpromoted'}),/journal_character_not_promoted/);
    await assert.rejects(player(x,{attribution:{hostRunId:randomUUID(),worldEpoch:1}}),
      /journal_source_epoch_mismatch/);
    const queued=player(x,{identity:turn('queued')});
    x.store.setVerifiedHostContext(null);
    await assert.rejects(queued,/timeline_write_suspended/);
    assert.equal((await read(x)).length,0);
    x.store.setVerifiedHostContext(native(x.host.hostRunId,2));
    await x.store.confirmTimeline(x.timeline);
    await player(x,{identity:turn('epoch2')});
    x.store.onBoundary({reason:'clock_regression'});
    await assert.rejects(player(x,{identity:turn('rewind')}),/timeline_write_suspended/);
    await x.store.confirmTimeline(x.timeline);
    await player(x,{identity:turn('new-lineage')});
    const other=await x.store.createTimeline({label:'Different save'});
    await x.store.confirmTimeline(other);
    assert.equal((await x.store.readDialogueLines({characterId:x.a.characterId,timelineId:other})).length,0);
  }finally{await x.store.close();}
});
test('M2 + M3 shared journal supports exact journalEvent contract and source-proof dedup',async t=>{
  const x=await setup(t);
  try{
    const evt={version:1,characterId:x.a.characterId,worldProfileId,timelineId:x.timeline,
      kind:'journal_event',recordId:randomUUID(),observationId:randomUUID(),revision:1,
      eventType:'gunshot',receivedAtUtc:'2026-10-11T17:00:00.000Z',sourceHash:sha('native gunshot'),
      ownerProof:{ownerAlias:x.a.promotion.ownerAlias,incarnationId:randomUUID(),
        encounterId:randomUUID(),hostRunId:x.host.hostRunId,worldEpoch:x.host.worldEpoch,
        observerCaptureRef:randomUUID()},receiptStatus:'witnessed',
      claims:[{kind:'gunshot',modality:'auditory',certainty:'direct',
        durableSubject:'unknown',sourceEvidenceId:randomUUID()}]};
    const one=await x.store.appendJournalEvent(evt);
    assert.equal(one.inserted,true);
    assert.equal((await x.store.appendJournalEvent({...evt,recordId:randomUUID()})).inserted,false);
    assert.equal((await x.store.readJournalEvents({characterId:x.a.characterId,timelineId:x.timeline})).length,1);
    assert.equal((await x.store.readJournalEvents({characterId:x.a.characterId,timelineId:x.timeline,eventType:'crash'})).length,0);
    await assert.rejects(x.store.appendJournalEvent({...evt,ownerProof:{...evt.ownerProof,ownerAlias:'wrong'},revision:2}),/journal_owner_proof_mismatch/);
    await assert.rejects(x.store.appendJournalEvent({...evt,revision:2,ownerProof:{...evt.ownerProof,worldEpoch:3}}),/journal_source_epoch_mismatch/);
    await assert.rejects(x.store.appendJournalEvent({...evt,eventType:'fake'}),/journal_replay_conflict/);
    const before=x.store.get(x.a.characterId);
    await x.store.edit(before.characterId,{name:'Nathan Changed'},before.revision);
    assert.equal((await x.store.readJournalEvents({characterId:x.a.characterId,timelineId:x.timeline})).length,1,
      'profile update must never cascade-delete journal evidence');
  }finally{await x.store.close();}
});
test('M2 retention keeps >200 ordinary turns; no 60-day cutoff; exact queries survive reopen',async t=>{
  const x=await setup(t);
  const old='A line from years ago: "the magic turbo chicken".';
  try{
    await player(x,{text:old,committedAtUtc:'2020-01-01T00:00:00.000Z'});
    for(let n=0;n<230;n++)await player(x,{identity:turn('bulk'+n),
      text:'Ordinary line '+n,committedAtUtc:new Date(Date.UTC(2026,9,11,0,0,n)).toISOString()});
    assert.equal((await read(x,{limit:1000})).length,231);
    assert.equal((await read(x,{limit:200})).length,200);
    assert.equal((await x.store.findExactQuote({characterId:x.a.characterId,timelineId:x.timeline,quote:old}))[0].content,old);
    await x.store.close();
    const reopened=createEssentialMemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
    await reopened.initialize();
    try{
      assert.equal((await reopened.readDialogueLines({characterId:x.a.characterId,timelineId:x.timeline,limit:1000})).length,231);
      assert.equal((await reopened.findExactQuote({characterId:x.a.characterId,timelineId:x.timeline,quote:old})).length,1);
    }finally{await reopened.close();}
  }finally{await x.store.close();}
});
test('M2 intact v2 P2 database is migrated additively, unknown versions refused',async t=>{
  const x=await setup(t);
  try{await x.store.close();
    let db=new DatabaseSync(x.filePath);
    db.exec('DROP TRIGGER dialogue_fts_insert; DROP TRIGGER dialogue_fts_delete; DROP TABLE dialogue_journal_fts; DROP TABLE dialogue_journal; DROP TABLE event_journal; PRAGMA user_version=2;');
    const snapshot=db.prepare('SELECT snapshot_json FROM p2_store').get().snapshot_json;
    db.close();
    const reopened=createEssentialMemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
    await reopened.initialize();await reopened.close();
    db=new DatabaseSync(x.filePath);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,JOURNAL_SCHEMA_VERSION);
    assert.equal(db.prepare('SELECT snapshot_json FROM p2_store').get().snapshot_json,snapshot);
    db.exec('PRAGMA user_version=88');db.close();
    const unsupported=createEssentialMemoryStorage({filePath:x.filePath,worldProfileId});
    await assert.rejects(unsupported.initialize(),/unsupported_sqlite_profile_schema/);
    await unsupported.close();
  }finally{await x.store.close();}
});
test('M2 explicit character removal deletes its dialogue in the same transaction',async t=>{
  const x=await setup(t);
  try{
    await player(x);
    assert.equal((await read(x)).length,1);
    await x.store.remove(x.a.characterId,x.a.characterId,x.a.revision);
    assert.equal((await read(x)).length,0);
    const db=new DatabaseSync(x.filePath);
    try{
      assert.equal(db.prepare('SELECT count(*) n FROM dialogue_journal').get().n,0);
      assert.equal(db.prepare('SELECT count(*) n FROM dialogue_journal_fts').get().n,0);
    }finally{db.close();}
  }finally{await x.store.close();}
});
test('M2 journal detects post-commit content tampering without leaking text in telemetry',async t=>{
  const x=await setup(t);
  try{
    await player(x);
    const db=new DatabaseSync(x.filePath);
    db.exec("UPDATE dialogue_journal SET content='tampered'");db.close();
    await assert.rejects(read(x),/journal_content_integrity_failed/);
  }finally{await x.store.close();}
});
