import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {IntelligenceClient} from '../../src/perception/intelligenceClient.mjs';
import {createNativeCurrentOwnerPlayerAuthority} from '../../src/memory/nativeCurrentOwnerPlayerAuthority.mjs';
import {CAPABILITIES,validateFrame,validateMemoryCurrentOwnerPlayerPayload} from '../../src/perception/contracts.mjs';

const u=()=>randomUUID();
const fixture=({negotiated=true}={})=>{
  const run=u(),npcRef=u(),otherRef=u(),playerRef=u(),npcRefB=u();
  let adapterEpoch=u(),streamId=u();
  const incarnation=u(),encounter=u(),alias='promoted.'+u(),characterId=u();
  const incarnationB=u(),encounterB=u(),aliasB='promoted.'+u(),characterIdB=u();
  let tick=100,sequence=0,clock=500,retired=0;
  const makeSocket=()=>{
    const s=new EventEmitter();
    s.destroy=()=>{if(s.destroyed)return;s.destroyed=true;s.emit('close');};
    s.write=()=>true;
    return s;
  };
  let socket=makeSocket();
  const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.K.D02.Test'},{
    connect:()=>socket,now:()=>clock
  });
  const profile={characterId,promotion:{ownerAlias:alias},status:'available',
    timelineWritable:true,worldEpoch:1};
  const profileB={characterId:characterIdB,promotion:{ownerAlias:aliasB},
    status:'available',timelineWritable:true,worldEpoch:1};
  const profiles=new Map([[alias,profile],[aliasB,profileB]]);
  const authority=createNativeCurrentOwnerPlayerAuthority({
    subscribeAuthenticatedNativeOwnerPlayerFrames:(onFrame,onRetire)=>
      client.subscribeAuthenticatedNativeOwnerPlayer(onFrame,(reason,refs)=>{
        retired++;onRetire(reason,refs);
      }),
    profileForAlias:requested=>profiles.get(requested)??null,
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
  let hello={version:1,type:'hello',hostContextVersion:1,hostRunId:run,
    worldEpoch:1,adapterEpoch,streamId,observerIndexVersion:1,
    ...(negotiated?{memoryCurrentOwnerPlayerVersion:1}:{}),
    capabilities:Object.fromEntries(CAPABILITIES.map(x=>[x,false]))};
  const owner=()=>({observerCaptureRef:npcRef,incarnationId:incarnation,
    encounterId:encounter,ownerAlias:alias,hostRunId:run,worldEpoch:1,
    nativeActorPedId:'101',sampledGameTick:tick});
  const ownerB=()=>({observerCaptureRef:npcRefB,incarnationId:incarnationB,
    encounterId:encounterB,ownerAlias:aliasB,hostRunId:run,worldEpoch:1,
    nativeActorPedId:'102',sampledGameTick:tick});
  const proof=(avatar='franklin',owners=[owner()])=>({
    nativeOwnerPlayerProofVersion:1,source:'native_p2_owner_fiber_current_only',
    hostRunId:run,worldEpoch:1,sampledGameTick:tick,owners,
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
      {captureRef:npcRefB,kind:'ped',observer:true,owned:true},
      {captureRef:otherRef,kind:'ped',observer:false,owned:false},
      {captureRef:playerRef,kind:'player',observer:false}
    ]);
    await send('observer_index',[
      {captureRef:npcRef,kind:'ped',owned:true,
        incarnationId:incarnation,encounterId:encounter},
      {captureRef:npcRefB,kind:'ped',owned:true,
        incarnationId:incarnationB,encounterId:encounterB}
    ]);
  }
  const bind=()=>authority.bindActorAtTurnStart({pedId:'101',characterId,ownerAlias:alias});
  const verify=lease=>authority.verifyCurrentOwnerAndPlayer({
    lease,identity,characterId,ownerAlias:alias
  });
  const bindB=()=>authority.bindActorAtTurnStart({
    pedId:'102',characterId:characterIdB,ownerAlias:aliasB
  });
  const verifyB=lease=>authority.verifyCurrentOwnerAndPlayer({
    lease,identity:{...identity,pedId:'102'},characterId:characterIdB,ownerAlias:aliasB
  });
  async function renew() {
    socket.destroy();await pause();
    adapterEpoch=u();streamId=u();sequence=0;
    socket=makeSocket();hello={...hello,adapterEpoch,streamId};
    await establish();
  }
  const next=(delta=10)=>{clock+=delta;tick+=delta;};
  const close=()=>{socket.destroy();authority.close();client.stop();};
  return {client,socket,authority,helloFrame,send,establish,proof,owner,ownerB,
    bind,verify,bindB,verifyB,renew,next,close,identity,npcRef,npcRefB,
    otherRef,playerRef,run,alias,aliasB,incarnation,encounter,
    characterId,profile,profileB,retired:()=>retired};
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

// Native FlushControls(refreshRoster) re-sends anchors + observer_index for
// every anchor each 1000 ms. That maintenance is not an owner change: it must
// unsettle verification until a NEWER complete owner sample re-confirms the
// identical owner record, but it must not revoke a live pre-acceptance lease.
async function identicalRosterRefresh(f){
  await f.send('anchors',[
    {captureRef:f.npcRef,kind:'ped',observer:true,owned:true},
    {captureRef:f.playerRef,kind:'player',observer:false}
  ]);
  await f.send('observer_index',[{captureRef:f.npcRef,kind:'ped',owned:true,
    incarnationId:f.incarnation,encounterId:f.encounter}]);
}
test('D02 identical roster refresh unsettles proof but keeps the live lease until a newer owner sample re-confirms it',async()=>{
  const f=fixture();
  try{
    await f.establish();await f.send('memory_current_owner_player',f.proof());
    const old=f.bind();assert.ok(old);
    await identicalRosterRefresh(f);
    assert.equal(f.verify(old),null,'roster frame newer than the last owner sample: unsettled');
    assert.equal(f.authority.status().settled,false);
    const duringRefresh=f.bind();
    assert.ok(duringRefresh,'binding while unsettled is still checked against the live roster');
    f.next();await f.send('memory_current_owner_player',f.proof());
    assert.equal(f.authority.status().settled,true);
    assert.ok(f.verify(old),'identical refresh did not revoke the pre-acceptance lease');
    assert.ok(f.verify(duringRefresh));
    const fresh=f.bind();
    f.next();await f.send('memory_current_owner_player',f.proof());
    assert.ok(f.verify(fresh),'same stream remains usable after roster maintenance');
  }finally{f.close();}
});

test('D02 roster demotion and owner drop-out across a refresh revoke permanently on the same stream',async()=>{
  const f=fixture();
  try{
    await f.establish();await f.send('memory_current_owner_player',f.proof());
    const lease=f.bind();assert.ok(lease);
    // Native demotes the observer; the next complete owner sample omits it.
    await f.send('anchors',[{captureRef:f.npcRef,kind:'ped',observer:false,owned:false}]);
    f.next();await f.send('memory_current_owner_player',{...f.proof(),owners:[]});
    assert.equal(f.verify(lease),null,'owner missing from the newest sample');
    // Even if a later sample re-advertises the old captureRef, it was retired
    // by the drop-out diff that now spans roster maintenance.
    await identicalRosterRefresh(f);
    f.next();await f.send('memory_current_owner_player',f.proof());
    assert.equal(f.verify(lease),null,'drop-out across roster maintenance cannot be resurrected');
    assert.equal(f.bind(),null);
  }finally{f.close();}
});

test('D02 lease survives an STT-length turn across repeated refreshes but not a stale source or the backstop',async()=>{
  const f=fixture();
  try{
    await f.establish();await f.send('memory_current_owner_player',f.proof());
    const lease=f.bind();assert.ok(lease);
    // 4 s of native cadence: owner samples every 250 ms, full roster refresh
    // every 1000 ms, as published by IntelligenceIntegration.Update().
    for(let ms=250;ms<=4000;ms+=250){
      f.next(250);
      if(ms%1000===0)await identicalRosterRefresh(f);
      await f.send('memory_current_owner_player',f.proof());
    }
    assert.ok(f.verify(lease),'continuous membership across >1 s and four roster refreshes');
    f.next(800);
    assert.equal(f.verify(lease),null,'newest owner sample older than maxAge is not current');
    f.next(1);await f.send('memory_current_owner_player',f.proof());
    assert.ok(f.verify(lease),'a fresh sample restores currency without a new bind');
    // Keep the native cadence running until the turn-scale backstop passes.
    // Bound at clock 500; 5301 + 55000 stays inside the 60 s backstop.
    for(let ms=0;ms<55_000;ms+=250){
      f.next(250);
      if(ms%1000===0)await identicalRosterRefresh(f);
      await f.send('memory_current_owner_player',f.proof());
    }
    assert.ok(f.verify(lease),'still continuously corroborated just under the backstop');
    for(let ms=0;ms<=1000;ms+=250){
      f.next(250);
      if(ms%1000===0)await identicalRosterRefresh(f);
      await f.send('memory_current_owner_player',f.proof());
    }
    assert.ok(f.client.runtime.current(f.npcRef),'roster itself is still live');
    assert.equal(f.authority.status().settled,true);
    assert.equal(f.verify(lease),null,'absolute lease backstop');
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

test('K-21 authenticated two-owner stream: one suspended while the other verifies and then recovers',async()=>{
  const f=fixture();
  const both=()=>f.proof('franklin',[f.owner(),f.ownerB()]);
  try{
    await f.establish();
    await f.send('memory_current_owner_player',both());
    const staleA=f.bind(),continuousB=f.bindB();
    assert.ok(staleA && continuousB);
    f.next();await f.send('memory_current_owner_player',both());
    assert.ok(f.verify(staleA) && f.verifyB(continuousB));

    // Native K-21 can omit this one NPC while its PS observer anchor
    // remains registered and current. The strict runtime must admit the
    // independently proven healthy owner, not reject the entire frame.
    f.next();await f.send('memory_current_owner_player',
      f.proof('franklin',[f.ownerB()]));
    assert.equal(f.authority.status().connected,true);
    assert.equal(f.authority.status().ownerCount,1);
    assert.equal(f.verify(staleA),null);
    assert.equal(f.bind(),null);
    assert.ok(f.verifyB(continuousB),'healthy lease remains verifiable');

    f.next();await f.send('memory_current_owner_player',both());
    assert.equal(f.authority.status().ownerCount,2);
    assert.equal(f.verify(staleA),null,'same owner ref cannot resurrect old lease');
    assert.ok(f.verifyB(continuousB));
    const freshA=f.bind();assert.ok(freshA);
    assert.equal(f.verify(freshA),null,'requires a post-binding native sample');
    f.next();await f.send('memory_current_owner_player',both());
    assert.ok(f.verify(freshA),'exact lifetime can acquire a new lease');
    assert.equal(f.verify(staleA),null);
    assert.ok(f.verifyB(continuousB));
  }finally{f.close();}
});

test('K-21 authenticated recovery refuses forged aliases and recycled incarnations',async()=>{
  for(const mutate of [
    o=>({...o,ownerAlias:'promoted.'+u()}),
    o=>({...o,incarnationId:u()}),
    o=>({...o,encounterId:u()}),
    o=>({...o,nativeActorPedId:'999'})
  ]){
    const f=fixture();
    try{
      await f.establish();
      await f.send('memory_current_owner_player',f.proof());
      const stale=f.bind();assert.ok(stale);
      f.next();await f.send('memory_current_owner_player',
        f.proof('franklin',[]));
      assert.equal(f.verify(stale),null);
      f.next();await f.send('memory_current_owner_player',
        f.proof('franklin',[mutate(f.owner())]));
      assert.equal(f.bind(),null,'forged/recycled authority cannot issue leases');
      assert.equal(f.verify(stale),null);
    }finally{f.close();}
  }
});

test('K-21 recovery across new authenticated hello resets leases, not identity checks',async()=>{
  const f=fixture();
  const both=()=>f.proof('franklin',[f.owner(),f.ownerB()]);
  try{
    await f.establish();
    await f.send('memory_current_owner_player',both());
    const oldA=f.bind(),oldB=f.bindB();
    f.next();await f.send('memory_current_owner_player',both());
    assert.ok(f.verify(oldA) && f.verifyB(oldB));
    f.next();await f.send('memory_current_owner_player',
      f.proof('franklin',[f.ownerB()]));
    assert.equal(f.verify(oldA),null);
    assert.ok(f.verifyB(oldB));

    await f.renew(); // new genuine hello/adapter epoch/stream + fresh roster
    assert.equal(f.verifyB(oldB),null,'no lease survives stream renewal');
    assert.equal(f.bind(),null,'new hello alone proves no native owner');
    f.next();await f.send('memory_current_owner_player',both());
    const newA=f.bind(),newB=f.bindB();
    assert.ok(newA && newB,'new source re-proves exact owners');
    f.next();await f.send('memory_current_owner_player',both());
    assert.ok(f.verify(newA) && f.verifyB(newB));
    assert.equal(f.verify(oldA),null);
    assert.equal(f.verifyB(oldB),null);
  }finally{f.close();}
});
