import {createHash} from 'node:crypto';
import {validateDecisionShape} from './essentialDecision.mjs';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Per-generation request state only; the existing salience ledger owns consumption.
export function createKnowledgeDelivery({frame,baseFrame=frame,isCurrent,validate=()=>null,prune=frame=>frame,pruneMemory=null,pruneRecall=null,recallCurrent=()=>false,pruneOpinion=null,opinionCurrent=()=>false,memoryCurrent=()=>true,verifyPrepared=null,acknowledge=()=>false,onRequest=()=>{},onOutcome=()=>{}}) {
 let projection=frame,sent=false,terminal=false,requestHash=null,projectionHash=null,unsubscribe=null;
 const dispose=()=>{unsubscribe?.();unsubscribe=null;};
 const hasOptional=()=>projection.delivery.length>0 || (projection.activityReferences?.length??0)>0 ||
 (projection.dialogueReferences?.length??0)>0 || !!projection.memoryStamp || (projection.recallReferences?.length??0)>0 ||
 (projection.opinionReferences?.length??0)>0 || !!projection.recallStamp;
 const recallFresh=()=>{try{return recallCurrent(projection.recallReferences??[],projection.recallStamp)===true;}catch{return false;}};
 const opinionFresh=()=>{try{return opinionCurrent(projection.opinionReferences??[],projection.opinionStamp)===true;}catch{return false;}};
 const currentReason=()=>!isCurrent()?'superseded':(projection.memoryStamp&&!memoryCurrent(projection.memoryStamp))?'memory_stale':(projection.recallStamp&&!recallFresh())?'recall_stale':
 (projection.opinionReferences?.length&&!opinionFresh())?'opinion_stale':hasOptional()?validate(projection):null;
 const fail=reason=>{throw Object.assign(new Error('knowledge_request_stale'),{code:'knowledge_request_stale',reason});};
 const report=outcome=>{
  if(terminal)return null;terminal=true;dispose();
  let acknowledged=0,retired=0;
  for(const item of sent?projection.delivery:[]){let accepted=false;try{accepted=acknowledge(item.decisionKey,'ps4_context',outcome)===true;}catch{}if(accepted)acknowledged++;else retired++;}
  const result=Object.freeze({outcome,selectedObservations:sent?projection.delivery.length:0,acknowledged,retired,requestHash,projectionHash});
  try{onOutcome(result);}catch{}return result;
 };
 return Object.freeze({
  async prepareAsync(){
   if((projection.memoryStamp||projection.opinionStamp)&&typeof verifyPrepared==='function'){
    try{await verifyPrepared();}catch{}
   }
   return this.prepare();
  },
  async verifyBeforeRequest(){
   if((projection.memoryStamp||projection.opinionStamp)&&typeof verifyPrepared==='function'){
    try{await verifyPrepared();}catch{}
   }
   // The request body is already composed. Never silently prune it here.
   const reason=currentReason();if(reason)fail(reason);
  },
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
   // Unsent optional evidence can be wholly removed; a sent source must
   // abort even if the provider is retrying the very same request body.
   for(let n=0;!sent&&n<3;n++){
     if(reason==='memory_stale'){
       // Pre-send: a stale foreground contribution may be stripped while an
       // independently verified opinion remains. Never revise a sent request.
       projection=typeof pruneMemory==='function'?pruneMemory(projection):baseFrame;
       reason=currentReason();continue;
     }
     if(reason==='recall_stale'&&typeof pruneRecall==='function'){
       projection=pruneRecall(projection);reason=currentReason();continue;
     }
     if(reason==='opinion_stale'&&typeof pruneOpinion==='function'){
       projection=pruneOpinion(projection);reason=currentReason();continue;
     }
     break;
   }
   if(reason){if(sent || reason==='superseded'||reason==='memory_stale'||reason==='recall_stale'||reason==='opinion_stale')fail(reason);projection=baseFrame;}
   return projection;
  },
  beforeRequest(body){
   const reason=currentReason();if(reason)fail(reason);
   const nextHash=hash(body),nextProjectionHash=hash(projection.modelAllocation);
   if(sent && (nextHash!==requestHash || nextProjectionHash!==projectionHash))fail('revision_mismatch');
   requestHash=nextHash;projectionHash=nextProjectionHash;sent=true;
   // Only a fully validated, frozen model request may report a contribution.
   try{onRequest(projection);}catch{}
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
