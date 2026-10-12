// W09: integrated SOURCE SIMULATION, not a trusted native/GTA acceptance receipt.
// Exercises unmodified production SQLite/PS2 journal/recorder/replay modules.
// Fixture attestations are deliberately created here, never in production paths.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {normalizeWitnessedObservation, verifyM3DerivedEvent} from '../src/events/journalEventNormalizer.mjs';
import {createM5SqliteServices} from '../src/memory/m5SqlitePrivacy.mjs';
import {createM6SelectionCoordinator} from '../src/memory/m6Coordinator.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

const id=()=>randomUUID();
const sha=x=>createHash('sha256').update(x).digest('hex');
const host=()=>({hostContextVersion:1,hostRunId:id(),worldEpoch:1});
const turn=(n,pedId=101)=>({pedId,turnId:'w09-'+n,generationId:'g-'+n,sessionNonce:'w09-session'});
const PROTAGONISTS=['franklin','michael','trevor','unknown'];

async function setup(t,number=2){
  const dir=await mkdtemp(path.join(tmpdir(),'memory-w09-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,'p2.sqlite');
  const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  const characters=[];
  for(let i=0;i<number;i++)characters.push(await store.create(profile()));
  const timelineId=await store.createTimeline({label:'W09 isolated source simulation'});
  const currentHost=host();
  store.setVerifiedHostContext(currentHost);
  await store.confirmTimeline(timelineId);
  return {store,filePath,characters,timelineId,host:currentHost,
    recorder:createConversationJournalRecorder(store),
    scope(i=0,protagonistKey='unknown'){return {
      worldProfileId,characterId:characters[i].characterId,timelineId,protagonistKey
    };}};
}
async function player(x,n,character=0,protagonist='franklin',text='literal '+n){
  return x.recorder.recordPlayerAccepted({characterId:x.characters[character].characterId,
    identity:turn(n,101+character),text,source:'typed',
    attribution:{protagonist},committedAtUtc:'2026-10-11T22:00:00.000Z'});
}
// This fixture does not assert actual GTA eyewitness status. Native source proof
// must come from T2/K in production; the fixture is only a replay stress input.
function observation(x,n,character=0){
  const p=x.characters[character],adapterEpoch='b2bcfd60-904a-40a2-8a50-0c3ea397a43c';
  const captureRef=character===0?
    'e53d9726-4414-4d79-9c2e-9accb403ed5a':'922c267c-986e-4e93-a893-53c86f4fbeb5';
  const proof={ownerAlias:p.promotion.ownerAlias,incarnationId:character===0?
    '1ef93e38-bf43-4d2c-b9d3-a7f6a71a2e22':'883a2ba0-5e81-48ae-8114-0134c4dca0b4',
    encounterId:character===0?'e1fb4e2d-9823-4a7b-833e-366ec4fcf844':
      '490e25ce-2d91-4298-92e8-0bc74062068f',
    hostRunId:x.host.hostRunId,worldEpoch:x.host.worldEpoch,
    observerCaptureRef:captureRef};
  const identity={promoted:true,current:true,characterId:p.characterId,
    worldProfileId,timelineId:x.timelineId,adapterEpoch,ownerProof:proof};
  const observed={
    version:1,observationId:id(),episodeId:id(),revision:1,
    observer:{kind:'ped',captureRef},
    observedAt:{nativeRun:adapterEpoch,gameTick:n+1,
      receivedUtc:'2026-10-11T22:00:00.000Z'},
    eventType:'firing_burst',severity:'routine',recognizedCharacterIds:[],
    claims:[{claimId:id(),kind:'firing',certainty:'supported',
      evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:n+1},
      source:{kind:'player',captureRef:id()}}]
  };
  const normalized=normalizeWitnessedObservation({observation:observed,identity});
  assert.equal(normalized.accepted,true);
  assert.equal(verifyM3DerivedEvent(normalized.event,normalized.sourceEvidence).valid,true);
  return normalized;
}
async function appendFixtureEvent(x,n,character=0){
  const {event,sourceEvidence}=observation(x,n,character);
  const result=await x.store.withTimelineWrite(x.timelineId,foundation=>
    foundation.appendJournalEvent(event,{hostContext:x.store.verifiedHostContext,sourceEvidence}));
  assert.equal(result.inserted,true);
  return {event,sourceEvidence};
}
async function scan(x,scope,consumerId,limit=137){
  let cp=await x.store.readCommittedEvidenceCursor({scope,consumerId});
  const items=[],skipped=[],rejected=[];
  let pages=0;
  while(true){
    const pg=await x.store.readCommittedEvidencePage({scope,cursor:cp.cursor,limit});
    assert.ok(pg.scannedCount<=limit);
    items.push(...pg.items);
    skipped.push(...pg.skipped);
    rejected.push(...pg.rejected);
    const ack=await x.store.ackCommittedEvidenceCursor({
      scope,consumerId,cursor:pg.cursor,expectedCursor:cp.cursor});
    assert.equal(ack.committed,true);
    cp=await x.store.readCommittedEvidenceCursor({scope,consumerId});
    assert.equal(cp.cursor,pg.cursor);
    if(!pg.hasMore)break;
    assert.ok(++pages<100);
  }
  return {items,skipped,rejected,cursor:cp.cursor};
}

test('W09/S01 source simulation: exact Unicode/profanity, owner and protagonist fences, durable reconnect',async t=>{
  const x=await setup(t);
  const literal='  Fuck it — “déjà vu” 🦊 \u00e9 + 中文!\n  ';
  const input=await player(x,'source-one',0,'franklin',literal);
  assert.equal(input.inserted,true);
  assert.equal((await player(x,'source-one',0,'franklin',literal)).inserted,false);
  await assert.rejects(player(x,'source-one',0,'franklin',literal+'changed'),/journal_replay_conflict/);
  const before=await scan(x,x.scope(0,'franklin'),'s01-pre');
  assert.equal(before.items.length,1);
  assert.deepEqual(Buffer.from(before.items[0].envelope.content),Buffer.from(literal));
  assert.equal(before.items[0].envelope.attribution.protagonist,'franklin');
  await x.store.close();
  const reopened=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
  await reopened.initialize();
  try {
    assert.equal(reopened.timelineWritable,false);
    await assert.rejects(reopened.readCommittedEvidenceCursor({
      scope:x.scope(0,'franklin'),consumerId:'s01-pre'}),/timeline_write_suspended/);
    reopened.setVerifiedHostContext({...x.host,hostRunId:id(),worldEpoch:2});
    await reopened.confirmTimeline(x.timelineId);
    const again=await reopened.readCommittedEvidencePage({scope:x.scope(0,'franklin')});
    assert.equal(again.items.length,1);
    assert.deepEqual(Buffer.from(again.items[0].envelope.content),Buffer.from(literal));
    assert.equal((await reopened.readCommittedEvidenceCursor({
      scope:x.scope(0,'franklin'),consumerId:'s01-pre'})).cursor,before.cursor);
  } finally {await reopened.close();}
});

test('W09/S03 source simulation: two observers isolated, missing witness never becomes a shared memory',async t=>{
  const x=await setup(t);
  try{
    const first=await appendFixtureEvent(x,7,0);
    assert.equal((await x.store.readVerifiedEventEvidence({...x.scope(0),recordId:first.event.recordId})).event.recordId,first.event.recordId);
    const a=await scan(x,x.scope(0),'s03-A');
    const b=await scan(x,x.scope(1),'s03-B');
    assert.equal(a.items.length,1);
    assert.equal(a.items[0].kind,'event');
    assert.equal(b.items.length,0);
    const second=await appendFixtureEvent(x,8,1);
    assert.notEqual(first.event.ownerProof.observerCaptureRef,second.event.ownerProof.observerCaptureRef);
    const b2=await x.store.readCommittedEvidencePage({scope:x.scope(1)});
    assert.deepEqual(b2.items.map(r=>r.recordId),[second.event.recordId]);
    assert.equal((await x.store.readCommittedEvidencePage({scope:x.scope(0)})).items.length,1);
    await assert.rejects(x.store.appendJournalEvent({
      ...second.event,recordId:id(),ownerProof:{...second.event.ownerProof,ownerAlias:x.characters[0].promotion.ownerAlias}
    }),/journal_owner_proof_mismatch|journal_replay_conflict/);
  }finally{await x.store.close();}
});

test('W09/S07 source simulation: save rollback and host switch suspend actual P2 SQLite writes until confirmation',async t=>{
  const x=await setup(t);
  try{
    await player(x,'before',0,'michael');
    x.store.onBoundary({reason:'clock_regression'});
    await assert.rejects(player(x,'rollback',0,'michael'),/timeline_write_suspended/);
    assert.equal(x.store.timelineWritable,false);
    await x.store.confirmTimeline(x.timelineId);
    assert.equal((await player(x,'after-confirm',0,'michael')).inserted,true);
    x.store.setVerifiedHostContext({...x.host,hostRunId:id(),worldEpoch:2});
    await assert.rejects(player(x,'epoch-change',0,'michael'),/timeline_write_suspended/);
    await x.store.confirmTimeline(x.timelineId);
    assert.equal((await player(x,'new-host',0,'michael')).inserted,true);
    assert.equal((await x.store.readDialogueLines({
      characterId:x.characters[0].characterId,timelineId:x.timelineId,limit:100})).length,3);
  }finally{await x.store.close();}
});

test('W09/P2 stress: 201+ player lines, 2501+ verified PS2 source-sidecar events, all protagonists, 2 NPCs and crash cursor replay',async t=>{
  const x=await setup(t),N=2501,LINES=205,accepted=[];
  try {
    for(let n=0;n<LINES;n++){
      const key=PROTAGONISTS[n%4],which=n%2;
      accepted.push(await player(x,n,which,key,'line '+n+' — café 🐾; fuck yes'));
    }
    assert.equal(new Set(accepted.map(r=>r.recordId)).size,LINES);
    const events=[];
    for(let n=0;n<N;n++)events.push((await appendFixtureEvent(x,n,n%2)).event.recordId);
    assert.equal(new Set(events).size,N);
    let total=0;
    for(const which of [0,1]){
      const s=x.scope(which);
      const result=await scan(x,s,'w09-events-'+which,127);
      assert.equal(result.rejected.length,0);
      assert.equal(result.items.filter(i=>i.kind==='event').length,
        which===0?1251:1250);
      for(const item of result.items.filter(row=>row.kind==='event')){
        assert.equal(item.envelope.characterId,x.characters[which].characterId);
        assert.equal(item.sourceEvidence.ownerProof.ownerAlias,x.characters[which].promotion.ownerAlias);
      }
      assert.ok(result.items.every(row=>row.kind==='event'||row.kind==='dialogue'));
      total+=result.items.filter(row=>row.kind==='event').length;
    }
    assert.equal(total,N);
    const seen=[];
    for(let who=0;who<2;who++)for(const key of PROTAGONISTS){
      const s=x.scope(who,key),page=await x.store.readCommittedEvidencePage({scope:s,limit:300});
      assert.equal(page.rejected.length,0);
      seen.push(...page.items.filter(i=>i.kind==='dialogue'));
    }
    assert.equal(seen.length,LINES);
    assert.equal(new Set(seen.map(r=>r.recordId)).size,LINES);
    await x.store.close();
    const reopened=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
    await reopened.initialize();
    try{
      await assert.rejects(reopened.readCommittedEvidenceCursor({
        scope:x.scope(0),consumerId:'w09-events-0'}),/timeline_write_suspended/);
      reopened.setVerifiedHostContext({...x.host,hostRunId:id(),worldEpoch:2});
      await reopened.confirmTimeline(x.timelineId);
      for(let who=0;who<2;who++){
        const cp=await reopened.readCommittedEvidenceCursor({
          scope:x.scope(who),consumerId:'w09-events-'+who});
        const page=await reopened.readCommittedEvidencePage({
          scope:x.scope(who),cursor:cp.cursor});
        assert.equal(page.items.length,0);
      }
    }finally{await reopened.close();}
  }finally{await x.store.close();}
});

test('W09 privacy/crash source simulation: durable trash masks replay and cannot restore after seven-day purge',async t=>{
  const x=await setup(t);
  try{
    const line=await player(x,'private',0,'trevor','Never repeat this memory.');
    const s=x.scope(0,'trevor');
    let now=Date.parse('2026-10-12T00:00:00.000Z');
    const privacy=createM5SqliteServices({store:x.store,filePath:x.filePath,
      clock:()=>new Date(now).toISOString(),authorize:()=>true});
    try{
      await privacy.ready(s);
      const op=id();
      const one=await privacy.trash({scope:s,targetId:line.recordId,operationId:op});
      const two=await privacy.trash({scope:s,targetId:line.recordId,operationId:op});
      assert.equal(one.durableCommit,true);
      assert.deepEqual(one,two);
      const masked=await x.store.readCommittedEvidencePage({scope:s});
      assert.equal(masked.items.length,0);
      assert.ok(masked.skipped.some(row=>row.recordId===line.recordId));
      now+=8*86400000;
      const purged=await privacy.purgeExpired({scope:s});
      assert.ok(purged.purgedIds.includes(line.recordId));
      await assert.rejects(privacy.restore({scope:s,trashId:op,operationId:id()}),
        /m5_restore_unavailable/);
      assert.equal((await x.store.readCommittedEvidencePage({scope:s})).items.length,0);
    }finally{await privacy.close();}
  }finally{await x.store.close();}
});


test('W09 cursor crash windows: SQLite source commit without ack replays; acknowledged checkpoint survives process reopen',async t=>{
  const x=await setup(t);
  const s=x.scope(0,'franklin');
  const consumerId='w09-crash-boundary';
  try{
    const one=await player(x,'pre-ack-committed',0,'franklin','durable before cursor ack');
    const prior=await x.store.readCommittedEvidenceCursor({scope:s,consumerId});
    const page=await x.store.readCommittedEvidencePage({scope:s,cursor:prior.cursor});
    assert.deepEqual(page.items.map(i=>i.recordId),[one.recordId]);
    assert.equal(page.hasMore,false);
    // Simulated power failure boundary: close the writer with the source fully
    // committed but do NOT acknowledge the consumer cursor.
    await x.store.close();
    const second=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
    await second.initialize();
    try{
      second.setVerifiedHostContext({...x.host,hostRunId:id(),worldEpoch:2});
      await second.confirmTimeline(x.timelineId);
      const unchanged=await second.readCommittedEvidenceCursor({scope:s,consumerId});
      assert.equal(unchanged.cursor,prior.cursor);
      const replay=await second.readCommittedEvidencePage({scope:s,cursor:unchanged.cursor});
      assert.deepEqual(replay.items.map(i=>i.recordId),[one.recordId]);
      const committed=await second.ackCommittedEvidenceCursor({
        scope:s,consumerId,expectedCursor:unchanged.cursor,cursor:replay.cursor});
      assert.equal(committed.committed,true);
      // A duplicate receipt may not create an additional logical source row.
      const repeated=await second.ackCommittedEvidenceCursor({
        scope:s,consumerId,expectedCursor:replay.cursor,cursor:replay.cursor});
      assert.equal(repeated.idempotent,true);
    }finally{await second.close();}
    const third=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
    await third.initialize();
    try{
      third.setVerifiedHostContext({...x.host,hostRunId:id(),worldEpoch:3});
      await third.confirmTimeline(x.timelineId);
      const cp=await third.readCommittedEvidenceCursor({scope:s,consumerId});
      assert.equal(cp.cursor,page.cursor);
      assert.equal((await third.readCommittedEvidencePage({scope:s,cursor:cp.cursor})).items.length,0);
    }finally{await third.close();}
  }finally{await x.store.close();}
});

test('W09 M6 strict production cursor rejects current incompatible store; no legacy fallback in acceptance',async t=>{
  const x=await setup(t);
  try{
    assert.throws(()=>createM6SelectionCoordinator({store:x.store}),
      /m6_durable_cursor_required_readM6Checkpoint/);
  }finally{await x.store.close();}
});
