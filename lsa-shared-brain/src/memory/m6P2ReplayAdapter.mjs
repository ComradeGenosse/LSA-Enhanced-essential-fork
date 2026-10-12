// W06: strict M6 projection/ack over Agent B's SINGLE P2 SQLite replay feed.
// No new SQLite connections, speculative sources, or independently writable cursors.
import {createHash} from 'node:crypto';
import {isUuid} from '../util/identity.mjs';
import {readVerifiedEventEvidence} from './journalSqlite.mjs';
import {listSuppressedMemoryIds,readCorrectionOverlays} from './integratedSqlite.mjs';
import {normalizedEvidence} from './evidence.mjs';

const fail = code => {throw new Error(code);};
const hash = value => createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
const HEX = /^[0-9a-f]{64}$/;
const DIGITS = /^(0|[1-9][0-9]*)$/;
const SCOPE = 'world_profile_id=? AND character_id=? AND timeline_id=?';
const entryScope = s => [s.worldProfileId,s.characterId,s.timelineId];
const validTime = x => typeof x==='string' && Number.isFinite(Date.parse(x));
const MAX_PAGE = 1000;
function validate(db,scope,world){
  if(!scope||!entryScope(scope).every(isUuid)||scope.worldProfileId!==world)fail('m6_p2_invalid_scope');
  if(!db.prepare('SELECT 1 FROM promoted_profiles WHERE character_id=?').get(scope.characterId) ||
    !db.prepare('SELECT 1 FROM timelines WHERE timeline_id=? AND world_profile_id=? AND active=1')
      .get(scope.timelineId,scope.worldProfileId))fail('m6_p2_inactive_or_missing_owner');
  return scope;
}
function seq(v) {
  if(v===null||v===undefined)return 0;
  if(typeof v!=='string'||!DIGITS.test(v))fail('m6_p2_invalid_cursor');
  const n=Number(v);
  if(!Number.isSafeInteger(n)||n<0||String(n)!==v)fail('m6_p2_invalid_cursor');
  return n;
}
function current(db,scope){
  return db.prepare('SELECT * FROM m6_p2_checkpoints WHERE '+SCOPE).get(...entryScope(scope));
}
function blocked(db,scope,world){
  const result=new Set();
  for(const protagonistKey of ['unknown','franklin','michael','trevor']){
    const keyed={...scope,protagonistKey};
    for(const id of listSuppressedMemoryIds(db,keyed,world))result.add(id);
    for(const row of readCorrectionOverlays(db,keyed,world))
      if(isUuid(row.targetId))result.add(row.targetId);
  }
  return result;
}
function projection(db,entry,scope,world,ban){
  if(!isUuid(entry.record_id)||!['dialogue','event'].includes(entry.kind))fail('m6_p2_feed_corrupt');
  const stub=reason=>Object.freeze({version:1,kind:'replay_rejection',recordId:entry.record_id,
    characterId:scope.characterId,worldProfileId:world,timelineId:scope.timelineId,
    replayRejection:reason});
  if(ban.has(entry.record_id))return stub('forgotten_or_corrected');
  if(entry.kind==='dialogue'){
    const row=db.prepare('SELECT * FROM dialogue_journal WHERE record_id=? AND '+SCOPE)
      .get(entry.record_id,...entryScope(scope));
    if(!row)return stub('source_removed');
    if(row.protagonist!==entry.protagonist_key)fail('m6_p2_feed_protagonist_changed');
    if(hash(row.envelope_json)!==row.envelope_sha256||hash(row.content)!==row.content_sha256)
      fail('m6_p2_source_hash_corrupt');
    let envelope;
    try{envelope=JSON.parse(row.envelope_json);}catch{fail('m6_p2_source_json_corrupt');}
    if(envelope.recordId!==entry.record_id||envelope.content!==row.content||
       envelope.characterId!==scope.characterId||envelope.worldProfileId!==world||
       envelope.timelineId!==scope.timelineId)fail('m6_p2_source_envelope_changed');
    return Object.freeze({...envelope,attribution:{sessionId:row.session_id,
      protagonist:row.protagonist,hostRunId:row.host_run_id,worldEpoch:row.world_epoch}});
  }
  const row=db.prepare('SELECT * FROM event_journal WHERE record_id=? AND '+SCOPE)
    .get(entry.record_id,...entryScope(scope));
  if(!row)return stub('source_removed');
  if(hash(row.envelope_json)!==row.envelope_sha256)fail('m6_p2_source_hash_corrupt');
  // Absence of source-time PS2 sidecar is an audited rejection, NOT witnessing.
  const evidence=readVerifiedEventEvidence(db,{characterId:scope.characterId,
    timelineId:scope.timelineId,recordId:entry.record_id},world);
  if(!evidence)return stub('unverified_event');
  const owner=db.prepare('SELECT owner_alias FROM promoted_profiles WHERE character_id=?')
    .get(scope.characterId);
  if(evidence.event.ownerProof?.ownerAlias!==owner?.owner_alias)
    fail('m6_p2_observer_owner_changed');
  if(evidence.event.recordId!==entry.record_id||evidence.event.sourceHash!==row.source_hash)
    fail('m6_p2_event_source_mismatch');
  return evidence.event;
}
function pageEntries(db,scope,after,limit){
  return db.prepare('SELECT sequence,kind,record_id,protagonist_key FROM p2_memory_replay_feed WHERE '+
    SCOPE+' AND sequence>? ORDER BY sequence ASC LIMIT ?')
    .all(...entryScope(scope),after,limit);
}
function stamp(e){return e.kind==='journal_event'?e.receivedAtUtc:e.kind==='dialogue_line'?e.committedAtUtc:null;}
export function ensureM6P2ReplaySchema(db){
  db.exec(`
    CREATE TABLE IF NOT EXISTS m6_p2_checkpoints (
      world_profile_id TEXT NOT NULL,character_id TEXT NOT NULL,timeline_id TEXT NOT NULL,
      after_sequence INTEGER NOT NULL CHECK(after_sequence>=0),last_cutoff_utc TEXT,last_source_utc TEXT,
      hour_bucket TEXT,active_hour_count INTEGER NOT NULL DEFAULT 0 CHECK(active_hour_count>=0),
      PRIMARY KEY(world_profile_id,character_id,timeline_id));
    CREATE TABLE IF NOT EXISTS m6_p2_source_receipts (
      sequence INTEGER PRIMARY KEY, world_profile_id TEXT NOT NULL,character_id TEXT NOT NULL,
      timeline_id TEXT NOT NULL,record_id TEXT NOT NULL,source_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS m6_p2_rejections (
      world_profile_id TEXT NOT NULL,character_id TEXT NOT NULL,timeline_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,record_id TEXT,reason TEXT NOT NULL,
      PRIMARY KEY(world_profile_id,character_id,timeline_id,sequence,reason));
    CREATE TABLE IF NOT EXISTS m6_p2_ack_diagnostics (
      world_profile_id TEXT NOT NULL,character_id TEXT NOT NULL,timeline_id TEXT NOT NULL,
      after_sequence INTEGER NOT NULL,diagnostic_index INTEGER NOT NULL,
      record_id TEXT,reason TEXT NOT NULL,
      PRIMARY KEY(world_profile_id,character_id,timeline_id,after_sequence,diagnostic_index));
    CREATE TABLE IF NOT EXISTS m6_p2_ack_receipts (
      world_profile_id TEXT NOT NULL,character_id TEXT NOT NULL,timeline_id TEXT NOT NULL,
      after_sequence INTEGER NOT NULL, prior_sequence INTEGER NOT NULL,
      request_hash TEXT NOT NULL,at_utc TEXT NOT NULL,
      PRIMARY KEY(world_profile_id,character_id,timeline_id,after_sequence));
    -- M5 authorized physical purge deletes B's replay entry. No W06 archive
    -- may retain identifying provenance after that deletion.
    CREATE TRIGGER IF NOT EXISTS m6_p2_replay_feed_ad AFTER DELETE ON p2_memory_replay_feed BEGIN
      DELETE FROM m6_p2_source_receipts WHERE sequence=OLD.sequence;
      DELETE FROM m6_p2_rejections WHERE sequence=OLD.sequence;
      DELETE FROM m6_p2_ack_diagnostics WHERE world_profile_id=OLD.world_profile_id
        AND character_id=OLD.character_id AND timeline_id=OLD.timeline_id
        AND record_id=OLD.record_id;
    END;
  `);
}
export function readM6CheckpointSql(db,{scope},world){
  validate(db,scope,world);
  const cp=current(db,scope);
  return Object.freeze({version:1,cursor:cp?String(cp.after_sequence):null,
    activeHourCount:cp?.active_hour_count??0,hourBucket:cp?.hour_bucket??null,
    lastCutoffUtc:cp?.last_cutoff_utc??null,lastSourceUtc:cp?.last_source_utc??null});
}
export function readM6JournalPageSql(db,{scope,afterCursor=null,limit=250},world){
  validate(db,scope,world);
  if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_PAGE)fail('m6_p2_invalid_limit');
  const after=seq(afterCursor),entries=pageEntries(db,scope,after,limit+1);
  const ban=blocked(db,scope,world);
  const rows=entries.slice(0,limit).map(entry=>{
    const evidence=projection(db,entry,scope,world,ban);
    const sourceHash=hash(evidence);
    const audit=db.prepare('SELECT source_hash FROM m6_p2_source_receipts WHERE sequence=?')
      .get(entry.sequence);
    if(audit&&audit.source_hash!==sourceHash)fail('m6_p2_immutable_hash_mismatch');
    return Object.freeze({cursor:String(entry.sequence),sourceHash,evidence});
  });
  return Object.freeze({rows:Object.freeze(rows),hasMore:entries.length>limit});
}
export function ackM6CheckpointSql(db,request,world){
  const {scope,expectedCursor=null,nextCursor,sourceHashes,savedProposalIds=[],rejected=[],
    cutoffUtc,hourBucket,lastSourceUtc=null,cloudQueueEnabled=false}=request??{};
  validate(db,scope,world);
  if(!Array.isArray(sourceHashes)||!Array.isArray(savedProposalIds)||!Array.isArray(rejected)||
     !validTime(cutoffUtc)||typeof hourBucket!=='string'||hourBucket!==cutoffUtc.slice(0,13)||
     (lastSourceUtc!==null&&!validTime(lastSourceUtc))||typeof cloudQueueEnabled!=='boolean')fail('m6_p2_bad_ack');
  const prior=seq(expectedCursor),next=seq(nextCursor),cp=current(db,scope);
  const old=cp?.after_sequence??0;
  if(next<=prior)fail('m6_p2_nonadvancing_ack');
  if(cp?.last_cutoff_utc&&Date.parse(cutoffUtc)<Date.parse(cp.last_cutoff_utc))
    fail('m6_p2_clock_regression');
  const requestHash=hash({scope,expectedCursor,nextCursor,sourceHashes,
    savedProposalIds,rejected,cutoffUtc,hourBucket,lastSourceUtc,cloudQueueEnabled});
  if(old!==prior){
    const previous=db.prepare('SELECT request_hash,prior_sequence FROM m6_p2_ack_receipts WHERE '+
      SCOPE+' AND after_sequence=?').get(...entryScope(scope),next);
    if(old===next&&previous?.prior_sequence===prior&&previous?.request_hash===requestHash)
      return Object.freeze({committed:true,cursor:String(next),idempotent:true});
    fail('m6_p2_checkpoint_cas_conflict');
  }
  const entries=db.prepare('SELECT sequence,kind,record_id,protagonist_key FROM p2_memory_replay_feed WHERE '+
    SCOPE+' AND sequence>? AND sequence<=? ORDER BY sequence ASC')
    .all(...entryScope(scope),prior,next);
  if(!entries.length||entries.at(-1).sequence!==next||entries.length!==sourceHashes.length)
    fail('m6_p2_ack_skips_or_loses_feed');
  const ban=blocked(db,scope,world),invalid=new Map(),observed=new Set();
  let previousSource=cp?.last_source_utc?Date.parse(cp.last_source_utc):null;
  for(let i=0;i<entries.length;i++){
    const entry=entries[i],proof=sourceHashes[i];
    if(!proof||proof.cursor!==String(entry.sequence)||proof.recordId!==entry.record_id||
       !HEX.test(proof.sourceHash))fail('m6_p2_ack_source_order');
    const evidence=projection(db,entry,scope,world,ban),digest=hash(evidence);
    if(proof.sourceHash!==digest)fail('m6_p2_ack_source_mutated');
    const existing=db.prepare('SELECT source_hash FROM m6_p2_source_receipts WHERE sequence=?').get(entry.sequence);
    if(existing&&existing.source_hash!==digest)fail('m6_p2_ack_immutable_conflict');
    if(evidence.kind==='replay_rejection')invalid.set(entry.record_id,evidence.replayRejection);
    else{
      try{normalizedEvidence(evidence);}catch(e){invalid.set(entry.record_id,e.message);}
    }
    const sourceTime=stamp(evidence);
    if(validTime(sourceTime)){
      const t=Date.parse(sourceTime);
      if(previousSource!==null&&t<previousSource)fail('m6_p2_source_clock_regression');
      previousSource=t;
    }
    observed.add(entry.record_id);
  }
  const expectedSource=previousSource===null?null:new Date(previousSource).toISOString();
  if(lastSourceUtc!==expectedSource)fail('m6_p2_last_source_mismatch');
  for(const [id,why] of invalid)
    if(!rejected.some(r=>r.recordId===id&&r.reason===why))
      fail('m6_p2_unaccounted_invalid_source');
  const unique=new Set();
  for(const id of savedProposalIds){
    if(!isUuid(id)||unique.has(id))fail('m6_p2_invalid_saved_proposals');
    unique.add(id);
    const row=db.prepare('SELECT proposal_json,evidence_ids_json,content,content_sha256 FROM memory_records WHERE '+
      SCOPE+' AND memory_id=? AND origin=\'deterministic\'')
      .get(...entryScope(scope),id);
    if(!row||!row.proposal_json)fail('m6_p2_unsaved_proposal');
    let proposal,ids;
    try{proposal=JSON.parse(row.proposal_json);ids=JSON.parse(row.evidence_ids_json);}
    catch{fail('m6_p2_invalid_proposal_json');}
    if(hash(row.content)!==row.content_sha256||row.content!==proposal.groundedSummary)
      fail('m6_p2_corrupt_saved_content');
    if(proposal.proposalId!==id||!Array.isArray(ids)||!ids.length||
       JSON.stringify(ids)!==JSON.stringify(proposal.evidenceRecordIds)||
       ids.some(x=>!observed.has(x)||ban.has(x)))fail('m6_p2_proposal_source_revoked');
    if(cloudQueueEnabled){
      const job=db.prepare('SELECT job_json FROM memory_curation_jobs WHERE job_id=? AND '+
        SCOPE).get(id,...entryScope(scope));
      if(!job)fail('m6_p2_missing_durable_m7_job');
      let committed;
      try{committed=JSON.parse(job.job_json);}catch{fail('m6_p2_corrupt_m7_job');}
      if(committed.jobId!==id||JSON.stringify(committed.proposal)!==row.proposal_json)
        fail('m6_p2_conflicting_m7_job');
    }
  }
  for(const entry of entries){
    const proof=sourceHashes.find(r=>r.cursor===String(entry.sequence));
    db.prepare('INSERT INTO m6_p2_source_receipts(sequence,world_profile_id,character_id,timeline_id,record_id,source_hash) VALUES(?,?,?,?,?,?) ON CONFLICT(sequence) DO NOTHING')
      .run(entry.sequence,...entryScope(scope),entry.record_id,proof.sourceHash);
  }
  for(const [diagnosticIndex,r] of rejected.entries()){
    if(!r||typeof r.reason!=='string'||!r.reason.length||r.reason.length>160)
      fail('m6_p2_invalid_rejection');
    db.prepare('INSERT INTO m6_p2_ack_diagnostics VALUES(?,?,?,?,?,?,?)')
      .run(...entryScope(scope),next,diagnosticIndex,r.recordId??null,r.reason);
    // Some diagnostics are proposal-level; row-level ones are persisted by sequence.
    for(const entry of entries.filter(e=>e.record_id===r.recordId))
      db.prepare('INSERT OR IGNORE INTO m6_p2_rejections VALUES(?,?,?,?,?,?)')
        .run(...entryScope(scope),entry.sequence,entry.record_id,r.reason);
  }
  const count=(cp?.hour_bucket===hourBucket?cp.active_hour_count:0)+unique.size;
  db.prepare('INSERT INTO m6_p2_checkpoints(world_profile_id,character_id,timeline_id,after_sequence,last_cutoff_utc,last_source_utc,hour_bucket,active_hour_count) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(world_profile_id,character_id,timeline_id) DO UPDATE SET after_sequence=excluded.after_sequence,last_cutoff_utc=excluded.last_cutoff_utc,last_source_utc=excluded.last_source_utc,hour_bucket=excluded.hour_bucket,active_hour_count=excluded.active_hour_count')
    .run(...entryScope(scope),next,cutoffUtc,lastSourceUtc,hourBucket,count);
  db.prepare('INSERT INTO m6_p2_ack_receipts VALUES(?,?,?,?,?, ?, ?)')
    .run(...entryScope(scope),next,prior,requestHash,new Date().toISOString());
  return Object.freeze({committed:true,cursor:String(next),idempotent:false});
}
// K may wrap P2 through this explicit B->G bridge. It never owns the DB.
export function createM6P2ReplayAdapter(p2){
  for(const name of ['readCommittedEvidenceCursor','readCommittedEvidencePage',
      'ackCommittedEvidenceCursor','readM6Checkpoint','readM6JournalPage',
      'ackM6Checkpoint','saveDeterministicMemory','enqueueCurationJob',
      'listSuppressedMemoryIds','readCorrectionOverlays','readVerifiedEventEvidence']){
    if(typeof p2?.[name]!=='function')fail('m6_p2_missing_'+name);
  }
  return Object.freeze({
    get worldProfileId(){return p2.worldProfileId;},
    get activeTimelineId(){return p2.activeTimelineId;},
    get timelineWritable(){return p2.timelineWritable;},
    get:(...args)=>p2.get(...args),
    readM6Checkpoint:args=>p2.readM6Checkpoint(args),
    readM6JournalPage:args=>p2.readM6JournalPage(args),
    ackM6Checkpoint:args=>p2.ackM6Checkpoint(args),
    saveDeterministicMemory:args=>p2.saveDeterministicMemory(args),
    enqueueCurationJob:args=>p2.enqueueCurationJob(args),
    listSuppressedMemoryIds:args=>p2.listSuppressedMemoryIds(args),
    readCorrectionOverlays:args=>p2.readCorrectionOverlays(args),
    readVerifiedEventEvidence:args=>p2.readVerifiedEventEvidence(args)
  });
}
