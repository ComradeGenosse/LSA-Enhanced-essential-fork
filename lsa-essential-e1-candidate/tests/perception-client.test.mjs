import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { IntelligenceClient } from '../src/perception/intelligenceClient.mjs';
import { CAPABILITIES } from '../src/perception/contracts.mjs';
import { EpisodeStore } from '../src/perception/episodeStore.mjs';
const wait=()=>new Promise(resolve=>setImmediate(()=>setImmediate(resolve)));
function clientFixture() {
  let connects=0;const socket=new EventEmitter();socket.destroy=()=>{if(socket.closed)return;socket.closed=true;socket.emit('close');};socket.write=()=>{throw new Error('factual client must not send commands');};
  const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.Test.Intelligence'},{connect:options=>{connects++;assert.equal(options.path,'\\\\.\\pipe\\LSA.Test.Intelligence');return socket;}});client.start();
  const hello={version:1,type:'hello',adapterEpoch:randomUUID(),streamId:randomUUID(),capabilities:Object.fromEntries(CAPABILITIES.map(k=>[k,k==='state']))};
  return {client,socket,hello,connects:()=>connects,send:value=>socket.emit('data',Buffer.from(JSON.stringify(value)+'\n'))};
}
test('factual client accepts fragmented bounded native frames without writing commands',async()=>{
  const f=clientFixture();try {const text=JSON.stringify(f.hello)+'\n';f.socket.emit('data',Buffer.from(text.slice(0,20)));f.socket.emit('data',Buffer.from(text.slice(20)));await wait();assert.equal(f.client.runtime.epoch,f.hello.adapterEpoch);assert.equal(f.connects(),1);}finally{f.client.stop();}
});
test('malformed JSON, missing hello and oversized partial frames disconnect and reset',async()=>{
  for(const input of ['{broken}\n',JSON.stringify({version:1,type:'retire'})+'\n','x'.repeat(8193)]) {
    const f=clientFixture();try {f.socket.emit('data',Buffer.from(input));await wait();assert.equal(f.socket.closed,true);assert.equal(f.client.runtime.epoch,null);}finally{f.client.stop();}
  }
});
test('a coalesced chunk is processed by frame bounds; companion frame queue is capped',async()=>{
  const f=clientFixture();try {f.send(f.hello);await wait();const frames=Array.from({length:257},(_,i)=>JSON.stringify({version:1,type:'retire_batch',adapterEpoch:f.hello.adapterEpoch,streamId:f.hello.streamId,sequence:i+1,payload:[]})+'\n').join('');f.socket.emit('data',Buffer.from(frames));assert.equal(f.socket.closed,true);assert.equal(f.client.runtime.epoch,null);}finally{f.client.stop();}
});
test('connection loss clears anchors before reconnection; off client never connects',async()=>{
  const f=clientFixture();try {f.send(f.hello);await wait();f.send({version:1,type:'anchors',adapterEpoch:f.hello.adapterEpoch,streamId:f.hello.streamId,sequence:1,payload:[{captureRef:randomUUID(),kind:'ped',observer:true}]});await wait();assert.equal(f.client.runtime.anchors.size,1);f.socket.destroy();assert.equal(f.client.runtime.anchors.size,0);}finally{f.client.stop();}
  const off=new IntelligenceClient({mode:'off'},{connect:()=>{throw new Error('off must not connect');}});off.start();off.stop();
});
test('PS0 episode primitive has bounded revisions/open capacity/expiry without correlation',()=>{
  let now=0;const ref=randomUUID();const store=new EpisodeStore({now:()=>now,current:r=>r===ref});
  const episode=()=>({version:1,episodeId:randomUUID(),revision:1,nativeRun:randomUUID(),gameTick:1,expiresAtMonotonicMs:30000,status:'open',participants:[{captureRef:ref,kind:'ped'}],claims:[{claimId:randomUUID(),kind:'injured',certainty:'supported',evidence:{channel:'self',basis:'sampled_state',sampledGameTick:1}}],producerSequences:[{producer:'state',sequence:1}]});
  const e=episode();assert.equal(store.put(e),true);assert.equal(store.put(e),false);assert.equal(store.put({...e,revision:2}),true);
  for(let i=1;i<64;i++) assert.equal(store.put(episode()),true);assert.equal(store.put(episode()),false);
  now=30001;store.expire();assert.equal(store.entries.size,0);store.clear();
});
