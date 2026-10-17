import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ProfileStore } from '../src/characters/profileStore.mjs';
import { createEssentialMemoryStorage } from '../src/characters/memoryStorageAdapter.mjs';
import { bindTrustedTimelineSource } from '../src/characters/timelineSourceBridge.mjs';
import { profile } from './p2-fixtures.mjs';
import { worldProfileId } from './identity-fixtures.mjs';

async function workspace(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'lsa-ea-final-b-'));
  // Close SQLite/WAL handles BEFORE deleting the Windows temp directory.
  // Node's after hooks run in registration order, not in LIFO order.
  const beforeRemoval=[];
  t.after(async()=> {
    for(const dispose of beforeRemoval.reverse()) await dispose();
    await fs.rm(root,{recursive:true,force:true});
  });
  return {json:path.join(root,'profiles.v1.json'),db:path.join(root,'profiles.v2.sqlite'),
    beforeRemoval:dispose=>beforeRemoval.push(dispose)};
}
const host = (hostRunId=randomUUID(),worldEpoch=1) =>
  Object.freeze({hostContextVersion:1,hostRunId,worldEpoch});
function acceptedC13() {
  const hosts=new Set(),bounds=new Set();
  return {
    subscribeVerifiedHostContext(cb) { hosts.add(cb);return () => hosts.delete(cb); },
    subscribeWorldBoundary(cb) { bounds.add(cb);return () => bounds.delete(cb); },
    host(context) {for (const cb of hosts) cb(context);},
    boundary(event) {for (const cb of bounds) cb(event);}
  };
}
async function start(t,{autoResume=false}={}) {
  const files=await workspace(t);
  const store=createEssentialMemoryStorage({filePath:files.db,legacyJsonPath:files.json,
    worldProfileId,sourceRequired:true});
  const source=acceptedC13(),bridge=bindTrustedTimelineSource({store,intelligenceClient:source,autoResume});
  files.beforeRemoval(async()=>{bridge.close();await store.close();});
  await store.initialize();
  const save=await store.createTimeline({label:'Exact existing save'});
  return {files,store,source,save};
}

test('EA Final B: transient C-13 disconnect fences writes, then single-timeline auto-resume recovers',async t=>{
  const {store,source,save}=await start(t,{autoResume:true});
  source.host(host());
  await store.confirmTimeline(save,{confirmation:save});
  assert.equal(store.timelineWritable,true);
  let writes=0;
  const stale=store.withTimelineWrite(save,()=>++writes);
  source.host(null); // authenticated native channel lost, but no save-fork evidence
  assert.equal(store.timelineWritable,false);
  assert.equal(store.timelinePendingReason,'native_source_unavailable');
  await assert.rejects(stale,/timeline_write_suspended/);
  source.host(host()); // fresh authenticated C-13 HELLO after reconnect
  await store.listTimelines(); // drain the serialized auto-resume operation
  assert.equal(store.timelineWritable,true);
  assert.equal(store.activeTimelineId,save);
  assert.equal(await store.withTimelineWrite(save,()=>++writes),1);
  // In contrast, a source-replacement HELLO without a disconnect is ambiguous:
  // it must revoke the selection and must NOT silently auto-resume.
  source.host(host());
  await store.listTimelines();
  assert.equal(store.timelineWritable,false);
  assert.equal(store.timelinePendingReason,'timeline_change');
});

test('EA Final B: queued confirmation cannot retarget a replacement host/epoch',async t=>{
  const {store,source,save}=await start(t);
  const first=host(),second=host();
  source.host(first);
  const queued=store.confirmTimeline(save,{confirmation:save});
  source.host(second);
  await assert.rejects(queued,/timeline_write_suspended/);
  assert.equal(store.timelineWritable,false);
  assert.equal(store.timelineSourceStatus,'confirmation_required');
  await store.confirmTimeline(save,{confirmation:save});
  assert.equal(store.timelineWritable,true);
});

test('EA Final B: same host/epoch replacement invalidates authority and queued writes',async t=>{
  const {store,source,save}=await start(t);
  const proof=host();
  source.host(proof);
  await store.confirmTimeline(save,{confirmation:save});
  let writes=0;
  const pending=store.withTimelineWrite(save,()=>++writes);
  // An accepted HELLO from a replaced connection may reuse the same scalars.
  source.host({...proof});
  assert.equal(store.timelineWritable,false);
  const reconfirm=store.confirmTimeline(save,{confirmation:save});
  await assert.rejects(pending,/timeline_write_suspended/);
  await reconfirm;
  assert.equal(writes,0);
  assert.equal(store.timelineWritable,true);
  assert.equal(await store.withTimelineWrite(save,()=>++writes),1);
});

test('EA Final B: save fork then same host reconfirm cannot authorize earlier queue',async t=>{
  const {store,source,save}=await start(t);
  const proof=host();
  source.host(proof);
  await store.confirmTimeline(save,{confirmation:save});
  let writes=0;
  const pending=store.withTimelineWrite(save,()=>++writes);
  source.boundary({reason:'save_fork'});
  source.host(proof);
  await assert.rejects(pending,/timeline_write_suspended/);
  await store.confirmTimeline(save,{confirmation:save});
  assert.equal(store.timelineWritable,true);
  assert.equal(writes,0);
});

test('EA Final B: wrong save and wrong host/epoch cannot inherit selection',async t=>{
  const {store,source,save}=await start(t);
  const other=await store.createTimeline({label:'Another save'});
  const proof=host();
  source.host(proof);
  await store.confirmTimeline(save,{confirmation:save});
  await assert.rejects(store.withTimelineWrite(other,()=>{}),/timeline_write_suspended/);
  source.host(host(proof.hostRunId,2));
  assert.equal(store.timelineWritable,false);
  await assert.rejects(store.withTimelineWrite(save,()=>{}),/timeline_write_suspended/);
  source.host(host());
  assert.equal(store.timelineWritable,false);
  await store.confirmTimeline(other,{confirmation:other});
  assert.equal(store.activeTimelineId,other);
  assert.equal(store.timelineWritable,true);
  source.host(null);
  assert.equal(store.timelineSourceStatus,'unavailable');
  assert.equal(store.timelineWritable,false);
});

test('EA Final B: OpenAI, Qwen, ElevenLabs assignments migrate byte-preservingly',async t=>{
  const files=await workspace(t);
  const json=new ProfileStore({filePath:files.json,worldProfileId});
  await json.initialize();
  const voices=[
    {assignmentVersion:1,provider:'openai',voice:'alloy'},
    {assignmentVersion:2,provider:'faster-qwen3-tts',voice:'speaker_0'},
    {assignmentVersion:3,provider:'elevenlabs',voice:'mature_male'}
  ];
  const expected=[];
  for (const entry of voices) {
    const incoming=profile({voiceReference:{...entry,profileId:'vp_1234567890abcdef1234',
      poolVersion:'b'.repeat(64)}});
    expected.push(await json.create(incoming));
  }
  const original=await fs.readFile(files.json,'utf8');
  const store=createEssentialMemoryStorage({filePath:files.db,legacyJsonPath:files.json,
    worldProfileId,sourceRequired:true});
  try {
    await store.initialize();
    assert.deepEqual(store.list(),expected);
    assert.equal(await fs.readFile(files.json,'utf8'),original);
    assert.equal(await fs.readFile(files.json+'.pre-sqlite.bak','utf8'),original);
  }finally{await store.close();}
});

test('EA Final B: qualified host reload cannot reconstruct missing native proof',async t=>{
  const {store,source,save}=await start(t);
  const first=host(),next=host(first.hostRunId,2);
  source.host(first);
  await store.confirmTimeline(save,{confirmation:save});
  source.host(next);
  source.boundary({reason:'host_reload',hostRunId:next.hostRunId,
    previousEpoch:1,worldEpoch:2});
  assert.equal(store.timelineSourceStatus,'unavailable');
  assert.equal(store.timelineWritable,false);
  await assert.rejects(store.confirmTimeline(save,{confirmation:save}),/timeline_write_suspended/);
  // Only a subsequent accepted C-13 native callback may reopen the gate.
  source.host(host());
  await store.confirmTimeline(save,{confirmation:save});
  assert.equal(store.timelineWritable,true);
});

test('EA Final B: valid v4 journal is opened safely and never downgraded',async t=>{
  const {files,store}=await start(t);
  await store.close();
  // Simulate an existing higher-version memory journal with real stored bytes.
  const seed=new DatabaseSync(files.db);
  seed.exec("CREATE TABLE memory_journal_v4 (id TEXT PRIMARY KEY, evidence TEXT NOT NULL)");
  seed.prepare('INSERT INTO memory_journal_v4 (id,evidence) VALUES (?,?)')
    .run('source-1','verbatim witnessed memory');
  seed.exec('PRAGMA user_version=4');
  seed.close();
  const read=new DatabaseSync(files.db,{readOnly:true});
  assert.equal(read.prepare('SELECT evidence FROM memory_journal_v4 WHERE id=?').get('source-1').evidence,'verbatim witnessed memory');
  read.close();
  // The approved G implementation MUST open valid v4 without downgrade.
  // Retain the unknown extension table and its exact evidence content.
  const current=createEssentialMemoryStorage({filePath:files.db,worldProfileId,sourceRequired:true});
  try {
    await current.initialize();
    assert.equal(current.timelineWritable,false,'restart cannot mint source authority');
    const inspect=new DatabaseSync(files.db,{readOnly:true});
    try {
      assert.equal(inspect.prepare('PRAGMA user_version').get().user_version,4);
      assert.equal(inspect.prepare('SELECT count(*) AS count FROM memory_journal_v4').get().count,1);
      assert.equal(inspect.prepare('SELECT evidence FROM memory_journal_v4 WHERE id=?').get('source-1').evidence,
        'verbatim witnessed memory');
    }finally{inspect.close();}
  }finally{await current.close();}
});
