// Agent E: deterministic, offline M6 scene selection. Journal capture is NEVER gated by this module.
import { stableUuid, normalizedEvidence, sameScope, factDigest, frozenEvidenceIds, scopeOf } from './evidence.mjs';
const windowMs=90_000;
const priority=[
  [/inside_?joke|running_?joke|prank|laugh|funny|humor|joke/i,.92,'joke'],
  [/crash|rollover|flip|airborne|explosion|stunt|water|fall|launch|wasted|busted/i,.87,'episode'],
  [/embarrass|fail|blunder|misfire|accident|ridiculous|strange|bizarre/i,.84,'episode'],
  [/resc(u|ue)|saved|help|protect|betray|bond|gift|promise|friend|relationship/i,.77,'relationship'],
  [/wanted|chase|fight|escape|arrest|police|gunfire/i,.69,'episode'],
  [/travel|mission|drive|arriv|depart|greet/i,.43,'episode'],
];
const salientSpeech=/\b(remember when|inside joke|never forget|so embarrassing|hilarious|that was funny|i promise|i love you|you saved me|we did it|ridiculous)\b/i;
function recordSignal(record){
  if(record.kind==='journal_event'){
    const source=[record.eventType,...record.claims.map(c=>c.kind)].join(' ');
    const hit=priority.find(([re])=>re.test(source));
    return {score:hit?.[1]??.28,candidate:hit?.[2]??'episode',
      signature:record.eventType.toLowerCase()+':'+record.claims.map(c=>c.durableSubject.toLowerCase()).sort().join(',')};
  }
  return {score:record.speaker==='player'&&salientSpeech.test(record.content)? .73:.16,
    candidate:record.speaker==='player'&&/inside joke|hilarious|that was funny/i.test(record.content)?'joke':'semantic',
    signature:record.speaker+':'+record.content.toLowerCase().trim().replace(/\s+/g,' ').slice(0,120)};
}
function groupRecords(records){
  const sorted=[...new Map(records.map(r=>[r.recordId,r])).values()].sort((a,b)=>
    Date.parse(a.when)-Date.parse(b.when)||a.recordId.localeCompare(b.recordId));
  const scenes=[];
  for(const r of sorted){
    const prev=scenes.at(-1),last=prev?.at(-1);
    const linked=last&&sameScope(r,last)&&Date.parse(r.when)-Date.parse(last.when)<=windowMs&&
      (r.sceneId===last.sceneId||!r.sceneId&&!last.sceneId)&&(r.epoch===null||last.epoch===null||r.epoch===last.epoch)&&prev.length<64;
    if(linked)prev.push(r);else scenes.push([r]);
  }
  return scenes;
}
function sceneScore(scene){
  const signals=scene.map(recordSignal).sort((a,b)=>b.score-a.score);
  const best=signals[0];
  return {score:Math.min(1,Number((best.score+Math.min(.1,Math.log2(scene.length)*.034)).toFixed(3))),
    candidate:best.candidate,signature:signals.map(s=>s.signature).sort().join('|').slice(0,500)};
}
export function selectAutomaticMemories(rawRecords,{existingInHour=0,softTargetPerHour=6,batchId=null,minScore=.56}={}){
  if(!Array.isArray(rawRecords)||rawRecords.length>10000)throw new Error('curation_batch_limit');
  if(!Number.isSafeInteger(existingInHour)||existingInHour<0||!Number.isSafeInteger(softTargetPerHour)||softTargetPerHour<1)
    throw new Error('curation_invalid_budget');
  const qualified=[];
  for(const row of rawRecords){
    try{qualified.push(normalizedEvidence(row));}catch{/* Unqualified input is never promoted. */ }
  }
  // A bounded adaptive threshold reduces mundane selection, but cannot cap exceptional scenes.
  const pressure=Math.min(.26,Math.max(0,existingInHour-softTargetPerHour)*.04);
  const threshold=Math.min(.84,minScore+pressure);
  return groupRecords(qualified).flatMap(scene=>{
    const {score,candidate,signature}=sceneScore(scene);
    if(score<threshold&&score<.86)return [];
    const scope=scopeOf(scene[0]),ids=frozenEvidenceIds(scene);
    const significant=[...scene].sort((a,b)=>recordSignal(b).score-recordSignal(a).score||
      a.recordId.localeCompare(b.recordId));
    const summary=significant.slice(0,4).map(factDigest).join(' ').slice(0,2400);
    const key=['auto-memory-v1',...Object.values(scope),ids];
    const sceneBatch=batchId??stableUuid('m6-batch',...key);
    if(!/^[0-9a-f-]{36}$/i.test(sceneBatch))throw new Error('curation_invalid_batch');
    return [Object.freeze({...scope,kind:'curation_proposal',version:1,
      proposalId:stableUuid(...key),provider:'deterministic',evidenceRecordIds:ids,
      candidate,notability:score,groundedSummary:summary,inCharacterTake:'No interpretation recorded.',
      batchId:sceneBatch})];
  });
}
