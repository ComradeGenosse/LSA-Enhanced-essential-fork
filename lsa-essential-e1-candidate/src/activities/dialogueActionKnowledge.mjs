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
