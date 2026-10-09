import {immutableSnapshot} from '../context/turnSnapshot.mjs';
import {sameHostContext} from '../context/hostContext.mjs';
import {isUuid} from '../identity/identityContract.mjs';
// C05 inputs share the original P0 actor scope. Never refill after owner release.
export function captureDialogueActionKnowledge({knowledgeInputs,activities}) {
 const parent=knowledgeInputs,association=parent?.association,client=activities?.client?.runtime;
 if(!parent || parent.reason || !isUuid(association?.captureRef) || !activities?.readDialogueActionReceipts || client?.ready!==true || client.dialogueActionVersion!==1 || !isUuid(client.nativeRun) || !isUuid(client.adapterEpoch))return null;
 const hostContext={hostContextVersion:1,hostRunId:parent.hostRunId,worldEpoch:parent.worldEpoch};
 if(!sameHostContext(client.hostContext,hostContext))return null;
 if(association.owned && (!isUuid(association.encounterId) || !isUuid(association.incarnationId)))return null;
 const binding={captureRef:association.captureRef,hostContext,...(association.owned?{encounterId:association.encounterId,incarnationId:association.incarnationId}:{})};
 let receipts;try{receipts=activities.readDialogueActionReceipts(binding);}catch{return null;}
 if(!Array.isArray(receipts))return null;
 return immutableSnapshot({version:1,binding,turn:parent.turn,receipts:receipts.slice(-16),nativeRun:client.nativeRun,adapterEpoch:client.adapterEpoch,ownerPendingProof:!!parent.ownerPendingProof,reason:null});
}
export function releaseDialogueActionKnowledge(inputs) {
 return inputs?immutableSnapshot({...inputs,ownerPendingProof:false}):null;
}
export function assertDialogueActionKnowledgeCurrent(inputs,activities,references=null) {
 if(!inputs || inputs.reason || inputs.ownerPendingProof)return 'owner_unverified';
 const client=activities?.client?.runtime;
 if(client?.ready!==true || client.dialogueActionVersion!==1 || client.nativeRun!==inputs.nativeRun || client.adapterEpoch!==inputs.adapterEpoch)return 'channel_unhealthy';
 if(!sameHostContext(client.hostContext,inputs.binding?.hostContext))return 'host_mismatch';
 let current;try{current=activities.readDialogueActionReceipts(inputs.binding);}catch{return 'channel_unhealthy';}
 const selected=references===null?inputs.receipts:references.map(ref=>inputs.receipts.find(row=>row.publicationId===ref.publicationId));
 if(selected.some(row=>!row))return 'revision_mismatch';
 if(!Array.isArray(current) || selected.some(row=>!current.some(live=>JSON.stringify(live)===JSON.stringify(row))))return 'participant_retired';
 return null;
}

const ACTIONS=Object.freeze({waithere:'wait here',followtarget:'follow the target',resumeactivity:'resume an ambient activity',sitonground:'sit on the ground'});
// Closed templates carry callback strength, never native IDs or physical claims.
export function projectDialogueActionKnowledge(inputs) {
 const binding=inputs?.binding;
 const empty=()=>immutableSnapshot({facts:[],references:[],omitted:0});
 if(inputs?.reason || inputs?.ownerPendingProof || !isUuid(binding?.captureRef) || !sameHostContext(binding.hostContext,binding.hostContext) || !(binding.encounterId===undefined && binding.incarnationId===undefined || isUuid(binding.encounterId) && isUuid(binding.incarnationId)))return empty();
 const facts=[],references=[],seen=new Set();let omitted=0;
 for(const row of (Array.isArray(inputs.receipts)?inputs.receipts:[]).slice(-16).reverse()){
  const scope=row?.binding,tuple=row?.tuple;
  if(!isUuid(row?.publicationId) || seen.has(row.publicationId) || scope?.captureRef!==binding.captureRef || scope?.encounterId!==binding.encounterId || scope?.incarnationId!==binding.incarnationId || !sameHostContext(scope?.hostContext,binding.hostContext) || typeof tuple?.pedId!=='string' || !tuple.pedId || typeof tuple.turnId!=='string' || !tuple.turnId || !Number.isSafeInteger(tuple.generationId) || tuple.generationId<0 || !Number.isSafeInteger(tuple.sessionNonce) || tuple.sessionNonce<=0 || !Number.isSafeInteger(row.publishedAtMs) || row.publishedAtMs<0 || !Number.isSafeInteger(row.atGameTick) || row.atGameTick<0 || row.atGameTick>0xffffffff || !Object.hasOwn(ACTIONS,row.canonicalAction)){omitted++;continue;}
  const accepted=row.state==='HANDLER_ACCEPTED' && row.evidence==='handler_only' && row.reason==='handler_accepted';
  const failed=row.state==='FAILED' && row.evidence==='none' && row.reason==='handler_failed';
  if(!accepted && !failed){omitted++;continue;}
  seen.add(row.publicationId);
  const action=ACTIONS[row.canonicalAction];
  facts.push({kind:'dialogue_action_evidence',evidence:accepted?'handler_only':'none',text:accepted?`The handler accepted my attempt to ${action}; physical execution or completion was not established by this receipt.`:`The handler reported that my attempt to ${action} failed; this receipt does not establish the resulting physical state.`});
  references.push({publicationId:row.publicationId});
 }
 return immutableSnapshot({facts,references,omitted});
}
