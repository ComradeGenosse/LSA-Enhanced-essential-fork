import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { IntelligenceClient } from '../src/perception/intelligenceClient.mjs';
import { CAPABILITIES } from '../src/perception/contracts.mjs';

class Pipe extends EventEmitter {
  destroyed=false;writable=true;writableLength=0;
  destroy(){if(this.destroyed)return;this.destroyed=true;this.writable=false;this.emit('close');}
  write(){return true;}
}
const settled=()=>new Promise(resolve=>setImmediate(resolve));
function create(t,{legacy=false}={}) {
  let now=1000,sequence=0,worldEpoch=1;
  const socket=new Pipe(),adapterEpoch=randomUUID(),streamId=randomUUID(),hostRunId=randomUUID();
  const client=new IntelligenceClient({mode:'shadow',radio:'off',pipeName:'ea-a-pipe'},{
    connect:()=>socket,report:()=>{},telemetry:()=>{},now:()=>now,
  });
  t.after(()=>client.stop());
  client.start();
  const send=async frame=>{socket.emit('data',Buffer.from(JSON.stringify(frame)+'\n'));await settled();};
  const hello=async()=>{
    const msg={version:1,type:'hello',adapterEpoch,streamId,
      capabilities:Object.fromEntries(CAPABILITIES.map(key=>[key,false]))};
    if(!legacy)Object.assign(msg,{hostContextVersion:1,hostRunId,worldEpoch});
    await send(msg);
  };
  const model=async(protagonist='franklin',revision=1,patch={})=>{
    const msg={version:1,type:'protagonist_model',adapterEpoch,streamId,
      sequence:++sequence,payload:{version:1,source:'native_player_model',
        protagonist,hostRunId,worldEpoch,revision,...patch}};
    await send(msg);return msg;
  };
  const world=async(epoch,reason='timeline_change')=>{
    worldEpoch=epoch;
    await send({version:1,type:'world_epoch',adapterEpoch,streamId,
      sequence:++sequence,payload:{epoch,reason}});
  };
  return {client,socket,hello,send,model,world,adapterEpoch,streamId,hostRunId,
    tick(n){now+=n;},get sequence(){return sequence;}};
}
test('EA-A: admitted hello alone creates socket-backed stream token; no public ingress',async t=>{
  const x=create(t);
  assert.equal(x.client.getNativeStream().authenticated,false);
  assert.equal(x.client.protagonistAuthority.readVerified(),null);
  assert.equal('acceptAuthenticatedFrame' in x.client.protagonistAuthority,false);
  await x.hello();
  const s=x.client.getNativeStream();
  assert.equal(s.connected,true);assert.equal(s.authenticated,true);
  assert.ok(s.sessionToken);assert.ok(Object.isFrozen(s));
  assert.equal(s.hostRunId,x.hostRunId);assert.equal(s.lastSequence,0);
  assert.equal(x.client.protagonistAuthority.readVerified(),null);
});
test('EA-A: source-backed Franklin Michael Franklin ABA and known->unknown->Trevor',async t=>{
  const x=create(t);await x.hello();
  await x.model('franklin',1);const first=x.client.protagonistAuthority.readVerified();
  assert.equal(first?.protagonist,'franklin');
  assert.ok(Object.isFrozen(first));
  assert.equal(x.client.protagonistAuthority.isCurrent({...first}),false);
  await x.model('michael',2);const second=x.client.protagonistAuthority.readVerified();
  assert.equal(second?.protagonist,'michael');
  assert.equal(x.client.protagonistAuthority.isCurrent(first),false);
  await x.model('franklin',3);
  assert.equal(x.client.protagonistAuthority.readVerified()?.revision,3);
  assert.equal(x.client.protagonistAuthority.isCurrent(second),false);
  assert.equal(x.client.protagonistAuthority.isCurrent(first),false);
  await x.model('unknown',4);assert.equal(x.client.protagonistAuthority.readVerified(),null);
  await x.model('trevor',5);
  assert.equal(x.client.protagonistAuthority.readVerified()?.protagonist,'trevor');
});
test('EA-A: C-13 host, exact accepted world boundary and disconnect null revocation',async t=>{
  const x=create(t),contexts=[],boundaries=[];
  x.client.subscribeVerifiedHostContext(v=>contexts.push(v));
  x.client.subscribeWorldBoundary(v=>boundaries.push(v));
  await x.hello();
  assert.equal(contexts.length,1);assert.equal(contexts[0]?.hostRunId,x.hostRunId);
  await x.model('franklin',1);
  const first=x.client.protagonistAuthority.readVerified();
  await x.world(2);
  assert.equal(x.client.protagonistAuthority.isCurrent(first),false);
  assert.deepEqual(boundaries,[{reason:'timeline_change',hostRunId:x.hostRunId,
    previousEpoch:1,worldEpoch:2}]);
  assert.equal(contexts.at(-1)?.worldEpoch,2);
  await x.model('michael',2);
  assert.equal(x.client.protagonistAuthority.readVerified()?.protagonist,'michael');
  x.socket.destroy();
  assert.equal(contexts.at(-1),null);
  assert.equal(x.client.getNativeStream().authenticated,false);
  assert.equal(x.client.protagonistAuthority.readVerified(),null);
});
test('EA-A: JSON cannot authenticate itself through public runtime or read-only adapter',async t=>{
  const x=create(t);await x.hello();
  const frame={version:1,type:'protagonist_model',adapterEpoch:x.adapterEpoch,
    streamId:x.streamId,sequence:1,payload:{version:1,source:'native_player_model',
      protagonist:'franklin',hostRunId:x.hostRunId,worldEpoch:1,revision:1}};
  assert.equal(x.client.runtime.ingest(frame,{authenticated:false}),false);
  assert.equal(x.client.protagonistAuthority.readVerified(),null);
  assert.equal('acceptAuthenticatedFrame' in x.client.protagonistAuthority,false);
  assert.equal(x.client.protagonistAuthority.isCurrent(frame.payload),false);
});
test('EA-A: duplicate/reordered authenticated transport cannot renew known identity',async t=>{
  const x=create(t);await x.hello();await x.model('franklin',10);
  const proof=x.client.protagonistAuthority.readVerified();
  await x.send({version:1,type:'protagonist_model',adapterEpoch:x.adapterEpoch,
    streamId:x.streamId,sequence:1,payload:{version:1,source:'native_player_model',
      protagonist:'michael',hostRunId:x.hostRunId,worldEpoch:1,revision:11}});
  assert.equal(x.socket.destroyed,true);
  assert.equal(x.client.protagonistAuthority.isCurrent(proof),false);
});
test('EA-A: frame actor injection, foreign host and invalid epoch fail closed',async t=>{
  const x=create(t);await x.hello();await x.model('franklin',1);
  await x.model('michael',2,{actorId:'forgery'});
  assert.equal(x.socket.destroyed,true);
  assert.equal(x.client.protagonistAuthority.readVerified(),null);
  const y=create(t);await y.hello();
  await y.model('franklin',1,{hostRunId:randomUUID()});
  assert.equal(y.socket.destroyed,true);
  const z=create(t);await z.hello();
  await z.model('trevor',1,{worldEpoch:5});
  assert.equal(z.socket.destroyed,true);
});
test('EA-A: expired, revoked, stale-token and legacy contexts never authenticate',async t=>{
  const x=create(t);await x.hello();await x.model('franklin',1);
  const first=x.client.protagonistAuthority.readVerified(),token=x.client.getNativeStream().sessionToken;
  x.tick(1501);
  assert.equal(x.client.protagonistAuthority.isCurrent(first),false);
  assert.equal(x.client.protagonistAuthority.readVerified(),null);
  x.socket.destroy();
  assert.notEqual(x.client.getNativeStream().sessionToken,token);
  const old=create(t,{legacy:true});await old.hello();
  assert.equal(old.client.getNativeStream().authenticated,false);
  assert.equal(old.client.protagonistAuthority.readVerified(),null);
});
test('EA-A: native sequence gaps preserve fault reset and stream retirement',async t=>{
  const x=create(t);await x.hello();await x.model('trevor',1);
  await x.send({version:1,type:'protagonist_model',adapterEpoch:x.adapterEpoch,
    streamId:x.streamId,sequence:10,payload:{version:1,source:'native_player_model',
      protagonist:'trevor',hostRunId:x.hostRunId,worldEpoch:1,revision:1}});
  assert.equal(x.socket.destroyed,true);
  assert.ok(x.client.runtime.resetDiagnostics.faults>=1);
  assert.equal(x.client.protagonistAuthority.readVerified(),null);
});

test('EA-A: last admitted sequence excludes logically rejected native frames',async t=>{
  const x=create(t);await x.hello();await x.model('franklin',1);
  const before=x.client.getNativeStream();
  assert.equal(before.lastSequence,1);
  // Contract-valid director frame, but no negotiated native director receiver.
  // The runtime orders/processes it, yet does NOT admit the event.
  await x.send({version:1,type:'director_priority',adapterEpoch:x.adapterEpoch,
    streamId:x.streamId,sequence:2,
    payload:{playerTurnVersion:1,experimentalEnabled:false}});
  assert.equal(x.client.runtime.sequence,2);
  assert.equal(x.client.getNativeStream().lastSequence,1);
  assert.equal(x.client.protagonistAuthority.readVerified()?.protagonist,'franklin');
});

test('R1.01/R1.03 C-13 post-TTL heartbeat recovers without closing a healthy socket',async t=>{
  for(const observeExpiry of [true,false]) {
    const x=create(t);await x.hello();await x.model('franklin',7);
    const old=x.client.protagonistAuthority.readVerified();
    x.tick(1501);
    if(observeExpiry) {
      assert.equal(x.client.protagonistAuthority.readVerified(),null);
      assert.equal(x.client.protagonistAuthority.isCurrent(old),false);
    }
    await x.model('franklin',7);
    assert.equal(x.socket.destroyed,false,'legitimate equal-revision heartbeat keeps C-13 alive');
    const renewed=x.client.protagonistAuthority.readVerified();
    assert.equal(renewed?.protagonist,'franklin');
    assert.notStrictEqual(renewed,old,'a heartbeat after TTL creates a new proof');
    assert.equal(x.client.protagonistAuthority.isCurrent(old),false);
    assert.equal(x.client.protagonistAuthority.isCurrent(renewed),true);
  }
});
test('R1.04/R1.06 C-13 still rejects changed model at equal revision and out-of-order frame',async t=>{
  const mismatch=create(t);await mismatch.hello();
  await mismatch.model('franklin',3);
  mismatch.tick(1501);
  await mismatch.model('michael',3);
  assert.equal(mismatch.socket.destroyed,true,'same revision never authorizes a different model');
  const gap=create(t);await gap.hello();await gap.model('franklin',3);
  gap.tick(1501);
  await gap.send({version:1,type:'protagonist_model',
    adapterEpoch:gap.adapterEpoch,streamId:gap.streamId,sequence:gap.sequence+2,
    payload:{version:1,source:'native_player_model',protagonist:'franklin',
      hostRunId:gap.hostRunId,worldEpoch:1,revision:3}});
  assert.equal(gap.socket.destroyed,true,'the native C-13 sequence gate still rejects gaps');
});
test('R1.07 source proof cannot recover after the 60-second whole-channel reset',async t=>{
  const x=create(t);await x.hello();await x.model('franklin',1);
  const old=x.client.protagonistAuthority.readVerified();
  x.tick(60001);
  assert.equal(x.client.getNativeStream().authenticated,false);
  assert.equal(x.client.protagonistAuthority.isCurrent(old),false);
  await x.model('franklin',1);
  assert.equal(x.socket.destroyed,true,'stale C-13 session needs a fresh hello/stream');
  assert.equal(x.client.protagonistAuthority.readVerified(),null);
});
