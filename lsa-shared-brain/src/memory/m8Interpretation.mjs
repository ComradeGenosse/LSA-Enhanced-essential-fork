// M8: pure, source-linked interpretation. Never mutates P2 evidence or writes PS4 frames.
import {isUuid, normalizedEvidence, sameScope, stableUuid, factDigest} from './evidence.mjs';
import {detectExplicitMemoryCommand} from './explicitCommands.mjs';
import {performance} from 'node:perf_hooks';

const PROTAGONISTS=new Set(['franklin','michael','trevor','unknown']);
const STYLES=new Set(['goofy','sarcastic','dry','dark','wholesome']);
const CATEGORIES=new Set(['episode','semantic','relationship','joke']);
const COOLDOWN_MS=60*60*1000, GLOBAL_MS=10*60*1000, TWO_HOURS=2*60*60*1000;
const MAX_SOURCES=128, MAX_MEMORIES=64, MAX_APPRAISALS=32;
const num=(v,defaultValue)=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1?v:defaultValue;
const ms=(s)=>typeof s==='string'&&Number.isFinite(Date.parse(s))?Date.parse(s):NaN;
const frozen=x=>Object.freeze(x);
const ordered=x=>[...new Set(x)].sort();
function validScope(s){
 if(!s||!['characterId','worldProfileId','timelineId'].every(k=>isUuid(s[k]))||!PROTAGONISTS.has(s.protagonistKey))
  throw Error('m8_invalid_scope');
 return frozen({characterId:s.characterId,worldProfileId:s.worldProfileId,
   timelineId:s.timelineId,protagonistKey:s.protagonistKey});
}
function personalityOf(raw){
 // Only explicit, already user-approved structured canon. Never infer traits from an LLM.
 const h=raw?.humor??{};
 return frozen({style:STYLES.has(h.style)?h.style:'dry',teasing:num(h.teasing,0),
   caution:num(raw?.caution,.5),loyalty:num(raw?.loyalty,.5),
   nostalgia:num(raw?.nostalgia,.5),bravado:num(raw?.bravado,.5),
   interests:frozen((Array.isArray(raw?.interests)?raw.interests:[]).filter(x=>['cars','music','food','travel'].includes(x)).slice(0,8))});
}
function sourceEnvelope(row,scope){
 if(!row||row.committed!==true||row.sourceVerified!==true||!row.record||
    !sameScope(row.record,scope))return null;
 let e;try{e=normalizedEvidence(row.record);}catch{return null;}
 // The P2 reader must verify PS2 observer authority and persisted sidecar separately.
 if(e.kind==='journal_event'&&row.sidecarVerified!==true)return null;
 // v1 witnessed events do NOT prove the controlling protagonist's identity.
 // Source avatar is historical proof, not a separate player relationship.
 return e;
}
export function categoryOf(row){
 if(row.kind==='journal_event'){
  const s=[row.eventType,...row.claims.map(x=>x.kind)].join(' ');
  if(/crash|rollover|collision|impact|flip/i.test(s))return 'crash';
  if(/funny|joke|prank|laugh/i.test(s))return 'humor';
  if(/rescued|rescue|help|saved/i.test(s))return 'help';
  if(/embarrass|blunder|fumbled|stumble/i.test(s))return 'embarrassment';
  if(/music|radio|song/i.test(s))return 'music';
  return null;
 }
 const x=row.content;
 // The accepted wording of an M5 command is not a new humorous or social
 // encounter. "Forget that inside joke" must not itself recreate the joke.
 if(row.speaker==='player'&&detectExplicitMemoryCommand(x))return null;
 if(/\bthank(s| you)\b|\bi trust you\b/i.test(x))return 'gratitude';
 if(/\bthat (?:crash|collision|impact) (?:was |is )?(?:hilarious|funny)\b/i.test(x))return 'crash_joke';
 if(/\b(?:just kidding|inside joke|running joke)\b/i.test(x))return 'humor_quote';
 return null;
}
function feeling(cat,p){
 if(cat==='crash'){
  if(p.caution>=.67)return ['concern','That crash leaves me uneasy.',-.55];
  if(p.style==='sarcastic')return ['amusement','That crash deserves a slow clap.',.45];
  if(p.style==='goofy')return ['amusement','That crash seems absurdly funny to me.',.7];
  return ['surprise','That crash caught my attention.',.15];
 }
 if(cat==='help')return ['appreciation','That help matters to me.',.6*p.loyalty];
 if(cat==='embarrassment')return p.style==='sarcastic'?['awkwardness','That blunder is painfully awkward to me.',-.2]:
   ['embarrassment','That blunder feels embarrassing to me.',-.25];
 if(cat==='music')return p.interests.includes('music')?['affinity','I tend to notice music.',.25]:null;
 if(cat==='gratitude')return ['warmth','I feel appreciated by those words.',.6*p.loyalty];
 if(cat==='crash_joke'||cat==='humor_quote'||cat==='humor'){
  return p.style==='sarcastic'?['amusement','I find that joke deliciously dry.',.55]:
    p.caution>.8?['ambivalence','I am not sure that joke is funny.',-.15]:
    ['amusement','I find that funny.',.65];
 }
 return null;
}
function freshness(at,now){const age=now-ms(at);return age<=120_000?'live':age<=7*86400000?'recent':'archive';}
function trimProjection(project,maxBytes,{preferDurableJokes=false}={}){
 const bytes=()=>Buffer.byteLength(JSON.stringify(project),'utf8');
 // Trim against a worst-case-width totalBytes. With the 1-digit placeholder the
 // loop could stop at maxBytes-3 and the converged multi-digit total then
 // exceeded the cap, so preparePs4M8 silently dropped the whole frame.
 project.totalBytes=maxBytes;
 while(bytes()>maxBytes){
  // Long-term relationship and joke summaries should survive a crowded
  // recent-facts projection; never make durable friendship disappear because
  // unrelated conversations exhausted the PS4 byte budget.
  if(preferDurableJokes&&project.facts.length)project.facts.pop();
  else if(preferDurableJokes&&project.interpretations.length)project.interpretations.pop();
  else if(project.jokes.length)project.jokes.pop();
  else if(project.interpretations.length)project.interpretations.pop();
  else if(project.facts.length)project.facts.pop();
  else break;
 }
 if(bytes()>maxBytes)throw Error('m8_projection_budget_too_small');
 project.totalBytes=bytes();
 // Include totalBytes itself in the accounting; converge on exact serialized bytes.
 while(project.totalBytes!==bytes())project.totalBytes=bytes();
 return frozen({...project,facts:frozen(project.facts),interpretations:frozen(project.interpretations),
  jokes:frozen(project.jokes),relationship:frozen(project.relationship)});
}
/**
 * Trust boundary: rows MUST originate from a P2 serialized, committed-source
 * reader that verifies the sidecar. Input booleans are adapter receipts, never
 * user-provided facts. Pure evaluator does not authenticate arbitrary JSON.
 * M7 appraisals influence salience only: untrusted free-form takes are NOT
 * promoted into quoted words, factual claims, or the PS4 knowledge frame.
 */
export function evaluateM8({scope,personality={},sources=[],memories=[],appraisals=[],
 suppressedIds=[],correctedIds=[],relationshipHistory=null,nowUtc='2026-10-11T00:00:00.000Z',
 maxBytes=4096}={}){
 const s=validScope(scope),p=personalityOf(personality),now=ms(nowUtc);
 if(!Number.isFinite(now)||!Number.isInteger(maxBytes)||maxBytes<512||maxBytes>8192||
    !Array.isArray(sources)||sources.length>MAX_SOURCES||!Array.isArray(memories)||
    memories.length>MAX_MEMORIES||!Array.isArray(appraisals)||appraisals.length>MAX_APPRAISALS||
    !Array.isArray(suppressedIds)||!Array.isArray(correctedIds)||
    [...suppressedIds,...correctedIds].some(x=>!isUuid(x)))throw Error('m8_invalid_input');
 if(relationshipHistory!==null &&
    (relationshipHistory.version!==1||relationshipHistory.sourceVerified!==true||
     !sameScope(relationshipHistory,s)||!Array.isArray(relationshipHistory.categories)||
     relationshipHistory.categories.some(x=>typeof x?.category!=='string'||
       !Number.isSafeInteger(x.count)||x.count<0||
       !Array.isArray(x.sourceEvidenceIds)||x.sourceEvidenceIds.length>16||
       x.sourceEvidenceIds.some(id=>!isUuid(id))||
       (x.lastAtUtc!==null&&!Number.isFinite(ms(x.lastAtUtc))))))
   throw Error('m8_invalid_history');
 const suppressed=new Set([...suppressedIds,...correctedIds]);
 const known=new Map();
 for(const entry of sources){
  const r=sourceEnvelope(entry,s);if(!r||suppressed.has(r.recordId)||ms(r.when)>now+1000)continue;
  if(known.has(r.recordId))throw Error('m8_duplicate_source');
  known.set(r.recordId,r);
 }
 const activeMemories=new Map();
 for(const row of memories){
  if(row?.committed!==true||row?.sourceVerified!==true||!sameScope(row,s)||
     !isUuid(row.memoryId)||suppressed.has(row.memoryId)||
     !Array.isArray(row.evidenceRecordIds)||row.evidenceRecordIds.length<1||
     row.evidenceRecordIds.length>64||!row.evidenceRecordIds.every(id=>known.has(id)))continue;
  // Cross-avatar readers must return one committed identity per memory, not
  // three divergent copies that silently overwrite one another in this map.
  if(activeMemories.has(row.memoryId))throw Error('m8_duplicate_memory');
  activeMemories.set(row.memoryId,frozen({...row,evidenceRecordIds:ordered(row.evidenceRecordIds)}));
 }
 const approvedAppraisals=new Map();
 for(const a of appraisals){
  const m=activeMemories.get(a?.proposalId);
  if(!m||a.epistemicStatus!=='character_opinion'||a.verifiedWorldFact!==false||
     !sameScope(a,s)||
     !Array.isArray(a.sourceEvidenceIds)||
     JSON.stringify(ordered(a.sourceEvidenceIds))!==JSON.stringify(m.evidenceRecordIds)||
     !CATEGORIES.has(a.category)||!Number.isFinite(a.notability)||a.notability<0||a.notability>1)continue;
  approvedAppraisals.set(m.memoryId,a);
 }
 const rows=[...known.values()].sort((a,b)=>ms(a.when)-ms(b.when)||a.recordId.localeCompare(b.recordId));
 const facts=rows.slice(-24).map(r=>frozen({recordId:r.recordId,sourceKind:r.kind,
   mode:r.kind==='dialogue_line'?'exact_quote':r.claims.some(c=>c.certainty==='reported'||c.modality==='report')?'reported_claim':'observed_fact',
   content:r.kind==='dialogue_line'?r.content:factDigest(r),freshness:freshness(r.when,now)}));
 const interpretations=[],byTheme=new Map();
 let affection=0,trust=0,familiarity=0;
 for(const r of rows){
  const cat=categoryOf(r),feel=cat&&feeling(cat,p);if(!feel)continue;
  const [tone,text,valence]=feel,ids=frozen([r.recordId]);
  const memory=[...activeMemories.values()].find(m=>m.evidenceRecordIds.includes(r.recordId));
  const appraisal=memory&&approvedAppraisals.get(memory.memoryId);
  const confidence=Number((r.kind==='journal_event'?.77:.52).toFixed(2));
  interpretations.push(frozen({id:stableUuid('m8-opinion',s.characterId,s.worldProfileId,s.timelineId,r.recordId),
   kind:cat==='gratitude'?'social_impression':cat==='music'?'affinity':
     cat==='embarrassment'?'embarrassment':cat.includes('joke')||cat==='humor'?'funny_moment':'belief',
   epistemicStatus:'character_opinion',verifiedWorldFact:false,about:'experience',tone,
   opinion:text,confidence,freshness:freshness(r.when,now),valence,
   sourceEvidenceIds:ids,appraisalSource:appraisal?'luna':'deterministic'}));
  if(cat==='gratitude'){affection=Math.min(.25,affection+.04*p.loyalty);trust=Math.min(.2,trust+.02);}
  familiarity=Math.min(.2,familiarity+.012);
  const theme=cat==='crash_joke'?'crash':cat==='humor_quote'?'humor':cat;
  if(['crash','humor'].includes(theme)){
    if(!byTheme.has(theme))byTheme.set(theme,[]);
    byTheme.get(theme).push(r);
  }
 }
 const jokes=[];
 for(const [theme,group] of byTheme){
  const independent=ordered(group.map(x=>x.recordId));
  // Repeated witnessed occurrences OR a witnessed event plus an actual player joke.
  const eventCount=group.filter(r=>r.kind==='journal_event').length;
  const echoed=group.some(r=>r.kind==='dialogue_line'&&categoryOf(r)==='crash_joke')&&eventCount>0;
  if(theme==='crash'&&eventCount<2&&!echoed)continue;
  if(theme==='humor'&&group.length<2)continue;
  const status=independent.length>=3||echoed?'established':'emerging';
  const ageDays=Math.max(0,(now-ms(group.at(-1).when))/86400000);
  jokes.push(frozen({id:stableUuid('m8-joke',s.characterId,s.worldProfileId,s.timelineId,theme),motif:theme,
   epistemicStatus:'character_opinion',verifiedWorldFact:false,
   opinion:theme==='crash'?'I might tease about that crash theme.':'That recurring humor amuses me.',
   state:ageDays>7?'resting':status,confidence:Number((Math.min(.85,.5+.08*independent.length)*Math.exp(-ageDays/30)).toFixed(3)),
   sourceEvidenceIds:frozen(independent),freshness:freshness(group.at(-1).when,now),
   callbackOptInRequired:true}));
 }
 // Long-term scores come from the full authenticated P2 history, not the
 // bounded PS4 context. Suppressed/corrected IDs were excluded at source.
 if(relationshipHistory){
   const tally=new Map(relationshipHistory.categories.map(x=>[x.category,x]));
   const count=key=>tally.get(key)?.count??0;
   affection=Math.min(.25,count('gratitude')*.04*p.loyalty);
   trust=Math.min(.2,count('gratitude')*.02);
   familiarity=Math.min(.2,relationshipHistory.categories.reduce((sum,x)=>sum+x.count,0)*.012);
   jokes.length=0;
   for(const [theme,n] of [
     ['crash',count('crash')+count('crash_joke')],
     ['humor',count('humor')+count('humor_quote')]]){
     const witnesses=theme==='crash'?['crash','crash_joke']:['humor','humor_quote'];
     const echoed=count('crash_joke')>0&&count('crash')>0;
     if(theme==='crash'&&count('crash')<2&&!echoed)continue;
     if(theme==='humor'&&n<2)continue;
     const entries=witnesses.map(k=>tally.get(k)).filter(Boolean);
     const atUtc=entries.map(x=>x.lastAtUtc).filter(Boolean).sort().at(-1);
     if(!atUtc)continue;
     const refs=ordered(entries.flatMap(x=>x.sourceEvidenceIds)).slice(-16);
     const ageDays=Math.max(0,(now-ms(atUtc))/86400000);
     jokes.push(frozen({id:stableUuid('m8-joke',s.characterId,s.worldProfileId,s.timelineId,theme),motif:theme,
       epistemicStatus:'character_opinion',verifiedWorldFact:false,
       opinion:theme==='crash'?'I might tease about that crash theme.':'That recurring humor amuses me.',
       state:ageDays>7?'resting':n>=3||echoed?'established':'emerging',
       confidence:Number((Math.min(.85,.5+.08*n)*Math.exp(-ageDays/30)).toFixed(3)),
       sourceEvidenceIds:frozen(refs),freshness:freshness(atUtc,now),
       callbackOptInRequired:true}));
   }
 }
 const relationshipIds=relationshipHistory
   ?ordered(relationshipHistory.categories.flatMap(x=>x.sourceEvidenceIds)).slice(-32)
   :ordered(interpretations.flatMap(i=>i.sourceEvidenceIds));
 const result={version:1,kind:'m8_typed_projection',...s,
  facts,interpretations:interpretations.slice(-16),jokes:jokes.slice(0,4),
  relationship:{epistemicStatus:'character_opinion',verifiedWorldFact:false,
    dimensions:{trust:Number(trust.toFixed(3)),affection:Number(affection.toFixed(3)),
      familiarity:Number(familiarity.toFixed(3))},
    // Familiarity is affected by every interpreted source, not merely thanks.
    // Preserve all contributing immutable IDs for suppression and audit.
    sourceEvidenceIds:frozen(relationshipIds),
    canonRelationshipUnchanged:true},
  totalBytes:0};
 return trimProjection(result,maxBytes,{preferDurableJokes:relationshipHistory!==null});
}

/** Opt-in candidate ONLY. PS6 Director retains sole callback admission authority. */
export function selectM8JokeCue({projection,scope,jokeState={},cue,nowUtc,
 optIn=false,playerActive=false,combatActive=false,secondsSincePlayerTurn=0,
 lastGlobalCallbackAtUtc=null,actorIdle=false}={}){
 const s=validScope(scope),now=ms(nowUtc);
 if(!projection||!sameScope(projection,s)||
    !Number.isFinite(now)||optIn!==true||actorIdle!==true||playerActive||combatActive||
    secondsSincePlayerTurn<30||cue?.sourceVerified!==true||cue?.kind!=='event_type'||
    (lastGlobalCallbackAtUtc!==null&&(!Number.isFinite(ms(lastGlobalCallbackAtUtc))||
     now-ms(lastGlobalCallbackAtUtc)<GLOBAL_MS)))return null;
 for(const j of projection.jokes??[]){
  if(j.motif!==cue.eventType||j.state==='resting'||j.sourceEvidenceIds.some(id=>!isUuid(id)))continue;
  const state=jokeState[j.id]??{},last=ms(state.lastUsedAtUtc);
  if(state.lastUsedAtUtc!==undefined&&(!Number.isFinite(last)||now<last))continue;
  if(Number.isFinite(last)&&now-last<COOLDOWN_MS)continue;
  if(state.uses!==undefined&&!Array.isArray(state.uses))continue;
  const recent=(state.uses??[]).filter(t=>Number.isFinite(ms(t))&&now-ms(t)>=0&&now-ms(t)<=TWO_HOURS);
  if(recent.length>=5||state.consecutiveNegativeReactions>=2||state.resting===true)continue;
  return frozen({kind:'m8_joke_candidate',...s,jokeId:j.id,motif:j.motif,
    sourceEvidenceIds:j.sourceEvidenceIds,requiresDirectorAuthorization:true});
 }
 return null;
}
/** Called solely on verified, successfully delivered callback (not an attempted one). */
export function recordM8JokeUse(previous={},receipt={}){
 if(receipt.completed!==true||receipt.sourceVerified!==true||!isUuid(receipt.jokeId)||
    !Number.isFinite(ms(receipt.atUtc))||!['engaged','annoyed','ignored','unknown'].includes(receipt.reaction))
    throw Error('m8_unverified_delivery');
 const times=(Array.isArray(previous.uses)?previous.uses:[]).filter(t=>Number.isFinite(ms(t))&&
  ms(receipt.atUtc)-ms(t)<=TWO_HOURS&&ms(receipt.atUtc)>=ms(t)).slice(-4);
 const consecutiveNegativeReactions=['annoyed','ignored'].includes(receipt.reaction)?
  Math.min(2,(previous.consecutiveNegativeReactions??0)+1):
  receipt.reaction==='engaged'?0:(previous.consecutiveNegativeReactions??0);
 times.push(receipt.atUtc);
 return frozen({lastUsedAtUtc:receipt.atUtc,uses:frozen(times),consecutiveNegativeReactions,
  resting:times.length>=5||consecutiveNegativeReactions>=2});
}

/** K supplies serialized P2 read ports; this adapter holds no SQL or daemon. */
export function createM8ReadAdapter({readCommittedSources,readCommittedMemories,
 readSuppressedIds,readCorrectedIds,readCurationAppraisals,currentScope,
 readRelationshipHistory=null}={}){
 if(![readCommittedSources,readCommittedMemories,readSuppressedIds,readCorrectedIds,
  readCurationAppraisals,currentScope].every(f=>typeof f==='function')||
  (readRelationshipHistory!==null&&typeof readRelationshipHistory!=='function'))throw Error('m8_p2_ports_required');
 return frozen({async project({scope,authority,personality,nowUtc,maxBytes}={}){
  const s=validScope(scope);
  const proofKeys=['hostRunId','incarnationId','encounterId','observerCaptureRef'];
  if(authority?.nativeVerified!==true||!proofKeys.every(k=>isUuid(authority[k]))||
   !Number.isSafeInteger(authority.worldEpoch)||authority.worldEpoch<0)return null;
  const isCurrent=()=>{try{const c=currentScope();return !!c&&sameScope(c,s)&&
   c.protagonistKey===s.protagonistKey&&c.timelineWritable===true&&c.nativeVerified===true&&
   c.worldEpoch===authority.worldEpoch&&proofKeys.every(k=>c[k]===authority[k]);}catch{return false;}};
  if(!isCurrent())return null;
  // Revalidate after every await, and again in K at actual PS4 send/retry.
  const reads=[];
  for(const reader of [readCommittedSources,readCommittedMemories,readSuppressedIds,
      readCorrectedIds,readCurationAppraisals]){
   const value=await reader(s);if(!isCurrent())return null;reads.push(value);
  }
  const [sources,memories,suppressedIds,correctedIds,appraisals]=reads;
  const relationshipHistory=readRelationshipHistory?await readRelationshipHistory(s):null;
  if(!isCurrent())return null;
  return evaluateM8({scope:s,personality,sources,memories,suppressedIds,
   correctedIds,appraisals,relationshipHistory,nowUtc,maxBytes});
 }});
}

// W05 sole-PS4 seam: interpretation is an optional, current P2 projection,
// not another fact store, prompt writer or independently authorized callback.
const W05_STAMP_KEYS=['characterId','worldProfileId','timelineId','protagonistKey',
 'hostRunId','worldEpoch','incarnationId','encounterId','observerCaptureRef',
 'turnIdentityHash','turnId'];
const W05_SHA=/^[0-9a-f]{64}$/;
const w05Stamp=x=>Object.freeze(Object.fromEntries(W05_STAMP_KEYS.map(k=>[k,x?.[k]])));
const w05Same=(a,b)=>!!a&&!!b&&W05_STAMP_KEYS.every(k=>a[k]===b[k]);
const w05Current=fn=>{try{const v=fn();return v?.nativeVerified===true&&v.timelineWritable===true?v:null;}catch{return null;}};
const w05Drop=reason=>Object.freeze({status:'dropped',reason,projection:null,stamp:null});
export async function preparePs4M8({scope,authority,personality,readAdapter,
 currentIdentity,nowUtc=new Date().toISOString(),maxBytes=4096,deadlineMs=200}={}){
 if(!Number.isSafeInteger(deadlineMs)||deadlineMs<1||deadlineMs>200||
    !Number.isSafeInteger(maxBytes)||maxBytes<512||maxBytes>8192)
  throw new TypeError('m8_invalid_ps4_limits');
 if(typeof readAdapter?.project!=='function'||typeof currentIdentity!=='function'||
    authority?.nativeVerified!==true||!scope||
    scope.protagonistKey==='unknown'||!['franklin','michael','trevor'].includes(scope.protagonistKey)||
    !['characterId','worldProfileId','timelineId'].every(k=>isUuid(scope[k])&&authority[k]===scope[k])||
    !['hostRunId','incarnationId','encounterId','observerCaptureRef','turnId'].every(k=>isUuid(authority[k]))||
    !W05_SHA.test(authority.turnIdentityHash)||
    !Number.isSafeInteger(authority.worldEpoch)||authority.worldEpoch<0)
  return w05Drop('unverified_original_owner');
 const stamp=w05Stamp(authority);
 if(!w05Same(stamp,w05Current(currentIdentity)))return w05Drop('stale_before_read');
 const started=performance.now();
 let timer;
 const timeout=new Promise(resolve=>{timer=setTimeout(()=>resolve(null),deadlineMs);});
 let projection;
 try{projection=await Promise.race([readAdapter.project({scope,authority,personality,nowUtc,maxBytes}),timeout]);}
 catch{return w05Drop('p2_projection_unavailable');}
 finally{clearTimeout(timer);}
 if(!projection||performance.now()-started>deadlineMs)return w05Drop('unavailable_or_deadline');
 if(!w05Same(stamp,w05Current(currentIdentity)))return w05Drop('stale_after_read');
 if(projection.version!==1||projection.kind!=='m8_typed_projection'||
    !sameScope(projection,scope)||projection.protagonistKey!==scope.protagonistKey||
    projection.totalBytes!==Buffer.byteLength(JSON.stringify(projection),'utf8')||
    projection.totalBytes>maxBytes)return w05Drop('invalid_p2_projection');
 return Object.freeze({status:'ready',reason:null,stamp,projection});
}
export function verifyPs4M8Current(prepared,{currentIdentity,validateEvidence}={}){
 if(prepared?.status!=='ready'||typeof currentIdentity!=='function'||
    !w05Same(prepared.stamp,w05Current(currentIdentity))||
    typeof validateEvidence!=='function')return false;
 const all=[...(prepared.projection?.interpretations??[]),
   ...(prepared.projection?.jokes??[]),prepared.projection?.relationship];
 const ids=[...new Set(all.flatMap(item=>item?.sourceEvidenceIds??[]))];
 if(!ids.length||!ids.every(isUuid))return false;
 try{
  // Must be an authoritative SYNC P2 correction/tombstone/source readback.
  // Promise or unknown cannot authorize a stale frame.
  return validateEvidence(ids,prepared.stamp)===true;
 }catch{return false;}
}
