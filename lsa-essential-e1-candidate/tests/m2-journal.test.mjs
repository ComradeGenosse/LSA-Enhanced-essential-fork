import {createM2TurnCapture} from '../../lsa-shared-brain/src/memory/m2TurnCapture.mjs';
import {createM2EssentialCapture} from '../src/memory/m2EssentialCapture.mjs';
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

function bindM2(x,id,{protagonist='franklin',sessionId=null}={}) {
  const state={live:true,protagonist};
  const identity=turn(id);
  const nativeProof=()=>({current:state.live,nativeVerified:true,identity,
    characterId:x.a.characterId,ownerAlias:x.a.promotion.ownerAlias,
    hostRunId:x.store.verifiedHostContext?.hostRunId,
    worldEpoch:x.store.verifiedHostContext?.worldEpoch,
    protagonistKey:state.protagonist,incarnationId:'2ed7962c-a0cb-4b00-9e3b-291ab9bf8f82',
    encounterId:'ad15aa65-4357-457d-a2b6-6f9148d6c2fb',observerIndex:2});
  const raw=createM2TurnCapture({
    store:x.store,characterId:x.a.characterId,identity,protagonist,
    ownerAlias:x.a.promotion.ownerAlias,sessionId,
    isCurrent:()=>state.live,currentProtagonist:()=>state.protagonist,
    verifyNative:nativeProof,
    verifyAcceptedPlayer:({identity,source,text})=>({accepted:true,final:true,identity,source,text}),
    verifyCompletedPlayback:({identity,receipt})=>({identity,receipt,nativeVerified:true,
      historyAccepted:true,speechVerified:true}),
  });
  const capture={
    recordPlayerAccepted:args=>raw.recordPlayerAccepted(args),
    retire:()=>raw.retire(),
    recordNpcCompleted:args=>{
      const mode=args.mode??'buffered';
      const parts=mode==='early_streamed'?args.spokenSegments:[args.text];
      const speechProof={sealed:true,mode,identity,segments:(parts||[]).map((text,sequence)=>({
        sequence,text,providerCompleted:true,audioBytes:64,forwardedBytes:64
      }))};
      return raw.recordNpcCompleted({...args,speechProof});
    }
  };
  return {capture,state};
}

test('M2 completion binding records accepted literal typed and STT text, not interim text',async t=>{
  const x=await setup(t);
  try {
    const {capture}=bindM2(x,'accepted-typed');
    const literal='  "Exactly as typed"\nnot normalized 🚗  ';
    assert.deepEqual(await capture.recordPlayerAccepted({accepted:false,text:literal,source:'typed'}),
      {status:'not_stored',reason:'m2_player_not_accepted'});
    const a=await capture.recordPlayerAccepted({accepted:true,text:literal,source:'typed'});
    assert.equal(a.status,'stored');
    const again=await capture.recordPlayerAccepted({accepted:true,text:literal,source:'typed'});
    assert.equal(again.status,'duplicate');
    assert.equal(again.recordId,a.recordId);
    const b=bindM2(x,'accepted-stt').capture;
    const transcript=' STT said: "go left!"\n';
    assert.equal((await b.recordPlayerAccepted({accepted:true,text:transcript,source:'stt',
      transcription:{provider:'openai',model:'stt-live',confidence:null}})).status,'stored');
    const rows=await read(x);
    assert.equal(rows.length,2);
    assert.equal(rows[0].content,transcript);
    assert.equal(rows[1].content,literal);
    assert.equal(Buffer.compare(Buffer.from(rows[1].content),Buffer.from(literal)),0);
  }finally{await x.store.close();}
});
test('M2 completion binds buffered and early stream speech to completed native receipt plus RAM history admission',async t=>{
  const x=await setup(t);
  try {
    const one=bindM2(x,'buffered').capture;
    const text='The final buffered utterance.';
    assert.equal((await one.recordNpcCompleted({historyAccepted:false,text,receipt:receipt(turn('buffered'))})).status,'not_stored');
    assert.equal((await one.recordNpcCompleted({historyAccepted:true,text,receipt:{...receipt(turn('buffered')),reason:'interrupted'}})).status,'not_stored');
    assert.equal((await one.recordNpcCompleted({historyAccepted:true,text,receipt:receipt(turn('wrong'))})).status,'not_stored');
    assert.equal((await one.recordNpcCompleted({historyAccepted:true,text,receipt:receipt(turn('buffered'))})).status,'stored');
    assert.equal((await one.recordNpcCompleted({historyAccepted:true,text,receipt:receipt(turn('buffered'))})).status,'duplicate');
    const streamed=bindM2(x,'streamed').capture;
    const parts=['No, ', 'wait!',' 🚗'];
    assert.deepEqual(await streamed.recordNpcCompleted({historyAccepted:true,
      mode:'early_streamed',spokenSegments:parts,text:'No, wait!',
      receipt:receipt(turn('streamed'))}),{status:'not_stored',reason:'m2_stream_text_mismatch'});
    assert.equal((await streamed.recordNpcCompleted({historyAccepted:true,
      mode:'early_streamed',spokenSegments:parts,text:parts.join(''),
      receipt:receipt(turn('streamed'))})).status,'stored');
    const rows=await read(x);
    assert.equal(rows.length,2);
    assert.equal(rows[0].content,parts.join(''));
    assert.equal(rows[1].content,text);
  }finally{await x.store.close();}
});
test('M2 completion refuses late native receipt after supersession or owner retirement',async t=>{
  const x=await setup(t);
  try {
    const retired=bindM2(x,'retired');
    retired.capture.retire();
    assert.deepEqual(await retired.capture.recordNpcCompleted({
      historyAccepted:true,text:'late playback',receipt:receipt(turn('retired')),
    }),{status:'not_stored',reason:'m2_turn_retired'});
    const superseded=bindM2(x,'superseded');
    superseded.state.live=false;
    assert.equal((await superseded.capture.recordPlayerAccepted({
      accepted:true,text:'unbound late player',source:'typed'
    })).reason,'m2_turn_retired');
    const changed=bindM2(x,'protagonist');
    changed.state.protagonist='michael';
    assert.equal((await changed.capture.recordPlayerAccepted({
      accepted:true,text:'wrong character player',source:'typed'
    })).reason,'m2_protagonist_changed');
    assert.equal((await read(x)).length,0);
  }finally{await x.store.close();}
});
test('M2 completion never silently rebinds old turns across disconnected host, reauthorization, epoch, or save lineage',async t=>{
  const x=await setup(t);
  try {
    const old=bindM2(x,'old-host').capture;
    x.store.setVerifiedHostContext(null);
    assert.equal((await old.recordPlayerAccepted({accepted:true,source:'typed',text:'offline'})).status,'not_stored');
    x.store.setVerifiedHostContext(x.host);
    await x.store.confirmTimeline(x.timeline);
    assert.equal((await old.recordPlayerAccepted({accepted:true,source:'typed',text:'reconnected'})).status,'not_stored',
      'once a suspended host was observed an old capture cannot resurrect');
    x.store.setVerifiedHostContext(native(x.host.hostRunId,2));
    await x.store.confirmTimeline(x.timeline);
    assert.equal((await old.recordPlayerAccepted({accepted:true,source:'typed',text:'new epoch same turn'})).reason,'m2_turn_retired',
      'retirement on disconnect is sticky even after host epoch changes');
    const fresh=bindM2(x,'fresh-host').capture;
    assert.equal((await fresh.recordPlayerAccepted({accepted:true,source:'typed',text:'new epoch new turn'})).status,'stored');
    const other=await x.store.createTimeline({label:'Another save'});
    await x.store.confirmTimeline(other);
    assert.equal((await fresh.recordNpcCompleted({historyAccepted:true,
      text:'delayed from other timeline',receipt:receipt(turn('fresh-host'))})).reason,
      'timeline_write_suspended');
    assert.equal((await read(x)).length,1);
  }finally{await x.store.close();}
});
test('M2 completion catches queued retirement at SQLite commit boundary, not only hook time',async t=>{
  const x=await setup(t);
  try {
    const bound=bindM2(x,'queued-retire');
    const original=x.store.withTimelineWrite.bind(x.store);
    let release;
    x.store.withTimelineWrite=(timelineId,commit)=>new Promise((resolve,reject)=>{
      release=()=>original(timelineId,commit).then(resolve,reject);
    });
    const pending=bound.capture.recordPlayerAccepted({accepted:true,
      text:'Never commit after host owner retirement',source:'typed'});
    assert.equal(typeof release,'function');
    bound.state.live=false;
    release();
    assert.deepEqual(await pending,{status:'not_stored',reason:'m2_turn_retired'});
    assert.equal((await read(x)).length,0);
  }finally{await x.store.close();}
});
test('M2 completion storage exception is not a success receipt and cannot disrupt normal turn history',async t=>{
  const x=await setup(t);
  try {
    const cap=bindM2(x,'write-error').capture;
    x.store.withTimelineWrite=()=>Promise.reject(new Error('SQLITE_ERROR private utterance'));
    const result=await cap.recordPlayerAccepted({accepted:true,
      text:'Private utterance should not be echoed in error telemetry',source:'typed'});
    assert.deepEqual(result,{status:'not_stored',reason:'m2_storage_failed'});
    assert.equal((await read(x)).length,0);
  }finally{await x.store.close();}
});
test('M2 completion retains 205 bound accepted turns for restart and byte-exact archive retrieval',async t=>{
  const x=await setup(t);
  const first='  years-old line\n\"turbo chicken\" 🚙  ';
  try {
    for(let n=0;n<205;n++){
      const cap=bindM2(x,'bound-'+n).capture;
      const result=await cap.recordPlayerAccepted({accepted:true,
        text:n===0?first:'literal number '+n,source:'typed',
        committedAtUtc:n===0?'2020-01-01T00:00:00.000Z':
          new Date(Date.UTC(2026,9,11,0,0,n)).toISOString()});
      assert.equal(result.status,'stored');
    }
    await x.store.close();
    const reopened=createEssentialMemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
    await reopened.initialize();
    try {
      assert.equal((await reopened.readDialogueLines({characterId:x.a.characterId,timelineId:x.timeline,limit:1000})).length,205);
      assert.equal((await reopened.findExactQuote({characterId:x.a.characterId,
        timelineId:x.timeline,quote:first}))[0].content,first);
    }finally{await reopened.close();}
  }finally{await x.store.close();}
});

function essentialM2(x,id='essential',{characterId=x.a.characterId}={}){
  const identity=turn(id);
  const state={live:true,protagonist:'unknown',generation:identity.generationId,
    epoch:x.host.worldEpoch,incarnationId:randomUUID(),encounterId:randomUUID(),
    alias:x.a.promotion.ownerAlias,observerIndex:3,acceptedInput:null,
    historyReceipt:null,speechSegments:new Map(),audioFinalized:false};
  const cloneIdentity=()=>({...identity});
  const verifySource=(a,b)=>a?.pedId===b?.pedId&&a?.turnId===b?.turnId&&
    a?.generationId===b?.generationId&&a?.sessionNonce===b?.sessionNonce;
  const nativeAuthority={verifyCurrentTurn:({identity:requested,characterId:cid,ownerAlias,hostRunId,worldEpoch})=>{
    if(!state.live||!verifySource(requested,identity)||cid!==characterId||
       ownerAlias!==state.alias||worldEpoch!==state.epoch||
       hostRunId!==x.host.hostRunId)return null;
    return {nativeVerified:true,current:true,identity:cloneIdentity(),
      characterId,ownerAlias:state.alias,hostRunId,worldEpoch,
      protagonistKey:state.protagonist,incarnationId:state.incarnationId,
      encounterId:state.encounterId,observerIndex:state.observerIndex};
  }};
  const acceptedInput={verifyAccepted:({identity:given,source,text})=>
    verifySource(given,identity)&&state.acceptedInput?.source===source&&
    state.acceptedInput.text===text ? {...state.acceptedInput,identity:cloneIdentity()}:null};
  const playbackHistory={verifyCompleted:({identity:given,receipt:got})=>
    verifySource(given,identity)&&state.historyReceipt===got ?
      {nativeVerified:true,historyAccepted:true,identity:cloneIdentity(),receipt:got}:null};
  const speechTransport={verifyFinalizedAudio:({identity:given,mode,segments,receipt:got})=>
    state.audioFinalized&&got===state.historyReceipt&&verifySource(given,identity)&&
    Array.isArray(segments)&&segments.length===state.speechSegments.size ?
      {complete:true,identity:cloneIdentity(),mode,segmentCount:segments.length,receipt:got}:null,
    verifyForwardedSegment:({identity:given,segment})=>{
    const real=state.speechSegments.get(segment?.sequence);
    return verifySource(given,identity)&&real&&
      real.text===segment.text&&real.audioBytes===segment.audioBytes&&
      real.forwardedBytes===segment.forwardedBytes ?
      {accepted:true,identity:cloneIdentity(),...real}:null;
  }};
  const args={store:x.store,characterId,ownerAlias:state.alias,identity,
    isCurrent:()=>state.live&&state.generation===identity.generationId,
    nativeAuthority,acceptedInput,playbackHistory,speechTransport};
  return {args,state,identity,
    make:()=>createM2EssentialCapture(args),
    commitInput:({source='typed',text,final=true}={})=>{
      state.acceptedInput={accepted:true,final,source,text};},
    stageSpeech:(sequence,text,{audioBytes=64,forwardedBytes=64}={})=>{
      const a={sequence,text,audioBytes,forwardedBytes};
      state.speechSegments.set(sequence,a);return a;},
    admitPlayback:(nativeReceipt,{audioFinalized=true}={})=>{
      state.historyReceipt=nativeReceipt;state.audioFinalized=audioFinalized;},
  };
}

test('M2 closure cannot be authorized by caller current callback without A native and host ledgers',async t=>{
  const x=await setup(t);
  try {
    const e=essentialM2(x,'no-proof');
    e.commitInput({text:'  unverified claim  '});
    e.state.live=false;
    assert.throws(()=>e.make(),/m2_native_owner_unverified/);
    e.state.live=true;
    assert.throws(()=>createM2EssentialCapture({...e.args,nativeAuthority:null}),
      /m2_trusted_ports_required/);
    assert.throws(()=>createM2EssentialCapture({...e.args,acceptedInput:null}),
      /m2_trusted_ports_required/);
    assert.throws(()=>createM2EssentialCapture({...e.args,playbackHistory:null}),
      /m2_trusted_ports_required/);
    assert.throws(()=>createM2EssentialCapture({...e.args,speechTransport:null}),
      /m2_trusted_ports_required/);
    assert.throws(()=>createM2EssentialCapture({...e.args,speechTransport:{
      verifyForwardedSegment:e.args.speechTransport.verifyForwardedSegment
    }}),/m2_trusted_ports_required/);
    const cap=e.make();
    assert.equal((await cap.acceptPlayer({source:'typed',text:'  unverified  '})).status,'not_stored');
    assert.equal((await read(x)).length,0);
  }finally{await x.store.close();}
});
test('M2 closure stores literal FINAL STT bytes only after source ledger admission and rejects changed input',async t=>{
  const x=await setup(t);
  try{
    const e=essentialM2(x,'unicode-stt');
    const cap=e.make();
    const raw='  Fuck, "déjà vu" 🛻\n中文\tend  ';
    e.commitInput({source:'stt',text:raw,final:false});
    const args={source:'stt',text:raw,transcription:{provider:'openai',
      model:'gpt-transcribe',confidence:null}};
    assert.equal((await cap.acceptPlayer(args)).reason,'m2_player_source_unverified');
    e.commitInput({source:'stt',text:raw,final:true});
    assert.equal((await cap.acceptPlayer({...args,text:raw.trim()})).reason,'m2_player_source_unverified');
    assert.equal((await cap.acceptPlayer(args)).status,'stored');
    assert.equal((await cap.acceptPlayer(args)).status,'duplicate');
    const actual=await read(x);
    assert.equal(actual.length,1);
    assert.equal(actual[0].source,'stt');
    assert.equal(Buffer.compare(Buffer.from(actual[0].content),Buffer.from(raw)),0);
    assert.equal(actual[0].transcription.confidence,null);
    e.commitInput({source:'stt',text:'STT changed',final:true});
    assert.equal((await cap.acceptPlayer({...args,text:'STT changed'})).reason,'journal_replay_conflict');
    assert.equal((await read(x)).length,1);
  }finally{await x.store.close();}
});
test('M2 closure records only full buffered PCM-backed speech with completed native receipt and accepted history',async t=>{
  const x=await setup(t);
  try{
    const e=essentialM2(x,'buffered-m2'),cap=e.make(),raw='  NPC actually said: "Nice!" 🚘 ';
    const segment=e.stageSpeech(0,raw);
    assert.equal(cap.admitSpeechSegment({mode:'buffered',...segment}).status,'admitted');
    const r=receipt(e.identity);
    assert.equal((await cap.completeNpc({receipt:r})).reason,'m2_playback_source_unverified');
    assert.equal((await read(x)).length,0);
    const newE=essentialM2(x,'buffered-okay'),next=newE.make();
    const original='NPC final TTS line, not edited decision dialogue.';
    assert.equal(next.admitSpeechSegment({mode:'buffered',...newE.stageSpeech(0,original)}).status,'admitted');
    const correct=receipt(newE.identity);newE.admitPlayback(correct);
    assert.equal((await next.completeNpc({receipt:correct})).status,'stored');
    assert.equal((await read(x))[0].content,original);
  }finally{await x.store.close();}
});
test('M2 closure preserves only actual early-segment streamed TTS text, never an unsaid final Luna draft',async t=>{
  const x=await setup(t);
  try{
    const e=essentialM2(x,'early-m2'),cap=e.make();
    const parts=['Whoa—','don\'t ', 'fucking move! 🛞'];
    for(let i=0;i<parts.length;i++)
      assert.equal(cap.admitSpeechSegment({mode:'early_streamed',
        ...e.stageSpeech(i,parts[i])}).status,'admitted');
    const r=receipt(e.identity);e.admitPlayback(r);
    assert.equal((await cap.completeNpc({receipt:r})).status,'stored');
    const row=(await read(x))[0];
    assert.equal(row.content,parts.join(''));
    assert.notEqual(row.content,'Whoa, I did not say any of that.');
    assert.equal(row.delivery,'completed');
    assert.equal(row.deliveryReceiptId!==null,true);
  }finally{await x.store.close();}
});
test('M2 closure denies unforwarded audio, unfinished segments and forged late/interrupted playback',async t=>{
  const x=await setup(t);
  try{
    const dropped=essentialM2(x,'dropped'),a=dropped.make();
    const bad=dropped.stageSpeech(0,'partly played',{audioBytes:64,forwardedBytes:4});
    assert.equal(a.admitSpeechSegment({mode:'buffered',...bad}).reason,'m2_speech_proof_incomplete');
    assert.equal((await a.completeNpc({receipt:receipt(dropped.identity)})).status,'not_stored');
    const stale=essentialM2(x,'stale-play'),b=stale.make();
    b.admitSpeechSegment({mode:'buffered',...stale.stageSpeech(0,'Never persist')});
    const interrupted={...receipt(stale.identity),wasInterrupted:true,reason:'interrupted'};
    stale.admitPlayback(interrupted);
    assert.equal((await b.completeNpc({receipt:interrupted})).status,'not_stored');
    const mismatched=essentialM2(x,'bad-receipt'),c=mismatched.make();
    c.admitSpeechSegment({mode:'buffered',...mismatched.stageSpeech(0,'Never persist either')});
    const forged=receipt(turn('other-generation'));mismatched.admitPlayback(forged);
    assert.equal((await c.completeNpc({receipt:forged})).status,'not_stored');
    assert.equal((await read(x)).length,0);
  }finally{await x.store.close();}
});
test('M2 closure never resurrects a host, ped incarnation, protagonist, or timeline after source loss',async t=>{
  const x=await setup(t);
  try{
    const e=essentialM2(x,'life'),cap=e.make();
    e.commitInput({text:'Before retirement'});
    assert.equal((await cap.acceptPlayer({source:'typed',text:'Before retirement'})).status,'stored');
    e.state.incarnationId=randomUUID();
    assert.equal((await cap.acceptPlayer({source:'typed',text:'Before retirement'})).reason,
      'm2_native_lifetime_changed');
    const second=essentialM2(x,'change-protagonist'),b=second.make();
    second.commitInput({text:'Wrong protagonist'});
    second.state.protagonist='trevor';
    assert.equal((await b.acceptPlayer({source:'typed',text:'Wrong protagonist'})).reason,
      'm2_protagonist_changed');
    const third=essentialM2(x,'rollback'),c=third.make();
    third.commitInput({text:'Suspended save'});
    x.store.setVerifiedHostContext(null);
    assert.equal((await c.acceptPlayer({source:'typed',text:'Suspended save'})).status,'not_stored');
    x.store.setVerifiedHostContext(x.host);await x.store.confirmTimeline(x.timeline);
    assert.equal((await c.acceptPlayer({source:'typed',text:'Suspended save'})).status,'not_stored');
    assert.equal((await read(x)).length,1);
  }finally{await x.store.close();}
});
test('M2 closure rechecks actual source and memory-owner status after delayed SQLite writer slot',async t=>{
  const x=await setup(t);
  try{
    const e=essentialM2(x,'queued-source'),cap=e.make();
    e.commitInput({text:'Queued, but source revoked'});
    const original=x.store.withTimelineWrite.bind(x.store);let go;
    x.store.withTimelineWrite=(timeline,commit)=>new Promise((resolve,reject)=>{
      go=()=>original(timeline,commit).then(resolve,reject);
    });
    const promise=cap.acceptPlayer({source:'typed',text:'Queued, but source revoked'});
    assert.equal(typeof go,'function');
    e.state.acceptedInput=null;
    go();
    assert.equal((await promise).reason,'m2_player_source_unverified');
    assert.equal((await read(x)).length,0);
  }finally{await x.store.close();}
});
test('M2 closure rejects non-roundtrippable UTF-16 rather than silently replacing UTF-8 bytes',async t=>{
  const x=await setup(t);
  try{
    const e=essentialM2(x,'bad-utf8'),cap=e.make(),invalid='hi\ud800 there';
    e.commitInput({text:invalid});
    assert.equal((await cap.acceptPlayer({source:'typed',text:invalid})).reason,'journal_invalid_utf8');
    assert.equal((await read(x)).length,0);
  }finally{await x.store.close();}
});

test('M2 closure refuses even native playback_ended(completed) when early TTS has not finalized',async t=>{
  const x=await setup(t);
  try{
    const e=essentialM2(x,'early-partial'),cap=e.make();
    const part=e.stageSpeech(0,'This first segment is NOT a final accepted turn.');
    assert.equal(cap.admitSpeechSegment({mode:'early_streamed',...part}).status,'admitted');
    const r=receipt(e.identity);e.admitPlayback(r,{audioFinalized:false});
    assert.equal((await cap.completeNpc({receipt:r})).reason,'m2_playback_source_unverified');
    assert.equal((await read(x)).length,0);
  }finally{await x.store.close();}
});

test('M2 closure source loss from a native-verifier null or superseded currentness is permanently sticky',async t=>{
  const x=await setup(t);
  try{
    const e=essentialM2(x,'drop-native'),cap=e.make();
    e.commitInput({text:'No replay after native owner loss'});
    e.state.live=false;
    assert.equal((await cap.acceptPlayer({source:'typed',text:'No replay after native owner loss'})).status,'not_stored');
    e.state.live=true;
    assert.equal((await cap.acceptPlayer({source:'typed',text:'No replay after native owner loss'})).reason,'m2_turn_retired');
    const other=essentialM2(x,'superposed'),b=other.make();
    other.state.live=false;
    assert.equal(b.admitSpeechSegment({mode:'buffered',sequence:0,text:'x',
      audioBytes:50,forwardedBytes:50}).reason,'m2_turn_retired');
    other.state.live=true;
    other.commitInput({text:'should not survive'});
    assert.equal((await b.acceptPlayer({source:'typed',text:'should not survive'})).reason,'m2_turn_retired');
    assert.equal((await read(x)).length,0);
  }finally{await x.store.close();}
});
