import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {IntelligenceClient} from '../src/perception/intelligenceClient.mjs';
import {CAPABILITIES,validateMemoryAuthorityPayload,validateFrame} from '../src/perception/contracts.mjs';
import {createNativeMemoryAuthority} from '../src/memory/nativeMemoryAuthority.mjs';

const next=()=>new Promise(resolve=>setImmediate(()=>setImmediate(resolve)));
const hostRunId=randomUUID(),adapterEpoch=randomUUID(),streamId=randomUUID();
const worldProfileId=randomUUID(),characterIds=[randomUUID(),randomUUID()];
const refs=[randomUUID(),randomUUID()],incarnations=[randomUUID(),randomUUID()],encounters=[randomUUID(),randomUUID()];
const aliases=[0,1].map(()=>`promoted.${randomUUID()}`);
const playerRef=randomUUID();
const owner=i=>({ownerAlias:aliases[i],observerCaptureRef:refs[i],
  hostRunId,worldEpoch:1,incarnationId:incarnations[i],encounterId:encounters[i],
  sampledGameTick:123});
const payload=(key,owners=[owner(0),owner(1)])=>({
  memoryProofVersion:1,hostRunId,worldEpoch:1,sampledGameTick:123,
  owners,protagonist:{key,source:'native_player_model',playerCaptureRef:playerRef,
    sampledGameTick:123},acceptedTurns:[]
});
const frame=(hello,type,payload,sequence)=>({
  version:1,type,adapterEpoch:hello.adapterEpoch,streamId:hello.streamId,
  sequence,payload
});
function makeFixture(){
  const socket=new EventEmitter();
  socket.destroy=()=>{if(socket.closed)return;socket.closed=true;socket.emit('close');};
  socket.write=()=>true;
  const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.K.NativeMemory'},{
    connect:()=>socket
  });
  const hello={version:1,type:'hello',hostContextVersion:1,hostRunId,worldEpoch:1,
    adapterEpoch,streamId,observerIndexVersion:1,
    capabilities:Object.fromEntries(CAPABILITIES.map(x=>[x,x==='snapshot'||x==='witness']))};
  let sequence=0,retired=0;
  const emit=async(type,body)=>{
    socket.emit('data',Buffer.from(JSON.stringify(frame(hello,type,body,++sequence))+'\\n'));
    await next();
  };
  const authority=createNativeMemoryAuthority({
    subscribeAuthenticatedNativeFrames:(onFrame,onRetire)=>{
      const unsubscribe=client.subscribeAuthenticatedNativeMemoryAuthority(onFrame,()=>{
        retired++;onRetire();
      });
      return unsubscribe;
    },
    profileForAlias:alias=>{
      const i=aliases.indexOf(alias);
      return i<0?null:{characterId:characterIds[i],worldProfileId,
        promotion:{ownerAlias:alias},status:'available'};
    }
  });
  client.start();
  return {socket,client,hello,emit,authority,retired:()=>retired,
    close(){socket.destroy();authority.close();client.stop();}};
}
const index=i=>({captureRef:refs[i],kind:'ped',owned:true,
  encounterId:encounters[i],incarnationId:incarnations[i]});
const resolve=(authority,i)=>authority.resolveNativeOwner({
  observerCaptureRef:refs[i],observerIndex:index(i),
  hostRunId,worldEpoch:1,adapterEpoch
});

test('K v1 contract rejects fabricated C-01 turn, alias, epoch and oversize roster',()=>{
  assert.equal(validateMemoryAuthorityPayload(payload('franklin')),true);
  assert.equal(validateMemoryAuthorityPayload({...payload('franklin'),
    acceptedTurns:[{nativeVerified:true}]}),false);
  assert.equal(validateMemoryAuthorityPayload({...payload('trevor'),
    owners:[{...owner(0),ownerAlias:'promoted.fake'}]}),false);
  assert.equal(validateMemoryAuthorityPayload({...payload('franklin'),
    owners:[owner(0),owner(0)]}),false);
  assert.equal(validateMemoryAuthorityPayload({...payload('michael'),owners:
    Array.from({length:17},(_,i)=>({...owner(0),observerCaptureRef:randomUUID()}))}),false);
  assert.equal(validateFrame(frame({adapterEpoch,streamId},'memory_authority',
    payload('unknown'),9)),true);
});
test('K authenticated socket admits two distinct P2 owners and all protagonist modes, never inventing normal-turn proof',async()=>{
  const x=makeFixture();
  try{
    x.socket.emit('data',Buffer.from(JSON.stringify(x.hello)+'\\n'));await next();
    await x.emit('anchors',refs.map(captureRef=>({
      captureRef,kind:'ped',observer:true,owned:true
    })).concat([{captureRef:playerRef,kind:'player',observer:false}]));
    await x.emit('observer_index',[index(0),index(1)]);
    for(const key of ['franklin','michael','trevor','unknown']){
      await x.emit('memory_authority',payload(key));
      assert.equal(resolve(x.authority,0)?.characterId,characterIds[0]);
      assert.equal(resolve(x.authority,1)?.characterId,characterIds[1]);
      assert.equal(x.authority.verifyCurrentTurn({
        identity:{pedId:'101',turnId:'turn-A',generationId:1,sessionNonce:1},
        characterId:characterIds[0],ownerAlias:aliases[0],
        hostRunId,worldEpoch:1
      }),null);
      const participant=x.authority.resolveParticipants({
        observation:{claims:[{source:{captureRef:playerRef}}]},
        hostRunId,worldEpoch:1,adapterEpoch
      });
      assert.equal(participant.length,key==='unknown'?0:1);
      if(key!=='unknown')assert.equal(participant[0].subjectKey,key);
    }
    const stale=payload('franklin');stale.worldEpoch=2;
    await x.emit('memory_authority',stale);
    assert.equal(x.authority.status().c01TurnProofAvailable,false);
    x.socket.destroy();
    assert.equal(resolve(x.authority,0),null);
    assert.ok(x.retired()>0);
  }finally{x.close();}
});
