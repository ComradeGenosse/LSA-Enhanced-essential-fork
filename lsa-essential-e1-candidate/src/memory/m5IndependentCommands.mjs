// I1: independently activatable M5 explicit memory commands for the real
// foreground turn. This module composes EXISTING pieces only:
//   - openH1ConversationSource: the authenticated D01/D02/D03 accepted-line
//     source opener (durable P2 readback, current promoted owner, host stamp);
//   - createM5SqliteServices / createM5RuntimeCoordinator: the established
//     serialized SQLite command ports, parser, clarification and atomic batch.
// It adds no parser, scheduler, database, prompt writer or Luna call. It does
// not require H1, H2, M4 recall, M8, M6/M7 workers or M3 events.
import {createM5SqliteServices} from '../../../lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs';
import {createM5RuntimeCoordinator,mayBeM5PlayerInput} from '../../../lsa-shared-brain/src/memory/m5RuntimeCoordinator.mjs';
import {openH1ConversationSource} from './h1ConversationHistory.mjs';

const SUCCESS=new Set(['saved','forgotten','corrected']);
const freeze=Object.freeze;

// Closed, privacy-safe diagnostic vocabulary. Never text, ids, counts or errors.
export const M5_COMMAND_OUTCOMES=freeze([
  'durable_command_success','clarification_required','command_failure',
  'command_not_recognized','source_unavailable','missing_dependency',
  'private_editor_required'
]);

const notCommand=freeze({status:'not_command',reason:'command_not_recognized',
  memoryAction:null,outcome:'command_not_recognized'});
const unavailable=(reason,outcome)=>freeze({status:'unavailable',reason,
  memoryAction:null,outcome});

/**
 * Prepare M5 for one accepted player turn. Writes happen ONLY when the exact
 * accepted player bytes parse as an explicit command (or a possible reply to a
 * durable clarification) AND the authenticated source opens. A model-visible
 * success is produced only from the coordinator's verified SQLite readback, and
 * is re-verified on every model attempt via verifyPrepared().
 */
export async function prepareM5Commands({store,turn,acceptedReceipt,input,source,isCurrent,
  nowUtc=new Date().toISOString(),onTelemetry=()=>{}}={}){
  // Ordinary conversation and casual "remember when..." never touch the store.
  if(!mayBeM5PlayerInput(input))return notCommand;
  if(typeof store?.withTimelineSqliteWrite!=='function'||
     typeof store?.withP2SqliteRead!=='function'||!store?.filePath||
     typeof store?.readDialogueLines!=='function')
    return unavailable('p2_sqlite_unavailable','missing_dependency');
  let opened;
  try{
    opened=await openH1ConversationSource({store,turn,acceptedReceipt,input,source,isCurrent,nowUtc});
  }catch{opened=null;}
  if(opened?.status!=='ready')return unavailable('source_authority_missing','source_unavailable');
  const {scope,line,current,stamp}=opened;
  let commandStore,coordinator;
  try{
    const m5=createM5SqliteServices({store,filePath:store.filePath,authorize:()=>current()});
    commandStore=m5.bindCommands();
    coordinator=createM5RuntimeCoordinator({commandStore,
      authority:{assertCurrent:()=>current()},onTelemetry});
  }catch{return unavailable('m5_ports_unavailable','missing_dependency');}
  let result;
  try{
    result=await coordinator.acceptAcceptedPlayerLine({line,scope,sourceProof:acceptedReceipt});
  }catch{
    // The coordinator already fails closed internally; a throw here means we
    // cannot claim anything durable. The model is told the change failed.
    result={handled:true,route:'command',status:'failed',
      actions:[],acknowledgements:[{outcome:'failed',durableCommit:false}]};
  }
  // The source may have been revoked while the command ran: claim nothing.
  if(!current())return unavailable('source_authority_missing','source_unavailable');
  if(result.handled!==true)return notCommand;
  if(result.route==='private_editor')
    // Inspector-only requests: archive contents never enter NPC speech or PS4.
    return freeze({status:'not_command',reason:'private_editor_required',
      memoryAction:null,outcome:'private_editor_required'});
  const acks=result.acknowledgements??[];
  if(!acks.length){
    const sourceBlocked=['source_unavailable','invalid_source','unverified_accepted_line',
      'unverified_clarification','expired_or_revoked'].includes(result.status);
    return unavailable(String(result.status??'command_unprocessed'),
      sourceBlocked?'source_unavailable':'command_failure');
  }
  // Only typed statuses cross into PS4; the renderer also re-validates them.
  const memoryAction=freeze(acks.map(a=>freeze({
    outcome:a.outcome,durableCommit:a.durableCommit===true&&SUCCESS.has(a.outcome)})));
  const successes=(result.actions??[]).filter(a=>a?.durableCommit===true&&SUCCESS.has(a.outcome));
  const outcome=memoryAction.every(a=>a.durableCommit)?'durable_command_success':
    memoryAction.some(a=>a.outcome==='clarify')?'clarification_required':'command_failure';
  let verified=false,verifiedFence=null;
  // Awaited on EVERY model attempt and again at the request boundary.
  async function verifyPrepared(){
    verified=false;verifiedFence=null;
    const fence=store.memoryReadFence;
    if(!current()||fence===null||fence===undefined)return false;
    try{
      // Re-read each claimed success from durable SQLite. A command that was
      // since restored, corrected away or revoked can no longer be acknowledged.
      for(const action of successes){
        const receipt=await commandStore.verifyCommand({scope,commandId:action.commandId});
        if(!receipt||receipt.commandId!==action.commandId||receipt.operation!==action.operation||
           receipt.status!=='committed'||receipt.durableCommit!==true||
           !receipt.evidenceRecordIds?.includes(line.recordId))return false;
      }
      if(!current()||store.memoryReadFence!==fence)return false;
      verified=true;verifiedFence=fence;
      return true;
    }catch{return false;}
  }
  const sendCurrent=()=>verified&&current()&&store.memoryReadFence===verifiedFence;
  return freeze({status:'ready',reason:null,outcome,stamp,memoryAction,
    verifyPrepared,sendCurrent});
}
