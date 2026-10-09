import {exactObject,isUuid} from '../identity/identityContract.mjs';
import {readHostContext,HOST_FIELDS} from '../context/hostContext.mjs';
import {FRAME_BYTES} from './contracts.mjs';

const safe=(value,min=0)=>Number.isSafeInteger(value) && value>=min;
const text=value=>typeof value==='string' && value.length>0 && value.length<=128;
// Private, read-only C-05 extension. This is not an ACT execution frame.
// Advertisement/transport acceptance remain separate from structural validity.
export function validateDialogueActionAnnotation(value){
 try{
  return exactObject(value,['version','type','sequence','dialogueActionVersion','publicationId','tuple','binding','canonicalAction','publishedAtMs']) &&
   value.version===1 && value.type==='dialogue.action.pending' && value.dialogueActionVersion===1 && safe(value.sequence,1) && value.sequence<=0x7fffffff && isUuid(value.publicationId) &&
   exactObject(value.tuple,['pedId','turnId','generationId','sessionNonce']) && text(value.tuple.pedId) && text(value.tuple.turnId) && safe(value.tuple.generationId) && safe(value.tuple.sessionNonce,1) &&
   exactObject(value.binding,['encounterId','incarnationId','hostContext']) && isUuid(value.binding.encounterId) && isUuid(value.binding.incarnationId) && exactObject(value.binding.hostContext,HOST_FIELDS) && readHostContext(value.binding.hostContext)!==null &&
   typeof value.canonicalAction==='string' && /^[a-z][a-z0-9_]{0,63}$/.test(value.canonicalAction) && safe(value.publishedAtMs) && Buffer.byteLength(JSON.stringify(value))<=FRAME_BYTES;
 }catch{return false;}
}
export function validateDialogueActionReceipt(value){
 try{
  if(!exactObject(value,['version','type','sequence','dialogueActionVersion','publicationId','tuple','binding','canonicalAction','publishedAtMs','succeeded','atGameTick','nativeRun','adapterEpoch']) || value.type!=='dialogue.action.receipt' || typeof value.succeeded!=='boolean' || !safe(value.atGameTick) || value.atGameTick>0xffffffff || !isUuid(value.nativeRun) || !isUuid(value.adapterEpoch))return false;
  const {succeeded,atGameTick,nativeRun,adapterEpoch,...annotation}=value;
  return validateDialogueActionAnnotation({...annotation,type:'dialogue.action.pending'}) && Buffer.byteLength(JSON.stringify(value))<=FRAME_BYTES;
 }catch{return false;}
}
