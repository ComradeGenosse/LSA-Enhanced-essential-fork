import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createP2MemoryStorage} from '../src/characters/sqliteProfileStore.mjs';

async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'pause-source-'));
  const store=createP2MemoryStorage({filePath:path.join(dir,'p.sqlite'),worldProfileId:randomUUID(),sourceRequired:true});
  await store.initialize();
  t.after(async()=>{await store.close();await rm(dir,{recursive:true,force:true});});
  const host={hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1};
  store.setVerifiedHostContext(host);
  const timeline=await store.createTimeline({label:'Existing save'});
  return {store,host,timeline};
}
test('pause suspends writes; exact authenticated run/epoch resumes selection but never queued old work',async t=>{
  const {store,host,timeline}=await fixture(t);
  await store.confirmTimeline(timeline,{confirmation:timeline});
  let written=0;
  const old=store.withTimelineWrite(timeline,()=>++written);
  store.setVerifiedHostContext(null);
  assert.equal(store.timelineWritable,false);
  assert.equal(store.verifiedHostContext,null);
  store.setVerifiedHostContext(host);
  await assert.rejects(old,/timeline_write_suspended/);
  assert.equal(written,0);
  assert.equal(store.timelineWritable,true);
  await store.withTimelineWrite(timeline,()=>++written);
  assert.equal(written,1);
});
test('explicit confirmation while paused applies only to the previously observed authenticated run/epoch',async t=>{
  const {store,host,timeline}=await fixture(t);
  store.setVerifiedHostContext(null);
  await store.confirmTimeline(timeline,{confirmation:timeline});
  assert.equal(store.timelineWritable,false);
  store.setVerifiedHostContext(host);
  assert.equal(store.timelineWritable,true);
  store.setVerifiedHostContext(null);
  store.setVerifiedHostContext({...host,worldEpoch:2});
  assert.equal(store.timelineWritable,false);
  store.setVerifiedHostContext(host);
  assert.equal(store.timelineWritable,false,'old selection cannot resurrect after a changed world');
});
test('different host and ambiguous boundaries always require new confirmation',async t=>{
  const {store,host,timeline}=await fixture(t);
  await store.confirmTimeline(timeline,{confirmation:timeline});
  store.setVerifiedHostContext(null);
  store.setVerifiedHostContext({...host,hostRunId:randomUUID()});
  assert.equal(store.timelineWritable,false);
  await store.confirmTimeline(timeline,{confirmation:timeline});
  store.onBoundary({reason:'clock_regression'});
  store.setVerifiedHostContext(null);
  store.setVerifiedHostContext(host);
  assert.equal(store.timelineWritable,false);
});
