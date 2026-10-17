// Confidential administration projection, invoked ONLY by M5's authenticated
// P2 read port. Raw history is not a fact, and eligibility is not live recall.
import {createHash} from 'node:crypto';
import {suppressedMemoryIds} from './suppressionSqlite.mjs';
import {readCorrectionRows,supersededTargetIds,isPrivatelyCorrectableFact} from './correctionSemantics.mjs';
import {readIntegratedRecall} from './sqliteIntegratedRecallProjection.mjs';
const hash=s=>createHash('sha256').update(s).digest('hex');
const where='world_profile_id=? AND character_id=? AND timeline_id=?';
export const INSPECTOR_KINDS=Object.freeze(['facts','conversations','npc_dialogue','events','corrections','suppressed']);
export function readInspectorPage(db,{scope,kind='facts',offset=0,limit=50}) {
  if(!INSPECTOR_KINDS.includes(kind)||!Number.isSafeInteger(offset)||offset<0||offset>100000||
    !Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('inspector_invalid_page');
  const keys=[scope.worldProfileId,scope.characterId,scope.timelineId];
  const suppressed=suppressedMemoryIds(db,scope),corrections=readCorrectionRows(db,keys);
  const superseded=supersededTargetIds(db,keys);
  const query=(columns,table,order,extra='',args=[])=>db.prepare(
    `SELECT ${columns} FROM ${table} WHERE ${where} ${extra} ORDER BY ${order} LIMIT ? OFFSET ?`)
    .all(...keys,...args,limit+1,offset);
  let rows=[];
  if(kind==='facts')rows=query('memory_id AS recordId,content,content_sha256 AS checksum,mode,origin,pin,notability,evidence_ids_json AS sources,created_at_utc AS atUtc','memory_records','created_at_utc DESC,memory_id')
    .map(r=>({...r,category:r.mode==='opinion'?'interpretation':'extracted_or_reported_memory',
      evidenceRecordIds:JSON.parse(r.sources),integrity:hash(r.content)===r.checksum,
      confidence:null,confidenceNote:'Notability is not confidence; see mode and provenance.'}));
  if(kind==='conversations'||kind==='npc_dialogue')rows=query('record_id AS recordId,content,content_sha256 AS checksum,envelope_json AS raw,envelope_sha256 AS rawHash,committed_at_utc AS atUtc,source,speaker,delivery,protagonist AS sourceAvatar','dialogue_journal','committed_at_utc DESC,record_id',kind==='npc_dialogue'?"AND speaker='npc'":'')
    .map(r=>({...r,category:r.speaker==='npc'?'npc_dialogue_raw':'player_conversation_raw',
      envelope:JSON.parse(r.raw),integrity:hash(r.content)===r.checksum&&hash(r.raw)===r.rawHash,
      confidence:JSON.parse(r.raw).transcription?.confidence??null}));
  if(kind==='events')rows=query('record_id AS recordId,envelope_json AS raw,envelope_sha256 AS rawHash,received_at_utc AS atUtc,receipt_status AS receiptStatus','event_journal','received_at_utc DESC,record_id')
    .map(r=>{const envelope=JSON.parse(r.raw);return {...r,category:'event_memory',envelope,
      content:envelope.eventType,integrity:hash(r.raw)===r.rawHash,
      confidence:null,evidenceRecordIds:envelope.claims?.map(c=>c.sourceEvidenceId)??[]};});
  if(kind==='corrections')rows=corrections.slice(offset,offset+limit+1).map(c=>({
    recordId:c.commandId,targetId:c.targetId,content:c.content,atUtc:c.atUtc,
    category:'player_correction_reported',correctionMode:c.mode,supersedesTarget:c.supersedes,
    integrity:true,evidenceRecordIds:[c.targetId]}));
  if(kind==='suppressed')rows=query('trash_id AS trashId,target_id AS recordId,created_at_utc AS atUtc,purge_after_utc AS purgeAfterUtc,restored_at_utc AS restoredAtUtc,purged_at_utc AS purgedAtUtc','m5_trash','created_at_utc DESC,trash_id')
    .map(r=>({...r,category:'privacy_history',content:r.purgedAtUtc?'Purged; permanent suppression retained.':
      r.restoredAtUtc?'Restored by explicit privacy operation.':Date.parse(r.purgeAfterUtc)<=Date.now()?
        'Forgotten; recovery window expired. Safe undo unavailable.':'Forgotten; retained privately during recovery window.',
      restoreSupported:!r.restoredAtUtc&&!r.purgedAtUtc&&Date.parse(r.purgeAfterUtc)>Date.now()}));
  const sourceKind={facts:'permanent_memory',conversations:'dialogue_line',npc_dialogue:'dialogue_line',events:'journal_event',corrections:'permanent_memory'}[kind];
  // Use the SAME evidence/suppression/correction reader used by H2. A row not
  // returned by its bounded window is unknown, never declared recallable.
  const eligible=new Set(sourceKind?readIntegratedRecall(db,{scope,sourceKind,limit:768}).rows.map(r=>r.recordId):[]);
  const items=rows.slice(0,limit).map(r=>{
    const hidden=suppressed.has(r.recordId),replaced=superseded.has(r.recordId);
    const recall=hidden?'suppressed':replaced?'superseded':r.integrity===false?'integrity_failed':
      eligible.has(r.recordId)?'eligible_in_p2':'unavailable_or_outside_recall_window';
    return {...r,suppressed:hidden,superseded:replaced,recall,
      canCorrect:kind==='facts'&&eligible.has(r.recordId)&&!hidden&&!replaced&&isPrivatelyCorrectableFact(db,keys,r.recordId),
      correctionPolicy:kind==='facts'?'Only eligible, unsuppressed player-sourced reported facts support revision. NPC speech, witnessed evidence and interpretations are protected.':null,
      canForget:['facts','conversations','npc_dialogue','events'].includes(kind)&&!hidden,
      // No duplicated raw serialization in the browser response.
      raw:undefined,sources:undefined};
  });
  return {version:1,scope:{...scope},kind,offset,limit,items,hasMore:rows.length>limit,
    recallNote:'P2 eligibility only. Live recall also requires enabled capability and current turn authority.',
    undo:'Existing seven-day P2 trash recovery only; no backup restore.'};
}
