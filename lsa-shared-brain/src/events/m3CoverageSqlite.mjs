// Optional additive M3 SQL tables: Agent H must install in the P2-owned
// migration and expose a port on the SAME serialized timeline write fence.
// This module does not reach into SQLite Foundation or start nested transactions.
import {createHash} from 'node:crypto';
import {isUuid,immutableSnapshot} from '../util/identity.mjs';
import {validOwnerProof} from './journalEventNormalizer.mjs';
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const statuses=new Set(['did_not_witness','unknown','unavailable']);
const fail=s=>{throw new Error(s);};
export const M3_COVERAGE_DDL=`
CREATE TABLE IF NOT EXISTS m3_coverage (
 world_profile_id TEXT NOT NULL,
 timeline_id TEXT NOT NULL REFERENCES timelines(timeline_id) ON DELETE CASCADE,
 character_id TEXT NOT NULL,
 observation_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('did_not_witness','unknown','unavailable')),
 evidence_json TEXT NOT NULL, evidence_hash TEXT NOT NULL,
 PRIMARY KEY(world_profile_id,timeline_id,character_id,observation_id)
);
CREATE INDEX IF NOT EXISTS m3_coverage_scope
 ON m3_coverage(world_profile_id,character_id,timeline_id,status);
`;
// Repair for databases created before this fix. `m3_coverage.character_id`
// used to REFERENCE promoted_profiles ON DELETE CASCADE, but every P2 profile
// compare-and-swap does `DELETE FROM promoted_profiles` and re-inserts all rows
// (sqliteFoundation.replaceSnapshot), so ANY profile edit silently erased every
// character's coverage. Like event_journal, durable evidence is keyed by
// character_id with explicit per-character deletion, not by a cascading FK.
function repairCascadingProfileForeignKey(db){
  const cascades=db.prepare("PRAGMA foreign_key_list(m3_coverage)").all()
    .some(row=>row.table==='promoted_profiles');
  if(!cascades)return false;
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec('ALTER TABLE m3_coverage RENAME TO m3_coverage_legacy_fk');
    db.exec(M3_COVERAGE_DDL.replace(/CREATE INDEX IF NOT EXISTS m3_coverage_scope[\s\S]*$/,''));
    db.exec('INSERT INTO m3_coverage SELECT world_profile_id,timeline_id,character_id,observation_id,status,evidence_json,evidence_hash FROM m3_coverage_legacy_fk');
    db.exec('DROP TABLE m3_coverage_legacy_fk');
    db.exec('CREATE INDEX IF NOT EXISTS m3_coverage_scope ON m3_coverage(world_profile_id,character_id,timeline_id,status)');
    db.exec('COMMIT');
    return true;
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
}
export function ensureM3CoverageSchema(db){
  db.exec(M3_COVERAGE_DDL);
  repairCascadingProfileForeignKey(db);
  db.exec(M3_OBSERVER_COVERAGE_DDL);
}
export function validateM3Coverage(record){
  if(!record||!isUuid(record.characterId)||!isUuid(record.worldProfileId)||
     !isUuid(record.timelineId)||!isUuid(record.observationId)||
     !isUuid(record.adapterEpoch)||
     !statuses.has(record.status)||typeof record.reason!=='string'||
     record.reason.length>80||!validOwnerProof(record.ownerProof))
    fail('m3_coverage_invalid');
  if(record.status==='did_not_witness'){
    // Only a separately authenticated native receipt can certify a negative.
    // This fact must be supplied by the binder's checked native authority, NOT
    // from a model, absence of a PS2 observation, or a generic listener.
    const c=record.nativeCoverage;
    if(!c||c.certified!==true||c.nativeVerified!==true||
       !isUuid(c.sourceReceiptId)||c.observationId!==record.observationId||
       c.adapterEpoch!==record.adapterEpoch||
       c.ownerAlias!==record.ownerProof.ownerAlias||
       c.incarnationId!==record.ownerProof.incarnationId||
       c.encounterId!==record.ownerProof.encounterId||
       c.status!=='did_not_witness'||c.observerCaptureRef!==record.ownerProof.observerCaptureRef||
       c.hostRunId!==record.ownerProof.hostRunId||
       c.worldEpoch!==record.ownerProof.worldEpoch||
       !Number.isSafeInteger(c.sampledGameTick)||c.sampledGameTick<0||
       !['visual','auditory','self'].includes(c.channel)||
       !['native_awareness','sampled_state','native_callback','audibility_model'].includes(c.basis))
      fail('m3_negative_not_certified');
  }else if(record.nativeCoverage!==null&&record.nativeCoverage!==undefined)
    fail('m3_unknown_cannot_carry_negative_proof');
  return immutableSnapshot(record);
}
export function appendM3Coverage(db,input){
  const record=validateM3Coverage(input);
  const raw=JSON.stringify(record),digest=hash(record);
  const key=[record.worldProfileId,record.timelineId,record.characterId,record.observationId];
  const old=db.prepare('SELECT evidence_json,evidence_hash FROM m3_coverage WHERE world_profile_id=? AND timeline_id=? AND character_id=? AND observation_id=?').get(...key);
  if(old){
    if(old.evidence_hash!==hash(JSON.parse(old.evidence_json))||
       old.evidence_hash!==digest||old.evidence_json!==raw)fail('m3_coverage_conflicting_receipt');
    return Object.freeze({inserted:false,duplicate:true});
  }
  db.prepare('INSERT INTO m3_coverage (world_profile_id,timeline_id,character_id,observation_id,status,evidence_json,evidence_hash) VALUES (?,?,?,?,?,?,?)')
    .run(...key,record.status,raw,digest);
  return Object.freeze({inserted:true,duplicate:false});
}
export function readM3Coverage(db,{characterId,worldProfileId,timelineId,observationId}={}){
  if(![characterId,worldProfileId,timelineId,observationId].every(isUuid))fail('m3_coverage_invalid_scope');
  const row=db.prepare('SELECT evidence_json,evidence_hash FROM m3_coverage WHERE world_profile_id=? AND timeline_id=? AND character_id=? AND observation_id=?')
    .get(worldProfileId,timelineId,characterId,observationId);
  if(!row)return Object.freeze({status:'unknown',certified:false,
    evidencePresent:false,reason:'no_source_qualified_coverage'});
  const record=JSON.parse(row.evidence_json);
  if(hash(record)!==row.evidence_hash)fail('m3_coverage_corrupt');
  validateM3Coverage(record);
  return Object.freeze({status:record.status,certified:record.status==='did_not_witness',
    evidencePresent:true,record:immutableSnapshot(record)});
}

// ---------------------------------------------------------------------------
// K-13 write side: authenticated observer-coverage ledger.
//
// `m3_coverage` above records a per-observation negative that only a native
// per-signal certificate can prove. This ledger answers the question recall
// needs first: "during which time was this promoted NPC's capture pipeline
// authenticated, owned and continuously sampled, so that the ABSENCE of a
// journal event is meaningful?"
//
//  * kind='window': contiguous span covered by authenticated native owner
//    frames. start/end are first/last authenticated sample (cadence-granular).
//  * kind='gap': a point (or coalesced burst) at which known observations were lost (queue overflow,
//    rejected or failed commit). Any gap inside a requested range makes the
//    range incomplete, even though a window spans it.
//
// Time outside every window is uncovered by definition (pause, stall, reset,
// roster loss, disconnect, process restart): coverage is never inferred.
// Rows have no foreign key to promoted_profiles (see the repair above); a
// character's rows are removed by the explicit deletion list in
// sqliteFoundation.replaceSnapshot.
export const M3_OBSERVER_COVERAGE_DDL=`
CREATE TABLE IF NOT EXISTS m3_observer_coverage (
 coverage_id TEXT PRIMARY KEY,
 world_profile_id TEXT NOT NULL,
 timeline_id TEXT NOT NULL REFERENCES timelines(timeline_id),
 character_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('window','gap')),
 status TEXT NOT NULL CHECK(status IN ('open','closed')),
 close_reason TEXT,
 process_id TEXT NOT NULL,
 host_run_id TEXT NOT NULL,
 world_epoch INTEGER NOT NULL,
 start_tick INTEGER NOT NULL, end_tick INTEGER NOT NULL,
 start_utc TEXT NOT NULL, end_utc TEXT NOT NULL,
 frames INTEGER NOT NULL, last_sequence INTEGER NOT NULL,
 identity_json TEXT NOT NULL, identity_sha256 TEXT NOT NULL,
 CHECK(end_tick>=start_tick), CHECK(end_utc>=start_utc)
);
CREATE INDEX IF NOT EXISTS m3_observer_coverage_scope
 ON m3_observer_coverage(world_profile_id,character_id,timeline_id,start_utc,end_utc);
CREATE INDEX IF NOT EXISTS m3_observer_coverage_open
 ON m3_observer_coverage(world_profile_id,status) WHERE status='open';
`;
const UTC_MS=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const validUtc=x=>typeof x==='string'&&UTC_MS.test(x)&&Number.isFinite(Date.parse(x));
const tickOk=x=>Number.isSafeInteger(x)&&x>=0&&x<=0xffffffff;
export const OBSERVER_COVERAGE_CLOSE_REASONS=Object.freeze([
  'sequence_gap','tick_gap','tick_regression','delivery_gap','game_paused',
  'owner_absent','owner_changed','profile_unavailable','epoch_boundary',
  'stream_changed','stream_retired','timeline_changed','timeline_unwritable',
  'host_disconnected','shutdown','process_restart','ledger_degraded']);
export const OBSERVER_GAP_REASONS=Object.freeze([
  'intake_overflow','intake_closed','receipt_too_large','owner_unverified',
  'bind_failed','recorder_rejected','commit_failed','retired_before_commit',
  'scheduler_failed']);
const CLOSE=new Set(OBSERVER_COVERAGE_CLOSE_REASONS),GAP=new Set(OBSERVER_GAP_REASONS);
const identityKeys=['version','kind','coverageId','characterId','worldProfileId','timelineId','processId',
  'hostRunId','worldEpoch','adapterEpoch','streamId','ownerProof','startTick','startUtc','firstSequence',
  'basis','observationId','gapReason'];
export function validateObserverCoverageRecord(record){
  const r=record;
  if(!r||!isUuid(r.coverageId)||!['window','gap'].includes(r.kind)||!isUuid(r.characterId)||
     !isUuid(r.worldProfileId)||!isUuid(r.timelineId)||!isUuid(r.processId)||
     !isUuid(r.hostRunId)||!Number.isSafeInteger(r.worldEpoch)||r.worldEpoch<1||
     !isUuid(r.adapterEpoch)||!isUuid(r.streamId)||!validOwnerProof(r.ownerProof)||
     r.ownerProof.hostRunId!==r.hostRunId||r.ownerProof.worldEpoch!==r.worldEpoch||
     !tickOk(r.startTick)||!tickOk(r.endTick)||r.endTick<r.startTick||
     !validUtc(r.startUtc)||!validUtc(r.endUtc)||r.endUtc<r.startUtc||
     !['open','closed'].includes(r.status)||
     !Number.isSafeInteger(r.frames)||r.frames<0||
     !Number.isSafeInteger(r.firstSequence)||r.firstSequence<0||
     !Number.isSafeInteger(r.lastSequence)||r.lastSequence<r.firstSequence)
    fail('m3_observer_coverage_invalid');
  if(r.kind==='window'){
    if(r.frames<1||r.basis!=='authenticated_owner_frames'||r.gapReason!==undefined||
       r.observationId!==undefined||
       (r.status==='open'&&r.closeReason!==null&&r.closeReason!==undefined)||
       (r.status==='closed'&&!CLOSE.has(r.closeReason)))fail('m3_observer_coverage_invalid_window');
  }else{
    if(r.status!=='closed'||r.basis!=='lost_observation'||!GAP.has(r.gapReason)||
       r.closeReason!==r.gapReason||!isUuid(r.observationId)||r.frames<1)
      fail('m3_observer_coverage_invalid_gap');
  }
  return immutableSnapshot(r);
}
const identityOf=r=>{
  const out={};
  for(const key of identityKeys)if(r[key]!==undefined)out[key]=r[key];
  return out;
};
export function upsertObserverCoverage(db,input){
  const r=validateObserverCoverageRecord(input);
  const identity=identityOf({...r,version:1});
  const raw=JSON.stringify(identity),digest=hash(identity);
  const old=db.prepare('SELECT * FROM m3_observer_coverage WHERE coverage_id=?').get(r.coverageId);
  if(!old){
    db.prepare('INSERT INTO m3_observer_coverage (coverage_id,world_profile_id,timeline_id,character_id,kind,status,close_reason,process_id,host_run_id,world_epoch,start_tick,end_tick,start_utc,end_utc,frames,last_sequence,identity_json,identity_sha256) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(r.coverageId,r.worldProfileId,r.timelineId,r.characterId,r.kind,r.status,r.closeReason??null,
        r.processId,r.hostRunId,r.worldEpoch,r.startTick,r.endTick,r.startUtc,r.endUtc,r.frames,
        r.lastSequence,raw,digest);
    return Object.freeze({inserted:true,updated:false,duplicate:false});
  }
  // Identity is immutable; only the frontier may advance, never retreat.
  if(old.identity_sha256!==hash(JSON.parse(old.identity_json))||old.identity_sha256!==digest||
     old.world_profile_id!==r.worldProfileId||old.character_id!==r.characterId||
     old.timeline_id!==r.timelineId||old.kind!==r.kind)
    fail('m3_observer_coverage_identity_conflict');
  const endTick=Math.max(old.end_tick,r.endTick),endUtc=old.end_utc>r.endUtc?old.end_utc:r.endUtc;
  const frames=Math.max(old.frames,r.frames),last=Math.max(old.last_sequence,r.lastSequence);
  // `closed` is sticky and keeps the FIRST reason; a late flush of the same
  // window may only move the end forward (a still-pending observation holds
  // the persisted end back until it settles).
  const status=old.status==='closed'?'closed':r.status;
  const reason=old.status==='closed'?old.close_reason:(r.closeReason??null);
  if(endTick===old.end_tick&&endUtc===old.end_utc&&frames===old.frames&&
     last===old.last_sequence&&status===old.status&&reason===old.close_reason)
    return Object.freeze({inserted:false,updated:false,duplicate:true});
  db.prepare('UPDATE m3_observer_coverage SET status=?,close_reason=?,end_tick=?,end_utc=?,frames=?,last_sequence=? WHERE coverage_id=?')
    .run(status,reason,endTick,endUtc,frames,last,r.coverageId);
  return Object.freeze({inserted:false,updated:true,duplicate:false});
}
// A previous companion process can only have left `open` windows when it died
// without a boundary. Their persisted end is the last checkpoint; nothing after
// it is claimed. Called under the writer fence before this process writes.
export function sealStaleObserverCoverage(db,{worldProfileId,processId}={}){
  if(!isUuid(worldProfileId)||!isUuid(processId))fail('m3_observer_coverage_invalid_scope');
  const result=db.prepare("UPDATE m3_observer_coverage SET status='closed',close_reason='process_restart' WHERE world_profile_id=? AND kind='window' AND status='open' AND process_id<>?")
    .run(worldProfileId,processId);
  return Object.freeze({sealed:Number(result.changes)});
}
const ms=utc=>Date.parse(utc);
export function readObserverCoverage(db,{characterId,worldProfileId,timelineId,fromUtc,toUtc}={}){
  if(![characterId,worldProfileId,timelineId].every(isUuid)||!validUtc(fromUtc)||!validUtc(toUtc)||
     toUtc<=fromUtc)fail('m3_observer_coverage_invalid_scope');
  const rows=db.prepare('SELECT * FROM m3_observer_coverage WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND end_utc>=? AND start_utc<=? ORDER BY start_utc,rowid')
    .all(worldProfileId,characterId,timelineId,fromUtc,toUtc);
  const windows=[],points=[];
  for(const row of rows){
    if(row.identity_sha256!==hash(JSON.parse(row.identity_json)))fail('m3_observer_coverage_corrupt');
    (row.kind==='window'?windows:points).push(row);
  }
  // Union of windows, merging only spans that actually touch or overlap.
  const merged=[];
  for(const w of windows){
    const last=merged.at(-1);
    if(last&&w.start_utc<=last.end){
      if(w.end_utc>last.end){last.end=w.end_utc;last.closeReason=w.close_reason;last.status=w.status;}
    }else merged.push({start:w.start_utc,end:w.end_utc,closeReason:w.close_reason,status:w.status});
  }
  const gaps=[];let cursor=fromUtc,coveredMs=0,previousReason=null;
  for(const span of merged){
    const s=span.start>fromUtc?span.start:fromUtc,e=span.end<toUtc?span.end:toUtc;
    if(e<s)continue;
    if(s>cursor)gaps.push({kind:'uncovered',fromUtc:cursor,toUtc:s,
      reason:previousReason??'no_authenticated_coverage'});
    coveredMs+=ms(e)-ms(s);
    if(e>cursor)cursor=e;
    previousReason=span.status==='open'?'window_open_frontier':(span.closeReason??'unknown');
  }
  if(cursor<toUtc)gaps.push({kind:'uncovered',fromUtc:cursor,toUtc,
    reason:previousReason??'no_authenticated_coverage'});
  for(const p of points)if(p.start_utc<=toUtc&&p.end_utc>=fromUtc)
    gaps.push({kind:'lost_observation',fromUtc:p.start_utc,toUtc:p.end_utc,reason:p.close_reason,
      lostObservations:p.frames});
  gaps.sort((a,b)=>a.fromUtc.localeCompare(b.fromUtc));
  return immutableSnapshot({version:1,basis:'authenticated_owner_frames',
    characterId,worldProfileId,timelineId,requested:{fromUtc,toUtc},
    requestedMs:ms(toUtc)-ms(fromUtc),coveredMs,
    // Complete only when the whole range is inside authenticated windows and no
    // known observation was lost inside it. Anything else is "unknown", never
    // a negative.
    complete:gaps.length===0,gaps,
    windows:windows.map(w=>({coverageId:w.coverage_id,hostRunId:w.host_run_id,worldEpoch:w.world_epoch,
      startUtc:w.start_utc,endUtc:w.end_utc,startTick:w.start_tick,endTick:w.end_tick,
      status:w.status,closeReason:w.close_reason,frames:w.frames}))});
}
