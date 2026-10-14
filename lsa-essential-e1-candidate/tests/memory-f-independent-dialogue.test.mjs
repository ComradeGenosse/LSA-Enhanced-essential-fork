// Real pinned original runner, D01/D02/D03 and file-backed P2. Native/P1 and
// provider fixtures are offline; these are not physical GTA acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {d01Harness,waitFor} from './memory/d01-harness.mjs';
import {ProviderRequestError} from '../src/openai/request.mjs';
import {createRuntimeForBundle} from '../src/bootstrap.mjs';
import {verifyPerceptionContract} from '../tools/verifyPerceptionContract.mjs';
import {IDENTITY_DLL_SHA256,IDENTITY_METADATA_SHA256} from '../src/identity/nativeSupport.mjs';
import {CHARACTER_METADATA_SHA256} from '../src/characters/nativeSupport.mjs';
import {TestOwnerEvidence,worldProfileId} from './identity-fixtures.mjs';
import {createEssentialMemoryStorage} from '../src/characters/memoryStorageAdapter.mjs';
import {createM5SqliteServices} from '../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';

const config=(player='on',npc='off')=>({memoryK:{capabilities:{
 'memory.dialogue.player':player,'memory.dialogue.npc':npc}}});
const say=async(x,text)=>{const turn=await x.typed(text);assert.equal((await x.settled(turn)).status,'completed');return turn;};
const scope=x=>({characterId:x.profile.characterId,worldProfileId,timelineId:x.timelineId,protagonistKey:'franklin'});
const status=x=>x.h.runtime.services.memoryDialogueDiagnostics();
const nativeEvent=(x,turn,type,extra={})=>{
 x.h.context.fNative={pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,type,...extra};
 return x.h.evaluate('by(fNative)');
};

for(const npc of ['off','on'])test('F player on / NPC '+npc+': exact typed and final STT, no sibling context/event activation',async t=>{
 const x=await d01Harness(t,{config:config('on',npc)});
 const adopted='Fuck — café́ 🦊  inner\tspace';
 await say(x,'  '+adopted+'  ');
 const stt='STT final — 中文 😐';let calls=0;
 x.h.runtime.services.transcribe=async()=>{if(++calls===1)throw new ProviderRequestError('retry',{code:'econnreset'});return stt;};
 const turn=await x.mic();assert.equal((await x.settled(turn)).status,'completed');
 const j=await x.journal();
 assert.deepEqual(j.players.map(r=>[r.content,r.source]),[[adopted,'typed'],[stt,'stt']]);
 assert.equal(calls,2);assert.equal(j.sources.length,2);
 assert.equal(j.npcs.length,npc==='on'?2:0);assert.equal(j.npcSources.length,j.npcs.length);
 for(const n of j.npcs){assert.equal(n.delivery,'completed');assert.ok(j.players.some(p=>p.record_id===n.replyTo));}
 assert.equal(x.h.runtime.memoryM3,undefined);
 assert.equal(await x.h.runtime.services.prepareLiveTurnMemory({get turn(){throw Error('context_off');}}),null);
 for(const reply of x.replies){assert.equal(reply.knowledgeProjection.memoryStamp,null);assert.ok(!JSON.stringify(reply.knowledgeProjection.modelAllocation).includes(adopted));}
 const rows=status(x);assert.equal(rows['memory.dialogue.player'].effectiveMode,'on');
 assert.equal(rows['memory.dialogue.player'].lastResult.durable,true);
 assert.equal(rows['memory.dialogue.npc'].effectiveMode,npc);
 assert.equal(rows['memory.dialogue.npc'].deliveryPolicy,'completed_only');
});

for(const [player,npc] of [['off','off'],['off','on']])test('F player '+player+' / NPC '+npc+': inert or dependency-blocked, including hostile unused ports',async t=>{
 const x=await d01Harness(t,{config:config(player,npc)});
 const s=x.h.runtime.services,turn={get m2Capture(){throw Error('disabled_capture_touched');},get characterProjection(){throw Error('disabled_profile_touched');}};
 assert.equal(s.bindM2Turn({turn}),null);
 assert.equal(await s.recordM2Player({turn,text:'fake',source:'player_text'}),null);
 assert.equal(await s.recordM2Npc({turn}),null);
 await say(x,'Ordinary conversation still works.');
 assert.equal((await x.journal()).rows.length,0);
 assert.equal(x.h.runtime.originalAcceptanceStatus().hasAuthenticatedSource,false);
 const rows=status(x);assert.equal(rows['memory.dialogue.player'].effectiveMode,'off');
 assert.equal(rows['memory.dialogue.npc'].state,npc==='on'?'blocked':'stopped');
 assert.equal(rows['memory.dialogue.npc'].effectiveMode,'off');
});

test('F rejects greeting substitution, debug input, empty/incomplete STT, fabricated text and special events',async t=>{
 const x=await d01Harness(t,{config:config('on','on')});
 await say(x,'  ');const debug=await x.typed('debug fabricated',{type:'testPrompt'});await x.settled(debug);
 x.h.runtime.services.transcribe=async()=>{throw new ProviderRequestError('incomplete',{code:'invalid_transcript'});};
 const mic=await x.mic();assert.notEqual((await x.settled(mic)).status,'completed');
 const special=await x.h.evaluate('kb({speakerPedId:"17",listenerPedId:"player",content:"fabricated scene",reason:"scene_event"})');
 await x.settled(special);
 assert.equal((await x.journal()).rows.length,0);
 let forged;
 const original=x.h.runtime.services.recordM2Player;
 x.h.runtime.services.recordM2Player=async args=>{
   forged=await original({...args,text:'fabricated accepted words'});return original(args);
 };
 await say(x,'Authentic words');assert.equal(forged.status,'not_stored');
 assert.deepEqual((await x.journal()).players.map(r=>r.content),['Authentic words']);
});

test('F superseded STT cannot fabricate a line; accepted input survives later interruption',async t=>{
 const x=await d01Harness(t,{config:config('on','on')});
 let release,entered;const gate=new Promise(r=>{release=r;}),started=new Promise(r=>{entered=r;});
 x.h.runtime.services.transcribe=async()=>{entered();await gate;return 'late superseded transcript';};
 const mic=await x.mic();await started;const done=x.settled(mic);
 await say(x,'Current accepted words');release();assert.notEqual((await done).status,'completed');
 let calls=0;const original=x.h.runtime.services.recordM2Player;
 x.h.runtime.services.recordM2Player=args=>{calls++;return original(args);};
 x.native.stop();const turn=await x.typed('Accepted before interruption');
 await waitFor(()=>calls===1,'accepted write pending');
 x.h.context.fCancel=turn;await x.h.evaluate('Qi(fCancel.id,ke.PLAYER_BARGE_IN)');await x.native.sample();
 await x.settled(turn);
 assert.deepEqual((await x.journal()).players.map(r=>r.content),['Current accepted words','Accepted before interruption']);
 assert.equal((await x.journal()).npcs.length,1);
});

for(const outcome of ['failed','interrupted','missing_ack'])test('F explicit NPC requires successful delivery: '+outcome,async t=>{
 const x=await d01Harness(t,{config:config('on','on')});
 if(outcome==='failed')x.h.runtime.services.speak=async()=>{throw new ProviderRequestError('no audio',{code:'econnreset'});};
 else x.session.autoNativeAcks({completePlayback:false});
 const turn=await x.typed('Accepted player line');
 if(outcome==='interrupted'){
  await waitFor(()=>x.h.sent.some(m=>m.type==='npcAudioStreamEnded'&&m.turnId===turn.id),'stream ended');
  await nativeEvent(x,turn,'npcPlaybackStarted',{reason:'started'});
  await nativeEvent(x,turn,'npcPlaybackEnded',{hadAudio:true,playbackStarted:true,reason:'player_barge_in',wasInterrupted:true});
 }
 if(outcome==='missing_ack'){
  await waitFor(()=>x.h.sent.some(m=>m.type==='npcAudioStreamEnded'&&m.turnId===turn.id),'unacknowledged stream');
  x.h.context.fCancel=turn;await x.h.evaluate('Qi(fCancel.id,ke.PLAYER_BARGE_IN)');
 }
 assert.notEqual((await x.settled(turn)).status,'completed');
 const j=await x.journal();assert.equal(j.players.length,1);assert.equal(j.npcs.length,0);assert.equal(j.npcSources.length,0);
 assert.equal(status(x)['memory.dialogue.npc'].lastResult.durable,false);
});

test('F duplicate accepted/delivery callbacks are idempotent, then retired capabilities cannot retry',async t=>{
 const x=await d01Harness(t,{config:config('on','on')});let captured;
 for(const name of ['recordM2Player','recordM2Npc']){
  const original=x.h.runtime.services[name];
  x.h.runtime.services[name]=async args=>{
   captured=args;const results=await Promise.all([original(args),original(args)]);
   assert.deepEqual(results.map(r=>r.status).sort(),['duplicate','stored']);
   assert.equal(results[0].recordId,results[1].recordId);return results[0];
  };
 }
 await say(x,'Once only');const j=await x.journal();
 assert.equal(j.rows.length,2);assert.equal(j.sources.length,1);assert.equal(j.npcSources.length,1);
 assert.equal((await captured.turn.m2Capture.recordNpcOutcome()).status,'not_stored');
 assert.equal((await x.journal()).rows.length,2);
});

test('F streamed NPC stores exact delivered segments, never a differing final model draft or forged callback text',async t=>{
 const x=await d01Harness(t,{config:{...config('on','on'),structuredStreamingEnabled:true,earlyTtsEnabled:true}});
 const parts=['Oh— ','fuck, ','café́ 🦊!'];
 x.h.runtime.services.providerStack={reasoning:{id:'openai.reasoning'},speech:{id:'openai.speech'},transcription:{id:'openai.transcription'},
  decideStreaming:async({onSegment})=>{
   for(let i=0;i<parts.length;i++)await onSegment({sequence:i,text:parts[i]},'dialogue_only');
   return {decision:{dialogue:'NEVER SPOKEN FINAL DRAFT',command:''},mode:'dialogue_only'};
  }};
 const original=x.h.runtime.services.recordM2Npc;
 x.h.runtime.services.recordM2Npc=args=>original({...args,text:'FORGED',delivery:'completed',receipt:{ok:true}});
 await say(x,'Stream it.');const j=await x.journal();
 assert.deepEqual(j.npcs.map(r=>r.content),[parts.join('')]);
 assert.equal(JSON.parse(j.npcSources[0].source_json).speech.segments.length,3);
});

for(const boundary of ['avatar','forget_player','commit_source_loss'])test('F completed delivery still requires durable player dependency and current authority: '+boundary,async t=>{
 const x=await d01Harness(t,{config:config('on','on')});
 const original=x.h.runtime.services.recordM2Npc;
 x.h.runtime.services.recordM2Npc=async args=>{
  if(boundary==='avatar'){x.native.avatar='michael';await x.native.sample();}
  if(boundary==='forget_player'){
   const player=(await x.journal()).players[0];
   await createM5SqliteServices({store:x.store,filePath:x.store.filePath,authorize:()=>true})
    .trash({scope:scope(x),targetId:player.record_id,operationId:randomUUID()});
  }
  if(boundary==='commit_source_loss'){
   const tx=x.store.withP2SqliteTransaction.bind(x.store);let inside=false,revoked=false;
   x.store.withP2SqliteTransaction=(s,operation)=>tx(s,db=>{
    inside=true;try{return operation(db);}finally{inside=false;}
   });
   const bindings=x.h.runtime.identityService.bindings,get=bindings.get.bind(bindings);
   bindings.get=identity=>{
    const value=get(identity);
    if(inside&&!revoked){revoked=true;x.h.runtime.retireOriginalAcceptanceSourceRun();}
    return value;
   };
  }
  return original(args);
 };
 await say(x,'Player dependency');const j=await x.journal();
 assert.equal(j.players.length,1);assert.equal(j.npcs.length,0);assert.equal(j.npcSources.length,0);
});

for(const revoke of ['session','source','timeline','host'])test('F pending accepted write rejects '+revoke+' loss and resumes only with fresh source authority',async t=>{
 const x=await d01Harness(t,{config:config('on','on')});let entered=false;
 const original=x.h.runtime.services.recordM2Player;
 x.h.runtime.services.recordM2Player=args=>{entered=true;return original(args);};
 x.native.stop();const turn=await x.typed('Pending input');await waitFor(()=>entered,'write admitted');
 if(revoke==='session')x.session.connection.close();
 if(revoke==='source')x.native.socket.destroy();
 if(revoke==='timeline')x.store.onBoundary({reason:'timeline_change'});
 if(revoke==='host')x.h.runtime.retireOriginalAcceptanceSourceRun();
 await x.native.sample();await x.settled(turn);
 if(revoke==='timeline')await x.store.confirmTimeline(x.timelineId);
 assert.equal((await x.journal()).rows.length,0);
 if(revoke==='source'){
  assert.equal(status(x)['memory.dialogue.player'].state,'waiting');
  await x.native.renew();await waitFor(()=>x.d02.port.status().settled,'fresh source settled');
  await say(x,'New verified source');assert.equal((await x.journal()).rows.length,2);
 }
});

test('F player-only retained lines unify avatars, remain scoped, durable after restart, and permanently suppressed on retry',async t=>{
 const x=await d01Harness(t,{config:config()});let retry=null;
 const original=x.h.runtime.services.recordM2Player;
 x.h.runtime.services.recordM2Player=async args=>{
  const result=await original(args);
  if(!retry){
   const privacy=createM5SqliteServices({store:x.store,filePath:x.store.filePath,authorize:()=>true});
   await privacy.trash({scope:scope(x),targetId:result.recordId,operationId:randomUUID()});
   retry=await original(args);
  }return result;
 };
 await say(x,'Suppressed secret');assert.equal(retry.status,'not_stored');
 for(const avatar of ['michael','trevor']){x.native.avatar=avatar;await x.native.sample();await say(x,'Visible '+avatar);}
 const rows=await x.store.readDialogueLines({...scope(x),protagonistKey:'trevor',limit:20});
 assert.deepEqual(rows.map(r=>r.content),['Visible trevor','Visible michael','Suppressed secret'],'raw immutable archive retains authorized recovery bytes');
 assert.deepEqual(rows.map(r=>r.attribution.protagonist),['trevor','michael','franklin']);
 const visible=await x.store.readCommittedEvidencePage({scope:scope(x)});
 assert.equal(visible.items.length,2);assert.ok(!JSON.stringify(visible).includes('Suppressed secret'));
 assert.deepEqual((await x.store.readDialogueLines({...scope(x),characterId:randomUUID(),limit:20})),[]);
 await assert.rejects(x.store.readDialogueLines({...scope(x),worldProfileId:randomUUID()}));
 assert.deepEqual(await x.store.readDialogueLines({...scope(x),timelineId:randomUUID()}),[]);
 x.session.connection.close();x.native.stop();await x.native.idle();x.d02.close();x.client.stop();
 const filePath=x.store.filePath;await x.store.close();
 const restarted=createEssentialMemoryStorage({filePath,worldProfileId,sourceRequired:true});
 try{await restarted.initialize();assert.equal(restarted.timelineWritable,false);
 await assert.rejects(restarted.readCommittedEvidencePage({scope:scope(x)}),/timeline_write_suspended/);
 restarted.setVerifiedHostContext({hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1});
 await restarted.confirmTimeline(x.timelineId);
 assert.deepEqual((await restarted.readDialogueLines({...scope(x),limit:20})).map(r=>r.content),['Visible trevor','Visible michael','Suppressed secret']);
 const after=await restarted.readCommittedEvidencePage({scope:scope(x)});
 assert.equal(after.items.length,2);assert.ok(!JSON.stringify(after).includes('Suppressed secret'));
 assert.equal((await restarted.listSuppressedMemoryIds({...scope(x),protagonistKey:'michael'})).length,1);
 }finally{await restarted.close();}
});

for(const player of ['off','on'])test('F bootstrap '+player+': recording subscriptions are owned only when requested; source/P2 and privacy remain independent',async t=>{
 const dir=await mkdtemp(path.join(tmpdir(),'f-bootstrap-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const configPath=path.join(dir,'config.json');
 await writeFile(configPath,JSON.stringify({provider:'openai',...config(player),
  intelligence:{mode:'shadow'},persistentIdentity:{enabled:true,worldProfileId,storePath:path.join(dir,'identity.json')},
  promotedCharacters:{enabled:true,storageMode:'sqlite',sqliteStorePath:path.join(dir,'p2.sqlite'),storePath:path.join(dir,'profiles.json')}}));
 const socket=new EventEmitter();socket.destroy=()=>socket.emit('close');
 const runtime=await createRuntimeForBundle({configPath,env:{},enableTelemetry:false,startCharacterEditor:false,
  identityEvidence:new TestOwnerEvidence(),perceptionContract:await verifyPerceptionContract(),
  intelligenceOptions:{connect:()=>socket},fetchImpl:()=>{throw Error('provider_forbidden');},
  identityContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,metadataSha256:IDENTITY_METADATA_SHA256,nativeProtocolChanged:false},
  characterContract:{available:true,requiredGameTarget:'net481',dllSha256:IDENTITY_DLL_SHA256,metadataSha256:CHARACTER_METADATA_SHA256,nativeProtocolChanged:false}});
 t.after(()=>runtime.dispose());
 const snapshot=runtime.services.memoryKRuntimeDiagnostics(),resources=snapshot.lifecycle.resources;
 assert.ok(resources['authority.d02'],'existing independent source authority remains a prerequisite');
 assert.equal(runtime.intelligence.currentOwnerPlayerSubscriptions.size,1,'no extra recorder-owned D02 subscription');
 for(const id of ['acceptance.host','acceptance.boundary'])assert.equal(!!resources[id],player==='on',id);
 assert.ok(resources['storage.host']);assert.ok(resources['storage.boundary']);
 assert.equal(runtime.memoryM3,undefined);assert.equal(snapshot.capabilities['privacy.core'].state,'guarded');
 assert.equal(snapshot.capabilities['memory.dialogue.player'].state,player==='on'?'waiting':'stopped');
 assert.equal(snapshot.capabilities['memory.dialogue.npc'].effectiveMode,'off');
 await runtime.dispose();assert.equal(runtime.intelligence.hostContextListeners.size,0);
 assert.equal(runtime.services.memoryKRuntimeDiagnostics().capabilities['memory.dialogue.player'].effectiveMode,'off');
});
