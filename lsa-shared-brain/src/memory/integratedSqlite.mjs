// Additive PS5 memory records in the single P2 SQLite writer.
// All mutations are invoked from P2SqliteProfileStore.withTimelineWrite.
import {createHash} from 'node:crypto';
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
export function ensureIntegratedMemorySchema(db){db.exec(sql);}
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
 const actor=dbOwnerScope;
 return scope;
}
function dbOwnerScope(db,scope,world){
 validScope(scope,world);
 if(!db.prepare('SELECT character_id FROM promoted_profiles WHERE character_id=?').get(scope.characterId)||
    !db.prepare('SELECT timeline_id FROM timelines WHERE timeline_id=? AND world_profile_id=?').get(scope.timelineId))
   fail('memory_owner_or_timeline_unknown');
}
const stmtScope=(scope)=>[scope.worldProfileId,scope.characterId,scope.timelineId];
function knownEvidence(db,scope,id){
 let row=db.prepare('SELECT record_id AS recordId,content,committed_at_utc AS occurredAtUtc, speaker,source,delivery,protagonist AS protagonistKey FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND record_id=?').get(...stmtScope(scope),id);
 if(row){
   if(row.protagonistKey!==(scope.protagonistKey??'unknown')||row.speaker==='player'&&row.delivery!=='accepted'||row.speaker==='npc'&&row.delivery!=='completed')return null;
   return {...row,kind:'dialogue_line'};
 }
 row=db.prepare('SELECT e.record_id AS recordId,e.envelope_json AS json,e.receipt_status AS receiptStatus,e.received_at_utc AS occurredAtUtc FROM event_journal e JOIN event_source_evidence s ON s.record_id=e.record_id WHERE e.world_profile_id=? AND e.character_id=? AND e.timeline_id=? AND e.record_id=?').get(...stmtScope(scope),id);
 if(row){
   // Events have no authenticated controlling-protagonist attribute in v1.
   if((scope.protagonistKey??'unknown')!=='unknown')return null;
   const e=JSON.parse(row.json);
   if(row.receiptStatus!=='witnessed')return null;
   return {...row,kind:'journal_event',content:e.eventType+': '+e.claims.map(c=>c.kind+' '+c.durableSubject).join('; '),eventType:e.eventType};
 }
 row=db.prepare('SELECT memory_id AS recordId,content,created_at_utc AS occurredAtUtc,protagonist_key AS protagonistKey FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND memory_id=?').get(...stmtScope(scope),id);
 if(row&&row.protagonistKey===(scope.protagonistKey??'unknown'))return {...row,kind:'permanent_memory'};
 return null;
}
export function listMemoryCandidates(db,scope,world,{beforeUtc=null,excludeRecordId=null}={}){
 dbOwnerScope(db,scope,world);
 const rows=[];
 const dialogue=db.prepare('SELECT record_id AS recordId,content,committed_at_utc AS occurredAtUtc,speaker,source,delivery,protagonist AS protagonistKey FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? ORDER BY committed_at_utc DESC LIMIT 200').all(...stmtScope(scope));
 for(const d of dialogue)if(d.protagonistKey===(scope.protagonistKey??'unknown'))
   rows.push({...d,kind:'dialogue_line',...scope});
 const events=db.prepare('SELECT e.record_id AS recordId,e.envelope_json AS json,e.receipt_status AS receiptStatus,e.received_at_utc AS occurredAtUtc FROM event_journal e JOIN event_source_evidence s ON s.record_id=e.record_id WHERE e.world_profile_id=? AND e.character_id=? AND e.timeline_id=? ORDER BY e.received_at_utc DESC LIMIT 200').all(...stmtScope(scope));
 if((scope.protagonistKey??'unknown')==='unknown')for(const e of events){
   const env=JSON.parse(e.json);rows.push({...scope,kind:'journal_event',recordId:e.recordId,receiptStatus:e.receiptStatus,
     occurredAtUtc:e.occurredAtUtc,eventType:env.eventType,content:env.eventType+': '+env.claims.map(c=>c.kind+' '+c.durableSubject).join('; ')});
 }
 const permanent=db.prepare('SELECT memory_id AS recordId,content,created_at_utc AS occurredAtUtc,protagonist_key AS protagonistKey FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=? ORDER BY created_at_utc DESC LIMIT 200').all(...stmtScope(scope));
 for(const p of permanent)if(p.protagonistKey===(scope.protagonistKey??'unknown'))rows.push({...scope,...p,kind:'permanent_memory'});
 const suppressed=new Set(db.prepare('SELECT target_id FROM memory_tombstones WHERE world_profile_id=? AND character_id=? AND timeline_id=?').all(...stmtScope(scope)).map(x=>x.target_id));
 return immutableSnapshot(rows.filter(x=>!suppressed.has(x.recordId)&&x.recordId!==excludeRecordId&&(!beforeUtc||x.occurredAtUtc<=beforeUtc)));
}
export function listSuppressedMemoryIds(db,scope,world){
 dbOwnerScope(db,scope,world);
 return Object.freeze(db.prepare('SELECT target_id FROM memory_tombstones WHERE world_profile_id=? AND character_id=? AND timeline_id=?').all(...stmtScope(scope)).map(x=>x.target_id));
}
export function verifyPersistedMemoryCommand(db,{scope,commandId},world){
 dbOwnerScope(db,scope,world);
 if(!isUuid(commandId))fail('memory_invalid_command_id');
 const row=db.prepare('SELECT * FROM memory_commands WHERE command_id=? AND world_profile_id=? AND character_id=? AND timeline_id=? AND protagonist_key=?')
 .get(commandId,...stmtScope(scope),scope.protagonistKey??'unknown');
 if(!row)return null;
 if(digest(row.receipt_json)!==row.request_sha256.slice(64)){} // no-op: request hash is independent from receipt.
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
   for(const id of o.evidenceRecordIds){
     if(!knownEvidence(db,scope,id))fail('memory_evidence_not_found');
     if(db.prepare('SELECT target_id FROM memory_tombstones WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND target_id=?').get(...stmtScope(scope),id))
       fail('memory_source_forgotten');
   }
   if(o.operation!=='remember'&&(!isUuid(o.targetRecordId)||!knownEvidence(db,scope,o.targetRecordId)))
     fail('memory_target_not_found');
   const memoryId=o.commandId,when=o.requestedAtUtc;
   if(!Number.isFinite(Date.parse(when)))fail('memory_invalid_time');
   if(o.operation==='remember'){
     db.prepare('INSERT INTO memory_records(memory_id,character_id,world_profile_id,timeline_id,protagonist_key,origin,content,content_sha256,mode,pin,notability,evidence_ids_json,created_at_utc,proposal_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)')
      .run(memoryId,scope.characterId,scope.worldProfileId,scope.timelineId,scope.protagonistKey??'unknown','explicit_player',o.content,o.contentHash,'reported_claim',o.pin?1:0,o.pin?.95:.85,JSON.stringify(o.evidenceRecordIds),when);
   } else if(o.operation==='forget'){
     db.prepare('INSERT INTO memory_tombstones(character_id,world_profile_id,timeline_id,target_id,command_id,created_at_utc) VALUES(?,?,?,?,?,?)')
       .run(scope.characterId,scope.worldProfileId,scope.timelineId,o.targetRecordId,o.commandId,when);
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
 if(proposal?.kind!=='curation_proposal'||proposal.provider!=='deterministic'||
    !isUuid(proposal.proposalId)||!Array.isArray(proposal.evidenceRecordIds)||!proposal.evidenceRecordIds.length||
    proposal.evidenceRecordIds.length>64||!Number.isFinite(proposal.notability)||proposal.notability<0||proposal.notability>1||
    typeof proposal.groundedSummary!=='string'||!proposal.groundedSummary.length)fail('memory_invalid_proposal');
 return transact(db,()=>{
   const old=db.prepare('SELECT proposal_json FROM memory_records WHERE memory_id=?').get(proposal.proposalId);
   if(old){if(old.proposal_json!==JSON.stringify(proposal))fail('memory_proposal_replay_conflict');return {inserted:false,recordId:proposal.proposalId};}
   for(const id of proposal.evidenceRecordIds){
     if(!knownEvidence(db,scope,id))fail('memory_unverified_curation_source');
     if(db.prepare('SELECT target_id FROM memory_tombstones WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND target_id=?').get(...stmtScope(scope),id))
       fail('memory_source_forgotten');
   }
   db.prepare('INSERT INTO memory_records(memory_id,character_id,world_profile_id,timeline_id,protagonist_key,origin,content,content_sha256,mode,pin,notability,evidence_ids_json,created_at_utc,proposal_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
     .run(proposal.proposalId,scope.characterId,scope.worldProfileId,scope.timelineId,'unknown','deterministic',proposal.groundedSummary,
       digest(proposal.groundedSummary),'reported_claim',0,proposal.notability,JSON.stringify(proposal.evidenceRecordIds),new Date().toISOString(),JSON.stringify(proposal));
   return {inserted:true,recordId:proposal.proposalId};
 });
}
