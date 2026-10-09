import {perceptionContractSupported} from '../perception/nativeSupport.mjs';
export function normalizeDialogueKnowledge(value={}) {
 if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>!['mode','activityFacts','dialogueReceipts'].includes(key)))throw new TypeError('dialogueKnowledge contains an unsupported field.');
 const mode=value.mode??'off';
 if(!['off','shadow','active'].includes(mode))throw new TypeError('dialogueKnowledge.mode must be off, shadow or active.');
 const optional={};for(const key of ['activityFacts','dialogueReceipts'])if(Object.hasOwn(value,key)){if(!['off','shadow','active'].includes(value[key]))throw new TypeError('dialogueKnowledge contributor must be off, shadow or active.');optional[key]=value[key];}
 return Object.freeze({mode,...optional});
}
export function dialogueKnowledgeContractSupported(contract,perceptionContract) {
 const fields=['available','frameVersion','hostContextVersion','observerIndexVersion','observerSituationVersion'];
 return !!contract && typeof contract==='object' && !Array.isArray(contract) && Object.keys(contract).length===fields.length && fields.every(key=>Object.hasOwn(contract,key)) && contract.available===true && fields.slice(1).every(key=>contract[key]===1) && perceptionContractSupported(perceptionContract);
}
