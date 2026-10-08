import {immutableSnapshot} from '../context/turnSnapshot.mjs';
import {readHostContext,sameHostContext} from '../context/hostContext.mjs';
import {isUuid} from '../identity/identityContract.mjs';
const INTENTS=Object.freeze({hold_position:'wait here',accompany:'follow',resume_previous:'resume an ambient activity',sit_here:'sit down'});
const MODES=Object.freeze({hold_position:'Holding position',accompany:'Following',resume_previous:'Ambient activity',sit_here:'Sitting'});
const KINDS=new Set(['instructed','accepted','started','step_completed','arrived','mode_established','paused','resumed','completed','failed','cancelled','abandoned']);
const EVIDENCE=new Set(['none','handler_only','mode_flag','world_strong']);
// Read-only SELF contributor. UI summaries and arbitrary labels never become facts.
export function projectActivityKnowledge(inputs){
 const binding=inputs?.binding;
 if(!isUuid(binding?.characterId) || !isUuid(binding?.encounterId) || !isUuid(binding?.incarnationId) || !readHostContext(binding.hostContext))return immutableSnapshot({facts:[],references:[],omitted:0});
 const facts=[],references=[];let omitted=0;
 for(const fact of (Array.isArray(inputs.facts)?inputs.facts:[]).slice(-16).reverse()){
  if(fact?.factVersion!==1 || !isUuid(fact.factId) || !isUuid(fact.activityId) || !isUuid(fact.goalId) || fact.characterId!==binding.characterId || fact.provenance?.encounterId!==binding.encounterId || fact.provenance?.incarnationId!==binding.incarnationId || !sameHostContext(fact.provenance,binding.hostContext) || !Object.hasOwn(INTENTS,fact.intent) || !KINDS.has(fact.kind) || !EVIDENCE.has(fact.evidence) || !Number.isSafeInteger(fact.atMs) || fact.atMs<0){omitted++;continue;}
  const action=INTENTS[fact.intent],mode=MODES[fact.intent];let text=null;
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
