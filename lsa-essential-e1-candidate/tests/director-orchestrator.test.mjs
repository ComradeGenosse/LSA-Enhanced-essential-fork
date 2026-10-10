import test from 'node:test';
import assert from 'node:assert/strict';
import {DirectorSpeechReservations} from '../src/perception/sceneDirectorAdmission.mjs';
import {SceneDirectorSpeech} from '../src/perception/sceneDirectorOrchestrator.mjs';
const speaker='d34713cd-ff8e-4ab3-9f83-241a8cf812c7';
const player='24846870-fdcc-444f-9aca-7487d4c01048';
const observationId='c9f50874-c003-4437-a944-9200cf6e30e5';
const now=100000;
const facts={speakerCaptureRef:speaker,playerCaptureRef:player,nowMonotonicMs:now};
const stamp={hostRunId:'a1111111-1111-4111-8111-111111111111',
 worldEpoch:1,speakerCaptureRef:speaker,playerCaptureRef:player,
 ownerIncarnationId:'e1111111-1111-4111-8111-111111111111',
 proofRevision:1,playerTurnVersion:1,policyVersion:1};
const candidate={
 entitlementCurrent:true,observedAtMonotonicMs:now-100,
 observation:{observationId,revision:1,eventType:'firing_burst',severity:'danger',observer:{captureRef:speaker,kind:'ped'},
   expiresAtMonotonicMs:now+5000,claims:[{kind:'firing',certainty:'supported',evidence:{channel:'visual'}}]},
 decision:{observationId,revision:1,decisionKey:'ps3-original-decision',
   policyVersion:1,response:'eligible',expiresAtMonotonicMs:now+5000},
 situation:{lifetimeCurrent:true,channelHealthy:true,perceptionSupported:true,playerCaptureRef:player},
};
const tuple={pedId:'17',sessionNonce:1,turnId:'real-stock-turn-id',generationId:1};
const completed={type:'playback_ended',reason:'completed',wasInterrupted:false,hadAudio:true,playbackStarted:true};
let counter;
function fixture({mode='active',nativeStatus,terminal=completed,gateOk=true,approve=true,
                  sourcePresent=true,revokeAfterNative=null,sourceTransform=record=>record}={}){
 counter=0;
 const acknowledgements=[],native=[],dispatches=[];
 let sourceCurrent=sourcePresent;
 const admission=new DirectorSpeechReservations({now:()=>now,enabled:mode==='active',
  checkCurrent:()=>approve,
  uuid:()=>`00000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`,
  acknowledge:(...args)=>{acknowledgements.push(args);return true;}});
 const director=new SceneDirectorSpeech({admission,now:()=>now,mode,
  originalEntitlement:(proposal,s)=>sourceCurrent?sourceTransform({
    source:'original_companion_ps2_ps3',
    hostRunId:s.hostRunId,worldEpoch:s.worldEpoch,
    speakerCaptureRef:proposal.speakerCaptureRef,playerCaptureRef:proposal.playerCaptureRef,
    ownerIncarnationId:s.ownerIncarnationId,proofRevision:s.proofRevision,
    observationId:proposal.observationId,observationRevision:proposal.observationRevision,
    decisionKey:proposal.decisionKey,policyVersion:proposal.policyVersion,
    expiresAtMonotonicMs:proposal.expiresAtMonotonicMs,
  }):null,
  nativeRequest:async r=>{native.push(r);if(revokeAfterNative===r.operation)sourceCurrent=false;return {ticketId:r.ticket.ticketId,status:nativeStatus?.[r.operation]??{reserve:'reserved',submit:'submitted',cancel:'cancelled'}[r.operation]};},
  dispatch:async r=>{dispatches.push(r);
   if(gateOk){assert.equal(r.gates.hydrated(),true);assert.equal(r.gates.publication(),true);}
   return {tuple,terminal:Promise.resolve(terminal)};
  },
 });
 return {director,admission,acknowledgements,native,dispatches};
}
test('shadow selection makes zero native requests, model calls and reservations',async()=>{
 const f=fixture({mode:'shadow'});
 const result=await f.director.attempt({candidates:[candidate],facts,stamp});
 assert.equal(result.status,'shadow');
 assert.deepEqual(f.native,[]);assert.deepEqual(f.dispatches,[]);
 assert.equal(f.admission.active,null);
});
test('complete exact native reserve/submit/hydration/publication/playback consumes once',async()=>{
 const f=fixture();const result=await f.director.attempt({candidates:[candidate],facts,stamp});
 assert.equal(result.status,'delivered');
 assert.deepEqual(f.native.map(r=>r.operation),['reserve','submit','cancel']);
 assert.equal(f.dispatches.length,1);
 assert.deepEqual(f.acknowledgements,[['ps3-original-decision','ps6_ticket','delivered']]);
 assert.equal(f.admission.active,null);
 assert.match(f.dispatches[0].eventContext,/seen gunfire/);
 assert.match(f.dispatches[0].eventContext,/dialogue only, no actions/);
 assert.ok(f.dispatches[0].eventContext.length<=160);
 assert.equal(f.dispatches[0].faceListener,false);
 assert.equal(f.dispatches[0].interruptExisting,false);
});
test('native admission denial never asks Essential to speak',async()=>{
 const f=fixture({nativeStatus:{reserve:'busy'}});
 assert.equal((await f.director.attempt({candidates:[candidate],facts,stamp})).status,'native_rejected');
 assert.deepEqual(f.native.map(r=>r.operation),['reserve']);
 assert.equal(f.dispatches.length,0);
 assert.equal(f.acknowledgements.length,0);
});
test('hydration/Pre-publication native proof absence cannot grant playback',async()=>{
 const f=fixture({gateOk:false});
 assert.equal((await f.director.attempt({candidates:[candidate],facts,stamp})).status,'incomplete_intake');
 assert.equal(f.acknowledgements.length,0);
});
test('partial audio or interrupted playback does not consume PS3 response grant',async()=>{
 const f=fixture({terminal:{...completed,wasInterrupted:true}});
 assert.equal((await f.director.attempt({candidates:[candidate],facts,stamp})).status,'not_delivered');
 assert.equal(f.acknowledgements.length,0);
});
test('player takeover or C06 safety veto causes zero native requests',async()=>{
 const f=fixture({approve:false});
 assert.equal((await f.director.attempt({candidates:[candidate],facts,stamp})).status,'not_admitted');
 assert.deepEqual(f.native,[]);
 assert.equal(f.acknowledgements.length,0);
});
test('feature gate off cannot enter native or Essential',async()=>{
 const f=fixture({mode:'off'});
 assert.equal((await f.director.attempt({candidates:[candidate],facts,stamp})).status,'off');
 assert.deepEqual(f.native,[]);
});

test('missing original PS3 reader or copied grant cannot reach native or Essential',async()=>{
 const absent=fixture({sourcePresent:false});
 assert.equal((await absent.director.attempt({candidates:[candidate],facts,stamp})).status,
   'original_ps3_unavailable');
 assert.deepEqual(absent.native,[]);assert.deepEqual(absent.dispatches,[]);
 const copied=fixture({sourceTransform:r=>({...r,observationRevision:r.observationRevision+1})});
 assert.equal((await copied.director.attempt({candidates:[candidate],facts,stamp})).status,
   'original_ps3_unavailable');
 assert.deepEqual(copied.native,[]);
 const noReader=new SceneDirectorSpeech({
   admission:absent.admission,now:()=>now,mode:'active',
   nativeRequest:async()=>{throw new Error('never');},
   dispatch:async()=>{throw new Error('never');},
 });
 assert.equal((await noReader.attempt({candidates:[candidate],facts,stamp})).status,
   'original_ps3_unavailable');
});
test('original PS3 entitlement revoked during async native reserve never submits or dispatches',async()=>{
 const f=fixture({revokeAfterNative:'reserve'});
 assert.equal((await f.director.attempt({candidates:[candidate],facts,stamp})).status,
   'stale_after_reserve');
 assert.deepEqual(f.native.map(r=>r.operation),['reserve','cancel']);
 assert.deepEqual(f.dispatches,[]);
 assert.deepEqual(f.acknowledgements,[]);
});
test('original PS3 entitlement revoked during native submit cannot reach kb intake',async()=>{
 const f=fixture({revokeAfterNative:'submit'});
 assert.equal((await f.director.attempt({candidates:[candidate],facts,stamp})).status,
   'stale_before_intake');
 assert.deepEqual(f.native.map(r=>r.operation),['reserve','submit','cancel']);
 assert.deepEqual(f.dispatches,[]);
 assert.deepEqual(f.acknowledgements,[]);
});
