import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {validateDirectorSocialPayload} from '../src/perception/contracts.mjs';
import {renderDirectorSocialContext} from '../src/perception/directorSocialContext.mjs';
import {DirectorObservationPump} from '../src/perception/directorProduction.mjs';
import {SceneDirectorSpeech} from '../src/perception/sceneDirectorOrchestrator.mjs';

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
  for(const sceneType of ['shared_vehicle_entry','reunion','shared_idle','travel','activity_transition','manual']){
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
