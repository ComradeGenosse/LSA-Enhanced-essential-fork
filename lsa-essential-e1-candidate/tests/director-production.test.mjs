import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {normalizeConfig} from '../src/config/e1Config.mjs';
import {DirectorObservationPump} from '../src/perception/directorProduction.mjs';
import {createRuntimeForBundle} from '../src/bootstrap.mjs';
import {verifyPerceptionContract} from '../tools/verifyPerceptionContract.mjs';

const speaker='d34713cd-ff8e-4ab3-9f83-241a8cf812c7';
const player='24846870-fdcc-444f-9aca-7487d4c01048';
const observationId='c9f50874-c003-4437-a944-9200cf6e30e5';
const candidate={
 entitlementCurrent:true,observedAtMonotonicMs:9900,
 observation:{observationId,revision:1,observer:{captureRef:speaker,kind:'ped'},
   expiresAtMonotonicMs:15000,claims:[{certainty:'supported',evidence:{channel:'visual'}}]},
 decision:{observationId,revision:1,decisionKey:'original-ps3-decision',
   policyVersion:1,response:'eligible',expiresAtMonotonicMs:15000},
 situation:{lifetimeCurrent:true,channelHealthy:true,perceptionSupported:true,
   playerCaptureRef:player},
};
test('default off and strict experimental configuration require real PS collection',()=>{
 assert.deepEqual(normalizeConfig({},{}).spontaneousSpeech,{mode:'off'});
 assert.equal(normalizeConfig({intelligence:{mode:'shadow'},spontaneousSpeech:{mode:'shadow'}},{}).spontaneousSpeech.mode,'shadow');
 assert.equal(normalizeConfig({intelligence:{mode:'shadow'},spontaneousSpeech:{mode:'experimental'}},{}).spontaneousSpeech.mode,'experimental');
 for(const value of [{mode:'active'},{mode:'experimental',enabled:true},true,null])
   assert.throws(()=>normalizeConfig({intelligence:{mode:'shadow'},spontaneousSpeech:value},{}),/spontaneousSpeech/);
 assert.throws(()=>normalizeConfig({spontaneousSpeech:{mode:'experimental'}},{}),/intelligence.mode/);
});

test('live PS3 candidate pump attempts only original owned candidates, once per epoch',async()=>{
 const attempts=[],results=[];
 const runtime={
   epoch:'original-run',directorRequestVersion:1,now:()=>10000,
   anchors:new Map([[player,{captureRef:player,kind:'player'}]]),
   observerIndex:new Map([[speaker,{kind:'ped',owned:true}]]),
   current:()=>true,
   directorOwnerProofFor:ref=>ref===speaker?{ownerIncarnationId:'native-owner'}:null,
   directorCandidatesFor:ref=>ref===speaker?[candidate]:[],
 };
 const pump=new DirectorObservationPump({client:{runtime},coordinator:{
   attempt:async input=>{attempts.push(input);return {status:'shadow'};}
 },onResult:outcome=>results.push(outcome.status)});
 assert.equal((await pump.tick()).status,'shadow');
 assert.equal(attempts.length,1);
 assert.equal(attempts[0].facts.speakerCaptureRef,speaker);
 assert.equal(attempts[0].facts.playerCaptureRef,player);
 assert.equal(await pump.tick(),null);
 assert.deepEqual(results,['shadow']);
 runtime.epoch='next-original-run';
 assert.equal((await pump.tick()).status,'shadow');
 assert.equal(attempts.length,2);
 pump.stop();assert.equal(await pump.tick(),null);
});

test('pump never infers PS3/native eligibility from target-only or disconnected state',async()=>{
 let calls=0;
 const runtime={
   epoch:null,directorRequestVersion:1,now:()=>10000,
   anchors:new Map([[player,{captureRef:player,kind:'player'}]]),
   observerIndex:new Map([[speaker,{kind:'ped',owned:true}]]),
   current:()=>true,directorOwnerProofFor:()=>null,
   directorCandidatesFor:()=>[candidate],
 };
 const pump=new DirectorObservationPump({client:{runtime},coordinator:{
   attempt:async()=>{calls++;return {status:'delivered'};}
 }});
 assert.equal(await pump.tick(),null);
 runtime.epoch='connected';
 assert.equal(await pump.tick(),null);
 runtime.directorOwnerProofFor=()=>({ownerIncarnationId:'native-owner'});
 runtime.directorCandidatesFor=()=>[];
 assert.equal(await pump.tick(),null);
 assert.equal(calls,0);
});

test('experimental config never starts production native or provider without proven dispatch handoff',async()=>{
 const temp=await mkdtemp(path.resolve('.build-check-director-startup-'));
 let requests=0;
 try {
   const configPath=path.join(temp,'e1.config.json');
   await writeFile(configPath,JSON.stringify({
     intelligence:{mode:'shadow'},spontaneousSpeech:{mode:'experimental'},
     persistentIdentity:{enabled:false},promotedCharacters:{enabled:false},
   }));
   const contract=await verifyPerceptionContract();
   const socket=new EventEmitter();
   socket.destroy=()=>socket.emit('close');
   const runtime=await createRuntimeForBundle({
     configPath,env:{},enableTelemetry:false,startCharacterEditor:false,
     perceptionContract:contract,
     intelligenceOptions:{connect:()=>socket,report:()=>{}},
     fetchImpl:()=>{requests++;throw new Error('unexpected reasoning');},
   });
   assert.ok(runtime.director);
   assert.deepEqual(runtime.services.spontaneousSpeechStatus(),{
     requested:'experimental',executionAvailable:false,
     reason:'native_opt_in_and_live_C06_required',
   });
   assert.equal((await runtime.director.tick()),null);
   assert.equal(requests,0);
   runtime.director.stop();runtime.intelligence?.stop();
 } finally {await rm(temp,{recursive:true,force:true});}
});

test('bounded Director gate diagnostics classify no owner proof and no PS3 candidate without dispatch',async()=>{
 const seen=[],runtime={
   epoch:null,directorRequestVersion:1,now:()=>10000,
   anchors:new Map([[player,{captureRef:player,kind:'player'}]]),
   observerIndex:new Map(),
   current:()=>true,directorOwnerProofFor:()=>null,
   directorCandidatesFor:()=>[],
 };
 const pump=new DirectorObservationPump({client:{runtime},coordinator:{
   attempt:async()=>{throw new Error('No admission without PS3');}
 },onDiagnostic:d=>seen.push(d.reason)});
 assert.equal(await pump.tick(),null);
 runtime.epoch='connected';
 assert.equal(await pump.tick(),null);
 runtime.observerIndex.set(speaker,{kind:'ped',owned:true});
 assert.equal(await pump.tick(),null);
 runtime.directorOwnerProofFor=()=>({ownerIncarnationId:'native-owner'});
 assert.equal(await pump.tick(),null);
 assert.equal(await pump.tick(),null);
 assert.deepEqual(seen,[
   'channel_or_protocol_unavailable','no_owned_observer',
   'owner_proof_unavailable','no_ps3_response_candidate',
 ]);
 pump.stop();
});
