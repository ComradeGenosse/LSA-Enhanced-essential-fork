// Strict source-qualified evidence; no model-generated world observations.
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
const validTime=t=>typeof t==='string'&&Number.isFinite(Date.parse(t));
const validSubject=c=>isUuid(c?.sourceEvidenceId)&&['direct','reported'].includes(c.certainty)&&
 ['self','visual','auditory','report'].includes(c.modality)&&
 typeof c.durableSubject==='string'&&c.durableSubject.length>0&&c.durableSubject.length<=100&&
 /^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(c.kind||'');
/**
 * Source admission only. This is NOT a substitute for the SQLite journal's
 * authenticated owner/sidecar read. A coordinator must reread committed rows.
 */
export function normalizedEvidence(record){
  const scope=scopeOf(record);
  if(record.version!==1||!isUuid(record.recordId))throw new Error('curation_invalid_record');
  const when=record.kind==='journal_event'?record.receivedAtUtc:record.kind==='dialogue_line'?record.committedAtUtc:null;
  if(!validTime(when))throw new Error('curation_invalid_time');
  if(record.kind==='journal_event'){
    const proof=record.ownerProof;
    if(record.receiptStatus!=='witnessed'||!isUuid(record.observationId)||
       !Array.isArray(record.claims)||!/^[a-f0-9]{64}$/i.test(record.sourceHash||'')||
       !proof||!isUuid(proof.hostRunId)||!isUuid(proof.observerCaptureRef)||
       !isUuid(proof.incarnationId)||!isUuid(proof.encounterId)||
       !Number.isSafeInteger(proof.worldEpoch)||proof.worldEpoch<0||
       proof.ownerAlias!=='promoted.'+scope.characterId)
      throw new Error('curation_unverified_event');
    if(typeof record.eventType!=='string'||!/^[a-zA-Z][a-zA-Z0-9_]{0,47}$/.test(record.eventType))
      throw new Error('curation_invalid_event_type');
    // Any unknown, inferred or incorrectly sourced claim stays out of a factual
    // memory. A valid direct/reported claim does not validate its neighbors.
    const claims=record.claims.filter(validSubject);
    if(!claims.length)throw new Error('curation_no_qualified_claims');
    return Object.freeze({...scope,kind:record.kind,recordId:record.recordId,when,
      protagonistKey:'unknown',epoch:proof.worldEpoch,
      ownerLifetime:proof.hostRunId+':'+proof.incarnationId+':'+proof.encounterId,
      eventType:record.eventType,claims:Object.freeze(claims.map(c=>Object.freeze({...c}))),
      sceneId:isUuid(record.sceneId)?record.sceneId:null});
  }
  if(record.kind==='dialogue_line'){
    const player=record.speaker==='player'&&['typed','stt'].includes(record.source)&&record.delivery==='accepted';
    const npc=record.speaker==='npc'&&record.source==='npc_generated'&&
      record.delivery==='completed'&&isUuid(record.deliveryReceiptId);
    if(!player&&!npc)throw new Error('curation_uncommitted_dialogue');
    if(typeof record.content!=='string'||!record.content.length||record.content.length>12000)
      throw new Error('curation_invalid_dialogue');
    const protagonistKey=record.attribution?.protagonist??'unknown';
    if(!['franklin','michael','trevor','unknown'].includes(protagonistKey))
      throw new Error('curation_invalid_protagonist');
    const epoch=record.attribution?.worldEpoch??null;
    const hostRunId=record.attribution?.hostRunId??null;
    if(epoch!==null&&(!Number.isSafeInteger(epoch)||epoch<0||!isUuid(hostRunId)))
      throw new Error('curation_invalid_host_epoch');
    if(epoch===null&&hostRunId!==null)throw new Error('curation_invalid_host_epoch');
    return Object.freeze({...scope,kind:record.kind,recordId:record.recordId,when,
      protagonistKey,epoch,ownerLifetime:hostRunId,sessionId:record.attribution?.sessionId??null,
      speaker:record.speaker,content:record.content,sceneId:isUuid(record.sceneId)?record.sceneId:null});
  }
  throw new Error('curation_unsupported_evidence');
}
export function factDigest(record){
  if(record.kind==='dialogue_line')
    return (record.speaker==='player'?'Player said: ':'NPC said: ')+JSON.stringify(record.content.slice(0,360));
  return record.claims.slice(0,3).map(c=>
    (c.certainty==='reported'||c.modality==='report'?'Reported ':'Observed ')+
    c.kind.replaceAll('_',' ')+' (subject: '+c.durableSubject+')').join('; ')+'.';
}
export function frozenEvidenceIds(records){
  const ids=[...new Set(records.map(r=>r.recordId))].sort();
  if(!ids.length||ids.length>64||!ids.every(isUuid))throw new Error('curation_evidence_limit');
  return Object.freeze(ids);
}
