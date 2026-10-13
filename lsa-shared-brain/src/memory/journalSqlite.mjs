// Shared immutable M2/M3 journal: one SQLite file, no background model.
// Write entry points are synchronous and ONLY legal under withTimelineWrite.
import {createHash} from 'node:crypto';
import {isUuid,immutableSnapshot} from '../util/identity.mjs';
import {evidenceHash} from '../events/journalEventNormalizer.mjs';
import {ensureIntegratedMemorySchema} from './integratedSqlite.mjs';
import {ensureCurationSchema} from './curationSqlite.mjs';
export const JOURNAL_SCHEMA_VERSION=4;
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const hex=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const utc=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT/.test(s)&&!Number.isNaN(Date.parse(s));
const validText=(s,min,max)=>typeof s==='string'&&s.length>=min&&s.length<=max;
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const fail=code=>{throw new Error(code);};
const lineKeys=['version','characterId','worldProfileId','timelineId','kind','recordId','speaker','source','content','delivery','committedAtUtc','turnIdentityHash','utteranceId','transcription','deliveryReceiptId'];
const eventKeys=['version','characterId','worldProfileId','timelineId','kind','recordId','observationId','revision','eventType','receivedAtUtc','sourceHash','ownerProof','receiptStatus','claims'];
function scope(e,world){if(!e||e.version!==1||!isUuid(e.characterId)||e.worldProfileId!==world||!isUuid(e.timelineId)||!isUuid(e.recordId))fail('journal_invalid_scope');}
// `replyTo` is optional so every pre-existing line shape stays valid. When present
// it is the record id of the accepted player line an NPC line answers (study
// §3.3 "the NPC line it replied to"); appendDialogue resolves it in the same
// scope and session, so a reply link can never dangle or cross characters.
export const NPC_DELIVERY_STATUSES=Object.freeze(['completed','interrupted','failed']);
export function validateDialogueLine(e,world){
  scope(e,world);
  const hasReply=!!e&&typeof e==='object'&&Object.hasOwn(e,'replyTo');
  if(!exact(e,hasReply?[...lineKeys,'replyTo']:lineKeys)||e.kind!=='dialogue_line'||!['player','npc'].includes(e.speaker)||
    !['typed','stt','npc_generated'].includes(e.source)||!validText(e.content,1,12000)||!utc(e.committedAtUtc)||
    !hex(e.turnIdentityHash)||!(e.utteranceId===null||isUuid(e.utteranceId))||
    !(e.deliveryReceiptId===null||isUuid(e.deliveryReceiptId)))fail('journal_invalid_dialogue');
  if(hasReply&&!(e.replyTo===null||isUuid(e.replyTo)))fail('journal_invalid_reply_to');
  if(e.speaker==='player'){
    if(!['typed','stt'].includes(e.source)||e.delivery!=='accepted'||e.deliveryReceiptId!==null)fail('journal_unaccepted_dialogue');
    if(hasReply&&e.replyTo!==null)fail('journal_invalid_reply_to');
  }else{
    if(e.source!=='npc_generated'||e.transcription!==null||!NPC_DELIVERY_STATUSES.includes(e.delivery))
      fail('journal_unverified_playback');
    // completed/interrupted carry the delivery outcome id; a failed line was
    // never delivered, so no receipt can exist for it.
    if(e.delivery==='failed'?e.deliveryReceiptId!==null:!isUuid(e.deliveryReceiptId))
      fail('journal_unverified_playback');
  }
  if(e.source==='stt'){
    const t=e.transcription;
    if(!exact(t,['provider','model','confidence'])||!validText(t.provider,1,64)||!validText(t.model,1,80)||
      !(t.confidence===null||typeof t.confidence==='number'&&Number.isFinite(t.confidence)&&t.confidence>=0&&t.confidence<=1))
      fail('journal_invalid_transcription');
  }else if(e.transcription!==null)fail('journal_invalid_transcription');
  return immutableSnapshot(e);
}
export function validateJournalEvent(e,world){
  scope(e,world);const p=e.ownerProof;
  if(!exact(e,eventKeys)||e.kind!=='journal_event'||!isUuid(e.observationId)||
    !Number.isSafeInteger(e.revision)||e.revision<1||!validText(e.eventType,1,48)||!utc(e.receivedAtUtc)||
    !hex(e.sourceHash)||!['witnessed','reported'].includes(e.receiptStatus)||
    !exact(p,['ownerAlias','incarnationId','encounterId','hostRunId','worldEpoch','observerCaptureRef'])||
    !validText(p.ownerAlias,1,100)||![p.incarnationId,p.encounterId,p.hostRunId,p.observerCaptureRef].every(isUuid)||
    !Number.isSafeInteger(p.worldEpoch)||p.worldEpoch<0||!Array.isArray(e.claims)||e.claims.length<1||e.claims.length>32)
    fail('journal_invalid_event');
  for(const c of e.claims)if(!exact(c,['kind','modality','certainty','durableSubject','sourceEvidenceId'])||
    !validText(c.kind,1,48)||!['self','visual','auditory','report'].includes(c.modality)||
    !['direct','reported','inferred','unknown'].includes(c.certainty)||!validText(c.durableSubject,1,100)||!isUuid(c.sourceEvidenceId))
    fail('journal_invalid_claim');
  return immutableSnapshot(e);
}
const DDL=[
"CREATE TABLE dialogue_journal (record_id TEXT PRIMARY KEY,world_profile_id TEXT NOT NULL,timeline_id TEXT NOT NULL REFERENCES timelines(timeline_id),character_id TEXT NOT NULL,session_id TEXT NOT NULL,protagonist TEXT NOT NULL CHECK(protagonist IN ('franklin','michael','trevor','unknown')),host_run_id TEXT,world_epoch INTEGER,speaker TEXT NOT NULL,source TEXT NOT NULL,delivery TEXT NOT NULL,turn_identity_hash TEXT NOT NULL,committed_at_utc TEXT NOT NULL,content TEXT NOT NULL,content_sha256 TEXT NOT NULL,receipt_id TEXT,envelope_json TEXT NOT NULL,envelope_sha256 TEXT NOT NULL,UNIQUE(character_id,timeline_id,speaker,turn_identity_hash));",
"CREATE INDEX dialogue_scope_recent ON dialogue_journal(world_profile_id,character_id,timeline_id,committed_at_utc DESC);",
"CREATE INDEX dialogue_session_recent ON dialogue_journal(character_id,timeline_id,session_id,committed_at_utc DESC);",
"CREATE VIRTUAL TABLE dialogue_journal_fts USING fts5(content,content='dialogue_journal',content_rowid='rowid',tokenize='unicode61');",
"CREATE TRIGGER dialogue_fts_insert AFTER INSERT ON dialogue_journal BEGIN INSERT INTO dialogue_journal_fts(rowid,content) VALUES(new.rowid,new.content); END;",
"CREATE TRIGGER dialogue_fts_delete AFTER DELETE ON dialogue_journal BEGIN INSERT INTO dialogue_journal_fts(dialogue_journal_fts,rowid,content) VALUES('delete',old.rowid,old.content); END;",
"CREATE TABLE event_journal (record_id TEXT PRIMARY KEY,world_profile_id TEXT NOT NULL,timeline_id TEXT NOT NULL REFERENCES timelines(timeline_id),character_id TEXT NOT NULL,observation_id TEXT NOT NULL,revision INTEGER NOT NULL,event_type TEXT NOT NULL,received_at_utc TEXT NOT NULL,source_hash TEXT NOT NULL,receipt_status TEXT NOT NULL,envelope_json TEXT NOT NULL,envelope_sha256 TEXT NOT NULL,UNIQUE(character_id,timeline_id,observation_id,revision));",
"CREATE INDEX event_scope_recent ON event_journal(world_profile_id,character_id,timeline_id,received_at_utc DESC);",
"CREATE INDEX event_type_recent ON event_journal(character_id,timeline_id,event_type,received_at_utc DESC);",
"CREATE TABLE IF NOT EXISTS event_source_evidence (record_id TEXT PRIMARY KEY REFERENCES event_journal(record_id) ON DELETE CASCADE, source_evidence_json TEXT NOT NULL, source_evidence_sha256 TEXT NOT NULL);"
].join('\n');
const tables=['dialogue_journal','dialogue_journal_fts','event_journal','event_source_evidence','memory_records','memory_commands','memory_tombstones','memory_curation_jobs','memory_budget_reservations','memory_luna_appraisals'];
const sidecarDDL="CREATE TABLE IF NOT EXISTS event_source_evidence (record_id TEXT PRIMARY KEY REFERENCES event_journal(record_id) ON DELETE CASCADE, source_evidence_json TEXT NOT NULL, source_evidence_sha256 TEXT NOT NULL)";
export function migrateJournalSchema(db){
  const v=db.prepare('PRAGMA user_version').get().user_version;
  if(![2,3,JOURNAL_SCHEMA_VERSION].includes(v))fail('unsupported_sqlite_profile_schema');
  if(v===JOURNAL_SCHEMA_VERSION){assertJournalSchema(db);return v;}
  // Entire v2/v3 -> v4 migration commits atomically; no mixed schema state.
  db.exec('BEGIN IMMEDIATE');
  try{
    if(v===2)db.exec(DDL);
    else db.exec(sidecarDDL); // Existing v3 journal bytes are never rebuilt.
    ensureIntegratedMemorySchema(db);
    ensureCurationSchema(db);
    db.exec('PRAGMA user_version=4');
    db.exec('COMMIT');
    return JOURNAL_SCHEMA_VERSION;
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
export function assertJournalSchema(db){
  if(db.prepare('PRAGMA user_version').get().user_version!==JOURNAL_SCHEMA_VERSION)fail('sqlite_journal_schema_missing');
  for(const name of tables)if(!db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(name))fail('sqlite_journal_schema_incomplete');
  if(!db.prepare('PRAGMA table_info(dialogue_journal)').all().some(c=>c.name==='envelope_sha256'))
    fail('sqlite_journal_schema_incomplete');
}
function owner(db,e,world){
  const p=db.prepare('SELECT owner_alias FROM promoted_profiles WHERE character_id=?').get(e.characterId);
  const t=db.prepare('SELECT world_profile_id AS worldId FROM timelines WHERE timeline_id=?').get(e.timelineId);
  if(!p||!t||t.worldId!==world)fail('journal_owner_or_timeline_unknown');
  return p.owner_alias;
}
export function appendDialogue(db,line,attribution,world){
  assertJournalSchema(db);const e=validateDialogueLine(line,world);owner(db,e,world);
  if(!exact(attribution,['sessionId','protagonist','hostRunId','worldEpoch'])||
    !isUuid(attribution.sessionId)||!['franklin','michael','trevor','unknown'].includes(attribution.protagonist)||
    !(attribution.hostRunId===null||isUuid(attribution.hostRunId))||
    !(attribution.worldEpoch===null||Number.isSafeInteger(attribution.worldEpoch)&&attribution.worldEpoch>=0)||
    (attribution.hostRunId===null)!==(attribution.worldEpoch===null))fail('journal_invalid_attribution');
  if(typeof e.replyTo==='string'){
    const parent=db.prepare('SELECT speaker,delivery,session_id,character_id,timeline_id,world_profile_id FROM dialogue_journal WHERE record_id=?').get(e.replyTo);
    if(!parent||parent.speaker!=='player'||parent.delivery!=='accepted'||
       parent.character_id!==e.characterId||parent.timeline_id!==e.timelineId||
       parent.world_profile_id!==e.worldProfileId||parent.session_id!==attribution.sessionId)
      fail('journal_reply_to_unresolved');
  }
  const old=db.prepare('SELECT envelope_json,envelope_sha256,content_sha256,session_id,protagonist,host_run_id,world_epoch FROM dialogue_journal WHERE character_id=? AND timeline_id=? AND speaker=? AND turn_identity_hash=?')
    .get(e.characterId,e.timelineId,e.speaker,e.turnIdentityHash);
  if(old){
    const previous=JSON.parse(old.envelope_json),
      {recordId:ignored,committedAtUtc:originalAcceptedTime,...a}=previous,
      {recordId:ignored2,committedAtUtc:replayAcceptedTime,...b}=e;
    if(hash(old.envelope_json)!==old.envelope_sha256||JSON.stringify(a)!==JSON.stringify(b)||old.content_sha256!==hash(e.content)||
      old.session_id!==attribution.sessionId||old.protagonist!==attribution.protagonist||
      old.host_run_id!==attribution.hostRunId||old.world_epoch!==attribution.worldEpoch)
      fail('journal_replay_conflict');
    return Object.freeze({inserted:false,recordId:previous.recordId});
  }
  const raw=JSON.stringify(e);
  db.prepare('INSERT INTO dialogue_journal (record_id,world_profile_id,timeline_id,character_id,session_id,protagonist,host_run_id,world_epoch,speaker,source,delivery,turn_identity_hash,committed_at_utc,content,content_sha256,receipt_id,envelope_json,envelope_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(e.recordId,e.worldProfileId,e.timelineId,e.characterId,attribution.sessionId,attribution.protagonist,attribution.hostRunId,
      attribution.worldEpoch,e.speaker,e.source,e.delivery,e.turnIdentityHash,e.committedAtUtc,e.content,hash(e.content),
      e.deliveryReceiptId,raw,hash(raw));
  return Object.freeze({inserted:true,recordId:e.recordId});
}
function verifiedEvidence(event,sidecar) {
  if(!sidecar||sidecar.format!=='ps2-observation-v1'||sidecar.sourceHash!==event.sourceHash||
     sidecar.observation?.observationId!==event.observationId||
     sidecar.observation?.revision!==event.revision||
     sidecar.observation?.observedAt?.receivedUtc!==event.receivedAtUtc||
     !sidecar.ownerProof||JSON.stringify(sidecar.ownerProof)!==JSON.stringify(event.ownerProof)||
     !isUuid(sidecar.nativeAdapterEpoch)||!Array.isArray(sidecar.participantProofs)||
     !sidecar.observation || !Array.isArray(sidecar.observation.claims))
    fail('journal_evidence_mismatch');
  const material={observation:sidecar.observation,identity:{
    characterId:event.characterId,worldProfileId:event.worldProfileId,
    timelineId:event.timelineId,ownerProof:sidecar.ownerProof,
    adapterEpoch:sidecar.nativeAdapterEpoch
  },participantProofs:sidecar.participantProofs,prePromotionProof:sidecar.prePromotionProof??null};
  if(evidenceHash(material)!==event.sourceHash)fail('journal_evidence_hash_mismatch');
  const sourceClaims=new Set(sidecar.observation.claims.map(c=>c.claimId));
  if(event.claims.some(c=>!sourceClaims.has(c.sourceEvidenceId)))fail('journal_evidence_claim_mismatch');
  return immutableSnapshot(sidecar);
}
export function appendEvent(db,event,world,{hostContext=null,sourceEvidence=null}={}){
  assertJournalSchema(db);const e=validateJournalEvent(event,world),alias=owner(db,e,world);
  if(alias!==e.ownerProof.ownerAlias)fail('journal_owner_proof_mismatch');
  if(hostContext&&(hostContext.hostRunId!==e.ownerProof.hostRunId||hostContext.worldEpoch!==e.ownerProof.worldEpoch))
    fail('journal_source_epoch_mismatch');
  const evidence=sourceEvidence===null?null:verifiedEvidence(e,sourceEvidence);
  // A newer accepted revision may never be rolled back by a late/replayed PS2 receipt.
  const newest=db.prepare('SELECT MAX(revision) AS revision FROM event_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND observation_id=?')
    .get(e.worldProfileId,e.characterId,e.timelineId,e.observationId)?.revision;
  if(newest!==null&&newest!==undefined&&newest>e.revision)fail('journal_stale_event_revision');
  const old=db.prepare('SELECT envelope_json,envelope_sha256 FROM event_journal WHERE character_id=? AND timeline_id=? AND observation_id=? AND revision=?')
    .get(e.characterId,e.timelineId,e.observationId,e.revision);
  if(old){
    const previous=JSON.parse(old.envelope_json),{recordId:ignored,...a}=previous,{recordId:ignored2,...b}=e;
    if(hash(old.envelope_json)!==old.envelope_sha256||JSON.stringify(a)!==JSON.stringify(b))fail('journal_replay_conflict');
    const existing=db.prepare('SELECT source_evidence_json AS json,source_evidence_sha256 AS digest FROM event_source_evidence WHERE record_id=?').get(previous.recordId);
    if(evidence){
      if(!existing||hash(existing.json)!==existing.digest||existing.json!==JSON.stringify(evidence))
        fail('journal_evidence_replay_conflict');
    }
    return Object.freeze({inserted:false,recordId:previous.recordId});
  }
  const raw=JSON.stringify(e);
  db.prepare('INSERT INTO event_journal(record_id,world_profile_id,timeline_id,character_id,observation_id,revision,event_type,received_at_utc,source_hash,receipt_status,envelope_json,envelope_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(e.recordId,e.worldProfileId,e.timelineId,e.characterId,e.observationId,e.revision,e.eventType,e.receivedAtUtc,
      e.sourceHash,e.receiptStatus,raw,hash(raw));
  if(evidence){
    const original=JSON.stringify(evidence);
    db.prepare('INSERT INTO event_source_evidence(record_id,source_evidence_json,source_evidence_sha256) VALUES (?,?,?)')
      .run(e.recordId,original,hash(original));
  }
  return Object.freeze({inserted:true,recordId:e.recordId});
}
function readScope(s,world,defaultLimit=200){
  if(!s||!isUuid(s.characterId)||!isUuid(s.timelineId)||
    (s.worldProfileId!==undefined&&s.worldProfileId!==world))fail('journal_invalid_scope');
  const limit=s.limit??defaultLimit;
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000)fail('journal_invalid_limit');
  return limit;
}
function decodeLine(row){
  const value=JSON.parse(row.envelope_json);
  if(hash(row.envelope_json)!==row.envelope_sha256||value.content!==row.content||hash(value.content)!==row.content_sha256)fail('journal_content_integrity_failed');
  return immutableSnapshot({...value,attribution:{sessionId:row.session_id,protagonist:row.protagonist,
    hostRunId:row.host_run_id,worldEpoch:row.world_epoch}});
}
function decodeEvent(row){
  if(hash(row.envelope_json)!==row.envelope_sha256)fail('journal_content_integrity_failed');
  return immutableSnapshot(JSON.parse(row.envelope_json));
}
export function readDialogue(db,s,world){
  assertJournalSchema(db);const limit=readScope(s,world);
  const clauses=['world_profile_id=?','character_id=?','timeline_id=?'],args=[world,s.characterId,s.timelineId];
  if(s.speaker!==undefined){if(!['player','npc'].includes(s.speaker))fail('journal_invalid_query');clauses.push('speaker=?');args.push(s.speaker);}
  if(s.sessionId!==undefined){if(!isUuid(s.sessionId))fail('journal_invalid_query');clauses.push('session_id=?');args.push(s.sessionId);}
  if(s.beforeUtc!==undefined){if(!utc(s.beforeUtc))fail('journal_invalid_query');clauses.push('committed_at_utc<?');args.push(s.beforeUtc);}
  return Object.freeze(db.prepare('SELECT * FROM dialogue_journal WHERE '+clauses.join(' AND ')+' ORDER BY committed_at_utc DESC,rowid DESC LIMIT ?').all(...args,limit).map(decodeLine));
}
export function findExactQuote(db,s,world){
  assertJournalSchema(db);const limit=readScope(s,world,20);
  if(!validText(s.quote,1,12000))fail('journal_invalid_query');
  return Object.freeze(db.prepare('SELECT * FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND content=? COLLATE BINARY ORDER BY committed_at_utc DESC,rowid DESC LIMIT ?')
    .all(world,s.characterId,s.timelineId,s.quote,limit).map(decodeLine));
}
export function searchDialogue(db,s,world){
  assertJournalSchema(db);const limit=readScope(s,world,20);
  if(!validText(s.query,1,500))fail('journal_invalid_query');
  const phrase='"'+s.query.replaceAll('"','""')+'"';
  return Object.freeze(db.prepare('SELECT j.* FROM dialogue_journal_fts JOIN dialogue_journal j ON j.rowid=dialogue_journal_fts.rowid WHERE dialogue_journal_fts MATCH ? AND j.world_profile_id=? AND j.character_id=? AND j.timeline_id=? ORDER BY j.committed_at_utc DESC,j.rowid DESC LIMIT ?')
    .all(phrase,world,s.characterId,s.timelineId,limit).map(decodeLine));
}
export function readEvents(db,s,world){
  assertJournalSchema(db);const limit=readScope(s,world);
  const args=[world,s.characterId,s.timelineId];let filter='';
  if(s.eventType!==undefined){if(!validText(s.eventType,1,48))fail('journal_invalid_query');filter=' AND event_type=?';args.push(s.eventType);}
  return Object.freeze(db.prepare('SELECT * FROM event_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=?'+filter+' ORDER BY received_at_utc DESC,rowid DESC LIMIT ?')
    .all(...args,limit).map(decodeEvent));
}

/** Only M3's verified sidecars qualify for full witness recall and curation. */
export function readVerifiedEventEvidence(db,{characterId,timelineId,recordId},world){
  if(!isUuid(characterId)||!isUuid(timelineId)||!isUuid(recordId))fail('journal_invalid_scope');
  assertJournalSchema(db);
  const row=db.prepare('SELECT e.envelope_json,e.envelope_sha256,s.source_evidence_json,s.source_evidence_sha256 FROM event_journal e JOIN event_source_evidence s ON s.record_id=e.record_id WHERE e.world_profile_id=? AND e.character_id=? AND e.timeline_id=? AND e.record_id=?')
    .get(world,characterId,timelineId,recordId);
  if(!row)return null;
  if(hash(row.envelope_json)!==row.envelope_sha256||hash(row.source_evidence_json)!==row.source_evidence_sha256)
    fail('journal_content_integrity_failed');
  const event=JSON.parse(row.envelope_json),sourceEvidence=JSON.parse(row.source_evidence_json);
  verifiedEvidence(event,sourceEvidence);
  return immutableSnapshot({event,sourceEvidence});
}
