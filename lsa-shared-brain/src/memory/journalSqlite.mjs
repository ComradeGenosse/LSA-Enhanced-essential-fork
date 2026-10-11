// Shared immutable M2/M3 journal: one SQLite file, no background model.
// Write entry points are synchronous and ONLY legal under withTimelineWrite.
import {createHash} from 'node:crypto';
import {isUuid,immutableSnapshot} from '../util/identity.mjs';
export const JOURNAL_SCHEMA_VERSION=3;
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const hex=s=>typeof s==='string'&&/^[0-9a-f]{64}$/.test(s);
const utc=s=>typeof s==='string'&&/^\d{4}-\d\d-\d\dT/.test(s)&&!Number.isNaN(Date.parse(s));
const validText=(s,min,max)=>typeof s==='string'&&s.length>=min&&s.length<=max;
const exact=(o,keys)=>!!o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).length===keys.length&&keys.every(k=>Object.hasOwn(o,k));
const fail=code=>{throw new Error(code);};
const lineKeys=['version','characterId','worldProfileId','timelineId','kind','recordId','speaker','source','content','delivery','committedAtUtc','turnIdentityHash','utteranceId','transcription','deliveryReceiptId'];
const eventKeys=['version','characterId','worldProfileId','timelineId','kind','recordId','observationId','revision','eventType','receivedAtUtc','sourceHash','ownerProof','receiptStatus','claims'];
function scope(e,world){if(!e||e.version!==1||!isUuid(e.characterId)||e.worldProfileId!==world||!isUuid(e.timelineId)||!isUuid(e.recordId))fail('journal_invalid_scope');}
export function validateDialogueLine(e,world){
  scope(e,world);
  if(!exact(e,lineKeys)||e.kind!=='dialogue_line'||!['player','npc'].includes(e.speaker)||
    !['typed','stt','npc_generated'].includes(e.source)||!validText(e.content,1,12000)||!utc(e.committedAtUtc)||
    !hex(e.turnIdentityHash)||!(e.utteranceId===null||isUuid(e.utteranceId))||
    !(e.deliveryReceiptId===null||isUuid(e.deliveryReceiptId)))fail('journal_invalid_dialogue');
  if(e.speaker==='player'){
    if(!['typed','stt'].includes(e.source)||e.delivery!=='accepted'||e.deliveryReceiptId!==null)fail('journal_unaccepted_dialogue');
  }else if(e.source!=='npc_generated'||e.delivery!=='completed'||!isUuid(e.deliveryReceiptId)||e.transcription!==null)
    fail('journal_unverified_playback');
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
"CREATE TABLE dialogue_journal (record_id TEXT PRIMARY KEY,world_profile_id TEXT NOT NULL,timeline_id TEXT NOT NULL REFERENCES timelines(timeline_id),character_id TEXT NOT NULL REFERENCES promoted_profiles(character_id),session_id TEXT NOT NULL,protagonist TEXT NOT NULL CHECK(protagonist IN ('franklin','michael','trevor','unknown')),host_run_id TEXT,world_epoch INTEGER,speaker TEXT NOT NULL,source TEXT NOT NULL,delivery TEXT NOT NULL,turn_identity_hash TEXT NOT NULL,committed_at_utc TEXT NOT NULL,content TEXT NOT NULL,content_sha256 TEXT NOT NULL,receipt_id TEXT,envelope_json TEXT NOT NULL,UNIQUE(character_id,timeline_id,speaker,turn_identity_hash));",
"CREATE INDEX dialogue_scope_recent ON dialogue_journal(world_profile_id,character_id,timeline_id,committed_at_utc DESC);",
"CREATE INDEX dialogue_session_recent ON dialogue_journal(character_id,timeline_id,session_id,committed_at_utc DESC);",
"CREATE VIRTUAL TABLE dialogue_journal_fts USING fts5(content,content='dialogue_journal',content_rowid='rowid',tokenize='unicode61');",
"CREATE TRIGGER dialogue_fts_insert AFTER INSERT ON dialogue_journal BEGIN INSERT INTO dialogue_journal_fts(rowid,content) VALUES(new.rowid,new.content); END;",
"CREATE TRIGGER dialogue_fts_delete AFTER DELETE ON dialogue_journal BEGIN INSERT INTO dialogue_journal_fts(dialogue_journal_fts,rowid,content) VALUES('delete',old.rowid,old.content); END;",
"CREATE TABLE event_journal (record_id TEXT PRIMARY KEY,world_profile_id TEXT NOT NULL,timeline_id TEXT NOT NULL REFERENCES timelines(timeline_id),character_id TEXT NOT NULL REFERENCES promoted_profiles(character_id),observation_id TEXT NOT NULL,revision INTEGER NOT NULL,event_type TEXT NOT NULL,received_at_utc TEXT NOT NULL,source_hash TEXT NOT NULL,receipt_status TEXT NOT NULL,envelope_json TEXT NOT NULL,envelope_sha256 TEXT NOT NULL,UNIQUE(character_id,timeline_id,observation_id,revision));",
"CREATE INDEX event_scope_recent ON event_journal(world_profile_id,character_id,timeline_id,received_at_utc DESC);",
"CREATE INDEX event_type_recent ON event_journal(character_id,timeline_id,event_type,received_at_utc DESC);"
].join('\n');
const tables=['dialogue_journal','dialogue_journal_fts','event_journal'];
export function migrateJournalSchema(db){
  const v=db.prepare('PRAGMA user_version').get().user_version;
  if(v!==2&&v!==JOURNAL_SCHEMA_VERSION)fail('unsupported_sqlite_profile_schema');
  if(v===JOURNAL_SCHEMA_VERSION){
    for(const name of tables)if(!db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(name))fail('sqlite_journal_schema_incomplete');
    return v;
  }
  db.exec('BEGIN IMMEDIATE');
  try{db.exec(DDL);db.exec('PRAGMA user_version=3');db.exec('COMMIT');return JOURNAL_SCHEMA_VERSION;}
  catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
export function assertJournalSchema(db){
  if(db.prepare('PRAGMA user_version').get().user_version!==JOURNAL_SCHEMA_VERSION)fail('sqlite_journal_schema_missing');
  for(const name of tables)if(!db.prepare('SELECT name FROM sqlite_master WHERE name=?').get(name))fail('sqlite_journal_schema_incomplete');
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
  const old=db.prepare('SELECT envelope_json,content_sha256 FROM dialogue_journal WHERE character_id=? AND timeline_id=? AND speaker=? AND turn_identity_hash=?')
    .get(e.characterId,e.timelineId,e.speaker,e.turnIdentityHash);
  if(old){
    const previous=JSON.parse(old.envelope_json),{recordId:ignored,...a}=previous,{recordId:ignored2,...b}=e;
    if(JSON.stringify(a)!==JSON.stringify(b)||old.content_sha256!==hash(e.content))fail('journal_replay_conflict');
    return Object.freeze({inserted:false,recordId:previous.recordId});
  }
  db.prepare('INSERT INTO dialogue_journal (record_id,world_profile_id,timeline_id,character_id,session_id,protagonist,host_run_id,world_epoch,speaker,source,delivery,turn_identity_hash,committed_at_utc,content,content_sha256,receipt_id,envelope_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(e.recordId,e.worldProfileId,e.timelineId,e.characterId,attribution.sessionId,attribution.protagonist,attribution.hostRunId,
      attribution.worldEpoch,e.speaker,e.source,e.delivery,e.turnIdentityHash,e.committedAtUtc,e.content,hash(e.content),
      e.deliveryReceiptId,JSON.stringify(e));
  return Object.freeze({inserted:true,recordId:e.recordId});
}
export function appendEvent(db,event,world,{hostContext=null}={}){
  assertJournalSchema(db);const e=validateJournalEvent(event,world),alias=owner(db,e,world);
  if(alias!==e.ownerProof.ownerAlias)fail('journal_owner_proof_mismatch');
  if(hostContext&&(hostContext.hostRunId!==e.ownerProof.hostRunId||hostContext.worldEpoch!==e.ownerProof.worldEpoch))
    fail('journal_source_epoch_mismatch');
  const old=db.prepare('SELECT envelope_json FROM event_journal WHERE character_id=? AND timeline_id=? AND observation_id=? AND revision=?')
    .get(e.characterId,e.timelineId,e.observationId,e.revision);
  if(old){
    const previous=JSON.parse(old.envelope_json),{recordId:ignored,...a}=previous,{recordId:ignored2,...b}=e;
    if(JSON.stringify(a)!==JSON.stringify(b))fail('journal_replay_conflict');
    return Object.freeze({inserted:false,recordId:previous.recordId});
  }
  const raw=JSON.stringify(e);
  db.prepare('INSERT INTO event_journal(record_id,world_profile_id,timeline_id,character_id,observation_id,revision,event_type,received_at_utc,source_hash,receipt_status,envelope_json,envelope_sha256) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(e.recordId,e.worldProfileId,e.timelineId,e.characterId,e.observationId,e.revision,e.eventType,e.receivedAtUtc,
      e.sourceHash,e.receiptStatus,raw,hash(raw));
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
  if(value.content!==row.content||hash(value.content)!==row.content_sha256)fail('journal_content_integrity_failed');
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
