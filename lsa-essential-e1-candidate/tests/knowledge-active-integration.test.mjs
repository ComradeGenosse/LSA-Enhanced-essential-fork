import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {stockHarness} from './stock-harness.mjs';
import {IntelligenceClient} from '../src/perception/intelligenceClient.mjs';
import {CAPABILITIES} from '../src/perception/contracts.mjs';
const responseText=JSON.stringify({mode:'dialogue_only',segments:[{text:'Hello.'}],command:''});
function response(stream){
 if(!stream)return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"dialogue":"Hello.","command":""}'}]}]}),{headers:{'content-type':'application/json'}});
 const item={id:'msg_frame',type:'message',role:'assistant',content:[]};
 const events=[{type:'response.created',response:{id:'resp_frame',status:'in_progress'}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_text.delta',output_index:0,content_index:0,item_id:item.id,delta:responseText},{type:'response.completed',response:{id:'resp_frame',status:'completed',output:[{...item,status:'completed',content:[{type:'output_text',text:responseText,annotations:[]}]}]}}];
 return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
}

function factualFixture({allCapabilities=false}={}){
 const client=new IntelligenceClient({mode:'shadow'},{report:()=>{}}),ps=client.runtime;
 const hello={version:1,type:'hello',adapterEpoch:randomUUID(),streamId:randomUUID(),hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1,observerIndexVersion:1,observerSituationVersion:1,capabilities:Object.fromEntries(CAPABILITIES.map(key=>[key,allCapabilities || key==='shooting']))};
 ps.ingest(hello,{authenticated:true});const ref=randomUUID();let sequence=0;
 const send=(type,payload)=>{const result=ps.ingest({version:1,type,adapterEpoch:hello.adapterEpoch,streamId:hello.streamId,sequence:++sequence,payload},{authenticated:true});client.notifyKnowledgeInvalidation();return result;};
 send('anchors',[{captureRef:ref,kind:'ped',observer:true,owned:false}]);send('observer_index',[{captureRef:ref,kind:'ped',owned:false}]);
 send('signal',{signalId:randomUUID(),producer:'shooting',producerSequence:1,kind:'firing',target:null,source:ref,gameTick:10,ageMs:0,facts:{}});
 const actor={pedId:'17',integrations:{turnKnowledge:{version:1,hostRunId:hello.hostRunId,worldEpoch:1,captureRef:ref,sampledGameTick:10}}};
 return {client,ps,ref,actor,send};
}
for(const [mode,options] of [['buffered',{}],['streaming',{structuredStreamingEnabled:true}],['early TTS',{structuredStreamingEnabled:true,earlyTtsEnabled:true}]])for(const source of ['player_text','player_mic','special_event'])test(`real active ${mode} ${source} receives frozen PS2/PS3 knowledge and acknowledges exact keys`,async t=>{
 const f=factualFixture(),bodies=[];
 const h=await stockHarness('openai',{config:{...options,dialogueKnowledge:{mode:'active'},retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>{const body=JSON.parse(request.body);bodies.push(body);return response(body.stream);}});
 h.runtime.intelligence=f.client;h.runtime.dialogueKnowledgeBuildSupported=true;
 h.runtime.services.speak=async({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const session=await h.openAIControllerSession({actorContext:f.actor});t.after(()=>session.connection.close());session.autoNativeAcks();h.context.activeInput={pedId:'17',speaker:f.actor,text:'What happened?'};
 h.runtime.services.transcribe=async()=> 'What happened?';
 let turn;
 if(source==='player_text')turn=await h.evaluate('ib(activeInput)');
 else if(source==='special_event')turn=await h.evaluate('kb({speakerPedId:"17",listenerPedId:"player",content:"UNSUPPORTED_TRIGGER_CANARY",reason:"scene_event"})');
 else {
  turn=h.evaluate('(()=>{const value=Xi({pedId:"17",speakerPedId:"17",listenerPedId:"player",source:Ht.PLAYER_MIC,input:{transcript:"",contextText:""},metadata:{}});A.mic=ND();A.mic.activeTurnId=value.id;A.mic.status="listening";A.mic.pendingChunks=[];A.mic.sendChain=Promise.resolve();return value;})()');
  h.context.activeMic={speaker:f.actor,target:{pedId:'player'}};h.evaluate('Te=()=>{};hb=()=>{};OK=false');await h.evaluate('wd(activeMic)');
  await session.connection.sendRealtimeAudio(new Uint8Array([1,2]));await session.connection.endRealtimeInput();
 }
 const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.equal(result.status,'completed',result.terminalReason);assert.equal(bodies.length,1);
 const scene=JSON.parse(bodies[0].input[0].content.split('\n').find(line=>line.startsWith('{"frameVersion":1,')));
 if(source==='special_event'){assert.match(bodies[0].input.at(-1).content,/No player utterance was received/);assert.equal(JSON.stringify(bodies[0]).includes('UNSUPPORTED_TRIGGER_CANARY'),false);}else assert.equal(bodies[0].input.at(-1).content,'What happened?');
 assert.ok(scene.lanes.PERCEIVED.observations.length);assert.equal(scene.lanes.PERCEIVED.observations[0].claims[0].kind,'firing');
 for(const secret of [f.ref,f.ps.epoch,f.ps.hostContext.hostRunId,'turnKnowledge','decisionKey'])assert.equal(JSON.stringify(bodies[0]).includes(secret),false);
 const entries=[...f.ps.salience.ledger.values()];assert.ok(entries.some(entry=>entry.consumedBy.has('ps4_context')));assert.ok(entries.every(entry=>!entry.consumedBy.has('ps6_ticket')));assert.equal(f.client.knowledgeListeners.size,0);
});
test('real active in-flight retirement aborts provider and prevents delivered acknowledgement',async t=>{
 const f=factualFixture();let aborted=false;
 const h=await stockHarness('openai',{config:{dialogueKnowledge:{mode:'active'},retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>new Promise((resolve,reject)=>{
  request.signal.addEventListener('abort',()=>{aborted=true;reject(request.signal.reason);},{once:true});queueMicrotask(()=>f.send('retire_batch',[f.ref]));
 })});
 h.runtime.intelligence=f.client;h.runtime.dialogueKnowledgeBuildSupported=true;
 const session=await h.openAIControllerSession({actorContext:f.actor});t.after(()=>session.connection.close());session.autoNativeAcks();h.context.retireInput={pedId:'17',speaker:f.actor,text:'What happened?'};
 const turn=await h.evaluate('ib(retireInput)');const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.equal(aborted,true);assert.notEqual(result.status,'completed');assert.ok([...f.ps.salience.ledger.values()].every(entry=>!entry.consumedBy.has('ps4_context')));assert.equal(f.client.knowledgeListeners.size,0);assert.equal(h.runtime.history.readForSession('17',1).some(item=>item.role==='assistant'),false);
});


test('real active retry retains frozen body and cannot consume a later PS3 decision key',async t=>{
 const f=factualFixture(),originalKeys=[...f.ps.salience.ledger.values()].map(entry=>entry.decisionKey),bodies=[],outcomes=[];
 const h=await stockHarness('openai',{config:{dialogueKnowledge:{mode:'active'},retry:{enabled:true,maxAttempts:2,baseDelayMs:0,maxDelayMs:0},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>{
  bodies.push(request.body);
  if(bodies.length===1){f.send('signal',{signalId:randomUUID(),producer:'shooting',producerSequence:2,kind:'firing',target:null,source:f.ref,gameTick:11,ageMs:0,facts:{}});return new Response(JSON.stringify({error:{code:'server_error'}}),{status:503,headers:{'content-type':'application/json'}});}
  return response(false);
 }});
 h.runtime.intelligence=f.client;h.runtime.dialogueKnowledgeBuildSupported=true;
 const finalize=h.runtime.services.finalizeKnowledgeFrame;h.runtime.services.finalizeKnowledgeFrame=(turn,args)=>{const frame=finalize(turn,args);const success=turn.knowledgeDelivery.success;turn.knowledgeDelivery={...turn.knowledgeDelivery,success:decision=>{const result=success(decision);if(result)outcomes.push(result);return result;}};return frame;};
 h.runtime.services.speak=async({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const session=await h.openAIControllerSession({actorContext:f.actor});t.after(()=>session.connection.close());session.autoNativeAcks();h.context.retryInput={pedId:'17',speaker:f.actor,text:'What happened?'};
 const turn=await h.evaluate('ib(retryInput)');const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.equal(result.status,'completed');assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);assert.equal(outcomes.length,1);assert.equal(outcomes[0].retired,1);
 const successor=[...f.ps.salience.ledger.values()];assert.ok(successor.some(entry=>!originalKeys.includes(entry.decisionKey)));assert.ok(successor.every(entry=>!entry.consumedBy.has('ps4_context') && !entry.consumedBy.has('ps6_ticket')));assert.equal(f.client.knowledgeListeners.size,0);
});


for(const fault of ['build_unavailable','host_mismatch','world_mismatch','capture_missing','situation_unsupported'])test(`real active ${fault} falls back to safe base without consumption`,async t=>{
 const f=factualFixture(),bodies=[];
 if(fault==='host_mismatch')f.actor.integrations.turnKnowledge.hostRunId=randomUUID();
 if(fault==='world_mismatch')f.actor.integrations.turnKnowledge.worldEpoch=2;
 if(fault==='capture_missing')delete f.actor.integrations.turnKnowledge;
 if(fault==='situation_unsupported')f.ps.observerSituationVersion=null;
 const h=await stockHarness('openai',{config:{dialogueKnowledge:{mode:'active'},retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>{bodies.push(JSON.parse(request.body));return response(false);}});
 h.runtime.intelligence=f.client;h.runtime.dialogueKnowledgeBuildSupported=fault!=='build_unavailable';
 h.runtime.services.speak=async({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const session=await h.openAIControllerSession({actorContext:f.actor});t.after(()=>session.connection.close());session.autoNativeAcks();h.context.negativeInput={pedId:'17',speaker:f.actor,text:'Hello'};
 const turn=await h.evaluate('ib(negativeInput)');const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.equal(result.status,'completed',result.terminalReason);assert.equal(bodies.length,1);
 const scene=JSON.parse(bodies[0].input[0].content.split('\n').find(line=>line.startsWith('{"frameVersion":1,')));assert.deepEqual(scene.lanes.PERCEIVED.observations,[]);assert.equal(bodies[0].input.at(-1).content,'Hello');assert.equal(JSON.stringify(bodies[0]).includes('turnKnowledge'),false);
 assert.ok([...f.ps.salience.ledger.values()].every(entry=>entry.consumedBy.size===0));assert.equal(f.client.knowledgeListeners.size,0);
});


for(const fault of ['refusal','incomplete','malformed','invalid_json'])test(`real active ${fault} never acknowledges perception delivery`,async t=>{
 const f=factualFixture();let outcome=null;const calls=[],keys=[...f.ps.salience.ledger.values()].map(row=>row.decisionKey),acknowledge=f.ps.salience.acknowledge.bind(f.ps.salience);f.ps.salience.acknowledge=(...args)=>{calls.push(args);return acknowledge(...args);};
 const h=await stockHarness('openai',{config:{dialogueKnowledge:{mode:'active'},retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async()=>{
  const content=fault==='refusal'?{type:'refusal',refusal:'Offline refusal'}:{type:'output_text',text:fault==='invalid_json'?'{broken':fault==='malformed'?'{"dialogue":"Hello."}':'{"dialogue":"Hello.","command":""}'};
  return new Response(JSON.stringify({status:fault==='incomplete'?'incomplete':'completed',output:[{type:'message',content:[content]}]}),{headers:{'content-type':'application/json'}});
 }});
 h.runtime.intelligence=f.client;h.runtime.dialogueKnowledgeBuildSupported=true;
 const finalize=h.runtime.services.finalizeKnowledgeFrame;h.runtime.services.finalizeKnowledgeFrame=(turn,args)=>{const frame=finalize(turn,args),finish=turn.knowledgeDelivery.finish;turn.knowledgeDelivery={...turn.knowledgeDelivery,finish:()=>{outcome=finish();return outcome;}};return frame;};
 h.runtime.services.speak=async()=>{throw new Error('Invalid reasoning must not reach speech');};
 const session=await h.openAIControllerSession({actorContext:f.actor});t.after(()=>session.connection.close());session.autoNativeAcks();h.context.failedInput={pedId:'17',speaker:f.actor,text:'What happened?'};
 const turn=await h.evaluate('ib(failedInput)');const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.notEqual(result.status,'completed');assert.equal(outcome.outcome,'rejected');assert.equal(outcome.selectedObservations,1);assert.deepEqual(calls,keys.map(key=>[key,'ps4_context','rejected']));assert.ok([...f.ps.salience.ledger.values()].every(entry=>entry.consumedBy.size===0));assert.equal(f.client.knowledgeListeners.size,0);assert.equal(h.runtime.history.readForSession('17',1).some(item=>item.role==='assistant'),false);
});
for(const terminal of ['contradictory_final','missing_final'])test(`PR21 T64 real active early TTS partial segments cannot acknowledge ${terminal}`,async t=>{
 const f=factualFixture();let pcm=0;
 const h=await stockHarness('openai',{config:{dialogueKnowledge:{mode:'active'},structuredStreamingEnabled:true,earlyTtsEnabled:true,retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async()=>{
  const item={id:'msg_bad_final',type:'message',role:'assistant',content:[]},bad=JSON.stringify({mode:'dialogue_only',segments:[{text:'Hello.'}],command:'invalid final command'});
  const events=[{type:'response.created',response:{id:'resp_bad_final',status:'in_progress'}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_text.delta',output_index:0,content_index:0,item_id:item.id,delta:responseText},{type:'response.completed',response:{id:'resp_bad_final',status:'completed',output:[{...item,status:'completed',content:[{type:'output_text',text:bad,annotations:[]}]}]}}];
  const stream=new ReadableStream({async start(controller){for(let index=0;index<(terminal==='missing_final'?3:events.length);index++){if(index===3)await new Promise(resolve=>setTimeout(resolve,10));const event=events[index];controller.enqueue(new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));}if(terminal==='missing_final')await new Promise(resolve=>setTimeout(resolve,10));controller.close();}});
  return new Response(stream,{headers:{'content-type':'text/event-stream'}});
 }});
 h.runtime.intelligence=f.client;h.runtime.dialogueKnowledgeBuildSupported=true;h.runtime.services.speak=async({onPcm})=>{pcm++;await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const session=await h.openAIControllerSession({actorContext:f.actor});t.after(()=>session.connection.close());session.autoNativeAcks();h.context.partialInput={pedId:'17',speaker:f.actor,text:'What happened?'};
 const turn=await h.evaluate('ib(partialInput)');const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.notEqual(result.status,'completed');assert.ok(pcm>0);assert.ok([...f.ps.salience.ledger.values()].every(entry=>entry.consumedBy.size===0));assert.equal(f.client.knowledgeListeners.size,0);assert.equal(h.runtime.history.readForSession('17',1).some(item=>item.role==='assistant'),false);
});

import {DialogueActionReceipts} from '../src/activities/dialogueActionReceipts.mjs';
function receiptSource(f){
 const store=new DialogueActionReceipts(),hostContext=f.ps.hostContext,binding={captureRef:f.ref,hostContext};
 const publication=store.publish({tuple:{pedId:'17',turnId:'previous',generationId:1,sessionNonce:1},binding,canonicalAction:'waithere',publishedAtMs:100,allowedActions:['waithere']});
 store.callback({...publication,succeeded:true,atGameTick:20,receivedAtMs:110});
 const activities={client:{runtime:{ready:true,dialogueActionVersion:1,nativeRun:randomUUID(),adapterEpoch:randomUUID(),hostContext}},readDialogueActionReceipts:scope=>store.read(scope)};
 return {store,activities,publication,binding};
}
for(const [mode,options] of [['buffered',{}],['streaming',{structuredStreamingEnabled:true}],['early TTS',{structuredStreamingEnabled:true,earlyTtsEnabled:true}]])for(const source of ['player_text','player_mic','special_event'])test(`real C05 SELF ${mode} ${source} receives frozen PS2/PS3 knowledge and acknowledges exact keys`,async t=>{
 const f=factualFixture(),r=receiptSource(f),bodies=[];
 const h=await stockHarness('openai',{config:{...options,dialogueKnowledge:{mode:'active',dialogueReceipts:'active'},retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>{const body=JSON.parse(request.body);bodies.push(body);return response(body.stream);}});
 h.runtime.intelligence=f.client;h.runtime.activities=r.activities;h.runtime.dialogueKnowledgeBuildSupported=true;h.runtime.services.capabilityHealth=()=>({'ps.dialogue_receipts':{active:true}});
 h.runtime.services.speak=async({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const session=await h.openAIControllerSession({actorContext:f.actor});t.after(()=>session.connection.close());session.autoNativeAcks();h.context.activeInput={pedId:'17',speaker:f.actor,text:'What happened?'};
 h.runtime.services.transcribe=async()=> 'What happened?';
 let turn;
 if(source==='player_text')turn=await h.evaluate('ib(activeInput)');
 else if(source==='special_event')turn=await h.evaluate('kb({speakerPedId:"17",listenerPedId:"player",content:"UNSUPPORTED_TRIGGER_CANARY",reason:"scene_event"})');
 else {
  turn=h.evaluate('(()=>{const value=Xi({pedId:"17",speakerPedId:"17",listenerPedId:"player",source:Ht.PLAYER_MIC,input:{transcript:"",contextText:""},metadata:{}});A.mic=ND();A.mic.activeTurnId=value.id;A.mic.status="listening";A.mic.pendingChunks=[];A.mic.sendChain=Promise.resolve();return value;})()');
  h.context.activeMic={speaker:f.actor,target:{pedId:'player'}};h.evaluate('Te=()=>{};hb=()=>{};OK=false');await h.evaluate('wd(activeMic)');
  await session.connection.sendRealtimeAudio(new Uint8Array([1,2]));await session.connection.endRealtimeInput();
 }
 const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.equal(result.status,'completed',result.terminalReason);assert.equal(bodies.length,1);
 const scene=JSON.parse(bodies[0].input[0].content.split('\n').find(line=>line.startsWith('{"frameVersion":1,')));
 if(source==='special_event'){assert.match(bodies[0].input.at(-1).content,/No player utterance was received/);assert.equal(JSON.stringify(bodies[0]).includes('UNSUPPORTED_TRIGGER_CANARY'),false);}else assert.equal(bodies[0].input.at(-1).content,'What happened?');
 assert.equal(scene.lanes.SELF.selfFacts.length,1);assert.match(scene.lanes.SELF.selfFacts[0].text,/handler accepted/);assert.match(scene.lanes.SELF.selfFacts[0].text,/completion was not established/);assert.ok(scene.lanes.PERCEIVED.observations.length);assert.equal(scene.lanes.PERCEIVED.observations[0].claims[0].kind,'firing');
 for(const secret of [f.ref,f.ps.epoch,f.ps.hostContext.hostRunId,r.publication.publicationId,r.activities.client.runtime.nativeRun,r.activities.client.runtime.adapterEpoch,'dialogueReferences','turnKnowledge','decisionKey'])assert.equal(JSON.stringify(bodies[0]).includes(secret),false);
 const entries=[...f.ps.salience.ledger.values()];assert.ok(entries.some(entry=>entry.consumedBy.has('ps4_context')));assert.ok(entries.every(entry=>!entry.consumedBy.has('ps6_ticket')));assert.equal(f.client.knowledgeListeners.size,0);
});

for(const fault of ['channel_reset','actor_retired','receipt_retired'])test(`real C05 in-flight ${fault} cancels the provider and preserves independent receipt evidence`,async t=>{
 const f=factualFixture(),r=receiptSource(f);let aborted=false;
 const h=await stockHarness('openai',{config:{dialogueKnowledge:{mode:'active',dialogueReceipts:'active'},retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>new Promise((resolve,reject)=>{
  request.signal.addEventListener('abort',()=>{aborted=true;reject(request.signal.reason);},{once:true});queueMicrotask(()=>{if(fault==='channel_reset')r.activities.client.runtime.adapterEpoch=randomUUID();else if(fault==='receipt_retired')r.store.retire(r.binding);else f.send('retire_batch',[f.ref]);f.client.notifyKnowledgeInvalidation();});
 })});h.runtime.intelligence=f.client;h.runtime.activities=r.activities;h.runtime.dialogueKnowledgeBuildSupported=true;h.runtime.services.capabilityHealth=()=>({'ps.dialogue_receipts':{active:true}});
 const session=await h.openAIControllerSession({actorContext:f.actor});t.after(()=>session.connection.close());session.autoNativeAcks();h.context.selfFault={pedId:'17',speaker:f.actor,text:'What did you try?'};
 const turn=await h.evaluate('ib(selfFault)'),result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});assert.equal(aborted,true);assert.notEqual(result.status,'completed');assert.equal(f.client.knowledgeListeners.size,0);assert.equal(h.runtime.history.readForSession('17',1).some(item=>item.role==='assistant'),false);assert.equal(r.store.read(r.binding).length,fault==='receipt_retired'?0:1);
});


test('PR21 T51 overlapping stock actor turns isolate observer knowledge and cancellation',async t=>{
 const f=factualFixture({allCapabilities:true}),otherRef=randomUUID(),bodies=[];
 assert.equal(f.send('anchors',[{captureRef:f.ref,kind:'ped',observer:true,owned:false},{captureRef:otherRef,kind:'ped',observer:true,owned:false}]),true);
 assert.equal(f.send('observer_index',[{captureRef:f.ref,kind:'ped',owned:false},{captureRef:otherRef,kind:'ped',owned:false}]),true);
 assert.equal(f.send('signal',{signalId:randomUUID(),producer:'state',producerSequence:1,kind:'injury_state',target:otherRef,source:null,gameTick:11,ageMs:0,facts:{health:50,armour:0,injured:true}}),true);
 const otherActor={pedId:'18',integrations:{turnKnowledge:{version:1,hostRunId:f.ps.hostContext.hostRunId,worldEpoch:1,captureRef:otherRef,sampledGameTick:11}}};
 let firstStarted;const firstRequest=new Promise(resolve=>firstStarted=resolve);
 const h=await stockHarness('openai',{config:{dialogueKnowledge:{mode:'active'},retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>{
  bodies.push(JSON.parse(request.body));
  if(bodies.length===1){firstStarted();return new Promise((resolve,reject)=>{request.signal.addEventListener('abort',()=>reject(request.signal.reason),{once:true});});}
  return response(false);
 }});
 h.runtime.intelligence=f.client;h.runtime.dialogueKnowledgeBuildSupported=true;
 h.runtime.services.speak=async({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const a=await h.openAIControllerSession({pedId:'17',actorContext:f.actor});t.after(()=>a.connection.close());a.autoNativeAcks();
 const b=await h.openAIControllerSession({pedId:'18',actorContext:otherActor});t.after(()=>b.connection.close());
 h.context.isolatedA={pedId:'17',speaker:f.actor,text:'A_ONLY_INPUT'};h.context.isolatedB={pedId:'18',speaker:otherActor,text:'B_ONLY_INPUT'};
 const first=await h.evaluate('ib(isolatedA)');await firstRequest;
 const second=await h.evaluate('ib(isolatedB)');
 const outcome=await b.connection.whenSettled({pedId:'18',turnId:second.id,generationId:second.generationId,sessionNonce:1});
 assert.equal(outcome.status,'completed',outcome.terminalReason);assert.equal(bodies.length,2);
 const scenes=bodies.map(body=>JSON.parse(body.input[0].content.split('\n').find(line=>line.startsWith('{"frameVersion":1,'))));
 const kinds=scenes.map(scene=>scene.lanes.PERCEIVED.observations.flatMap(row=>row.claims.map(claim=>claim.kind)));
 assert.deepEqual(kinds[0],['firing']);assert.deepEqual(kinds[1],['injured']);
 assert.equal(bodies[0].input.at(-1).content,'A_ONLY_INPUT');assert.equal(bodies[1].input.at(-1).content,'B_ONLY_INPUT');
 for(const [index,foreignInput] of [[0,'B_ONLY_INPUT'],[1,'A_ONLY_INPUT']])assert.equal(JSON.stringify(bodies[index]).includes(foreignInput),false);
 for(const body of bodies)for(const privateValue of [f.ref,otherRef,f.ps.hostContext.hostRunId])assert.equal(JSON.stringify(body).includes(privateValue),false);
 h.context.isolatedFirstId=first.id;await h.evaluate('Qi(isolatedFirstId,"test_cleanup")');
 const firstOutcome=await a.connection.whenSettled({pedId:'17',turnId:first.id,generationId:first.generationId,sessionNonce:1});assert.notEqual(firstOutcome.status,'completed');
 assert.equal(h.runtime.history.readForSession('17',1).some(row=>row.role==='assistant'),false);
 assert.equal(h.runtime.history.readForSession('18',1).filter(row=>row.role==='assistant').length,1);
 assert.equal(f.client.knowledgeListeners.size,0);
});


for(const [mode,options] of [['buffered',{}],['streaming',{structuredStreamingEnabled:true}],['early TTS',{structuredStreamingEnabled:true,earlyTtsEnabled:true}]])test(`PR21 T64 real active ${mode} ledger delivery survives later TTS failure`,{timeout:10000},async t=>{
 const f=factualFixture(),keys=[...f.ps.salience.ledger.values()].map(row=>row.decisionKey),calls=[],bodies=[],outcomes=[];
 const acknowledge=f.ps.salience.acknowledge.bind(f.ps.salience);
 f.ps.salience.acknowledge=(...args)=>{calls.push(args);return acknowledge(...args);};
 let reasoningFinished;const reasoningDone=new Promise(resolve=>reasoningFinished=resolve);
 const h=await stockHarness('openai',{config:{...options,dialogueKnowledge:{mode:'active'},retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>{
  assert.deepEqual(calls,[]);bodies.push(JSON.parse(request.body));return response(bodies.at(-1).stream);
 }});
 h.runtime.intelligence=f.client;h.runtime.dialogueKnowledgeBuildSupported=true;
 const finalize=h.runtime.services.finalizeKnowledgeFrame;
 h.runtime.services.finalizeKnowledgeFrame=(turn,args)=>{
  const frame=finalize(turn,args),success=turn.knowledgeDelivery.success;
  turn.knowledgeDelivery={...turn.knowledgeDelivery,success:decision=>{const outcome=success(decision);if(outcome){outcomes.push(outcome);reasoningFinished();}return outcome;}};
  return frame;
 };
 h.runtime.services.speak=async()=>{await reasoningDone;assert.equal(outcomes.length,1);assert.ok([...f.ps.salience.ledger.values()].some(row=>row.consumedBy.has('ps4_context')));throw Error('post_reasoning_tts_failure');};
 const session=await h.openAIControllerSession({actorContext:f.actor});t.after(()=>session.connection.close());session.autoNativeAcks();
 h.context.activeTtsFailure={pedId:'17',speaker:f.actor,text:'What happened?'};
 const turn=await h.evaluate('ib(activeTtsFailure)');
 const result=await session.connection.whenSettled({pedId:'17',turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.equal(result.status,'failed');assert.equal(bodies.length,1);
 const scene=JSON.parse(bodies[0].input[0].content.split('\n').find(line=>line.startsWith('{"frameVersion":1,')));
 assert.equal(scene.lanes.PERCEIVED.observations[0].claims[0].kind,'firing');
 assert.deepEqual(calls,keys.map(key=>[key,'ps4_context','delivered']));
 assert.equal(outcomes.length,1);assert.equal(outcomes[0].acknowledged,keys.length);assert.equal(outcomes[0].outcome,'delivered');
 for(const row of f.ps.salience.ledger.values()){assert.equal(row.consumedBy.has('ps4_context'),true);assert.equal(row.consumedBy.has('ps6_ticket'),false);assert.equal(row.consumedBy.has('ps5_memory'),false);}
 const history=h.runtime.history.readForSession('17',1);
 assert.equal(history.filter(row=>row.role==='user').length,1);assert.equal(history.some(row=>row.role==='assistant'),false);
 assert.equal(f.client.knowledgeListeners.size,0);
});


for(const [mode,options] of [['buffered',{}],['streaming',{structuredStreamingEnabled:true}],['early TTS',{structuredStreamingEnabled:true,earlyTtsEnabled:true}]])for(const terminal of ['success','exhausted'])test(`PR21 T65 real active ${mode} retry ${terminal} records one terminal acknowledgement`,async t=>{
 const f=factualFixture(),keys=[...f.ps.salience.ledger.values()].map(row=>row.decisionKey),calls=[],bodies=[];
 const acknowledge=f.ps.salience.acknowledge.bind(f.ps.salience);
 f.ps.salience.acknowledge=(...args)=>{calls.push(args);return acknowledge(...args);};
 let speech=0;
 const h=await stockHarness('openai',{config:{...options,dialogueKnowledge:{mode:'active'},retry:{enabled:true,maxAttempts:2,baseDelayMs:0,maxDelayMs:0},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>{
  assert.deepEqual(calls,[],'An intermediate attempt acknowledged delivery or final rejection');bodies.push(request.body);
  if(bodies.length===1 || terminal==='exhausted')return new Response(JSON.stringify({error:{code:'server_error'}}),{status:503,headers:{'content-type':'application/json'}});
  return response(JSON.parse(request.body).stream);
 }});
 h.runtime.intelligence=f.client;h.runtime.dialogueKnowledgeBuildSupported=true;
 h.runtime.services.speak=async({onPcm})=>{speech++;await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const session=await h.openAIControllerSession({actorContext:f.actor});t.after(()=>session.connection.close());session.autoNativeAcks();
 h.context.retryAckInput={pedId:'17',speaker:f.actor,text:'What happened?'};
 const turn=await h.evaluate('ib(retryAckInput)');
 const result=await session.connection.whenSettled({pedId:'17',turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);
 assert.deepEqual(calls,keys.map(key=>[key,'ps4_context',terminal==='success'?'delivered':'rejected']));
 assert.equal(result.status==='completed',terminal==='success');assert.equal(speech>0,terminal==='success');
 for(const row of f.ps.salience.ledger.values()){assert.equal(row.consumedBy.has('ps4_context'),terminal==='success');assert.equal(row.consumedBy.has('ps6_ticket'),false);assert.equal(row.consumedBy.has('ps5_memory'),false);}
 const history=h.runtime.history.readForSession('17',1);assert.equal(history.filter(row=>row.role==='user').length,1);assert.equal(history.some(row=>row.role==='assistant'),terminal==='success');
 assert.equal(f.client.knowledgeListeners.size,0);
});
