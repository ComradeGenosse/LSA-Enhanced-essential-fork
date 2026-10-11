// M5 explicit promoted-NPC memory commands. Host-neutral and rules-first.
// No SQLite schema or Luna dependency; the store is a timeline-fenced adapter.
import { createHash } from 'node:crypto';
import { isUuid } from '../util/identity.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const words = text => (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
  .filter(word => word.length > 2 && !['the','that','this','what','said','about','from','with','just','you','me','and','was'].includes(word));
const commandPrefix = /^(?:(?:hey|yo|please)[\s,]+)?(?:(?:nathan|buddy)[\s,]+)?(?:please\s+)?/i;
const successful = { remember:'saved', forget:'forgotten', correct:'corrected' };
const uuid = value => typeof value === 'string' && isUuid(value);
const same = (record, scope) => record.characterId === scope.characterId &&
  record.worldProfileId === scope.worldProfileId && record.timelineId === scope.timelineId &&
  (!('protagonistKey' in record) || record.protagonistKey === scope.protagonistKey);
const clone = value => JSON.parse(JSON.stringify(value));

/** Detection does not turn questions or conversational idioms into writes. */
export function detectExplicitMemoryCommand(raw, lunaInterpretation = null) {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 12000) return null;
  const text = raw.replace(commandPrefix, '').trim();
  if (/^(?:do you remember|can you remember|what do you remember|tell me what you remember)\b/i.test(text))
    return { intent:'inspect', content:null, selector:'all', pin:false };
  if (/^(?:show|list|inspect)\s+(?:(?:me|your|my)\s+)?(?:memories|memory|what you remember)\b/i.test(text))
    return { intent:'inspect', content:null, selector:'all', pin:false };
  if (/^(?:export|back up|backup)\s+(?:my|your|our|the)?\s*memories\b/i.test(text))
    return { intent:'export', content:null, selector:'all', pin:false };
  let intent, selector='referent', content=null, pin=false, topic=null, correctionMode=null;
  let match;
  if ((match = /^(?:don't\s+(?:ever\s+)?forget|never\s+forget|remember|keep in mind|make a note(?: of)?)\b[\s,:-]*(.*)$/i.exec(text))) {
    intent='remember';
    pin=/^(?:don't\s+(?:ever\s+)?forget|never\s+forget)\b/i.test(text);
    const tail=match[1].trim();
    if (/^(?:that\s+|i'm\s+|i am\s+|i\s+|my\s+|we\s+|our\s+)/i.test(tail) &&
        !/^(?:that|this)\s*$/i.test(tail)) {
      selector='claim';
      content=tail.replace(/^that\s+/i,'');
    } else if (/^(?:what i (?:just )?(?:said|told you)|what we (?:just )?(?:said|talked about))\b/i.test(tail)) {
      selector='dialogue';
    } else {
      topic=tail.replace(/^(?:this|that|the|what happened|moment|incident|scene)\b[\s,:-]*/i,'').trim() || null;
      selector=topic ? 'topic' : 'referent';
    }
  } else if ((match = /^promise\s+(?:me\s+)?(?:that\s+)?(.+)$/i.exec(text))) {
    intent='remember';selector='claim';content='You promised: '+match[1];pin=false;
  } else if ((match = /^(?:forget|erase|delete)\b[\s,:-]*(.*)$/i.exec(text))) {
    intent='forget';
    const tail=match[1].trim();
    topic=tail.replace(/^(?:what i (?:said|told you) about|the memory about|about|this|that|the)\s*/i,'').trim() || null;
    selector=/^what i (?:said|told you) about\b/i.test(tail) ? 'dialogue_topic' : topic ? 'topic' : 'referent';
  } else if ((match = /^(?:no[,\s]+i (?:actually )?said|i meant|correct that(?: to)?|that's not what happened[,;:]?\s*(?:it was)?|that(?:'s| is) wrong[,;:]?\s*(?:it was)?)\b[\s,:-]*(.*)$/i.exec(text))) {
    intent='correct';content=match[1].trim();selector='referent';
    correctionMode=/^(?:no[,\s]+i (?:actually )?said|i meant)/i.test(text) ? 'transcript' : 'counter_claim';
  } else return null;

  // Luna may supply a *proposed exact span*, never a new fact or authority.
  if (lunaInterpretation && ['remember','forget','correct'].includes(intent) &&
      lunaInterpretation.intent === intent &&
      typeof lunaInterpretation.content === 'string' &&
      raw.includes(lunaInterpretation.content) &&
      lunaInterpretation.content.trim() &&
      !content && selector === 'claim') content=lunaInterpretation.content;
  return { intent, selector, content, topic, pin, correctionMode };
}

function eligible(candidate, scope, line, operation, selector) {
  if (!candidate || !uuid(candidate.recordId) || !same(candidate,scope) ||
      candidate.recordId === line.recordId || candidate.forgotten || candidate.deleted) return false;
  if (!['dialogue_line','journal_event','permanent_memory','manual_memory'].includes(candidate.kind)) return false;
  if (typeof candidate.content !== 'string' || !candidate.content.trim()) return false;
  if (!Number.isFinite(Date.parse(candidate.occurredAtUtc))) return false;
  if (candidate.kind === 'journal_event' && candidate.receiptStatus !== 'witnessed') return false;
  if (candidate.kind === 'dialogue_line' &&
      !(candidate.speaker === 'player' && candidate.delivery === 'accepted' ||
        candidate.speaker === 'npc' && candidate.delivery === 'completed')) return false;
  if (selector === 'dialogue' || selector === 'dialogue_topic')
    return candidate.kind === 'dialogue_line' && candidate.speaker === 'player' &&
      (!line.segmentId || candidate.segmentId === line.segmentId);
  if (operation === 'correct' && selector === 'transcript')
    return candidate.kind === 'dialogue_line' && candidate.speaker === 'player' && candidate.source === 'stt';
  if (operation === 'forget') return true;
  return true;
}

function resolve(candidates, scope, line, parsed, now) {
  const operation=parsed.intent, selector=parsed.selector;
  const all=candidates.filter(c => eligible(c,scope,line,operation,selector))
    .map(c => ({...c, age:Math.max(0,(now-Date.parse(c.occurredAtUtc))/1000)}))
    .filter(c => c.age <= (selector === 'dialogue' ? 300 : selector === 'referent' ? 120 : 3600));
  const query=words(parsed.topic || '');
  let ranked=all.map(c=>{
    const body=(c.content+' '+(c.eventType || '')+' '+(c.label || '')).toLowerCase();
    const matches=query.filter(w=>body.includes(w)).length;
    if(query.length && matches!==query.length)return null;
    let score=0.42+0.37*Math.exp(-c.age/60);
    if(query.length)score+=0.35;
    if(selector==='dialogue' && c.kind==='dialogue_line')score+=0.2;
    if(c.kind==='journal_event')score+=0.04;
    return {...c,score};
  }).filter(Boolean).sort((a,b)=>b.score-a.score||a.recordId.localeCompare(b.recordId));
  // Multiple equally plausible moments are never silently disambiguated.
  const best=ranked[0], second=ranked[1];
  if (!best || best.score < 0.65 ||
      (second && best.score-second.score < 0.20)) {
    return {candidate:null, alternatives:ranked.slice(0,2).map(c=>({recordId:c.recordId,label:c.label||c.content.slice(0,96)}))};
  }
  return {candidate:best,alternatives:[]};
}

function actionBase(scope, line, commandId, operation) {
  return {
    version:1,characterId:scope.characterId,worldProfileId:scope.worldProfileId,
    timelineId:scope.timelineId,kind:'memory_action',commandId,
    requestedByLineId:line.recordId,operation,
    outcome:'pending',durableCommit:false,evidenceRecordIds:[],memoryId:null
  };
}
function result(base, outcome, extras={}) {
  const successfulOutcome=['saved','forgotten','corrected'].includes(outcome);
  return Object.freeze({...base,...extras,outcome,
    durableCommit:successfulOutcome});
}
function validateInput({line, commandId, scope, store}) {
  if (!line || !scope || !uuid(commandId) || ![scope.characterId,scope.worldProfileId,scope.timelineId,line.recordId].every(uuid) ||
      !same(line,scope) || line.kind !== 'dialogue_line' ||
      line.speaker !== 'player' || !['typed','stt'].includes(line.source) ||
      line.delivery !== 'accepted' || typeof line.content !== 'string' ||
      !line.content.trim() || typeof store?.findCandidates !== 'function' ||
      typeof store?.commitCommand !== 'function' || typeof store?.verifyCommand !== 'function')
    throw new TypeError('invalid_memory_command_input');
  if (scope.protagonistKey !== undefined &&
      !['franklin','michael','trevor','unknown'].includes(scope.protagonistKey))
    throw new TypeError('invalid_memory_command_protagonist');
}

export async function handleExplicitMemoryCommand(input) {
  validateInput(input);
  const { line,scope,store,commandId }=input;
  const parsed=detectExplicitMemoryCommand(line.content,input.lunaInterpretation);
  if (!parsed) return null;
  if (parsed.intent==='inspect' || parsed.intent==='export') {
    if (typeof store[parsed.intent] !== 'function') return {kind:'memory_read',operation:parsed.intent,status:'unavailable'};
    try {
      return {kind:'memory_read',operation:parsed.intent,status:'ok',
        data:await store[parsed.intent]({scope})};
    } catch {return {kind:'memory_read',operation:parsed.intent,status:'unavailable'};}
  }
  const base=actionBase(scope,line,commandId,parsed.intent);
  try {
    const old=await store.verifyCommand({scope,commandId});
    if (old) return verifiedAction(old,base);
    let selected=null, alternatives=[], content=parsed.content;
    if (parsed.selector==='claim') {
      if (!content || !content.trim()) return result(base,'clarify');
      // Never invent current radio, location, vehicle, or named subject.
      if (/\b(?:this song|right here|over here|this car|that guy)\b/i.test(content) &&
          !input.verifiedContext?.referents?.some(r=>typeof r.phrase==='string' &&
            content.toLowerCase().includes(r.phrase.toLowerCase()) &&
            typeof r.value==='string' && r.value.trim() &&
            r.verified === true && r.worldProfileId===scope.worldProfileId &&
            r.timelineId===scope.timelineId))
        return result(base,'clarify',{clarification:'Which song, place, vehicle, or person do you mean?'});
    } else {
      const parsedSelector=parsed.intent==='correct' && parsed.correctionMode==='transcript' ? 'transcript' : parsed.selector;
      const candidates=await store.findCandidates({
        scope:clone(scope),operation:parsed.intent,selector:parsedSelector,topic:parsed.topic,
        beforeUtc:line.committedAtUtc,excludeRecordId:line.recordId
      });
      if (!Array.isArray(candidates)) return result(base,'failed');
      const resolved=resolve(candidates,scope,line,{...parsed,selector:parsedSelector},
        Number.isFinite(Date.parse(line.committedAtUtc))?Date.parse(line.committedAtUtc):Date.now());
      selected=resolved.candidate;alternatives=resolved.alternatives;
      if (!selected) return result(base,'clarify',{alternatives,
        clarification: alternatives.length===2 ? 'Which one: '+alternatives[0].label+' or '+alternatives[1].label+'?' :
        'Which specific memory or moment do you mean?'});
      if (parsed.intent==='correct' && !content) return result(base,'clarify',
        {clarification:'What is the corrected wording?'});
      if (!content) content=selected.content;
    }
    const evidenceRecordIds=selected?[selected.recordId,line.recordId]:[line.recordId];
    const operation={
      scope:clone(scope),commandId,requestedByLineId:line.recordId,operation:parsed.intent,
      origin:'explicit_player',recordType:parsed.selector==='claim'?'player_claim':
        parsed.intent==='correct'?'correction':selected.kind,
      content,contentHash:hash(content),pin:parsed.pin,
      evidenceRecordIds,targetRecordId:selected?.recordId||null,
      correctionMode:parsed.correctionMode,subjectCertainty:parsed.selector==='claim'?'reported':null,
      requestedAtUtc:line.committedAtUtc
    };
    // commitCommand must run under M1 withTimelineWrite at the actual writer
    // boundary. In-memory adapters cannot claim a durable commit.
    const receipt=await store.commitCommand(operation);
    if (!receipt || receipt.commandId!==commandId || receipt.status!=='committed' ||
        receipt.durableCommit!==true) return result(base,'failed');
    const verified=await store.verifyCommand({scope,commandId});
    return verifiedAction(verified,base,evidenceRecordIds);
  } catch {
    // Never acknowledge success after an exception, including a commit whose
    // receipt/verification was lost. Caller may replay the same commandId.
    return result(base,'failed');
  }
}

function verifiedAction(receipt,base,evidenceRecordIds=null) {
  if (!receipt || receipt.commandId!==base.commandId ||
      receipt.operation!==base.operation || receipt.status!=='committed' ||
      receipt.durableCommit!==true || !uuid(receipt.memoryId) ||
      !Array.isArray(receipt.evidenceRecordIds) || !receipt.evidenceRecordIds.every(uuid) ||
      !receipt.evidenceRecordIds.includes(base.requestedByLineId))
    return result(base,'failed');
  if (evidenceRecordIds && (evidenceRecordIds.length!==receipt.evidenceRecordIds.length ||
      evidenceRecordIds.some(id=>!receipt.evidenceRecordIds.includes(id))))
    return result(base,'failed');
  return result(base,successful[base.operation],{
    evidenceRecordIds:receipt.evidenceRecordIds,memoryId:receipt.memoryId
  });
}

/** Only these typed statuses may support a successful Luna acknowledgement. */
export function memoryActionAcknowledgement(action) {
  if (action?.kind!=='memory_action') return null;
  if (action.durableCommit===true && action.outcome==='saved') return 'I saved that memory.';
  if (action.durableCommit===true && action.outcome==='forgotten') return 'I forgot that memory.';
  if (action.durableCommit===true && action.outcome==='corrected') return 'I recorded your correction.';
  if (action.outcome==='clarify') return action.clarification||'Which memory do you mean?';
  if (action.outcome==='failed') return 'I could not confirm the memory change.';
  return 'That memory change is still pending.';
}
