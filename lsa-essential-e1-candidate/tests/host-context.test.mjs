import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readHostContext, validateHostEnvelope, sameHostContext } from '../src/context/hostContext.mjs';
import { ShadowRuntime } from '../src/perception/shadowRuntime.mjs';
import { CAPABILITIES, validateFrame as validatePS } from '../src/perception/contracts.mjs';
import { ActivityClient } from '../src/activities/activityClient.mjs';
import { ActivityEngine } from '../src/activities/activityEngine.mjs';
import { CAPABILITY_IDS, LIMITS, validateFrame as validateACT } from '../src/activities/contracts.mjs';
import { ACTIVITY_CAPABILITIES_SHA256 } from '../src/activities/capabilityRegistry.mjs';
import { OwnerEvidence } from '../src/identity/ownerEvidence.mjs';
import { normalizeIdentityConfig } from '../src/identity/identityContract.mjs';
import { claim, worldProfileId } from './identity-fixtures.mjs';

const context=()=>({hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1});
const psHello=()=>({version:1,type:'hello',adapterEpoch:randomUUID(),streamId:randomUUID(),capabilities:Object.fromEntries(CAPABILITIES.map(k=>[k,k==='shooting']))});
const actHello=()=>({version:1,type:'hello',nativeRun:randomUUID(),adapterEpoch:randomUUID(),contractSha256:ACTIVITY_CAPABILITIES_SHA256,capabilities:Object.fromEntries(CAPABILITY_IDS.map(k=>[k,false])),limits:{...LIMITS}});
const step=()=>new Promise(resolve=>setImmediate(resolve));

test('C-13 accepts only a complete closed extension; legacy carries no host authority',()=>{
  const value={type:'hello',...context()};
  assert.equal(validateHostEnvelope({type:'hello'},['type']),true);
  assert.equal(readHostContext({type:'hello'}),null);
  assert.equal(validateHostEnvelope(value,['type']),true);
  for(const field of ['hostContextVersion','hostRunId','worldEpoch']) {
    const missing={...value};delete missing[field];assert.equal(validateHostEnvelope(missing,['type']),false);
  }
  for(const patch of [{hostContextVersion:2},{worldEpoch:0},{worldEpoch:1.5},{worldEpoch:0x80000000},{hostRunId:'ped-1'},{extra:true}])
    assert.equal(validateHostEnvelope({...value,...patch},['type']),false);
  assert.equal(sameHostContext(value,{...value}),true);
  assert.equal(sameHostContext(value,{...value,worldEpoch:2}),false);
  assert.equal(sameHostContext(value,{...value,hostRunId:randomUUID()}),false);
  assert.equal(sameHostContext(null,null),false);
});

test('PS reset clears observer knowledge and grants while preserving the ordered stream',()=>{
  const runtime=new ShadowRuntime({mode:'shadow',now:()=>10}),hello={...psHello(),...context()},ped=randomUUID();
  const ingest=value=>runtime.ingest(value,{authenticated:true});
  const frame=(sequence,type,payload)=>({version:1,type,adapterEpoch:hello.adapterEpoch,streamId:hello.streamId,sequence,payload});
  assert.equal(ingest(hello),true);
  assert.equal(ingest(frame(1,'anchors',[{captureRef:ped,kind:'ped',observer:true}])),true);
  assert.equal(ingest(frame(2,'signal',{signalId:randomUUID(),producer:'shooting',producerSequence:1,kind:'firing',target:null,source:ped,gameTick:1,ageMs:0,facts:{}})),true);
  assert.ok(runtime.observations.entries.size>0);
  assert.equal(ingest(frame(3,'world_epoch',{epoch:2,reason:'clock_regression'})),true);
  assert.equal(runtime.current(ped),false);assert.equal(runtime.signals.length,0);
  assert.equal(runtime.observations.entries.size,0);
  assert.equal(runtime.hostContext.worldEpoch,2);assert.equal(runtime.stream,hello.streamId);
  assert.equal(ingest(frame(4,'world_epoch',{epoch:2,reason:'clock_regression'})),true);
  assert.equal(ingest(frame(5,'anchors',[{captureRef:randomUUID(),kind:'ped',observer:true}])),true);
  assert.equal(ingest(frame(6,'world_epoch',{epoch:1,reason:'clock_regression'})),false);
  assert.equal(runtime.hostContext,null);assert.equal(runtime.epoch,null);
});

test('a legacy PS peer cannot turn a reset fact into inferred host authority',()=>{
  const runtime=new ShadowRuntime({mode:'shadow'}),hello=psHello();runtime.ingest(hello,{authenticated:true});
  assert.equal(runtime.ingest({version:1,type:'world_epoch',adapterEpoch:hello.adapterEpoch,streamId:hello.streamId,sequence:1,payload:{epoch:2,reason:'timeline_change'}},{authenticated:true}),false);
  assert.equal(runtime.epoch,null);
  for(const patch of [{hostContextVersion:3},{worldEpoch:0},{hostRunId:undefined}]) assert.equal(validatePS({...hello,...context(),...patch}),false);
});

test('ACT echoes the independent host context and rejects a world reset before sending more work',async t=>{
  const pipe=new EventEmitter();pipe.writes=[];pipe.write=line=>pipe.writes.push(JSON.parse(line));
  let closed=false;pipe.destroy=()=>{if(!closed){closed=true;pipe.emit('close');}};
  const seen=[];const client=new ActivityClient({mode:'on',pipeName:'offline'}, {connect:()=>pipe,onFrame:frame=>seen.push(frame)});
  t.after(()=>client.stop());client.start();const hello={...actHello(),...context()};
  pipe.emit('data',Buffer.from(JSON.stringify(hello)+'\n'));await step();
  assert.deepEqual(readHostContext(pipe.writes[0]),readHostContext(hello));
  assert.equal(client.runtime.ready,true);
  assert.equal(validateACT({...hello,hostContextVersion:4}),false);
  pipe.emit('data',Buffer.from(JSON.stringify({version:1,type:'world_epoch',sequence:1,epoch:2,reason:'timeline_change'})+'\n'));await step();
  assert.equal(closed,true);assert.equal(client.runtime.ready,false);
  assert.equal(client.send({type:'step.query',requestId:randomUUID(),executionIds:[]}),false);
  assert.ok(seen.some(frame=>frame.type==='world_epoch'));
});

test('ACT host/world change hides earlier self facts without replaying effects',()=>{
  const commands=[],engine=new ActivityEngine({onCommand:frame=>commands.push(frame)}),hello={...actHello(),...context()},actor=randomUUID();
  engine.ingest(hello);engine.facts.record({characterId:actor,kind:'mode_established',intent:'accompany'});
  assert.equal(engine.facts.forCharacter(actor).length,1);
  engine.ingest({...hello,worldEpoch:2});assert.equal(engine.facts.forCharacter(actor).length,0);assert.equal(commands.length,0);
  engine.facts.record({characterId:actor,kind:'mode_established',intent:'accompany'});
  engine.ingest({type:'world_epoch',epoch:3,reason:'clock_regression'});
  assert.equal(engine.facts.forCharacter(actor).length,0);assert.equal(engine.hello,null);assert.equal(commands.length,0);
});

test('P1 host context comes from independent pipe hello and disappears with channel loss',async t=>{
  const proof=claim(),host=context();let socket;
  const evidence=new OwnerEvidence(normalizeIdentityConfig({enabled:true,worldProfileId,prepareTimeoutMs:100}), {platform:'win32',connect:()=>{
    socket=new EventEmitter();socket.unref=()=>{};socket.destroyed=false;
    socket.destroy=()=>{if(!socket.destroyed){socket.destroyed=true;socket.emit('close');}};
    socket.write=line=>{const request=JSON.parse(line);queueMicrotask(()=>socket.emit('data',Buffer.from(JSON.stringify({schemaVersion:1,type:'proof',adapterEpoch:proof.adapterEpoch,requestId:request.requestId,pedId:request.pedId,status:'active',claim:proof})+'\n')));};
    queueMicrotask(()=>socket.emit('data',Buffer.from(JSON.stringify({schemaVersion:1,type:'hello',adapterEpoch:proof.adapterEpoch,sourceNamespace:'comrade.authored',...host})+'\n')));return socket;
  }});
  t.after(()=>evidence.close());const result=await evidence.verify('17',proof,new AbortController().signal);
  assert.equal(result.kind,'verified');assert.deepEqual(evidence.hostContext,host);assert.equal(Object.isFrozen(evidence.hostContext),true);
  socket.destroy();assert.equal(evidence.hostContext,null);assert.equal(evidence.isCurrent(proof),false);
});
