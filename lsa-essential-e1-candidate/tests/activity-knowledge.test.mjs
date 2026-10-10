import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {projectActivityKnowledge} from '../src/activities/activityKnowledge.mjs';
import {renderKnowledge,pruneKnowledgeFrame} from '../src/context/knowledgeRenderer.mjs';
const fixture=()=>{const binding={characterId:randomUUID(),encounterId:randomUUID(),incarnationId:randomUUID(),hostContext:{hostContextVersion:1,hostRunId:randomUUID(),worldEpoch:1}};const facts=['instructed','accepted','mode_established','completed'].map((kind,index)=>({factVersion:1,factId:randomUUID(),activityId:randomUUID(),goalId:randomUUID(),characterId:binding.characterId,kind,intent:'accompany',evidence:index===3?'world_strong':index===2?'mode_flag':'none',atMs:1000,placeLabel:'PRIVATE_PLACE_CANARY',reason:'PRIVATE_REASON_CANARY',provenance:{...binding.hostContext,encounterId:binding.encounterId,incarnationId:binding.incarnationId}}));return {binding,facts};};
test('ACT SELF projection separates instruction/admission/mode/completion and hides all private metadata',()=>{
 const input=fixture(),result=projectActivityKnowledge(input);assert.equal(result.facts.length,4);assert.match(result.facts[3].text,/was asked/);assert.match(result.facts[2].text,/was admitted/);assert.match(result.facts[1].text,/does not establish arrival or completion/);assert.match(result.facts[0].text,/completed with physical evidence/);
 const model=JSON.stringify(result.facts);for(const id of [input.binding.characterId,input.binding.encounterId,input.binding.incarnationId,input.binding.hostContext.hostRunId,...input.facts.flatMap(f=>[f.factId,f.activityId,f.goalId])])assert.ok(!model.includes(id));assert.doesNotMatch(model,/PRIVATE_/);assert.ok(Object.isFrozen(result.facts[0]));
 input.facts[0].kind='failed';assert.match(result.facts[3].text,/was asked/);
});
test('ACT contributor rejects wrong lifetime and unsupported intent, and never upgrades weak completion',()=>{
 const input=fixture();input.facts[0].provenance.incarnationId=randomUUID();input.facts[1].intent='walk_to';input.facts[3].evidence='handler_only';const projected=projectActivityKnowledge(input);assert.equal(projected.omitted,2);assert.equal(projected.facts.length,2);assert.match(projected.facts[0].text,/physical execution was not established/);assert.doesNotMatch(projected.facts[0].text,/completed/);
});
test('single renderer adds bounded optional ACT SELF facts without changing the default frame or emitting refs',()=>{
 const activityInputs=fixture(),options={actor:{pedId:'17'},world:{},referenceMap:{},input:'What happened?',source:'player_text',history:[],activityInputs};
 const base=renderKnowledge(options),enabled=renderKnowledge({...options,includeActivityFacts:true});assert.equal(JSON.parse(base.modelAllocation.scene).lanes.SELF.selfFacts.length,0);assert.equal(JSON.parse(enabled.modelAllocation.scene).lanes.SELF.selfFacts.length,4);assert.equal(enabled.activityReferences.length,4);assert.ok(!JSON.stringify(enabled.modelAllocation).includes(activityInputs.binding.characterId));assert.ok(!JSON.stringify(enabled.modelAllocation).includes('PRIVATE_'));
});

test('arrival and step evidence never become overall completion claims',()=>{
 const input=fixture();for(const kind of ['arrived','step_completed']){input.facts=[{...input.facts.at(-1),kind}];const result=projectActivityKnowledge(input);assert.match(result.facts[0].text,/overall activity completion was not established/);}
});

test('optional ACT facts drop whole under shared canon pressure and preserve authored canon and pins',()=>{
 const activityInputs=fixture(),sample=activityInputs.facts;activityInputs.facts=Array.from({length:16},(_,i)=>({...sample[i%4],factId:randomUUID(),atMs:1000+i}));
 const profile={name:'Mira',gender:'female',ageBand:'adult',nicknames:[],personality:{description:'x'.repeat(10000),traits:[]},biography:'x'.repeat(10000),relationship:{state:'friend',description:'x'.repeat(10000)},memories:Array.from({length:16},(_,i)=>({memoryId:String(i),selectedForContext:true,importance:90,category:'event',text:'x'.repeat(2000)}))};
 const options={profile,persistent:true,input:'Hi',source:'player_text',activityInputs},base=JSON.parse(renderKnowledge(options).modelAllocation.scene).lanes;
 const frame=renderKnowledge({...options,includeActivityFacts:true}),lanes=JSON.parse(frame.modelAllocation.scene).lanes;
 assert.ok(frame.diagnostics.droppedActivityFactCount>0);assert.deepEqual(lanes.SELF.canon,base.SELF.canon);assert.deepEqual(lanes.RECALLED,base.RECALLED);assert.ok(Buffer.byteLength(JSON.stringify({SELF:lanes.SELF,RECALLED:lanes.RECALLED}))<=16*1024);assert.equal(lanes.SELF.selfFacts.length,frame.activityReferences.length);assert.match(lanes.SELF.selfFacts[0].text,/completed with physical evidence/);
});

test('ACT pruning removes whole SELF facts and matching refs without replacing frozen canon or conversation',()=>{
 const frame=renderKnowledge({activityInputs:fixture(),includeActivityFacts:true,input:'Hi',source:'player_text'}),ref=frame.activityReferences[0];
 const before=JSON.parse(frame.modelAllocation.scene),pruned=pruneKnowledgeFrame(frame,()=>true,item=>item.factId===ref.factId),after=JSON.parse(pruned.modelAllocation.scene);
 assert.equal(after.lanes.SELF.selfFacts.length,1);assert.equal(pruned.activityReferences.length,1);assert.deepEqual(pruned.activityReferences[0],ref);assert.deepEqual(after.lanes.SELF.canon,before.lanes.SELF.canon);assert.deepEqual(after.lanes.RECALLED,before.lanes.RECALLED);assert.deepEqual(pruned.modelAllocation.messages,frame.modelAllocation.messages);assert.equal(pruned.diagnostics.staleActivityFactDrops,3);assert.equal(before.lanes.SELF.selfFacts.length,4);
});
