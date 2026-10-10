import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {IntelligenceClient} from '../src/perception/intelligenceClient.mjs';
import {CAPABILITIES} from '../src/perception/contracts.mjs';
test('factual transport notifies current retirement and disconnect state without listener faults escaping',async()=>{
 const socket=new EventEmitter();socket.destroy=()=>socket.emit('close');
 const client=new IntelligenceClient({mode:'shadow',pipeName:'offline'},{connect:()=>socket,report:()=>{}});
 const states=[];const remove=client.subscribeKnowledgeInvalidation(()=>states.push({epoch:client.runtime.epoch,anchors:client.runtime.anchors.size}));
 const removeFault=client.subscribeKnowledgeInvalidation(()=>{throw new Error('listener fault');});
 try{
  client.start();const epoch=randomUUID(),stream=randomUUID(),ref=randomUUID();let sequence=0;
  const send=async value=>{socket.emit('data',Buffer.from(JSON.stringify(value)+'\n'));await new Promise(resolve=>setImmediate(resolve));};
  await send({version:1,type:'hello',adapterEpoch:epoch,streamId:stream,capabilities:Object.fromEntries(CAPABILITIES.map(key=>[key,false]))});
  const frame=(type,payload)=>({version:1,type,adapterEpoch:epoch,streamId:stream,sequence:++sequence,payload});
  await send(frame('anchors',[{captureRef:ref,kind:'ped',observer:true,owned:false}]));assert.equal(states.at(-1).anchors,1);
  await send(frame('retire_batch',[ref]));assert.equal(states.at(-1).anchors,0);assert.equal(states.at(-1).epoch,epoch);
  client.stop();assert.equal(states.at(-1).epoch,null);
 }finally{remove();removeFault();client.stop();}
 assert.equal(client.knowledgeListeners.size,0);
});
test('invalidation subscriptions have a fixed capacity and teardown restores admission',()=>{
 const client=new IntelligenceClient({mode:'off'},{report:()=>{}}),remove=[];
 for(let index=0;index<32;index++)remove.push(client.subscribeKnowledgeInvalidation(()=>{}));
 assert.throws(()=>client.subscribeKnowledgeInvalidation(()=>{}),/capacity/);remove.pop()();const last=client.subscribeKnowledgeInvalidation(()=>{});assert.equal(client.knowledgeListeners.size,32);last();for(const dispose of remove)dispose();assert.equal(client.knowledgeListeners.size,0);
});
