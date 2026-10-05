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
test('intelligence telemetry reports connection initialization and disconnection without changing the factual channel',async()=>{
  const events=[];const socket=new EventEmitter();socket.destroy=()=>{if(socket.closed)return;socket.closed=true;socket.emit('close');};socket.write=()=>{throw new Error('factual client must not send commands');};
  const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.Test.Intelligence'},{connect:()=>socket,telemetry:(event,data)=>events.push({event,data})});
  const hello={version:1,type:'hello',adapterEpoch:randomUUID(),streamId:randomUUID(),capabilities:Object.fromEntries(CAPABILITIES.map(k=>[k,k==='state']))};
  try {
    client.start();socket.emit('connect');socket.emit('data',Buffer.from(JSON.stringify(hello)+'\n'));await wait();
    assert.equal(client.runtime.epoch,hello.adapterEpoch);
    socket.destroy();
    assert.deepEqual(events.filter(entry=>entry.event==='intelligence_status').map(entry=>entry.data.stage),['connecting','connected','initialized','disconnected']);
    const final=events.find(entry=>entry.event==='companion_shadow');
    assert.ok(final);assert.equal(final.data.finalSnapshot,true);assert.equal(final.data.resetInitializations,1);
    assert.ok(events.indexOf(final)<events.findIndex(entry=>entry.event==='intelligence_status'&&entry.data.stage==='disconnected'));
  } finally {client.stop();}
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
test('native-style demotion-before-promotion frames keep 16-observer roster valid through Q to R to Q',async()=>{
  const f=clientFixture();let sequence=0;const sendAnchors=payload=>f.send({version:1,type:'anchors',adapterEpoch:f.hello.adapterEpoch,streamId:f.hello.streamId,sequence:++sequence,payload});
  const refs=Array.from({length:18},()=>randomUUID()),promoted=refs.slice(0,16),q=refs[16],r=refs[17];
  const ped=(captureRef,observer,conversation=false,owned=true)=>({captureRef,kind:'ped',observer,conversation,owned});
  try {
    f.send(f.hello);await wait();
    sendAnchors([...promoted.map(ref=>ped(ref,true)),ped(q,false,false,false),ped(r,false,false,false)]);await wait();
    assert.equal([...f.client.runtime.anchors.values()].filter(a=>a.observer).length,16);
    const p=promoted[15];
    // IntelligenceIntegration emits the observer demotion phase before promotions.
    sendAnchors([ped(p,false)]);sendAnchors([ped(q,true,true,false)]);await wait();
    let runtime=f.client.runtime;
    assert.equal(runtime.epoch,f.hello.adapterEpoch);assert.equal(runtime.stream,f.hello.streamId);
    assert.equal(runtime.anchors.size,18);assert.equal([...runtime.anchors.values()].filter(a=>a.observer).length,16);
    assert.equal(runtime.anchors.get(p).observer,false);assert.equal(runtime.anchors.has(p),true);
    assert.equal(runtime.anchors.get(q).observer,true);assert.equal(runtime.anchors.get(q).conversation,true);
    assert.equal(promoted.includes(p),true);
    sendAnchors([ped(q,false,false,false)]);sendAnchors([ped(r,true,true,false)]);await wait();
    runtime=f.client.runtime;assert.equal(runtime.epoch,f.hello.adapterEpoch);assert.equal([...runtime.anchors.values()].filter(a=>a.observer).length,16);
    assert.equal(runtime.anchors.get(q).conversation,false);assert.equal(runtime.anchors.get(r).conversation,true);
    sendAnchors([ped(r,false,false,false)]);sendAnchors([ped(q,true,true,false)]);await wait();
    runtime=f.client.runtime;assert.equal(runtime.epoch,f.hello.adapterEpoch);assert.equal([...runtime.anchors.values()].filter(a=>a.observer).length,16);
    assert.equal(runtime.anchors.get(q).captureRef,q);assert.equal(runtime.anchors.get(q).conversation,true);
    assert.equal(runtime.anchors.get(r).observer,false);assert.equal(runtime.anchors.get(r).conversation,false);
    assert.equal([...runtime.anchors.values()].filter(a=>a.conversation).length,1);
  } finally {f.client.stop();}
});
test('a genuinely unpaired seventeenth observer still fails closed',async()=>{
  const f=clientFixture();let sequence=0;const sendAnchors=payload=>f.send({version:1,type:'anchors',adapterEpoch:f.hello.adapterEpoch,streamId:f.hello.streamId,sequence:++sequence,payload});
  try {
    f.send(f.hello);await wait();const refs=Array.from({length:17},()=>randomUUID());
    sendAnchors(refs.slice(0,16).map(captureRef=>({captureRef,kind:'ped',observer:true})));await wait();assert.equal(f.client.runtime.anchors.size,16);
    sendAnchors([{captureRef:refs[16],kind:'ped',observer:true}]);await wait();
    assert.equal(f.socket.closed,true);assert.equal(f.client.runtime.epoch,null);assert.equal(f.client.runtime.anchors.size,0);
  } finally {f.client.stop();}
});
test('PS0 episode primitive has bounded revisions/open capacity/expiry without correlation',()=>{
  let now=0;const ref=randomUUID();const store=new EpisodeStore({now:()=>now,current:r=>r===ref});
  const episode=()=>({version:1,episodeId:randomUUID(),revision:1,nativeRun:randomUUID(),gameTick:1,expiresAtMonotonicMs:30000,status:'open',participants:[{captureRef:ref,kind:'ped'}],claims:[{claimId:randomUUID(),kind:'injured',certainty:'supported',evidence:{channel:'self',basis:'sampled_state',sampledGameTick:1}}],producerSequences:[{producer:'state',sequence:1}]});
  const e=episode();assert.equal(store.put(e),true);assert.equal(store.put(e),false);assert.equal(store.put({...e,revision:2}),true);
  for(let i=1;i<64;i++) assert.equal(store.put(episode()),true);assert.equal(store.put(episode()),false);
  now=30001;store.expire();assert.equal(store.entries.size,0);store.clear();
});
