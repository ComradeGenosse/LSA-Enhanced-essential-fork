import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtagonistAuthority } from '../src/perception/protagonistAuthority.mjs';
import { readProtagonistFrame } from '../src/perception/protagonistProtocol.mjs';

const HOST='bb97a779-0da6-4314-bf89-f7ee56d5a1b4';
const OTHER='eaa839cd-4d2b-4c81-a405-424c332f81d2';
const STREAM='02a13caa-01eb-4de1-abd8-1d2cffc8fe71';
const ADAPTER='c0161e33-955a-44e1-9fdd-4050c7e9a12f';

// The source snapshot is independent of the frame under test, just as the
// accepted C-13 socket/ShadowRuntime snapshot is independent in production.
// Tests using this fixture do not simulate a full native pipe: C-13 sequence,
// renegotiation, and 60-second expiry have separate socket-backed tests.
function fixture() {
  let now=1000;
  let source={connected:true,authenticated:true,sessionToken:{},
    adapterEpoch:ADAPTER,streamId:STREAM,hostRunId:HOST,worldEpoch:1,lastSequence:0};
  const authority=createProtagonistAuthority({getNativeStream:()=>source,clock:()=>now});
  const emit=(protagonist='franklin',revision=1,options={})=>{
    const sequence=options.sequence??source.lastSequence+1;
    const frame={version:1,type:'protagonist_model',adapterEpoch:source.adapterEpoch,
      streamId:source.streamId,sequence,payload:{
        version:1,source:'native_player_model',protagonist,
        hostRunId:source.hostRunId,worldEpoch:source.worldEpoch,revision,
        ...options.payload,
      },...options.frame};
    if(options.admit!==false) source={...source,lastSequence:sequence};
    return {frame,accepted:authority.acceptAuthenticatedFrame(frame)};
  };
  return {authority,emit,advance:delta=>{now+=delta;},
    setSource:patch=>{source={...source,...patch};},
    get source(){return source;}};
}
const proof=h=>h.authority.readVerified();

test('R1.01 expiration loses current action authority, but ordered same-revision native heartbeat recovers a NEW proof',()=>{
  const h=fixture();
  assert.equal(h.emit('franklin',12).accepted,true);
  const before=proof(h);
  h.advance(1501);
  assert.equal(proof(h),null);
  assert.equal(h.authority.isCurrent(before),false);
  assert.equal(h.emit('franklin',12).accepted,true);
  const after=proof(h);
  assert.ok(after);
  assert.notStrictEqual(after,before);
  assert.ok(Object.isFrozen(after));
  assert.equal(after.revision,12);
  assert.equal(h.authority.isCurrent(before),false);
  assert.equal(h.authority.isCurrent(after),true);
});
test('R1.02 duplicated sequence, tampered source, and copied payload cannot authenticate a heartbeat',()=>{
  const h=fixture();
  assert.equal(h.emit('franklin',4).accepted,true);
  const previous=proof(h);
  assert.equal(h.authority.isCurrent({...previous}),false);
  const forged={version:1,type:'protagonist_model',adapterEpoch:ADAPTER,
    streamId:STREAM,sequence:2,payload:{...previous}};
  assert.ok(readProtagonistFrame(forged),'wire validation alone is not authority');
  assert.equal(h.authority.acceptAuthenticatedFrame(forged),false,
    'frame sequence must equal independently accepted native transport sequence');
  assert.equal(h.authority.isCurrent(previous),false);
  assert.equal(h.emit('franklin',5).accepted,true);
  const current=proof(h);
  assert.equal(h.emit('franklin',5,{sequence:h.source.lastSequence}).accepted,false,
    'equal native sequence may not replay, even with identical protagonist/revision');
  assert.equal(h.authority.isCurrent(current),false);
});
test('R1.03 no observer polls during expiry; subsequent heartbeat cannot resurrect the silently aged-out object',()=>{
  const h=fixture();
  h.emit('trevor',5);
  const old=proof(h);
  h.advance(1550); // intentionally do NOT readVerified/isCurrent before emit
  assert.equal(h.emit('trevor',5).accepted,true);
  assert.notStrictEqual(proof(h),old);
  assert.equal(h.authority.isCurrent(old),false);
});
test('R1.04 model change requires a new revision and Franklin-Michael-Franklin ABA is fenced',()=>{
  const h=fixture();
  h.emit('franklin',8);
  const first=proof(h);
  h.advance(1501);
  assert.equal(h.emit('michael',8).accepted,false);
  assert.equal(h.authority.isCurrent(first),false);
  assert.equal(h.emit('michael',9).accepted,true);
  const michael=proof(h);
  assert.equal(h.emit('franklin',10).accepted,true);
  const after=proof(h);
  assert.notStrictEqual(after,first);
  assert.equal(h.authority.isCurrent(first),false);
  assert.equal(h.authority.isCurrent(michael),false);
  assert.equal(h.emit('franklin',9).accepted,false);
});
test('R1.05 native UNKNOWN is neutral on same-revision heartbeat, known only on higher revision',()=>{
  const h=fixture();
  h.emit('franklin',20);
  const first=proof(h);
  assert.equal(h.emit('unknown',21).accepted,true);
  assert.equal(proof(h),null);
  h.advance(1501);
  assert.equal(h.emit('unknown',21).accepted,true,
    'valid UNKNOWN heartbeat is still native lineage, never a known proof');
  assert.equal(proof(h),null);
  assert.equal(h.authority.isCurrent(first),false);
  assert.equal(h.emit('trevor',21).accepted,false);
  assert.equal(h.emit('trevor',22).accepted,true);
  assert.equal(proof(h).protagonist,'trevor');
});
test('R1.06 socket/session/stream/world change or explicit revoke never resumes an equal-revision proof',()=>{
  const cases=[
    ['disconnect',h=>{h.setSource({connected:false});assert.equal(proof(h),null);h.setSource({connected:true});}],
    ['session',h=>h.setSource({sessionToken:{},lastSequence:0})],
    ['stream',h=>h.setSource({sessionToken:{},streamId:OTHER,lastSequence:0})],
    ['adapter',h=>h.setSource({sessionToken:{},adapterEpoch:OTHER,lastSequence:0})],
    ['world',h=>h.setSource({worldEpoch:2})],
    ['revocation',h=>h.authority.revoke()],
  ];
  for(const [name,mutate] of cases) {
    const h=fixture();
    h.emit('franklin',7);
    const old=proof(h);
    h.advance(1501);
    mutate(h);
    assert.equal(h.emit('franklin',7).accepted,false,name);
    assert.equal(h.authority.isCurrent(old),false,name);
    assert.equal(h.emit('franklin',8).accepted,true,name+' higher revision');
    assert.notStrictEqual(proof(h),old);
  }
  const host=fixture();
  host.emit('franklin',7);const old=proof(host);
  host.advance(1501);
  host.setSource({hostRunId:OTHER,sessionToken:{},lastSequence:0});
  assert.equal(host.emit('trevor',1).accepted,true,
    'a new native host starts a new, independent monotonic revision namespace');
  assert.equal(host.authority.isCurrent(old),false);
});
test('R1.06 source mismatch, invalid payload, regression and replay all revoke existing lineage',()=>{
  const hazards=[
    ['foreign host',{payload:{hostRunId:OTHER}}],
    ['old revision',{revision:4}],
    ['spoofed actor',{payload:{actorId:'forged'}}],
    ['unverified sequence',{admit:false}],
  ];
  for(const [name,options] of hazards) {
    const h=fixture();
    h.emit('franklin',5);const old=proof(h);
    h.advance(1501);
    const r=h.emit('franklin',options.revision??5,options);
    assert.equal(r.accepted,false,name);
    assert.equal(h.authority.isCurrent(old),false,name);
    assert.equal(h.emit('franklin',5).accepted,false,
      name+' must not recover same revision after a failed native frame');
  }
  const h=fixture();
  h.emit('franklin',5);const old=proof(h);
  h.advance(-1);
  assert.equal(h.emit('franklin',5).accepted,false,'clock regression on acceptance fails');
  h.advance(2000);
  assert.equal(h.emit('franklin',5).accepted,false);
  assert.equal(h.authority.isCurrent(old),false);
  assert.equal(h.emit('franklin',6).accepted,true);
  const x=fixture();
  x.emit('franklin',5);const previous=proof(x);
  x.advance(-1);
  assert.equal(x.authority.isCurrent(previous),false,'clock regression on read fails');
  x.advance(2000);
  assert.equal(x.emit('franklin',5).accepted,false);
});
test('R1.09 native heartbeats inside TTL preserve exact proof reference',()=>{
  const h=fixture();
  h.emit('michael',2);const first=proof(h);
  for(const elapsed of [200,400,300]) {
    h.advance(elapsed);
    assert.equal(h.emit('michael',2).accepted,true);
    assert.strictEqual(proof(h),first);
  }
  h.advance(1500);assert.strictEqual(proof(h),first,'boundary remains fresh');
  h.advance(1);assert.equal(proof(h),null);
});
