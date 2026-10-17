import test from 'node:test';
import assert from 'node:assert/strict';
import {isNativeActorId} from '../../src/identity/nativeActorId.mjs';
import {createOriginalTurnActorLedger} from '../../src/memory/originalTurnActorLedger.mjs';
import {validateMemoryCurrentOwnerPlayerPayload,CAPABILITIES} from '../../src/perception/contracts.mjs';
import {ShadowRuntime} from '../../src/perception/shadowRuntime.mjs';
import {d01Harness} from './d01-harness.mjs';
import {decide} from '../../src/openai/decide.mjs';

test('native keyboard testPrompt is journaled and healthy roster refresh cannot cancel H1 inference', {timeout:45000},async t=>{
  const x=await d01Harness(t,{pedId:'00031002',config:{memoryK:{capabilities:{
    'memory.dialogue.player':'on','memory.dialogue.npc':'on','memory.journalContext':'on',
    'memory.recall':'off','memory.commands':'off','memory.interpretation':'off','memory.events':'off','memory.coverage':'off'}}}});
  x.h.runtime.intelligence=x.client;
  let refresh=false;
  x.h.runtime.services.decide=options=>decide({...options,config:x.h.runtime.config,fetchImpl:async(_url,init)=>{
    if(refresh){
      assert.ok(options.knowledgeProjection.modelAllocation.messages.some(row=>row.content==='My favorite soda is purple soda.'));
      x.native.stop();await x.native.idle();
      // Real intake notifies the model watcher after EACH roster frame,
      // even when the following owner sample shares the same pipe batch.
      await x.native.roster();
      assert.equal(init.signal.aborted,false,'unchanged roster cannot revoke current native evidence');
      await x.native.sample();x.native.start();
    }
    return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{
      type:'output_text',text:JSON.stringify({dialogue:'Purple soda.',command:''})}]}]}),{headers:{'content-type':'application/json'}});
  }});
  const first=await x.typed('My favorite soda is purple soda.',{type:'testPrompt'});
  assert.equal((await x.settled(first)).status,'completed');
  assert.equal((await x.journal()).players.length,1,'Core keyboard wire label is ordinary authored input');
  refresh=true;
  const next=await x.typed('What is my favorite soda?',{type:'testPrompt'});
  assert.equal((await x.settled(next)).status,'completed');
  assert.equal((await x.journal()).players.length,2);
  assert.equal(x.h.runtime.services.memoryJournalDiagnostics().contributedToModelRequest,true);
});

test('actor keys preserve RAGE hexadecimal and legacy decimal spellings',()=>{
  for(const value of ['00046b02','00060902','00041502','ffffffff','00000001','17','811'])
    assert.equal(isNativeActorId(value),true,value);
  for(const value of [null,17,{},'','0','00000000','00046B02','0x00046b02',' 00046b02','00046b02 ','-1','1.0','1e3','deadbeef00','2147483648','00046g02'])
    assert.equal(isNativeActorId(value),false,String(value));
});

test('original actor ledger records native spelling without numeric conversion',()=>{
  const ledger=createOriginalTurnActorLedger({readOriginalTurn:i=>({...i,source:'player_mic',inputTranscript:''})});
  const identity={pedId:'00046b02',turnId:'native-turn',generationId:1,sessionNonce:1};
  assert.equal(ledger.recordAtTurnCreation(identity,{}).nativeActorPedId,'00046b02');
  assert.equal(ledger.factsFor({...identity,pedId:'289538'}),null,'numeric equivalence is never actor equality');
});

test('wire owner admission accepts native key but retains exact schema and alias checks',()=>{
  const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
  const p={nativeOwnerPlayerProofVersion:1,source:'native_p2_owner_fiber_current_only',hostRunId:id(1),worldEpoch:1,sampledGameTick:100,
    owners:[{observerCaptureRef:id(2),incarnationId:id(3),encounterId:id(4),ownerAlias:'promoted.'+id(5),hostRunId:id(1),worldEpoch:1,nativeActorPedId:'00046b02',sampledGameTick:100}],
    protagonist:{source:'native_player_model',key:'franklin',playerCaptureRef:id(6),sampledGameTick:100}};
  assert.equal(validateMemoryCurrentOwnerPlayerPayload(p),true);
  const runtime=new ShadowRuntime({mode:'shadow',now:()=>100});
  const envelope={version:1,adapterEpoch:id(7),streamId:id(8)};
  assert.equal(runtime.ingest({...envelope,type:'hello',hostContextVersion:1,hostRunId:id(1),worldEpoch:1,
    observerIndexVersion:1,memoryCurrentOwnerPlayerVersion:1,
    capabilities:Object.fromEntries(CAPABILITIES.map(k=>[k,false]))},{authenticated:true}),true);
  for(const [sequence,type,payload] of [
    [1,'anchors',[{captureRef:id(2),kind:'ped',observer:true,owned:true},{captureRef:id(6),kind:'player',observer:false}]],
    [2,'observer_index',[{captureRef:id(2),kind:'ped',owned:true,incarnationId:id(3),encounterId:id(4)}]],
    [3,'memory_current_owner_player',p],
    [4,'anchors',[]]])
    assert.equal(runtime.ingest({...envelope,type,sequence,payload},{authenticated:true}),true,type);
  assert.equal(runtime.counters.malformed,0);
  assert.equal(runtime.counters.gaps,0);
  assert.equal(runtime.hostContext.hostRunId,id(1));
  assert.equal(validateMemoryCurrentOwnerPlayerPayload({...p,untrusted:true}),false);
  const bad=structuredClone(p);bad.owners[0].ownerAlias='Nathan';
  assert.equal(validateMemoryCurrentOwnerPlayerPayload(bad),false);
});

for(const inputMode of ['typed','mic']) test(`native-format ${inputMode} stores player and completed NPC lines and supplies H1 without H2`, {timeout:45000},async t=>{
  const x=await d01Harness(t,{pedId:'00046b02',config:{memoryK:{capabilities:{
    'memory.dialogue.player':'on','memory.dialogue.npc':'on','memory.journalContext':'on',
    'memory.recall':'off','memory.commands':'off','memory.interpretation':'off','memory.events':'off','memory.coverage':'off'}}}});
  const requests=[];
  x.h.runtime.services.decide=options=>{
    requests.push(options);
    return decide({...options,config:x.h.runtime.config,fetchImpl:async()=>new Response(JSON.stringify({status:'completed',output:[{
      type:'message',content:[{type:'output_text',text:JSON.stringify({dialogue:'Got it.',command:''})}]
    }]}),{headers:{'content-type':'application/json'}})});
  };
  for(const line of ['My favorite soda is purple soda.','What is my favorite soda?']){
    x.h.runtime.services.transcribe=async()=>line;
    const turn=inputMode==='typed'?await x.typed(line):await x.mic();
    assert.equal((await x.settled(turn)).status,'completed');
  }
  const journal=await x.journal();
  assert.equal(journal.players.length,2,JSON.stringify({dialogue:x.h.runtime.services.memoryDialogueDiagnostics(),history:x.h.runtime.services.memoryJournalDiagnostics(),native:x.d02.port.status()}));
  assert.ok(journal.npcs.length>=1,'completed speech is journaled with native-format identity');
  const messages=requests.at(-1).knowledgeProjection.modelAllocation.messages;
  assert.ok(messages.some(row=>row.role==='user'&&row.content==='My favorite soda is purple soda.'));
  assert.equal(x.h.runtime.services.memoryJournalDiagnostics().contributedToModelRequest,true);
});

test('pause, native reauthentication and a recreated session retain one NPC and its H1 journal', {timeout:45000},async t=>{
  const pedId='00049302';
  const x=await d01Harness(t,{pedId,config:{memoryK:{capabilities:{
    'memory.dialogue.player':'on','memory.dialogue.npc':'on','memory.journalContext':'on',
    'memory.recall':'off','memory.commands':'off','memory.interpretation':'off','memory.events':'off','memory.coverage':'off'}}}});
  const sent=[];
  x.h.runtime.services.decide=options=>{
    sent.push(options);
    return decide({...options,config:x.h.runtime.config,fetchImpl:async()=>new Response(JSON.stringify({status:'completed',output:[{
      type:'message',content:[{type:'output_text',text:JSON.stringify({dialogue:'Got it.',command:''})}]
    }]}),{headers:{'content-type':'application/json'}})});
  };
  const first=await x.typed('My favorite soda is purple soda.');
  assert.equal((await x.settled(first)).status,'completed');
  const original=x.session.connection.characterSnapshot.resolution.characterId;
  x.native.stop();await x.native.idle();
  x.store.setVerifiedHostContext(null);
  x.f.evidence.available=false;
  x.f.evidence.fact({type:'lost',adapterEpoch:x.owned.claim.adapterEpoch});
  assert.equal(x.store.timelineWritable,false);
  assert.equal(x.session.connection.closed,true);
  x.f.evidence.available=true;
  await x.native.renew();
  x.store.setVerifiedHostContext(x.client.runtime.hostContext);
  assert.equal(x.store.timelineWritable,true,'same host/epoch resumes without another selection');
  const actor={...x.a,integrations:{characterProfile:x.a.integrations.characterProfile}};
  const next=await x.h.openAIControllerSession({pedId,nonce:2,actorContext:actor});
  next.autoNativeAcks();
  x.h.context.pauseRecall={type:'playerText',pedId,speaker:actor,target:{pedId:'player'},text:'What is my favorite soda?'};
  const turn=await x.h.evaluate('ib(pauseRecall)');
  const identity={pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:2};
  assert.equal((await next.connection.whenSettled(identity)).status,'completed');
  assert.equal(next.connection.characterSnapshot.resolution.characterId,original);
  assert.ok(sent.at(-1).knowledgeProjection.modelAllocation.messages.some(row=>row.content==='My favorite soda is purple soda.'));
  assert.equal(x.h.runtime.services.memoryJournalDiagnostics().contributedToModelRequest,true);
  assert.equal((await x.journal()).players.length,2);
  next.connection.close();
});

test('typed recall waits for native owner recovery before admitting the new memory turn', {timeout:45000},async t=>{
  const x=await d01Harness(t,{pedId:'00049302',config:{memoryK:{capabilities:{
    'memory.dialogue.player':'on','memory.dialogue.npc':'on','memory.journalContext':'on',
    'memory.recall':'off','memory.commands':'off','memory.interpretation':'off','memory.events':'off','memory.coverage':'off'}}}});
  const first=await x.typed('My favorite soda is purple soda.');
  assert.equal((await x.settled(first)).status,'completed');
  x.h.runtime.intelligence=x.client;
  x.native.stop();await x.native.idle();
  x.native.socket.destroy();
  x.store.setVerifiedHostContext(null);
  const count=x.replies.length;
  const turn=await x.typed('What is my favorite soda?');
  await new Promise(resolve=>setTimeout(resolve,75));
  assert.equal(x.replies.length,count,'no inference while exact native evidence is absent');
  await x.native.renew();
  x.store.setVerifiedHostContext(x.client.runtime.hostContext);
  assert.equal((await x.settled(turn)).status,'completed');
  assert.ok(x.replies.at(-1).knowledgeProjection.modelAllocation.messages.some(row=>row.content==='My favorite soda is purple soda.'));
  assert.equal((await x.journal()).players.length,2);
});
