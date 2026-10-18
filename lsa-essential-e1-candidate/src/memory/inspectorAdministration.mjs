import {createHash} from 'node:crypto';
import {isUuid} from '../identity/identityContract.mjs';
import {createM5SqliteServices} from '../../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';

// Called only after editorServer's token/Origin/Host checks. Scope fields are
// never inferred from a conversation, model response, ped handle or avatar.
export function createInspectorAdministration(service,{accessCurrent=()=>false}={}) {
  return Object.freeze({async execute(body) {
    const store=service.store,scope=body.scope;
    if(service.config.memoryK?.capabilities['memory.inspector']!=='on')throw Error('inspector_disabled');
    if(typeof store?.withP2SqliteRead!=='function')throw Error('inspector_sqlite_required');
    if(!scope||!['characterId','worldProfileId','timelineId'].every(k=>isUuid(scope[k]))||
      scope.protagonistKey!=='unknown')throw Error('inspector_invalid_scope');
    const fence=store.memoryAuthorityFence;
    const authorized=()=>accessCurrent()===true&&service.ready===true&&store.available===true&&
      fence!==null&&store.memoryAuthorityFence===fence&&store.timelineWritable===true&&
      !!store.verifiedHostContext&&scope.worldProfileId===store.worldProfileId&&
      scope.timelineId===store.activeTimelineId&&store.get(scope.characterId)?.characterId===scope.characterId;
    if(!authorized())throw Error('inspector_scope_unavailable');
    const port=createM5SqliteServices({store,filePath:store.filePath,authorize:({scope:s})=>
      authorized()&&['characterId','worldProfileId','timelineId','protagonistKey'].every(k=>s[k]===scope[k])});
    let result;
    if(body.operation==='inspect')result=await port.inspectPage({scope,kind:body.kind,offset:body.offset,limit:50});
    else if(body.operation==='export'){
      if(!Array.isArray(body.recordIds)||body.recordIds.length<1||body.recordIds.length>50||
        !body.recordIds.every(isUuid)||new Set(body.recordIds).size!==body.recordIds.length)
        throw Error('inspector_invalid_selection');
      const page=await port.inspectPage({scope,kind:body.kind,offset:body.offset,limit:50});
      const items=page.items.filter(r=>body.recordIds.includes(r.recordId));
      if(items.length!==body.recordIds.length)throw Error('inspector_selection_changed');
      const json=JSON.stringify({format:'p2-private-selected-memory-v1',scope,kind:body.kind,items},null,2)+'\n';
      result={confidential:true,json,sha256:createHash('sha256').update(json).digest('hex')};
    }else {
      const target=body.operation==='restore'?body.trashId:body.recordId;
      if(!isUuid(target)||body.confirmation!==target||!isUuid(body.operationId))
        throw Error('explicit_confirmation_required');
      if(body.operation==='forget'){
        result=await port.trash({scope,targetId:target,operationId:body.operationId});
        const actual=await port.verifyPrivacy({scope,operationId:body.operationId});
        if(!actual?.durableCommit||JSON.stringify(actual)!==JSON.stringify(result))throw Error('inspector_readback_failed');
      }else if(body.operation==='restore'){
        result=await port.restore({scope,trashId:target,operationId:body.operationId});
        const actual=await port.verifyPrivacy({scope,operationId:body.operationId});
        if(!actual?.durableCommit||JSON.stringify(actual)!==JSON.stringify(result))throw Error('inspector_readback_failed');
      }else if(body.operation==='correct')result=await port.correctFact({scope,targetId:target,
        operationId:body.operationId,content:body.content,expectedHash:body.expectedHash});
      else throw Error('inspector_invalid_operation');
    }
    if(!authorized())throw Error('inspector_scope_changed');
    return result;
  }});
}
