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

function factualFixture(){
 const client=new IntelligenceClient({mode:'shadow'},{report:()=>{}}),ps=client.runtime;
 const hello={version:1,type:'hello',adapterEpoch:randomUUID(),streamId:randomUUID(),hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1,observerIndexVersion:1,observerSituationVersion:1,capabilities:Object.fromEntries(CAPABILITIES.map(key=>[key,key==='shooting']))};
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


for(const fault of ['refusal','incomplete','malformed'])test(`real active ${fault} never acknowledges perception delivery`,async t=>{
 const f=factualFixture();let outcome=null;
 const h=await stockHarness('openai',{config:{dialogueKnowledge:{mode:'active'},retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async()=>{
  const content=fault==='refusal'?{type:'refusal',refusal:'Offline refusal'}:{type:'output_text',text:fault==='malformed'?'{"dialogue":"Hello."}':'{"dialogue":"Hello.","command":""}'};
  return new Response(JSON.stringify({status:fault==='incomplete'?'incomplete':'completed',output:[{type:'message',content:[content]}]}),{headers:{'content-type':'application/json'}});
 }});
 h.runtime.intelligence=f.client;h.runtime.dialogueKnowledgeBuildSupported=true;
 const finalize=h.runtime.services.finalizeKnowledgeFrame;h.runtime.services.finalizeKnowledgeFrame=(turn,args)=>{const frame=finalize(turn,args),finish=turn.knowledgeDelivery.finish;turn.knowledgeDelivery={...turn.knowledgeDelivery,finish:()=>{outcome=finish();return outcome;}};return frame;};
 h.runtime.services.speak=async()=>{throw new Error('Invalid reasoning must not reach speech');};
 const session=await h.openAIControllerSession({actorContext:f.actor});t.after(()=>session.connection.close());session.autoNativeAcks();h.context.failedInput={pedId:'17',speaker:f.actor,text:'What happened?'};
 const turn=await h.evaluate('ib(failedInput)');const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.notEqual(result.status,'completed');assert.equal(outcome.outcome,'rejected');assert.equal(outcome.selectedObservations,1);assert.ok([...f.ps.salience.ledger.values()].every(entry=>entry.consumedBy.size===0));assert.equal(f.client.knowledgeListeners.size,0);assert.equal(h.runtime.history.readForSession('17',1).some(item=>item.role==='assistant'),false);
});
test('real active early TTS partial segments cannot acknowledge a contradictory final response',async t=>{
 const f=factualFixture();let pcm=0;
 const h=await stockHarness('openai',{config:{dialogueKnowledge:{mode:'active'},structuredStreamingEnabled:true,earlyTtsEnabled:true,retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async()=>{
  const item={id:'msg_bad_final',type:'message',role:'assistant',content:[]},bad=JSON.stringify({mode:'dialogue_only',segments:[{text:'Hello.'}],command:'invalid final command'});
  const events=[{type:'response.created',response:{id:'resp_bad_final',status:'in_progress'}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_text.delta',output_index:0,content_index:0,item_id:item.id,delta:responseText},{type:'response.completed',response:{id:'resp_bad_final',status:'completed',output:[{...item,status:'completed',content:[{type:'output_text',text:bad,annotations:[]}]}]}}];
  const stream=new ReadableStream({async start(controller){for(let index=0;index<events.length;index++){if(index===3)await new Promise(resolve=>setTimeout(resolve,10));const event=events[index];controller.enqueue(new TextEncoder().encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));}controller.close();}});
  return new Response(stream,{headers:{'content-type':'text/event-stream'}});
 }});
 h.runtime.intelligence=f.client;h.runtime.dialogueKnowledgeBuildSupported=true;h.runtime.services.speak=async({onPcm})=>{pcm++;await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const session=await h.openAIControllerSession({actorContext:f.actor});t.after(()=>session.connection.close());session.autoNativeAcks();h.context.partialInput={pedId:'17',speaker:f.actor,text:'What happened?'};
 const turn=await h.evaluate('ib(partialInput)');const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.notEqual(result.status,'completed');assert.ok(pcm>0);assert.ok([...f.ps.salience.ledger.values()].every(entry=>entry.consumedBy.size===0));assert.equal(f.client.knowledgeListeners.size,0);assert.equal(h.runtime.history.readForSession('17',1).some(item=>item.role==='assistant'),false);
});
