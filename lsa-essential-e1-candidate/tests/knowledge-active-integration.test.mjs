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
for(const [mode,options] of [['buffered',{}],['streaming',{structuredStreamingEnabled:true}],['early TTS',{structuredStreamingEnabled:true,earlyTtsEnabled:true}]])test(`real active ${mode} request receives frozen PS2/PS3 knowledge and acknowledges exact keys`,async t=>{
 const f=factualFixture(),bodies=[];
 const h=await stockHarness('openai',{config:{...options,dialogueKnowledge:{mode:'active'},retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>{const body=JSON.parse(request.body);bodies.push(body);return response(body.stream);}});
 h.runtime.intelligence=f.client;h.runtime.dialogueKnowledgeBuildSupported=true;
 h.runtime.services.speak=async({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const session=await h.openAIControllerSession({actorContext:f.actor});t.after(()=>session.connection.close());session.autoNativeAcks();h.context.activeInput={pedId:'17',speaker:f.actor,text:'What happened?'};
 const turn=await h.evaluate('ib(activeInput)');const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.equal(result.status,'completed',result.terminalReason);assert.equal(bodies.length,1);
 const scene=JSON.parse(bodies[0].input[0].content.split('\n').find(line=>line.startsWith('{"frameVersion":1,')));
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
