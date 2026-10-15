import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {randomUUID as id} from 'node:crypto';
import {createRuntimeForBundle} from '../src/bootstrap.mjs';
import {CAPABILITIES} from '../src/perception/contracts.mjs';
import {verifyPerceptionContract} from '../tools/verifyPerceptionContract.mjs';
import {IDENTITY_DLL_SHA256,IDENTITY_METADATA_SHA256} from '../src/identity/nativeSupport.mjs';
import {CHARACTER_METADATA_SHA256} from '../src/characters/nativeSupport.mjs';
import {worldProfileId,TestOwnerEvidence} from './identity-fixtures.mjs';
import {profile} from './p2-fixtures.mjs';
import {createM5SqliteServices} from '../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';
import {migrateJournalSchema} from '../../lsa-shared-brain/src/memory/journalSqlite.mjs';

const hop=()=>new Promise(r=>setImmediate(()=>setImmediate(r)));
async function fixture(t,{events='on',coverage='on',ps2='on',ps1='on',storage='sqlite',legacy=false}={}){
  const root=await mkdtemp(path.join(tmpdir(),'memory-g-bootstrap-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const configPath=path.join(root,'config.json');
  await writeFile(configPath,JSON.stringify({provider:'openai',intelligence:{mode:'shadow'},
    persistentIdentity:{enabled:true,worldProfileId,storePath:path.join(root,'identity.json')},
    promotedCharacters:{enabled:true,storageMode:storage,sqliteStorePath:path.join(root,'p2.sqlite'),storePath:path.join(root,'profiles.json')},
    ...legacy?{}:{memoryK:{capabilities:{'ps1.producers':ps1,'ps2.observations':ps2,
      'ps3.salience':'off','memory.dialogue.player':'off','memory.dialogue.npc':'off',
      'memory.events':events,'memory.coverage':coverage,'memory.promotionGrace':'on'}}}}));
  let socket,streamId=id(),adapterEpoch=id(),seq=0,clock=1000000;
  const host={hostContextVersion:1,hostRunId:id(),worldEpoch:1};
  const runtime=await createRuntimeForBundle({configPath,env:{},enableTelemetry:false,startCharacterEditor:false,
    identityEvidence:new TestOwnerEvidence(),
    identityContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,metadataSha256:IDENTITY_METADATA_SHA256,nativeProtocolChanged:false},
    characterContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,metadataSha256:CHARACTER_METADATA_SHA256,nativeProtocolChanged:false},
    perceptionContract:await verifyPerceptionContract(),
    fetchImpl:()=>{throw new Error('unexpected_provider_call');},
    intelligenceOptions:{now:()=>clock,report:()=>{},connect:()=>{
      socket=new EventEmitter();socket.write=()=>true;
      socket.destroy=()=>{if(socket.destroyed)return;socket.destroyed=true;socket.emit('close');};
      return socket;
    }}});
  t.after(()=>runtime.dispose());
  const store=runtime.characterService.store;
  const npc=await store.create(profile()),ref=id(),incarnationId=id(),encounterId=id(),player=id();
  const raw=async f=>{socket.emit('data',Buffer.from(JSON.stringify(f)+'\n'));await hop();};
  const send=(type,payload)=>raw({version:1,type,adapterEpoch,streamId,sequence:++seq,payload});
  const establish=async()=>{
    await raw({version:1,type:'hello',adapterEpoch,streamId,...host,observerIndexVersion:1,
      capabilities:Object.fromEntries(CAPABILITIES.map(k=>[k,k!=='playerSpeech']))});
    await send('anchors',[{captureRef:ref,kind:'ped',observer:true,owned:true},{captureRef:player,kind:'player',observer:false}]);
    await send('observer_index',[{captureRef:ref,kind:'ped',owned:true,incarnationId,encounterId}]);
  };
  await establish();
  const timelineId=storage==='sqlite'?await store.createTimeline({label:'G bootstrap'}):null;
  if(timelineId)await store.confirmTimeline(timelineId);
  const owner=()=>send('memory_authority',{memoryProofVersion:1,hostRunId:host.hostRunId,worldEpoch:1,sampledGameTick:clock,
    owners:[{ownerAlias:npc.promotion.ownerAlias,observerCaptureRef:ref,hostRunId:host.hostRunId,worldEpoch:1,
      incarnationId,encounterId,sampledGameTick:clock}],protagonist:null,acceptedTurns:[]});
  const signal=()=>({signalId:id(),producer:'shooting',producerSequence:1,kind:'firing',source:player,target:null,
    gameTick:clock,ageMs:0,facts:{},witnessReceipts:[{observer:{captureRef:ref,kind:'ped'},status:'witnessed',
      sampledGameTick:clock,reason:'visual_clear',knowsSource:true,knowsTarget:false,
      evidence:{channel:'visual',basis:'sampled_state',sampledGameTick:clock}}]});
  return {runtime,store,npc,timelineId,send,signal,owner,
    async sample(){
      if(clock%1000===0){
        await send('anchors',[{captureRef:ref,kind:'ped',observer:true,owned:true},{captureRef:player,kind:'player',observer:false}]);
        await send('observer_index',[{captureRef:ref,kind:'ped',owned:true,incarnationId,encounterId}]);
      }
      await owner();clock+=250;
    },
    async reconnect(){socket.destroy();streamId=id();adapterEpoch=id();seq=0;runtime.intelligence.start();
      await establish();if(timelineId)await store.confirmTimeline(timelineId);},
    disconnect(){socket.destroy();}};
}

for(const [events,coverage] of [['on','off'],['off','on'],['on','on'],['off','off']])
test(`G bootstrap actual controls: events ${events}, coverage ${coverage}, M2/PS3 off`,async t=>{
  const f=await fixture(t,{events,coverage,ps2:events==='on'?'on':'off',ps1:events==='on'?'on':'off'});
  const {runtime,store,npc,timelineId}=f;
  assert.equal(runtime.intelligence.runtime.salience,null);
  if(events==='off'&&coverage==='off'){
    assert.equal(runtime.memoryM3,undefined);
    assert.equal(runtime.intelligence.memoryAuthoritySubscriptions.size,0);
    assert.equal(runtime.intelligence.runtime.acceptedObservationTap,null);
  }else{
    assert.ok(runtime.memoryM3);assert.equal(runtime.intelligence.memoryAuthoritySubscriptions.size,1);
  }
  await f.sample();await f.send('signal',f.signal());
  for(let i=0;i<40;i++)await f.sample();
  // The production worker is asynchronous; read via the same serialized P2
  // queue after event-loop turns, then independently inspect durable counters.
  await hop();await hop();
  const rows=await store.readJournalEvents({characterId:npc.characterId,timelineId});
  assert.equal(rows.length,events==='on'?1:0);
  assert.equal((await store.readDialogueLines({characterId:npc.characterId,timelineId})).length,0);
  const states=runtime.services.memoryKRuntimeDiagnostics().capabilities;
  assert.equal(states['memory.events'].effectiveMode,events);
  assert.equal(states['memory.coverage'].effectiveMode,coverage);
  assert.equal(states['memory.promotionGrace'].state,'unavailable');
  if(events==='on')assert.equal(states['memory.events'].operationalState,'operational');
  if(coverage==='on')assert.equal(states['memory.coverage'].operationalState,'operational',JSON.stringify(states['memory.coverage']));
  if(coverage==='off')assert.equal(runtime.memoryM3?.snapshot().coverage??null,null);
  const covered=await store.readObserverCoverage({characterId:npc.characterId,worldProfileId,timelineId,
    fromUtc:'2020-01-01T00:00:00.000Z',toUtc:'2030-01-01T00:00:00.000Z'});
  if(coverage==='on'&&events==='off'){
    assert.ok(covered.nativeSamples.length>0);assert.equal(covered.complete,false);
  }
  f.disconnect();
  if(events==='on')assert.equal(runtime.services.memoryKRuntimeDiagnostics().capabilities['memory.events'].operationalState,'blocked');
  await runtime.dispose();
  assert.equal(runtime.services.memoryKRuntimeDiagnostics().capabilities['memory.events'].effectiveMode,'off');
  assert.equal(runtime.services.memoryKRuntimeDiagnostics().capabilities['memory.coverage'].effectiveMode,'off');
  assert.equal(runtime.intelligence.memoryAuthoritySubscriptions.size,0);
});

test('G bootstrap blocks event on with PS2 off while coverage remains independent',async t=>{
  const f=await fixture(t,{events:'on',coverage:'on',ps2:'off',ps1:'off'});
  assert.equal(f.runtime.intelligence.runtime.correlator,null);
  assert.equal(f.runtime.intelligence.runtime.acceptedObservationTap,null);
  const row=f.runtime.services.memoryKRuntimeDiagnostics().capabilities['memory.events'];
  assert.equal(row.requestedMode,'on');assert.equal(row.effectiveMode,'off');assert.equal(row.reason,'dependency_blocked');
  for(let i=0;i<40;i++)await f.sample();await hop();
  assert.equal(f.runtime.services.memoryKRuntimeDiagnostics().capabilities['memory.coverage'].state,'operational');
});

test('G bootstrap without SQLite blocks both requests and subscribes no M3 work',async t=>{
  const f=await fixture(t,{storage:'json'});
  assert.equal(f.runtime.memoryM3,undefined);assert.equal(f.runtime.intelligence.memoryAuthoritySubscriptions.size,0);
  for(const kind of ['events','coverage']){
    const row=f.runtime.services.memoryKRuntimeDiagnostics().capabilities['memory.'+kind];
    assert.equal(row.state,'blocked');assert.equal(row.requestedMode,'on');assert.equal(row.effectiveMode,'off');
  }
});

test('G bootstrap preserves unconfigured legacy M3 and closes its original lifecycle',async t=>{
  const f=await fixture(t,{legacy:true});assert.ok(f.runtime.memoryM3);
  assert.ok(f.runtime.intelligence.runtime.salience);
  assert.equal(f.runtime.memoryM3.snapshot().eventMode,'on');
  assert.equal(f.runtime.memoryM3.snapshot().coverageMode,'on');
  await f.runtime.dispose();assert.equal(f.runtime.memoryM3.snapshot().closed,true);
});

test('G native disconnect/reconnect refuses retired replay and requires fresh evidence',async t=>{
  const f=await fixture(t,{coverage:'off'}),{runtime,store,npc,timelineId}=f;
  let receipt;const tap=runtime.intelligence.runtime.acceptedObservationTap;
  runtime.intelligence.runtime.acceptedObservationTap=r=>{receipt=r;return tap(r);};
  await f.sample();await f.send('signal',f.signal());await hop();
  assert.equal((await store.readJournalEvents({characterId:npc.characterId,timelineId})).length,1);
  await f.reconnect();await f.sample();
  assert.equal(tap(receipt).accepted,false,'old stream cannot borrow new authenticated owner evidence');
  const signal=f.signal();signal.producerSequence=2;
  await f.send('signal',signal);await hop();
  assert.equal((await store.readJournalEvents({characterId:npc.characterId,timelineId})).length,2);
  assert.equal(runtime.memoryM3.snapshot().duplicate,0);
});

for(const legacy of [false,true])for(const forgotten of [false,true,'purged'])test(`G raw native signal replay across reconnect is fenced (forgotten=${forgotten}, legacy=${legacy})`,async t=>{
  const f=await fixture(t,{coverage:'off',legacy}),{runtime,store,npc,timelineId}=f;
  await f.sample();const signal=f.signal();await f.send('signal',signal);await hop();
  const [event]=await store.readJournalEvents({characterId:npc.characterId,timelineId});assert.ok(event);
  if(forgotten){
    let now=Date.now();const scope={worldProfileId,characterId:npc.characterId,timelineId,protagonistKey:'franklin'};
    const privacy=createM5SqliteServices({store,filePath:store.filePath,authorize:()=>true,clock:()=>new Date(now).toISOString()});
    await privacy.trash({scope,targetId:event.recordId,operationId:id()});
    if(forgotten==='purged'){now+=8*86400000;await privacy.purgeExpired({scope});}
  }
  await f.reconnect();await f.sample();await f.send('signal',signal);await hop();
  assert.equal((await store.readJournalEvents({characterId:npc.characterId,timelineId})).length,forgotten==='purged'?0:1,
    'the same immutable native signal must not become another durable observation after PS2 resets');
  assert.equal(runtime.memoryM3.snapshot().committed,1);
  assert.equal(runtime.memoryM3.snapshot().duplicate,forgotten?0:1);
  assert.equal(runtime.memoryM3.snapshot().lost,forgotten?1:0);
});

for(const corruption of [false,true])test(`G native receipt upgrade preserves original evidence and refuses corrupt receipts (${corruption})`,async t=>{
  const f=await fixture(t,{coverage:'off'}),{runtime,store,npc,timelineId}=f;
  const scope={worldProfileId,characterId:npc.characterId,timelineId,protagonistKey:'franklin'};
  await f.sample();const signal=f.signal();await f.send('signal',signal);await hop();
  const [event]=await store.readJournalEvents(scope);
  const before=await store.readVerifiedEventEvidence({...scope,recordId:event.recordId});
  await store.withTimelineSqliteWrite(scope,db=>{
    if(corruption)db.prepare("UPDATE event_native_receipts SET receipt_sha256=?").run('0'.repeat(64));
    else{db.exec('DROP TABLE event_native_receipts');migrateJournalSchema(db);}
  });
  await f.reconnect();await f.sample();await f.send('signal',signal);await hop();
  assert.equal((await store.readJournalEvents(scope)).length,1);
  assert.deepEqual(await store.readVerifiedEventEvidence({...scope,recordId:event.recordId}),before);
  assert.equal(runtime.memoryM3.snapshot().duplicate,corruption?0:1);
  if(corruption)assert.equal(runtime.services.memoryKRuntimeDiagnostics().capabilities['memory.events'].reason,'journal_native_receipt_integrity');
});

test('G already-purged pre-upgrade evidence stays unknown and blocks native privacy resurrection',async t=>{
  const f=await fixture(t,{coverage:'off'}),{runtime,store,npc,timelineId}=f;
  const scope={worldProfileId,characterId:npc.characterId,timelineId,protagonistKey:'franklin'};
  await f.sample();const signal=f.signal();await f.send('signal',signal);await hop();
  const [event]=await store.readJournalEvents(scope);let now=Date.now();
  const privacy=createM5SqliteServices({store,filePath:store.filePath,authorize:()=>true,clock:()=>new Date(now).toISOString()});
  await privacy.trash({scope,targetId:event.recordId,operationId:id()});now+=8*86400000;await privacy.purgeExpired({scope});
  // Simulate a v4 installation whose old purged sidecar predates G's index.
  await store.withTimelineSqliteWrite(scope,db=>{db.exec('DROP TABLE event_native_receipts');migrateJournalSchema(db);});
  await f.reconnect();await f.sample();await f.send('signal',signal);await hop();
  assert.equal((await store.readJournalEvents(scope)).length,0);
  assert.equal(runtime.services.memoryKRuntimeDiagnostics().capabilities['memory.events'].reason,'journal_native_privacy_unresolved');
});
