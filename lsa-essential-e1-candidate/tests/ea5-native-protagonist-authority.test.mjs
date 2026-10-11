import test from 'node:test';
import assert from 'node:assert/strict';
import { createProtagonistAuthority } from '../src/perception/protagonistAuthority.mjs';
import { readProtagonistPayload, readProtagonistFrame } from '../src/perception/protagonistProtocol.mjs';

const HOST='bb97a779-0da6-4314-bf89-f7ee56d5a1b4';
const OTHER='eaa839cd-4d2b-4c81-a405-424c332f81d2';
const STREAM='02a13caa-01eb-4de1-abd8-1d2cffc8fe71';
const ADAPTER='c0161e33-955a-44e1-9fdd-4050c7e9a12f';
function harness() {
  let now=1000;
  let source={connected:true,authenticated:true,sessionToken:{},
    adapterEpoch:ADAPTER,streamId:STREAM,hostRunId:HOST,worldEpoch:1,lastSequence:0};
  const authority=createProtagonistAuthority({getNativeStream:()=>source,clock:()=>now});
  const emit=(protagonist='franklin',revision=1,override={})=>{
    const frame={version:1,type:'protagonist_model',adapterEpoch:source.adapterEpoch,
      streamId:source.streamId,sequence:source.lastSequence+1,
      payload:{version:1,source:'native_player_model',protagonist,
        hostRunId:source.hostRunId,worldEpoch:source.worldEpoch,revision},...override};
    source={...source,lastSequence:frame.sequence};
    return {frame,result:authority.acceptAuthenticatedFrame(frame)};
  };
  return {authority,emit,get source(){return source;},setSource(value){source={...source,...value};},
    advance(n){now+=n;}};
}
test('EA5 strict versioned wire rejects injected/unknown identity and invalid source',()=>{
  const base={version:1,source:'native_player_model',protagonist:'franklin',
    hostRunId:HOST,worldEpoch:1,revision:1};
  assert.ok(readProtagonistPayload(base));
  for(const spoof of [
    {...base,protagonist:'lucia'}, {...base,revision:0},
    {...base,worldEpoch:0}, {...base,source:'actor_metadata'},
    {...base,characterName:'Franklin'}, {...base,hostRunId:'fake'},
  ])assert.equal(readProtagonistPayload(spoof),null);
  assert.equal(readProtagonistPayload({...base,protagonist:'unknown'}).protagonist,'unknown');
  assert.equal(readProtagonistFrame({version:1,type:'protagonist_model',adapterEpoch:ADAPTER,
    streamId:STREAM,sequence:0,payload:base}),null);
});
test('EA5 isCurrent authenticates frozen same-object source record, not JSON clone',()=>{
  const h=harness(),{authority}=h;
  assert.equal(authority.readVerified(),null);
  assert.equal(h.emit().result,true);
  const proof=authority.readVerified();
  assert.equal(proof.protagonist,'franklin');
  assert.deepEqual(Object.keys(proof).sort(),['hostRunId','protagonist','revision','source','version','worldEpoch']);
  assert.ok(Object.isFrozen(proof));
  assert.equal(authority.isCurrent(proof),true);
  assert.equal(authority.isCurrent({...proof}),false);
  assert.equal(authority.isCurrent(structuredClone(proof)),false);
  h.advance(200);
  assert.equal(h.emit('franklin',1).result,true);
  assert.equal(authority.readVerified(),proof,'bounded ordered heartbeat retains proof reference');
  h.advance(1501);
  assert.equal(authority.readVerified(),null);
  assert.equal(authority.isCurrent(proof),false);
});
test('EA5 ABA Franklin-Michael-Franklin never resurrects first record',()=>{
  const h=harness();
  h.emit('franklin',7);const first=h.authority.readVerified();
  h.emit('michael',8);const michael=h.authority.readVerified();
  h.emit('franklin',9);const after=h.authority.readVerified();
  assert.ok(after && michael);
  assert.equal(after.protagonist,'franklin');
  assert.equal(after.revision,9);
  assert.equal(h.authority.isCurrent(first),false);
  assert.equal(h.authority.isCurrent(michael),false);
  assert.equal(h.authority.isCurrent(after),true);
  assert.equal(h.emit('franklin',8).result,false);
  assert.equal(h.authority.readVerified(),null);
});
test('EA5 real unknown native frame revokes, then new revision restores',()=>{
  const h=harness();h.emit('trevor',20);
  const old=h.authority.readVerified();
  assert.equal(h.emit('unknown',21).result,true);
  assert.equal(h.authority.readVerified(),null);
  assert.equal(h.authority.isCurrent(old),false);
  assert.equal(h.emit('trevor',21).result,false);
  assert.equal(h.emit('trevor',22).result,true);
  assert.equal(h.authority.readVerified().revision,22);
});
test('EA5 wrong host, wrong epoch, unsequenced and forged channel frames deny',()=>{
  const h=harness();
  h.emit('michael',4);
  const old=h.authority.readVerified();
  const fake={version:1,type:'protagonist_model',adapterEpoch:ADAPTER,streamId:STREAM,
    sequence:500,payload:{version:1,source:'native_player_model',protagonist:'franklin',
      hostRunId:OTHER,worldEpoch:1,revision:5}};
  assert.equal(h.authority.acceptAuthenticatedFrame(fake),false);
  assert.equal(h.authority.isCurrent(old),false);
  assert.equal(h.emit('michael',5).result,true,'genuine next native frame can restore');
  assert.equal(h.emit('michael',4).result,false,'older revision cannot replay');
  assert.equal(h.authority.readVerified(),null);
  assert.equal(h.emit('michael',6).result,true);
  h.setSource({worldEpoch:2});
  assert.equal(h.authority.readVerified(),null,'epoch rollover revokes immediately');
  assert.equal(h.emit('michael',7).result,true,'new epoch uses higher revision');
});
test('EA5 stream replacement, disconnect, host replacement and wrong token',()=>{
  const h=harness();
  h.emit('franklin',1);const old=h.authority.readVerified();
  h.setSource({connected:false});
  assert.equal(h.authority.isCurrent(old),false);
  h.setSource({connected:true,sessionToken:{},streamId:OTHER,lastSequence:0});
  assert.equal(h.emit('franklin',1).result,false,'reconnect must advance native revision');
  assert.equal(h.emit('franklin',2).result,true);
  const next=h.authority.readVerified();
  assert.equal(h.authority.isCurrent(old),false);
  h.setSource({sessionToken:{}});
  assert.equal(h.authority.isCurrent(next),false,'replaced stream token revokes even when stream ID matches');
  h.setSource({hostRunId:OTHER,streamId:STREAM,sessionToken:{},lastSequence:0});
  assert.equal(h.emit('trevor',1).result,true,'new native host is a distinct revision namespace');
  assert.equal(h.authority.readVerified().protagonist,'trevor');
});
test('EA5 revoked connection and clock rollback do not reuse stale record',()=>{
  const h=harness();h.emit('franklin',1);const record=h.authority.readVerified();
  h.advance(-1);assert.equal(h.authority.isCurrent(record),false);
  h.advance(10);h.emit('michael',2);const newRecord=h.authority.readVerified();
  h.authority.revoke();assert.equal(h.authority.isCurrent(newRecord),false);
  h.setSource({authenticated:false});
  assert.equal(h.emit('michael',3).result,false);
  assert.equal(h.authority.readVerified(),null);
});
