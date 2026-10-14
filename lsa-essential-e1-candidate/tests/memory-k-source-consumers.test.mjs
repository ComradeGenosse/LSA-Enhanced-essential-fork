import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomUUID as uuid} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {IntelligenceClient} from '../src/perception/intelligenceClient.mjs';
import {CAPABILITIES} from '../src/perception/contracts.mjs';
import {memoryKSourceActivation} from '../src/memory/sourceActivation.mjs';
import {createMemoryD02Port} from '../src/memory/memoryD02Port.mjs';
import {captureKnowledgeInputs} from '../src/context/knowledgeInputs.mjs';
import {selectRadioContext} from '../src/perception/radioContextProjector.mjs';
import {createRuntimeForBundle} from '../src/bootstrap.mjs';
import {verifyPerceptionContract} from '../tools/verifyPerceptionContract.mjs';
import {projectCapabilityHealth} from '../src/observability/capabilityHealth.mjs';

const turn={pedId:'101',turnId:'turn-source-only',generationId:1,sessionNonce:1};
const pause=()=>new Promise(resolve=>setImmediate(()=>setImmediate(resolve)));
function fixture(requests={'ps2.observations':'off','ps3.salience':'off'}, {negotiated=true}={}) {
  let clock=1000,tick=100,sequence=0,socket,adapterEpoch=uuid(),streamId=uuid(),hostRunId=uuid(),worldEpoch=1;
  const npc=uuid(),player=uuid(),incarnation=uuid(),encounter=uuid(),characterId=uuid(),alias='promoted.'+uuid();
  let starts=0,stops=0,taps=0;
  const profile={characterId,status:'available',promotion:{ownerAlias:alias}};
  const store={timelineWritable:true,worldProfileId:uuid(),verifiedHostContext:null,list:()=>[profile]};
  const consumers=memoryKSourceActivation({memoryK:{capabilities:requests}});
  const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.D1.Test'}, {
    consumers,now:()=>clock,report:()=>{},acceptedObservationTap:()=>{taps++;},
    connect:()=>{
      starts++;socket=new EventEmitter();socket.writable=true;
      socket.write=()=>true;
      socket.destroy=()=>{if(socket.destroyed)return;socket.destroyed=true;stops++;socket.emit('close');};
      return socket;
    },
  });
  const unsubscribe=client.subscribeVerifiedHostContext(context=>{store.verifiedHostContext=context;});
  const d02=createMemoryD02Port({intelligence:client,memoryStore:store,now:()=>clock});
  const caps=Object.fromEntries(CAPABILITIES.map(k=>[k,['shooting','state','witness'].includes(k)]));
  const raw=async frame=>{socket.emit('data',Buffer.from(JSON.stringify(frame)+'\n'));await pause();};
  const send=async(type,payload,override={})=>{
    const frame={version:1,type,adapterEpoch,streamId,sequence:++sequence,payload,...override};
    await raw(frame);return frame;
  };
  const hello=()=>({version:1,type:'hello',adapterEpoch,streamId,hostContextVersion:1,
    hostRunId,worldEpoch,observerIndexVersion:1,capabilities:caps,
    ...(negotiated?{memoryCurrentOwnerPlayerVersion:1}:{})});
  const roster=async()=>{
    await send('anchors',[{captureRef:npc,kind:'ped',observer:true,owned:true},
      {captureRef:player,kind:'player',observer:false}]);
    await send('observer_index',[{captureRef:npc,kind:'ped',owned:true,incarnationId:incarnation,encounterId:encounter}]);
  };
  const establish=async()=>{client.start();await raw(hello());await roster();};
  const proof=()=>({nativeOwnerPlayerProofVersion:1,source:'native_p2_owner_fiber_current_only',
    hostRunId,worldEpoch,sampledGameTick:tick,
    owners:[{observerCaptureRef:npc,incarnationId:incarnation,encounterId:encounter,
      ownerAlias:alias,hostRunId,worldEpoch,nativeActorPedId:'101',sampledGameTick:tick}],
    protagonist:{source:'native_player_model',key:'franklin',playerCaptureRef:player,sampledGameTick:tick}});
  let producerSequence=0;
  const signal=()=>({signalId:uuid(),producer:'shooting',producerSequence:++producerSequence,
    kind:'firing',source:player,target:null,gameTick:tick,ageMs:0,facts:{},
    witnessReceipts:[{observer:{captureRef:npc,kind:'ped'},status:'witnessed',sampledGameTick:tick,
      reason:'visual_clear',knowsSource:true,knowsTarget:false,
      evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:tick}}]});
  const bind=()=>d02.port.bindActorAtTurnStart({pedId:'101',characterId,ownerAlias:alias});
  const verify=lease=>d02.port.verifyCurrentOwnerAndPlayer({lease,identity:turn,characterId,ownerAlias:alias});
  const next=(ms=10)=>{clock+=ms;tick+=ms;};
  const proven=async()=>{
    await send('memory_current_owner_player',proof());const lease=bind();assert.ok(lease);
    assert.equal(verify(lease),null);next();await send('memory_current_owner_player',proof());
    assert.equal(verify(lease)?.nativeCurrentOwnerVerified,true);return lease;
  };
  return {client,d02,send,raw,hello,roster,establish,proof,signal,bind,verify,next,proven,npc,player,
    counts:()=>({starts,stops,taps}),
    async renew({host=false}={}){socket.destroy();adapterEpoch=uuid();streamId=uuid();sequence=0;
      if(host)hostRunId=uuid();await establish();},
    async world(){worldEpoch++;await send('world_epoch',{epoch:worldEpoch,reason:'clock_regression'});},
    close(){d02.close();unsubscribe();client.stop();},
  };
}

test('D1 source-only private socket keeps current D02 evidence without any PS2/PS3 stores',async()=>{
  const f=fixture();try{
    await f.establish();const lease=await f.proven();
    for(const key of ['observations','episodes','correlator','transcripts','salience','acceptedObservationTap','radioCatalog'])
      assert.equal(f.client.runtime[key],null,key);
    await f.send('signal',f.signal());assert.equal(f.client.runtime.signals.length,0);
    assert.equal(f.counts().taps,0);assert.equal(f.client.runtime.ps2Diagnostics.correlated,0);
    assert.equal(f.client.runtime.ps3Diagnostics.decisions,0);
    assert.equal(f.verify(lease)?.originalBackendAccepted,false);
    assert.equal(f.client.operationalStates()['source.core'].state,'operational');
    assert.equal(f.client.operationalStates()['ps3.salience'].effectiveMode,'off');
    assert.deepEqual(f.client.runtime.directorCandidatesFor(f.npc),[]);
    assert.equal(selectRadioContext(f.client.runtime,'what song is playing?'),null);
    const ordinary=uuid(),host=f.client.runtime.hostContext;
    await f.send('anchors',[{captureRef:ordinary,kind:'ped',observer:true,owned:false}]);
    await f.send('observer_index',[{captureRef:ordinary,kind:'ped',owned:false}]);
    const p0={revision:1,identity:turn,actor:{pedId:'101',integrations:{turnKnowledge:{version:1,
      hostRunId:host.hostRunId,worldEpoch:host.worldEpoch,captureRef:ordinary,sampledGameTick:100}}}};
    const captured=captureKnowledgeInputs({identity:turn,p0Snapshot:p0,perception:f.client.runtime});
    assert.ok(captured.association);assert.deepEqual(captured.pairs,[]);
    p0.actor.integrations.turnKnowledge.captureRef=f.npc;
    // Invalid/incomplete P0 ownership remains refused even with semantics off.
    assert.equal(captureKnowledgeInputs({identity:turn,p0Snapshot:p0,perception:f.client.runtime}).association,null);
  }finally{f.close();}
});

for(const ps3 of ['off','shadow','on'])test(`D1 PS2 on / PS3 ${ps3}: semantic sibling isolation`,async()=>{
  const f=fixture({'ps1.producers':'on','ps2.observations':'on','ps3.salience':ps3});try{
    await f.establish();await f.proven();await f.send('signal',f.signal());
    assert.ok(f.client.runtime.observations.entries.size>0);
    assert.equal(f.counts().taps,1);
    if(ps3==='off') {assert.equal(f.client.runtime.salience,null);assert.equal(f.client.runtime.ps3Diagnostics.decisions,0);}
    else {assert.ok(f.client.runtime.salience);assert.ok(f.client.runtime.ps3Diagnostics.decisions>0);}
    assert.equal(f.client.operationalStates()['ps3.salience'].effectiveMode,ps3);
    f.client.runtime.refreshSalience();f.client.runtime.expire();
  }finally{f.close();}
});

test('D1 PS3-only request is blocked without constructing or implicitly enabling PS2',async()=>{
  const f=fixture({'ps1.producers':'on','ps2.observations':'off','ps3.salience':'on'});try{
    await f.establish();await f.proven();await f.send('signal',f.signal());
    assert.equal(f.client.runtime.correlator,null);assert.equal(f.client.runtime.salience,null);
    const row=f.client.operationalStates()['ps3.salience'];
    assert.equal(row.requestedMode,'on');assert.equal(row.state,'blocked');assert.equal(row.effectiveMode,'off');
  }finally{f.close();}
});

test('D1 missing PS1 request blocks PS2 but leaves source/D02 operational',async()=>{
  const f=fixture({'ps2.observations':'on'});try{
    await f.establish();await f.proven();assert.equal(f.client.runtime.correlator,null);
    assert.equal(f.client.operationalStates()['ps2.observations'].state,'blocked');
  }finally{f.close();}
});

test('D1 legacy configurations keep existing consumers; old peer cannot fabricate unnegotiated D02',async()=>{
  const f=fixture({}, {negotiated:false});try{
    await f.establish();assert.ok(f.client.runtime.correlator&&f.client.runtime.salience);
    await f.send('signal',f.signal());assert.ok(f.client.runtime.observations.entries.size>0);
    await f.send('memory_current_owner_player',f.proof());assert.equal(f.bind(),null);
  }finally{f.close();}
});

for(const fault of ['malformed','stale_stream','stale_adapter','duplicate','out_of_order','producer_replay','expired_signal','wrong_world','wrong_player','wrong_owner'])
  test(`D1 source-only ${fault} retires current D02 proof`,async()=>{
    const f=fixture();try{
      await f.establish();const lease=await f.proven();const signal=f.signal();
      if(fault==='malformed')await f.send('signal',{...signal,facts:{forged:true}});
      if(fault==='stale_stream')await f.send('signal',signal,{streamId:uuid()});
      if(fault==='stale_adapter')await f.send('signal',signal,{adapterEpoch:uuid()});
      if(fault==='duplicate'){const frame=await f.send('signal',signal);await f.raw(frame);}
      if(fault==='out_of_order')await f.send('signal',signal,{sequence:999});
      if(fault==='producer_replay'){await f.send('signal',signal);await f.send('signal',signal);}
      if(fault==='expired_signal')await f.send('signal',{...signal,ageMs:30000});
      if(fault==='wrong_world')await f.send('memory_current_owner_player',{...f.proof(),worldEpoch:2});
      if(fault==='wrong_player'){const p=f.proof();await f.send('memory_current_owner_player',{...p,protagonist:{...p.protagonist,playerCaptureRef:f.npc}});}
      if(fault==='wrong_owner'){const p=f.proof();await f.send('memory_current_owner_player',{...p,owners:[{...p.owners[0],incarnationId:uuid()}]});}
      assert.equal(f.verify(lease),null);assert.equal(f.bind(),null);
      assert.equal(f.counts().taps,0);assert.equal(f.client.runtime.correlator,null);
    }finally{f.close();}
  });

test('D1 world changes, disconnect/reconnect and host replacement never revive old leases',async()=>{
  const f=fixture();try{
    await f.establish();const a=await f.proven();await f.world();assert.equal(f.verify(a),null);
    await f.roster();f.next();const b=await f.proven();assert.equal(f.verify(a),null);
    await f.send('world_epoch',{epoch:f.client.runtime.hostContext.worldEpoch,reason:'clock_regression'});
    assert.ok(f.verify(b),'duplicate world receipt does not retire the continuing stream');
    await f.renew();assert.equal(f.verify(b),null);const c=await f.proven();
    await f.renew({host:true});assert.equal(f.verify(c),null);await f.proven();
    f.client.start();assert.equal(f.counts().starts,3,'idempotent start creates no extra socket');
    f.client.stop();f.client.stop();assert.equal(f.counts().stops,3);
    assert.equal(f.client.operationalStates()['source.core'].state,'stopped');
  }finally{f.close();}
});

test('D1 retirement and source freshness remain mandatory when consumers are off',async()=>{
  for(const cause of ['retirement','freshness']){
    const f=fixture();try{
      await f.establish();const lease=await f.proven();
      if(cause==='retirement')await f.send('retire',{captureRef:f.npc});
      else {f.next(3001);f.client.runtime.expire();}
      assert.equal(f.verify(lease),null);assert.equal(f.bind(),null);
      assert.equal(f.client.runtime.current(f.npc),false);
    }finally{f.close();}
  }
});

test('D1 authority subscriptions reject duplicates and cannot mutate another consumer receipt',async()=>{
  const f=fixture();try{
    let seen=false;
    const listener=receipt=>{assert.ok(Object.isFrozen(receipt.frame.payload.owners[0]));
      assert.throws(()=>{receipt.frame.payload.owners[0].ownerAlias='forged';},TypeError);seen=true;};
    const off=f.client.subscribeAuthenticatedNativeOwnerPlayer(listener);
    assert.throws(()=>f.client.subscribeAuthenticatedNativeOwnerPlayer(listener),/subscriber_invalid/);
    await f.establish();await f.proven();assert.equal(seen,true);off();
    f.close();assert.equal(f.client.currentOwnerPlayerSubscriptions.size,0);
  }finally{f.close();}
});

test('D1 bootstrap composes source-only consumers, accurate states and instance restart/disposal',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'d1-bootstrap-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  const configPath=path.join(directory,'config.json');
  await writeFile(configPath,JSON.stringify({persistentIdentity:{enabled:false},promotedCharacters:{enabled:false},
    intelligence:{mode:'shadow'},memoryK:{capabilities:{'ps2.observations':'off','ps3.salience':'off'}}}));
  let starts=0,stops=0;
  const before=process.listenerCount('beforeExit');
  const runtime=await createRuntimeForBundle({configPath,env:{},enableTelemetry:false,startCharacterEditor:false,
    perceptionContract:await verifyPerceptionContract(),intelligenceOptions:{connect:()=>{
      starts++;const socket=new EventEmitter();socket.destroy=()=>{if(socket.destroyed)return;socket.destroyed=true;stops++;socket.emit('close');};return socket;
    }}});t.after(()=>runtime.dispose());
  assert.equal(starts,1);assert.equal(runtime.intelligence.runtime.correlator,null);
  assert.equal(runtime.intelligence.runtime.salience,null);
  const rows=runtime.services.memoryKRuntimeDiagnostics().capabilities;
  assert.equal(rows['source.core'].state,'waiting');assert.equal(rows['source.core'].effectiveMode,null);
  assert.equal(rows['ps2.observations'].effectiveMode,'off');assert.equal(rows['ps3.salience'].effectiveMode,'off');
  const replacement=await runtime.restart();t.after(()=>replacement.dispose());
  assert.equal(starts,2);assert.equal(stops,1);assert.equal(replacement.intelligence.runtime.salience,null);
  await replacement.dispose();assert.equal(stops,2);
  assert.equal(process.listenerCount('beforeExit'),before);
});

test('D1 legacy health cannot report semantic perception supported from a source-only transport',async()=>{
  const contract=await verifyPerceptionContract();
  const config={provider:'openai',intelligence:{mode:'shadow'},dialogueKnowledge:{mode:'active'},
    memoryK:{capabilities:{'ps2.observations':'off','ps3.salience':'off'}}};
  const hostContext={hostContextVersion:1,hostRunId:uuid(),worldEpoch:1};
  const perception={hostContext,epoch:uuid(),capabilities:{snapshot:true},observerIndexVersion:1,observerSituationVersion:1};
  const rows=projectCapabilityHealth({config,manifest:{perceptionContract:contract},perception});
  assert.equal(rows['ps.perception'].configured,'off');assert.equal(rows['ps.perception'].runtimeSupported,false);
  assert.equal(rows['ps.dialogue_knowledge'].runtimeSupported,false);
  assert.equal(rows['ps.speech_heard'].configured,'off');
  assert.equal(rows['ps.perception'].hostRunId,hostContext.hostRunId,'source host remains available');
});
