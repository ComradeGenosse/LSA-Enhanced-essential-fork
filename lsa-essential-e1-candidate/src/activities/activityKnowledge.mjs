import {immutableSnapshot} from '../context/turnSnapshot.mjs';
import {phrase} from './activityFacts.mjs';
import {readHostContext,sameHostContext} from '../context/hostContext.mjs';
import {isUuid,sameAssociation} from '../identity/identityContract.mjs';
const INTENTS=Object.freeze({hold_position:'wait here',accompany:'follow',resume_previous:'resume an ambient activity',sit_here:'sit down',scenario_here:'do an activity here',approach_and_face:'come over and face the player',board_vehicle:'get into a vehicle',ride_along:'ride along in a vehicle',exit_vehicle_and_hold:'get out of a vehicle and wait',leave_scene:'walk away',take_cover_and_hold:'take cover',go_to_place:'walk to the selected destination',vehicle_trip:'drive to the selected destination',move_to_and_hold:'walk to the selected destination and wait'});
const MODES=Object.freeze({hold_position:'Holding position',accompany:'Following',resume_previous:'Ambient activity',sit_here:'Sitting',scenario_here:'Scenario',approach_and_face:'Facing',board_vehicle:'Vehicle seat',ride_along:'Vehicle seat',exit_vehicle_and_hold:'Holding position',leave_scene:'Ambient activity',take_cover_and_hold:'Taking cover',go_to_place:'Walking toward the destination',vehicle_trip:'Driving toward the destination',move_to_and_hold:'Walking and waiting at the destination'});
const KINDS=new Set(['instructed','accepted','started','step_completed','arrived','mode_established','paused','resumed','completed','failed','cancelled','abandoned']);
const EVIDENCE=new Set(['none','handler_only','mode_flag','world_strong']);
// Read-only SELF contributor. UI summaries and arbitrary labels never become facts.
export function projectActivityKnowledge(inputs){
 const binding=inputs?.binding;
 if(inputs?.ownerPendingProof || inputs?.reason || !isUuid(binding?.characterId) || !isUuid(binding?.encounterId) || !isUuid(binding?.incarnationId) || !readHostContext(binding.hostContext))return immutableSnapshot({facts:[],references:[],omitted:0});
 const facts=[],references=[];let omitted=0;
 // ACT4 adds one latest source-qualified state, not an inferred action or a
 // second prompt writer. Identifiers and lease tokens stay in private refs.
 const state=inputs.state;
 if(state){
  const allowed=['admitting','resolving','preflighting','running','holding','paused','resuming','completed','failed','cancelled','abandoned','expired','superseded'];
  if(state.stateVersion!==1 || state.characterId!==binding.characterId ||
    state.encounterId!==binding.encounterId || state.incarnationId!==binding.incarnationId ||
    !sameHostContext(state.hostContext,binding.hostContext) || !Object.hasOwn(INTENTS,state.intent) ||
    !allowed.includes(state.status) || typeof state.modeObserved!=='boolean' ||
    typeof state.physicallyCompleted!=='boolean' || typeof state.resumeEligible!=='boolean'){omitted++;}
  else {
   const verb=INTENTS[state.intent], mode=MODES[state.intent];let text;
   if(['admitting','resolving','preflighting'].includes(state.status))
    text='My current request to '+verb+' is being prepared. Physical execution has not been verified.';
   else if(['running','holding'].includes(state.status))
    text=state.modeObserved
     ?(['go_to_place','vehicle_trip','move_to_and_hold'].includes(state.intent)
        ?mode+' is active with native mode evidence. Arrival has not been verified.'
        :mode+' mode has native mode evidence and is currently active; this does not establish arrival or overall completion.')
     :'My request to '+verb+' is underway, but physical mode establishment is not verified.';
   else if(state.status==='paused')
    text='My request to '+verb+' is paused, not completed. '+(state.resumeEligible
      ?'A guarded resume may be attempted only by the existing activity engine with current authority.'
      :'A valid resume is not currently established.')+' Conversation alone does not resume the task.';
   else if(state.status==='resuming')
    text='My request to '+verb+' is resuming under the activity engine; physical re-establishment is not yet verified.';
   else if(state.status==='completed')
    text=state.physicallyCompleted
      ?(['go_to_place','vehicle_trip'].includes(state.intent)
          ?'I reached the selected destination with verified native physical arrival evidence.'
          :'My request to '+verb+' was physically completed with supporting native evidence.')
      :'My request to '+verb+' was marked complete, but physical completion was not verified.';
   else text='My request to '+verb+' ended as '+state.status+
     (phrase(state.reason)?' ('+phrase(state.reason)+')':'')+'. It is not currently running.';
   facts.push({kind:'activity_state',evidence:state.modeObserved?'mode_flag':state.physicallyCompleted?'world_strong':'none',text});
   references.push({kind:'activity_state',snapshot:state});
  }
 }
 for(const fact of (Array.isArray(inputs.facts)?inputs.facts:[]).slice(-16).reverse()){
  if(fact?.factVersion!==1 || !isUuid(fact.factId) || !isUuid(fact.activityId) || !isUuid(fact.goalId) || fact.characterId!==binding.characterId || fact.provenance?.encounterId!==binding.encounterId || fact.provenance?.incarnationId!==binding.incarnationId || !sameHostContext(fact.provenance,binding.hostContext) || !Object.hasOwn(INTENTS,fact.intent) || !KINDS.has(fact.kind) || !EVIDENCE.has(fact.evidence) || !Number.isSafeInteger(fact.atMs) || fact.atMs<0){omitted++;continue;}
  const action=INTENTS[fact.intent],mode=MODES[fact.intent];let text=null;
  if(!action || !mode){omitted++;continue;}
  if(fact.kind==='instructed')text=`I was asked to ${action}.`;
  else if(fact.kind==='accepted')text=`The request to ${action} was admitted.`;
  else if(fact.kind==='started')text=fact.evidence==='handler_only'?`The handler accepted the attempt to ${action}.`:`An attempt to ${action} was started; physical execution was not established by this fact.`;
  else if(['mode_established','arrived','completed','step_completed'].includes(fact.kind)){
   if(fact.kind==='completed' && fact.evidence==='world_strong')text=`The request to ${action} was completed with physical evidence.`;
   else if(fact.kind==='arrived' && fact.evidence==='world_strong')text=`Arrival was observed with physical evidence during the request to ${action}; overall activity completion was not established by this fact.`;
   else if(fact.kind==='step_completed' && fact.evidence==='world_strong')text=`An activity step for the request to ${action} was completed with physical evidence; overall activity completion was not established by this fact.`;
   else if(['mode_flag','world_strong'].includes(fact.evidence))text=`${mode} mode was observed; this fact does not establish arrival or completion.`;
   else if(fact.evidence==='handler_only')text=`The handler accepted the attempt to ${action}; physical execution was not established by this fact.`;
  }else if(['paused','resumed'].includes(fact.kind))text=`The activity requested to ${action} was ${fact.kind}; this is activity state, not physical completion.`;
  else if(['failed','cancelled','abandoned'].includes(fact.kind))text=`The activity requested to ${action} was ${fact.kind==='abandoned'?'stopped':fact.kind}.`;
  if(!text){omitted++;continue;}
  facts.push({kind:'activity_evidence',evidence:fact.evidence,text});references.push({factId:fact.factId,activityId:fact.activityId,encounterId:fact.provenance.encounterId,incarnationId:fact.provenance.incarnationId});
 }
 return immutableSnapshot({facts,references,omitted});
}


// Synchronous P0 capture; no profile read, provider call or late fact refill.
export function captureActivityKnowledge({knowledgeInputs,characterInputs,activities}){
 if(!activities?.factsForCharacter || !knowledgeInputs?.association?.owned || knowledgeInputs.reason)return null;
 const turn=knowledgeInputs.turn,association=knowledgeInputs.association,profile=characterInputs?.profile;
 if(!['pedId','turnId','generationId','sessionNonce'].every(key=>characterInputs?.identity?.[key]===turn?.[key]) || !isUuid(profile?.characterId) || characterInputs?.claim?.incarnationId!==association.incarnationId || !sameAssociation(characterInputs.claim,knowledgeInputs.ownerClaim))return null;
 const client=activities.client?.runtime,hostContext={hostContextVersion:1,hostRunId:knowledgeInputs.hostRunId,worldEpoch:knowledgeInputs.worldEpoch};
 if(client?.ready!==true || !isUuid(client.nativeRun) || !isUuid(client.adapterEpoch) || !sameHostContext(client.hostContext,hostContext))return null;
 const binding={characterId:profile.characterId,encounterId:association.encounterId,incarnationId:association.incarnationId,hostContext};
 let facts;try{facts=activities.factsForCharacter(binding);}catch{return null;}
 if(!Array.isArray(facts))return null;
 let state=null;try{state=activities.stateForCharacter?.(binding)||null;}catch{}
 return immutableSnapshot({version:1,binding,facts:facts.slice(-16),state,nativeRun:client.nativeRun,adapterEpoch:client.adapterEpoch,ownerPendingProof:true,reason:null});
}
export function releaseActivityKnowledge(inputs,characterId){
 if(!inputs)return null;
 return immutableSnapshot({...inputs,ownerPendingProof:inputs.binding?.characterId!==characterId,reason:inputs.binding?.characterId===characterId?null:'owner_unverified'});
}
export function assertActivityKnowledgeCurrent(inputs,activities,references=null){
 if(!inputs || inputs.ownerPendingProof || inputs.reason)return 'owner_unverified';
 const client=activities?.client?.runtime;
 if(client?.ready!==true || client.nativeRun!==inputs.nativeRun || client.adapterEpoch!==inputs.adapterEpoch)return 'channel_unhealthy';
 if(!sameHostContext(client.hostContext,inputs.binding?.hostContext))return 'host_mismatch';
 if(references!==null && !Array.isArray(references))return 'revision_mismatch';
 let current;try{current=activities.factsForCharacter?.(inputs.binding);}catch{return 'channel_unhealthy';}
 const refs=references===null?[]:references;
 const stateRefs=references===null?(inputs.state?[{kind:'activity_state',snapshot:inputs.state}]:[]):refs.filter(ref=>ref?.kind==='activity_state');
 if(stateRefs.length){
  if(stateRefs.length!==1 || !inputs.state || JSON.stringify(stateRefs[0].snapshot)!==JSON.stringify(inputs.state))return 'revision_mismatch';
  let live;try{live=activities.stateForCharacter?.(inputs.binding);}catch{return 'channel_unhealthy';}
  if(!live || JSON.stringify(live)!==JSON.stringify(inputs.state))return 'participant_retired';
 }
 const factRefs=references===null?null:refs.filter(ref=>ref?.kind!=='activity_state');
 const selected=factRefs===null?inputs.facts:factRefs.map(ref=>inputs.facts.find(fact=>fact.factId===ref.factId && fact.activityId===ref.activityId && ref.encounterId===inputs.binding.encounterId && ref.incarnationId===inputs.binding.incarnationId));
 if(selected.some(fact=>!fact))return 'revision_mismatch';
 if(!Array.isArray(current) || selected.some(captured=>!current.some(fact=>fact.factId===captured.factId && JSON.stringify(fact)===JSON.stringify(captured))))return 'participant_retired';
 return null;
}
