import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {IntelligenceClient} from '../src/perception/intelligenceClient.mjs';
import {CAPABILITIES} from '../src/perception/contracts.mjs';
import {createTelemetryRecord} from '../src/observability/eventContract.mjs';

const flush=()=>new Promise(resolve=>setImmediate(()=>setImmediate(resolve)));
function fixture() {
  let now=100;
  const sockets=[],records=[];
  const connect=()=>{
    const socket=new EventEmitter();
    socket.destroyed=false;
    socket.write=()=>true;
    socket.destroy=()=>{if(socket.destroyed)return;socket.destroyed=true;socket.emit('close');};
    sockets.push(socket);
    return socket;
  };
  const hostRunId=randomUUID();
  const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.276.Test'},{
    now:()=>now,connect,telemetry:(event,data)=>records.push({event,data}),
    report:()=>{}
  });
  function hello(socket, streamId=randomUUID(), worldEpoch=1) {
    const frame={version:1,type:'hello',adapterEpoch:randomUUID(),
      streamId,hostContextVersion:1,hostRunId,worldEpoch,
      observerIndexVersion:1,memoryCurrentOwnerPlayerVersion:1,
      observerSituationVersion:1,primaryBehaviorOwnerVersion:1,
      directorRequestVersion:1,
      capabilities:Object.fromEntries(CAPABILITIES.map(x=>[x,false]))};
    socket.emit('connect');
    socket.emit('data',Buffer.from(JSON.stringify(frame)+'\n'));
    return frame;
  }
  const status=stage=>records.filter(r=>r.event==='intelligence_status' && r.data.stage===stage);
  return {client,sockets,records,hello,status,now:()=>now,time:value=>{now=value;},flush};
}

test('#276: short GTA pause is logged as owner stall then recovery, not a disconnect',async()=>{
  const f=fixture();
  try {
    f.client.start();const sock=f.sockets[0],frame=f.hello(sock);
    await f.flush();f.time(1900);f.client.runtime.expire();
    assert.equal(f.status('owner_stalled').length,1);
    assert.equal(f.status('owner_stalled')[0].data.reason,'unverified');
    assert.equal(f.client.runtime.hostContext.hostRunId,frame.hostRunId);
    sock.emit('data',Buffer.from(JSON.stringify({
      version:1,type:'anchors',adapterEpoch:frame.adapterEpoch,streamId:frame.streamId,
      sequence:1,payload:[]
    })+'\n'));
    await f.flush();
    assert.equal(f.status('owner_resumed').length,1);
    assert.equal(f.client.runtime.epoch,frame.adapterEpoch);
    assert.equal(f.status('disconnected').length,0);
    assert.equal(f.client.runtime.resetDiagnostics.timeouts,0);
  }finally{f.client.stop();}
});

test('#276: extended pause expires owner proof and safely reauthenticates on fresh stream',async()=>{
  const f=fixture();
  try {
    f.client.start();const old=f.sockets[0],first=f.hello(old);
    await f.flush();f.time(3401);
    // The normal 500ms lifecycle watch observes native silence and closes
    // the existing socket, then allows a new verified hello.
    await new Promise(resolve=>setTimeout(resolve,560));
    assert.equal(old.destroyed,true);
    assert.equal(f.status('owner_timeout').length,1);
    assert.equal(f.status('owner_timeout')[0].data.reason,'source_silence');
    assert.equal(f.status('disconnected').at(-1).data.reason,'source_silence');
    assert.equal(f.client.runtime.epoch,null);
    assert.equal(f.client.getNativeStream().authenticated,false);
    f.client.start();const next=f.sockets.at(-1);
    const second=f.hello(next);await f.flush();
    assert.equal(second.hostRunId,first.hostRunId);
    assert.equal(second.worldEpoch,first.worldEpoch);
    assert.notEqual(second.streamId,first.streamId);
    assert.equal(f.client.getNativeStream().authenticated,true);
    assert.equal(f.client.runtime.anchors.size,0);
    assert.equal(f.client.runtime.resetDiagnostics.timeouts,1);
  }finally{f.client.stop();}
});

test('#276: genuine transport failure is distinct from intentional host shutdown',async()=>{
  const f=fixture();
  try {
    f.client.start();const sock=f.sockets[0];f.hello(sock);
    await f.flush();
    sock.emit('error',Object.assign(new Error('private pipe name must not be logged'),{code:'ECONNRESET'}));
    sock.destroy();
    assert.equal(f.status('disconnected').at(-1).data.reason,'econnreset');
    assert.equal(f.records.some(e=>JSON.stringify(e).includes('private pipe name')),false);
    f.client.start();f.hello(f.sockets.at(-1));await f.flush();
    assert.equal(f.client.getNativeStream().authenticated,true);
  }finally{
    f.client.stop();
    assert.equal(f.status('disconnected').at(-1).data.reason,'session_closed');
  }
});

test('#276: bounded telemetry persists lifecycle cause and native epoch fields',()=>{
  const record=createTelemetryRecord({
    sequence:1,runId:randomUUID(),originMs:0,now:12,
    utc:'2026-10-18T19:22:50.000Z',event:'intelligence_status',
    data:{stage:'owner_timeout',reason:'source_silence',durationMs:3123,
      hostRunId:randomUUID(),worldEpoch:4,
      secret:'not_logged'}
  });
  assert.equal(record.data.reason,'source_silence');
  assert.equal(record.data.durationMs,3123);
  assert.equal(record.data.worldEpoch,4);
  assert.equal('secret' in record.data,false);
});
