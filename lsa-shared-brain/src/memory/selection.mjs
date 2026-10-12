// Deterministic selection runs only over committed M2/M3 journal evidence.
// Rejections are diagnostics, never a reason to delete or suppress source rows.
import {stableUuid,isUuid,normalizedEvidence,sameScope,factDigest,frozenEvidenceIds,scopeOf} from './evidence.mjs';

const SCENE_GAP_MS=90_000;
const eventRules=[
  [/inside_?joke|running_?joke|prank|laug(h|hing)|funny|humor|joke|comic/i,.94,'joke'],
  [/bizarre|absurd|ridiculous|embarrass|blunder|fail|misfire|fumbled/i,.89,'episode'],
  [/crash|rollover|flip|airborne|explosion|stunt|water|fall|launch|wasted|busted|collision/i,.87,'episode'],
  [/resc(u|ue)|saved|help|protect|betray|bond|gift|promise|friend|relationship|reunion/i,.79,'relationship'],
  [/wanted|chase|fight|escape|arrest|police|gunfire|shootout/i,.69,'episode'],
  [/travel|mission|drive|arriv|depart|greet|walking/i,.40,'episode'],
];
const speechRules=[
  [/inside joke|running joke|remember when|prank|hilarious|that was funny|laugh|jok(e|ing)/i,.91,'joke'],
  [/so embarrassing|embarrass|i messed up|my bad|ridiculous|what a disaster|i failed|that was weird/i,.85,'episode'],
  [/i promise|you saved me|i love you|i trust you|you betrayed me|best friend|never forget|we did it/i,.79,'relationship'],
  [/that was crazy|unbelievable|what just happened|what a stunt/i,.72,'episode'],
];
function signal(r){
  if(r.kind==='journal_event'){
    // Direct claims and reported claims remain explicitly different in the digest.
    const words=[r.eventType,...r.claims.map(c=>c.kind)].join(' ');
    const found=eventRules.find(([re])=>re.test(words));
    return {score:found?.[1]??.27,candidate:found?.[2]??'episode'};
  }
  const found=speechRules.find(([re])=>re.test(r.content));
  return {score:r.speaker==='player'?(found?.[1]??.12):(found?.[1]??.12)*.89,
    candidate:found?.[2]??'semantic'};
}
function contiguous(a,b){
  if(!sameScope(a,b))return false;
  const dt=Date.parse(b.when)-Date.parse(a.when);
  if(dt<0||dt>SCENE_GAP_MS)return false;
  // Missing epochs/lifetimes are not evidence that distinct proven epochs match.
  if(a.epoch!==null&&b.epoch!==null&&a.epoch!==b.epoch)return false;
  if(a.ownerLifetime&&b.ownerLifetime&&a.ownerLifetime!==b.ownerLifetime)return false;
  if(a.sceneId||b.sceneId)return a.sceneId!==null&&a.sceneId===b.sceneId;
  return true;
}
export function groupQualifiedScenes(records){
  const sorted=[...records].sort((a,b)=>Date.parse(a.when)-Date.parse(b.when)||
    a.recordId.localeCompare(b.recordId));
  const scenes=[],activeByOwner=new Map();
  for(const record of sorted){
    // Protagonist switches do not split the same player's bounded, proven scene.
    // Native epochs, NPC owner lifetime and scene IDs still fence grouping.
    const key=[record.worldProfileId,record.timelineId,record.characterId].join(':');
    const prior=activeByOwner.get(key),last=prior?.at(-1);
    if(prior&&prior.length<64&&contiguous(last,record))prior.push(record);
    else {
      const scene=[record];scenes.push(scene);activeByOwner.set(key,scene);
    }
  }
  return scenes.sort((a,b)=>Date.parse(a[0].when)-Date.parse(b[0].when)||
    a[0].recordId.localeCompare(b[0].recordId));
}
function scoreScene(scene){
  const ranked=scene.map(r=>({record:r,...signal(r)})).sort((a,b)=>b.score-a.score||
    a.record.recordId.localeCompare(b.record.recordId));
  // More independent evidence is interesting, but a pile of idle movement
  // should not automatically become permanent memory.
  const bonus=Math.min(.085,Math.log2(scene.length)*.029);
  return {ranked,score:Math.min(1,Number((ranked[0].score+bonus).toFixed(3))),
    candidate:ranked[0].candidate};
}
export function evaluateAutomaticMemoryBatch(rawRecords,
    {existingInHour=0,softTargetPerHour=6,batchId=null,minScore=.56}={}){
  if(!Array.isArray(rawRecords)||rawRecords.length>10000)throw new Error('curation_batch_limit');
  if(!Number.isSafeInteger(existingInHour)||existingInHour<0||
     !Number.isSafeInteger(softTargetPerHour)||softTargetPerHour<1||
     !Number.isFinite(minScore)||minScore<0||minScore>1)
    throw new Error('curation_invalid_budget');
  if(batchId!==null&&!isUuid(batchId))throw new Error('curation_invalid_batch');
  const qualified=[],rejected=[],byId=new Map();
  for(const row of rawRecords){
    try{
      const item=normalizedEvidence(row),old=byId.get(item.recordId);
      if(old){
        if(JSON.stringify(old)!==JSON.stringify(item))throw new Error('curation_conflicting_evidence_id');
        continue;
      }
      byId.set(item.recordId,item);qualified.push(item);
    }catch(error){
      if(error?.message==='curation_conflicting_evidence_id')throw error;
      rejected.push(Object.freeze({recordId:isUuid(row?.recordId)?row.recordId:null,
        reason:error instanceof Error?error.message:'curation_invalid_evidence'}));
    }
  }
  // A *soft* pressure on ordinary scenes, never a hard count limit.
  // Account for admissions IN this checkpoint, so one 40-scene batch cannot
  // bypass the approximate six-per-active-hour target entirely.
  const proposals=[];
  for(const scene of groupQualifiedScenes(qualified)){
    const {ranked,score,candidate}=scoreScene(scene);
    const pressure=Math.min(.26,Math.max(0,
      existingInHour+proposals.length-softTargetPerHour)*.04);
    const threshold=Math.min(.84,minScore+pressure);
    if(score<threshold&&score<.86)continue;
    const scope=scopeOf(scene[0]),ids=frozenEvidenceIds(scene);
    const summary=ranked.slice(0,4).map(x=>factDigest(x.record)).join(' ').slice(0,2400);
    const key=['auto-memory-v1',...Object.values(scope),ids];
    const sceneBatch=batchId??stableUuid('m6-batch',...key);
    proposals.push(Object.freeze({...scope,kind:'curation_proposal',version:1,
      proposalId:stableUuid(...key),provider:'deterministic',evidenceRecordIds:ids,
      candidate,notability:score,groundedSummary:summary,
      inCharacterTake:'No interpretation recorded.',batchId:sceneBatch}));
  }
  return Object.freeze({proposals:Object.freeze(proposals),
    rejected:Object.freeze(rejected),qualifiedCount:qualified.length});
}
export function selectAutomaticMemories(records,options={}){
  return evaluateAutomaticMemoryBatch(records,options).proposals;
}
