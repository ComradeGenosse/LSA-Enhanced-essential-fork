// M4 read-only SQLite boundary. M2/M3 own migrations, FTS population and coverage.
import {readIntegratedRecall} from './sqliteIntegratedRecallProjection.mjs';
let DatabaseSync=null;
try {({DatabaseSync}=await import('node:sqlite'));}catch {}
const escapeFts=term=>'"'+term.replace(/"/g,'""')+'"';
function boundedRows(db,sql,args,cap) {
  // LIMIT is also bound. Never interpolate user or NPC prose into SQL.
  return db.prepare(sql+' LIMIT ?').all(...args,cap);
}
/*
Required future M2/M3 read projection (real migrations owned elsewhere):
 m4_recall_records_v1(document_id INTEGER PRIMARY KEY, character_id,
 world_profile_id, timeline_id, protagonist_key, record_id, source_kind,
 speaker, timestamp_utc, evidence_state, envelope_json, surface_text)
 m4_recall_fts_v1: FTS5 external-content index over surface_text keyed by document_id.
 m4_recall_coverage_v1(character_id,world_profile_id,timeline_id,
 protagonist_key,source_kind,from_utc,to_utc,all_complete,complete).
 No schema or FTS triggers are created by this reader.
*/
export class SQLiteRecallReadAdapter {
  #db;#owned;#integrated;
  constructor({db=null,filePath=null}={}){
    if(!db && (!DatabaseSync||typeof filePath!=='string'||!filePath.trim()))throw new TypeError('sqlite_recall_unavailable');
    this.#db=db??new DatabaseSync(filePath,{readOnly:true});
    this.#owned=!db;
    if(this.#owned)this.#db.exec('PRAGMA query_only=ON');
    const has=name=>!!this.#db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    this.#integrated=!has('m4_recall_records_v1')&&has('dialogue_journal');
  }
  close(){if(this.#owned)this.#db.close();}
  read({scope,terms=[],fromUtc=null,toUtc=null,sourceKind=null,speaker=null,limit=384,
    expandDialogueContext=false,expandRelatedFacts=false,excludeRecordId=null}={}){
    if(!scope||!['franklin','michael','trevor','unknown'].includes(scope.protagonistKey))throw new TypeError('invalid_read_scope');
    if(this.#integrated)return readIntegratedRecall(this.#db,{scope,terms,fromUtc,toUtc,sourceKind,speaker,limit,
      expandDialogueContext,expandRelatedFacts,excludeRecordId});
    if(!Number.isSafeInteger(limit)||limit<1||limit>768)throw new TypeError('invalid_read_limit');
    const where=['r.character_id=?','r.world_profile_id=?','r.timeline_id=?','r.evidence_state=?'];
    const args=[scope.characterId,scope.worldProfileId,scope.timelineId,'verified'];
    if(sourceKind){where.push('r.source_kind=?');args.push(sourceKind);}
    if(speaker){where.push('r.speaker=?');args.push(speaker);}
    if(fromUtc){where.push('r.timestamp_utc>=?');args.push(fromUtc);}
    if(toUtc){where.push('r.timestamp_utc<?');args.push(toUtc);}
    const base=' FROM m4_recall_records_v1 r WHERE '+where.join(' AND ');
    const cols='SELECT r.document_id AS documentId,r.character_id AS characterId,r.world_profile_id AS worldProfileId,r.timeline_id AS timelineId,r.protagonist_key AS protagonistKey,r.source_kind AS sourceKind,r.record_id AS recordId,r.timestamp_utc AS atUtc,r.evidence_state AS evidenceState,r.envelope_json AS envelopeJson';
    // Recent fallthrough guarantees "what did I just say?" even with empty FTS.
    // Lexical FTS looks back into indefinitely retained archived rows, without
    // scanning the entire journal or allocating a vector/GPU model.
    const tokens=[...new Set(terms.filter(t=>typeof t==='string'&&/^[\p{L}\p{N}]{2,48}$/u.test(t)))].slice(0,12);
    const lexicalCap=tokens.length?Math.min(Math.floor(limit/3),128):0;
    const recentCap=limit-lexicalCap;
    let lexical=[];
    if(lexicalCap){
      // FTS MATCH must be bound, never string-concatenated from raw question.
      const match=tokens.map(escapeFts).join(' OR ');
      lexical=boundedRows(this.#db,cols+' FROM m4_recall_fts_v1 JOIN m4_recall_records_v1 r ON r.document_id=m4_recall_fts_v1.rowid WHERE '+where.join(' AND ')+' AND m4_recall_fts_v1 MATCH ? ORDER BY bm25(m4_recall_fts_v1),r.timestamp_utc DESC',[...args,match],lexicalCap);
    }
    const recent=boundedRows(this.#db,cols+base+' ORDER BY r.timestamp_utc DESC,r.document_id DESC',args,recentCap);
    const found=new Map();
    for(const r of [...lexical,...recent]){
      if(found.has(r.documentId))continue;
      let envelope;
      try{envelope=JSON.parse(r.envelopeJson);}catch{continue;}
      found.set(r.documentId,{...r,envelope});
    }
    // Fail closed: only an explicit, source-authoritative coverage certificate
    // is allowed to turn an empty search into "not_recorded"; no event record
    // alone proves a character was observing for the entire requested period.
    // Legacy protagonist-specific certificates cannot prove full cross-avatar coverage.
    return {rows:[...found.values()],coverageComplete:false};
  }
}
export function openSqliteRecallReader({filePath}={}){return new SQLiteRecallReadAdapter({filePath});}
