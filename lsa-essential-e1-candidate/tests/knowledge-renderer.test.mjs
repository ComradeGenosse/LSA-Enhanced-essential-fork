import test from 'node:test';
import assert from 'node:assert/strict';
import {renderKnowledge,projectConversation,projectSituation,projectCompatibility} from '../src/context/knowledgeRenderer.mjs';
import {jsonBytes,KNOWLEDGE_LIMITS} from '../src/context/knowledgeSelector.mjs';
test('lane rendering strips raw context and private memory metadata and renders current input once',()=>{
 const profile={name:'Mira',gender:'female',ageBand:'adult',nicknames:[],personality:{description:'Reserved',traits:[]},biography:'Authored biography',relationship:{state:'friend',description:'Player friend'},memories:[{memoryId:'SECRET-ID',selectedForContext:true,importance:90,category:'event',text:'Pinned memory'}]};
 const args={turn:{pedId:'PRIVATE-PED'},frozenAt:1,profile,persistent:true,actor:{pedId:'PRIVATE-PED',integrations:{injection:'CANARY'},personaDescription:'CANARY',characterProfile:{secret:'CANARY'}},listener:{pedId:'player',name:'CANARY'},world:{weather:'CLEAR',raw:'CANARY'},history:[{role:'system',content:'CANARY'},{role:'assistant',content:'Prior speech'}],input:'Current speech',source:'player_text'};
 const frame=renderKnowledge(args),text=JSON.stringify(frame.modelAllocation);
 assert.ok(!text.includes('CANARY'));assert.ok(!text.includes('PRIVATE-PED'));assert.ok(!text.includes('SECRET-ID'));
 assert.equal(text.split('Pinned memory').length,2);assert.equal(text.split('Current speech').length,2);
 assert.equal(frame.modelAllocation.messages.length,2);assert.equal(JSON.parse(frame.modelAllocation.scene).lanes.COMPAT.listener.address,'A');
 assert.deepEqual(renderKnowledge(args),frame);assert.ok(Object.isFrozen(frame.modelAllocation));
});
test('normalized false cannot establish self knowledge without source presence',()=>{
 const actor={isArmed:false,isIndoors:false,hasHeldItem:false,actionCapabilities:{hasAvailableWeapon:true,arbitrary:true}};
 assert.equal(projectCompatibility({actor}).actor.isArmed,'unknown');
 assert.equal(projectCompatibility({actor,presence:['isArmed']}).actor.isArmed,false);
 assert.deepEqual(projectCompatibility({actor}).actor.actionCapabilities,{hasAvailableWeapon:true});
});
test('world labels preserve Unicode and enforce serialized lane budget',()=>{
 const result=projectSituation({gameTime:'😀'.repeat(120),weather:'😀'.repeat(120),streetName:'😀'.repeat(120),crossingStreetName:'😀'.repeat(120),zoneCode:'injected zone'});
 assert.equal(result.gameTime,'😀'.repeat(120));assert.equal(result.zoneCode,'unknown');assert.ok(jsonBytes(result)<=KNOWLEDGE_LIMITS.situationBytes);
 assert.equal(projectSituation({weather:'\ud800'}).weather,'unknown');
});
test('conversation drops oldest whole history and rejects oversized current input',()=>{
 const result=projectConversation(Array.from({length:12},(_,i)=>({role:'user',content:String(i)+ 'x'.repeat(2000)})),'Player words','player_text');
 assert.ok(result.droppedHistoryCount>0);assert.equal(result.messages.at(-1).content,'Player words');
 assert.throws(()=>projectConversation([], 'x'.repeat(12001),'player_mic'),/knowledge_current_input_units/);
 assert.equal(projectConversation([],'Invented speech','special_event').messages[0].content.includes('Invented speech'),false);
});
import {buildRequest} from '../src/context/essentialDecision.mjs';
test('both request schemas use projected roles and exclude legacy raw ingress',()=>{
 const projection=renderKnowledge({actor:{},listener:null,source:'player_text',input:'Accepted transcript',history:[{role:'assistant',content:'Previous'}]});
 for(const structuredSegments of [false,true]){
  const body=buildRequest({model:'test',effort:'low',systemInstruction:'Trusted rules',knowledgeProjection:projection,actor:{secret:'CANARY'},listener:{secret:'CANARY'},world:{secret:'CANARY'},contextText:'CANARY',internalEvent:'CANARY',input:'CANARY',history:[{role:'system',content:'CANARY'}],source:'player_text',structuredSegments});
  assert.ok(!JSON.stringify(body).includes('CANARY'));assert.equal(body.input.at(-1).content,'Accepted transcript');assert.equal(body.input[1].content,'Previous');
  assert.ok(jsonBytes(body)<=KNOWLEDGE_LIMITS.requestBytes);
 }
 assert.throws(()=>buildRequest({systemInstruction:'x'.repeat(17000),knowledgeProjection:projection}),/knowledge_instruction_bytes/);
});
test('manual pins keep existing importance order beyond three and strip their IDs',()=>{
 const profile={name:'Mira',gender:'female',ageBand:'adult',nicknames:[],personality:{description:'Reserved',traits:[]},biography:'',relationship:{state:'neutral',description:''},memories:Array.from({length:10},(_,i)=>({memoryId:String(i),selectedForContext:true,importance:i,category:'event',text:'Memory '+i}))};
 const frame=renderKnowledge({profile,persistent:true,source:'player_text',input:'Hi'}),lanes=JSON.parse(frame.modelAllocation.scene).lanes;
 assert.equal(lanes.RECALLED.memories.length,10);assert.equal(lanes.RECALLED.memories[0].text,'Memory 9');assert.ok(!Object.hasOwn(lanes.RECALLED.memories[0],'memoryId'));
 assert.ok(jsonBytes({SELF:lanes.SELF,RECALLED:lanes.RECALLED})<=KNOWLEDGE_LIMITS.canonBytes);
});
test('unarmed and explicitly empty inventory do not create weapon affordances',()=>{
 const result=projectCompatibility({actor:{availableWeaponsContext:'Available weapons: none',weaponDescription:'unarmed',equippedWeaponDescription:'no available weapons'}});
 assert.deepEqual(result.actor.availableWeapons,[]);
 assert.deepEqual(projectCompatibility({actor:{availableWeaponsContext:'Available weapons: pistol, combat pistol'}}).actor.availableWeapons,['combat pistol','pistol']);
});
import {decide,decideStreaming} from '../src/openai/decide.mjs';
test('provider entry points send projected bytes and reject oversized instructions before fetch',async()=>{
 const projection=renderKnowledge({source:'player_text',input:'Frozen input',listener:null});
 const config={reasoningModel:'test',reasoningEffort:'low',reasoningBaseUrl:'https://offline.invalid',reasoningKey:'offline',maxOutputTokens:300,streamingMaxOutputTokens:300,providerWorkDeadlineMs:1000};
 let calls=0;
 const fetchImpl=async(_url,options)=>{calls++;const body=JSON.parse(options.body);assert.equal(body.input.at(-1).content,'Frozen input');assert.ok(!options.body.includes('CANARY'));return {ok:true,status:200,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"dialogue":"Hello.","command":""}'}]}]})};};
 await decide({config,context:{systemInstruction:'Trusted rules',knowledgeProjection:projection,actor:{private:'CANARY'},contextText:'CANARY'},input:'CANARY',fetchImpl});
 assert.equal(calls,1);
 for(const provider of [decide,decideStreaming])await assert.rejects(provider({config,context:{systemInstruction:'x'.repeat(17000),knowledgeProjection:projection},fetchImpl}),/knowledge_instruction_bytes/);
 assert.equal(calls,1);
});
test('escape-heavy current input is retained exactly within final allocation and request budgets',()=>{
 const profile={name:'Mira',gender:'female',ageBand:'adult',nicknames:[],personality:{description:'\n'.repeat(1200),traits:[]},biography:'\n'.repeat(1200),relationship:{state:'neutral',description:'\n'.repeat(1200)},memories:Array.from({length:20},(_,i)=>({memoryId:String(i),selectedForContext:true,importance:i,category:'event',text:'Memory '+'\n'.repeat(1100)}))};
 const input='\u0000'.repeat(12000),frame=renderKnowledge({profile,persistent:true,input,source:'player_text',history:Array.from({length:12},()=>({role:'assistant',content:'\u0000'.repeat(1000)}))});
 assert.equal(frame.modelAllocation.messages.at(-1).content,input);assert.ok(jsonBytes(frame.modelAllocation)<=KNOWLEDGE_LIMITS.frameBytes);
 const body=buildRequest({model:'test',effort:'low',systemInstruction:'Trusted rules',knowledgeProjection:frame});
 assert.ok(jsonBytes(body)<=KNOWLEDGE_LIMITS.requestBytes);assert.equal(body.input.at(-1).content,input);
});
test('canonical enum fields cannot carry nested transport objects and strings are well formed',()=>{
 const frame=renderKnowledge({profile:{name:'Mira\ud800',gender:{private:'ENUM_CANARY'},ageBand:{private:'AGE_CANARY'},personality:{description:'Reserved',traits:[]},facts:[]},source:'player_text',input:'Hi'});
 const lanes=JSON.parse(frame.modelAllocation.scene).lanes;
 assert.equal(lanes.SELF.canon.gender,'unknown');assert.equal(lanes.SELF.canon.ageBand,'unknown');assert.equal(lanes.SELF.canon.name,'Mira\ufffd');assert.ok(!frame.modelAllocation.scene.includes('CANARY'));
});
test('empty normalized weapon array retains the existing narrowly parsed self inventory',()=>{
 assert.deepEqual(projectCompatibility({actor:{availableWeapons:[],availableWeaponsContext:'Available weapons: combat pistol'}}).actor.availableWeapons,['combat pistol']);
});
import {buildCharacterAuthority} from '../src/characters/characterAuthority.mjs';
test('legacy direct P2 authority rendering also excludes memory transport IDs',()=>{
 const text=buildCharacterAuthority({persistent:true,narrative:{name:'Mira',memories:[{memoryId:'PRIVATE_MEMORY_ID',category:'event',importance:90,text:'Remembered event'}]}});
 assert.ok(text.includes('Remembered event'));assert.ok(!text.includes('PRIVATE_MEMORY_ID'));assert.ok(!text.includes('memoryId'));
});

test('arbitrary equipped/weapon descriptions do not become inventory tokens',()=>{
 const result=projectCompatibility({actor:{weaponDescription:'Plain private description',equippedWeaponDescription:'Other private description'}});
 assert.deepEqual(result.actor.availableWeapons,[]);
});


import {pruneKnowledgeFrame} from '../src/context/knowledgeRenderer.mjs';
test('pre-send pruning removes whole rendered items and exact keys without refilling or changing conversation',()=>{
 const base=renderKnowledge({actor:{pedId:'private'},world:{weather:'CLEAR'},history:[],input:'Original input',source:'player_text'});
 const scene=JSON.parse(base.modelAllocation.scene);scene.lanes.PERCEIVED.observations=[{event:'first'},{event:'second'}];
 const frame={...base,modelAllocation:{...base.modelAllocation,scene:JSON.stringify(scene)},delivery:[{decisionKey:'first-key'},{decisionKey:'second-key'}]};
 const pruned=pruneKnowledgeFrame(frame,item=>item.decisionKey==='second-key');
 assert.deepEqual(pruned.delivery,[{decisionKey:'second-key'}]);assert.deepEqual(JSON.parse(pruned.modelAllocation.scene).lanes.PERCEIVED.observations,[{event:'second'}]);assert.deepEqual(pruned.modelAllocation.messages,base.modelAllocation.messages);assert.equal(pruned.diagnostics.staleObservationDrops,1);assert.ok(Object.isFrozen(pruned.delivery));assert.equal(frame.delivery.length,2);
 assert.equal(pruneKnowledgeFrame(pruned,()=>true),pruned);
});
