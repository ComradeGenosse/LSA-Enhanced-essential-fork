import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {IntelligenceClient} from '../../src/perception/intelligenceClient.mjs';
import {createNativeCurrentOwnerPlayerAuthority} from '../../src/memory/nativeCurrentOwnerPlayerAuthority.mjs';
import {CAPABILITIES,validateFrame,validateMemoryCurrentOwnerPlayerPayload} from '../../src/perception/contracts.mjs';

const u=()=>randomUUID();
const fixture=({negotiated=true}={})=>{
  const run=u(),adapterEpoch=u(),streamId=u(),npcRef=u(),otherRef=u(),playerRef=u();
  const incarnation=u(),encounter=u(),alias='promoted.'+u(),characterId=u();
  let tick=100,sequence=0,clock=500,retired=0;
  const socket=new EventEmitter();
  socket.destroy=()=>{if(socket.destroyed)return;socket.destroyed=true;socket.emit('close');};
  socket.write=()=>true;
  const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.K.D02.Test'},{
    connect:()=>socket,now:()=>clock
  });
  const profile={characterId,promotion:{ownerAlias:alias},status:'available',
    timelineWritable:true,worldEpoch:1};
  const authority=createNativeCurrentOwnerPlayerAuthority({
    subscribeAuthenticatedNativeOwnerPlayerFrames:(onFrame,onRetire)=>
      client.subscribeAuthenticatedNativeOwnerPlayer(onFrame,(reason,refs)=>{
        retired++;onRetire(reason,refs);
      }),
    profileForAlias:requested=>requested===alias?profile:null,
    sourceStillCurrent:(context,owner,player)=>{
      const s=client.runtime,row=s.observerIndex.get(owner.observerCaptureRef);
      return s.epoch===context?.adapterEpoch &&
        s.stream===context?.streamId &&
        s.hostContext?.hostRunId===context?.hostRunId &&
        s.hostContext?.worldEpoch===context?.worldEpoch &&
        s.current(owner.observerCaptureRef) &&
        s.current(player.playerCaptureRef) &&
        s.anchors.get(owner.observerCaptureRef)?.observer===true &&
        row?.incarnationId===owner.incarnationId &&
        row?.encounterId===owner.encounterId &&
        s.anchors.get(player.playerCaptureRef)?.kind==='player';
    },
    now:()=>clock
  });
  const hello={version:1,type:'hello',hostContextVersion:1,hostRunId:run,
    worldEpoch:1,adapterEpoch,streamId,observerIndexVersion:1,
    ...(negotiated?{memoryCurrentOwnerPlayerVersion:1}:{}),
    capabilities:Object.fromEntries(CAPABILITIES.map(x=>[x,false]))};
  const owner=()=>({observerCaptureRef:npcRef,incarnationId:incarnation,
    encounterId:encounter,ownerAlias:alias,hostRunId:run,worldEpoch:1,
    nativeActorPedId:'101',sampledGameTick:tick});
  const proof=(avatar='franklin')=>({
    nativeOwnerPlayerProofVersion:1,source:'native_p2_owner_fiber_current_only',
    hostRunId:run,worldEpoch:1,sampledGameTick:tick,owners:[owner()],
    protagonist:{source:'native_player_model',key:avatar,
      playerCaptureRef:playerRef,sampledGameTick:tick}
  });
  const identity={pedId:'101',turnId:'turn-one',generationId:2,sessionNonce:3};
  const pause=()=>new Promise(resolve=>setImmediate(()=>setImmediate(resolve)));
  async function helloFrame(){socket.emit('data',Buffer.from(JSON.stringify(hello)+'\n'));await pause();}
  async function send(type,payload,{increment=true,adapter=adapterEpoch,stream=streamId}={}){
    socket.emit('data',Buffer.from(JSON.stringify({version:1,type,payload,
      adapterEpoch:adapter,streamId:stream,sequence:increment?++sequence:sequence})+'\n'));
    await pause();
  }
  async function establish(){
    client.start();await helloFrame();
    await send('anchors',[
      {captureRef:npcRef,kind:'ped',observer:true,owned:true},
      {captureRef:otherRef,kind:'ped',observer:false,owned:false},
      {captureRef:playerRef,kind:'player',observer:false}
    ]);
    await send('observer_index',[{captureRef:npcRef,kind:'ped',owned:true,
      incarnationId:incarnation,encounterId:encounter}]);
  }
  const bind=()=>authority.bindActorAtTurnStart({pedId:'101',characterId,ownerAlias:alias});
  const verify=lease=>authority.verifyCurrentOwnerAndPlayer({
    lease,identity,characterId,ownerAlias:alias
  });
  const next=()=>{clock+=10;tick+=10;};
  const close=()=>{socket.destroy();authority.close();client.stop();};
  return {client,socket,authority,hello,helloFrame,send,establish,proof,owner,
    bind,verify,next,close,identity,npcRef,otherRef,playerRef,run,alias,
    incarnation,encounter,characterId,profile,retired:()=>retired};
};

test('D02 negotiated authenticated socket binds only current actor and newer owner sample',async()=>{
  const f=fixture();
  try {
    await f.establish();
    assert.equal(f.bind(),null,'no authoritative native owner sample');
    assert.equal(typeof f.client.submitAuthenticatedNativeOwnerPlayer,'undefined');
    await f.send('memory_current_owner_player',f.proof());
    const lease=f.bind();assert.ok(lease);
    assert.equal(f.verify(lease),null,'one native sample is not post-bind read-through');
    f.next();await f.send('memory_current_owner_player',f.proof());
    const receipt=f.verify(lease);
    assert.equal(receipt.nativeCurrentOwnerVerified,true);
    assert.equal(receipt.originalBackendAccepted,false);
    assert.equal(receipt.humanPlayerScope,'single_local_human');
    assert.equal(receipt.ownerAlias,f.alias);
    assert.equal(receipt.nativeActorPedId,'101');
    assert.equal(receipt.playerCaptureRef,f.playerRef);
    assert.equal(receipt.characterId,f.characterId);
    assert.equal(f.authority.verifyCurrentOwnerAndPlayer({
      lease,identity:{...f.identity,pedId:'102'},
      characterId:f.characterId,ownerAlias:f.alias}),null);
  }finally{f.close();}
});

test('D02 refuses missing protocol version and non-player native capture ref',async()=>{
  const f=fixture({negotiated:false});
  try{
    await f.establish();await f.send('memory_current_owner_player',f.proof());
    assert.equal(f.bind(),null);assert.ok(f.retired()>0);
  }finally{f.close();}
  const g=fixture();
  try{
    await g.establish();
    const malicious={...g.proof(),protagonist:{...g.proof().protagonist,
      playerCaptureRef:g.otherRef}};
    await g.send('memory_current_owner_player',malicious);
    assert.equal(g.bind(),null);
  }finally{g.close();}
});

test('D02 retires active lease synchronously on native NPC retirement',async()=>{
  const f=fixture();
  try{
    await f.establish();await f.send('memory_current_owner_player',f.proof());
    const lease=f.bind();f.next();await f.send('memory_current_owner_player',f.proof());
    assert.ok(f.verify(lease));
    await f.send('retire',{captureRef:f.npcRef});
    assert.equal(f.verify(lease),null);
    assert.equal(f.bind(),null);
    assert.ok(f.retired()>0);
    // A retired captureRef cannot be resurrected on this same stream even
    // if a future actor advertises the old UUID and lifetime again.
    await f.send('anchors',[{captureRef:f.npcRef,kind:'ped',observer:true,owned:true}]);
    await f.send('observer_index',[{captureRef:f.npcRef,kind:'ped',owned:true,
      incarnationId:f.incarnation,encounterId:f.encounter}]);
    f.next();await f.send('memory_current_owner_player',f.proof());
    assert.equal(f.bind(),null,'retired native capture reference is irrevocable');
  }finally{f.close();}
});

test('D02 roster refresh revokes old leases but permits new real frame on SAME stream',async()=>{
  const f=fixture();
  try{
    await f.establish();await f.send('memory_current_owner_player',f.proof());
    const old=f.bind();
    await f.send('anchors',[{captureRef:f.npcRef,kind:'ped',observer:true,owned:true}]);
    assert.equal(f.verify(old),null);
    f.next();await f.send('memory_current_owner_player',f.proof());
    const fresh=f.bind();assert.ok(fresh);
    f.next();await f.send('memory_current_owner_player',f.proof());
    assert.ok(f.verify(fresh),'same stream remains usable after roster maintenance');
    assert.equal(f.verify(old),null);
  }finally{f.close();}
});

test('D02 denies avatar switch during proof, keeps human player scope for next turn',async()=>{
  const f=fixture();
  try{
    await f.establish();await f.send('memory_current_owner_player',f.proof('franklin'));
    const lease=f.bind();
    f.next();await f.send('memory_current_owner_player',f.proof('trevor'));
    assert.equal(f.verify(lease),null);
    const newLease=f.bind();assert.ok(newLease);
    f.next();await f.send('memory_current_owner_player',f.proof('trevor'));
    assert.equal(f.verify(newLease)?.humanPlayerScope,'single_local_human');
    assert.equal(f.verify(newLease)?.avatarKey,'trevor');
  }finally{f.close();}
});

test('D02 synchronous read-through rejects locally expired source anchors',async()=>{
  const f=fixture();
  try{
    await f.establish();await f.send('memory_current_owner_player',f.proof());
    const lease=f.bind();f.next();await f.send('memory_current_owner_player',f.proof());
    assert.ok(f.verify(lease));
    f.client.runtime.anchors.get(f.npcRef).expires=0;
    assert.equal(f.verify(lease),null,'native roster must remain current at verification time');
    assert.equal(f.bind(),null);
  }finally{f.close();}
});

test('D02 timeline suspension, wrong character and stream lifecycle all fail closed',async()=>{
  const f=fixture();
  try{
    await f.establish();await f.send('memory_current_owner_player',f.proof());
    const lease=f.bind();f.next();await f.send('memory_current_owner_player',f.proof());
    assert.ok(f.verify(lease));
    f.profile.timelineWritable=false;
    assert.equal(f.verify(lease),null);
    f.profile.timelineWritable=true;
    assert.equal(f.authority.verifyCurrentOwnerAndPlayer({
      lease,identity:f.identity,characterId:u(),ownerAlias:f.alias}),null);
    f.socket.destroy();
    assert.equal(f.verify(lease),null);
    assert.equal(f.bind(),null);
  }finally{f.close();}
});

test('D02 protocol rejects forgery, capture reuse, ped reuse and unsolicited acceptance',()=>{
  const f=fixture();
  const base=f.proof();
  assert.equal(validateMemoryCurrentOwnerPlayerPayload(base),true);
  for(const p of [
    {...base,acceptedTurns:[{text:'forged'}]},
    {...base,source:'memory_c01_accepted'},
    {...base,protagonist:null},
    {...base,protagonist:{...base.protagonist,playerCaptureRef:f.npcRef}},
    {...base,owners:[f.owner(),f.owner()]},
    {...base,owners:[{...f.owner(),nativeActorPedId:'00'}]},
    {...base,owners:[{...f.owner(),incarnationId:u().toUpperCase()}]},
    {...base,owners:[{...f.owner(),ownerAlias:'promotedx'+u()}]},
    {...base,owners:[{...f.owner(),nativeActorPedId:'2147483648'}]},
    {...base,owners:Array.from({length:17},()=>f.owner())},
  ]) assert.equal(validateMemoryCurrentOwnerPlayerPayload(p),false);
  assert.equal(validateFrame({version:1,type:'memory_c01_accepted',adapterEpoch:u(),
    streamId:u(),sequence:1,payload:base}),false);
  f.close();
});

test('D02 replayed native stream sequence never produces a new proof',async()=>{
  const f=fixture();
  try{
    await f.establish();await f.send('memory_current_owner_player',f.proof());
    const lease=f.bind();
    f.next();await f.send('memory_current_owner_player',f.proof(),{increment:false});
    assert.equal(f.verify(lease),null);
    assert.equal(f.bind(),null,'failed replay must retire source');
  }finally{f.close();}
});
