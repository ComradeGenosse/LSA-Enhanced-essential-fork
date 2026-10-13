import { radioTurnRelevant,renderRadioContext } from '../perception/radioContextProjector.mjs';
import { validateObservation,validateClaim } from '../perception/contracts.mjs';
import { orderSalienceDecisions,SALIENCE_POLICY_VERSION,REASON_CODES } from '../perception/salienceEngine.mjs';
import { immutableSnapshot } from './turnSnapshot.mjs';
export const KNOWLEDGE_LIMITS=Object.freeze({poolCount:128,poolBytes:256*1024,observations:8,perceivedBytes:8*1024,safetyReserveBytes:2*1024,canonBytes:16*1024,historyBytes:8*1024,currentBytes:72*1024,converseBytes:80*1024,situationBytes:1024,compatBytes:4*1024,frameBytes:112*1024,instructionBytes:16*1024,requestBytes:160*1024});
export const jsonBytes=value=>Buffer.byteLength(JSON.stringify(value),'utf8');
const subject=(ref,observer)=>ref?.captureRef===observer?'self':ref?.kind==='vehicle'?'anonymous vehicle':'anonymous person';
export function projectKnowledgeClaim(claim,observation,observer,radioCurrentlyPlaying=true) {
  if(!validateClaim(claim)) return null;
  const modality=claim.evidence.channel;if(!['self','visual','auditory'].includes(modality)) return null;
  const common={modality,certainty:claim.certainty};
  if(claim.kind==='injured' && (modality==='visual' && claim.target || modality==='self' && claim.target?.captureRef===observer)) return {...common,kind:'injured',subject:subject(claim.target,observer)};
  if(claim.kind==='dead' && modality==='visual' && claim.target) return {...common,kind:'dead',subject:subject(claim.target,observer)};
  if(claim.kind==='firing' && modality==='visual' && claim.source) return {...common,kind:'firing',subject:subject(claim.source,observer)};
  if(claim.kind==='firing' && modality==='self' && claim.source?.captureRef===observer) return {...common,kind:'firing',subject:'self'};
  if(modality==='auditory' && observation.eventType==='speech_heard' && claim.kind==='sound')
    return {...common,kind:'overheard_speech_presence',origin:'unidentified_player_voice'};
  if(modality==='auditory' && observation.eventType==='firing_burst' && ['sound','firing'].includes(claim.kind)) return {...common,kind:'gunfire_sound',origin:claim.source?subject(claim.source,observer):'unidentified'};
  if(claim.kind==='sound' && modality==='auditory' && observation.eventType==='radio_heard' && claim.details?.soundType==='radio') {
    const rendered=renderRadioContext(observation,{currentlyPlaying:radioCurrentlyPlaying});
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
  const radioRequested=radioTurnRelevant(radioInput);
  const observer=inputs.association.captureRef,counts=new Map();for(const pair of inputs.pairs) counts.set(pair?.observation?.observationId,(counts.get(pair?.observation?.observationId)||0)+1);
  const valid=[];
  for(const pair of inputs.pairs) {
    const o=pair?.observation,d=pair?.decision;
    // Only an explicit player radio question may select a frozen radio fact.
    if(o?.eventType==='radio_heard' && !radioRequested) continue;
    if(!validateObservation(o) || o.observer.captureRef!==observer || o.observedAt.nativeRun!==inputs.psAdapterEpoch || o.expiresAtMonotonicMs<=inputs.frozenAt || !o.claims.every(claim=>[claim.source,claim.target].every(ref=>!ref || inputs.liveReferences?.[ref.captureRef]===ref.kind) && (!claim.details?.vehicle || inputs.liveReferences?.[claim.details.vehicle]==='vehicle')) || counts.get(o.observationId)!==1) {omissions.revision_mismatch++;continue;}
    if(!pair.situation || !Array.isArray(pair.situation.traitPolicies) || !validDecision(d) || d.observationId!==o.observationId || d.revision!==o.revision || d.policyVersion!==SALIENCE_POLICY_VERSION || typeof d.decisionKey!=='string' || !d.decisionKey.startsWith(`${o.observationId}:${o.revision}:${SALIENCE_POLICY_VERSION}:`) || !/^\d+:[0-9a-f]{8}$/.test(d.decisionKey.slice(`${o.observationId}:${o.revision}:${SALIENCE_POLICY_VERSION}:`.length)) || d.expiresAtMonotonicMs<=inputs.frozenAt || !['candidate','must_include','omit'].includes(d.context)) {omissions.no_matching_salience++;continue;}
    if(d.context!=='omit') valid.push(pair);
  }
  // Keep only the most recent independently witnessed radio event per turn.
  // Never mix the previous station/song with the currently heard one.
  const radioPairs=valid.filter(pair=>pair.observation.eventType==='radio_heard');
  const currentEpisodes=new Set(inputs.radioCurrentEpisodeIds||[]);
  const newestRadio=radioPairs.sort((a,b)=>
    Number(currentEpisodes.has(b.observation.episodeId))-Number(currentEpisodes.has(a.observation.episodeId)) ||
    b.observation.observedAt.gameTick-a.observation.observedAt.gameTick)[0];
  const scoped=radioRequested && newestRadio ? valid.filter(pair=>
    pair.observation.eventType!=='radio_heard' || pair===newestRadio) : valid;
  // Answer a direct radio question before unrelated routine context without
  // displacing mandatory safety, danger/critical, or speech-eligible evidence.
  // Run this before the bounded pool; all existing validity gates still apply.
  const ranked=orderSalienceDecisions(scoped);
  const protectedContext=pair=>pair.decision.context==='must_include' ||
    pair.decision.response!=='none' || ['danger','critical'].includes(pair.observation.severity);
  const prioritized=radioRequested ? [
    ...ranked.filter(protectedContext),
    ...ranked.filter(pair=>!protectedContext(pair) && pair.observation.eventType==='radio_heard'),
    ...ranked.filter(pair=>!protectedContext(pair) && pair.observation.eventType!=='radio_heard'),
  ] : ranked;
  let poolBytes=0;const ordered=prioritized.filter((pair,index)=>{
    const bytes=jsonBytes(pair);if(index>=KNOWLEDGE_LIMITS.poolCount || poolBytes+bytes>KNOWLEDGE_LIMITS.poolBytes) {omissions.budget_excluded++;return false;}poolBytes+=bytes;return true;
  });
  for(const pair of [...ordered.filter(p=>p.decision.context==='must_include'),...ordered.filter(p=>p.decision.context!=='must_include')]) {
    const o=pair.observation;
    const radioCurrentlyPlaying=inputs.radioCurrentEpisodeIds===undefined ||
      inputs.radioCurrentEpisodeIds.includes(pair.observation.episodeId);
    const claims=pair.observation.claims.map(claim=>projectKnowledgeClaim(claim,pair.observation,observer,radioCurrentlyPlaying)).filter(Boolean);
    // A source-time full-coverage per-observer grant is required for quoted
    // words. Presence-only reports never borrow the current actor's input.
    const words=inputs.speechEvidence?.[o.observationId];
    if(o.eventType==='speech_heard' && typeof words==='string' &&
       words.trim() && words.length<=512 &&
       claims.some(c=>c.kind==='overheard_speech_presence')) {
      claims.push({kind:'overheard_player_words',modality:'auditory',
        certainty:'supported',asReportedSpeech:true,text:words.toWellFormed()});
    }
    omissions.unsupported_claim_detail+=Math.max(0,pair.observation.claims.length-claims.length);if(!claims.length) continue;
    const item={event:pair.observation.eventType,claims,freshness:'recent'};
    const safety=pair.decision.context==='must_include',bytes=jsonBytes({observations:[...result.observations,item]}),limit=KNOWLEDGE_LIMITS.perceivedBytes-(safety?0:result.safetyBudget.remainingBytes);
    if(result.observations.length>=KNOWLEDGE_LIMITS.observations || bytes>limit) {omissions.budget_excluded++;if(pair.decision.context==='must_include') omissions.safety_overflow++;continue;}
    if(safety){result.safetyBudget.usedBytes+=bytes-jsonBytes({observations:result.observations});result.safetyBudget.remainingBytes=Math.max(0,KNOWLEDGE_LIMITS.safetyReserveBytes-result.safetyBudget.usedBytes);}
    result.observations.push(item);result.selected.push({observationId:pair.observation.observationId,revision:pair.observation.revision,decisionKey:pair.decision.decisionKey});
  }
  return immutableSnapshot(result);
}
