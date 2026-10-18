import {createM5SqliteServices} from '../src/memory/m5SqlitePrivacy.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {createM3WitnessRecorder} from '../src/memory/integrationPorts.mjs';
import {createM6SelectionCoordinator} from '../src/memory/m6Coordinator.mjs';
import {createM6P2ReplayAdapter} from '../src/memory/m6P2ReplayAdapter.mjs';
import {selectAutomaticMemories} from '../src/memory/selection.mjs';
import {makeQueueJob} from '../src/memory/queueContract.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

const id=()=>randomUUID();
const digest=s=>createHash('sha256').update(JSON.stringify(s)).digest('hex');
const future=()=>new Date(Date.now()+180000).toISOString();
async function create(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'w06-real-sqlite-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const filePath=path.join(root,'p2.sqlite');
  const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  const persons=[await store.create(profile()),await store.create(profile())];
  const timelineId=await store.createTimeline({label:'W06'});
  const host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
  store.setVerifiedHostContext(host);
  await store.confirmTimeline(timelineId,{confirmation:timelineId});
  const scopes=persons.map(p=>({characterId:p.characterId,worldProfileId,timelineId}));
  return {store,filePath,host,persons,scopes,timelineId};
}
const accepted=(store,scope,i,text='That was hilarious and embarrassing!')=>
  createConversationJournalRecorder(store).recordPlayerAccepted({
    characterId:scope.characterId,
    identity:{pedId:101,turnId:'w06-'+i,generationId:'gen-1',sessionNonce:'closure-t6'},
    text:text+' '+i,source:'typed',attribution:{protagonist:'franklin'}});
function observer(x,person,number){
  const adapterEpoch=id(),captureRef=id(),incarnationId=id(),encounterId=id();
  const ownerProof={ownerAlias:person.promotion.ownerAlias,incarnationId,
    encounterId,hostRunId:x.host.hostRunId,worldEpoch:x.host.worldEpoch,
    observerCaptureRef:captureRef};
  const identity={promoted:true,current:true,characterId:person.characterId,
    worldProfileId,timelineId:x.timelineId,adapterEpoch,ownerProof};
  const capture=createM3WitnessRecorder({store:x.store,authorize:()=>identity});
  return async i=>{
    const observation={version:1,observationId:id(),episodeId:id(),revision:1,
      observer:{captureRef,kind:'ped'},observedAt:{nativeRun:adapterEpoch,
      gameTick:100+i,receivedUtc:new Date().toISOString()},
      eventType:'firing_burst',claims:[{claimId:id(),kind:'firing',certainty:'supported',
        evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:100+i}}]};
    const receipt=await capture.capture({candidate:identity,observation});
    assert.ok(receipt.inserted,'source-qualified M3 SQLite event required');
    return receipt;
  };
}
async function reopen(x){
  await x.store.close();
  const store=createP2MemoryStorage({filePath:x.filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  store.setVerifiedHostContext({...x.host,hostRunId:id(),worldEpoch:x.host.worldEpoch+1});
  await store.confirmTimeline(x.timelineId,{confirmation:x.timelineId});
  x.store=store;
  return store;
}
test('W06 A06: 2501 committed sidecar events + 203 accepted Unicode lines, two characters, durable prefix and reopen',async t=>{
  const x=await create(t);
  try{
    const captures=x.persons.map((p,i)=>observer(x,p,i));
    for(let i=0;i<2501;i++)await captures[i%2](i);
    for(let i=0;i<203;i++)await accepted(x.store,x.scopes[i%2],i,'Hilarious 🚗 déjà vu!');
    const counts=[];
    for(const scope of x.scopes){
      const expectedEvents=scope.characterId===x.scopes[0].characterId?1251:1250;
      const expectedLines=scope.characterId===x.scopes[0].characterId?102:101;
      let after=null,seen=new Set(),events=0,lines=0,pages=0;
      do{
        const page=await x.store.readM6JournalPage({scope,afterCursor:after,limit:97});
        for(const entry of page.rows){
          assert.equal(entry.sourceHash,digest(entry.evidence));
          assert.ok(!seen.has(entry.cursor));seen.add(entry.cursor);
          if(entry.evidence.kind==='journal_event')events++;
          else if(entry.evidence.kind==='dialogue_line')lines++;
          else assert.fail('missing sidecar must not be declared a witnessed event');
          after=entry.cursor;
        }
        pages++;
        if(!page.hasMore)break;
      }while(pages<40);
      assert.ok(pages>12);
      assert.equal(events,expectedEvents);
      assert.equal(lines,expectedLines);
      counts.push({events,lines,pages});
      const m6=createM6SelectionCoordinator({store:createM6P2ReplayAdapter(x.store),
        quietMs:0,pageSize:137,maxRows:2000,maxPages:20});
      const done=await m6.onSceneClose({scope,atUtc:future()});
      assert.equal(done.readCount,events+lines);
      assert.equal(done.archiveComplete,true);
      assert.equal(done.acknowledged,true);
      assert.ok(done.saved.length>0);
    }
    await reopen(x);
    for(const scope of x.scopes){
      const cp=await x.store.readM6Checkpoint({scope});
      assert.ok(Number(cp.cursor)>0);
      assert.equal((await x.store.readM6JournalPage({scope,afterCursor:cp.cursor})).rows.length,0);
      const result=await createM6SelectionCoordinator({
        store:createM6P2ReplayAdapter(x.store),quietMs:0}).recover({scope,atUtc:future()});
      assert.equal(result.saved.length,0);
      assert.equal(result.acknowledged,false);
    }
    assert.deepEqual(counts.map(c=>c.events),[1251,1250]);
    assert.deepEqual(counts.map(c=>c.lines),[102,101]);
  }finally{await x.store.close();}
});
test('W06 A06: restart after deterministic save and after durable M7 queue but before CAS ack',async t=>{
  const x=await create(t);const [a,b]=x.scopes;
  try{
    await accepted(x.store,a,1);
    await accepted(x.store,b,2);
    for(const [scope,withQueue] of [[a,false],[b,true]]){
      const page=await x.store.readM6JournalPage({scope});
      assert.equal(page.rows.length,1);
      const [proposal]=selectAutomaticMemories(page.rows.map(row=>row.evidence));
      assert.ok(proposal);
      assert.equal((await x.store.saveDeterministicMemory(proposal)).inserted,true);
      if(withQueue)assert.equal((await x.store.enqueueCurationJob({job:makeQueueJob(proposal,future())})).inserted,true);
      assert.equal((await x.store.readM6Checkpoint({scope})).cursor,null);
    }
    await reopen(x);
    for(const [scope,queue] of [[a,false],[b,true]]){
      const result=await createM6SelectionCoordinator({store:createM6P2ReplayAdapter(x.store),
        quietMs:0,cloudQueueEnabled:queue}).recover({scope,atUtc:future()});
      assert.equal(result.saved.length,1);
      assert.equal(result.saved[0].inserted,false);
      assert.equal(result.acknowledged,true);
      const cp=await x.store.readM6Checkpoint({scope});
      assert.ok(cp.cursor);
      assert.equal(cp.activeHourCount,1);
      assert.equal((await x.store.readM6JournalPage({scope,afterCursor:cp.cursor})).rows.length,0);
    }
  }finally{await x.store.close();}
});
test('W06 A06: CAS fails on missing queue, source deletion, hash corruption and unsupported authority',async t=>{
  const x=await create(t),scope=x.scopes[0];
  try{
    const record=await accepted(x.store,scope,3);
    const page=await x.store.readM6JournalPage({scope});
    const [proposal]=selectAutomaticMemories(page.rows.map(r=>r.evidence));
    await x.store.saveDeterministicMemory(proposal);
    const row=page.rows[0];
    const ack={scope,expectedCursor:null,nextCursor:row.cursor,
      sourceHashes:[{cursor:row.cursor,sourceHash:row.sourceHash,recordId:record.recordId}],
      savedProposalIds:[proposal.proposalId],rejected:[],cutoffUtc:future(),
      hourBucket:future().slice(0,13),lastSourceUtc:new Date(
        Date.parse(row.evidence.committedAtUtc)).toISOString(),cloudQueueEnabled:true};
    await assert.rejects(x.store.ackM6Checkpoint(ack),/m6_p2_missing_durable_m7_job/);
    assert.equal((await x.store.readM6Checkpoint({scope})).cursor,null);
    await x.store.withTimelineSqliteWrite(scope,db=>
      db.prepare('DELETE FROM dialogue_journal WHERE record_id=?').run(record.recordId));
    await assert.rejects(x.store.ackM6Checkpoint({...ack,cloudQueueEnabled:false}),
      /m6_p2_ack_source_mutated/);
    assert.equal((await x.store.readM6Checkpoint({scope})).cursor,null);
    const abandoned=await x.store.readM6JournalPage({scope});
    assert.equal(abandoned.rows[0].evidence.kind,'replay_rejection');
    const scanHash=abandoned.rows[0].sourceHash;
    const receipt=await x.store.ackM6Checkpoint({...ack,cloudQueueEnabled:false,
      sourceHashes:[{...ack.sourceHashes[0],sourceHash:scanHash}],
      savedProposalIds:[],rejected:[{recordId:record.recordId,reason:'source_removed'}],
      lastSourceUtc:null});
    assert.equal(receipt.committed,true);
    const audit=await x.store.withP2SqliteRead(scope,db=>db.prepare(
      'SELECT count(*) AS n FROM m6_p2_rejections WHERE character_id=?').get(scope.characterId).n);
    assert.equal(audit,1);
    const diagnostic=await x.store.withP2SqliteRead(scope,db=>db.prepare(
      'SELECT reason FROM m6_p2_ack_diagnostics WHERE character_id=?').get(scope.characterId));
    assert.equal(diagnostic.reason,'source_removed');
    const later=await accepted(x.store,scope,4);
    await x.store.withTimelineSqliteWrite(scope,db=>
      db.prepare('UPDATE dialogue_journal SET content_sha256=? WHERE record_id=?')
        .run('0'.repeat(64),later.recordId));
    await assert.rejects(x.store.readM6JournalPage({scope,
      afterCursor:(await x.store.readM6Checkpoint({scope})).cursor}),/m6_p2_source_hash_corrupt/);
    x.store.onBoundary({reason:'clock_regression'});
    // A discontinuity revokes native source confirmation before the timeline
    // read is admitted. The earlier native-authority rejection is authoritative.
    await assert.rejects(x.store.readM6Checkpoint({scope}),/m6_native_authority_required/);
  }finally{await x.store.close();}
});

test('W06 A06: bounded read prefixes resume without losing an old backlog; tombstone changes veto stale ack',async t=>{
  const x=await create(t),scope=x.scopes[0];
  try{
    for(let i=0;i<51;i++)await accepted(x.store,scope,i,'Hilarious unexpected incident');
    const coordinator=createM6SelectionCoordinator({store:createM6P2ReplayAdapter(x.store),
      quietMs:0,pageSize:7,maxRows:14,maxPages:2});
    let seen=0,rounds=0,final;
    do{
      const result=rounds===0?await coordinator.onSceneClose({scope,atUtc:future()}):
        await coordinator.onIdle({scope,atUtc:future()});
      assert.ok(result.readCount>0&&result.readCount<=14);
      seen+=result.readCount;
      rounds++;final=result;
      assert.ok(rounds<10);
    }while(!final.archiveComplete);
    assert.equal(seen,51);
    assert.ok(rounds>=4);
    const cp=await x.store.readM6Checkpoint({scope});
    assert.equal((await x.store.readM6JournalPage({scope,afterCursor:cp.cursor})).rows.length,0);
    await assert.rejects(coordinator.recover({scope,atUtc:'2001-01-01T00:00:00.000Z'}),
      /m6_source_clock_regression/);
    const target=await accepted(x.store,scope,100,'That was hilarious and unforgettable');
    const stale=(await x.store.readM6JournalPage({scope,afterCursor:cp.cursor})).rows[0];
    const [proposal]=selectAutomaticMemories([stale.evidence]);
    await x.store.saveDeterministicMemory(proposal);
    // Use the production forgetting transaction, including its permanent
    // suppression receipt; an unbound tombstone is now an integrity failure.
    await createM5SqliteServices({store:x.store,filePath:x.store.filePath,authorize:()=>true})
      .trash({scope,targetId:target.recordId});
    await assert.rejects(x.store.ackM6Checkpoint({scope,expectedCursor:cp.cursor,nextCursor:stale.cursor,
      sourceHashes:[{cursor:stale.cursor,sourceHash:stale.sourceHash,recordId:target.recordId}],
      savedProposalIds:[proposal.proposalId],rejected:[],cutoffUtc:future(),
      hourBucket:future().slice(0,13),lastSourceUtc:new Date(
        Date.parse(stale.evidence.committedAtUtc)).toISOString(),cloudQueueEnabled:false}),
      /m6_p2_ack_source_mutated/);
    assert.equal((await x.store.readM6Checkpoint({scope})).cursor,cp.cursor);
  }finally{await x.store.close();}
});

test('W06 A06: persisted checkpoint and immutable SHA receipt corruption fail closed after commit',async t=>{
  const x=await create(t),scope=x.scopes[0];
  try{
    await accepted(x.store,scope,200,'That was hilarious!');
    const m6=createM6SelectionCoordinator({store:createM6P2ReplayAdapter(x.store),quietMs:0});
    const done=await m6.onSceneClose({scope,atUtc:future()});
    assert.equal(done.acknowledged,true);
    const checkpoint=await x.store.readM6Checkpoint({scope});
    assert.ok(checkpoint.cursor);
    await x.store.withTimelineSqliteWrite(scope,db=>
      db.prepare('UPDATE m6_p2_checkpoints SET after_sequence=? WHERE world_profile_id=? AND character_id=? AND timeline_id=?')
        .run(Number(checkpoint.cursor)+200,...[scope.worldProfileId,scope.characterId,scope.timelineId]));
    await assert.rejects(x.store.readM6Checkpoint({scope}),/m6_p2_corrupt_checkpoint_receipt/);
    await x.store.withTimelineSqliteWrite(scope,db=>
      db.prepare('UPDATE m6_p2_checkpoints SET after_sequence=? WHERE world_profile_id=? AND character_id=? AND timeline_id=?')
        .run(Number(checkpoint.cursor),...[scope.worldProfileId,scope.characterId,scope.timelineId]));
    await x.store.withTimelineSqliteWrite(scope,db=>
      db.prepare('UPDATE m6_p2_source_receipts SET source_hash=? WHERE sequence=?')
        .run('f'.repeat(64),Number(checkpoint.cursor)));
    await assert.rejects(x.store.readM6Checkpoint({scope}),/m6_p2_corrupt_checkpoint_source_hash/);
  }finally{await x.store.close();}
});
