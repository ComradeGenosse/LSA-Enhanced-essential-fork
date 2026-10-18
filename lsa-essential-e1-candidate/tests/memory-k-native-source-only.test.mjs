import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {IntelligenceClient} from '../src/perception/intelligenceClient.mjs';
import {memoryKSourceActivation} from '../src/memory/sourceActivation.mjs';
import {createMemoryD02Port} from '../src/memory/memoryD02Port.mjs';
import {validateFrame} from '../src/perception/contracts.mjs';

test('D2 producer policy is included in actual native production and affected harness projects',async()=>{
  const projects=['promoted-characters/PromotedCharacters.csproj','promoted-characters/runtime-tests/RuntimeTests.csproj',
    'promoted-characters/ps-host-tests/PSHostTests.csproj','intelligence/integration-tests/IntegrationTests.csproj',
    'intelligence/tests/IntelligenceTests.csproj','intelligence/memory-m3-tests/MemoryM3Tests.csproj',
    'intelligence/m9-tests/M9NativeTests.csproj','intelligence/producer-policy-tests/ProducerPolicyTests.csproj'];
  for(const project of projects){
    const text=await readFile(new URL('../../native/'+project,import.meta.url),'utf8');
    assert.equal((text.match(/Compile Include="[^"]*NativeProducerPolicy.cs/g)??[]).length,1,project);
  }
  const production=await readFile(new URL('../../native/promoted-characters/PromotedCharacters.csproj',import.meta.url),'utf8');
  // M9 native sources are never compiled by default: the only reference is an
  // explicit LsaM9Native opt-in import, and no Compile item names an M9 file.
  const compiled=[...production.matchAll(/<Compile Include="([^"]+)"/g)].flatMap(x=>x[1].split(';'));
  assert.equal(compiled.some(x=>/intelligence\/m9\/|IntelligenceIntegration\.M9\.cs/.test(x)),false,'M9 families remain unregistered by default');
  const imports=[...production.matchAll(/<Import [^>]*>/g)].map(x=>x[0]).filter(x=>x.includes('m9'));
  assert.equal(imports.length,1);
  assert.match(imports[0],/Condition="'\$\(LsaM9Native\)'=='true'"/);
  const props=await readFile(new URL('../../native/intelligence/m9/M9Native.props',import.meta.url),'utf8');
  assert.match(props,/LSA_M9_NATIVE/);
  for(const file of ['M9NativeDamageAdapter','M9NativeFrameAdapter','M9OriginalVehicleCollisionProducer','M9StateSampler'])
    assert.ok(props.includes(file+'.cs'),file);
  const glue=await readFile(new URL('../../native/intelligence/IntelligenceIntegration.M9.cs',import.meta.url),'utf8');
  assert.ok(glue.startsWith('#if LSA_M9_NATIVE'),'glue is wholly conditional');
  assert.ok(glue.trimEnd().endsWith('#endif'));
  const policy=await readFile(new URL('../../native/intelligence/NativeProducerPolicy.cs',import.meta.url),'utf8');
  assert.match(policy,/m9Mode="off"/,'M9 native request defaults off');
});

test('D2 real native source-only wire is admitted by D1 strict private intake and current D02 port',async t=>{
  if(process.platform!=='win32'){t.skip('net481 Windows user-ACL pipe harness; portable producer policy runs separately on Linux');return;}
  const executable=new URL('../../native/intelligence/integration-tests/bin/Debug/net481/IntegrationTests.exe',import.meta.url);
  const {fileURLToPath}=await import('node:url');
  const {stdout}=await promisify(execFile)(fileURLToPath(executable),['--d2-source-only-wire'],{timeout:10000});
  const frames=stdout.split(/\r?\n/).filter(line=>line.startsWith('D2_WIRE ')).map(line=>JSON.parse(line.slice(8)));
  assert.ok(frames.length>4);for(const frame of frames)assert.equal(validateFrame(frame),true,frame.type);
  const samples=frames.filter(frame=>frame.type==='memory_current_owner_player');assert.equal(samples.length,4);
  assert.equal(frames.some(frame=>frame.type==='signal'),false);
  const alias=samples[0].payload.owners[0].ownerAlias,characterId=randomUUID();
  const store={worldProfileId:randomUUID(),verifiedHostContext:null,timelineWritable:true,
    list:()=>[{characterId,promotion:{ownerAlias:alias},status:'available'}]};
  const socket=new EventEmitter();socket.writable=true;socket.destroy=()=>{if(socket.destroyed)return;socket.destroyed=true;socket.emit('close');};
  const client=new IntelligenceClient({mode:'shadow',pipeName:'LSA.D2.Wire.Test'}, {
    connect:()=>socket,report:()=>{},
    consumers:memoryKSourceActivation({memoryK:{capabilities:{'ps1.producers':'off','ps2.observations':'off','ps3.salience':'off'}}}),
  });
  const off=client.subscribeVerifiedHostContext(context=>{store.verifiedHostContext=context;});
  const d02=createMemoryD02Port({intelligence:client,memoryStore:store});
  try{
    client.start();let lease,oldLease;
    const identity={pedId:'811',turnId:'native-wire-turn',generationId:1,sessionNonce:1};
    const verify=()=>d02.port.verifyCurrentOwnerAndPlayer({lease,identity,characterId,ownerAlias:alias});
    let sampleCount=0;
    for(const frame of frames){
      socket.emit('data',Buffer.from(JSON.stringify(frame)+'\n'));
      await new Promise(resolve=>setImmediate(()=>setImmediate(resolve)));
      if(frame.type==='memory_current_owner_player'){
        if(++sampleCount===1||sampleCount===3){lease=d02.port.bindActorAtTurnStart({pedId:'811',characterId,ownerAlias:alias});assert.ok(lease);assert.equal(verify(),null);}
        else assert.equal(verify()?.nativeCurrentOwnerVerified,true);
        if(sampleCount===2)oldLease=lease;
      }
      if(frame.type==='world_epoch')assert.equal(d02.port.verifyCurrentOwnerAndPlayer({lease:oldLease,identity,characterId,ownerAlias:alias}),null);
    }
    assert.equal(d02.port.status().settled,true);
    assert.equal(client.runtime.correlator,null);assert.equal(client.runtime.salience,null);
    assert.equal(client.runtime.counters.malformed,0);assert.equal(client.runtime.counters.gaps,0);
    socket.destroy();assert.equal(verify(),null,'native disconnect revokes proof');
  }finally{d02.close();off();client.stop();}
});
