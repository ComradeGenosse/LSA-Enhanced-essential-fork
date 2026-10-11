import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeMemoryAuthority} from '../../src/memory/nativeMemoryAuthority.mjs';

const RUN='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STREAM='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const STREAM2='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const STREAM3='ffffffff-ffff-4fff-8fff-ffffffffffff';
const EPOCH='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const A='dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const B='22222222-2222-4222-8222-222222222222';
const ALIAS_A='promoted.33333333-3333-4333-8333-333333333333';
const ALIAS_B='promoted.44444444-4444-4444-8444-444444444444';
const REF_A='55555555-5555-4555-8555-555555555555';
const REF_B='66666666-6666-4666-8666-666666666666';
const PLAYER='77777777-7777-4777-8777-777777777777';
const INC_A='88888888-8888-4888-8888-888888888888';
const INC_B='99999999-9999-4999-8999-999999999999';
const ENCOUNTER_A='12121212-1212-4212-8212-121212121212';
const ENCOUNTER_B='13131313-1313-4313-8313-131313131313';
const a={ownerAlias:ALIAS_A,hostRunId:RUN,worldEpoch:1,
  observerCaptureRef:REF_A,incarnationId:INC_A,encounterId:ENCOUNTER_A,
  sampledGameTick:123};
const b={ownerAlias:ALIAS_B,hostRunId:RUN,worldEpoch:1,
  observerCaptureRef:REF_B,incarnationId:INC_B,encounterId:ENCOUNTER_B,
  sampledGameTick:123};
const index=o=>({captureRef:o.observerCaptureRef,kind:'ped',owned:true,
  incarnationId:o.incarnationId,encounterId:o.encounterId});
const request=o=>({observerCaptureRef:o.observerCaptureRef,observerIndex:index(o),
  hostRunId:o.hostRunId,worldEpoch:o.worldEpoch,adapterEpoch:EPOCH});
function harness() {
  let listener=()=>{},boundary=()=>{},t=100,seq=0,stream=STREAM,world=1;
  let writable=true;
  const profiles=new Map([
    [ALIAS_A,{characterId:A,promotion:{ownerAlias:ALIAS_A},status:'available'}],
    [ALIAS_B,{characterId:B,promotion:{ownerAlias:ALIAS_B},status:'available'}]
  ]);
  const authority=createNativeMemoryAuthority({
    subscribeAuthenticatedNativeFrames:(cb,reset)=>{listener=cb;boundary=reset;
      return ()=>{listener=()=>{};boundary=()=>{};};},
    profileForAlias:alias=>writable?profiles.get(alias):null,now:()=>t,
    maxAgeMs:1000
  });
  const emit=({owners=[a,b],protagonist={key:'franklin',
      source:'native_player_model',sampledGameTick:123,
      playerCaptureRef:PLAYER},acceptedTurns=[],sampledGameTick=123}={})=>{
    listener({frame:{version:1,type:'memory_authority',streamId:stream,
      adapterEpoch:EPOCH,sequence:++seq,
      payload:{memoryProofVersion:1,hostRunId:RUN,worldEpoch:world,
        sampledGameTick,owners,protagonist,acceptedTurns}}});
  };
  return {authority,emit,boundary,setTime:x=>t=x,
    setWritable:x=>writable=x,setStream:x=>{stream=x;seq=0;},
    setWorld:x=>world=x,profile:profiles};
}
const identity={pedId:'f00',turnId:'turn-1',generationId:7,sessionNonce:2};
const ownerProof={ownerAlias:ALIAS_A,hostRunId:RUN,worldEpoch:1,
  observerCaptureRef:REF_A,incarnationId:INC_A,encounterId:ENCOUNTER_A};

test('no caller/nativeVerified flag can create proof; subscription alone is not proof',()=>{
  const h=harness(),v=h.authority;
  assert.equal(v.resolveNativeOwner({...request(a),nativeVerified:true}),null);
  assert.equal(v.verifyCurrentTurn({identity,characterId:A,ownerAlias:ALIAS_A,
    hostRunId:RUN,worldEpoch:1,nativeVerified:true}),null);
  assert.equal(v.resolvePrepromotion({...request(a),nativeVerified:true}),null);
  assert.equal(v.verifyNativeCoverage({certified:true,status:'did_not_witness'}),null);
  assert.equal(v.status().connected,false);
});
test('only current exact observer/native P1 alias + live P2 profile yields owner proof',()=>{
  const h=harness();h.emit();
  const p=h.authority.resolveNativeOwner(request(a));
  assert.equal(p.nativeVerified,true);
  assert.equal(p.characterId,A);
  assert.equal(p.ownerProof.incarnationId,INC_A);
  assert.ok(Object.isFrozen(p.ownerProof));
  assert.equal(h.authority.resolveNativeOwner({...request(a),observerIndex:index(b)}),null);
  assert.equal(h.authority.resolveNativeOwner({...request(a),worldEpoch:2}),null);
  assert.equal(h.authority.resolveNativeOwner({...request(a),adapterEpoch:STREAM}),null);
});
test('two promoted NPCs in the same scene have disjoint current owners and participants',()=>{
  const h=harness();h.emit();
  assert.equal(h.authority.resolveNativeOwner(request(a)).characterId,A);
  assert.equal(h.authority.resolveNativeOwner(request(b)).characterId,B);
  const p=h.authority.resolveParticipants({hostRunId:RUN,worldEpoch:1,adapterEpoch:EPOCH,
    observation:{claims:[{source:{captureRef:REF_B},target:{captureRef:PLAYER}},
      {source:{captureRef:'14141414-1414-4414-8414-141414141414'}}]}});
  assert.deepEqual(p.map(x=>[x.captureRef,x.subjectKind,x.subjectKey]),[
    [REF_B,'character',B],[PLAYER,'protagonist','franklin']]);
  assert.equal(p.some(x=>x.subjectKey===A),false);
});
test('ped handle reuse cannot rebase an old captureRef/incarnation or encounter',()=>{
  const h=harness();h.emit();
  h.emit({owners:[{...a,observerCaptureRef:REF_B,incarnationId:INC_B,
    encounterId:ENCOUNTER_B}]});
  assert.equal(h.authority.resolveNativeOwner(request(a)),null);
  assert.equal(h.authority.resolveNativeOwner({...request(a),observerCaptureRef:REF_B,
    observerIndex:index(b)}),null);
});
test('owner retirement, reconnection, epoch boundaries and delayed replay fail closed',()=>{
  const h=harness();h.emit();
  assert.equal(h.authority.resolveNativeOwner(request(a))?.characterId,A);
  h.emit({owners:[]});
  assert.equal(h.authority.resolveNativeOwner(request(a)),null);
  h.emit();h.boundary();
  assert.equal(h.authority.resolveNativeOwner(request(a)),null);
  h.setStream(STREAM2);h.emit();
  assert.equal(h.authority.resolveNativeOwner(request(a))?.characterId,A);
  h.setWorld(2);h.emit({owners:[{...a,worldEpoch:2}]});
  assert.equal(h.authority.resolveNativeOwner(request(a)),null);
  h.setStream(STREAM3);h.setWorld(1);h.emit();
  assert.equal(h.authority.resolveNativeOwner(request(a))?.characterId,A);
  h.setTime(1101);
  assert.equal(h.authority.resolveNativeOwner(request(a)),null);
});
test('protagonist changes and missing C-01 turn receipts never invent an accepted turn',()=>{
  const h=harness();h.emit();
  const req={identity,characterId:A,ownerAlias:ALIAS_A,hostRunId:RUN,worldEpoch:1};
  assert.equal(h.authority.verifyCurrentTurn(req),null);
  h.emit({protagonist:{key:'trevor',source:'native_player_model',
    sampledGameTick:123,playerCaptureRef:PLAYER}});
  assert.equal(h.authority.verifyCurrentTurn(req),null);
  const bad={identity,ownerProof,ownerAlias:ALIAS_A,
    source:'director.original_turn_bound',status:'accepted',protagonistKey:'trevor'};
  h.emit({acceptedTurns:[bad]});
  assert.equal(h.authority.verifyCurrentTurn(req),null);
});
test('trusted-only C-01 mock contract tests exact turn generation/session and protagonist',()=>{
  const h=harness(),req={identity,characterId:A,ownerAlias:ALIAS_A,
    hostRunId:RUN,worldEpoch:1};
  const turn={identity,ownerProof,ownerAlias:ALIAS_A,
    source:'original_c01_accepted_turn',status:'accepted',protagonistKey:'franklin'};
  h.emit({acceptedTurns:[turn]});
  assert.equal(h.authority.verifyCurrentTurn(req)?.nativeVerified,true);
  assert.equal(h.authority.verifyCurrentTurn({...req,identity:{...identity,generationId:8}}),null);
  assert.equal(h.authority.verifyCurrentTurn({...req,identity:{...identity,sessionNonce:3}}),null);
  h.emit({protagonist:{key:'michael',source:'native_player_model',
    playerCaptureRef:PLAYER,sampledGameTick:123},acceptedTurns:[turn]});
  assert.equal(h.authority.verifyCurrentTurn(req),null);
});
test('save rollback/suspended P2 mapping denies memory even with live native owner',()=>{
  const h=harness();h.emit();
  h.setWritable(false);
  assert.equal(h.authority.resolveNativeOwner(request(a)),null);
  assert.equal(h.authority.verifyCurrentTurn({identity,characterId:A,ownerAlias:ALIAS_A,
    hostRunId:RUN,worldEpoch:1}),null);
});
test('forged/late observer, negative inference, prepromotion: no proof remains unknown',()=>{
  const h=harness();h.emit();
  const p=h.authority.resolveNativeOwner(request(a));
  assert.equal(h.authority.verifyNativeCoverage({candidate:p,coverageReceipt:{
    observerCaptureRef:REF_A,status:'did_not_witness',certified:true}}),null);
  assert.equal(h.authority.resolvePrepromotion({observerCaptureRef:REF_A,
    reserved:true,characterId:A}),null);
  assert.equal(h.authority.resolveParticipants({hostRunId:RUN,worldEpoch:1,
    adapterEpoch:EPOCH,observation:{claims:[{source:{captureRef:
      '15151515-1515-4515-8515-151515151515'}}]}}).length,0);
});
