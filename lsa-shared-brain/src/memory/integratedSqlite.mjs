// Additive PS5 memory records in the single P2 SQLite writer.
// All mutations are invoked from P2SqliteProfileStore.withTimelineWrite.
import {createHash} from 'node:crypto';
import {ensureSuppressionSchema,suppressedMemoryIds,suppressionClosure,retainSuppression,isSuppressedSource} from './suppressionSqlite.mjs';
import {isUuid,immutableSnapshot} from '../util/identity.mjs';
const digest=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const fail=reason=>{throw new Error(reason)};
const sql=`
CREATE TABLE IF NOT EXISTS memory_records (
 memory_id TEXT PRIMARY KEY,character_id TEXT NOT NULL,world_profile_id TEXT NOT NULL,
 timeline_id TEXT NOT NULL,protagonist_key TEXT NOT NULL,origin TEXT NOT NULL,
 content TEXT NOT NULL,content_sha256 TEXT NOT NULL,mode TEXT NOT NULL,
 pin INTEGER NOT NULL,notability REAL NOT NULL,evidence_ids_json TEXT NOT NULL,
 created_at_utc TEXT NOT NULL,proposal_json TEXT);
CREATE INDEX IF NOT EXISTS memory_records_scope ON memory_records(world_profile_id,character_id,timeline_id,created_at_utc DESC);
CREATE TABLE IF NOT EXISTS memory_commands (
 command_id TEXT PRIMARY KEY,character_id TEXT NOT NULL,world_profile_id TEXT NOT NULL,
 timeline_id TEXT NOT NULL,protagonist_key TEXT NOT NULL,requested_by_line_id TEXT NOT NULL,
 operation TEXT NOT NULL,request_sha256 TEXT NOT NULL,receipt_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_tombstones (
 character_id TEXT NOT NULL,world_profile_id TEXT NOT NULL,timeline_id TEXT NOT NULL,
 target_id TEXT NOT NULL,command_id TEXT NOT NULL,created_at_utc TEXT NOT NULL,
 PRIMARY KEY(character_id,world_profile_id,timeline_id,target_id));
CREATE TABLE IF NOT EXISTS memory_corrections (
 command_id TEXT PRIMARY KEY,character_id TEXT NOT NULL,world_profile_id TEXT NOT NULL,
 timeline_id TEXT NOT NULL,target_id TEXT NOT NULL,preferred_text TEXT NOT NULL,
 content_sha256 TEXT NOT NULL,created_at_utc TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memory_curation_jobs (
 job_id TEXT PRIMARY KEY,character_id TEXT NOT NULL,world_profile_id TEXT NOT NULL,
 timeline_id TEXT NOT NULL,job_json TEXT NOT NULL,state TEXT NOT NULL,
 next_attempt_at_utc TEXT NOT NULL,attempt INTEGER NOT NULL,
 lease_token TEXT,lease_until_utc TEXT,lease_owner TEXT);
CREATE INDEX IF NOT EXISTS memory_queue_due ON memory_curation_jobs(state,next_attempt_at_utc);
CREATE TABLE IF NOT EXISTS memory_budget_reservations (
 batch_key TEXT PRIMARY KEY,world_profile_id TEXT NOT NULL,amount_usd REAL NOT NULL,
 reserved_at_utc TEXT NOT NULL,state TEXT NOT NULL);
`;
export function ensureIntegratedMemorySchema(db){db.exec(sql);ensureSuppressionSchema(db);}
// The single P2 foundation transaction helper is used by all callers.
function transact(db,work){
 db.exec('BEGIN IMMEDIATE');
 try{const out=work();if(out&&typeof out.then==='function')fail('memory_async_sqlite_transaction');db.exec('COMMIT');return out;}
 catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
function validScope(scope,world){
 if(!scope||!isUuid(scope.characterId)||!isUuid(scope.timelineId)||scope.worldProfileId!==world||
    !['franklin','michael','trevor','unknown'].includes(scope.protagonistKey??'unknown'))
   fail('memory_invalid_scope');
 return scope;
}
function dbOwnerScope(db,scope,world){
 validScope(scope,world);
 if(!db.prepare('SELECT character_id FROM promoted_profiles WHERE character_id=?').get(scope.characterId)||
    !db.prepare('SELECT timeline_id FROM timelines WHERE timeline_id=? AND world_profile_id=?').get(scope.timelineId,world))
   fail('memory_owner_or_timeline_unknown');
}
const stmtScope=(scope)=>[scope.worldProfileId,scope.characterId,scope.timelineId];
const fullJournalSchemas=new WeakMap();
function fullDialogueIntegritySchema(db){
 if(!fullJournalSchemas.has(db)){
   const cols=new Set(db.prepare('PRAGMA table_info(dialogue_journal)').all().map(x=>x.name));
   const full=['content','content_sha256','envelope_json','envelope_sha256','committed_at_utc'].every(x=>cols.has(x));
   // Production v4 cannot downgrade into the fixture-only source reader.
   if(!full&&db.prepare('PRAGMA user_version').get().user_version===4)
     fail('memory_journal_integrity_schema_missing');
   fullJournalSchemas.set(db,full);
 }
 return fullJournalSchemas.get(db);
}
// Evidence is scoped to an NPC/save, not to the historical avatar. Validate
// *each* source before allowing an explicit or curated memory to depend on it.
function knownEvidence(db,scope,id,parents=new Set(),revoked=null){
 if(!isUuid(id)||parents.has(id)||parents.size>=32||revoked?.has(id))return null;
 // Production P2 always has journal envelope/content digests. Tiny offline
 // curation fixtures may install only source/acceptance columns; those cannot
 // attest bytes and must never masquerade as a production P2 read.
 const full=fullDialogueIntegritySchema(db);
 const projection=full
   ?'record_id AS recordId,content,content_sha256 AS contentHash,envelope_json AS raw,envelope_sha256 AS rawHash,committed_at_utc AS occurredAtUtc,speaker,source,delivery,protagonist AS protagonistKey'
   :'record_id AS recordId,speaker,source,delivery,protagonist AS protagonistKey';
 let row=db.prepare('SELECT '+projection+' FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND record_id=?').get(...stmtScope(scope),id);
 if(row){
   if(full){
     if(digest(row.content)!==row.contentHash||digest(row.raw)!==row.rawHash)return null;
     let e;try{e=JSON.parse(row.raw);}catch{return null;}
     if(e.recordId!==id||e.content!==row.content||e.speaker!==row.speaker||
       e.source!==row.source||e.delivery!==row.delivery||
       e.attribution?.protagonist&&e.attribution.protagonist!==row.protagonistKey)return null;
   }
   const accepted=row.speaker==='player'&&['typed','stt'].includes(row.source)&&row.delivery==='accepted';
   const played=row.speaker==='npc'&&row.source==='npc_generated'&&row.delivery==='completed';
   return accepted||played?{...row,kind:'dialogue_line'}:null;
 }
 // Only a complete P2 v4 event journal can attest witnessed evidence. Offline
 // curation fixtures omit that schema and never certify native events.
 row=full?db.prepare('SELECT e.record_id AS recordId,e.envelope_json AS json,e.envelope_sha256 AS envelopeHash,e.source_hash AS eventHash,e.receipt_status AS receiptStatus,e.received_at_utc AS occurredAtUtc,s.source_evidence_json AS sidecar,s.source_evidence_sha256 AS sidecarHash FROM event_journal e JOIN event_source_evidence s ON s.record_id=e.record_id WHERE e.world_profile_id=? AND e.character_id=? AND e.timeline_id=? AND e.record_id=?').get(...stmtScope(scope),id):null;
 if(row){
   if(row.receiptStatus!=='witnessed'||digest(row.json)!==row.envelopeHash||digest(row.sidecar)!==row.sidecarHash)return null;
   try{
     const e=JSON.parse(row.json),sidecar=JSON.parse(row.sidecar);
     if(e.recordId!==id||e.sourceHash!==row.eventHash||sidecar.sourceHash!==row.eventHash||
        !Array.isArray(e.claims))return null;
     return {...row,kind:'journal_event',content:e.eventType+': '+e.claims.map(c=>c.kind+' '+c.durableSubject).join('; '),eventType:e.eventType};
   }catch{return null;}
 }
 row=db.prepare('SELECT memory_id AS recordId,content,content_sha256 AS contentHash,evidence_ids_json AS sources,created_at_utc AS occurredAtUtc,protagonist_key AS protagonistKey FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND memory_id=?').get(...stmtScope(scope),id);
 if(!row||digest(row.content)!==row.contentHash)return null;
 try{
   const ids=JSON.parse(row.sources),next=new Set(parents).add(id);
   if(!Array.isArray(ids)||!ids.length||ids.length>64||!ids.every(isUuid)||
      !ids.every(source=>knownEvidence(db,scope,source,next,revoked)))return null;
   return {...row,kind:'permanent_memory'};
 }catch{return null;}
}
// Reuse the production source-byte/provenance verifier at Luna boundaries.
export function verifyMemoryEvidence(db,scope,id,revoked){
 return !!knownEvidence(db,scope,id,new Set(),revoked);
}
export function listMemoryCandidates(db,scope,world,{beforeUtc=null,excludeRecordId=null}={}){
 dbOwnerScope(db,scope,world);
 const rows=[];
 const revoked=new Set([...listSuppressedMemoryIds(db,scope,world),...db.prepare('SELECT target_id FROM memory_corrections WHERE world_profile_id=? AND character_id=? AND timeline_id=?').all(...stmtScope(scope)).map(x=>x.target_id)]);
 const dialogue=db.prepare('SELECT record_id AS recordId,content,committed_at_utc AS occurredAtUtc,speaker,source,delivery,protagonist AS protagonistKey FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? ORDER BY committed_at_utc DESC LIMIT 200').all(...stmtScope(scope));
 for(const d of dialogue)if(knownEvidence(db,scope,d.recordId))
   rows.push({...scope,...d,kind:'dialogue_line'});
 const events=db.prepare('SELECT e.record_id AS recordId,e.envelope_json AS json,e.receipt_status AS receiptStatus,e.received_at_utc AS occurredAtUtc FROM event_journal e JOIN event_source_evidence s ON s.record_id=e.record_id WHERE e.world_profile_id=? AND e.character_id=? AND e.timeline_id=? ORDER BY e.received_at_utc DESC LIMIT 200').all(...stmtScope(scope));
 for(const e of events){
   const source=knownEvidence(db,scope,e.recordId);
   if(source?.kind==='journal_event')rows.push({...scope,protagonistKey:'unknown',kind:'journal_event',
     recordId:e.recordId,receiptStatus:e.receiptStatus,occurredAtUtc:e.occurredAtUtc,
     eventType:source.eventType,content:source.content});
 }
 const permanent=db.prepare('SELECT memory_id AS recordId,content,created_at_utc AS occurredAtUtc,protagonist_key AS protagonistKey FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=? ORDER BY created_at_utc DESC LIMIT 200').all(...stmtScope(scope));
 for(const p of permanent)if(knownEvidence(db,scope,p.recordId,new Set(),revoked))
   rows.push({...scope,...p,kind:'permanent_memory'});
 return immutableSnapshot(rows.filter(x=>!revoked.has(x.recordId)&&x.recordId!==excludeRecordId&&(!beforeUtc||x.occurredAtUtc<=beforeUtc)));
}
export function listSuppressedMemoryIds(db,scope,world){
 dbOwnerScope(db,scope,world);
 return Object.freeze([...suppressedMemoryIds(db,scope)]);
}
export function verifyPersistedMemoryCommand(db,{scope,commandId},world){
 dbOwnerScope(db,scope,world);
 if(!isUuid(commandId))fail('memory_invalid_command_id');
 const row=db.prepare('SELECT * FROM memory_commands WHERE command_id=? AND world_profile_id=? AND character_id=? AND timeline_id=?')
 .get(commandId,...stmtScope(scope));
 if(!row)return null;
 const receipt=JSON.parse(row.receipt_json);
 if(receipt.commandId!==commandId||receipt.requestedByLineId!==row.requested_by_line_id||receipt.operation!==row.operation||
    receipt.durableCommit!==true||receipt.status!=='committed')fail('memory_corrupted_command_receipt');
 return immutableSnapshot(receipt);
}
export function commitPersistedMemoryCommand(db,o,world){
 const scope=o?.scope;dbOwnerScope(db,scope,world);
 if(!isUuid(o.commandId)||!isUuid(o.requestedByLineId)||!['remember','forget','correct'].includes(o.operation)||
    typeof o.content!=='string'||!o.content.trim()||o.content.length>12000||digest(o.content)!==o.contentHash||
    !Array.isArray(o.evidenceRecordIds)||!o.evidenceRecordIds.includes(o.requestedByLineId)||
    o.evidenceRecordIds.some(id=>!isUuid(id))||o.evidenceRecordIds.length>64)fail('memory_invalid_command');
 return transact(db,()=>{
   const old=db.prepare('SELECT request_sha256,receipt_json FROM memory_commands WHERE command_id=?').get(o.commandId);
   const requestHash=digest(o);
   if(old){if(old.request_sha256!==requestHash)fail('memory_conflicting_command');return JSON.parse(old.receipt_json);}
   const source=db.prepare('SELECT source,speaker,delivery,protagonist FROM dialogue_journal WHERE record_id=? AND world_profile_id=? AND character_id=? AND timeline_id=?').get(o.requestedByLineId,...stmtScope(scope));
   if(!source||source.speaker!=='player'||!['typed','stt'].includes(source.source)||
      source.delivery!=='accepted'||source.protagonist!==(scope.protagonistKey??'unknown'))fail('memory_source_not_accepted');
   const suppressed=suppressedMemoryIds(db,scope);
   for(const id of o.evidenceRecordIds){
     if(!knownEvidence(db,scope,id))fail('memory_evidence_not_found');
     if(suppressed.has(id))
       fail('memory_source_forgotten');
   }
   if(o.operation!=='remember'&&(!isUuid(o.targetRecordId)||!knownEvidence(db,scope,o.targetRecordId)))
     fail('memory_target_not_found');
   const memoryId=o.commandId,when=o.requestedAtUtc;
   if(!Number.isFinite(Date.parse(when)))fail('memory_invalid_time');
   if(o.operation==='remember'){
     if(isSuppressedSource(db,scope,{recordId:memoryId,kind:'permanent_memory',contentHash:o.contentHash}))
       fail('memory_source_forgotten');
     db.prepare('INSERT INTO memory_records(memory_id,character_id,world_profile_id,timeline_id,protagonist_key,origin,content,content_sha256,mode,pin,notability,evidence_ids_json,created_at_utc,proposal_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)')
      .run(memoryId,scope.characterId,scope.worldProfileId,scope.timelineId,scope.protagonistKey??'unknown','explicit_player',o.content,o.contentHash,'reported_claim',o.pin?1:0,o.pin?.95:.85,JSON.stringify(o.evidenceRecordIds),when);
   } else if(o.operation==='forget'){
     const closure=suppressionClosure(db,scope,[o.targetRecordId]);
     retainSuppression(db,scope,closure,o.commandId);
     for(const target of closure)db.prepare('INSERT OR IGNORE INTO memory_tombstones(character_id,world_profile_id,timeline_id,target_id,command_id,created_at_utc) VALUES(?,?,?,?,?,?)')
       .run(scope.characterId,scope.worldProfileId,scope.timelineId,target,o.commandId,when);
   } else {
     db.prepare('INSERT INTO memory_corrections(command_id,character_id,world_profile_id,timeline_id,target_id,preferred_text,content_sha256,created_at_utc) VALUES(?,?,?,?,?,?,?,?)')
       .run(o.commandId,scope.characterId,scope.worldProfileId,scope.timelineId,o.targetRecordId,o.content,o.contentHash,when);
   }
   const receipt={commandId:o.commandId,requestedByLineId:o.requestedByLineId,operation:o.operation,status:'committed',
     durableCommit:true,memoryId,evidenceRecordIds:o.evidenceRecordIds};
   db.prepare('INSERT INTO memory_commands(command_id,character_id,world_profile_id,timeline_id,protagonist_key,requested_by_line_id,operation,request_sha256,receipt_json) VALUES(?,?,?,?,?,?,?,?,?)')
     .run(o.commandId,scope.characterId,scope.worldProfileId,scope.timelineId,scope.protagonistKey??'unknown',
       o.requestedByLineId,o.operation,requestHash,JSON.stringify(receipt));
   return immutableSnapshot(receipt);
 });
}
export function persistDeterministicMemory(db,proposal,world){
 const scope={characterId:proposal?.characterId,worldProfileId:proposal?.worldProfileId,timelineId:proposal?.timelineId,protagonistKey:'unknown'};
 dbOwnerScope(db,scope,world);
 const revoked=suppressedMemoryIds(db,scope);
 if(revoked.has(proposal?.proposalId)||proposal?.evidenceRecordIds?.some(id=>revoked.has(id)))fail('curation_source_forgotten');
 // The M0 proposal has no protagonist property. Resolve it exclusively from
 // committed evidence, never guess from a name or the current player's ped.
 const protagonists=new Set();
 for(const evidenceId of proposal?.evidenceRecordIds??[]){
   const dialogue=db.prepare('SELECT protagonist FROM dialogue_journal WHERE record_id=? AND world_profile_id=? AND character_id=? AND timeline_id=?')
     .get(evidenceId,...stmtScope(scope));
   if(dialogue)protagonists.add(dialogue.protagonist);
   else {
     const event=db.prepare('SELECT e.record_id FROM event_journal e JOIN event_source_evidence s ON s.record_id=e.record_id WHERE e.record_id=? AND e.world_profile_id=? AND e.character_id=? AND e.timeline_id=?')
       .get(evidenceId,...stmtScope(scope));
     if(!event)fail('memory_unverified_curation_source');
     protagonists.add('unknown');
   }
 }
 if(!protagonists.size)fail('memory_unverified_curation_source');
 // Multi-avatar aggregates lack a single source avatar; original evidence keeps provenance.
 scope.protagonistKey=protagonists.size===1?[...protagonists][0]:'unknown';
 if(proposal?.kind!=='curation_proposal'||proposal.provider!=='deterministic'||
    !isUuid(proposal.proposalId)||!Array.isArray(proposal.evidenceRecordIds)||!proposal.evidenceRecordIds.length||
    proposal.evidenceRecordIds.length>64||!Number.isFinite(proposal.notability)||proposal.notability<0||proposal.notability>1||
    typeof proposal.groundedSummary!=='string'||!proposal.groundedSummary.length)fail('memory_invalid_proposal');
 return transact(db,()=>{
   const suppressed=suppressedMemoryIds(db,scope);
   if(suppressed.has(proposal.proposalId)||proposal.evidenceRecordIds.some(id=>suppressed.has(id))||
      isSuppressedSource(db,scope,{recordId:proposal.proposalId,kind:'permanent_memory',contentHash:digest(proposal.groundedSummary)}))
     fail('curation_source_forgotten');
   const old=db.prepare('SELECT proposal_json FROM memory_records WHERE memory_id=?').get(proposal.proposalId);
   if(old){if(old.proposal_json!==JSON.stringify(proposal))fail('memory_proposal_replay_conflict');return {inserted:false,recordId:proposal.proposalId};}
   for(const id of proposal.evidenceRecordIds){
     if(!knownEvidence(db,scope,id))fail('memory_unverified_curation_source');
     if(suppressed.has(id))fail('curation_source_forgotten');
   }
   db.prepare('INSERT INTO memory_records(memory_id,character_id,world_profile_id,timeline_id,protagonist_key,origin,content,content_sha256,mode,pin,notability,evidence_ids_json,created_at_utc,proposal_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
     .run(proposal.proposalId,scope.characterId,scope.worldProfileId,scope.timelineId,scope.protagonistKey,'deterministic',proposal.groundedSummary,
       digest(proposal.groundedSummary),'reported_claim',0,proposal.notability,JSON.stringify(proposal.evidenceRecordIds),new Date().toISOString(),JSON.stringify(proposal));
   return {inserted:true,recordId:proposal.proposalId};
 });
}

/** Read-only typed M4 projection; never uses model-generated factual authority. */
export function readPermanentMemoryRows(db,scope,world,{limit=200}={}){
 dbOwnerScope(db,scope,world);
 if(!Number.isSafeInteger(limit)||limit<1||limit>1000)fail('memory_invalid_limit');
 const revoked=new Set([...listSuppressedMemoryIds(db,scope,world),...db.prepare('SELECT target_id FROM memory_corrections WHERE world_profile_id=? AND character_id=? AND timeline_id=?').all(...stmtScope(scope)).map(x=>x.target_id)]);
 // Page until we have LIMIT *verified and visible* memories. Filtering after a
 // raw SQL LIMIT could hide all older valid memories behind corrected rows.
 const page=db.prepare('SELECT * FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=? ORDER BY created_at_utc DESC,memory_id DESC LIMIT ? OFFSET ?');
 const valid=[];let offset=0;
 while(valid.length<limit){
   const rows=page.all(...stmtScope(scope),128,offset);
   if(!rows.length)break;
   offset+=rows.length;
   for(const row of rows){
     if(digest(row.content)!==row.content_sha256)fail('memory_content_integrity_failed');
     let ids;
     try{ids=JSON.parse(row.evidence_ids_json);}catch{fail('memory_source_integrity_failed');}
     if(!Array.isArray(ids)||!ids.length||ids.length>64||!ids.every(isUuid))
       fail('memory_source_integrity_failed');
     if(revoked.has(row.memory_id)||!knownEvidence(db,scope,row.memory_id,new Set(),revoked))continue;
     valid.push({characterId:scope.characterId,worldProfileId:scope.worldProfileId,
       timelineId:scope.timelineId,protagonistKey:row.protagonist_key,recordId:row.memory_id,
       sourceKind:'permanent_memory',evidenceState:'verified',atUtc:row.created_at_utc,
       envelope:{version:1,kind:'permanent_memory',characterId:scope.characterId,
         worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,recordId:row.memory_id,
         content:row.content,mode:row.mode,sourceEvidenceIds:ids}});
     if(valid.length===limit)break;
   }
   if(rows.length<128)break;
 }
 return immutableSnapshot(valid);
}

/** A correction is player-reported counterevidence, NEVER a rewrite of source text. */
export function readCorrectionOverlays(db,scope,world){
 dbOwnerScope(db,scope,world);
 const data=db.prepare(`SELECT c.command_id AS commandId,c.target_id AS targetId,
   c.preferred_text AS content,c.content_sha256 AS checksum,c.created_at_utc AS atUtc,m.protagonist_key AS sourceProtagonist
   FROM memory_corrections c JOIN memory_commands m ON m.command_id=c.command_id
   WHERE c.world_profile_id=? AND c.character_id=? AND c.timeline_id=?
   ORDER BY c.created_at_utc DESC`).all(...stmtScope(scope));
 const records=[];
 for(const c of data){
   if(digest(c.content)!==c.checksum)fail('memory_correction_integrity_failed');
   records.push({characterId:scope.characterId,worldProfileId:scope.worldProfileId,
     timelineId:scope.timelineId,protagonistKey:c.sourceProtagonist,
     recordId:c.commandId,sourceKind:'permanent_memory',atUtc:c.atUtc,evidenceState:'verified',
     targetId:c.targetId,
     envelope:{version:1,kind:'permanent_memory',recordId:c.commandId,
       characterId:scope.characterId,worldProfileId:scope.worldProfileId,timelineId:scope.timelineId,
       content:'Player correction (reported): '+c.content,mode:'reported_claim',
       sourceEvidenceIds:[c.targetId]}});
 }
 return immutableSnapshot(records);
}
