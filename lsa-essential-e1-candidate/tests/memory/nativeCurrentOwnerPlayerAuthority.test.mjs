import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeCurrentOwnerPlayerAuthority} from '../../src/memory/nativeCurrentOwnerPlayerAuthority.mjs';

// Simulated PRIVATE post-auth-pipe port. This is a contract/adversarial
// fixture, not an original Core, named-pipe, or GTA integration receipt.
const RUN='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STREAM='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STREAM2='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ADAPTER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const A='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const B='22222222-2222-4222-8222-222222222222';
const ALIAS_A='promoted.33333333-3333-4333-8333-333333333333';
const ALIAS_B='promoted.44444444-4444-4444-8444-444444444444';
const REF_A='55555555-5555-4555-8555-555555555555';
const REF_B='66666666-6666-4666-8666-666666666666';
const PLAYER='77777777-7777-4777-8777-777777777777';
const NEW_PLAYER='14141414-1414-4414-8414-141414141414';
const INC_A='88888888-8888-4888-8888-888888888888';
const INC_B='99999999-9999-4999-8999-999999999999';
const ENC_A='12121212-1212-4212-8212-121212121212';
const ENC_B='13131313-1313-4313-8313-131313131313';
const id={pedId:'101',turnId:'turn-1',generationId:7,sessionNonce:2};
const actor=(which='a',tick=123)=>which==='a'?
  {observerCaptureRef:REF_A,incarnationId:INC_A,encounterId:ENC_A,
    ownerAlias:ALIAS_A,hostRunId:RUN,worldEpoch:1,
    nativeActorPedId:'101',sampledGameTick:tick}:
  {observerCaptureRef:REF_B,incarnationId:INC_B,encounterId:ENC_B,
    ownerAlias:ALIAS_B,hostRunId:RUN,worldEpoch:1,
    nativeActorPedId:'102',sampledGameTick:tick};
function setup() {
  let current=100,tick=123,seq=0,stream=STREAM,epoch=1,
    onFrame=()=>{},onRetire=()=>{},closed=false;
  const profiles=new Map([
    [ALIAS_A,{characterId:A,promotion:{ownerAlias:ALIAS_A},status:'available',timelineWritable:true}],
    [ALIAS_B,{characterId:B,promotion:{ownerAlias:ALIAS_B},status:'available',timelineWritable:true}]
  ]);
  const authority=createNativeCurrentOwnerPlayerAuthority({
    subscribeAuthenticatedNativeOwnerPlayerFrames:(listener,retire)=>{
      onFrame=listener;onRetire=retire;return ()=>{closed=true;};
    },
    profileForAlias:alias=>profiles.get(alias),now:()=>current,
    maxAgeMs:750,leaseMs:1000
  });
  const player=(avatar='franklin',ref=PLAYER)=>({
    source:'native_player_model',key:avatar,
    playerCaptureRef:ref,sampledGameTick:tick
  });
  function publish({owners=[actor('a',tick),actor('b',tick)],
    avatar='franklin',ref=PLAYER,payload={},frame={}}={}) {
    const data={nativeOwnerPlayerProofVersion:1,
      source:'native_p2_owner_fiber_current_only',
      hostRunId:RUN,worldEpoch:epoch,sampledGameTick:tick,
      owners,protagonist:player(avatar,ref),...payload};
    onFrame({frame:{version:1,type:'memory_current_owner_player',
      streamId:stream,adapterEpoch:ADAPTER,sequence:++seq,
      payload:data,...frame}});
  }
  const bind=(which='a',pedId=which==='a'?'101':'102')=>
    authority.bindActorAtTurnStart({pedId,
      characterId:which==='a'?A:B,ownerAlias:which==='a'?ALIAS_A:ALIAS_B});
  const verify=(lease,identity=id,owner='a')=>
    authority.verifyCurrentOwnerAndPlayer({lease,identity,
      characterId:owner==='a'?A:B,ownerAlias:owner==='a'?ALIAS_A:ALIAS_B});
  return {authority,publish,bind,verify,profiles,player,
    next:(delta=1)=>{tick+=delta;current+=delta;},
    wall:x=>{current=x;},retire:()=>onRetire(),
    stream:x=>{stream=x;seq=0;},epoch:x=>{epoch=x;},
    get closed(){return closed;}
  };
}
const live=()=>{
  const x=setup();x.publish();
  const lease=x.bind();x.next();x.publish();
  return {x,lease};
};

test('cannot claim current native source using caller flags or unbound pedId',()=>{
  const x=setup();
  assert.equal(x.bind(),null);
  assert.equal(x.authority.verifyCurrentOwnerAndPlayer({
    nativeVerified:true,identity:id,characterId:A,ownerAlias:ALIAS_A}),null);
  x.publish();
  assert.equal(x.bind('a','999'),null);
  assert.equal(x.bind('b','101'),null);
  assert.equal(x.verify(Object.freeze({kind:'native_actor_lifetime_lease_v1'})),null);
  assert.equal(x.authority.status().supportsNativeAcceptedTurn,false);
});
test('requires post-binding fresh native source and immutable actor tuple',()=>{
  const x=setup();x.publish();
  const lease=x.bind();
  assert.ok(Object.isFrozen(lease));
  assert.equal(x.verify(lease),null,'same native sample cannot attest later acceptance');
  x.next();x.publish();
  const p=x.verify(lease);
  assert.equal(p.kind,'NativeCurrentPlayerAndOwnerV1');
  assert.equal(p.nativeCurrentOwnerVerified,true);
  assert.equal(p.originalBackendAccepted,false);
  assert.equal(p.nativeActorPedId,'101');
  assert.equal(p.observerCaptureRef,REF_A);
  assert.equal(p.playerCaptureRef,PLAYER);
  assert.equal(p.avatarKey,'franklin');
  assert.equal(p.humanPlayerScope,'single_local_human');
  assert.ok(Object.isFrozen(p.identity));
  for(const identity of [
    {...id,pedId:'102'}, {...id,generationId:8},
    {...id,sessionNonce:3}, {...id,turnId:'other'}, {...id,sessionNonce:0}
  ])assert.equal(x.verify(lease,identity),null);
  assert.equal(x.verify(lease,undefined,'b'),null);
  assert.ok(x.verify(lease),'source recheck on same tuple');
  x.authority.revokeLease(lease);
  assert.equal(x.verify(lease),null);
});
test('two promoted owners never cross-attribute original actor',()=>{
  const x=setup();x.publish();const first=x.bind('a'),second=x.bind('b');
  x.next();x.publish();
  assert.equal(x.verify(first)?.characterId,A);
  assert.equal(x.verify(second,{...id,pedId:'102'},'b')?.characterId,B);
  assert.equal(x.verify(first,{...id,pedId:'102'},'b'),null);
  assert.equal(x.verify(second,id,'a'),null);
});
test('ped handle reuse with different anchor, P1 incarnation or encounter revokes lease',()=>{
  for(const patch of [
    {observerCaptureRef:REF_B},{incarnationId:INC_B},
    {encounterId:ENC_B},{ownerAlias:ALIAS_B},
    {nativeActorPedId:'102'}
  ]) {
    const x=setup();x.publish();const lease=x.bind();x.next();
    x.publish({owners:[{...actor('a',124),...patch}]});
    assert.equal(x.verify(lease),null,JSON.stringify(patch));
  }
});
test('temporary owner omission preserves healthy leases; fresh exact owner recovers but old lease never does',()=>{
  const x=setup();x.publish();
  const suspended=x.bind('a'),healthy=x.bind('b');
  x.next();x.publish({owners:[actor('b',124)]});
  assert.equal(x.verify(suspended),null);
  assert.equal(x.bind('a'),null);
  assert.ok(x.verify(healthy,{...id,pedId:'102'},'b'));
  assert.equal(x.authority.status().connected,true);
  assert.equal(x.authority.status().ownerCount,1);
  x.next();x.publish();
  assert.equal(x.verify(suspended),null,'gap is a permanent lease fence');
  assert.ok(x.verify(healthy,{...id,pedId:'102'},'b'));
  const recovered=x.bind('a');
  assert.ok(recovered,'new binding needs the freshly authenticated owner sample');
  assert.equal(x.verify(recovered),null,'recovery frame cannot also attest this turn');
  x.next();x.publish();
  assert.equal(x.verify(suspended),null,'old generation stays revoked forever');
  assert.ok(x.verify(recovered),'fresh lease plus a later sample works');
});
test('captureRef recycling after suspension is rejected, including a replay of the old lease',()=>{
  for(const change of [{incarnationId:INC_B},{encounterId:ENC_B},
    {nativeActorPedId:'102'},{ownerAlias:ALIAS_B}]) {
    const x=setup();x.publish();const stale=x.bind();x.next();
    x.publish({owners:[actor('b',124)]});
    x.next();x.publish({owners:[{...actor('a',125),...change},actor('b',125)]});
    assert.equal(x.verify(stale),null);
    assert.equal(x.bind(),null,'recycled ref cannot claim a fresh lease');
    assert.equal(x.authority.status().connected,false,'integrity fault retires stream');
  }
});
test('native actor/P2 owner alias and writable timeline rechecked synchronously',()=>{
  const {x,lease}=live();
  x.profiles.set(ALIAS_A,{...x.profiles.get(ALIAS_A),timelineWritable:false});
  assert.equal(x.verify(lease),null);
  x.profiles.set(ALIAS_A,{...x.profiles.get(ALIAS_A),timelineWritable:true,
    promotion:{ownerAlias:ALIAS_B}});
  assert.equal(x.verify(lease),null);
  x.profiles.set(ALIAS_A,{...x.profiles.get(ALIAS_A),timelineWritable:true,
    promotion:{ownerAlias:ALIAS_A},status:'retired'});
  assert.equal(x.verify(lease),null);
});
test('every avatar remains same human scope, but avatar transition retires old turn',()=>{
  for(const avatar of ['franklin','michael','trevor','unknown']){
    const x=setup();x.publish({avatar});const lease=x.bind();
    x.next();x.publish({avatar});
    const p=x.verify(lease);
    assert.equal(p?.avatarKey,avatar);
    assert.equal(p?.humanPlayerScope,'single_local_human');
    assert.equal(p?.playerCaptureRef,PLAYER);
    const other=avatar==='trevor'?'franklin':'trevor';
    x.next();x.publish({avatar:other});
    assert.equal(x.verify(lease),null);
    const fresh=x.bind();x.next();x.publish({avatar:other});
    assert.equal(x.verify(fresh)?.avatarKey,other);
  }
});
test('controlled player captureRef substitution and unknown model guess denied',()=>{
  const x=setup();x.publish();const lease=x.bind();x.next();
  x.publish({ref:NEW_PLAYER});
  assert.equal(x.verify(lease),null);
  const y=setup();y.publish({avatar:'unknown'});const original=y.bind();
  y.next();y.publish({avatar:'franklin'});
  assert.equal(y.verify(original),null);
  const z=setup();z.publish({payload:{protagonist:{
    source:'model_text',key:'franklin',playerCaptureRef:PLAYER,
    sampledGameTick:123}}});
  assert.equal(z.bind(),null);
});
test('source authentication boundary, disconnect, stream/world and replay all fail closed',()=>{
  const {x,lease}=live();
  x.retire();
  assert.equal(x.verify(lease),null);
  x.stream(STREAM2);x.next();x.publish();
  assert.equal(x.verify(lease),null);
  const fresh=x.bind();x.next();x.publish();
  assert.ok(x.verify(fresh));
  x.epoch(2);x.next();x.publish({owners:[]});
  assert.equal(x.verify(fresh),null);
  x.stream(STREAM);x.next();x.publish();
  assert.equal(x.verify(fresh),null,'retired stream replay');
  x.authority.close();
  assert.equal(x.closed,true);
});
test('sequence replay, stale native receipt, clock regression and unknown fields reject',()=>{
  const {x,lease}=live();
  x.next();x.publish({frame:{sequence:1}});
  assert.equal(x.verify(lease),null);
  const y=setup();y.publish();const l=y.bind();y.wall(851);
  assert.equal(y.verify(l),null);
  const z=setup();z.publish();const zz=z.bind();z.next();z.publish({
    payload:{nativeVerified:true}
  });assert.equal(z.verify(zz),null);
  const k=setup();k.publish();const kl=k.bind();k.next(1);
  k.publish();assert.ok(k.verify(kl));
  k.next(-2);k.publish();assert.equal(k.verify(kl),null);
});
test('backend acceptance cannot be inferred from even a positive native receipt',()=>{
  const {x,lease}=live();
  const p=x.verify(lease);
  assert.equal(p.originalBackendAccepted,false);
  assert.equal('sourceMode' in p,false);
  assert.equal('acceptedTurns' in p,false);
  assert.equal(x.authority.status().supportsNativeAcceptedTurn,false);
});
