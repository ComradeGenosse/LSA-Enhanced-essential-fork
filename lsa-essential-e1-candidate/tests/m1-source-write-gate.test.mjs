import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createEssentialMemoryStorage } from '../src/characters/memoryStorageAdapter.mjs';
import { worldProfileId } from './identity-fixtures.mjs';

const host=(hostRunId=randomUUID(),worldEpoch=1)=>({hostContextVersion:1,hostRunId,worldEpoch});
async function fixture(t,sourceRequired=true) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'m1-source-gate-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  return createEssentialMemoryStorage({filePath:path.join(dir,'profiles.sqlite'),worldProfileId,sourceRequired});
}

test('M1 source-gated timeline operations need live proof and explicit player confirmation',async t=>{
  const store=await fixture(t);
  try {
    await store.initialize();
    const selected=await store.createTimeline({label:'First game'});
    await store.confirmTimeline(selected);
    assert.equal(store.timelineSourceStatus,'unavailable');
    assert.equal(store.timelinePendingReason,'native_source_unavailable');
    assert.equal(store.timelineWritable,false);
    assert.throws(()=>store.assertTimelineWrite(selected),/timeline_write_suspended/);
    let written=0;
    await assert.rejects(store.withTimelineWrite(selected,()=>++written),/timeline_write_suspended/);
    assert.equal(written,0);

    const first=host();
    store.setVerifiedHostContext(first);
    assert.equal(store.timelineSourceStatus,'confirmation_required');
    await assert.rejects(store.withTimelineWrite(selected,()=>++written),/timeline_write_suspended/);
    await store.confirmTimeline(selected);
    assert.equal(store.timelineSourceStatus,'verified');
    assert.equal(store.timelineWritable,true);
    assert.equal(await store.withTimelineWrite(selected,()=>++written),1);
    await assert.rejects(store.withTimelineWrite(randomUUID(),()=>++written),/timeline_write_suspended/);
    assert.equal(written,1);

    // Same authenticated host: no additional selection is required.
    store.setVerifiedHostContext(first);
    assert.equal(store.timelineWritable,true);
    // Untrusted/partial source can never silently enable the write gate.
    assert.throws(()=>store.setVerifiedHostContext({...first,worldEpoch:0}),/invalid_timeline_source_context/);
    assert.equal(store.timelineWritable,true);

    store.setVerifiedHostContext(null);
    assert.equal(store.timelineWritable,false);
    await assert.rejects(store.withTimelineWrite(selected,()=>++written),/timeline_write_suspended/);
    store.setVerifiedHostContext(first);
    assert.equal(store.timelineWritable,false,'reconnect alone must not reauthorize writes');
    await store.confirmTimeline(selected);
    assert.equal(await store.withTimelineWrite(selected,()=>++written),2);
    store.setVerifiedHostContext(host(first.hostRunId,2));
    assert.equal(store.timelineWritable,false,'native epoch must not carry approval across saves');
    await store.confirmTimeline(selected);
    assert.equal(store.timelineWritable,true);
    store.onBoundary({reason:'clock_regression'});
    assert.equal(store.timelineWritable,false);
    await assert.rejects(store.withTimelineWrite(selected,()=>++written),/timeline_write_suspended/);
    await store.confirmTimeline(selected);
    assert.equal(await store.withTimelineWrite(selected,()=>++written),3);
    assert.equal(written,3);
  } finally { await store.close(); }
});

test('M1 verifies timeline provenance after a queued write, not only before enqueue',async t=>{
  const store=await fixture(t);
  try {
    await store.initialize();
    const id=await store.createTimeline({label:'Queue'});
    const origin=host();
    store.setVerifiedHostContext(origin);
    await store.confirmTimeline(id);
    let resolve;
    const blocked=new Promise(r=>resolve=r);
    // Hold the single P2 writer queue while a later write is enqueued.
    const first=store.withTimelineWrite(id,()=>blocked);
    const later=store.withTimelineWrite(id,()=>{throw new Error('should_never_execute');});
    store.setVerifiedHostContext(null);
    resolve(null);
    await assert.rejects(first,/timeline_write_async_not_supported/);
    await assert.rejects(later,/timeline_write_suspended/);
  } finally {await store.close();}
});

test('M1 restart never reuses native source confirmation from previous process',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'m1-source-reopen-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const filePath=path.join(dir,'profiles.sqlite');
  const first=createEssentialMemoryStorage({filePath,worldProfileId,sourceRequired:true});
  await first.initialize();
  const id=await first.createTimeline({label:'Played session'});
  const source=host();
  first.setVerifiedHostContext(source);
  await first.confirmTimeline(id);
  assert.equal(first.timelineWritable,true);
  await first.close();
  const second=createEssentialMemoryStorage({filePath,worldProfileId,sourceRequired:true});
  try {
    await second.initialize();
    assert.equal(second.activeTimelineId,id);
    assert.equal(second.timelineWritable,false);
    second.setVerifiedHostContext(source);
    assert.equal(second.timelineWritable,false);
    await second.confirmTimeline(id);
    assert.equal(second.timelineWritable,true);
  } finally {await second.close();}
});

test('M1 host-free standalone storage retains explicit timeline guard contract',async t=>{
  const store=await fixture(t,false);
  try {
    await store.initialize();
    const id=await store.createTimeline({label:'Standalone fixture'});
    assert.equal(store.timelineSourceStatus,'not_required');
    await assert.rejects(store.withTimelineWrite(id,()=>1),/timeline_write_suspended/);
    await store.confirmTimeline(id);
    assert.equal(await store.withTimelineWrite(id,()=>42),42);
    store.onBoundary({reason:'timeline_change'});
    await assert.rejects(store.withTimelineWrite(id,()=>42),/timeline_write_suspended/);
  } finally {await store.close();}
});
