// M4 source-only CPU recall. No database writes, model inference, or native authority.
import {assertRecallV1,sealRecallBundle,recallJsonBytes} from './recallSchemaV1.mjs';
// The read adapter yields scope-fenced M0 envelopes with trustworthy coverage metadata.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA=/^[0-9a-f]{64}$/;
const INTENTS=new Set(['recent_fact','exact_quote','open_recall','spontaneous']);
const SOURCES=new Set(['dialogue_line','journal_event','permanent_memory','canon']);
const STOP=new Set('a all an and are as at be before can did do does for from had has have how i in is it just me my of on or our say said she so that the their there these this those to us was were what when where which who why with would you your about happened happen remember recall tell told please every each list thing things something anything ever again more then ago very we they him her his he yesterday today last latest recent first earliest oldest minute minutes hour hours week weeks past name names named'.split(' '));
const jsonBytes=recallJsonBytes;
const tokenize=value=>(String(value??'').toLowerCase().match(/[\p{L}\p{N}]+/gu)??[]);
const compactTerms=value=>[...new Set(tokenize(value).filter(t=>t.length>=2&&!STOP.has(t)))].slice(0,12);
// Bounded, deterministic lexical aliases only; no guessed identities or learned claims.
const PET_GROUPS=[
  ['dog','dogs','puppy','puppies','corgi','corgis','pomsky','pomskies'],
  ['pet','pets','dog','dogs','cat','cats','puppy','puppies','corgi','corgis','pomsky','pomskies']
];
function relatedVocabulary(terms) {
  const output=new Set(terms);
  for(const term of terms){
    const group=['pet','pets'].includes(term)?PET_GROUPS[1]:
      PET_GROUPS[0].includes(term)?PET_GROUPS[0]:null;
    if(group)for(const word of group)output.add(word);
  }
  for(const term of terms){
    if(term.length>3&&term.endsWith('ies'))output.add(term.slice(0,-3)+'y');
    else if(term.length>3&&term.endsWith('s')&&!term.endsWith('ss'))output.add(term.slice(0,-1));
    else if(term.length>3)output.add(term+'s');
  }
  return [...output].slice(0,12);
}
const validTime=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const utc=value=>new Date(value).toISOString();
const fenceKeys=['characterId','worldProfileId','timelineId'];
const scopeKey=scope=>fenceKeys.map(k=>scope[k]).join(':'); // one human across avatars
const assert=(ok,code)=>{if(!ok)throw new TypeError(code);};
export function validateRecallQuery(query) {
  assert(query&&typeof query==='object'&&!Array.isArray(query),'invalid_recall_query');
  assert(query.version===1&&query.kind==='recall_query'&&UUID.test(query.queryId),'invalid_recall_query');
  assert(fenceKeys.every(k=>UUID.test(query[k]))&&SHA.test(query.turnIdentityHash),'invalid_recall_scope');
  assert(INTENTS.has(query.intent)&&typeof query.question==='string'&&query.question.length>0&&query.question.length<=12000,'invalid_recall_query');
  assert(Number.isSafeInteger(query.maxBytes)&&query.maxBytes>=1024&&query.maxBytes<=14336,'invalid_recall_budget');
  return assertRecallV1(query,'recallQuery');
}
function timeWindow(question,nowMs) {
  const q=question.toLowerCase();
  const today=new Date(nowMs);today.setUTCHours(0,0,0,0);
  let begin=null,end=null;
  if(/\byesterday\b/.test(q)){begin=today.getTime()-86400000;end=today.getTime();}
  else if(/\btoday\b/.test(q)){begin=today.getTime();end=today.getTime()+86400000;}
  else {
    const duration=q.match(/\b(?:last|past)\s+(?:(\d{1,3})|a|an|one|two|few|couple of|seven)\s+(minutes?|hours?|days?|weeks?)\b/);
    if(duration){
      const word=duration[0].match(/(?:a|an|one|two|few|couple of|seven)(?=\s+(?:minutes?|hours?|days?|weeks?)\b)/)?.[0];
      const count=duration[1]?Number(duration[1]):({a:1,an:1,one:1,two:2,few:3,'couple of':2,seven:7}[word]??1);
      const unit=duration[2].startsWith('minute')?60000:duration[2].startsWith('hour')?3600000:duration[2].startsWith('day')?86400000:604800000;
      begin=nowMs-count*unit;end=nowMs+1;
    }else if(/\b(?:last|past)\s+week\b/.test(q)){begin=nowMs-604800000;end=nowMs+1;}
    else {
      const date=q.match(/\b20\d{2}-\d{2}-\d{2}\b/);
      if(date&&validTime(date[0]+'T00:00:00Z')){begin=Date.parse(date[0]+'T00:00:00Z');end=begin+86400000;}
    }
  }
  return {fromUtc:begin===null?null:utc(begin),toUtc:end===null?null:utc(end)};
}
function findSpeaker(question) {
  if(/\b(what|quote|repeat|remember|recall)\b.*\b(did i|i said|i told|my words|i say)\b|\b(my exact words|quote me|what i said)\b/i.test(question))return 'player';
  if(/\b(what|quote|repeat|remember|recall)\b.*\b(did you|you said|your words|you say)\b|\b(quote yourself|what you said)\b/i.test(question))return 'npc';
  return null;
}
function kindForQuestion(query) {
  const quote=query.intent==='exact_quote'||/\b(quote|exact words|word for word|what did (i|you) say|what (i|you) said|tell you)\b/i.test(query.question);
  if(quote)return 'dialogue_line';
  if(/\b(saw|see|heard|hear|witness|gunshot|gunfire|crash|rollover|shot|shoot|killed|dead|event|explosion|police)\b/i.test(query.question))return 'journal_event';
  return null;
}
function isFollowup(question) {
  return /^(?:and |but |so )?(?:what about (?:that|it|before that)|and then|before that|after that|anything else|what else|then what|more about that)[?!. ]*$/i.test(question.trim());
}
function supportedRow(row,scope) {
  if(!row||!SOURCES.has(row.sourceKind))return null;
  for(const k of fenceKeys)if(row[k]!==scope[k])return null;
  if(!UUID.test(row.recordId)||!validTime(row.atUtc))return null;
  const e=row.envelope;
  if(!e||e.version!==1||e.kind!==row.sourceKind||e.recordId!==row.recordId||fenceKeys.some(k=>e[k]!==scope[k]))return null;
  if(row.evidenceState!=='verified'||row.forgotten===true||row.superseded===true||row.suppressed===true)return null;
  let mode,content;
  if(row.sourceKind==='dialogue_line'){
    if(!['player','npc'].includes(e.speaker)||!['typed','stt','npc_generated'].includes(e.source))return null;
    if(typeof e.content!=='string'||!e.content.length||e.content.length>12000||!SHA.test(e.turnIdentityHash))return null;
    if(e.speaker==='player'&&!(e.delivery==='accepted'&&['typed','stt'].includes(e.source)))return null;
    if(e.speaker==='npc'&&!(e.source==='npc_generated'&&e.delivery==='completed'&&UUID.test(e.deliveryReceiptId)))return null;
    if(row.atUtc!==e.committedAtUtc)return null;
    if(row.sourceKind==='dialogue_line'&&row.contentSha256&&row.contentSha256!==undefined&&row.contentSha256!==null){
      // Hash provenance belongs to the source adapter; mismatches are never projected.
      if(row.contentVerified!==true)return null;
    }
    mode='exact_quote';content=e.content;
  }else if(row.sourceKind==='journal_event'){
    if(!UUID.test(e.observationId)||!SHA.test(e.sourceHash)||!validTime(e.receivedAtUtc)||row.atUtc!==e.receivedAtUtc)return null;
    if(!e.ownerProof||!UUID.test(e.ownerProof.incarnationId)||!UUID.test(e.ownerProof.encounterId)||!UUID.test(e.ownerProof.hostRunId)||!UUID.test(e.ownerProof.observerCaptureRef)||!Number.isSafeInteger(e.ownerProof.worldEpoch))return null;
    if(!['witnessed','reported'].includes(e.receiptStatus)||!Array.isArray(e.claims)||!e.claims.length||e.claims.length>32)return null;
    const claims=e.claims.filter(c=>c&&UUID.test(c.sourceEvidenceId)&&typeof c.kind==='string'&&c.kind.length<=48&&typeof c.durableSubject==='string'&&c.durableSubject.length<=100&&['self','visual','auditory','report'].includes(c.modality)&&['direct','reported','inferred','unknown'].includes(c.certainty));
    if(claims.length!==e.claims.length)return null;
    const direct=e.receiptStatus==='witnessed'&&claims.every(c=>['self','visual','auditory'].includes(c.modality)&&c.certainty==='direct');
    mode=direct?'observed_fact':'reported_claim';
    // Describe exactly the typed evidence fields; never infer an action or identity.
    content=e.eventType+': '+claims.map(c=>[c.kind,c.durableSubject,'('+c.modality+'/'+c.certainty+')'].join(' ')).join('; ');
  }else {
    // Future M5/M6 read adapter: only explicitly evidence-verified retained text,
    // and interpretation/opinion must never masquerade as observation.
    if(typeof e.content!=='string'||!e.content.length||e.content.length>3072||!['opinion','reported_claim','observed_fact'].includes(e.mode))return null;
    if(e.mode==='observed_fact'&&!Array.isArray(e.sourceEvidenceIds))return null;
    mode=e.mode;content=e.content;
  }
  return {...row,mode,content,atMs:Date.parse(row.atUtc)};
}
function similarity(row,terms,searchTerms,nowMs,focusKind,speaker,anchoredIds) {
  if(speaker&&row.envelope?.speaker!==speaker&&!(speaker==='player'&&row.isCorrectionOverlay===true))return -Infinity;
  if(focusKind&&row.sourceKind!==focusKind&&!(focusKind==='dialogue_line'&&row.isCorrectionOverlay===true))return -Infinity;
  const hay=new Set(tokenize(row.sourceKind==='dialogue_line'?row.envelope.content:row.content));
  const exact=terms.filter(t=>hay.has(t)).length;
  const related=searchTerms.filter(t=>!terms.includes(t)&&hay.has(t)).length;
  const age=Math.max(0,nowMs-row.atMs);
  const recency=Math.max(0,3-Math.log2(1+age/3600000));
  if(terms.length&&!exact&&!related){
    if(row.sourceKind!=='dialogue_line')return -Infinity;
    if(anchoredIds.has(row.relatedAnchorId))return 3+recency*.2;
    if(anchoredIds.has(row.contextAnchorId)&&Number.isSafeInteger(row.contextDistance)&&
      row.contextDistance>=1&&row.contextDistance<=2)
      return 1-row.contextDistance*.1+recency*.2;
    return -Infinity;
  }
  const lexical=exact?12*exact/Math.max(1,terms.length)+exact:6+Math.min(related,2);
  return lexical+recency+(row.sourceKind==='dialogue_line'&&focusKind==='dialogue_line'?2:0);
}
// Prefer explicit, authenticated player facts when the user asks for a set of
// pet names. A prior NPC reply about forgotten names is not an original fact.
// These patterns affect selection order only; they never create memory claims.
const PET_NAME_ASSERTIONS=[
  /\b(?:dogs?|corgis?|pomsk(?:y|ies)|pupp(?:y|ies)|pets?|cats?)\s+(?:named|called)\s+[A-Z][a-z]{2,31}\b/,
  /\b(?:my|our|the)\s+(?:(?:two|three|four|\d+|other|more)\s+){0,3}(?:dogs?|corgis?|pomsk(?:y|ies)|pupp(?:y|ies)|pets?|cats?)\s+[A-Z][a-z]{2,31}\b/,
  /\b[A-Z][a-z]{2,31}(?:['’]s|\s+(?:is|was))\s+(?:(?:my|our|a|an|the)\s+)?(?:dogs?|corgis?|pomsk(?:y|ies)|pupp(?:y|ies)|pets?|cats?)\b/,
  /\b[A-Z][a-z]{2,31}(?:\s+(?:and|,)\s+[A-Z][a-z]{2,31}){0,3}\s+(?:are|were)\s+(?:(?:my|our|the)\s+)?(?:(?:two|three|four|\d+)\s+)?(?:dogs?|corgis?|pomsk(?:y|ies)|pupp(?:y|ies)|pets?|cats?)\b/,
  /\b(?:my|our)\s+(?:dogs?|corgis?|pomsk(?:y|ies)|pupp(?:y|ies)|pets?|cats?)\s+(?:are|were|is|was)\s+(?:(?:named|called)\s+)?[A-Z][a-z]{2,31}\b/
];
const RELATED_NAME_LIST=/^\s*[A-Z][a-z]{2,31}(?:,\s*(?:and\s+)?[A-Z][a-z]{2,31}|\s+and\s+[A-Z][a-z]{2,31}){1,7}\.?\s*$/;
function playerPetFactBoost(row,petNamesQuestion){
  if(!petNamesQuestion||row.sourceKind!=='dialogue_line'||row.envelope?.speaker!=='player')return 0;
  const content=row.content;
  // Questions about a fact, including the current user's older questions,
  // must not crowd out statements actually supplying that fact.
  if(content.includes('?'))return 0;
  if(PET_NAME_ASSERTIONS.some(pattern=>pattern.test(content))||
     (row.contextAnchorId&&RELATED_NAME_LIST.test(content)))return 24;
  return 4; // Other player statements still outrank an NPC's retelling at equal relevance.
}
function emptyBundle(query,status) {
  return sealRecallBundle({version:1,characterId:query.characterId,worldProfileId:query.worldProfileId,timelineId:query.timelineId,kind:'recall_bundle',queryId:query.queryId,status,items:[],coverage:{status,returnedCount:0,matchedCount:0},totalBytes:0},query.maxBytes);
}
function freshness(row,nowMs){
  if(['permanent_memory','canon'].includes(row.sourceKind))return 'permanent';
  if(row.atMs>nowMs-3600000&&row.atMs<=nowMs+60000)return 'live';
  if(row.atMs>nowMs-172800000)return 'recent';
  return 'archive';
}
export function toPs4RecallContribution(bundle,{maxBytes=4096}={}) {
  assertRecallV1(bundle,'recallBundle');
  if(!Number.isSafeInteger(maxBytes)||maxBytes<512||maxBytes>14336)throw new TypeError('invalid_ps4_recall_budget');
  // A typed, bounded optional contribution. The sole PS4 knowledge-frame
  // allocator chooses whether and where to admit it; never construct a prompt.
  const contribution={version:1,contributor:'m4_recall',lane:'RECALLED',
    queryId:bundle.queryId,status:bundle.status,
    coverage:{...bundle.coverage,returnedCount:0},items:[]};
  for(const item of bundle.items){
    const candidate={...contribution,items:[...contribution.items,item],
      coverage:{...contribution.coverage,returnedCount:contribution.items.length+1}};
    if(jsonBytes(candidate)>maxBytes)break;
    contribution.items.push(Object.freeze({...item}));
  }
  contribution.coverage.returnedCount=contribution.items.length;
  if(contribution.status==='matched'&&!contribution.items.length) {
    contribution.status='unavailable';contribution.coverage.status='unavailable';
  }
  return Object.freeze({...contribution,coverage:Object.freeze(contribution.coverage),items:Object.freeze(contribution.items)});
}

/**
 * readAdapter.read({scope,terms,fromUtc,toUtc,sourceKind,limit}) ->
 * {rows: M0 evidence-envelopes[], coverageComplete:boolean}.
 * Caller supplies a verified protagonistKey, never a guessed ped/name.
 */
export async function recallMemory({query,readAdapter,protagonistKey,nowUtc=new Date().toISOString(),followup=null}){
  validateRecallQuery(query);
  assert(['franklin','michael','trevor','unknown'].includes(protagonistKey),'unverified_protagonist');
  assert(validTime(nowUtc),'invalid_recall_clock');
  assert(readAdapter&&typeof readAdapter.read==='function','missing_recall_adapter');
  const scope={characterId:query.characterId,worldProfileId:query.worldProfileId,timelineId:query.timelineId,protagonistKey};
  const follow=isFollowup(query.question)&&followup&&followup.scopeKey===scopeKey(scope)&&Array.isArray(followup.terms)&&validTime(followup.expiresAtUtc)&&Date.parse(followup.expiresAtUtc)>=Date.parse(nowUtc);
  const cleanQuestion=query.question.replace(/\b20\d{2}-\d{2}-\d{2}\b/g,' ').replace(/\b(?:last|past)\s+(?:two|2|few|couple of|24|60)\s+(?:minutes?|hours?|days?)\b/gi,' ');
  const terms=follow?followup.terms.filter(t=>typeof t==='string'&&/^[\p{L}\p{N}]{2,48}$/u.test(t)).slice(0,12):compactTerms(cleanQuestion);
  const window=timeWindow(query.question,Date.parse(nowUtc));
  // Do not claim all-time oldest from a bounded candidate page.
  if(/\b(first|earliest|oldest)\b/i.test(query.question))return {bundle:emptyBundle(query,'unavailable'),continuation:null};
  if(follow&&validTime(followup.anchorUtc)){
    if(/\bbefore that\b/i.test(query.question))window.toUtc=!window.toUtc||followup.anchorUtc<window.toUtc?followup.anchorUtc:window.toUtc;
    if(/\bafter that\b/i.test(query.question))window.fromUtc=!window.fromUtc||followup.anchorUtc>window.fromUtc?followup.anchorUtc:window.fromUtc;
  }
  const searchTerms=relatedVocabulary(terms);
  const focusKind=kindForQuestion(query)??(follow?followup.sourceKind??null:null);
  const speaker=focusKind==='dialogue_line'?findSpeaker(query.question)??(follow?followup.speaker??null:null):null;
  const expandDialogueContext=terms.length>0&&focusKind===null&&speaker===null&&
    /\b(?:all|every|each|list|names?|which|remember.*(?:dogs?|pets?))\b/i.test(query.question);
  const expandRelatedFacts=expandDialogueContext&&!window.fromUtc&&!window.toUtc;
  const petNamesQuestion=expandRelatedFacts&&terms.some(term=>PET_GROUPS[1].includes(term));
  let result;
  try{result=await readAdapter.read({scope,terms:searchTerms,fromUtc:window.fromUtc,toUtc:window.toUtc,
    sourceKind:focusKind,speaker,limit:384,expandDialogueContext,expandRelatedFacts});}
  catch{return {bundle:emptyBundle(query,'unavailable'),continuation:null};}
  if(!result||!Array.isArray(result.rows)||result.rows.length>384)return {bundle:emptyBundle(query,'unavailable'),continuation:null};
  const nowMs=Date.parse(nowUtc);
  const rejectedEvidence=result.rows.some(r=>r?.evidenceState==='verified'&&!supportedRow(r,scope));
  let rows=result.rows.map(r=>supportedRow(r,scope)).filter(Boolean)
    .filter(r=>r.atMs<=nowMs+60000&&(!window.fromUtc||r.atUtc>=window.fromUtc)&&(!window.toUtc||r.atUtc<window.toUtc));
  const anchoredIds=new Set(rows.filter(row=>row.sourceKind==='dialogue_line'&&
    searchTerms.some(t=>tokenize(row.content).includes(t))).map(row=>row.recordId));
  const sortRecent=/\b(last|latest|most recent|just|earlier today)\b/i.test(query.question);
  const sortOldest=/\b(first|earliest|oldest)\b/i.test(query.question);
  rows=rows.map(row=>({...row,score:similarity(row,terms,searchTerms,nowMs,focusKind,speaker,anchoredIds)+
    playerPetFactBoost(row,petNamesQuestion)}))
    .filter(row=>Number.isFinite(row.score))
    .sort((a,b)=>(sortRecent||sortOldest?0:b.score-a.score)||(sortOldest?a.atMs-b.atMs:b.atMs-a.atMs)||a.recordId.localeCompare(b.recordId));
  const distinct=new Set();rows=rows.filter(r=>{if(distinct.has(r.recordId))return false;distinct.add(r.recordId);return true;});
  const matchedCount=rows.length;
  if(expandRelatedFacts&&rows.some(r=>r.relatedAnchorId)){
    // Give authenticated cross-session supporting lines a place in the 4 KiB
    // answer budget without letting them outrank their lexical anchors.
    const explicit=rows.filter(r=>!r.relatedAnchorId);
    const related=rows.filter(r=>r.relatedAnchorId);
    const ordered=[];
    for(let i=0;explicit.length||related.length;i++){
      if(explicit.length)ordered.push(explicit.shift());
      if(i<4&&related.length)ordered.push(related.shift());
      if(!explicit.length&&i>=4)ordered.push(...related.splice(0));
    }
    rows=ordered;
  }
  const status=matchedCount?'matched':!rejectedEvidence&&result.coverageComplete===true?'not_recorded':'unavailable';
  const bundle=emptyBundle(query,status);
  bundle.coverage.matchedCount=matchedCount;
  if(matchedCount){
    const cap=query.intent==='spontaneous'?3:query.intent==='exact_quote'?4:12;
    for(const r of rows){
      if(bundle.items.length>=cap)break;
      if(query.intent==='exact_quote'&&r===rows[0]&&[...r.content].length>3072)break;
      // The v1 recallItem cannot hold >3072 Unicode code units. Never
      // truncate an exact quote and falsely label it byte-exact.
      if([...r.content].length>3072||!r.content.length)continue;
      const item={sourceKind:r.sourceKind,recordId:r.recordId,mode:r.mode,content:r.content,freshness:freshness(r,nowMs),
        ...(r.sourceKind==='dialogue_line'?{speaker:r.envelope.speaker}:{})};
      const candidate={...bundle,items:[...bundle.items,item],coverage:{...bundle.coverage,returnedCount:bundle.items.length+1}};
      if(jsonBytes(candidate)<=query.maxBytes){
        sealRecallBundle(candidate);
        if(candidate.totalBytes<=query.maxBytes)bundle.items.push(item);
      }
    }
    bundle.coverage.returnedCount=bundle.items.length;
    if(!bundle.items.length){bundle.status='unavailable';bundle.coverage.status='unavailable';}
  }
  sealRecallBundle(bundle,query.maxBytes);
  const continuation=bundle.status==='matched'?{scopeKey:scopeKey(scope),terms,sourceKind:focusKind,speaker,anchorUtc:rows[0]?.atUtc??null,expiresAtUtc:utc(nowMs+300000)}:null;
  return {bundle,continuation};
}
