import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createEssentialMemoryStorage} from '../src/characters/memoryStorageAdapter.mjs';
import {M5SqliteServices} from '../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';
import {profile} from './p2-fixtures.mjs';
import {worldProfileId} from './identity-fixtures.mjs';

const hash=s=>createHash('sha256').update(s).digest('hex');
async function setup(t){
  const dir=await mkdtemp(path.join(tmpdir(),'lsa-shared-player-v4-'));
  const store=createEssentialMemoryStorage({filePath:path.join(dir,'memory.sqlite'),
    worldProfileId,sourceRequired:true});
  // Windows cannot delete WAL/SHM until ALL reopened readers are closed.
  // Do not rely on LIFO ordering of test.after() hooks.
  const closers=[()=>store.close()];
  t.after(async()=>{
    for(const close of closers.reverse())await close();
    await rm(dir,{recursive:true,force:true});
  });
  await store.initialize();
  const npc=await store.create(profile());
  const timelineId=await store.createTimeline({label:'Explicit shared-save fixture'});
  const proof={hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1};
  store.setVerifiedHostContext(proof);
  await store.confirmTimeline(timelineId,{confirmation:timelineId});
  const scope=protagonistKey=>({worldProfileId,characterId:npc.characterId,
    timelineId,protagonistKey});
  async function line(protagonist,text){
    const recordId=randomUUID(),turnIdentityHash=hash(recordId);
    const envelope={version:1,characterId:npc.characterId,worldProfileId,timelineId,
      kind:'dialogue_line',recordId,speaker:'player',source:'typed',content:text,
      delivery:'accepted',committedAtUtc:new Date().toISOString(),turnIdentityHash,
      utteranceId:null,transcription:null,deliveryReceiptId:null};
    await store.appendDialogueLine(envelope,{sessionId:randomUUID(),protagonist,
      hostRunId:proof.hostRunId,worldEpoch:proof.worldEpoch});
    return envelope;
  }
  async function memory(protagonist,text,evidenceIds){
    const id=randomUUID();
    await store.withTimelineSqliteWrite(scope(protagonist),db=>{
      db.prepare('INSERT INTO memory_records VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
        id,npc.characterId,worldProfileId,timelineId,protagonist,'explicit_player',
        text,hash(text),'reported_claim',1,.9,JSON.stringify(evidenceIds),
        new Date().toISOString(),null);
    });
    return id;
  }
  return {store,npc,timelineId,proof,scope,line,memory,registerCloser:fn=>closers.push(fn)};
}
test('Unified player: Franklin accepted dialogue/memory is available as Michael and Trevor',async t=>{
  const f=await setup(t);
  const a=await f.line('franklin','We are friends since the first meeting.');
  const b=await f.line('michael','Remember our promise to meet again.');
  const mem=await f.memory('franklin','The player is my friend.',[a.recordId]);
  const scope=f.scope('trevor');
  const lines=await f.store.readIntegratedRecall({scope,sourceKind:'dialogue_line'});
  assert.equal(lines.rows.length,2);
  assert.ok(lines.rows.some(r=>r.envelope.recordId===a.recordId));
  assert.ok(lines.rows.some(r=>r.envelope.recordId===b.recordId));
  const recalled=await f.store.readIntegratedRecall({scope,sourceKind:'permanent_memory'});
  assert.ok(recalled.rows.some(r=>r.recordId===mem));
  assert.equal(recalled.rows.find(r=>r.recordId===mem).protagonistKey,'franklin',
    'provenance is preserved, not a player identity partition');
  const candidates=await f.store.findCandidates({scope:f.scope('michael')});
  assert.ok(candidates.some(r=>r.recordId===mem));
  assert.ok(candidates.some(r=>r.recordId===a.recordId));
});
test('Unified replay cursor: all story avatars share one page/checkpoint, old model cursor rewinds',async t=>{
  const f=await setup(t);
  const a=await f.line('franklin','First original turn.');
  const b=await f.line('michael','Second original turn.');
  const trevor=f.scope('trevor');
  const page=await f.store.readCommittedEvidencePage({scope:trevor});
  assert.deepEqual(new Set(page.items.map(x=>x.recordId)),new Set([a.recordId,b.recordId]));
  const oldHash=hash(JSON.stringify([worldProfileId,f.npc.characterId,f.timelineId,'franklin']));
  const oldToken=Buffer.from(JSON.stringify({v:1,scope:oldHash,after:999}),
    'utf8').toString('base64url');
  const migrated=await f.store.readCommittedEvidencePage({scope:f.scope('franklin'),cursor:oldToken});
  assert.equal(migrated.items.length,2,'never skip unprocessed Michael evidence');
  const before=await f.store.readCommittedEvidenceCursor({scope:trevor,consumerId:'shared-player-test'});
  await f.store.ackCommittedEvidenceCursor({scope:trevor,consumerId:'shared-player-test',
    cursor:page.cursor,expectedCursor:before.cursor});
  const michael=await f.store.readCommittedEvidenceCursor({scope:f.scope('michael'),
    consumerId:'shared-player-test'});
  assert.equal(michael.lastSequence,page.lastSequence,'canonical cursor shared across avatars');
  const subsequent=await f.store.readCommittedEvidencePage({scope:f.scope('franklin'),cursor:michael.cursor});
  assert.equal(subsequent.items.length,0);
});
test('Cross-avatar privacy: forget/restore the same NPC memory; save boundary fails closed',async t=>{
  const f=await setup(t);
  const a=await f.line('franklin','Only the intended NPC learned this.');
  const id=await f.memory('franklin','Private personal preference.',[a.recordId]);
  const privacy=new M5SqliteServices({store:f.store,filePath:f.store.filePath,
    authorize:()=>true});
  const trevor=f.scope('trevor');
  const inspected=await privacy.inspect({scope:trevor});
  assert.ok(inspected.records.some(x=>x.recordId===id));
  const operationId=randomUUID();
  const trash=await privacy.trash({scope:trevor,targetId:id,operationId});
  assert.equal(trash.durableCommit,true);
  assert.equal((await f.store.readIntegratedRecall({scope:f.scope('michael'),
    sourceKind:'permanent_memory'})).rows.some(r=>r.recordId===id),false);
  await privacy.restore({scope:f.scope('michael'),trashId:operationId});
  assert.equal((await f.store.readIntegratedRecall({scope:f.scope('michael'),
    sourceKind:'permanent_memory'})).rows.some(r=>r.recordId===id),true);
  f.store.onBoundary({reason:'save_fork'});
  await assert.rejects(f.store.readIntegratedRecall({scope:f.scope('michael')}),/timeline_write_suspended/);
  await assert.rejects(f.store.readCommittedEvidencePage({scope:trevor}),/timeline_write_suspended/);
});

test('M7 deterministic memory can combine accepted Franklin and Michael evidence without rewriting provenance',async t=>{
  const f=await setup(t);
  const a=await f.line('franklin','We met at the cafe.');
  const b=await f.line('michael','We returned to the same cafe.');
  const proposalId=randomUUID();
  const proposal={kind:'curation_proposal',provider:'deterministic',proposalId,
    characterId:f.npc.characterId,worldProfileId,timelineId:f.timelineId,
    evidenceRecordIds:[a.recordId,b.recordId],notability:.75,
    groundedSummary:'The player visited the cafe twice.'};
  const result=await f.store.saveDeterministicMemory(proposal);
  assert.equal(result.inserted,true);
  const recall=await f.store.readIntegratedRecall({scope:f.scope('trevor'),
    sourceKind:'permanent_memory'});
  assert.ok(recall.rows.some(row=>row.recordId===proposalId),
    'mixed authenticated avatar evidence must be available to the same human');
  const raw=await f.store.withP2SqliteRead(f.scope('trevor'),db=>
    db.prepare('SELECT protagonist_key FROM memory_records WHERE memory_id=?').get(proposalId));
  assert.equal(raw.protagonist_key,'multi_avatar','source provenance does not masquerade as Franklin');
});
test('M5 scope deletion includes all player avatars, and reversible restore works from another avatar',async t=>{
  const f=await setup(t);
  const a=await f.line('franklin','One shared relationship.');
  const b=await f.line('michael','One more shared promise.');
  const mem=await f.memory('franklin','Shared personal memory.',[a.recordId,b.recordId]);
  const privacy=new M5SqliteServices({store:f.store,filePath:f.store.filePath,authorize:()=>true});
  const done=await privacy.trashScope({scope:f.scope('trevor')});
  assert.ok(done.targetIds.includes(a.recordId));
  assert.ok(done.targetIds.includes(b.recordId));
  assert.ok(done.targetIds.includes(mem));
  assert.equal((await f.store.readIntegratedRecall({scope:f.scope('michael')})).rows.length,0);
  const inspector=await privacy.inspect({scope:f.scope('franklin')});
  const source=inspector.trash.find(row=>row.targetId===a.recordId);
  assert.ok(source?.trashId);
  await privacy.restore({scope:f.scope('michael'),trashId:source.trashId});
  assert.ok((await f.store.readIntegratedRecall({scope:f.scope('trevor')})).rows
    .some(row=>row.recordId===mem));
});
test('Shared-player persistent recall survives restart, but same-save authorization never does',async t=>{
  const f=await setup(t);
  const a=await f.line('franklin','We stayed friends over the restart.');
  const mem=await f.memory('franklin','Long-lasting friendship.',[a.recordId]);
  await f.store.close();
  const opened=createEssentialMemoryStorage({filePath:f.store.filePath,
    worldProfileId,sourceRequired:true});
  f.registerCloser(()=>opened.close());
  await opened.initialize();
  await assert.rejects(opened.readIntegratedRecall({scope:f.scope('trevor')}),/timeline_write_suspended/);
  opened.setVerifiedHostContext({hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1});
  await opened.confirmTimeline(f.timelineId,{confirmation:f.timelineId});
  const recall=await opened.readIntegratedRecall({scope:f.scope('trevor'),
    sourceKind:'permanent_memory'});
  assert.ok(recall.rows.some(row=>row.recordId===mem));
  await assert.rejects(opened.readIntegratedRecall({scope:{...f.scope('trevor'),
    characterId:randomUUID()}}),/p2_memory_owner_or_world_missing/);
  const other=await opened.createTimeline({label:'Different, unconfirmed save'});
  await assert.rejects(opened.readIntegratedRecall({scope:{...f.scope('trevor'),
    timelineId:other}}),/timeline_write_suspended/);
});


test('PR114 current P2 recall is inaccessible after source revocation and before renewed approval',async t=>{
  const f=await setup(t);
  const a=await f.line('franklin','Private line bound to a verified host.');
  assert.ok((await f.store.readIntegratedRecall({scope:f.scope('trevor'),sourceKind:'dialogue_line'}))
    .rows.some(r=>r.recordId===a.recordId));
  f.store.setVerifiedHostContext(null);
  await assert.rejects(f.store.readIntegratedRecall({scope:f.scope('trevor')}),/timeline_write_suspended/);
  f.store.setVerifiedHostContext(f.proof);
  await assert.rejects(f.store.readIntegratedRecall({scope:f.scope('trevor')}),/timeline_write_suspended/);
  await f.store.confirmTimeline(f.timelineId,{confirmation:f.timelineId});
  assert.ok((await f.store.readIntegratedRecall({scope:f.scope('trevor'),sourceKind:'dialogue_line'}))
    .rows.some(r=>r.recordId===a.recordId));
  await assert.rejects(f.store.confirmTimeline(f.timelineId,{confirmation:randomUUID()}),
    /explicit_confirmation_required/);
});
test('PR114 queued writes and reads reject retired admission and repeat host samples preserve fresh work',async t=>{
  const f=await setup(t);
  let written=0;
  const pendingWrite=f.store.withTimelineWrite(f.timelineId,()=>++written);
  const pendingRead=f.store.withP2SqliteRead(f.scope('franklin'),db=>db.prepare('SELECT 1 AS ok').get());
  f.store.setVerifiedHostContext(null);
  f.store.setVerifiedHostContext(f.proof);
  await assert.rejects(pendingWrite,/timeline_write_suspended/);
  await assert.rejects(pendingRead,/timeline_write_suspended/);
  assert.equal(written,0);
  await f.store.confirmTimeline(f.timelineId,{confirmation:f.timelineId});
  f.store.setVerifiedHostContext(f.proof); // same epoch sample is not revocation
  assert.equal(await f.store.withTimelineWrite(f.timelineId,()=>++written),1);
  assert.equal((await f.store.withP2SqliteRead(f.scope('franklin'),
    db=>db.prepare('SELECT 1 AS ok').get())).ok,1);
});
test('PR114 valid legacy v1 token rewinds but a forged or different-avatar token is denied',async t=>{
  const f=await setup(t);
  const a=await f.line('franklin','One original source.');
  const b=await f.line('michael','One previously unseen source.');
  const token=(avatar,scopeHash,after)=>Buffer.from(JSON.stringify({v:1,scope:scopeHash,after}),'utf8').toString('base64url');
  const franklinHash=hash(JSON.stringify([worldProfileId,f.npc.characterId,f.timelineId,'franklin']));
  const valid=token('franklin',franklinHash,999);
  const replay=await f.store.readCommittedEvidencePage({scope:f.scope('franklin'),cursor:valid});
  assert.deepEqual(new Set(replay.items.map(x=>x.recordId)),new Set([a.recordId,b.recordId]));
  await assert.rejects(f.store.readCommittedEvidencePage({scope:f.scope('trevor'),cursor:valid}),
    /p2_replay_invalid_cursor/);
  await assert.rejects(f.store.readCommittedEvidencePage({scope:f.scope('franklin'),
    cursor:token('franklin','0'.repeat(64),999)}),/p2_replay_invalid_cursor/);
});
