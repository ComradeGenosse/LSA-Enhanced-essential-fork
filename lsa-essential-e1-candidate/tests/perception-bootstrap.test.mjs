import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { createRuntimeForBundle } from '../src/bootstrap.mjs';
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
