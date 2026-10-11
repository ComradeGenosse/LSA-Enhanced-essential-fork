// Agent E: conservative duplicate consolidation; historical source records remain immutable.
import { isUuid, sameScope } from './evidence.mjs';
const words=s=>String(s).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
export function consolidationKey(record){
  if(!record||!['joke','relationship','episode','semantic'].includes(record.candidate))return null;
  // No semantic fuzzy join: only exact normalized subject+signature from verified sources.
  const signature=record.selectionSignature??record.groundedSummary;
  return typeof signature==='string'&&signature.length?record.candidate+':'+words(signature):null;
}
export function consolidateCandidates(existing,incoming){
  if(!incoming||!Array.isArray(incoming.evidenceRecordIds)||!incoming.evidenceRecordIds.every(isUuid))
    throw new Error('curation_invalid_candidate');
  if(incoming.source==='player'||incoming.explicit===true)return {action:'preserve_explicit',candidate:incoming};
  const key=consolidationKey(incoming);
  const incomingIds=new Set(incoming.evidenceRecordIds);
  const match=key&&existing.find(r=>r.source!=='player'&&r.explicit!==true&&sameScope(r,incoming)&&
    consolidationKey(r)===key&&r.deleted!==true&&Array.isArray(r.evidenceRecordIds)&&
    // A shared immutable source ID proves the same underlying episode; similar
    // summaries alone (e.g. two separate crashes) must NEVER merge.
    r.evidenceRecordIds.some(id=>incomingIds.has(id)));
  if(!match)return {action:'insert',candidate:incoming};
  const ids=[...new Set([...match.evidenceRecordIds,...incoming.evidenceRecordIds])].sort();
  if(ids.length>64)return {action:'insert',candidate:incoming,reason:'evidence_limit'};
  // Never overwrite the original factual digest or identity. Add provenance through a new revision.
  return {action:'link_duplicate',targetId:match.proposalId||match.memoryId,
    evidenceRecordIds:Object.freeze(ids),notability:Math.max(match.notability,incoming.notability),
    // Integrator writes a CAS revision and append-only source-link rows under TimelineGuard.
    expectedRevision:match.revision??null};
}
