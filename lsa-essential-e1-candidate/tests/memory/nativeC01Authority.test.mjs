import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeMemoryAuthority} from '../../src/memory/nativeMemoryAuthority.mjs';

// These are PRIVATE validated-transport contract fixtures. The pinned native
// ABI does not produce any original C-01 accepted callback in GTA.
const RUN='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STREAM='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STREAM2='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ADAPTER='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CHAR_A='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CHAR_B='22222222-2222-4222-8222-222222222222';
const ALIAS_A='promoted.33333333-3333-4333-8333-333333333333';
const ALIAS_B='promoted.44444444-4444-4444-8444-444444444444';
const REF_A='55555555-5555-4555-8555-555555555555';
const REF_B='66666666-6666-4666-8666-666666666666';
const PLAYER='77777777-7777-4777-8777-777777777777';
const INC_A='88888888-8888-4888-8888-888888888888';
const INC_B='99999999-9999-4999-8999-999999999999';
const ENC_A='12121212-1212-4212-8212-121212121212';
const ENC_B='13131313-1313-4313-8313-131313131313';
const source='original_essential_c01_normal_accepted_callback';
const a={ownerAlias:ALIAS_A,hostRunId:RUN,worldEpoch:1,
  observerCaptureRef:REF_A,incarnationId:INC_A,encounterId:ENC_A,
  sampledGameTick:123};
const b={ownerAlias:ALIAS_B,hostRunId:RUN,worldEpoch:1,
  observerCaptureRef:REF_B,incarnationId:INC_B,encounterId:ENC_B,
  sampledGameTick:123};
const proof=o=>Object.fromEntries(
  ['hostRunId','worldEpoch','observerCaptureRef','incarnationId','encounterId','ownerAlias']
  .map(k=>[k,o[k]]));
const identity={pedId:'101',turnId:'normal-player-1',generationId:7,sessionNonce:2};
function fixture(){
  let ownerCb=()=>{},c01Cb=()=>{},retire1=()=>{},retire2=()=>{};
  let seq=0,stream=STREAM,wall=100,epoch=1,tick=123;
  const profiles=new Map([
    [ALIAS_A,{characterId:CHAR_A,promotion:{ownerAlias:ALIAS_A},status:'available',timelineWritable:true}],
    [ALIAS_B,{characterId:CHAR_B,promotion:{ownerAlias:ALIAS_B},status:'available',timelineWritable:true}]
  ]);
  const native=createNativeMemoryAuthority({
    subscribeAuthenticatedNativeFrames:(cb,retire)=>{
      ownerCb=cb;retire1=retire;return ()=>{};
    },
    subscribeAuthenticatedOriginalC01Frames:(cb,retire)=>{
      c01Cb=cb;retire2=retire;return ()=>{};
    },
    profileForAlias:x=>profiles.get(x),now:()=>wall,maxAgeMs:1000
  });
  const player=(key='franklin',sampledGameTick=tick)=>({
    source:'native_player_model',key,playerCaptureRef:PLAYER,sampledGameTick
  });
  function publish({owners=[a,b],key='franklin',acceptedTurns=[],
    sampledGameTick=tick}={}){
    ownerCb({frame:{version:1,type:'memory_authority',streamId:stream,
      adapterEpoch:ADAPTER,sequence:++seq,payload:{
        memoryProofVersion:1,hostRunId:RUN,worldEpoch:epoch,
        sampledGameTick,owners,protagonist:player(key,sampledGameTick),
        acceptedTurns}}});
  }
  function accept(o=a,overrides={}){
    const acceptedGameTick=tick;
    const p={
      c01ProofVersion:2,source,status:'accepted',sourceMode:'typed',
      hostRunId:RUN,worldEpoch:epoch,
      acceptedGameTick,expiresGameTick:acceptedGameTick+500,
      identity:{...identity},nativeOwnerPedId:identity.pedId,
      ownerProof:proof(o),protagonist:player('franklin',acceptedGameTick),
      ...overrides
    };
    c01Cb({frame:{version:2,type:'memory_c01_accepted',streamId:stream,
      adapterEpoch:ADAPTER,sequence:++seq,payload:p}});
  }
  const query=(o=a,id=identity)=>({
    identity:id,characterId:o===a?CHAR_A:CHAR_B,ownerAlias:o.ownerAlias,
    hostRunId:RUN,worldEpoch:epoch,adapterEpoch:ADAPTER
  });
  return {native,publish,accept,query,profiles,player,
    setWall:x=>wall=x,setTick:x=>tick=x,
    restart:()=>{stream=STREAM2;seq=0;},
    setEpoch:x=>epoch=x,retire:()=>{retire1();retire2();},
    delayed:(f)=>c01Cb({frame:f})};
}
test('pinned v1 is not source authority, even if spoofed acceptedTurns are present',()=>{
  const h=fixture();h.publish();assert.equal(h.native.verifyCurrentTurn(h.query()),null);
  h.publish({acceptedTurns:[{source,status:'accepted'}]});
  assert.equal(h.native.status().connected,false);
  assert.equal(h.native.verifyCurrentTurn({...h.query(),nativeVerified:true}),null);
});
for(const key of ['franklin','michael','trevor','unknown']){
  test('contract v2 preserves verified protagonist '+key+' without guessing',()=>{
    const h=fixture();h.publish({key});
    h.accept(a,{protagonist:h.player(key)});
    const granted=h.native.verifyCurrentTurn(h.query());
    assert.equal(granted?.protagonistKey,key);
    assert.deepEqual(granted.identity,identity);
    assert.equal(granted.originalSource,source);
    assert.ok(Object.isFrozen(granted.ownerProof));
    assert.equal(h.native.verifyCurrentTurn({...h.query(),protagonistKey:'franklin'})
      ?.protagonistKey,key==='franklin'?'franklin':undefined);
  });
}
test('generation, session nonce, ped ID, owner and chronology are immutable',()=>{
  const h=fixture();h.publish();h.accept();
  assert.equal(h.native.verifyCurrentTurn({...h.query(),identity:{...identity,generationId:8}}),null);
  assert.equal(h.native.verifyCurrentTurn({...h.query(),identity:{...identity,sessionNonce:3}}),null);
  assert.equal(h.native.verifyCurrentTurn({...h.query(),identity:{...identity,pedId:'102'}}),null);
  assert.equal(h.native.verifyCurrentTurn({...h.query(),characterId:CHAR_B}),null);
  assert.equal(h.native.verifyCurrentTurn({...h.query(),ownerAlias:ALIAS_B}),null);
  assert.equal(h.native.verifyCurrentTurn(h.query(b)),null);
  h.accept(b,{identity:{...identity,turnId:'normal-player-2'}});
  assert.equal(h.native.verifyCurrentTurn(h.query()),null);
  assert.equal(h.native.verifyCurrentTurn(h.query(b,{...identity,turnId:'normal-player-2'}))?.characterId,CHAR_B);
});
test('original-source tuple cannot be replaced by transcript, stock Director, or false flag',()=>{
  for(const mutation of [
    {source:'director_stock_turn_binding'},
    {source:'js_dialogue_history'},
    {sourceMode:'guessed_transcript'},
    {status:'reserved'},
    {nativeOwnerPedId:'999'},
    {identity:{...identity,sessionNonce:0}},
    {identity:{...identity,generationId:'7'}},
    {expiresGameTick:1124},
    {acceptedGameTick:122},
    {protagonist:{source:'model_output',key:'franklin',playerCaptureRef:PLAYER,sampledGameTick:123}},
    {ownerProof:{...proof(a),incarnationId:INC_B}},
    {ownerProof:{...proof(a),encounterId:ENC_B}},
    {ownerProof:{...proof(a),ownerAlias:ALIAS_B}},
    {extra:'unrecognized'}
  ]) {
    const h=fixture();h.publish();h.accept(a,mutation);
    assert.equal(h.native.verifyCurrentTurn(h.query()),null,JSON.stringify(mutation));
  }
});
test('turn expires, owner recycling and protagonist switch revoke without revival',()=>{
  const h=fixture();h.publish();h.accept();
  assert.ok(h.native.verifyCurrentTurn(h.query()));
  h.setTick(124);h.publish({sampledGameTick:124});
  assert.ok(h.native.verifyCurrentTurn(h.query()));
  h.setWall(1101);
  assert.equal(h.native.verifyCurrentTurn(h.query()),null);
  const x=fixture();x.publish();x.accept();
  x.publish({key:'trevor'});
  assert.equal(x.native.verifyCurrentTurn(x.query()),null);
  x.publish({key:'franklin'});
  assert.equal(x.native.verifyCurrentTurn(x.query()),null);
  const z=fixture();z.publish();z.accept();
  z.publish({owners:[{...a,incarnationId:INC_B},b]});
  assert.equal(z.native.verifyCurrentTurn(z.query()),null);
});
test('disconnection, new stream, replay and timeline suspension refuse stale proof',()=>{
  const h=fixture();h.publish();h.accept();
  h.retire();
  assert.equal(h.native.verifyCurrentTurn(h.query()),null);
  h.restart();h.publish();
  assert.equal(h.native.verifyCurrentTurn(h.query()),null);
  h.accept();
  assert.ok(h.native.verifyCurrentTurn(h.query()));
  h.profiles.set(ALIAS_A,{...h.profiles.get(ALIAS_A),timelineWritable:false});
  assert.equal(h.native.verifyCurrentTurn(h.query()),null);
});
test('bad native ordering fails closed and cannot be reactivated without new proof',()=>{
  const h=fixture();h.publish();h.accept();
  const outOfOrder={version:2,type:'memory_c01_accepted',streamId:STREAM,
    adapterEpoch:ADAPTER,sequence:1,payload:{}};
  h.delayed(outOfOrder);
  assert.equal(h.native.verifyCurrentTurn(h.query()),null);
  h.publish();assert.equal(h.native.verifyCurrentTurn(h.query()),null);
});
