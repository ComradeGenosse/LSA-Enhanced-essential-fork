
test('valid native director priority wire frame passes strict contract validation',()=>{
 const epoch=randomUUID(),stream=randomUUID();
 const frame={version:1,type:'director_priority',adapterEpoch:epoch,streamId:stream,
   sequence:1,payload:{playerTurnVersion:0,experimentalEnabled:true}};
 assert.equal(validateFrame(frame),true);
 assert.equal(validateFrame({...frame,payload:{playerTurnVersion:1,experimentalEnabled:false}}),true);
 assert.equal(validateFrame({...frame,payload:{playerTurnVersion:-1,experimentalEnabled:true}}),false);
 assert.equal(validateFrame({...frame,payload:{playerTurnVersion:0,experimentalEnabled:true,unrecognized:1}}),false);
});
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {IntelligenceClient} from '../src/perception/intelligenceClient.mjs';
import {CAPABILITIES,validateFrame} from '../src/perception/contracts.mjs';

test('malformed Director frame and ensuing sequence gap are diagnosed without recording payload',async()=>{
  const socket=new EventEmitter(),recorded=[];
  socket.destroyed=false;
  socket.destroy=()=>{if(socket.destroyed)return;socket.destroyed=true;socket.emit('close');};
  const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.Intelligence.v1'},{
    connect:()=>socket,telemetry:(event,data)=>recorded.push({event,data}),
    report:()=>{},now:()=>100,
  });
  const adapterEpoch=randomUUID(),streamId=randomUUID();
  const hello={
    version:1,type:'hello',adapterEpoch,streamId,
    hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1,
    observerIndexVersion:1,observerSituationVersion:1,
    primaryBehaviorOwnerVersion:1,directorRequestVersion:1,
    capabilities:Object.fromEntries(CAPABILITIES.map(key=>[key,false])),
  };
  const frame=(sequence,payload)=>({
    version:1,type:'director_priority',adapterEpoch,streamId,sequence,payload,
  });
  const send=value=>socket.emit('data',Buffer.from(JSON.stringify(value)+'\n'));
  try {
    client.start();socket.emit('connect');
    send(hello);await new Promise(resolve=>setImmediate(resolve));
    assert.ok(recorded.some(row=>row.event==='intelligence_status' && row.data.stage==='initialized'));
    // This exact invalid payload must not be relaxed just to avoid a reset.
    send(frame(1,{playerTurnVersion:-1,experimentalEnabled:true}));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(client.runtime.counters.malformed,1);
    send(frame(2,{playerTurnVersion:1,experimentalEnabled:true}));
    await new Promise(resolve=>setImmediate(resolve));
    const rejected=recorded.filter(row=>row.event==='intelligence_frame_rejected');
    assert.deepEqual(rejected.map(row=>[row.data.frameType,row.data.reason,row.data.count]),[
      ['director_priority','invalid_contract',1],
      ['director_priority','sequence_gap',1],
    ]);
    assert.ok(rejected.every(row=>Object.keys(row.data).every(key=>
      ['frameType','reason','count','frameBytes'].includes(key))));
    assert.ok(recorded.some(row=>row.event==='intelligence_status' && row.data.stage==='disconnected'));
  } finally {client.stop();}
});
