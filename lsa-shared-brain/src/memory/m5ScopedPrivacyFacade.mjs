// M5 privileged editor/inspection boundary. This is NOT a model tool and must
// never be mounted in the Luna prompt or published via a conversational reply.
// All durable mutations delegate to B's P2 serialized SQLite privacy ports.
import {isUuid} from '../util/identity.mjs';

const allowed=new Set(['inspect','export','trash','trash_scope','restore','purge']);
const protagonists=new Set(['franklin','michael','trevor','unknown']);
const scopeValid=s=>!!s && [s.characterId,s.worldProfileId,s.timelineId].every(isUuid) &&
  protagonists.has(s.protagonistKey);
const rejected=code=>Object.freeze({status:'denied',code});
const error=()=>Object.freeze({status:'unavailable',code:'privacy_unavailable'});
const safe=(fn,event,operation)=>{
  try{fn(Object.freeze({component:'m5-editor',event,operation}));}catch{}
};
const readonly=(object)=>Object.freeze(object);

/**
 * `authorize` proves the authenticated PLAYER is permitted to access this
 * EXACT NPC/world/timeline and CURRENT native source, not merely that UI is open.
 * The avatar is authentication metadata, not a permanent-memory ownership key.
 * `assertScopeCurrent` checks the P2 timeline/writer/owner and active principal.
 * B must *also* enforce authorization inside its SQL port transaction.
 */
export function createM5ScopedPrivacyFacade({
  privacyPort,authorize,assertScopeCurrent,onTelemetry=()=>{}
}={}){
  if(!privacyPort || ['inspect','exportArchive','trash','trashScope',
      'restore','purgeExpired','verifyPrivacy'].some(k=>typeof privacyPort[k]!=='function') ||
      typeof authorize!=='function'||typeof assertScopeCurrent!=='function'||
      typeof onTelemetry!=='function')
    throw new TypeError('m5_privileged_ports_required');

  const check=async({operation,scope,access})=>{
    if(!allowed.has(operation)||!scopeValid(scope))return false;
    try{
      return await authorize({operation,scope,access})===true &&
        await assertScopeCurrent({operation,scope,access})===true;
    }catch{return false;}
  };
  const recheck=async(args)=>{
    try{return await assertScopeCurrent(args)===true &&
      await authorize(args)===true;}catch{return false;}
  };
  async function execute({operation,scope,access,recordId=null,trashId=null,
    operationId=null,limit=200}={}){
    const args={operation,scope,access};
    if(!await check(args)){
      safe(onTelemetry,'denied',allowed.has(operation)?operation:'invalid');
      return rejected('not_authorized');
    }
    if(['trash','trash_scope','restore'].includes(operation)&&!isUuid(operationId))
      return rejected('stable_operation_id_required');
    if(operation==='trash'&&!isUuid(recordId))
      return rejected('record_id_required');
    if(operation==='restore'&&!isUuid(trashId))
      return rejected('trash_id_required');
    if(['inspect','purge'].includes(operation)&&(!Number.isSafeInteger(limit)||limit<1||limit>1000))
      return rejected('invalid_limit');

    try{
      if(operation==='inspect'||operation==='export'){
        // Return confidential rows to the authenticated editor only. The caller
        // must not serialize this response into a Luna request or voice prompt.
        const data=operation==='inspect'
          ?await privacyPort.inspect({scope,limit})
          :await privacyPort.exportArchive({scope});
        if(!await recheck(args))return rejected('scope_changed');
        safe(onTelemetry,'read',operation);
        return readonly({status:'ok',operation,confidential:true,data});
      }
      const result=operation==='trash'
        ?await privacyPort.trash({scope,targetId:recordId,operationId})
        :operation==='trash_scope'
          ?await privacyPort.trashScope({scope,operationId})
          :operation==='restore'
            ?await privacyPort.restore({scope,trashId,operationId})
            :await privacyPort.purgeExpired({scope,limit});
      if(!await recheck(args))return rejected('scope_changed');
      if(operation==='purge'){
        // The current P2 port returns its transaction result without a
        // separate verification read. Never claim verified purge from that
        // receipt alone. B should implement verifyPurge for production.
        if(typeof privacyPort.verifyPurge!=='function'){
          safe(onTelemetry,'unverified','purge');
          return readonly({status:'verification_required',operation:'purge'});
        }
        const verified=await privacyPort.verifyPurge({scope,result});
        if(!verified || verified.confirmed!==true) return error();
        if(!await recheck(args))return rejected('scope_changed');
        safe(onTelemetry,'write','purge');
        return readonly({status:'ok',operation:'purge',
          purgedCount:Array.isArray(result?.purgedIds)?result.purgedIds.length:0});
      }
      // B's verifyPrivacy is scoped and reads its P2 durable receipt back.
      const actual=await privacyPort.verifyPrivacy({scope,operationId});
      if(!actual||actual.operationId!==operationId||actual.operation!==
        operation||actual.durableCommit!==true||
        !Array.isArray(actual.targetIds) || !actual.targetIds.every(isUuid) ||
        result?.operationId!==operationId ||
        JSON.stringify(actual.targetIds)!==JSON.stringify(result.targetIds))
        return error();
      if(!await recheck(args))return rejected('scope_changed');
      safe(onTelemetry,'write',operation);
      return readonly({status:'ok',operation,receipt:actual});
    }catch{
      safe(onTelemetry,'failed',operation);
      return error();
    }
  }
  return readonly({execute});
}
