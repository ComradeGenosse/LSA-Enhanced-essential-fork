// Memory K J-A: M6 deterministic retention proven WITHOUT M7 cloud curation.
// Real P2 SQLite + the production M6 replay adapter/cursor. Fully offline:
// no provider, Luna, curation queue, GTA or native runtime is involved. The
// recorded conversations are source-simulation fixtures, not GTA receipts.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';
import {createConversationJournalRecorder} from '../src/memory/conversationRecorder.mjs';
import {createM5SqliteServices} from '../src/memory/m5SqlitePrivacy.mjs';
import {createM6SelectionCoordinator} from '../src/memory/m6Coordinator.mjs';
import {createM6P2ReplayAdapter} from '../src/memory/m6P2ReplayAdapter.mjs';
import {profile} from '../../lsa-essential-e1-candidate/tests/p2-fixtures.mjs';
import {worldProfileId} from '../../lsa-essential-e1-candidate/tests/identity-fixtures.mjs';

const id=()=>randomUUID();
const BASE=Date.parse('2026-10-14T20:00:00.000Z');
const at=seconds=>new Date(BASE+seconds*1000).toISOString();
const LATER=new Date(BASE+6*3600*1000).toISOString();
const FUNNY='That was hilarious! The car completely flipped over the fence.';
const NPC_FUNNY='Ha, that was the funniest crash I have ever seen, I will never forget it!';
const MUNDANE_PLAYER='What time is it right now?';
const MUNDANE_NPC='It is around noon, I think.';
const turn=(label,pedId=101)=>({pedId,turnId:label,generationId:'gen-'+label,sessionNonce:'ja-session'});
const completed=i=>({...i,type:'playback_ended',reason:'completed',ok:true,
  wasInterrupted:false,hadAudio:true,playbackStarted:true});

async function open(filePath,host,timelineId){
  const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  store.setVerifiedHostContext(host);
  await store.confirmTimeline(timelineId);
  return store;
}
async function setup(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'memory-ja-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,'p2.sqlite');
  const store=createP2MemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await store.initialize();
  const npcs=[await store.create(profile()),await store.create(profile())];
  const timelineId=await store.createTimeline({label:'J-A retention'});
  const host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
  store.setVerifiedHostContext(host);
  await store.confirmTimeline(timelineId);
  const x={dir,filePath,store,npcs,timelineId,host,
    scopes:npcs.map(p=>({characterId:p.characterId,worldProfileId,timelineId}))};
  return x;
}
// One recorded exchange: accepted player line followed by a playback-completed NPC line.
async function exchange(x,npcIndex,label,seconds,playerText,npcText){
  const journal=createConversationJournalRecorder(x.store);
  const characterId=x.npcs[npcIndex].characterId;
  const pid=turn(label+'-p',101+npcIndex),nid=turn(label+'-n',101+npcIndex);
  const player=await journal.recordPlayerAccepted({characterId,identity:pid,text:playerText,
    source:'typed',attribution:{protagonist:'franklin'},committedAtUtc:at(seconds)});
  const npc=await journal.recordNpcCompleted({characterId,identity:nid,text:npcText,
    receipt:completed(nid),attribution:{protagonist:'franklin'},committedAtUtc:at(seconds+5)});
  assert.equal(player.inserted,true);
  assert.equal(npc.inserted,true);
  return {playerId:player.recordId,npcId:npc.recordId};
}
// Cloud curation stays disabled: M7 enqueue must never be reached through the coordinator.
function m6For(store,overrides={}){
  const adapter=createM6P2ReplayAdapter(store);
  const guarded={...adapter,
    get worldProfileId(){return store.worldProfileId;},
    get activeTimelineId(){return store.activeTimelineId;},
    get timelineWritable(){return store.timelineWritable;},
    ...overrides,
    enqueueCurationJob:()=>{throw new Error('m7_enqueue_forbidden');}};
  return createM6SelectionCoordinator({store:guarded,cloudQueueEnabled:false,quietMs:0});
}
const permanent=(store,scope)=>store.readPermanentMemoryRows({...scope,protagonistKey:'franklin'});
const sources=rows=>rows.flatMap(r=>r.envelope.sourceEvidenceIds).sort();

test('J-A: recorded NPC conversations become durable memories with M7 disabled, mundane chat does not',async t=>{
  const x=await setup(t);
  try{
    const funny=await exchange(x,0,'funny',0,FUNNY,NPC_FUNNY);
    const mundane=await exchange(x,0,'mundane',1200,MUNDANE_PLAYER,MUNDANE_NPC);
    const result=await m6For(x.store).onSceneClose({scope:x.scopes[0],atUtc:LATER});
    assert.equal(result.archiveComplete,true);
    assert.equal(result.acknowledged,true);
    assert.equal(result.queued?.length??0,0,'no curation job without cloud opt-in');
    const rows=await permanent(x.store,x.scopes[0]);
    const retained=new Set(sources(rows));
    assert.ok(retained.has(funny.playerId)||retained.has(funny.npcId),'funny exchange retained');
    assert.ok(!retained.has(mundane.playerId)&&!retained.has(mundane.npcId),
      'mundane exchange stays in the M2 archive only');
    assert.equal(rows.length,1);
    assert.deepEqual(rows[0].envelope.sourceEvidenceIds.slice().sort(),
      [funny.playerId,funny.npcId].sort());
    assert.ok(rows[0].envelope.content.includes(FUNNY),'player quote is verbatim journal evidence');
    assert.ok(rows[0].envelope.content.includes(NPC_FUNNY),'NPC quote is verbatim journal evidence');
    assert.ok(!rows[0].envelope.content.includes(MUNDANE_PLAYER));
    const other=await permanent(x.store,x.scopes[1]);
    assert.equal(other.length,0,'a different promoted NPC receives nothing');
  }finally{await x.store.close();}
});

async function reopen(x){
  await x.store.close();
  x.host={...x.host,hostRunId:id(),worldEpoch:x.host.worldEpoch+1};
  x.store=await open(x.filePath,x.host,x.timelineId);
  return x.store;
}
async function privacy(x){
  const service=createM5SqliteServices({store:x.store,filePath:x.filePath,authorize:()=>true});
  await service.ready({...x.scopes[0],protagonistKey:'franklin'});
  return service;
}
const forget=(service,x,targetId)=>service.trash({
  scope:{...x.scopes[0],protagonistKey:'franklin'},targetId,operationId:id()});
const snapshot=rows=>rows.map(r=>[r.recordId??r.envelope.recordId,r.envelope.content,
  r.envelope.sourceEvidenceIds.slice().sort()]).sort();

test('J-A: restart and replay keep exactly the same memories, including a crash between save and cursor ack',async t=>{
  const x=await setup(t);
  try{
    await exchange(x,0,'one',0,FUNNY,NPC_FUNNY);
    await m6For(x.store).onSceneClose({scope:x.scopes[0],atUtc:LATER});
    const before=snapshot(await permanent(x.store,x.scopes[0]));
    assert.equal(before.length,1);
    const checkpoint=await x.store.readM6Checkpoint({scope:x.scopes[0]});
    assert.ok(Number(checkpoint.cursor)>0);

    // Re-recording the same accepted turn and completed playback is idempotent.
    const journal=createConversationJournalRecorder(x.store);
    const replayed=await journal.recordPlayerAccepted({characterId:x.npcs[0].characterId,
      identity:turn('one-p',101),text:FUNNY,source:'typed',attribution:{protagonist:'franklin'},
      committedAtUtc:at(0)});
    assert.equal(replayed.inserted,false);

    await reopen(x);
    // Source-required timelines stay suspended until explicitly confirmed (done by reopen()).
    const recovered=await m6For(x.store).recover({scope:x.scopes[0],atUtc:LATER});
    assert.equal(recovered.saved.length,0);
    assert.deepEqual(snapshot(await permanent(x.store,x.scopes[0])),before);
    assert.equal((await x.store.readM6Checkpoint({scope:x.scopes[0]})).cursor,checkpoint.cursor);

    // Crash window: the deterministic save commits, the cursor ack does not.
    const second=await exchange(x,0,'two',2400,'Hilarious prank on that cop, I will never forget it!',
      'Ha, best prank ever, remember when we laughed!');
    const crashing=m6For(x.store,{ackM6Checkpoint:()=>{throw new Error('injected_crash_before_ack');}});
    await assert.rejects(crashing.onSceneClose({scope:x.scopes[0],atUtc:LATER}),/injected_crash_before_ack/);
    assert.equal((await x.store.readM6Checkpoint({scope:x.scopes[0]})).cursor,checkpoint.cursor,
      'cursor must not advance without a committed ack');
    const afterCrash=await permanent(x.store,x.scopes[0]);
    assert.equal(afterCrash.length,2,'deterministic memory was already durable');

    await reopen(x);
    const retry=await m6For(x.store).recover({scope:x.scopes[0],atUtc:LATER});
    assert.equal(retry.acknowledged,true);
    assert.ok(retry.saved.every(r=>r.inserted===false),'replay re-presents the identical proposal');
    const final=await permanent(x.store,x.scopes[0]);
    assert.equal(final.length,2);
    assert.deepEqual(sources(final),[...sources(afterCrash)]);
    assert.ok(sources(final).includes(second.playerId)&&sources(final).includes(second.npcId));
    const idle=await m6For(x.store).recover({scope:x.scopes[0],atUtc:LATER});
    assert.equal(idle.saved.length,0);
    assert.equal((await permanent(x.store,x.scopes[0])).length,2);
  }finally{await x.store.close();}
  // Independent read-only look at the file: M7 never produced a job.
  const db=new DatabaseSync(x.filePath,{readOnly:true});
  try{
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM memory_curation_jobs').get().n,0);
    const rows=db.prepare("SELECT origin,COUNT(*) AS n FROM memory_records WHERE origin='deterministic' "+
      'AND character_id=?').get(x.npcs[0].characterId);
    assert.equal(rows.n,2);
  }finally{db.close();}
});

test('J-A: a conversation forgotten before processing is never retained, across restart',async t=>{
  const x=await setup(t);
  try{
    const forgotten=await exchange(x,0,'forgotten',0,FUNNY,NPC_FUNNY);
    const kept=await exchange(x,0,'kept',1200,'Hilarious prank on that cop, I will never forget it!',
      'Ha, best prank ever, remember when we laughed!');
    const service=await privacy(x);
    try{
      await forget(service,x,forgotten.playerId);
      await forget(service,x,forgotten.npcId);
    }finally{await service.close();}

    const result=await m6For(x.store).onSceneClose({scope:x.scopes[0],atUtc:LATER});
    assert.equal(result.acknowledged,true,'forgotten lines must not wedge the replay cursor');
    assert.deepEqual(result.rejected.map(r=>r.recordId).sort(),
      [forgotten.playerId,forgotten.npcId].sort());
    assert.ok(result.rejected.every(r=>r.reason==='forgotten_or_corrected'));

    const check=async()=>{
      const rows=await permanent(x.store,x.scopes[0]);
      assert.deepEqual(sources(rows),[kept.playerId,kept.npcId].sort());
      for(const row of rows){
        assert.ok(!row.envelope.content.includes(FUNNY));
        assert.ok(!row.envelope.content.includes(NPC_FUNNY));
      }
    };
    await check();
    await reopen(x);
    const recovered=await m6For(x.store).recover({scope:x.scopes[0],atUtc:LATER});
    assert.equal(recovered.saved.length,0);
    await check();
  }finally{await x.store.close();}
});

test('J-A: forgetting a source after it became a memory removes it and replay does not resurrect it',async t=>{
  const x=await setup(t);
  try{
    const a=await exchange(x,0,'keep',0,FUNNY,NPC_FUNNY);
    const b=await exchange(x,0,'later-forgotten',1200,
      'Hilarious prank on that cop, I will never forget it!','Ha, best prank ever, remember when we laughed!');
    await m6For(x.store).onSceneClose({scope:x.scopes[0],atUtc:LATER});
    assert.equal((await permanent(x.store,x.scopes[0])).length,2);

    const service=await privacy(x);
    try{await forget(service,x,b.npcId);}finally{await service.close();}
    const afterForget=await permanent(x.store,x.scopes[0]);
    assert.deepEqual(sources(afterForget),[a.playerId,a.npcId].sort());

    await reopen(x);
    const recovered=await m6For(x.store).recover({scope:x.scopes[0],atUtc:LATER});
    assert.equal(recovered.saved.length,0);
    assert.deepEqual(sources(await permanent(x.store,x.scopes[0])),[a.playerId,a.npcId].sort());
    // Nothing about the other promoted NPC changed or appeared.
    assert.equal((await permanent(x.store,x.scopes[1])).length,0);
  }finally{await x.store.close();}
});
