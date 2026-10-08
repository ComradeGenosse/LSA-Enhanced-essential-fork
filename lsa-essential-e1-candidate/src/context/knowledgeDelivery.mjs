import {createHash} from 'node:crypto';
import {validateDecisionShape} from './essentialDecision.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Per-generation request state only; the existing salience ledger owns consumption.
export function createKnowledgeDelivery({frame,baseFrame=frame,isCurrent,validate=()=>null,prune=frame=>frame,acknowledge=()=>false,onOutcome=()=>{}}) {
 let projection=frame,sent=false,terminal=false,requestHash=null,projectionHash=null;
 const currentReason=()=>!isCurrent()?'superseded':projection.delivery.length?validate(projection):null;
 const fail=reason=>{throw Object.assign(new Error('knowledge_request_stale'),{code:'knowledge_request_stale',reason});};
 const report=outcome=>{
  if(terminal)return null;terminal=true;
  let acknowledged=0,retired=0;
  for(const item of sent?projection.delivery:[]){let accepted=false;try{accepted=acknowledge(item.decisionKey,'ps4_context',outcome)===true;}catch{}if(accepted)acknowledged++;else retired++;}
  const result=Object.freeze({outcome,selectedObservations:sent?projection.delivery.length:0,acknowledged,retired,requestHash,projectionHash});
  try{onOutcome(result);}catch{}return result;
 };
 return Object.freeze({
  prepare(){
   if(!sent && isCurrent())projection=prune(projection);
   const reason=currentReason();
   if(reason){if(sent || reason==='superseded')fail(reason);projection=baseFrame;}
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
