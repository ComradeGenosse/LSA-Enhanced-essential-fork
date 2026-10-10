import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ShadowRuntime } from '../src/perception/shadowRuntime.mjs';
import { CAPABILITIES,validateFrame,validateObserverIndex } from '../src/perception/contracts.mjs';
const setup=()=>{
  const runtime=new ShadowRuntime({mode:'shadow',now:()=>1});
  const hello={version:1,type:'hello',adapterEpoch:randomUUID(),streamId:randomUUID(),hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1,observerIndexVersion:1,capabilities:Object.fromEntries(CAPABILITIES.map(k=>[k,false]))};
  const send=(sequence,type,payload)=>runtime.ingest({version:1,type,adapterEpoch:hello.adapterEpoch,streamId:hello.streamId,sequence,payload},{authenticated:true});
  assert.equal(runtime.ingest(hello,{authenticated:true}),true);return {runtime,hello,send};
};
test('observer index is closed, bounded and cannot attach durable identity',()=>{
  const row={captureRef:randomUUID(),kind:'ped',owned:false};assert.equal(validateObserverIndex(row),true);
  for(const patch of [{characterId:randomUUID()},{encounterId:randomUUID()},{owned:'yes'},{kind:'unknown'},{encounterId:randomUUID(),incarnationId:randomUUID()}]) assert.equal(validateObserverIndex({...row,...patch}),false);
  const {hello}=setup();assert.equal(validateFrame({...hello,observerIndexVersion:2}),false);
});
test('ordered index admission requires a live matching anchor and retirement removes it',()=>{
  const {runtime,send}=setup(),captureRef=randomUUID();
  assert.equal(send(1,'anchors',[{captureRef,kind:'ped',observer:true,owned:false}]),true);
  assert.equal(send(2,'observer_index',[{captureRef,kind:'ped',owned:false}]),true);
  assert.equal(Object.isFrozen(runtime.observerIndex.get(captureRef)),true);
  assert.equal(send(3,'retire_batch',[captureRef]),true);assert.equal(runtime.observerIndex.size,0);
  assert.equal(send(4,'observer_index',[{captureRef,kind:'ped',owned:false}]),false);assert.equal(runtime.epoch,null);
});
test('world reset clears the index and retains the negotiated extension',()=>{
  const {runtime,send}=setup(),captureRef=randomUUID();send(1,'anchors',[{captureRef,kind:'ped',observer:true,owned:false}]);send(2,'observer_index',[{captureRef,kind:'ped',owned:false}]);
  assert.equal(send(3,'world_epoch',{epoch:2,reason:'timeline_change'}),true);assert.equal(runtime.observerIndex.size,0);assert.equal(runtime.observerIndexVersion,1);
  runtime.reset('disconnect');assert.equal(runtime.observerIndexVersion,null);
});

test('PR21 T09 sequence gap retires actual observer index and old stream cannot publish a replacement',()=>{
  const {runtime,hello,send}=setup(),captureRef=randomUUID();
  const row={captureRef,kind:'ped',owned:false};
  assert.equal(send(1,'anchors',[{captureRef,kind:'ped',observer:true,owned:false}]),true);
  assert.equal(send(2,'observer_index',[row]),true);
  assert.equal(runtime.observerIndex.has(captureRef),true);
  // The missing sequence 3 cannot be interpreted as a partial/native roster.
  assert.equal(send(4,'observer_index',[row]),false);
  assert.equal(runtime.epoch,null);
  assert.equal(runtime.anchors.size,0);
  assert.equal(runtime.observerIndex.size,0);
  assert.equal(runtime.ingest({version:1,type:'observer_index',adapterEpoch:hello.adapterEpoch,
    streamId:hello.streamId,sequence:3,payload:[row]},{authenticated:true}),false);
  assert.equal(runtime.observerIndex.size,0);
  const newHello={...hello,adapterEpoch:randomUUID(),streamId:randomUUID(),worldEpoch:2};
  assert.equal(runtime.ingest(newHello,{authenticated:true}),true);
  assert.equal(runtime.observerIndex.size,0);
  assert.equal(runtime.ingest({version:1,type:'observer_index',adapterEpoch:hello.adapterEpoch,
    streamId:hello.streamId,sequence:5,payload:[row]},{authenticated:true}),false);
  assert.equal(runtime.observerIndex.size,0);
});
