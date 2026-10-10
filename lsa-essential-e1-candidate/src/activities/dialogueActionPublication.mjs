import {immutableSnapshot} from '../context/turnSnapshot.mjs';
import {assertKnowledgeCurrent,assertOwnedKnowledgeCurrent} from '../context/knowledgeInputs.mjs';
import {sameHostContext} from '../context/hostContext.mjs';
import {validateDialogueActionAnnotation} from './dialogueActionContract.mjs';

// Consume original P0 inputs only. Current reads validate them; they never refill
// actor/profile/action data or dispatch the action being passively observed.
export function prepareDialogueActionPublication({turn,validated,publishedAtMs,perception,identityService,activities}){
 const inputs=turn?.knowledgeInputs,identity=turn?.identity,current=activities?.client?.runtime;
 if(!identity || validated?.identityValid!==true || validated.actionCount!==1 || !Array.isArray(validated.actionNames) || validated.actionNames.length!==1 || !['pedId','turnId','generationId','sessionNonce'].every(key=>identity[key]===validated.validatedFor?.[key] && identity[key]===inputs?.turn?.[key]) || inputs.reason || inputs.ownerPendingProof)return null;
 if(assertKnowledgeCurrent(inputs,perception) || assertOwnedKnowledgeCurrent(inputs,{identity,snapshot:turn.characterSnapshot,identityService,perception}))return null;
 const hostContext={hostContextVersion:1,hostRunId:inputs.hostRunId,worldEpoch:inputs.worldEpoch};
 if(current?.ready!==true || current.dialogueActionVersion!==1 || !sameHostContext(current.hostContext,hostContext))return null;
 const association=inputs.association,binding={captureRef:association.captureRef,hostContext,...(association.owned?{encounterId:association.encounterId,incarnationId:association.incarnationId}:{})};
 const canonicalAction=validated.actionNames[0];
 // Temporary id is solely for structural validation, never published or stored.
 if(!validateDialogueActionAnnotation({version:1,type:'dialogue.action.pending',sequence:1,dialogueActionVersion:1,publicationId:association.captureRef,tuple:identity,binding,canonicalAction,publishedAtMs}))return null;
 return immutableSnapshot({tuple:identity,binding,canonicalAction,publishedAtMs,allowedActions:[canonicalAction]});
}
