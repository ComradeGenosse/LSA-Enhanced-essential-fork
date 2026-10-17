import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { IntelligenceClient } from '../src/perception/intelligenceClient.mjs';
import { CAPABILITIES } from '../src/perception/contracts.mjs';
import { resolveDelivery } from '../src/voice/emotion/sceneDelivery.mjs';

class NativePipe extends EventEmitter {
  destroyed=false;writable=true;writableLength=0;writes=[];
  write(text){this.writes.push(text);return true;}
  destroy(){if(this.destroyed)return;this.destroyed=true;this.writable=false;this.emit('close');}
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function nativeFixture(t,{director=true,legacy=false}={}) {
  let epoch=1,seq=0,now=1000;
  const pipe=new NativePipe(),adapterEpoch=randomUUID(),streamId=randomUUID(),
    hostRunId=randomUUID();
  const client=new IntelligenceClient({mode:'shadow',radio:'off',
    pipeName:'ea-h-fixture'},{
    connect:()=>pipe,now:()=>now,report:()=>{},telemetry:()=>{},
  });
  t.after(()=>client.stop());
  client.start();
  const receive=async frame=>{
    pipe.emit('data',Buffer.from(JSON.stringify(frame)+'\n','utf8'));
    await settle();
  };
  const hello=async()=>{
    const h={version:1,type:'hello',adapterEpoch,streamId,
      capabilities:Object.fromEntries(CAPABILITIES.map(x=>[x,false]))};
    if(!legacy)Object.assign(h,{hostContextVersion:1,hostRunId,worldEpoch:epoch});
    if(director)h.directorRequestVersion=1;
    await receive(h);
  };
  const model=async(protagonist,revision)=>{
    await receive({version:1,type:'protagonist_model',adapterEpoch,streamId,
      sequence:++seq,payload:{version:1,source:'native_player_model',
        protagonist,hostRunId,worldEpoch:epoch,revision}});
  };
  const world=async()=>{
    epoch++;
    await receive({version:1,type:'world_epoch',adapterEpoch,streamId,
      sequence:++seq,payload:{epoch,reason:'timeline_change'}});
  };
  return {pipe,client,hello,model,world,hostRunId,streamId,adapterEpoch,
    currentEpoch:()=>epoch,advance:ms=>{now+=ms;}};
}
test('EA-H: exact negotiated-v1 receiver capability rides accepted C-13 hello',async t=>{
  const x=nativeFixture(t);await x.hello();
  assert.equal(x.pipe.writes.length,1);
  const raw=x.pipe.writes[0];
  assert.equal(raw.endsWith('\n'),true,'wire frame is newline terminated');
  const declaration=JSON.parse(raw);
  assert.deepEqual(declaration,{
    version:1,type:'protagonist_capability',supportedVersion:1,
    adapterEpoch:x.adapterEpoch,streamId:x.streamId,
    hostRunId:x.hostRunId,worldEpoch:1,
  });
  assert.equal(x.client.protagonistAuthority.readVerified(),null,
    'a receiver declaration is not model authority');
  await x.model('franklin',1);
  const franklin=x.client.protagonistAuthority.readVerified();
  assert.equal(franklin?.protagonist,'franklin');
  await x.model('michael',2);
  assert.equal(x.client.protagonistAuthority.isCurrent(franklin),false);
  assert.equal(x.client.protagonistAuthority.readVerified()?.protagonist,'michael');
  await x.world();
  assert.equal(x.client.protagonistAuthority.readVerified(),null);
  assert.equal(x.pipe.writes.length,2,'new world requires another exact receiver declaration');
  assert.equal(JSON.parse(x.pipe.writes[1]).worldEpoch,2);
  await x.model('trevor',3);
  assert.equal(x.client.protagonistAuthority.readVerified()?.protagonist,'trevor');
});
test('EA-H: legacy/outbound-only native hosts never get a capability claim',async t=>{
  const outputOnly=nativeFixture(t,{director:false});await outputOnly.hello();
  assert.deepEqual(outputOnly.pipe.writes,[]);
  const old=nativeFixture(t,{director:false,legacy:true});await old.hello();
  assert.deepEqual(old.pipe.writes,[]);
  assert.equal(old.client.protagonistAuthority.readVerified(),null);
});
test('EA-H: a disconnected C-13 socket cannot retain protagonist proof',async t=>{
  const x=nativeFixture(t);await x.hello();await x.model('trevor',1);
  const first=x.client.protagonistAuthority.readVerified();
  assert.ok(first);x.pipe.destroy();
  assert.equal(x.client.protagonistAuthority.readVerified(),null);
  assert.equal(x.client.protagonistAuthority.isCurrent(first),false);
  assert.equal(x.client.getNativeStream().connected,false);
});
test('EA-H: identical accepted NPC scene/traits yield identical acting for all three avatars',()=>{
  const uuid=()=>randomUUID(),cid=uuid();
  const id=Object.freeze({
    characterId:cid,observerCaptureRef:uuid(),incarnationId:uuid(),
    ownerProofRevision:1,hostRunId:uuid(),worldEpoch:1,nativeRun:uuid(),
    pedId:'17',sessionNonce:2,turnId:'turn-2',generationId:2,
  });
  const evidence=Object.freeze({
    verifiedOwner:true,lifetimeCurrent:true,channelHealthy:true,
    identity:id,observations:Object.freeze([]),
  });
  const config={mode:'experimental',intensity:'subtle',maxTaggedSegmentsPerTurn:2};
  const traits={characterId:cid,personality:{traits:['wry']}};
  const results=['franklin','michael','trevor'].map(()=>{
    // Protagonist model never enters the Luna-facing personality/relationship
    // selector. Native authentication is checked before this pure selector.
    return resolveDelivery({identity:id,segmentText:'Yeah, right.',
      source:'player_text',nowMonotonicMs:1000,
      currentSceneEvidence:evidence,actorTraits:traits,config});
  });
  assert.equal(results[0].value,'sarcastic');
  assert.deepEqual(results[0],results[1]);
  assert.deepEqual(results[1],results[2]);
});
