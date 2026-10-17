import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { IntelligenceClient } from '../src/perception/intelligenceClient.mjs';
import { CAPABILITIES } from '../src/perception/contracts.mjs';
import { createEssentialMemoryStorage } from '../src/characters/memoryStorageAdapter.mjs';
import { worldProfileId } from './identity-fixtures.mjs';

const settled = () => new Promise(resolve => setImmediate(resolve));
async function tempStore(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lsa-m1-epoch-'));
  t.after(async()=>fs.rm(root,{force:true,recursive:true}));
  return path.join(root,'p2.sqlite');
}
function nativePipe(t) {
  const socket=new EventEmitter();
  socket.destroyed=false;socket.writable=true;socket.writableLength=0;
  socket.write=()=>true;
  socket.destroy=()=>{if(!socket.destroyed){socket.destroyed=true;socket.emit('close');}};
  t.after(()=>socket.destroy());
  return socket;
}
function hello(hostRunId,adapterEpoch,streamId) {
  return {version:1,type:'hello',adapterEpoch,streamId,
    capabilities:Object.fromEntries(CAPABILITIES.map(key=>[key,false])),
    hostContextVersion:1,hostRunId,worldEpoch:1};
}
function frame(adapterEpoch,streamId,sequence,epoch,reason='clock_regression') {
  return {version:1,type:'world_epoch',adapterEpoch,streamId,sequence,
    payload:{epoch,reason}};
}
test('M1 only an authenticated ordered native epoch change can suspend timeline writes',async t=>{
  const filePath=await tempStore(t);
  const store=createEssentialMemoryStorage({filePath,worldProfileId});
  try {
  await store.initialize();
  const id=await store.createTimeline({label:'A'});
  await store.confirmTimeline(id,{confirmation:id});

  const socket=nativePipe(t);
  const client=new IntelligenceClient({mode:'shadow',radio:'off',pipeName:'m1-fixture'},{
    connect:()=>socket,report:()=>{},telemetry:()=>{},now:()=>100
  });
  t.after(()=>client.stop());
  const observed=[];
  client.subscribeWorldBoundary(boundary=>{
    observed.push(boundary);
    store.onBoundary({reason:boundary.reason});
  });
  client.start();
  const adapterEpoch=randomUUID(),streamId=randomUUID(),run=randomUUID();
  const send=x=>socket.emit('data',Buffer.from(JSON.stringify(x)+'\n'));
  send(hello(run,adapterEpoch,streamId));await settled();
  assert.equal(store.timelineWritable,true);
  // Repeated current epoch is a valid no-op, not a rollback claim.
  send(frame(adapterEpoch,streamId,1,1));await settled();
  assert.equal(observed.length,0);
  send(frame(adapterEpoch,streamId,2,2));await settled();
  assert.equal(observed.length,1);
  assert.deepEqual(observed[0],{
    reason:'clock_regression',hostRunId:run,previousEpoch:1,worldEpoch:2
  });
  assert.equal(store.timelineWritable,false);
  assert.throws(()=>store.assertTimelineWrite(id),/timeline_write_suspended/);
  await store.confirmTimeline(id,{confirmation:id});assert.equal(store.timelineWritable,true);
  // Invalid jump/ordering MUST NOT reach the memory boundary.
  send(frame(adapterEpoch,streamId,4,3));await settled();
  assert.equal(observed.length,1);
  assert.equal(socket.destroyed,true);
  } finally { await store.close(); }
});

test('M1 retains an early verified rollback freeze across pending SQLite initialization',async t=>{
  const filePath=await tempStore(t);
  const primary=createEssentialMemoryStorage({filePath,worldProfileId});
  await primary.initialize();
  const id=await primary.createTimeline({label:'First save'});
  await primary.confirmTimeline(id,{confirmation:id});await primary.close();
  const next=createEssentialMemoryStorage({filePath,worldProfileId});
  next.onBoundary({reason:'timeline_change'});
  await next.initialize();
  assert.equal(next.activeTimelineId,id);
  assert.equal(next.timelineWritable,false);
  assert.equal(next.timelinePendingReason,'timeline_change');
  await next.confirmTimeline(id,{confirmation:id});
  assert.equal(next.timelineWritable,true);
  await next.close();
});

test('M1 does not suspend a previously selected timeline for harmless host reload',async t=>{
  const filePath=await tempStore(t);
  const store=createEssentialMemoryStorage({filePath,worldProfileId});
  await store.initialize();
  const id=await store.createTimeline({label:'Still active'});
  await store.confirmTimeline(id,{confirmation:id});
  store.onBoundary({reason:'host_reload'});
  store.assertTimelineWrite(id);
  await store.close();
});

test('M1 verified native hello authorizes selection but disconnection revokes timeline writes',async t=>{
  const filePath=await tempStore(t);
  const store=createEssentialMemoryStorage({filePath,worldProfileId,sourceRequired:true});
  try {
    await store.initialize();
    const id=await store.createTimeline({label:'Native-linked save'});
    const socket=nativePipe(t);
    const client=new IntelligenceClient({mode:'shadow',radio:'off',pipeName:'m1-linked'},{
      connect:()=>socket,report:()=>{},telemetry:()=>{},now:()=>100
    });
    t.after(()=>client.stop());
    const hosts=[];
    client.subscribeVerifiedHostContext(value=>{
      hosts.push(value);
      store.setVerifiedHostContext(value);
    });
    client.subscribeWorldBoundary(boundary=>store.onBoundary({reason:boundary.reason}));
    client.start();
    const epoch=randomUUID(),stream=randomUUID(),run=randomUUID();
    const send=body=>socket.emit('data',Buffer.from(JSON.stringify(body)+'\n'));
    send(hello(run,epoch,stream));
    await settled();
    assert.equal(hosts.length,1);
    assert.equal(store.timelineWritable,false);
    assert.equal(store.timelineSourceStatus,'confirmation_required');
    await store.confirmTimeline(id,{confirmation:id});
    let operations=0;
    await store.withTimelineWrite(id,()=>++operations);
    send(frame(epoch,stream,1,2,'timeline_change'));
    await settled();
    assert.equal(store.timelineWritable,false);
    assert.equal(store.timelinePendingReason,'timeline_change');
    await assert.rejects(store.withTimelineWrite(id,()=>++operations),/timeline_write_suspended/);
    await store.confirmTimeline(id,{confirmation:id});
    assert.equal(store.timelineWritable,true);
    socket.destroy();
    await settled();
    assert.equal(store.timelineWritable,false);
    assert.equal(store.timelineSourceStatus,'unavailable');
    await assert.rejects(store.withTimelineWrite(id,()=>++operations),/timeline_write_suspended/);
    assert.equal(operations,1);
  } finally {await store.close();}
});
