// Agent E: strict, content-neutral M6 evidence envelope. Never accepts model-generated observations.
import { createHash } from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid=value=>typeof value==='string'&&uuid.test(value);
export const scopeKeys=['characterId','worldProfileId','timelineId'];
export function sameScope(a,b){return scopeKeys.every(key=>a?.[key]===b?.[key]);}
export function scopeOf(record){
  if(!record||!scopeKeys.every(k=>isUuid(record[k])))throw new Error('curation_invalid_scope');
  return Object.freeze(Object.fromEntries(scopeKeys.map(k=>[k,record[k]])));
}
export function stableUuid(...parts){
  const h=createHash('sha256').update(JSON.stringify(parts)).digest('hex');
  return [h.slice(0,8),h.slice(8,12),'4'+h.slice(13,16),'8'+h.slice(17,20),h.slice(20,32)].join('-');
}
export function normalizedEvidence(record){
  const scope=scopeOf(record);
  if(record.version!==1||!isUuid(record.recordId))throw new Error('curation_invalid_record');
  const when=record.kind==='journal_event'?record.receivedAtUtc:record.kind==='dialogue_line'?record.committedAtUtc:null;
  if(typeof when!=='string'||!Number.isFinite(Date.parse(when)))throw new Error('curation_invalid_time');
  if(record.kind==='journal_event'){
    if(record.receiptStatus!=='witnessed'||!isUuid(record.observationId)||!Array.isArray(record.claims)||
       !/^[a-f0-9]{64}$/i.test(record.sourceHash||'')||!record.ownerProof?.ownerAlias||
       !isUuid(record.ownerProof?.hostRunId)||!isUuid(record.ownerProof?.observerCaptureRef)||
       !isUuid(record.ownerProof?.incarnationId)||!isUuid(record.ownerProof?.encounterId)||
       !Number.isSafeInteger(record.ownerProof?.worldEpoch)||record.ownerProof.worldEpoch<0||
       !/^promoted\.[a-f0-9-]{36}$/i.test(record.ownerProof.ownerAlias)||
       !isUuid(record.ownerProof.ownerAlias.slice(9)))
      throw new Error('curation_unverified_event');
    const claims=record.claims.filter(c=>isUuid(c?.sourceEvidenceId)&&['direct','reported'].includes(c.certainty)&&
      ['self','visual','auditory','report'].includes(c.modality)&&typeof c.durableSubject==='string'&&
      c.durableSubject.length>0&&c.durableSubject.length<=100&&/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(c.kind||''));
    if(!claims.length)throw new Error('curation_no_qualified_claims');
    if(typeof record.eventType!=='string'||!/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(record.eventType))
      throw new Error('curation_invalid_event_type');
    return Object.freeze({...scope,kind:record.kind,recordId:record.recordId,when,epoch:record.ownerProof.worldEpoch,
      eventType:record.eventType,claims:Object.freeze(claims.map(c=>Object.freeze({...c}))),
      // Scene ID is optional M3 adapter metadata, never a trustworthy actor identifier.
      sceneId:isUuid(record.sceneId)?record.sceneId:null});
  }
  if(record.kind==='dialogue_line'){
    const player=record.speaker==='player'&&['typed','stt'].includes(record.source)&&record.delivery==='accepted';
    const npc=record.speaker==='npc'&&record.source==='npc_generated'&&record.delivery==='completed'&&isUuid(record.deliveryReceiptId);
    if(!player&&!npc)throw new Error('curation_uncommitted_dialogue');
    if(typeof record.content!=='string'||!record.content.length||record.content.length>12000)
      throw new Error('curation_invalid_dialogue');
    return Object.freeze({...scope,kind:record.kind,recordId:record.recordId,when,epoch:null,
      speaker:record.speaker,content:record.content,sceneId:isUuid(record.sceneId)?record.sceneId:null});
  }
  throw new Error('curation_unsupported_evidence');
}
export function factDigest(record){
  // Source labels only: never turn player words, hearsay or model text into witnessed world facts.
  if(record.kind==='dialogue_line')return (record.speaker==='player'?'Player said: ':'NPC said: ')+
    JSON.stringify(record.content.slice(0,360));
  const claims=record.claims.slice(0,3).map(c=>{
    const qualifier=c.certainty==='reported'||c.modality==='report'?'Reported':'Observed';
    return qualifier+' '+c.kind.replaceAll('_',' ')+' (subject: '+c.durableSubject+')';
  });
  return claims.join('; ')+'.';
}
export function frozenEvidenceIds(records){
  const ids=[...new Set(records.map(r=>r.recordId))].sort();
  if(!ids.length||ids.length>64||!ids.every(isUuid))throw new Error('curation_evidence_limit');
  return Object.freeze(ids);
}
