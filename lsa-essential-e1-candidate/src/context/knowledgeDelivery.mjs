import {createHash} from 'node:crypto';
import {validateDecisionShape} from './essentialDecision.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Per-generation request state only; the existing salience ledger owns consumption.
export function createKnowledgeDelivery({frame,baseFrame=frame,isCurrent,validate=()=>null,prune=frame=>frame,pruneRecall=null,recallCurrent=()=>false,acknowledge=()=>false,onOutcome=()=>{}}) {
 let projection=frame,sent=false,terminal=false,requestHash=null,projectionHash=null,unsubscribe=null;
 const dispose=()=>{unsubscribe?.();unsubscribe=null;};
 const hasOptional=()=>projection.delivery.length>0 || (projection.activityReferences?.length??0)>0 ||
 (projection.dialogueReferences?.length??0)>0 || (projection.recallReferences?.length??0)>0;
 const recallFresh=()=>{try{return recallCurrent(projection.recallReferences??[],projection.recallStamp)===true;}catch{return false;}};
 const currentReason=()=>!isCurrent()?'superseded':(projection.recallReferences?.length&&!recallFresh())?'recall_stale':hasOptional()?validate(projection):null;
 const fail=reason=>{throw Object.assign(new Error('knowledge_request_stale'),{code:'knowledge_request_stale',reason});};
 const report=outcome=>{
  if(terminal)return null;terminal=true;dispose();
  let acknowledged=0,retired=0;
  for(const item of sent?projection.delivery:[]){let accepted=false;try{accepted=acknowledge(item.decisionKey,'ps4_context',outcome)===true;}catch{}if(accepted)acknowledged++;else retired++;}
  const result=Object.freeze({outcome,selectedObservations:sent?projection.delivery.length:0,acknowledged,retired,requestHash,projectionHash});
  try{onOutcome(result);}catch{}return result;
 };
 return Object.freeze({
  watch(subscribe,cancel){
   if(!hasOptional() || unsubscribe || terminal)return;
   try{unsubscribe=subscribe(()=>{
    if(!sent || terminal || !hasOptional())return;
    const reason=currentReason();if(reason){dispose();cancel(Object.assign(new Error('knowledge_request_stale'),{code:'knowledge_request_stale',reason}));}
   });}catch{if(sent)fail('unsupported_contract');projection=baseFrame;}
  },
  dispose,

  prepare(){
   if(!sent && isCurrent())projection=prune(projection);
   let reason=currentReason();
   if(!sent&&reason==='recall_stale'&&typeof pruneRecall==='function'){
     projection=pruneRecall(projection);reason=currentReason();
   }
   if(reason){if(sent || reason==='superseded'||reason==='recall_stale')fail(reason);projection=baseFrame;}
   return projection;
  },
  beforeRequest(body){
   const reason=currentReason();if(reason)fail(reason);
   const nextHash=hash(body),nextProjectionHash=hash(projection.modelAllocation);
   if(sent && (nextHash!==requestHash || nextProjectionHash!==projectionHash))fail('revision_mismatch');
   requestHash=nextHash;projectionHash=nextProjectionHash;sent=true;
  },
  success(decision){
   if(terminal)return null;
   validateDecisionShape(decision);
   const reason=currentReason();if(reason)fail(reason);
   if(!sent)return null;
   return report('delivered');
  },
  finish(){return report(currentReason()?'expired':'rejected');},
 });
}
