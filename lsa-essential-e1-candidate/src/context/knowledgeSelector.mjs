import { radioTurnRelevant,renderRadioContext } from '../perception/radioContextProjector.mjs';
import { validateObservation,validateClaim } from '../perception/contracts.mjs';
import { orderSalienceDecisions,SALIENCE_POLICY_VERSION,REASON_CODES } from '../perception/salienceEngine.mjs';
import { immutableSnapshot } from './turnSnapshot.mjs';
export const KNOWLEDGE_LIMITS=Object.freeze({poolCount:128,poolBytes:256*1024,observations:8,perceivedBytes:8*1024,safetyReserveBytes:2*1024,canonBytes:16*1024,historyBytes:8*1024,currentBytes:72*1024,converseBytes:80*1024,situationBytes:1024,compatBytes:4*1024,frameBytes:112*1024,instructionBytes:16*1024,requestBytes:160*1024});
export const jsonBytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const subject=(ref,observer)=>ref?.captureRef===observer?'self':ref?.kind==='vehicle'?'anonymous vehicle':'anonymous person';
export function projectKnowledgeClaim(claim,observation,observer) {
  if(!validateClaim(claim)) return null;
  const modality=claim.evidence.channel;if(!['self','visual','auditory'].includes(modality)) return null;
  const common={modality,certainty:claim.certainty};
  if(claim.kind==='injured' && (modality==='visual' && claim.target || modality==='self' && claim.target?.captureRef===observer)) return {...common,kind:'injured',subject:subject(claim.target,observer)};
  if(claim.kind==='dead' && modality==='visual' && claim.target) return {...common,kind:'dead',subject:subject(claim.target,observer)};
  if(claim.kind==='firing' && modality==='visual' && claim.source) return {...common,kind:'firing',subject:subject(claim.source,observer)};
  if(claim.kind==='firing' && modality==='self' && claim.source?.captureRef===observer) return {...common,kind:'firing',subject:'self'};
  if(modality==='auditory' && observation.eventType==='firing_burst' && ['sound','firing'].includes(claim.kind)) return {...common,kind:'gunfire_sound',origin:claim.source?subject(claim.source,observer):'unidentified'};
  if(claim.kind==='sound' && modality==='auditory' && observation.eventType==='radio_heard' && claim.details?.soundType==='radio') {
    const rendered=renderRadioContext(observation);
    return rendered?{...common,kind:'audible_radio',description:rendered}:null;
  }
  const detail=claim.details;
  if(modality==='self' && claim.target?.captureRef===observer && detail) {
    if(claim.kind==='action' && ['followtarget','waithere'].includes(detail.action)) return {...common,kind:'handler_outcome',action:detail.action==='followtarget'?'follow request':'wait request',outcome:detail.succeeded?'accepted':'failed',physicalCompletion:'unknown'};
    if(claim.kind==='location' && detail.location) return {...common,kind:'sampled_location',location:detail.location};
    if(claim.kind==='presence' && detail.activity) return {...common,kind:'sampled_activity',activity:detail.activity};
    if(claim.kind==='presence' && Object.hasOwn(detail,'vehicle')) return {...common,kind:'sampled_vehicle',state:detail.vehicle===null?'out_of_vehicle':'in_vehicle',...(detail.driver===true?{role:'driver'}:{})};
  }
  if(claim.kind==='presence' && observation.eventType==='character_present' && modality==='visual' && claim.target) return {...common,kind:'presence',subject:subject(claim.target,observer)};
  return null;
}

const decisionFields=['observationId','revision','decisionKey','policyVersion','context','memory','response','reasons','expiresAtMonotonicMs'];
function validDecision(d) {
  return d && decisionFields.every(key=>Object.hasOwn(d,key)) && Object.keys(d).every(key=>decisionFields.includes(key)) &&
    ['none','stage'].includes(d.memory) && ['none','eligible','urgent'].includes(d.response) &&
    Array.isArray(d.reasons) && d.reasons.length<=4 && new Set(d.reasons).size===d.reasons.length && d.reasons.every(reason=>REASON_CODES.includes(reason)) &&
    Number.isSafeInteger(d.expiresAtMonotonicMs);
}
export function selectKnowledge(inputs,{includePerceived=true,radioInput=''}={}) {
  const omissions={unsupported_claim_detail:0,revision_mismatch:0,no_matching_salience:0,budget_excluded:0,safety_overflow:0};
  const result={observations:[],selected:[],omissions,safetyBudget:{reservedBytes:KNOWLEDGE_LIMITS.safetyReserveBytes,usedBytes:0,remainingBytes:KNOWLEDGE_LIMITS.safetyReserveBytes}};
  if(!includePerceived || inputs?.ownerPendingProof || inputs?.reason || !inputs?.association || !Array.isArray(inputs.pairs)) return immutableSnapshot(result);
  const observer=inputs.association.captureRef,counts=new Map();for(const pair of inputs.pairs) counts.set(pair?.observation?.observationId,(counts.get(pair?.observation?.observationId)||0)+1);
  const valid=[];
  for(const pair of inputs.pairs) {
    const o=pair?.observation,d=pair?.decision;
    // Only an explicit player radio question may select a frozen radio fact.
    if(o?.eventType==='radio_heard' && !radioTurnRelevant(radioInput)) continue;
    if(!validateObservation(o) || o.observer.captureRef!==observer || o.observedAt.nativeRun!==inputs.psAdapterEpoch || o.expiresAtMonotonicMs<=inputs.frozenAt || !o.claims.every(claim=>[claim.source,claim.target].every(ref=>!ref || inputs.liveReferences?.[ref.captureRef]===ref.kind) && (!claim.details?.vehicle || inputs.liveReferences?.[claim.details.vehicle]==='vehicle')) || counts.get(o.observationId)!==1) {omissions.revision_mismatch++;continue;}
    if(!pair.situation || !Array.isArray(pair.situation.traitPolicies) || !validDecision(d) || d.observationId!==o.observationId || d.revision!==o.revision || d.policyVersion!==SALIENCE_POLICY_VERSION || typeof d.decisionKey!=='string' || !d.decisionKey.startsWith(`${o.observationId}:${o.revision}:${SALIENCE_POLICY_VERSION}:`) || !/^\d+:[0-9a-f]{8}$/.test(d.decisionKey.slice(`${o.observationId}:${o.revision}:${SALIENCE_POLICY_VERSION}:`.length)) || d.expiresAtMonotonicMs<=inputs.frozenAt || !['candidate','must_include','omit'].includes(d.context)) {omissions.no_matching_salience++;continue;}
    if(d.context!=='omit') valid.push(pair);
  }
  let poolBytes=0;const ordered=orderSalienceDecisions(valid).filter((pair,index)=>{
    const bytes=jsonBytes(pair);if(index>=KNOWLEDGE_LIMITS.poolCount || poolBytes+bytes>KNOWLEDGE_LIMITS.poolBytes) {omissions.budget_excluded++;return false;}poolBytes+=bytes;return true;
  });
  for(const pair of [...ordered.filter(p=>p.decision.context==='must_include'),...ordered.filter(p=>p.decision.context!=='must_include')]) {
    const claims=pair.observation.claims.map(claim=>projectKnowledgeClaim(claim,pair.observation,observer)).filter(Boolean);
    omissions.unsupported_claim_detail+=pair.observation.claims.length-claims.length;if(!claims.length) continue;
    const item={event:pair.observation.eventType,claims,freshness:'recent'};
    const safety=pair.decision.context==='must_include',bytes=jsonBytes({observations:[...result.observations,item]}),limit=KNOWLEDGE_LIMITS.perceivedBytes-(safety?0:result.safetyBudget.remainingBytes);
    if(result.observations.length>=KNOWLEDGE_LIMITS.observations || bytes>limit) {omissions.budget_excluded++;if(pair.decision.context==='must_include') omissions.safety_overflow++;continue;}
    if(safety){result.safetyBudget.usedBytes+=bytes-jsonBytes({observations:result.observations});result.safetyBudget.remainingBytes=Math.max(0,KNOWLEDGE_LIMITS.safetyReserveBytes-result.safetyBudget.usedBytes);}
    result.observations.push(item);result.selected.push({observationId:pair.observation.observationId,revision:pair.observation.revision,decisionKey:pair.decision.decisionKey});
  }
  return immutableSnapshot(result);
}

/** Strictly optional M4 evidence from a preflight source-fenced preparation. */
export function projectPreparedRecall(prepared,{maxBytes=4096}={}){
 const out={evidence:[],earlierArchivedConversation:[],references:[],dropped:0};
 const contribution=prepared?.status==='ready'?prepared.contribution:null;
 if(contribution?.contributor!=='m4_recall'||contribution.lane!=='RECALLED'||
   contribution.status!=='matched'||!Array.isArray(contribution.items)||
   contribution.items.length>32||!Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>14336)return out;
 const valid=item=>item&&typeof item==='object'&&
  Object.keys(item).sort().join(',')==='content,freshness,mode,recordId,sourceKind'&&
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(item.recordId)&&
  ['journal_event','dialogue_line','permanent_memory','canon'].includes(item.sourceKind)&&
  ['exact_quote','observed_fact','reported_claim','opinion'].includes(item.mode)&&
  ['live','recent','archive','permanent'].includes(item.freshness)&&
  typeof item.content==='string'&&[...item.content].length>=1&&[...item.content].length<=3072&&
  item.content===item.content.toWellFormed();
 const seen=new Set();
 for(const item of contribution.items){
  if(!valid(item)||seen.has(item.recordId)){out.dropped++;continue;}
  seen.add(item.recordId);
  const section=item.sourceKind==='dialogue_line'&&item.freshness==='archive'?'earlierArchivedConversation':'evidence';
  if(jsonBytes({evidence:out.evidence,earlierArchivedConversation:out.earlierArchivedConversation,
   [section]:[...out[section],item]})>maxBytes){out.dropped++;continue;}
  out[section].push({...item});
  out.references.push({recordId:item.recordId,sourceKind:item.sourceKind,mode:item.mode,freshness:item.freshness,section});
 }
 return out;
}


// W05: M8 contributes attributed interpretation ONLY to the original PS4
// RECALLED lane. Facts[] deliberately remain M4's sole retrieval authority.
// This is projection, never a new prompt or a second model writer.
export function projectPreparedM8(prepared,{maxBytes=4096}={}){
 const empty=()=>({characterOpinions:[],runningJokes:[],relationshipInterpretation:null,references:[],dropped:0});
 const out=empty(),p=prepared?.status==='ready'?prepared.projection:null;
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
 const ids=a=>Array.isArray(a)&&a.length>0&&a.length<=64&&new Set(a).size===a.length&&a.every(x=>uuid.test(x));
 const opinionText=v=>typeof v==='string'&&v.length>0&&[...v].length<=360&&v===v.toWellFormed()&&!/[\u0000-\u001f\u007f]/u.test(v);
 if(!p||p.version!==1||p.kind!=='m8_typed_projection'||
  !['characterId','worldProfileId','timelineId'].every(k=>uuid.test(p[k])&&p[k]===prepared.stamp?.[k])||
  p.protagonistKey!==prepared.stamp?.protagonistKey||
  !Number.isSafeInteger(p.totalBytes)||p.totalBytes!==jsonBytes(p)||p.totalBytes>8192||
  !Number.isSafeInteger(maxBytes)||maxBytes<0||maxBytes>8192||
  !Array.isArray(p.interpretations)||p.interpretations.length>16||
  !Array.isArray(p.jokes)||p.jokes.length>4)return out;
 const within=()=>jsonBytes({characterOpinions:out.characterOpinions,
   runningJokes:out.runningJokes,relationshipInterpretation:out.relationshipInterpretation})<=maxBytes;
 const put=(section,item,ref)=>{
   out[section].push(item);
   if(!within()){out[section].pop();out.dropped++;return;}
   out.references.push(ref);
 };
 const used=new Set();
 // Stable deterministic order; source IDs are never represented as fresh facts.
 for(const i of [...p.interpretations].sort((a,b)=>String(a?.id).localeCompare(String(b?.id)))){
  if(!uuid.test(i?.id)||used.has(i.id)||i.epistemicStatus!=='character_opinion'||
     i.verifiedWorldFact!==false||!ids(i.sourceEvidenceIds)||!opinionText(i.opinion)||
     typeof i.tone!=='string'||i.tone.length>48||
     !Number.isFinite(i.confidence)||i.confidence<0||i.confidence>1||
     !['live','recent','archive','permanent'].includes(i.freshness)){out.dropped++;continue;}
  used.add(i.id);
  put('characterOpinions',{id:i.id,epistemicStatus:'character_opinion',
    verifiedWorldFact:false,opinion:i.opinion,tone:i.tone,confidence:i.confidence,
    sourceEvidenceIds:[...i.sourceEvidenceIds]},
    {entryId:i.id,section:'characterOpinions',sourceEvidenceIds:[...i.sourceEvidenceIds]});
 }
 for(const j of [...p.jokes].sort((a,b)=>String(a?.id).localeCompare(String(b?.id)))){
  if(!uuid.test(j?.id)||used.has(j.id)||j.epistemicStatus!=='character_opinion'||
    j.verifiedWorldFact!==false||j.callbackOptInRequired!==true||
    !ids(j.sourceEvidenceIds)||!opinionText(j.opinion)||
    !['emerging','established','resting'].includes(j.state)){out.dropped++;continue;}
  used.add(j.id);
  put('runningJokes',{id:j.id,epistemicStatus:'character_opinion',
    verifiedWorldFact:false,opinion:j.opinion,state:j.state,
    sourceEvidenceIds:[...j.sourceEvidenceIds],spontaneousSpeechAuthorized:false},
    {entryId:j.id,section:'runningJokes',sourceEvidenceIds:[...j.sourceEvidenceIds]});
 }
 const r=p.relationship;
 if(r?.epistemicStatus==='character_opinion'&&r.verifiedWorldFact===false&&
   r.canonRelationshipUnchanged===true&&ids(r.sourceEvidenceIds)&&
   ['trust','affection','familiarity'].every(k=>Number.isFinite(r.dimensions?.[k])&&
     r.dimensions[k]>=-1&&r.dimensions[k]<=1)){
  const value={epistemicStatus:'character_opinion',verifiedWorldFact:false,
    canonRelationshipUnchanged:true,dimensions:{trust:r.dimensions.trust,
      affection:r.dimensions.affection,familiarity:r.dimensions.familiarity},
    sourceEvidenceIds:[...r.sourceEvidenceIds]};
  out.relationshipInterpretation=value;
  if(within())out.references.push({entryId:'relationship',section:'relationshipInterpretation',
    sourceEvidenceIds:[...r.sourceEvidenceIds]});
  else {out.relationshipInterpretation=null;out.dropped++;}
 }
 return out;
}
