import {immutableSnapshot} from './turnSnapshot.mjs';
import {KNOWLEDGE_LIMITS,jsonBytes,selectKnowledge} from './knowledgeSelector.mjs';
import {narrativeProfileWithDiagnostics} from '../characters/sessionProfiles.mjs';

const token=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9 _-]{0,63}$/.test(value) && !['unknown','none','unarmed'].includes(value.toLowerCase())?value.toLowerCase():null;
const label=value=>typeof value==='string' && !/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value) && [...value].length<=120 && value.trim()?value:'unknown';
const capabilities=['hasAvailableWeapon','hasActivityPoints','hasHeldItem','inVehicle','isDriver'];
const wellFormedData=value=>typeof value==='string'?value.toWellFormed():Array.isArray(value)?value.map(wellFormedData):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,wellFormedData(item)])):value;
function canonData(value){
 const result=wellFormedData(value);
 result.gender=['male','female','unknown'].includes(result.gender)?result.gender:'unknown';
 result.ageBand=['young','adult','mature','older','senior','unknown'].includes(result.ageBand)?result.ageBand:'unknown';
 if(result.relationship)result.relationship.state=['associate','friend','trusted','strained','neutral'].includes(result.relationship.state)?result.relationship.state:'unknown';
 return result;
}


export function projectCompatibility({actor,listener,referenceMap,presence=[]}) {
 const known=new Set(presence),self={status:actor?'present':'unknown'};
 for(const key of ['isArmed','isIndoors','hasHeldItem']) self[key]=known.has(key)&&typeof actor?.[key]==='boolean'?actor[key]:'unknown';
 self.gender=known.has('gender')&&['male','female','unknown'].includes(actor?.gender)?actor.gender:'unknown';
 self.ageRange=known.has('ageRange')&&['young','middle-aged','old','unknown'].includes(actor?.ageRange)?actor.ageRange:'unknown';
 const held=known.has('heldItemName')?token(actor?.heldItemName):null;if(held)self.heldItem=held;
 self.actionCapabilities=Object.fromEntries(capabilities.filter(key=>typeof actor?.actionCapabilities?.[key]==='boolean').map(key=>[key,actor.actionCapabilities[key]]));
 const structured=Array.isArray(actor?.availableWeapons)&&actor.availableWeapons.length?actor.availableWeapons.map(item=>item?.name||item?.weaponName||item):null;
 const descriptions=[actor?.availableWeaponsContext].filter(value=>typeof value==='string' && !/(?:available weapons:\s*none|no available weapons)/i.test(value));
 const weapons=structured ?? descriptions.flatMap(value=>value.replace(/^available weapons:\s*/i,'').split(/[,;\n]/));
 self.availableWeapons=[...new Set(weapons.map(value=>token(typeof value==='string'?value.trim():value)).filter(Boolean))].sort().slice(0,32);
 const persons=Object.entries(referenceMap?.persons||{}).filter(([key,id])=>/^P\d{3}$/.test(key)&&typeof id==='string'&&/^[0-9a-f]+$/i.test(id)).map(([key])=>key).sort().slice(0,32);
 const vehicles=Object.entries(referenceMap?.vehicles||{}).filter(([key,id])=>/^V\d{3}$/.test(key)&&typeof id==='string'&&/^[0-9a-f]+$/i.test(id)).map(([key])=>key).sort().slice(0,32);
 const target={status:listener===null?'unavailable':listener?'present':'unknown'};
 if(listener?.pedId==='player')target.address='A';
 else {const hit=persons.find(key=>referenceMap.persons[key]===String(listener?.pedId||'').toLowerCase());if(hit)target.address=hit;}
 const result={actor:self,listener:target,persons,vehicles};
 while(self.availableWeapons.length && jsonBytes(result)>KNOWLEDGE_LIMITS.compatBytes)self.availableWeapons.pop();
 while(vehicles.length && jsonBytes(result)>KNOWLEDGE_LIMITS.compatBytes)vehicles.pop();
 while(persons.length && jsonBytes(result)>KNOWLEDGE_LIMITS.compatBytes)persons.pop();
 if(target.address!=='A' && !persons.includes(target.address))delete target.address;return result;
}
export function projectSituation(world) {
 const result={};for(const key of ['gameTime','weather','streetName','crossingStreetName'])result[key]=label(world?.[key]);
 result.zoneCode=typeof world?.zoneCode==='string'&&/^[A-Z0-9_]{1,16}$/.test(world.zoneCode)?world.zoneCode:'unknown';
 for(const key of ['crossingStreetName','streetName','weather','gameTime'])if(jsonBytes(result)>KNOWLEDGE_LIMITS.situationBytes)result[key]='unknown';return result;
}
export function projectConversation(history,input,source) {
 const current=['player_text','player_mic'].includes(source)?String(input??'').toWellFormed():'No player utterance was received. Respond only to supported current context.';
 if(current.length>12000)throw new RangeError('knowledge_current_input_units');
 const currentMessage={role:'user',content:current};if(jsonBytes(currentMessage)>KNOWLEDGE_LIMITS.currentBytes)throw new RangeError('knowledge_current_input_bytes');
 const prior=(Array.isArray(history)?history:[]).filter(item=>item&&['user','assistant'].includes(item.role)&&typeof item.content==='string').slice(-12).map(({role,content})=>({role,content:content.toWellFormed()}));
 let droppedHistoryCount=0;while(prior.length&&jsonBytes(prior)>KNOWLEDGE_LIMITS.historyBytes){prior.shift();droppedHistoryCount++;}
 return {messages:[...prior,currentMessage],droppedHistoryCount};
}
// Pure projection only: callers must supply the canon already released by P1/P2.
// Private turn/delivery metadata is never part of modelAllocation.
export function renderKnowledge({turn,frozenAt,profile,persistent=false,knowledgeInputs,actor,listener,world,referenceMap,presence,history,input,source,includePerceived=false}) {
 let canonProjection=narrativeProfileWithDiagnostics(profile,persistent);
 let narrative=canonProjection.narrative;
 // Reserve actual lane-wrapper overhead while reusing P2's established field
 // priorities and Unicode-safe descriptive string bounding.
 const envelopeBytes=value=>{
  const {memories=[],...canon}=value||{};
  return jsonBytes({SELF:{canon:value?canon:null,selfFacts:[]},RECALLED:{memories:memories.map(({category,importance,text})=>({category,importance,text}))}});
 };
 if(narrative && envelopeBytes(narrative)>KNOWLEDGE_LIMITS.canonBytes){
  const excess=envelopeBytes(narrative)-KNOWLEDGE_LIMITS.canonBytes;
  canonProjection=narrativeProfileWithDiagnostics(profile,persistent,KNOWLEDGE_LIMITS.canonBytes-excess);
  narrative=canonProjection.narrative;
 }
 const {memories=[],...canon}=narrative||{};
 const recalled=memories.map(({category,importance,text})=>({category:['note','relationship','promise','event','biography','other'].includes(category)?category:'other',importance:Number.isInteger(importance)&&importance>=0&&importance<=100?importance:0,text}));
 const perceived=selectKnowledge(knowledgeInputs,{includePerceived});
 const conversation=projectConversation(history,input,source);
 const lanes={SELF:{canon:narrative?canonData(canon):null,selfFacts:[]},PERCEIVED:{observations:[...perceived.observations]},RECALLED:{memories:wellFormedData(recalled)},SITUATION:projectSituation(world),COMPAT:projectCompatibility({actor,listener,referenceMap,presence})};
 if(jsonBytes({SELF:lanes.SELF,RECALLED:lanes.RECALLED})>KNOWLEDGE_LIMITS.canonBytes) {
  while(lanes.RECALLED.memories.length&&jsonBytes({SELF:lanes.SELF,RECALLED:lanes.RECALLED})>KNOWLEDGE_LIMITS.canonBytes)lanes.RECALLED.memories.pop();
  if(jsonBytes({SELF:lanes.SELF,RECALLED:lanes.RECALLED})>KNOWLEDGE_LIMITS.canonBytes)throw new RangeError('knowledge_canon_bytes');
 }
 const delivery=[...perceived.selected],omissions={...perceived.omissions};
 let frameBudgetDrops=0;
 const allocation=()=>({scene:JSON.stringify({frameVersion:1,lanes}),messages:conversation.messages});
 const oversized=()=>jsonBytes(allocation())>KNOWLEDGE_LIMITS.frameBytes;
 const dropObservation=index=>{lanes.PERCEIVED.observations.splice(index,1);delivery.splice(index,1);omissions.budget_excluded++;frameBudgetDrops++;};
 // Preserve compact safety evidence before optional history/environment/affordance
 // detail. Every evidence or memory removal is whole and deterministic.
 while(oversized() && conversation.messages.length>1){conversation.messages.shift();conversation.droppedHistoryCount++;frameBudgetDrops++;}
 for(const values of [lanes.COMPAT.actor.availableWeapons,lanes.COMPAT.vehicles,lanes.COMPAT.persons])while(oversized() && values.length){values.pop();frameBudgetDrops++;}
 if(lanes.COMPAT.listener.address!=='A' && !lanes.COMPAT.persons.includes(lanes.COMPAT.listener.address))delete lanes.COMPAT.listener.address;
 for(const key of ['crossingStreetName','streetName','weather','gameTime','zoneCode'])if(oversized() && lanes.SITUATION[key]!=='unknown'){lanes.SITUATION[key]='unknown';frameBudgetDrops++;}
 for(let index=delivery.length-1;index>=0 && oversized();index--){
  const selected=delivery[index],pair=knowledgeInputs?.pairs?.find(pair=>pair.decision.decisionKey===selected.decisionKey);
  if(pair?.decision.context!=='must_include')dropObservation(index);
 }
 while(oversized() && lanes.RECALLED.memories.length){lanes.RECALLED.memories.pop();frameBudgetDrops++;}
 while(oversized() && delivery.length){dropObservation(delivery.length-1);omissions.safety_overflow++;}
 const modelAllocation=allocation(),bytes=jsonBytes(modelAllocation);
 if(bytes>KNOWLEDGE_LIMITS.frameBytes)throw new RangeError('knowledge_frame_bytes');
 const perLane=Object.fromEntries(Object.entries(lanes).map(([name,value])=>[name,jsonBytes(value)]));perLane.CONVERSE=jsonBytes(conversation.messages);
 return immutableSnapshot({frameVersion:1,turn,frozenAt,modelAllocation,delivery,memoryIds:memories.slice(0,lanes.RECALLED.memories.length).map(memory=>memory.memoryId),diagnostics:{bytes,perLane,capture:knowledgeInputs?.captureDiagnostics??null,safetyBudget:perceived.safetyBudget,omissions,frameBudgetDrops,droppedHistoryCount:conversation.droppedHistoryCount,droppedMemoryCount:canonProjection.droppedMemoryCount+memories.length-lanes.RECALLED.memories.length}});

}


// Narrow an already rendered allocation before first send. No new facts, live
// history or replacement candidates are admitted by this operation.
export function pruneKnowledgeFrame(frame,keep) {
 const retained=frame.delivery.map((item,index)=>keep(item)?index:null).filter(index=>index!==null);
 if(retained.length===frame.delivery.length)return frame;
 const scene=JSON.parse(frame.modelAllocation.scene);
 scene.lanes.PERCEIVED.observations=retained.map(index=>scene.lanes.PERCEIVED.observations[index]);
 const modelAllocation={...frame.modelAllocation,scene:JSON.stringify(scene)};
 return immutableSnapshot({...frame,modelAllocation,delivery:retained.map(index=>frame.delivery[index]),diagnostics:{...frame.diagnostics,bytes:jsonBytes(modelAllocation),perLane:{...frame.diagnostics.perLane,PERCEIVED:jsonBytes(scene.lanes.PERCEIVED)},staleObservationDrops:(frame.diagnostics.staleObservationDrops??0)+frame.delivery.length-retained.length}});
}
