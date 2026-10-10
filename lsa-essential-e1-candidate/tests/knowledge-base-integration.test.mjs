import test from 'node:test';
import assert from 'node:assert/strict';
import {stockHarness} from './stock-harness.mjs';
import {separateKnowledgeInstruction,composeKnowledgeInstruction,KNOWLEDGE_SLOT} from '../src/context/knowledgeInstructions.mjs';

const responseText=JSON.stringify({mode:'dialogue_only',segments:[{text:'Hello.'}],command:''});
function response(stream){
 if(!stream)return new Response(JSON.stringify({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"dialogue":"Hello.","command":""}'}]}]}),{headers:{'content-type':'application/json'}});
 const item={id:'msg_frame',type:'message',role:'assistant',content:[]};
 const events=[{type:'response.created',response:{id:'resp_frame',status:'in_progress'}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_text.delta',output_index:0,content_index:0,item_id:item.id,delta:responseText},{type:'response.completed',response:{id:'resp_frame',status:'completed',output:[{...item,status:'completed',content:[{type:'output_text',text:responseText,annotations:[]}]}]}}];
 return new Response(events.map(event=>`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
}
test('stock context placeholders designate one frame without reprocessing data as slots',()=>{
 const text=separateKnowledgeInstruction('Before {YOU} between {WORLD} after {CURRENT_LISTENER} {VISIBLE_SCENE}');
 assert.equal(text.split(KNOWLEDGE_SLOT).length-1,1);
 const result=composeKnowledgeInstruction(text,'{"fact":"{WORLD}"}','Output rules');
 assert.equal(result.split('[CURRENT REQUEST CONTEXT]').length-1,1);assert.ok(result.includes('"fact":"{WORLD}"'));
});
test('real pinned dM action/language component bypasses all raw scene expansion for OpenAI',async()=>{
 const h=await stockHarness('openai');
 h.evaluate('var iT="Speak {LANGUAGE}. Allowed actions: {VALID_ACTIONS}\\n{YOU}\\n{CURRENT_LISTENER}\\n{VISIBLE_SCENE}\\n{WORLD}"; JO=()=>"English"; dM=stockDm; FM=GM=mT=ET=()=>{throw new Error("raw scene expansion called")};');
 h.context.privateActor={pedId:'17',roleName:'Civilian',personaDescription:'ACTOR_CANARY',roleContext:'ROLE_CANARY',availableWeaponsContext:'Available weapons: none',integrations:{unknown:'INTEGRATION_CANARY'}};
 h.context.privateListener={pedId:'player',name:'LISTENER_CANARY'};
 const prompt=h.evaluate('BK(privateActor,privateListener,"npc",{weather:"WORLD_CANARY"})');
 assert.ok(prompt.includes('Speak English.'));assert.ok(prompt.includes('DO'));assert.ok(prompt.includes('NPC-TO-NPC DIRECT SPEECH MODE'));
 assert.equal(prompt.split(KNOWLEDGE_SLOT).length-1,1);
 for(const secret of ['ACTOR_CANARY','ROLE_CANARY','INTEGRATION_CANARY','LISTENER_CANARY','WORLD_CANARY'])assert.ok(!prompt.includes(secret));
});
test('Gemini continues the stock scene path without PS4 opt-in',async()=>{
 const h=await stockHarness('gemini');h.evaluate('ET=()=>"Gemini stock scene"; dM=()=>{throw new Error("OpenAI instruction separation called")};');
 assert.equal(h.evaluate('BK({pedId:"17"},null,"player")'),'Gemini stock scene');
});
for(const [mode,options] of [['buffered',{}],['streaming',{structuredStreamingEnabled:true}],['early TTS',{structuredStreamingEnabled:true,earlyTtsEnabled:true}]]){
 for(const source of ['player_text','player_mic','special_event'])test(`production ${mode} ${source} sends one hardened base frame`,async t=>{
  const bodies=[];
  const h=await stockHarness('openai',{config:{...options,retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>{const body=JSON.parse(request.body);bodies.push(body);return response(body.stream);}});
  h.runtime.services.speak=async({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};h.runtime.services.transcribe=async()=> 'Accepted words';
  let finalized=0;const finalize=h.runtime.services.finalizeKnowledgeFrame;h.runtime.services.finalizeKnowledgeFrame=(...args)=>{finalized++;return finalize(...args);};
  const actor=h.evaluate('ia({pedId:"17",isArmed:false,gender:"male",personaDescription:"ACTOR_CANARY",roleContext:"ROLE_CANARY",vehicleContext:"VEHICLE_CANARY",radioContext:"RADIO_CANARY",weaponDescription:"WEAPON_CANARY. Arbitrary prose.",availableWeaponsContext:"Available weapons: pistol",nearbyPersonReferences:{P001:"abcde"},integrations:{privateText:"INTEGRATION_CANARY"}},"speaker")');
  const session=await h.openAIControllerSession({actorContext:actor,targetContext:{pedId:'player',name:'LISTENER_CANARY',weaponDescription:'LISTENER_INVENTORY_CANARY'}});t.after(()=>session.connection.close());session.autoNativeAcks();
  let turn;
  if(source==='player_text'){h.context.frameInput={pedId:'17',speaker:actor,text:'Accepted words',contextUpdate:'LIVE_CANARY'};turn=await h.evaluate('ib(frameInput)');}
  else if(source==='special_event')turn=await h.evaluate('kb({speakerPedId:"17",listenerPedId:"player",content:"TRIGGER_CANARY",reason:"scene_event"})');
  else {
   turn=h.evaluate('(()=>{const value=Xi({pedId:"17",speakerPedId:"17",listenerPedId:"player",source:Ht.PLAYER_MIC,input:{transcript:"",contextText:""},metadata:{}});A.mic=ND();A.mic.activeTurnId=value.id;A.mic.status="listening";A.mic.pendingChunks=[];A.mic.sendChain=Promise.resolve();return value;})()');
   h.context.micFrame={speaker:actor,target:{pedId:'player',name:'LISTENER_CANARY'},world:{weather:'CLEAR'}};h.evaluate('Te=()=>{};hb=()=>{};OK=false');await h.evaluate('wd(micFrame)');
   await session.connection.sendRealtimeText('LIVE_CANARY');await session.connection.sendRealtimeAudio(new Uint8Array([1,2]));await session.connection.endRealtimeInput();
  }
  const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
  assert.equal(result.status,'completed',result.terminalReason);assert.equal(finalized,1);assert.equal(bodies.length,1);
  const body=bodies[0],serialized=JSON.stringify(body);assert.ok(!serialized.includes('CANARY'));assert.ok(!serialized.includes('abcde'));assert.ok(!serialized.includes('"pedId"'));
  assert.equal(body.input[0].content.split('[CURRENT REQUEST CONTEXT]').length-1,1);
  const lanes=JSON.parse(body.input[0].content.split('\n').find(line=>line.startsWith('{"frameVersion":1,'))).lanes;
  assert.deepEqual(lanes.PERCEIVED.observations,[]);assert.equal(lanes.COMPAT.listener.address,'A');
  if(source==='special_event')assert.match(body.input.at(-1).content,/No player utterance was received/);
  else {assert.equal(body.input.at(-1).content,'Accepted words');assert.equal(serialized.split('Accepted words').length-1,1);}
 });
}
test('retry reuses the same finalized frame and outbound bytes after live context/history changes',async t=>{
 const bodies=[];let h;
 h=await stockHarness('openai',{config:{retry:{enabled:true,maxAttempts:2,baseDelayMs:0,maxDelayMs:0},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>{
  bodies.push(request.body);
  if(bodies.length===1){h.evaluate('A.context.world.weather="LATE_WORLD_CANARY";A.activeActor.availableWeaponsContext="LATE_INVENTORY_CANARY"');h.runtime.history.readForSession=()=>[{role:'assistant',content:'LATE_HISTORY_CANARY'}];return new Response(JSON.stringify({error:{code:'server_error'}}),{status:503,headers:{'content-type':'application/json'}});}
  return response(false);
 }});
 let finalized=0;const finalize=h.runtime.services.finalizeKnowledgeFrame;h.runtime.services.finalizeKnowledgeFrame=(...args)=>{finalized++;return finalize(...args);};
 h.runtime.services.speak=async({onPcm})=>{await onPcm(new Uint8Array([1,2]));return {bytes:2};};
 const session=await h.openAIControllerSession();t.after(()=>session.connection.close());session.autoNativeAcks();
 const turn=await h.evaluate('ib({pedId:"17",speaker:testActor,target:testTarget,world:{weather:"CLEAR"},text:"Accepted words"})');
 const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.equal(result.status,'completed',result.terminalReason);assert.equal(finalized,1);assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);assert.ok(!bodies[1].includes('CANARY'));
});
test('mandatory current-input overflow fails before fetch while retaining accepted player history policy',async t=>{
 let calls=0;
 const h=await stockHarness('openai',{config:{persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async()=>{calls++;return response(false);}});
 const session=await h.openAIControllerSession();t.after(()=>session.connection.close());session.autoNativeAcks();
 h.runtime.services.transcribe=async()=> 'x'.repeat(12001);
 const turn=h.evaluate('(()=>{const value=Xi({pedId:"17",speakerPedId:"17",listenerPedId:"player",source:Ht.PLAYER_MIC,input:{transcript:"",contextText:""},metadata:{}});A.mic=ND();A.mic.activeTurnId=value.id;A.mic.status="listening";A.mic.pendingChunks=[];A.mic.sendChain=Promise.resolve();return value;})()');
 h.context.oversizeMic={speaker:{pedId:'17'},target:{pedId:'player'}};h.evaluate('Te=()=>{};hb=()=>{};OK=false');await h.evaluate('wd(oversizeMic)');
 await session.connection.sendRealtimeAudio(new Uint8Array([1,2]));await session.connection.endRealtimeInput();
 const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.equal(result.status,'failed');assert.equal(result.terminalReason,'model_error');assert.equal(calls,0);
 const history=h.runtime.history.readForSession('17',1);assert.equal(history.length,1);assert.equal(history[0].role,'user');assert.equal(history[0].content.length,12000);
});


import {createKnowledgeDelivery} from '../src/context/knowledgeDelivery.mjs';
for(const [mode,options] of [['buffered',{}],['streaming',{structuredStreamingEnabled:true}],['early TTS',{structuredStreamingEnabled:true,earlyTtsEnabled:true}]])test(`real ${mode} acknowledges final reasoning before later TTS failure`,async t=>{
 const calls=[],outcomes=[];let releaseSpeech;const reasoningDone=new Promise(resolve=>{releaseSpeech=resolve;});
 const h=await stockHarness('openai',{config:{...options,retry:{enabled:false,maxAttempts:1},persistentIdentity:{enabled:false},promotedCharacters:{enabled:false}},env:{OPENAI_API_KEY:'offline'},fetchImpl:async(_url,request)=>response(JSON.parse(request.body).stream)});
 const finalize=h.runtime.services.finalizeKnowledgeFrame;
 h.runtime.services.finalizeKnowledgeFrame=(turn,args)=>{
  const base=finalize(turn,args),scene=JSON.parse(base.modelAllocation.scene);scene.lanes.PERCEIVED.observations=[{event:'injury',claims:[{modality:'visual',certainty:'supported',kind:'injured',subject:'anonymous person'}],freshness:'recent'}];
  const frame={...base,modelAllocation:{...base.modelAllocation,scene:JSON.stringify(scene)},delivery:[{observationId:'frozen-observation',revision:1,decisionKey:'frozen-key'}]};
  turn.knowledgeDelivery=createKnowledgeDelivery({frame,baseFrame:base,isCurrent:()=>h.runtime.host.isCurrent(turn.identity),acknowledge:(...args)=>{calls.push(args);return true;},onOutcome:value=>{outcomes.push(value);releaseSpeech();}});
  return frame;
 };
 h.runtime.services.speak=async()=>{await reasoningDone;throw new Error('post_reasoning_tts_failure');};
 const session=await h.openAIControllerSession();t.after(()=>session.connection.close());session.autoNativeAcks();
 const turn=await h.evaluate('ib({pedId:"17",speaker:testActor,target:testTarget,text:"Hello"})');
 const result=await session.connection.whenSettled({pedId:turn.pedId,turnId:turn.id,generationId:turn.generationId,sessionNonce:1});
 assert.equal(result.status,'failed');assert.deepEqual(calls,[['frozen-key','ps4_context','delivered']]);assert.equal(outcomes.length,1);assert.equal(outcomes[0].outcome,'delivered');assert.match(outcomes[0].requestHash,/^[a-f0-9]{64}$/);assert.equal(h.runtime.history.readForSession('17',1).some(item=>item.role==='assistant'),false);
});
