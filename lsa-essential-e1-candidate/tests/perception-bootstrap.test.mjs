import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRuntimeForBundle } from '../src/bootstrap.mjs';
import {normalizeConfig} from '../src/config/e1Config.mjs';
import { verifyPerceptionContract } from '../tools/verifyPerceptionContract.mjs';
test('bootstrap off/shadow parity: no provider, profile store, owner command or model context side effect',async()=>{
  const temp=await mkdtemp(path.resolve('.build-check-perception-'));const contract=await verifyPerceptionContract();let calls=0,connects=0;
  const forbidden=()=>{calls++;throw new Error('Unexpected side effect');};
  try {
    for(const mode of ['off','shadow']) {
      const configPath=path.join(temp,mode+'.json');await writeFile(configPath,JSON.stringify({intelligence:{mode},promotedCharacters:{enabled:false},persistentIdentity:{enabled:false}}));
      const socket=new EventEmitter();socket.destroy=()=>socket.emit('close');
      const runtime=await createRuntimeForBundle({configPath,env:{},enableTelemetry:false,startCharacterEditor:false,perceptionContract:contract,fetchImpl:forbidden,profileStore:{initialize:forbidden,memory:forbidden},nativeOwner:{request:forbidden},intelligenceOptions:{connect:()=>{connects++;return socket;},report:forbidden}});
      const actor={pedId:'2',activity:'ordinary'};assert.equal(runtime.modelActor(actor),actor);assert.equal(runtime.history.sessions?.size||0,0);
      if(mode==='shadow') {assert.ok(runtime.intelligence);runtime.intelligence.stop();}else assert.equal(runtime.intelligence,undefined);
    }
    assert.equal(connects,1);assert.equal(calls,0);
    const configPath=path.join(temp,'missing.json');await writeFile(configPath,JSON.stringify({intelligence:{mode:'shadow'}}));
    const runtime=await createRuntimeForBundle({configPath,env:{},enableTelemetry:false,perceptionContract:{available:false},fetchImpl:forbidden,intelligenceOptions:{connect:forbidden}});
    assert.equal(runtime.intelligence,undefined);assert.equal(calls,0);
  }finally {await rm(temp,{recursive:true,force:true});}
});


test('bootstrap knowledge support is separate from PS collection and requires both manifest contracts',async()=>{
 const temp=await mkdtemp(path.resolve('.build-check-knowledge-'));const perceptionContract=await verifyPerceptionContract();
 const dialogueKnowledgeContract={available:true,frameVersion:1,hostContextVersion:1,observerIndexVersion:1,observerSituationVersion:1};
 try {
  const configPath=path.join(temp,'config.json');await writeFile(configPath,JSON.stringify({dialogueKnowledge:{mode:'shadow'},intelligence:{mode:'off'},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}}));
  for(const [contract,pins,supported] of [[dialogueKnowledgeContract,perceptionContract,true],[{...dialogueKnowledgeContract,available:false},perceptionContract,false],[dialogueKnowledgeContract,{...perceptionContract,dllSha256:'bad'},false],[null,perceptionContract,false]]){
   const runtime=await createRuntimeForBundle({configPath,env:{},enableTelemetry:false,startCharacterEditor:false,dialogueKnowledgeContract:contract,perceptionContract:pins,fetchImpl:()=>{throw new Error('No inference expected');}});
   assert.equal(runtime.dialogueKnowledgeBuildSupported,supported);assert.equal(runtime.intelligence,undefined);assert.equal(runtime.config.dialogueKnowledge.mode,'shadow');
  }
 }finally {await rm(temp,{recursive:true,force:true});}
});


test('spontaneous speech testing preset is explicit opt-in and strictly validated',()=>{
 const base={intelligence:{mode:'shadow'},spontaneousSpeech:{mode:'experimental'}};
 assert.equal(normalizeConfig(base,{}).spontaneousSpeech.preset,'normal');
 assert.equal(normalizeConfig({...base,spontaneousSpeech:{mode:'experimental',preset:'testing'}},{}).spontaneousSpeech.preset,'testing');
 for(const spontaneousSpeech of [{mode:'shadow',preset:'testing'},{mode:'off',preset:'testing'},
  {mode:'experimental',preset:'unlimited'},{mode:'experimental',preset:'testing',attemptsPerMinute:999}])
  assert.throws(()=>normalizeConfig({...base,spontaneousSpeech},{}));
});
