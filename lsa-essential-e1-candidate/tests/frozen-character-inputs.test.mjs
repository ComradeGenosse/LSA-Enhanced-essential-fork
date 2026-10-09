import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './p2-fixtures.mjs';
import { actor,identity } from './identity-fixtures.mjs';
const setup=async t=>{
  const f=await fixture(t,{config:{actingEnabled:true}}),profile=await f.service.promote(),owned=f.native.owned.get(profile.promotion.ownerAlias),native=identity();
  const a=actor('17',owned.claim,{integrations:{sessionIdentity:owned.claim,characterProfile:{version:1,encounterId:owned.encounterId}}});
  const voice=f.voice.resolve(native,a);f.service.session(native,a,voice);
  const inputs=f.service.captureTurnInputs(native,a);
  const binding=f.identity.bindings.bind(native,owned.claim,{characterId:profile.characterId},()=>true).binding;
  const verified={resolution:{kind:'persistent',characterId:profile.characterId},bindingId:binding.bindingId};
  return {...f,profile,owned,native,a,voice,inputs,verified};
};
test('matching fresh proof releases the captured canon revision and acting direction after edits',async t=>{
  const f=await setup(t);await f.service.edit(f.profile.characterId,{name:'Changed after freeze',personality:{description:'Changed acting',traits:['bold']}},f.profile.revision);
  const turn={identity:f.native,characterInputs:f.inputs,context:{actor:f.a,listener:null,systemInstruction:'Essential rules'}};
  await f.service.prepareTurn(turn,f.verified,f.voice);
  assert.equal(turn.context.actor.characterProfile.canon.name,f.profile.name);assert.equal(turn.context.actor.characterProfile.profileRevision,f.profile.revision);
  assert.equal(turn.speechProfile.instructions.includes('Changed acting'),false);assert.equal(Object.isFrozen(f.inputs.profile.memories),true);
});
test('candidate never supplies persistent canon for a mismatched incarnation or revoked proof',async t=>{
  const f=await setup(t);
  const mismatch={identity:f.native,characterInputs:{...f.inputs,claim:{...f.inputs.claim,incarnationId:randomUUID()}},context:{actor:f.a,listener:null,systemInstruction:'Essential rules'}};
  await f.service.prepareTurn(mismatch,f.verified,f.voice);assert.notEqual(mismatch.context.actor.characterProfile?.authority,'player_authored');
  f.evidence.retire(f.owned.pedId);
  const turn={identity:f.native,characterInputs:f.inputs,context:{actor:f.a,listener:null,systemInstruction:'Essential rules'}};
  await f.service.prepareTurn(turn,f.verified,f.voice);assert.notEqual(turn.context.actor.characterProfile?.authority,'player_authored');
  assert.equal(JSON.stringify(turn.context).includes(f.profile.characterId),false);
});
test('profile absent at freeze stays absent even if loaded or found during preparation',async t=>{
  const f=await setup(t),inputs={...f.inputs,profile:null};
  const turn={identity:f.native,characterInputs:inputs,context:{actor:f.a,listener:null,systemInstruction:'Essential rules'}};
  await f.service.prepareTurn(turn,f.verified,f.voice);assert.equal(turn.context.actor.characterProfile.authority,'session_assigned');
});

import { stockHarness } from './stock-harness.mjs';
test('actual Luna request retains P0 canon across an edit while fresh owner proof is pending',async t=>{
  const f=await setup(t),{trustedNamespaces,...persistentIdentity}=f.config.persistentIdentity;
  const h=await stockHarness('openai',{identityEvidence:f.evidence,profileStore:f.store,nativeOwner:f.native,config:{persistentIdentity,promotedCharacters:f.config.promotedCharacters}});t.after(()=>h.runtime.identityService.close());
  await h.runtime.characterService.initialize();let release,reached;
  const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{reached=resolve;});
  const original=h.runtime.identityService.prepare.bind(h.runtime.identityService);
  let prepared,captured;const captureOriginal=h.runtime.captureCharacterInputs;h.runtime.captureCharacterInputs=(...args)=>{captured=captureOriginal(...args);return captured;};
  h.runtime.identityService.prepare=async options=>{reached();await gate;prepared=await original(options);return prepared;};let request;
  h.runtime.services.decide=async options=>{request=options;return {dialogue:'Hello.',command:''};};
  h.runtime.services.speak=async ({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
  const session=await h.openAIControllerSession({actorContext:f.a});session.autoNativeAcks();
  h.context.frozenInput={pedId:'17',speaker:f.a,text:'Hello.'};const turn=await h.evaluate('ib(frozenInput)');await waiting;
  await f.service.edit(f.profile.characterId,{name:'Late edited name'},f.profile.revision);release();
  const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
  assert.equal(result.status,'completed');assert.equal(prepared.snapshot.resolution.kind,'persistent',prepared.snapshot.resolution.reason);assert.ok(captured.profile,'P0 candidate missing');assert.equal(request.context.actor.characterProfile.canon.name,f.profile.name);assert.equal(request.context.actor.characterProfile.profileRevision,f.profile.revision);
  const lanes=JSON.parse(request.knowledgeProjection.modelAllocation.scene).lanes;
  assert.equal(lanes.SELF.canon.name,f.profile.name);
  assert.equal(JSON.stringify(request.knowledgeProjection.modelAllocation).includes(f.profile.characterId),false);
  assert.equal(request.context.systemInstruction.includes(f.profile.name),false,'canon must not also be embedded in the behavior instructions');
  session.connection.close();
});


import {IntelligenceClient} from '../src/perception/intelligenceClient.mjs';
import {CAPABILITIES} from '../src/perception/contracts.mjs';
for(const matching of [true,false])test(`real first-owned active request releases original knowledge only with matching P1 host: ${matching}`,async t=>{
 const f=await setup(t),client=new IntelligenceClient({mode:'shadow'},{report:()=>{}}),ps=client.runtime;
 const hello={version:1,type:'hello',adapterEpoch:randomUUID(),streamId:randomUUID(),hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1,observerIndexVersion:1,observerSituationVersion:1,capabilities:Object.fromEntries(CAPABILITIES.map(key=>[key,key==='shooting']))};
 ps.ingest(hello,{authenticated:true});const ref=randomUUID();let sequence=0;
 const send=(type,payload)=>ps.ingest({version:1,type,adapterEpoch:hello.adapterEpoch,streamId:hello.streamId,sequence:++sequence,payload},{authenticated:true});
 send('anchors',[{captureRef:ref,kind:'ped',observer:true,owned:true}]);send('observer_index',[{captureRef:ref,kind:'ped',owned:true,encounterId:f.owned.encounterId,incarnationId:f.owned.claim.incarnationId}]);
 send('signal',{signalId:randomUUID(),producer:'shooting',producerSequence:1,kind:'firing',target:null,source:ref,gameTick:10,ageMs:0,facts:{}});
 f.a.integrations.turnKnowledge={version:1,hostRunId:hello.hostRunId,worldEpoch:1,captureRef:ref,sampledGameTick:10,encounterId:f.owned.encounterId,incarnationId:f.owned.claim.incarnationId};
 f.evidence.hostContext=null;const {trustedNamespaces,...persistentIdentity}=f.config.persistentIdentity;const bodies=[];
 const h=await stockHarness('openai',{identityEvidence:f.evidence,profileStore:f.store,nativeOwner:f.native,config:{persistentIdentity,promotedCharacters:f.config.promotedCharacters,dialogueKnowledge:{mode:'active'}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>{bodies.push(JSON.parse(request.body));return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"dialogue":"Hello.","command":""}'}]}]}),{headers:{'content-type':'application/json'}});}});
 t.after(()=>h.runtime.identityService.close());await h.runtime.characterService.initialize();h.runtime.intelligence=client;h.runtime.dialogueKnowledgeBuildSupported=true;
 let release,reached,captured;const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{reached=resolve;});
 const capture=h.runtime.captureKnowledgeInputs;h.runtime.captureKnowledgeInputs=input=>{captured=capture(input);return captured;};
 const prepare=h.runtime.identityService.prepare.bind(h.runtime.identityService);h.runtime.identityService.prepare=async args=>{reached();await gate;f.evidence.hostContext=matching?hello:{...hello,hostRunId:randomUUID()};return prepare(args);};
 h.runtime.services.speak=async({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const session=await h.openAIControllerSession({actorContext:f.a});t.after(()=>session.connection.close());session.autoNativeAcks();h.context.ownedInput={pedId:'17',speaker:f.a,text:'What happened?'};
 const turn=await h.evaluate('ib(ownedInput)');await waiting;assert.equal(captured.ownerPendingProof,true);assert.ok(captured.pairs.length);
 await f.service.edit(f.profile.characterId,{name:'Edited after owned freeze'},f.profile.revision);release();
 const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});assert.equal(result.status,'completed',result.terminalReason);assert.equal(bodies.length,1);
 const scene=JSON.parse(bodies[0].input[0].content.split('\n').find(line=>line.startsWith('{"frameVersion":1,')));assert.equal(scene.lanes.SELF.canon.name,f.profile.name);assert.equal(scene.lanes.PERCEIVED.observations.length>0,matching);
 for(const secret of [ref,hello.hostRunId,f.profile.characterId,f.owned.encounterId,'turnKnowledge','sessionIdentity','Edited after owned freeze'])assert.equal(JSON.stringify(bodies[0]).includes(secret),false);
 assert.equal([...ps.salience.ledger.values()].some(entry=>entry.consumedBy.has('ps4_context')),matching);assert.equal(client.knowledgeListeners.size,0);
});

import {ActivityFacts} from '../src/activities/activityFacts.mjs';
import {DialogueActionReceipts} from '../src/activities/dialogueActionReceipts.mjs';
function frozenSelfResponse(stream){
 if(!stream)return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({dialogue:'Hello.',command:''})}]}]}),{headers:{'content-type':'application/json'}});
 const text=JSON.stringify({mode:'dialogue_only',segments:[{text:'Hello.'}],command:''}),item={id:'owned_message',type:'message',role:'assistant',content:[]};
 const events=[{type:'response.created',response:{id:'owned_response',status:'in_progress'}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_text.delta',output_index:0,content_index:0,item_id:item.id,delta:text},{type:'response.completed',response:{id:'owned_response',status:'completed',output:[{...item,status:'completed',content:[{type:'output_text',text,annotations:[]}]}]}}];
 return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
}
for(const [mode,options] of [['buffered',{}],['streaming',{structuredStreamingEnabled:true}],['early TTS',{structuredStreamingEnabled:true,earlyTtsEnabled:true}]])for(const source of ['player_text','player_mic','special_event'])for(const scenario of ['valid','host_mismatch','child_channel_reset','self_only','self_only_inflight_reset'])test(`real owned ACT/C05 ${mode} ${source} frozen SELF: ${scenario}`,{timeout:15000},async t=>{
 const matching=scenario!=='host_mismatch';
 const f=await setup(t),client=new IntelligenceClient({mode:'shadow'},{report:()=>{}}),ps=client.runtime;
 const hello={version:1,type:'hello',adapterEpoch:randomUUID(),streamId:randomUUID(),hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1,observerIndexVersion:1,observerSituationVersion:1,capabilities:Object.fromEntries(CAPABILITIES.map(key=>[key,key==='shooting']))};
 ps.ingest(hello,{authenticated:true});const ref=randomUUID();let sequence=0;
 const send=(type,payload)=>ps.ingest({version:1,type,adapterEpoch:hello.adapterEpoch,streamId:hello.streamId,sequence:++sequence,payload},{authenticated:true});
 send('anchors',[{captureRef:ref,kind:'ped',observer:true,owned:true}]);send('observer_index',[{captureRef:ref,kind:'ped',owned:true,encounterId:f.owned.encounterId,incarnationId:f.owned.claim.incarnationId}]);
 if(!scenario.startsWith('self_only'))send('signal',{signalId:randomUUID(),producer:'shooting',producerSequence:1,kind:'firing',target:null,source:ref,gameTick:10,ageMs:0,facts:{}});
 f.a.integrations.turnKnowledge={version:1,hostRunId:hello.hostRunId,worldEpoch:1,captureRef:ref,sampledGameTick:10,encounterId:f.owned.encounterId,incarnationId:f.owned.claim.incarnationId};
 f.evidence.hostContext=null;const {trustedNamespaces,...persistentIdentity}=f.config.persistentIdentity;const bodies=[];let aborted=false;
 const h=await stockHarness('openai',{identityEvidence:f.evidence,profileStore:f.store,nativeOwner:f.native,config:{...options,persistentIdentity,promotedCharacters:f.config.promotedCharacters,dialogueKnowledge:{mode:'active',activityFacts:'active',dialogueReceipts:'active'}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>{const body=JSON.parse(request.body);bodies.push(body);if(scenario==='self_only_inflight_reset')return new Promise((resolve,reject)=>{request.signal.addEventListener('abort',()=>{aborted=true;reject(request.signal.reason);},{once:true});queueMicrotask(()=>{activities.client.runtime.adapterEpoch=randomUUID();client.notifyKnowledgeInvalidation();});});return frozenSelfResponse(body.stream);}});
 const hostContext=ps.hostContext,binding={characterId:f.profile.characterId,encounterId:f.owned.encounterId,incarnationId:f.owned.claim.incarnationId,hostContext};
 const facts=new ActivityFacts(randomUUID,()=>1000),receiptStore=new DialogueActionReceipts(),receiptBinding={captureRef:ref,encounterId:binding.encounterId,incarnationId:binding.incarnationId,hostContext};
 const addFact=kind=>facts.record({characterId:binding.characterId,activityId:randomUUID(),goalId:randomUUID(),kind,intent:'accompany',evidence:'none'},{...hostContext,encounterId:binding.encounterId,incarnationId:binding.incarnationId});
 const addReceipt=(canonicalAction,publishedAtMs)=>{const row=receiptStore.publish({tuple:{pedId:'17',turnId:'previous',generationId:1,sessionNonce:1},binding:receiptBinding,canonicalAction,publishedAtMs,allowedActions:[canonicalAction]});receiptStore.callback({...row,succeeded:true,atGameTick:20,receivedAtMs:publishedAtMs+10});return row;};
 const fact=addFact('instructed'),receipt=addReceipt('waithere',100);
 const activities={client:{runtime:{ready:true,dialogueActionVersion:1,nativeRun:randomUUID(),adapterEpoch:randomUUID(),hostContext}},factsForCharacter:scope=>facts.factsForCharacter(scope),readDialogueActionReceipts:scope=>receiptStore.read(scope)};
 h.runtime.activities=activities;h.runtime.services.capabilityHealth=()=>({'ps.activity_facts':{active:true},'ps.dialogue_receipts':{active:true}});
 t.after(()=>h.runtime.identityService.close());await h.runtime.characterService.initialize();h.runtime.intelligence=client;h.runtime.dialogueKnowledgeBuildSupported=true;
 let release,reached,captured;const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{reached=resolve;});
 let frozenCharacter=null;const originalCharacterCapture=h.runtime.captureCharacterInputs;h.runtime.captureCharacterInputs=(...args)=>{frozenCharacter=originalCharacterCapture(...args);return frozenCharacter;};
 const capture=h.runtime.captureKnowledgeInputs;h.runtime.captureKnowledgeInputs=input=>{captured=capture(input);return captured;};
 let identityOutcome=null;const prepare=h.runtime.identityService.prepare.bind(h.runtime.identityService);h.runtime.identityService.prepare=async args=>{reached();await gate;f.evidence.hostContext=matching?hello:{...hello,hostRunId:randomUUID()};identityOutcome=await prepare(args);return identityOutcome;};
 h.runtime.services.speak=async({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const session=await h.openAIControllerSession({actorContext:f.a});t.after(()=>session.connection.close());session.autoNativeAcks();h.context.ownedInput={pedId:'17',speaker:f.a,text:'What happened?'};
 let turn;
 if(source==='player_text')turn=await h.evaluate('ib(ownedInput)');
 else if(source==='special_event')turn=await h.evaluate('kb({speakerPedId:"17",listenerPedId:"player",content:"PRIVATE_OWNED_TRIGGER",reason:"scene_event"})');
 else{turn=h.evaluate('(()=>{const value=Xi({pedId:"17",speakerPedId:"17",listenerPedId:"player",source:Ht.PLAYER_MIC,input:{transcript:"",contextText:""},metadata:{}});A.mic=ND();A.mic.activeTurnId=value.id;A.mic.status="listening";A.mic.pendingChunks=[];A.mic.sendChain=Promise.resolve();return value;})()');h.context.ownedMic={speaker:f.a,target:{pedId:'player'}};h.evaluate('Te=()=>{};hb=()=>{};OK=false');}
 if(source==='player_mic'){h.runtime.services.transcribe=async()=> 'What happened?';await h.evaluate('wd(ownedMic)');await session.connection.sendRealtimeAudio(new Uint8Array([1,2]));await session.connection.endRealtimeInput();}
 await waiting;assert.equal(captured.ownerPendingProof,true);assert.equal(captured.pairs.length>0,!scenario.startsWith('self_only'));assert.equal(captured.activityInputs.ownerPendingProof,true);assert.equal(captured.dialogueInputs.ownerPendingProof,true);assert.equal(captured.activityInputs.facts.length,1);assert.equal(captured.dialogueInputs.receipts.length,1);
 addFact('failed');addReceipt('followtarget',200);if(scenario==='child_channel_reset')activities.client.runtime.adapterEpoch=randomUUID();
 await f.service.edit(f.profile.characterId,{name:'Edited after owned freeze'},f.profile.revision);release();
 const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});if(scenario==='self_only_inflight_reset'){assert.notEqual(result.status,'completed');assert.equal(aborted,true);assert.equal(h.runtime.history.readForSession('17',1).some(item=>item.role==='assistant'),false);}else assert.equal(result.status,'completed',result.terminalReason);assert.equal(bodies.length,1);
 const scene=JSON.parse(bodies[0].input[0].content.split('\n').find(line=>line.startsWith('{"frameVersion":1,')));assert.ok(scene.lanes.SELF.canon,JSON.stringify({source,mode,scenario,resolution:identityOutcome?.snapshot?.resolution?.kind,reason:identityOutcome?.snapshot?.resolution?.reason,hasFrozenOwnerClaim:!!captured?.ownerClaim,hasFrozenCharacterInputs:!!frozenCharacter,hasFrozenProfile:!!frozenCharacter?.profile,storedProfile:!!h.runtime.characterService.store.get(f.profile.characterId),matchedId:identityOutcome?.snapshot?.resolution?.characterId===frozenCharacter?.profile?.characterId,expectedId:f.profile.characterId===frozenCharacter?.profile?.characterId,hasCharacterProjection:!!scene.lanes.SELF.canon,actorName:f.profile.name}));assert.equal(scene.lanes.SELF.canon.name,f.profile.name);assert.equal(scene.lanes.PERCEIVED.observations.length>0,matching && !scenario.startsWith('self_only'));assert.equal(scene.lanes.SELF.selfFacts.length,(scenario==='valid' || scenario.startsWith('self_only'))?2:0);if(scenario==='valid' || scenario.startsWith('self_only')){assert.match(scene.lanes.SELF.selfFacts[0].text,/was asked/);assert.match(scene.lanes.SELF.selfFacts[1].text,/handler accepted my attempt to wait here/);assert.doesNotMatch(JSON.stringify(scene.lanes.SELF.selfFacts),/failed|follow the target/);}assert.equal(captured.activityInputs.facts.length,1);assert.equal(captured.dialogueInputs.receipts.length,1);
 for(const secret of [captured.dialogueInputs.adapterEpoch,fact.factId,receipt.publicationId,activities.client.runtime.nativeRun,activities.client.runtime.adapterEpoch,ref,hello.hostRunId,f.profile.characterId,f.owned.encounterId,'turnKnowledge','sessionIdentity','Edited after owned freeze','PRIVATE_OWNED_TRIGGER'])assert.equal(JSON.stringify(bodies[0]).includes(secret),false);
 assert.equal([...ps.salience.ledger.values()].some(entry=>entry.consumedBy.has('ps4_context')),matching && !scenario.startsWith('self_only'));assert.equal(client.knowledgeListeners.size,0);
});
