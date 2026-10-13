// M1 additive P2 SQLite foundation. Not activated by the current P2 service.
// Source profile JSON remains intact until separately gated editor/CRUD parity.
import * as fs from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import {snapshotSqlite} from './sqliteDurability.mjs';
// SQLite is an explicit opt-in. Older Node versions used by a legacy
// Essential install must be able to START IN JSON MODE without this module.
let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch {}

import { isUuid } from '../util/identity.mjs';
import { PROFILE_LIMITS, validateProfiles } from './profileSchema.mjs';
import { JOURNAL_SCHEMA_VERSION, migrateJournalSchema, assertJournalSchema, appendDialogue, appendEvent, readDialogue, readFreeRecallWindow, findExactQuote, searchDialogue, readEvents, readVerifiedEventEvidence } from '../memory/journalSqlite.mjs';
import { ensureIntegratedMemorySchema, listMemoryCandidates, listSuppressedMemoryIds, verifyPersistedMemoryCommand, commitPersistedMemoryCommand, persistDeterministicMemory, readPermanentMemoryRows, readCorrectionOverlays } from '../memory/integratedSqlite.mjs';
import {ensureCurationSchema,enqueueCuration,claimCuration,verifyCurationLease,completeCuration,retryCuration,releaseCuration,reserveCurationBudget,finishCurationBudget} from '../memory/curationSqlite.mjs';
import {ensureM3CoverageSchema,appendM3Coverage,readM3Coverage,upsertObserverCoverage,sealStaleObserverCoverage,readObserverCoverage} from '../events/m3CoverageSqlite.mjs';
import {readIntegratedRecall} from '../memory/sqliteIntegratedRecallProjection.mjs';
import {ensureP2ReplaySchema,readP2ReplayPage,readP2ReplayCursor,acknowledgeP2ReplayCursor} from '../memory/p2ReplayCursor.mjs';
import {ensureM5PrivacySchema,reconcileM5Suppression} from '../memory/m5SqlitePrivacy.mjs';
import {ensureM6P2ReplaySchema,readM6CheckpointSql,readM6JournalPageSql,ackM6CheckpointSql} from '../memory/m6P2ReplayAdapter.mjs';

export const SQLITE_PROFILE_SCHEMA = 2;
const fail = code => { throw new Error(code); };
const sha256 = contents => createHash('sha256').update(contents).digest('hex');
const DDL = `
CREATE TABLE IF NOT EXISTS p2_store (
 singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
 world_profile_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision >= 0),
 source_sha256 TEXT NOT NULL,
 snapshot_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS promoted_profiles (
 character_id TEXT PRIMARY KEY,
 owner_alias TEXT NOT NULL UNIQUE,
 position INTEGER NOT NULL UNIQUE,
 revision INTEGER NOT NULL CHECK(revision > 0),
 profile_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS timelines (
 timeline_id TEXT PRIMARY KEY,
 world_profile_id TEXT NOT NULL,
 label TEXT NOT NULL,
 created_at_utc TEXT NOT NULL,
 active INTEGER NOT NULL CHECK(active IN (0,1))
);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_timeline ON timelines(active) WHERE active=1;
`;

export function probeP2Sqlite() {
  let db;
  try {
    db = new DatabaseSync(':memory:');
    const row = db.prepare("SELECT sqlite_version() AS version").get();
    db.exec('CREATE VIRTUAL TABLE proof_fts USING fts5(content)');
    db.prepare('INSERT INTO proof_fts(content) VALUES (?)').run('memory search');
    if (db.prepare("SELECT count(*) AS n FROM proof_fts WHERE proof_fts MATCH ?").get('memory').n !== 1) return {available:false,reason:'fts5_unavailable'};
    return {available:true,sqliteVersion:row.version,fts5:true};
  } catch {
    return {available:false,reason:'sqlite_or_fts5_unavailable'};
  } finally { db?.close(); }
}

function insertSnapshot(db, snapshot, raw) {
  db.prepare('INSERT INTO p2_store(singleton,world_profile_id,revision,source_sha256,snapshot_json) VALUES (1,?,?,?,?)')
    .run(snapshot.worldProfileId, snapshot.revision, sha256(raw), raw);
  const insert = db.prepare('INSERT INTO promoted_profiles(character_id,owner_alias,position,revision,profile_json) VALUES (?,?,?,?,?)');
  snapshot.profiles.forEach((p,i) => insert.run(p.characterId,p.promotion.ownerAlias,i,p.revision,JSON.stringify(p)));
}
let savepointCounter=0;
function transaction(db, operation) {
  // A nested P2 operation uses a SQLite SAVEPOINT, never a second writer
  // connection or BEGIN inside an existing transaction.
  const nested=db.isTransaction===true;
  const savepoint=nested?'p2_nested_'+(++savepointCounter):null;
  db.exec(nested?'SAVEPOINT '+savepoint:'BEGIN IMMEDIATE');
  try {
    const result=operation();
    if(result?.then)fail('p2_sqlite_async_transaction');
    db.exec(nested?'RELEASE SAVEPOINT '+savepoint:'COMMIT');
    return result;
  } catch(error) {
    try{
      if(nested){db.exec('ROLLBACK TO SAVEPOINT '+savepoint);db.exec('RELEASE SAVEPOINT '+savepoint);}
      else db.exec('ROLLBACK');
    }catch{}
    throw error;
  }
}
async function syncFile(file) {
  const handle=await fs.open(file,'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function sourceSnapshot(sourcePath, worldProfileId) {
  let raw;
  try {
    const stat=await fs.stat(sourcePath);
    if(!stat.isFile() || stat.size>PROFILE_LIMITS.bytes) fail('legacy_profile_invalid');
    raw=await fs.readFile(sourcePath,'utf8');
  } catch(e) { if(e.code==='ENOENT')return null; throw e; }
  let value;
  try { value=JSON.parse(raw); } catch { fail('legacy_profile_invalid'); }
  try { return {data:validateProfiles(value,worldProfileId),raw}; }
  catch { fail('legacy_profile_invalid'); }
}
async function backupOnce(sourcePath,raw) {
  const backup=sourcePath+'.pre-sqlite.bak';
  try { await fs.copyFile(sourcePath,backup,fsConstants.COPYFILE_EXCL); }
  catch(e) { if(e.code!=='EEXIST')throw e; }
  const copied=await fs.readFile(backup,'utf8');
  if (sha256(copied)!==sha256(raw)) fail('legacy_backup_conflict');
  await syncFile(backup);
}
function verifyExisting(db,worldProfileId) {
  if(![SQLITE_PROFILE_SCHEMA,3,JOURNAL_SCHEMA_VERSION].includes(db.prepare('PRAGMA user_version').get().user_version))fail('unsupported_sqlite_profile_schema');
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')fail('sqlite_integrity_failed');
  const row=db.prepare('SELECT * FROM p2_store WHERE singleton=1').get();
  if(!row || row.world_profile_id!==worldProfileId)fail('sqlite_profile_world_conflict');
  if(sha256(row.snapshot_json)!==row.source_sha256)fail('sqlite_snapshot_hash_mismatch');
  const data=validateProfiles(JSON.parse(row.snapshot_json),worldProfileId);
  if(data.revision!==row.revision)fail('sqlite_snapshot_revision_mismatch');
  const records=db.prepare('SELECT character_id,owner_alias,position,revision,profile_json FROM promoted_profiles ORDER BY position').all();
  if(records.length!==data.profiles.length)fail('sqlite_profile_index_conflict');
  for(let i=0;i<records.length;i++){
    const actual=records[i],wanted=data.profiles[i];
    if(actual.position!==i || actual.character_id!==wanted.characterId ||
      actual.owner_alias!==wanted.promotion.ownerAlias || actual.revision!==wanted.revision ||
      JSON.stringify(JSON.parse(actual.profile_json))!==JSON.stringify(wanted))fail('sqlite_profile_index_conflict');
  }
  return data;
}

/**
 * Read-only operator preflight for offline recovery. Never creates a DB,
 * selects a timeline, removes a stale writer lock or rewrites a profile.
 * Inspecting a running game is not a substitute for stopping the writer.
 */
export async function inspectP2Sqlite({filePath,worldProfileId}) {
  if (typeof filePath !== 'string' || !filePath.trim() || !isUuid(worldProfileId))
    fail('invalid_sqlite_profile_config');
  const resolved=path.resolve(filePath);
  const stat=await fs.stat(resolved);
  if (!stat.isFile()) fail('sqlite_profile_not_file');
  if (!DatabaseSync) fail('sqlite_feature_unavailable');
  const db=new DatabaseSync(resolved,{readOnly:true});
  try {
    const snapshot=verifyExisting(db,worldProfileId);
    if(db.prepare('PRAGMA user_version').get().user_version===JOURNAL_SCHEMA_VERSION)
      assertJournalSchema(db);
    const timelines=db.prepare('SELECT timeline_id AS timelineId,active FROM timelines ORDER BY timeline_id').all();
    const active=timelines.filter(t=>t.active===1);
    if(active.length>1)fail('sqlite_timeline_integrity_failed');
    return Object.freeze({
      status:'verified',revision:snapshot.revision,
      profileCount:snapshot.profiles.length,timelineCount:timelines.length,
      activeTimelineId:active[0]?.timelineId??null,
      schemaVersion:db.prepare('PRAGMA user_version').get().user_version
    });
  } finally {db.close();}
}

/**
 * Explicit, operator-facing recovery view. An integrity-failed database is
 * never auto-restored or written. Only checked immutable snapshots are read.
 */
export async function inspectP2ReadOnlyRecovery({filePath,worldProfileId,scope=null}){
  if(typeof filePath!=='string'||!filePath.trim()||!isUuid(worldProfileId))
    fail('invalid_sqlite_profile_config');
  const folder=path.resolve(filePath)+'.snapshots';
  let files;
  try{files=(await fs.readdir(folder)).filter(n=>/^(daily-\d{4}-\d\d-\d\d|weekly-\d{4}-W\d\d|pre-migration-[0-9TZ-]+-[0-9a-f-]{36})\.sqlite$/.test(n)).sort().reverse();}
  catch(e){if(e.code==='ENOENT')fail('sqlite_recovery_snapshot_unavailable');throw e;}
  for(const name of files){
    let db;
    try{
      db=new DatabaseSync(path.join(folder,name),{readOnly:true});
      const snapshot=verifyExisting(db,worldProfileId);
      const version=db.prepare('PRAGMA user_version').get().user_version;
      if(version===JOURNAL_SCHEMA_VERSION)assertJournalSchema(db);
      if(scope&&version!==JOURNAL_SCHEMA_VERSION)continue;
      const lines=scope?readDialogue(db,{...scope,worldProfileId,limit:Math.min(200,scope.limit??200)},worldProfileId):null;
      return Object.freeze({
        status:'read_only_snapshot',path:path.join(folder,name),
        schemaVersion:version,revision:snapshot.revision,
        profiles:Object.freeze(snapshot.profiles.map(p=>Object.freeze({characterId:p.characterId,name:p.name}))),
        dialogue:lines
      });
    }catch{
      // A corrupt snapshot cannot authorize recovery; try an older checked one.
    }finally{try{db?.close();}catch{}}
  }
  fail('sqlite_recovery_snapshot_unavailable');
}

export class P2SqliteFoundation {
  #db=null; #init=null; #snapshot=null; #recoveryStatus=null;
  constructor({filePath,worldProfileId,legacyJsonPath=null}) {
    if(!filePath || !isUuid(worldProfileId))throw new TypeError('invalid_sqlite_profile_config');
    this.filePath=path.resolve(filePath);
    this.worldProfileId=worldProfileId;
    this.legacyJsonPath=legacyJsonPath?path.resolve(legacyJsonPath):null;
  }
  get initialized() {return !!this.#db;}
  get recoveryStatus(){return this.#recoveryStatus;}
  get snapshot(){if(!this.#snapshot)fail('sqlite_profile_uninitialized');return this.#snapshot;}
  async initialize() {return this.#init ||= this.#initialize();}
  async #initialize() {
    if(!probeP2Sqlite().available)fail('sqlite_feature_unavailable');
    await fs.mkdir(path.dirname(this.filePath),{recursive:true});
    let exists=true;
    try {await fs.stat(this.filePath);} catch(e){if(e.code==='ENOENT')exists=false;else throw e;}
    if(!exists){
      const previous=this.legacyJsonPath?await sourceSnapshot(this.legacyJsonPath,this.worldProfileId):null;
      const initial=previous?.data ?? validateProfiles({schemaVersion:1,worldProfileId:this.worldProfileId,revision:0,profiles:[]},this.worldProfileId);
      if(previous)await backupOnce(this.legacyJsonPath,previous.raw);
      const raw=previous?.raw ?? JSON.stringify(initial)+'\n';
      const stage=this.filePath+'.'+randomUUID()+'.staging';
      let db;
      try{
        db=new DatabaseSync(stage);
        db.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
        db.exec(DDL);
        transaction(db,()=>insertSnapshot(db,initial,raw));
        db.exec('PRAGMA user_version=2');
        db.close();db=null;
        await syncFile(stage);
        // Never replace an existing SQLite database if another process won the race.
        await fs.link(stage,this.filePath);
        await syncFile(this.filePath);
      } finally {
        try {db?.close();}catch{}
        await fs.rm(stage,{force:true}).catch(()=>{});
      }
    }
    let db;
    try {
      db=new DatabaseSync(this.filePath);
      this.#snapshot=verifyExisting(db,this.worldProfileId);
      db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
      // Crash recovery must preserve the pre-migration store even if DDL fails.
      // Detect both an old core schema and a v4 database lacking extensions.
      const version=db.prepare('PRAGMA user_version').get().user_version;
      const extensions=['m3_coverage','m5_trash','p2_memory_replay_feed','m6_p2_checkpoints'];
      const missing=extensions.some(name=>!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
      if(version!==JOURNAL_SCHEMA_VERSION||missing)
        await snapshotSqlite(db,this.filePath,{reason:'pre_migration'});
      // One transaction includes the v2/v3 -> v4 migration and every extension
      // DDL/reconciliation. Failure leaves no partially upgraded schema.
      transaction(db,()=>{
        migrateJournalSchema(db);
        ensureIntegratedMemorySchema(db);
        ensureCurationSchema(db);
        ensureM3CoverageSchema(db);
        ensureM5PrivacySchema(db);
        reconcileM5Suppression(db);
        ensureP2ReplaySchema(db);
        ensureM6P2ReplaySchema(db);
      });
      this.#db=db;
      return this.#snapshot;
    } catch(e){
      this.#recoveryStatus={status:'read_only_recovery_required',reason:e.message,
        database:this.filePath,snapshots:this.filePath+'.snapshots'};
      try {db?.close();}catch{}
      // Do not write to, reset, or auto-restore an integrity-failed database.
      throw e;
    }
  }
  async createDurabilitySnapshot(reason='session_end'){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    return snapshotSqlite(this.#db,this.filePath,{reason});
  }
  list(){return this.snapshot.profiles;}
  get(characterId){return this.list().find(p=>p.characterId===characterId)||null;}
  exportSnapshot(){return JSON.stringify(this.snapshot)+'\n';}
  // Transactional CAS for a future P2 adapter. Not wired to live CRUD in M1 part 1.
  replaceSnapshot(next,expectedRevision){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    const data=validateProfiles(next,this.worldProfileId);
    if(data.revision!==expectedRevision+1)fail('sqlite_revision_step');
    transaction(this.#db,()=>{
      const current=this.#db.prepare('SELECT revision FROM p2_store WHERE singleton=1').get();
      if(!current || current.revision!==expectedRevision)fail('sqlite_revision_conflict');
      // Explicit character deletion must also remove its private experiential
      // history, in this SAME profile CAS transaction. Ordinary P2 edits are
      // never destructive to journal evidence.
      const nextIds=new Set(data.profiles.map(profile=>profile.characterId));
      const removeDialogue=this.#db.prepare('DELETE FROM dialogue_journal WHERE character_id=?');
      const removeEvents=this.#db.prepare('DELETE FROM event_journal WHERE character_id=?');
      for(const previous of this.#snapshot.profiles){
        if(!nextIds.has(previous.characterId)){
          removeDialogue.run(previous.characterId);
          removeEvents.run(previous.characterId);
          for(const table of ['memory_records','memory_commands','memory_suppressions','memory_tombstones','memory_corrections','memory_curation_jobs','memory_luna_appraisals',
            'm5_clarifications','m5_trash','m5_privacy_ops','p2_memory_replay_feed','p2_memory_replay_cursors','p2_memory_replay_player_cursors','m3_coverage','m3_observer_coverage',
            'm6_p2_checkpoints','m6_p2_source_receipts','m6_p2_rejections','m6_p2_ack_diagnostics','m6_p2_ack_receipts']){
            this.#db.prepare('DELETE FROM '+table+' WHERE character_id=?').run(previous.characterId);
          }
        }
      }
      this.#db.exec('DELETE FROM promoted_profiles');
      const insert=this.#db.prepare('INSERT INTO promoted_profiles(character_id,owner_alias,position,revision,profile_json) VALUES (?,?,?,?,?)');
      data.profiles.forEach((p,i)=>insert.run(p.characterId,p.promotion.ownerAlias,i,p.revision,JSON.stringify(p)));
      const raw=JSON.stringify(data)+'\n';
      this.#db.prepare('UPDATE p2_store SET revision=?, source_sha256=?, snapshot_json=? WHERE singleton=1')
        .run(data.revision,sha256(raw),raw);
    });
    this.#snapshot=data;
    return data;
  }
  createTimeline({timelineId=randomUUID(),label='Playthrough',createdAtUtc=new Date().toISOString()}={}){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    if(!isUuid(timelineId)||typeof label!=='string'||!label.trim()||label.length>80)fail('invalid_timeline');
    this.#db.prepare('INSERT INTO timelines(timeline_id,world_profile_id,label,created_at_utc,active) VALUES (?,?,?,?,0)')
      .run(timelineId,this.worldProfileId,label,createdAtUtc);
    return timelineId;
  }
  listTimelines(){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    return this.#db.prepare('SELECT timeline_id AS timelineId,label,created_at_utc AS createdAtUtc,active FROM timelines ORDER BY created_at_utc').all();
  }
  activateTimeline(timelineId){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    if(!isUuid(timelineId))fail('invalid_timeline');
    transaction(this.#db,()=>{
      const found=this.#db.prepare('SELECT timeline_id FROM timelines WHERE timeline_id=? AND world_profile_id=?').get(timelineId,this.worldProfileId);
      if(!found)fail('timeline_unknown');
      this.#db.exec('UPDATE timelines SET active=0 WHERE active=1');
      this.#db.prepare('UPDATE timelines SET active=1 WHERE timeline_id=?').run(timelineId);
    });
    return timelineId;
  }
  activeTimelineId(){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    return this.#db.prepare('SELECT timeline_id AS timelineId FROM timelines WHERE active=1').get()?.timelineId??null;
  }
  // These are the only journal SQL entrypoints. The P2 store keeps this
  // foundation private and invokes writes through its withTimelineWrite fence.
  appendDialogueLine(line,attribution){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    return transaction(this.#db,()=>appendDialogue(this.#db,line,attribution,this.worldProfileId));
  }
  appendJournalEvent(event,options={}){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    return transaction(this.#db,()=>appendEvent(this.#db,event,this.worldProfileId,options));
  }
  readVerifiedEventEvidence(scope){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    return readVerifiedEventEvidence(this.#db,scope,this.worldProfileId);
  }
  withP2SqliteRead(operation){
    if(!this.#db||typeof operation!=='function')fail('p2_sqlite_operation_unavailable');
    const result=operation(this.#db);
    if(result?.then)fail('p2_sqlite_async_read_not_supported');
    return result;
  }
  withP2SqliteTransaction(operation){
    if(!this.#db||typeof operation!=='function')fail('p2_sqlite_operation_unavailable');
    return transaction(this.#db,()=>operation(this.#db));
  }
  readM6Checkpoint(request){return readM6CheckpointSql(this.#db,request,this.worldProfileId);}
  readM6JournalPage(request){return readM6JournalPageSql(this.#db,request,this.worldProfileId);}
  // P2 sole writer and timeline-CAS own acknowledgments.
  ackM6Checkpoint(request){return ackM6CheckpointSql(this.#db,request,this.worldProfileId);}
  readReplayPage(request){return readP2ReplayPage(this.#db,request,this.worldProfileId);}
  readReplayCursor(request){return readP2ReplayCursor(this.#db,request,this.worldProfileId);}
  acknowledgeReplayCursor(request){
    return transaction(this.#db,()=>acknowledgeP2ReplayCursor(this.#db,request,this.worldProfileId));
  }
  listMemoryCandidates(scope,options){return listMemoryCandidates(this.#db,scope,this.worldProfileId,options);}
  listSuppressedMemoryIds(scope){return listSuppressedMemoryIds(this.#db,scope,this.worldProfileId);}
  verifyMemoryCommand(args){return verifyPersistedMemoryCommand(this.#db,args,this.worldProfileId);}
  commitMemoryCommand(args){return commitPersistedMemoryCommand(this.#db,args,this.worldProfileId);}
  persistDeterministicMemory(proposal){return persistDeterministicMemory(this.#db,proposal,this.worldProfileId);}
  readPermanentMemoryRows(scope,options){return readPermanentMemoryRows(this.#db,scope,this.worldProfileId,options);}
  readCorrectionOverlays(scope){return readCorrectionOverlays(this.#db,scope,this.worldProfileId);}
  readIntegratedRecall(query){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    if(query?.scope?.worldProfileId!==this.worldProfileId)fail('m4_recall_wrong_world');
    return readIntegratedRecall(this.#db,query);
  }
  appendM3Coverage(record){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    if(record?.worldProfileId!==this.worldProfileId)fail('m3_coverage_wrong_world');
    return transaction(this.#db,()=>appendM3Coverage(this.#db,record));
  }
  // Authenticated observer-coverage ledger (K-13 write side). One synchronous
  // transaction under the caller's timeline write fence; `seal` moves `open`
  // windows left by an earlier process to `closed` without extending them.
  appendObserverCoverage(ops){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    if(!Array.isArray(ops)||ops.length<1||ops.length>256)fail('m3_observer_coverage_invalid_batch');
    for(const op of ops)if(op?.record?.worldProfileId!==this.worldProfileId&&op?.seal?.worldProfileId!==this.worldProfileId)
      fail('m3_coverage_wrong_world');
    return transaction(this.#db,()=>{
      let inserted=0,updated=0,duplicate=0,sealed=0;
      for(const op of ops){
        if(op.seal){sealed+=sealStaleObserverCoverage(this.#db,op.seal).sealed;continue;}
        const r=upsertObserverCoverage(this.#db,op.record);
        inserted+=Number(r.inserted);updated+=Number(r.updated);duplicate+=Number(r.duplicate);
      }
      return Object.freeze({inserted,updated,duplicate,sealed});
    });
  }
  readObserverCoverage(scope){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    if(scope?.worldProfileId!==this.worldProfileId)fail('m3_coverage_wrong_world');
    return readObserverCoverage(this.#db,scope);
  }
  readM3Coverage(scope){
    if(!this.#db)fail('sqlite_profile_uninitialized');
    if(scope?.worldProfileId!==this.worldProfileId)fail('m3_coverage_wrong_world');
    return readM3Coverage(this.#db,scope);
  }
  enqueueCuration(args,timelineId){return enqueueCuration(this.#db,args,this.worldProfileId,timelineId);}
  claimCuration(args,timelineId){return claimCuration(this.#db,args,this.worldProfileId,timelineId);}
  verifyCurationLease(args,timelineId){return verifyCurationLease(this.#db,args,this.worldProfileId,timelineId);}
  completeCuration(args,timelineId){return completeCuration(this.#db,args,this.worldProfileId,timelineId);}
  retryCuration(args,timelineId){return retryCuration(this.#db,args,this.worldProfileId,timelineId);}
  releaseCuration(args,timelineId){return releaseCuration(this.#db,args,this.worldProfileId,timelineId);}
  reserveCurationBudget(args,budget){return reserveCurationBudget(this.#db,args,this.worldProfileId,budget);}
  finishCurationBudget(args,state){return finishCurationBudget(this.#db,args,this.worldProfileId,state);}
  readFreeRecallWindow(scope){if(!this.#db)fail('sqlite_profile_uninitialized');return readFreeRecallWindow(this.#db,scope,this.worldProfileId);}
  readDialogueLines(scope){if(!this.#db)fail('sqlite_profile_uninitialized');return readDialogue(this.#db,scope,this.worldProfileId);}
  findExactQuote(scope){if(!this.#db)fail('sqlite_profile_uninitialized');return findExactQuote(this.#db,scope,this.worldProfileId);}
  searchDialogue(scope){if(!this.#db)fail('sqlite_profile_uninitialized');return searchDialogue(this.#db,scope,this.worldProfileId);}
  readJournalEvents(scope){if(!this.#db)fail('sqlite_profile_uninitialized');return readEvents(this.#db,scope,this.worldProfileId);}
  close(){if(this.#db){this.#db.close();this.#db=null;this.#snapshot=null;this.#init=null;}}
}
