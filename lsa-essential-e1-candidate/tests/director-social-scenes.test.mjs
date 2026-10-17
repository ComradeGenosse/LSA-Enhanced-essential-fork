import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateDirectorSocialPayload} from '../src/perception/contracts.mjs';
import {renderDirectorSocialContext} from '../src/perception/directorSocialContext.mjs';
import {DirectorObservationPump} from '../src/perception/directorProduction.mjs';
import {SceneDirectorSpeech} from '../src/perception/sceneDirectorOrchestrator.mjs';
import {DirectorSpeechReservations} from '../src/perception/sceneDirectorAdmission.mjs';
import {IntelligenceClient} from '../src/perception/intelligenceClient.mjs';

const fixture=()=>{
  const speaker=randomUUID(),player=randomUUID(),scene=randomUUID(),owner=randomUUID(),host=randomUUID();
  return {speaker,player,scene,owner,host,proposal:Object.freeze({
    kind:'speech',source:'native_director_social',speakerCaptureRef:speaker,
    playerCaptureRef:player,observationId:scene,observationRevision:1,
    decisionKey:'social:'+scene,policyVersion:1,urgency:'urgent',
    sceneType:'shared_vehicle_entry',role:'passenger',expiresAtMonotonicMs:9000,
  }),stamp:{
    hostRunId:host,worldEpoch:1,speakerCaptureRef:speaker,playerCaptureRef:player,
    ownerIncarnationId:owner,proofRevision:1,playerTurnVersion:2,policyVersion:1
  }};
};
test('native social scene uses a closed schema and cannot invent actor or scene type',()=>{
  const f=fixture(),payload={
    socialVersion:1,hostRunId:f.host,worldEpoch:1,sampledGameTick:100,
    sceneId:f.scene,sceneType:'shared_vehicle_entry',speakerCaptureRef:f.speaker,
    playerCaptureRef:f.player,ownerIncarnationId:f.owner,ownerProofRevision:1,role:'passenger'
  };
  assert.equal(validateDirectorSocialPayload(payload),true);
  assert.equal(validateDirectorSocialPayload({...payload,sceneType:'player_pretend_battle'}),false);
  assert.equal(validateDirectorSocialPayload({...payload,arbitrary:'authority'}),false);
  assert.equal(validateDirectorSocialPayload({...payload,ownerProofRevision:0}),false);
});
test('all social openings are bounded scene context, not fixed dialogue',()=>{
  const f=fixture();
  for(const sceneType of ['shared_vehicle_entry','reunion','shared_idle','travel','activity_transition','manual','personal_curiosity']){
    const s=renderDirectorSocialContext({...f.proposal,sceneType});
    assert.ok(s && s.length<=160,sceneType);
    assert.ok(!s.includes('Where we going, man?'));
  }
  assert.equal(renderDirectorSocialContext({...f.proposal,sceneType:'gunfire'}),null);
});
test('social source reaches the existing pump without any PS3 candidates, once',async()=>{
  const f=fixture(),results=[],calls=[];
  const runtime={
    epoch:'native-run',hostContext:{worldEpoch:1},directorRequestVersion:1,
    anchors:new Map([[f.player,{kind:'player',captureRef:f.player}]]),
    observerIndex:new Map([[f.speaker,{owned:true,kind:'ped'}]]),
    now:()=>1000,current:()=>true,stalled:()=>false,
    directorOwnerProofFor:()=>f.stamp,
    directorCandidatesFor:()=>[],
    directorSocialFor:()=>f.proposal,
    directorPriority:{experimentalEnabled:true,playerTurnVersion:2,
      receivedAt:1000,hostRunId:f.host,worldEpoch:1},
  };
  const coordinator={mode:'active',pacingVeto:()=>null,
    attempt:async item=>{calls.push(item);return {status:'delivered'};}};
  const pump=new DirectorObservationPump({
    client:{runtime},coordinator,now:()=>1000,stampFor:()=>f.stamp,
    onResult:x=>results.push(x),
  });
  await pump.tick();await pump.tick();
  assert.equal(calls.length,1);
  assert.equal(calls[0].socialProposal,f.proposal);
  assert.deepEqual(calls[0].candidates,[]);
  assert.equal(results[0].source,'social');
  assert.equal(results[0].sceneType,'shared_vehicle_entry');
  assert.equal(pump.ambientAt.get(f.speaker),1000);
});
test('social initiation passes native source + stock hydration gates',async()=>{
  const f=fixture(),native=[],stages=[];
  const proof={
    source:'native_director_social',hostRunId:f.host,worldEpoch:1,
    speakerCaptureRef:f.speaker,playerCaptureRef:f.player,
    ownerIncarnationId:f.owner,proofRevision:1,
    observationId:f.scene,observationRevision:1,
    decisionKey:f.proposal.decisionKey,policyVersion:1,
    expiresAtMonotonicMs:9000,
  };
  const ticket={ticketId:randomUUID(),dedupeKey:'ps:'+randomUUID()};
  const admission={
    reserve:()=>ticket,consume:()=>true,afterHydration:()=>true,
    beforePublication:()=>true,bindNativeTuple:()=>true,
    finish:()=>true,cancel:()=>true,setEnabled:()=>true
  };
  const director=new SceneDirectorSpeech({
    now:()=>1000,mode:'active',admission,
    originalEntitlement:()=>proof,
    nativeRequest:async ({operation})=>{
      native.push(operation);return {ticketId:ticket.ticketId,
        status:operation==='reserve'?'reserved':operation==='submit'?'submitted':'cancelled'};
    },
    dispatch:async ({gates,eventContext})=>{
      assert.match(eventContext,/boarded|vehicle/);
      assert.equal(gates.hydrated(),true);stages.push('hydrated');
      assert.equal(gates.publication(),true);stages.push('publication');
      return {tuple:{pedId:'1',turnId:'real',generationId:1,sessionNonce:1},
        terminal:Promise.resolve({type:'playback_ended',reason:'completed',
          hadAudio:true,playbackStarted:true,wasInterrupted:false})};
    },
  });
  const result=await director.attempt({candidates:[],socialProposal:f.proposal,
    facts:{speakerCaptureRef:f.speaker,playerCaptureRef:f.player,nowMonotonicMs:1000},
    stamp:f.stamp});
  assert.equal(result.status,'delivered');
  assert.deepEqual(native,['reserve','submit','cancel']);
  assert.deepEqual(stages,['hydrated','publication']);
});
test('missing native social entitlement always blocks speech',async()=>{
  const f=fixture();let requests=0;
  const director=new SceneDirectorSpeech({
    mode:'active',now:()=>1000,admission:{setEnabled:()=>{}},
    originalEntitlement:()=>null,nativeRequest:async()=>{requests++;return null},
    dispatch:async()=>null,
  });
  assert.equal((await director.attempt({socialProposal:f.proposal,stamp:f.stamp})).status,'native_social_unavailable');
  assert.equal(requests,0);
});

test('native busy social admission defers one bounded retry, never a burst',async()=>{
  const f=fixture();let clock=1000;const calls=[];
  const runtime={
    epoch:'native-run',hostContext:{worldEpoch:1},directorRequestVersion:1,
    anchors:new Map([[f.player,{kind:'player',captureRef:f.player}]]),
    observerIndex:new Map([[f.speaker,{owned:true,kind:'ped'}]]),
    now:()=>clock,current:()=>true,stalled:()=>false,
    directorOwnerProofFor:()=>f.stamp,directorCandidatesFor:()=>[],
    directorSocialFor:()=>f.proposal,
    directorPriority:{experimentalEnabled:true,playerTurnVersion:2,
      receivedAt:1000,hostRunId:f.host,worldEpoch:1},
  };
  const pump=new DirectorObservationPump({
    client:{runtime},now:()=>clock,stampFor:()=>f.stamp,
    coordinator:{mode:'active',pacingVeto:()=>null,attempt:async()=>{
      calls.push(clock);
      return calls.length===1?{status:'native_rejected',nativeReason:'busy'}:{status:'delivered'};
    }},
  });
  await pump.tick();await pump.tick();
  assert.equal(calls.length,1);
  clock=3999;runtime.directorPriority.receivedAt=3999;
  await pump.tick();assert.equal(calls.length,1);
  clock=4000;runtime.directorPriority.receivedAt=4000;
  await pump.tick();await pump.tick();
  assert.deepEqual(calls,[1000,4000]);
});
test('a native-busy unconsumed ticket restores local cooldown but retains attempt budget',()=>{
  let clock=1000;
  const f=fixture();
  const reservations=new DirectorSpeechReservations({
    now:()=>clock,checkCurrent:()=>true,acknowledge:()=>true,enabled:true,
  });
  const first=reservations.reserve(f.proposal,f.stamp);
  assert.ok(first);
  assert.equal(reservations.pacingVeto(f.proposal),'ticket_already_active');
  assert.equal(reservations.deferNativeBusy(first.ticketId),true);
  assert.equal(reservations.pacingVeto(f.proposal),null);
  const retry=reservations.reserve(f.proposal,f.stamp);
  assert.ok(retry);
  assert.notEqual(first.ticketId,retry.ticketId);
});
test('native-reserved social ticket can finish hydration after scene initiation expires',()=>{
  let clock=1000;
  const f=fixture();
  const proposal={...f.proposal,expiresAtMonotonicMs:2000};
  const admission=new DirectorSpeechReservations({
    now:()=>clock,checkCurrent:({stage})=>stage!=='reserve' || clock<=2000,
    acknowledge:()=>true,enabled:true,
  });
  const ticket=admission.reserve(proposal,f.stamp);
  assert.ok(ticket);
  clock=1200;
  assert.equal(admission.consume(ticket.ticketId,f.stamp),true);
  clock=2400; // No NEW scene may start, but bound stock authority is preserved.
  assert.equal(admission.afterHydration(ticket.ticketId,f.stamp),true);
  assert.equal(admission.beforePublication(ticket.ticketId,f.stamp),true);
  assert.equal(admission.bindNativeTuple(ticket.ticketId,f.stamp,{
    pedId:'19',turnId:'trusted',sessionNonce:1,generationId:1,
  }),true);
  admission.cancel(ticket.ticketId);
  assert.equal(admission.reserve(proposal,f.stamp),null);
});

test('expired social opportunities never become new grants, but verified reserved ticket stays pinned',()=>{
  const f=fixture(),ticket=randomUUID(),at=17000;
  const source=Object.freeze({
    source:'native_director_social',hostRunId:f.host,worldEpoch:1,
    speakerCaptureRef:f.speaker,playerCaptureRef:f.player,
    ownerIncarnationId:f.owner,proofRevision:1,
    observationId:f.scene,observationRevision:1,
    decisionKey:f.proposal.decisionKey,policyVersion:1,
    expiresAtMonotonicMs:f.proposal.expiresAtMonotonicMs,ageMs:200,
  });
  const client=Object.create(IntelligenceClient.prototype);
  client.closed=false;
  client.config={mode:'shadow'};
  client.socket={destroyed:false,writable:true};
  client.directorNativeReserved=new Set();
  client.directorOwnerReservations=new Map([[ticket,{
    source,stamp:f.stamp,proposal:f.proposal,nativeReservedAt:12000,
  }]]);
  client.runtime={
    epoch:'connected',directorRequestVersion:1,
    now:()=>at,current:()=>true,directorSocialEntitlementFor:()=>null,
    directorOwnerProofFor:()=>f.stamp,
    directorPriority:{experimentalEnabled:true,hostRunId:f.host,
      worldEpoch:1,playerTurnVersion:2,receivedAt:at},
    socialScenes:new Map([[f.speaker,{sceneId:f.scene}]]),
  };
  assert.equal(client.directorOriginalEntitlement(f.proposal,f.stamp),null);
  assert.equal(client.directorOriginalEntitlement(f.proposal,f.stamp,ticket),null);
  client.directorNativeReserved.add(ticket);
  assert.equal(client.directorOriginalEntitlement(f.proposal,f.stamp,ticket),source);
  client.runtime.directorPriority.playerTurnVersion=3;
  assert.equal(client.directorOriginalEntitlement(f.proposal,f.stamp,ticket),null);
  client.runtime.directorPriority.playerTurnVersion=2;
  client.runtime.socialScenes.set(f.speaker,{sceneId:randomUUID()});
  assert.equal(client.directorOriginalEntitlement(f.proposal,f.stamp,ticket),null);
  client.runtime.socialScenes.set(f.speaker,{sceneId:f.scene});
  client.directorNativeReserved.delete(ticket);
  assert.equal(client.directorOriginalEntitlement(f.proposal,f.stamp,ticket),null);
});
