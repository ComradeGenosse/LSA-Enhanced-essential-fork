// M5 production entrypoint: only a durably accepted M2 player line may
// authorize commands. Native/source authority and P2 SQLite remain upstream.
// This module does not create a database, call Luna, or write a model frame.
import {createHash} from 'node:crypto';
import {detectExplicitMemoryCommands,handleExplicitMemoryCommands,
  handleMemoryClarificationReply,memoryActionAcknowledgement} from './explicitCommands.mjs';
import {isUuid} from '../util/identity.mjs';

const protagonists=new Set(['franklin','michael','trevor','unknown']);
const choice=/^(?:the\s+)?(?:first|second|one|two|1|2)(?:\s+one)?(?:\s*[:,-]\s*.+)?[.!]?$/i;
const correctionReply=/^(?:no[,]?\s*)?(?:i\s+(?:actually\s+)?(?:said|meant)|it\s+was|the\s+correct(?:ed)?\s+(?:wording|text)\s+is)\s+.+$/i;
// Cheap, store-free gate: only input the M5 coordinator could possibly treat as
// a command or a durable-clarification reply may reach M5. Ordinary dialogue
// and casual "remember when..." text never does. The coordinator re-parses.
export function mayBeM5PlayerInput(text){
  if(typeof text!=='string'||text.length===0||text.length>12000)return false;
  const trimmed=text.trim();
  return detectExplicitMemoryCommands(text)!==null||choice.test(trimmed)||correctionReply.test(trimmed);
}
const safeStatuses=new Set(['saved','forgotten','corrected','clarify','failed']);
const freeze=o=>Object.freeze(o);
const validScope=s=>!!s && [s.characterId,s.worldProfileId,s.timelineId].every(isUuid) &&
  protagonists.has(s.protagonistKey);
const validLine=(line,scope)=>!!line && isUuid(line.recordId) &&
  line.kind==='dialogue_line' && line.speaker==='player' &&
  ['typed','stt'].includes(line.source) && line.delivery==='accepted' &&
  typeof line.content==='string' && line.content.length>0 && line.content.length<=12000 &&
  Number.isFinite(Date.parse(line.committedAtUtc)) &&
  line.characterId===scope.characterId && line.worldProfileId===scope.worldProfileId &&
  line.timelineId===scope.timelineId && line.attribution?.protagonist===scope.protagonistKey;

export function stableM5CommandId({line,scope}={}){
  if(!validScope(scope)||!validLine(line,scope))throw new TypeError('m5_source_scope_required');
  const hex=createHash('sha256').update(JSON.stringify([
    'm5-accepted-line-v1',scope.worldProfileId,scope.timelineId,
    scope.characterId,scope.protagonistKey,line.recordId
  ])).digest('hex');
  return hex.slice(0,8)+'-'+hex.slice(8,12)+'-4'+hex.slice(13,16)+
    '-a'+hex.slice(17,20)+'-'+hex.slice(20,32);
}

function publicActions(actions){
  return actions.map(a=>{
    if(a?.kind!=='memory_action'||!safeStatuses.has(a.outcome))return freeze({
      kind:'m5_ui_ack',outcome:'failed',durableCommit:false,
      text:'I could not confirm the memory change.'
    });
    // A success MUST originate from verified-command readback in explicitCommands.
    const ok=a.durableCommit===true &&
      ['saved','forgotten','corrected'].includes(a.outcome);
    const outcome=ok?a.outcome:a.outcome==='clarify'?'clarify':'failed';
    return freeze({kind:'m5_ui_ack',outcome,durableCommit:ok,
      commandId:a.commandId,requestedByLineId:a.requestedByLineId,
      text:memoryActionAcknowledgement({...a,outcome,durableCommit:ok})});
  });
}
const blocked=status=>freeze({handled:true,route:'command',status,
  actions:freeze([]),acknowledgements:freeze([])});
const noop=()=>{};

/**
 * commandStore is B's serialized P2 bindCommands() port, not an independent DB.
 * authority.assertCurrent MUST be synchronous and return true only for the
 * same native proof, promoted CharacterId, host run/epoch, timeline, and
 * protagonist attached to this accepted turn. Failure fails closed.
 *
 * pendingClarifications.findPendingClarification({scope,atUtc}) is a P2 durable
 * and scope-checked lookup. The optional caller clarificationId is checked by
 * commandStore.getClarification, never allowed to override a different lookup.
 */
export function createM5RuntimeCoordinator({
  commandStore,authority,pendingClarifications=null,onTelemetry=noop
}={}){
  if(!commandStore || ['verifyAcceptedLine','findCandidates','commitCommand','verifyCommand',
      'saveClarification','getClarification','completeClarification']
      .some(k=>typeof commandStore[k]!=='function') ||
      typeof authority?.assertCurrent!=='function' ||
      (pendingClarifications!==null &&
       typeof pendingClarifications.findPendingClarification!=='function') ||
      typeof onTelemetry!=='function')
    throw new TypeError('m5_verified_p2_ports_required');

  const clarifications=pendingClarifications ??
    (typeof commandStore.findPendingClarification==='function'?commandStore:null);
  const current=(args,stage)=>{
    try{return authority.assertCurrent({...args,stage})===true;}catch{return false;}
  };
  function report(status,operation){
    // Deliberately no source text, labels, IDs, counts of content or exception.
    try{onTelemetry(freeze({component:'m5',status,operation}));}catch{}
  }
  async function acceptAcceptedPlayerLine({
    line,scope,sourceProof,clarificationId=null
  }={}){
    if(!validScope(scope)||!validLine(line,scope) ||
       (clarificationId!==null&&!isUuid(clarificationId)))
      return blocked('invalid_source');
    const parts=detectExplicitMemoryCommands(line.content);
    const isChoice=choice.test(line.content.trim());
    const isCorrectionReply=correctionReply.test(line.content.trim());
    // Normal dialogue including casual "remember when" must flow to Luna.
    if(!parts && !isChoice && !isCorrectionReply)return freeze({handled:false});
    const args={line,scope,sourceProof};
    if(!current(args,'before_read'))return blocked('source_unavailable');
    try{
      if(await commandStore.verifyAcceptedLine({scope,line})!==true)
        return blocked('unverified_accepted_line');
      if(!current(args,'after_read'))return blocked('source_unavailable');
      let pending=null;
      if(isChoice || isCorrectionReply){
        if(clarifications){
          const found=await clarifications.findPendingClarification({
            scope,atUtc:line.committedAtUtc,excludeLineId:line.recordId
          });
          if(found!==null && found!==undefined){
            if(!isUuid(found.commandId))return blocked('unverified_clarification');
            pending=found.commandId;
          }
        }
        if(clarificationId!==null){
          if(pending!==null && pending!==clarificationId)
            return blocked('unverified_clarification');
          pending=clarificationId;
        }
      }
      if(!current(args,'before_write'))return blocked('source_unavailable');
      if(pending!==null){
        const frozen=await commandStore.getClarification({
          scope,commandId:pending,atUtc:line.committedAtUtc
        });
        if(!frozen){
          report('expired_or_revoked','clarification');
          return blocked('expired_or_revoked');
        }
        // An open "remember" choice must not hijack conversational corrections.
        if(isCorrectionReply && !isChoice && frozen.parsed?.intent!=='correct')
          return freeze({handled:false});
        const action=await handleMemoryClarificationReply({
          line,scope,store:commandStore,clarificationId:pending
        });
        if(!current(args,'after_write'))return blocked('source_unavailable');
        const acknowledgements=freeze(publicActions(action?[action]:[]));
        report(acknowledgements[0]?.outcome??'failed','clarification');
        return freeze({handled:true,route:'command',status:'processed',
          actions:freeze(action?[action]:[]),acknowledgements});
      }
      if(!parts){
        // No pending durable clarification: "first" is ordinary dialogue.
        return freeze({handled:false});
      }
      // Private archive contents must NEVER enter speech or Luna prompts.
      if(parts.some(p=>['inspect','export'].includes(p.parsed.intent))){
        if(parts.length!==1)return blocked('unsupported_compound_read');
        report('private_editor','read');
        return freeze({handled:true,route:'private_editor',
          status:'authorization_required',operation:parts[0].parsed.intent,
          actions:freeze([]),acknowledgements:freeze([])});
      }
      // The legacy multi-command helper commits sequentially. For two commands,
      // its planning pass MUST NOT write SQLite or emit its optimistic status:
      // stage complete, then commit all members in one P2 transaction.
      if(parts.length===2){
        if(typeof commandStore.commitCommandBatch!=='function')
          return blocked('atomic_writer_unavailable');
        const staged=[],simulated=new Map();
        const planner=Object.freeze({
          verifyAcceptedLine:params=>commandStore.verifyAcceptedLine(params),
          findCandidates:params=>commandStore.findCandidates(params),
          verifyCommand:async params=>simulated.get(params.commandId) ??
            commandStore.verifyCommand(params),
          commitCommand:async op=>{
            const fake={commandId:op.commandId,requestedByLineId:op.requestedByLineId,
              operation:op.operation,status:'committed',durableCommit:true,
              memoryId:op.commandId,evidenceRecordIds:op.evidenceRecordIds};
            // Only internal planning can see these synthetic receipts. They
            // NEVER flow to UI, voice, telemetry or any durable queue.
            staged.push(op);simulated.set(op.commandId,fake);
            return fake;
          },
          saveClarification:async()=>{throw new Error('m5_compound_needs_disambiguation');}
        });
        const proposed=await handleExplicitMemoryCommands({
          line,scope,store:planner,commandId:stableM5CommandId({line,scope})
        });
        if(proposed?.length!==2||proposed.some(x=>x?.kind!=='memory_action'||
           !['saved','forgotten','corrected'].includes(x.outcome)))
          return blocked('compound_unresolved_no_mutation');
        // A partially committed legacy replay is not allowed to be disguised
        // as a completed atomic batch.
        if(staged.length===1)return blocked('compound_partial_replay');
        if(staged.length===2){
          if(!current(args,'before_atomic_commit'))return blocked('source_unavailable');
          await commandStore.commitCommandBatch({scope,line,operations:staged});
        }
        if(!current(args,'after_atomic_commit'))return blocked('source_unavailable');
        const receipts=await Promise.all(proposed.map(x=>commandStore.verifyCommand({
          scope,commandId:x.commandId
        })));
        if(!current(args,'after_atomic_readback'))return blocked('source_unavailable');
        if(receipts.some((r,i)=>!r||r.commandId!==proposed[i].commandId||
           r.operation!==proposed[i].operation||r.requestedByLineId!==line.recordId||
           r.status!=='committed'||r.durableCommit!==true||
           !isUuid(r.memoryId)||!Array.isArray(r.evidenceRecordIds)||
           !r.evidenceRecordIds.includes(line.recordId)))
          return blocked('atomic_readback_failed');
        const actions=freeze(proposed.map((a,i)=>freeze({
          ...a,memoryId:receipts[i].memoryId,
          evidenceRecordIds:freeze(receipts[i].evidenceRecordIds),durableCommit:true
        })));
        const acknowledgements=freeze(publicActions(actions));
        report('processed','atomic_compound');
        return freeze({handled:true,route:'command',status:'processed',
          actions,acknowledgements});
      }
      let clarification=null;
      const actions=await handleExplicitMemoryCommands({
        line,scope,store:commandStore,commandId:stableM5CommandId({line,scope}),
        onClarification:receipt=>{
          // Do not forward evidence labels/content as speech or telemetry.
          clarification=freeze({commandId:receipt.commandId,
            choices:freeze((receipt.alternatives||[]).map((_,i)=>i+1))});
        }
      });
      if(!current(args,'after_write'))return blocked('source_unavailable');
      const acknowledgements=freeze(publicActions(actions||[]));
      const status=actions?.length?'processed':'not_a_command';
      report(status,'write');
      return freeze({handled:!!actions?.length,route:'command',status,
        actions:freeze(actions||[]),acknowledgements,clarification});
    }catch{
      report('failed','command');
      return blocked('storage_unavailable');
    }
  }
  return freeze({acceptAcceptedPlayerLine});
}
