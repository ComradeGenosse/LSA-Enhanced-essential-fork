import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ShadowRuntime} from '../src/perception/shadowRuntime.mjs';
import {CAPABILITIES} from '../src/perception/contracts.mjs';

const id=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture(tap, {index=true}={}){
  const adapterEpoch=id(1),streamId=id(2),hostRunId=id(3),observer=id(4),player=id(5);
  const runtime=new ShadowRuntime({mode:'shadow',now:()=>1000,acceptedObservationTap:tap});
  let sequence=0;
  const send=(type,payload)=>runtime.ingest({version:1,type,adapterEpoch,streamId,
    sequence:++sequence,payload},{authenticated:true});
  const caps=Object.fromEntries(CAPABILITIES.map(key=>[key,key!=='playerSpeech']));
  assert.equal(runtime.ingest({version:1,type:'hello',adapterEpoch,streamId,capabilities:caps,
    hostContextVersion:1,hostRunId,worldEpoch:4,observerIndexVersion:1},{authenticated:true}),true);
  assert.equal(send('anchors',[
    {captureRef:observer,kind:'ped',observer:true,owned:true},
    {captureRef:player,kind:'player',observer:false}
  ]),true);
  if(index) assert.equal(send('observer_index',[
    {captureRef:observer,kind:'ped',owned:true,incarnationId:id(6),encounterId:id(7)}
  ]),true);
  let count=0;
  const signal=()=>({signalId:id(20+count),producer:'shooting',producerSequence:++count,
    kind:'firing',source:player,target:null,gameTick:100+count,ageMs:0,facts:{},
    witnessReceipts:[{observer:{captureRef:observer,kind:'ped'},status:'witnessed',
      sampledGameTick:100+count,reason:'visual_clear',knowsSource:true,knowsTarget:false,
      evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:100+count}}]});
  return {runtime,send,signal,observer,adapterEpoch,hostRunId};
}
test('M3 PS2 tap receives only authenticated, correlated and indexed observers',()=>{
  const accepted=[];
  const f=fixture(value=>accepted.push(value));
  assert.equal(f.send('signal',f.signal()),true);
  assert.equal(accepted.length,1);
  assert.equal(accepted[0].observerIndex.incarnationId,id(6));
  assert.equal(accepted[0].adapterEpoch,f.adapterEpoch);
  assert.equal(accepted[0].hostRunId,f.hostRunId);
  assert.equal(accepted[0].worldEpoch,4);
  assert.equal(accepted[0].observation.observer.captureRef,f.observer);
  assert.equal(f.runtime.memoryTapDiagnostics.delivered,1);
  assert.equal(f.runtime.ingest({version:1,type:'signal',adapterEpoch:f.adapterEpoch,
    streamId:id(2),sequence:999,payload:f.signal()},{authenticated:false}),false);
  assert.equal(accepted.length,1);
});
test('M3 PS2 tap rejects missing native owner-index proof',()=>{
  const calls=[];const f=fixture(value=>calls.push(value),{index:false});
  assert.equal(f.send('signal',f.signal()),true);
  assert.equal(calls.length,0);
  assert.equal(f.runtime.memoryTapDiagnostics.rejected,1);
});
test('M3 PS2 memory-tap exceptions and asynchronous callbacks cannot break native perception',()=>{
  for(const callback of [()=>{throw new Error('store unavailable');},()=>Promise.resolve(true)]){
    const f=fixture(callback);
    assert.equal(f.send('signal',f.signal()),true);
    assert.equal(f.runtime.memoryTapDiagnostics.faults,1);
    assert.equal(f.runtime.observations.entries.size,1);
  }
});
