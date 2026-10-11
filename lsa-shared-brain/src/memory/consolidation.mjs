// Conservative duplicate planning. Actual append-only evidence CAS belongs to
// the shared SQLite store; M6 never mutates evidence or explicit player notes.
import {isUuid,sameScope} from './evidence.mjs';
const words=s=>String(s).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
export function consolidationKey(record){
  if(!record||!['joke','relationship','episode','semantic'].includes(record.candidate))return null;
  const signature=record.selectionSignature??record.groundedSummary;
  return typeof signature==='string'&&signature.length?record.candidate+':'+words(signature):null;
}
function idsOf(candidate){
  if(!candidate||!Array.isArray(candidate.evidenceRecordIds)||!candidate.evidenceRecordIds.length||
    candidate.evidenceRecordIds.length>64||!candidate.evidenceRecordIds.every(isUuid))
    throw new Error('curation_invalid_candidate');
  return new Set(candidate.evidenceRecordIds);
}
function sameOrigin(a,b){
  if(!sameScope(a,b))return false;
  // If a protagonist is proven on either side, require an equally proven
  // identical attribution on the other. No unknown->known promotion by text.
  if(a.protagonistKey!==undefined||b.protagonistKey!==undefined)
    return a.protagonistKey===b.protagonistKey;
  return true;
}
export function consolidateCandidates(existing,incoming){
  if(!Array.isArray(existing))throw new Error('curation_invalid_existing');
  const incomingIds=idsOf(incoming);
  if(incoming.source==='player'||incoming.explicit===true)
    return Object.freeze({action:'preserve_explicit',candidate:incoming});
  const key=consolidationKey(incoming);
  const matches=key?existing.filter(r=>r.source!=='player'&&r.explicit!==true&&
    sameOrigin(r,incoming)&&consolidationKey(r)===key&&r.deleted!==true&&
    Array.isArray(r.evidenceRecordIds)&&
    r.evidenceRecordIds.some(id=>incomingIds.has(id))):[];
  if(matches.length>1)throw new Error('curation_ambiguous_duplicate_target');
  const match=matches[0];
  if(!match)return Object.freeze({action:'insert',candidate:incoming});
  const ids=[...new Set([...match.evidenceRecordIds,...incoming.evidenceRecordIds])].sort();
  if(ids.length>64)return Object.freeze({action:'insert',candidate:incoming,reason:'evidence_limit'});
  if(!ids.every(isUuid))throw new Error('curation_invalid_existing_provenance');
  if(!isUuid(match.proposalId??match.memoryId))throw new Error('curation_invalid_duplicate_target');
  return Object.freeze({action:'link_duplicate',targetId:match.proposalId??match.memoryId,
    evidenceRecordIds:Object.freeze(ids),
    notability:Math.max(match.notability,incoming.notability),
    expectedRevision:match.revision??null});
}
