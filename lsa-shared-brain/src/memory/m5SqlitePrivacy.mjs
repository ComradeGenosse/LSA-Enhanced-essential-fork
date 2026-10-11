// M5-owned additive SQLite services. ONE P2 database file, not a memory
// database or daemon. This module never accesses the foundation's private db.
// Every mutation enters the P2 serialized timeline/source gate first.
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { isUuid } from '../util/identity.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
const timestamp = value => typeof value==='string' && Number.isFinite(Date.parse(value));
const protagonists = new Set(['franklin','michael','trevor','unknown']);
const scopeKey = s => [s.worldProfileId,s.characterId,s.timelineId,s.protagonistKey??'unknown'];
const scopeWhere = 'world_profile_id=? AND character_id=? AND timeline_id=? AND protagonist_key=?';
const DAY = 86400000;
const CLARIFY_MS = 5*60000;
const sql = `
CREATE TABLE IF NOT EXISTS m5_clarifications (
 command_id TEXT PRIMARY KEY,world_profile_id TEXT NOT NULL,character_id TEXT NOT NULL,
 timeline_id TEXT NOT NULL,protagonist_key TEXT NOT NULL,requested_by_line_id TEXT NOT NULL,
 state_json TEXT NOT NULL,state_sha256 TEXT NOT NULL,expires_at_utc TEXT NOT NULL,
 completed_at_utc TEXT);
CREATE INDEX IF NOT EXISTS m5_clarification_scope
 ON m5_clarifications(world_profile_id,character_id,timeline_id,protagonist_key,expires_at_utc);
CREATE TABLE IF NOT EXISTS m5_trash (
 trash_id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,target_id TEXT NOT NULL,
 world_profile_id TEXT NOT NULL,character_id TEXT NOT NULL,timeline_id TEXT NOT NULL,
 protagonist_key TEXT NOT NULL,created_at_utc TEXT NOT NULL,purge_after_utc TEXT NOT NULL,
 restored_at_utc TEXT,purged_at_utc TEXT);
CREATE INDEX IF NOT EXISTS m5_trash_scope
 ON m5_trash(world_profile_id,character_id,timeline_id,protagonist_key,target_id);
CREATE TABLE IF NOT EXISTS m5_privacy_ops (
 operation_id TEXT PRIMARY KEY,world_profile_id TEXT NOT NULL,character_id TEXT NOT NULL,
 timeline_id TEXT NOT NULL,protagonist_key TEXT NOT NULL,request_sha256 TEXT NOT NULL,
 receipt_json TEXT NOT NULL);
`;

function transaction(db,fn){
 db.exec('BEGIN IMMEDIATE');
 try {const value=fn();if(value?.then)fail('m5_async_transaction');db.exec('COMMIT');return value;}
 catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}
}
function validateScope(s,store){
 if(!s || ![s.characterId,s.worldProfileId,s.timelineId].every(isUuid) ||
    !protagonists.has(s.protagonistKey??'unknown') || s.worldProfileId!==store.worldProfileId)
   fail('m5_invalid_scope');
}
function verifyOwner(db,s){
 const owner=db.prepare('SELECT character_id FROM promoted_profiles WHERE character_id=?').get(s.characterId);
 const timeline=db.prepare('SELECT timeline_id FROM timelines WHERE timeline_id=? AND world_profile_id=?').get(s.timelineId,s.worldProfileId);
 if(!owner||!timeline)fail('m5_unverified_owner_or_timeline');
}
function evidence(db,s,id){
 if(!isUuid(id))return null;
 const args=[s.worldProfileId,s.characterId,s.timelineId,id];
 const dialogue=db.prepare('SELECT content,protagonist AS protagonistKey FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND record_id=?').get(...args);
 if(dialogue && dialogue.protagonistKey===(s.protagonistKey??'unknown'))return {kind:'dialogue_line',content:dialogue.content};
 const memory=db.prepare('SELECT content,protagonist_key AS protagonistKey FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND memory_id=?').get(...args);
 if(memory && memory.protagonistKey===(s.protagonistKey??'unknown'))return {kind:'permanent_memory',content:memory.content};
 if((s.protagonistKey??'unknown')==='unknown'){
   const event=db.prepare('SELECT e.envelope_json AS content FROM event_journal e JOIN event_source_evidence v ON v.record_id=e.record_id WHERE e.world_profile_id=? AND e.character_id=? AND e.timeline_id=? AND e.record_id=? AND e.receipt_status=?').get(...args,'witnessed');
   if(event)return {kind:'journal_event',content:event.content};
 }
 return null;
}
function superseded(db,s,id){
 return !!db.prepare('SELECT c.command_id FROM memory_corrections c JOIN memory_commands m ON m.command_id=c.command_id WHERE c.world_profile_id=? AND c.character_id=? AND c.timeline_id=? AND m.protagonist_key=? AND c.target_id=? LIMIT 1')
   .get(...scopeKey(s),id);
}
function activeTombstone(db,s,id) {
 return db.prepare('SELECT command_id AS commandId FROM memory_tombstones WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND target_id=?').get(s.worldProfileId,s.characterId,s.timelineId,id);
}
function dependentIds(db,s,ids){
 const found=new Set(ids);
 const rows=db.prepare('SELECT memory_id AS id,evidence_ids_json AS sources FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND protagonist_key=?')
   .all(...scopeKey(s));
 let grew=true;
 while(grew){
   grew=false;
   for(const row of rows){
     const sources=JSON.parse(row.sources);
     if(!Array.isArray(sources)||!sources.every(isUuid))fail('m5_corrupt_provenance');
     if(sources.some(v=>found.has(v))&&!found.has(row.id)){found.add(row.id);grew=true;}
   }
 }
 return [...found];
}
function authorizeRequest(authorize,s,operation){
 if(typeof authorize!=='function'||authorize({scope:{...s},operation})!==true)
   fail('m5_privacy_authorization_required');
}
const receipt = (operationId,operation,targetIds,atUtc)=>Object.freeze({
  version:1,kind:'m5_privacy_receipt',operationId,operation,targetIds,
  committedAtUtc:atUtc,durableCommit:true
});

/** A gated auxiliary connection to the EXISTING P2 file. Constructor does not
 * create a DB or bypass P2 native authority. Call ready() before use.
 */
export class M5SqliteServices{
 #db=null;#store;#clock;#authorize;
 constructor({store,filePath,clock=()=>new Date().toISOString(),authorize}={}){
   if(!store||typeof store.withTimelineWrite!=='function'||!store.filePath||
      path.resolve(filePath??'')!==path.resolve(store.filePath))fail('m5_p2_store_required');
   this.filePath=path.resolve(filePath);
   this.#store=store;this.#clock=clock;this.#authorize=authorize;
 }
 async ready(scope){
   validateScope(scope,this.#store);
   await this.#store.initialize();
   return this.#store.withTimelineWrite(scope.timelineId,()=>{
     if(!this.#db){
       this.#db=new DatabaseSync(this.filePath);
       this.#db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL;');
     }
     verifyOwner(this.#db,scope);
     this.#db.exec(sql);
     // Catch legacy M5 "forget" commands already durably committed by PR #61.
     // The core tombstone suppresses retrieval immediately; this additive
     // bookkeeping makes seven-day restore/purge available after reconnect.
     transaction(this.#db,()=>{
       const forgotten=this.#db.prepare(`SELECT t.target_id AS targetId,
         t.command_id AS commandId,t.created_at_utc AS createdAtUtc
         FROM memory_tombstones t JOIN memory_commands c ON c.command_id=t.command_id
         WHERE t.world_profile_id=? AND t.character_id=? AND t.timeline_id=?
           AND c.protagonist_key=? AND c.operation='forget'`).all(...scopeKey(scope));
       const insert=this.#db.prepare('INSERT OR IGNORE INTO m5_trash VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL)');
       for(const item of forgotten)insert.run(item.commandId,item.commandId,item.targetId,
         ...scopeKey(scope),item.createdAtUtc,
         new Date(Date.parse(item.createdAtUtc)+7*DAY).toISOString());
     });
     return true;
   });
 }
 async close(){if(this.#db){this.#db.close();this.#db=null;}}
 #read(s,fn){
   if(!this.#db)fail('m5_not_ready');
   validateScope(s,this.#store);verifyOwner(this.#db,s);
   return fn(this.#db);
 }
 async #write(s,fn){
   validateScope(s,this.#store);
   await this.ready(s);
   return this.#store.withTimelineWrite(s.timelineId,()=>this.#read(s,db=>transaction(db,()=>fn(db))));
 }
 async saveClarification({scope,commandId,requestedByLineId,line,parsed,alternatives,frozen,createdAtUtc}){
   if(![commandId,requestedByLineId].every(isUuid)||line?.recordId!==requestedByLineId||
      !Array.isArray(alternatives)||alternatives.length>2||!Array.isArray(frozen)||
      frozen.length!==alternatives.length||!timestamp(createdAtUtc)||
      alternatives.some((x,i)=>!isUuid(x.recordId)||x.recordId!==frozen[i].recordId))
     fail('m5_invalid_clarification');
   const now=this.#clock(),until=new Date(Date.parse(now)+CLARIFY_MS).toISOString();
   if(!timestamp(now))fail('m5_invalid_clock');
   const payload={scope,line,parsed,alternatives,frozen,requestedByLineId,commandId,createdAtUtc};
   const raw=JSON.stringify(payload),checksum=sha(raw);
   await this.#write(scope,db=>{
     const source=db.prepare('SELECT record_id FROM dialogue_journal WHERE record_id=? AND world_profile_id=? AND character_id=? AND timeline_id=? AND speaker=? AND delivery=? AND protagonist=?')
       .get(requestedByLineId,scope.worldProfileId,scope.characterId,scope.timelineId,'player','accepted',scope.protagonistKey??'unknown');
     if(!source)fail('m5_clarification_line_not_accepted');
     for(const alt of frozen){
       const current=evidence(db,scope,alt.recordId);
       if(!current || current.content!==alt.content || activeTombstone(db,scope,alt.recordId) || superseded(db,scope,alt.recordId))
         fail('m5_clarification_evidence_changed');
     }
     const old=db.prepare('SELECT state_sha256 FROM m5_clarifications WHERE command_id=?').get(commandId);
     if(old){if(old.state_sha256!==checksum)fail('m5_clarification_replay_conflict');return;}
     db.prepare('INSERT INTO m5_clarifications VALUES(?,?,?,?,?,?,?,?,?,NULL)')
       .run(commandId,...scopeKey(scope),requestedByLineId,raw,checksum,until);
   });
   const persisted=await this.getClarification({scope,commandId});
   if(!persisted||sha(JSON.stringify(persisted))!==checksum)fail('m5_clarification_readback_failed');
   return {commandId,expiresAtUtc:until};
 }
 async getClarification({scope,commandId,atUtc=null}){
   if(!isUuid(commandId))fail('m5_invalid_command');
   return this.#read(scope,db=>{
     const row=db.prepare('SELECT state_json AS raw,state_sha256 AS checksum,expires_at_utc AS until,completed_at_utc AS done FROM m5_clarifications WHERE command_id=? AND '+scopeWhere)
       .get(commandId,...scopeKey(scope));
     if(!row || row.done || Date.parse(row.until)<=Date.parse(this.#clock())||
        atUtc&&(!timestamp(atUtc)||Date.parse(atUtc)>Date.parse(row.until)))return null;
     if(sha(row.raw)!==row.checksum)fail('m5_clarification_corrupt');
     const saved=JSON.parse(row.raw);
     // A later forget must revoke previously offered evidence immediately.
     if(saved.alternatives.some(item=>activeTombstone(db,scope,item.recordId) || superseded(db,scope,item.recordId)))
       return null;
     return saved;
   });
 }
 async completeClarification({scope,commandId}){
   if(!isUuid(commandId))fail('m5_invalid_command');
   await this.#write(scope,db=>{
     if(!db.prepare('SELECT command_id FROM memory_commands WHERE command_id=? AND world_profile_id=? AND character_id=? AND timeline_id=? AND protagonist_key=?')
       .get(commandId,...scopeKey(scope)))fail('m5_uncommitted_resolution');
     db.prepare('UPDATE m5_clarifications SET completed_at_utc=COALESCE(completed_at_utc,?) WHERE command_id=? AND '+scopeWhere)
       .run(this.#clock(),commandId,...scopeKey(scope));
   });
   return true;
 }
 /** The original store performs immutable journal command transaction+readback.
  * This facade adds only clarification persistence, never fakes commit receipts.
  */
 bindCommands(){
   return Object.freeze({
     findCandidates:async params=>{
       const [rows,suppressed,overlays]=await Promise.all([
         this.#store.findCandidates(params),
         this.#store.listSuppressedMemoryIds(params.scope),
         this.#store.readCorrectionOverlays(params.scope)
       ]);
       const hidden=new Set([...suppressed,...overlays.map(x=>x.targetId)]);
       return rows.filter(x=>!hidden.has(x.recordId));
     },
     commitCommand:async op=>{
       const receipt=await this.#store.commitCommand(op);
       if(op.operation==='forget' && receipt?.durableCommit)await this.ready(op.scope);
       return receipt;
     },
     verifyCommand:async params=>{
       const receipt=await this.#store.verifyCommand(params);
       if(receipt?.operation==='forget' && receipt?.durableCommit)await this.ready(params.scope);
       return receipt;
     },
     saveClarification:params=>this.saveClarification(params),
     getClarification:params=>this.getClarification(params),
     completeClarification:params=>this.completeClarification(params),
     inspect:params=>this.inspect(params),
     export:params=>this.exportArchive(params)
   });
 }
 async inspect({scope,limit=200}){
   authorizeRequest(this.#authorize,scope,'inspect');
   if(!Number.isSafeInteger(limit)||limit<1||limit>1000)fail('m5_invalid_limit');
   return this.#read(scope,db=>{
     const records=db.prepare('SELECT memory_id AS recordId,content,origin,pin,created_at_utc AS atUtc,evidence_ids_json AS evidenceJson FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND protagonist_key=? ORDER BY created_at_utc DESC LIMIT ?').all(...scopeKey(scope),limit)
       .map(m=>({...m,evidenceRecordIds:JSON.parse(m.evidenceJson)}));
     const trash=db.prepare('SELECT trash_id AS trashId,target_id AS targetId,created_at_utc AS createdAtUtc,purge_after_utc AS purgeAfterUtc,restored_at_utc AS restoredAtUtc,purged_at_utc AS purgedAtUtc FROM m5_trash WHERE '+scopeWhere+' ORDER BY created_at_utc DESC LIMIT ?').all(...scopeKey(scope),limit);
     const corrections=db.prepare('SELECT c.target_id AS targetId,c.preferred_text AS reportedCorrection,c.created_at_utc AS atUtc FROM memory_corrections c JOIN memory_commands m ON m.command_id=c.command_id WHERE c.world_profile_id=? AND c.character_id=? AND c.timeline_id=? AND m.protagonist_key=? ORDER BY c.created_at_utc DESC LIMIT ?').all(...scopeKey(scope),limit);
     return {version:1,scope:{...scope},records,trash,corrections};
   });
 }
 async exportArchive({scope}){
   authorizeRequest(this.#authorize,scope,'export');
   return this.#read(scope,db=>{
     const dialogue=db.prepare('SELECT envelope_json AS json FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND protagonist=? ORDER BY committed_at_utc,record_id').all(scope.worldProfileId,scope.characterId,scope.timelineId,scope.protagonistKey??'unknown').map(x=>JSON.parse(x.json));
     const events=(scope.protagonistKey??'unknown')==='unknown'
       ?db.prepare('SELECT envelope_json AS json FROM event_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? ORDER BY received_at_utc,record_id').all(scope.worldProfileId,scope.characterId,scope.timelineId).map(x=>JSON.parse(x.json)):[];
     const memories=db.prepare('SELECT * FROM memory_records WHERE '+scopeWhere+' ORDER BY created_at_utc,memory_id').all(...scopeKey(scope));
     const sidecars=(scope.protagonistKey??'unknown')==='unknown'
       ?db.prepare('SELECT v.record_id AS recordId,v.source_evidence_json AS evidenceJson,v.source_evidence_sha256 AS checksum FROM event_source_evidence v JOIN event_journal e ON e.record_id=v.record_id WHERE e.world_profile_id=? AND e.character_id=? AND e.timeline_id=? ORDER BY e.received_at_utc,e.record_id')
         .all(scope.worldProfileId,scope.characterId,scope.timelineId)
         .map(x=>({recordId:x.recordId,evidence:JSON.parse(x.evidenceJson),sha256:x.checksum})):[];
     const memoIds=new Set(memories.map(m=>m.memory_id));
     const curationJobs=db.prepare('SELECT job_json AS json FROM memory_curation_jobs WHERE world_profile_id=? AND character_id=? AND timeline_id=?')
       .all(scope.worldProfileId,scope.characterId,scope.timelineId)
       .map(x=>JSON.parse(x.json)).filter(j=>memoIds.has(j.proposal?.proposalId));
     const appraisals=db.prepare('SELECT proposal_id AS id,appraisal_json AS json FROM memory_luna_appraisals WHERE world_profile_id=? AND character_id=? AND timeline_id=?')
       .all(scope.worldProfileId,scope.characterId,scope.timelineId)
       .filter(x=>memoIds.has(x.id)).map(x=>JSON.parse(x.json));
     const pending=db.prepare('SELECT state_json AS json,state_sha256 AS checksum FROM m5_clarifications WHERE '+scopeWhere)
       .all(...scopeKey(scope)).map(row=>{
         if(sha(row.json)!==row.checksum)fail('m5_clarification_corrupt');
         return JSON.parse(row.json);
       });
     const commands=db.prepare('SELECT receipt_json AS json FROM memory_commands WHERE '+scopeWhere+' ORDER BY requested_by_line_id,command_id').all(...scopeKey(scope)).map(x=>JSON.parse(x.json));
     const tombstones=db.prepare('SELECT t.* FROM memory_tombstones t WHERE t.world_profile_id=? AND t.character_id=? AND t.timeline_id=?').all(scope.worldProfileId,scope.characterId,scope.timelineId).filter(row=>!!evidence(db,scope,row.target_id));
     const corrections=db.prepare('SELECT c.* FROM memory_corrections c JOIN memory_commands m ON m.command_id=c.command_id WHERE c.world_profile_id=? AND c.character_id=? AND c.timeline_id=? AND m.protagonist_key=?').all(...scopeKey(scope));
     const trash=db.prepare('SELECT * FROM m5_trash WHERE '+scopeWhere).all(...scopeKey(scope));
     const raw=JSON.stringify({format:'m5-promoted-memory-archive-v1',scope,dialogue,events,sidecars,memories,curationJobs,appraisals,commands,tombstones,corrections,trash,pending})+'\n';
     return {format:'m5-promoted-memory-archive-v1',sha256:sha(raw),byteLength:Buffer.byteLength(raw),json:raw};
   });
 }
 async writeArchive({scope,destinationPath}){
   authorizeRequest(this.#authorize,scope,'export');
   if(typeof destinationPath!=='string'||!path.isAbsolute(destinationPath))fail('m5_export_path_required');
   const snap=await this.exportArchive({scope});
   const handle=await fs.open(destinationPath,'wx',0o600);
   try{await handle.writeFile(snap.json,'utf8');await handle.sync();}
   finally{await handle.close();}
   const disk=await fs.readFile(destinationPath,'utf8');
   if(sha(disk)!==snap.sha256)fail('m5_export_readback_failed');
   return {path:destinationPath,sha256:snap.sha256,byteLength:snap.byteLength};
 }
 /** Seven-day reversible trash. Other readers already consume tombstones. */
 async trash({scope,targetId,operationId=randomUUID()}){
   authorizeRequest(this.#authorize,scope,'trash');
   if(!isUuid(targetId)||!isUuid(operationId))fail('m5_invalid_trash');
   const now=this.#clock(),until=new Date(Date.parse(now)+7*DAY).toISOString();
   const reqHash=sha(JSON.stringify({scope,targetId,operationId,operation:'trash'}));
   await this.#write(scope,db=>{
     const old=db.prepare('SELECT request_sha256 AS hash FROM m5_privacy_ops WHERE operation_id=?').get(operationId);
     if(old){if(old.hash!==reqHash)fail('m5_privacy_replay_conflict');return;}
     if(!evidence(db,scope,targetId))fail('m5_trash_missing_evidence');
     if(activeTombstone(db,scope,targetId))fail('m5_already_suppressed');
     const closure=dependentIds(db,scope,[targetId]);
     for(const row of db.prepare('SELECT command_id AS id,state_json AS json FROM m5_clarifications WHERE '+scopeWhere)
       .all(...scopeKey(scope))){
       const pending=JSON.parse(row.json);
       if(tainted.has(pending.requestedByLineId) ||
          pending.alternatives?.some(x=>tainted.has(x.recordId)))
         db.prepare('DELETE FROM m5_clarifications WHERE command_id=?').run(row.id);
     }
     for(const id of closure){
       if(!activeTombstone(db,scope,id))
         db.prepare('INSERT INTO memory_tombstones VALUES(?,?,?,?,?,?)')
           .run(scope.characterId,scope.worldProfileId,scope.timelineId,id,operationId,now);
       db.prepare('INSERT INTO m5_trash VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL)')
         .run(id===targetId?operationId:randomUUID(),operationId,id,...scopeKey(scope),now,until);
     }
     const r=receipt(operationId,'trash',closure,now);
     db.prepare('INSERT INTO m5_privacy_ops VALUES(?,?,?,?,?,?,?)')
       .run(operationId,...scopeKey(scope),reqHash,JSON.stringify(r));
   });
   return this.verifyPrivacy({scope,operationId});
 }
 /** Explicitly authorized entire current protagonist/timeline archive deletion.
  * This is not P2 unpromotion nor cross-timeline profile destruction.
  * Rollback is all-or-none; previously suppressed rows keep their own schedule.
  */
 async trashScope({scope,operationId=randomUUID()}){
   authorizeRequest(this.#authorize,scope,'trash_scope');
   if(!isUuid(operationId))fail('m5_invalid_operation_id');
   const now=this.#clock(),until=new Date(Date.parse(now)+7*DAY).toISOString();
   const reqHash=sha(JSON.stringify({scope,operationId,operation:'trash_scope'}));
   await this.#write(scope,db=>{
     const old=db.prepare('SELECT request_sha256 AS hash FROM m5_privacy_ops WHERE operation_id=?').get(operationId);
     if(old){if(old.hash!==reqHash)fail('m5_privacy_replay_conflict');return;}
     const ids=[
       ...db.prepare('SELECT record_id AS id FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND protagonist=?')
         .all(scope.worldProfileId,scope.characterId,scope.timelineId,scope.protagonistKey??'unknown').map(x=>x.id),
       ...db.prepare('SELECT memory_id AS id FROM memory_records WHERE '+scopeWhere).all(...scopeKey(scope)).map(x=>x.id)
     ];
     if((scope.protagonistKey??'unknown')==='unknown')
       ids.push(...db.prepare('SELECT e.record_id AS id FROM event_journal e JOIN event_source_evidence s ON s.record_id=e.record_id WHERE e.world_profile_id=? AND e.character_id=? AND e.timeline_id=?')
         .all(scope.worldProfileId,scope.characterId,scope.timelineId).map(x=>x.id));
     const unique=[...new Set(ids)].sort();
     if(unique.length>100000)fail('m5_scope_delete_quota_exceeded');
     const pending=unique.filter(id=>!activeTombstone(db,scope,id));
     for(const id of pending){
       db.prepare('INSERT INTO memory_tombstones VALUES(?,?,?,?,?,?)')
         .run(scope.characterId,scope.worldProfileId,scope.timelineId,id,operationId,now);
       db.prepare('INSERT INTO m5_trash VALUES(?,?,?,?,?,?,?,?,?,NULL,NULL)')
         .run(randomUUID(),operationId,id,...scopeKey(scope),now,until);
     }
     const result=receipt(operationId,'trash_scope',pending,now);
     db.prepare('INSERT INTO m5_privacy_ops VALUES(?,?,?,?,?,?,?)')
       .run(operationId,...scopeKey(scope),reqHash,JSON.stringify(result));
   });
   return this.verifyPrivacy({scope,operationId});
 }
 verifyPrivacy({scope,operationId}){
   if(!isUuid(operationId))fail('m5_invalid_operation_id');
   return this.#read(scope,db=>{
     const row=db.prepare('SELECT receipt_json AS json FROM m5_privacy_ops WHERE operation_id=? AND '+scopeWhere).get(operationId,...scopeKey(scope));
     return row?JSON.parse(row.json):null;
   });
 }
 async restore({scope,trashId,operationId=randomUUID()}){
   authorizeRequest(this.#authorize,scope,'restore');
   if(!isUuid(trashId)||!isUuid(operationId))fail('m5_invalid_restore');
   const now=this.#clock(),reqHash=sha(JSON.stringify({scope,trashId,operationId,operation:'restore'}));
   await this.#write(scope,db=>{
     const old=db.prepare('SELECT request_sha256 AS hash FROM m5_privacy_ops WHERE operation_id=?').get(operationId);
     if(old){if(old.hash!==reqHash)fail('m5_privacy_replay_conflict');return;}
     const target=db.prepare('SELECT operation_id AS parent,target_id AS target,purge_after_utc AS expiry,restored_at_utc AS restored,purged_at_utc AS purged FROM m5_trash WHERE trash_id=? AND '+scopeWhere).get(trashId,...scopeKey(scope));
     if(!target||target.restored||target.purged||Date.parse(now)>=Date.parse(target.expiry))fail('m5_restore_unavailable');
     const bundle=db.prepare('SELECT target_id AS id FROM m5_trash WHERE operation_id=? AND '+scopeWhere+' AND restored_at_utc IS NULL AND purged_at_utc IS NULL').all(target.parent,...scopeKey(scope));
     for(const x of bundle){
       db.prepare('DELETE FROM memory_tombstones WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND target_id=? AND command_id=?')
         .run(scope.worldProfileId,scope.characterId,scope.timelineId,x.id,target.parent);
     }
     db.prepare('UPDATE m5_trash SET restored_at_utc=? WHERE operation_id=? AND '+scopeWhere+' AND restored_at_utc IS NULL')
       .run(now,target.parent,...scopeKey(scope));
     const r=receipt(operationId,'restore',bundle.map(x=>x.id),now);
     db.prepare('INSERT INTO m5_privacy_ops VALUES(?,?,?,?,?,?,?)').run(operationId,...scopeKey(scope),reqHash,JSON.stringify(r));
   });
   return this.verifyPrivacy({scope,operationId});
 }
 /** Destructive, explicit 7-day purge for trash past retention. Caller must
  * actively authorize this operation. Physical deletes happen in one TX.
  */
 async purgeExpired({scope,limit=100}){
   authorizeRequest(this.#authorize,scope,'purge');
   if(!Number.isSafeInteger(limit)||limit<1||limit>1000)fail('m5_invalid_limit');
   const now=this.#clock();
   return this.#write(scope,db=>{
     const due=db.prepare('SELECT target_id AS id,operation_id AS parent FROM m5_trash WHERE '+scopeWhere+' AND restored_at_utc IS NULL AND purged_at_utc IS NULL AND purge_after_utc<=? ORDER BY purge_after_utc LIMIT ?')
       .all(...scopeKey(scope),now,limit);
     const ids=new Set(due.map(x=>x.id));
     // Never delete sources belonging to another protagonist. Closure only
     // follows memories authored for this protagonist, not source parents.
     const closure=dependentIds(db,scope,ids);
     // Purge stored derivatives, curator jobs, appraisals and audit receipts
     // that include purged evidence, not merely the primary journal row.
     const tainted=new Set(closure);
     for(const row of db.prepare('SELECT job_id AS id,job_json AS json FROM memory_curation_jobs WHERE world_profile_id=? AND character_id=? AND timeline_id=?')
       .all(scope.worldProfileId,scope.characterId,scope.timelineId)){
       const job=JSON.parse(row.json);
       if(job.proposal?.evidenceRecordIds?.some(id=>tainted.has(id)) || tainted.has(job.proposal?.proposalId))
         db.prepare('DELETE FROM memory_curation_jobs WHERE job_id=?').run(row.id);
     }
     for(const row of db.prepare('SELECT proposal_id AS id,original_proposal_json AS json FROM memory_luna_appraisals WHERE world_profile_id=? AND character_id=? AND timeline_id=?')
       .all(scope.worldProfileId,scope.characterId,scope.timelineId)){
       const proposal=JSON.parse(row.json);
       if(tainted.has(row.id)||proposal.evidenceRecordIds?.some(id=>tainted.has(id)))
         db.prepare('DELETE FROM memory_luna_appraisals WHERE proposal_id=?').run(row.id);
     }
     for(const row of db.prepare('SELECT command_id AS id,requested_by_line_id AS lineId,receipt_json AS json FROM memory_commands WHERE '+scopeWhere)
       .all(...scopeKey(scope))){
       const command=JSON.parse(row.json);
       if(tainted.has(row.lineId)||command.evidenceRecordIds?.some(id=>tainted.has(id))){
         db.prepare('DELETE FROM memory_corrections WHERE command_id=?').run(row.id);
         db.prepare('DELETE FROM memory_commands WHERE command_id=?').run(row.id);
       }
     }
     for(const id of closure){
       db.prepare('DELETE FROM memory_records WHERE memory_id=? AND world_profile_id=? AND character_id=? AND timeline_id=? AND protagonist_key=?').run(id,...scopeKey(scope));
       db.prepare('DELETE FROM dialogue_journal WHERE record_id=? AND world_profile_id=? AND character_id=? AND timeline_id=? AND protagonist=?')
         .run(id,scope.worldProfileId,scope.characterId,scope.timelineId,scope.protagonistKey??'unknown');
       if((scope.protagonistKey??'unknown')==='unknown')
         db.prepare('DELETE FROM event_journal WHERE record_id=? AND world_profile_id=? AND character_id=? AND timeline_id=?').run(id,scope.worldProfileId,scope.characterId,scope.timelineId);
       db.prepare('DELETE FROM memory_corrections WHERE target_id=? AND world_profile_id=? AND character_id=? AND timeline_id=?').run(id,scope.worldProfileId,scope.characterId,scope.timelineId);
       db.prepare('DELETE FROM memory_tombstones WHERE target_id=? AND world_profile_id=? AND character_id=? AND timeline_id=?').run(id,scope.worldProfileId,scope.characterId,scope.timelineId);
       db.prepare('DELETE FROM memory_commands WHERE requested_by_line_id=? AND '+scopeWhere).run(id,...scopeKey(scope));
     }
     for(const x of due)db.prepare('UPDATE m5_trash SET purged_at_utc=? WHERE operation_id=? AND target_id=? AND '+scopeWhere).run(now,x.parent,x.id,...scopeKey(scope));
     return {kind:'m5_purge_result',purgedIds:[...ids],committedAtUtc:now};
   });
 }
}
export const createM5SqliteServices = options => new M5SqliteServices(options);
