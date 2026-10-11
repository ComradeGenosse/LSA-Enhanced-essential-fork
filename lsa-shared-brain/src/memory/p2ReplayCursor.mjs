// Agent B: append-only, P2-owned replay feed for source-qualified committed evidence.
// All calls execute on the SINGLE P2 foundation connection; never open a new DB.
import {createHash} from 'node:crypto';
import {isUuid} from '../util/identity.mjs';
import {readVerifiedEventEvidence} from './journalSqlite.mjs';
import {listSuppressedMemoryIds,readCorrectionOverlays} from './integratedSqlite.mjs';

const fail = reason => {throw new Error(reason);};
const sha = value => createHash('sha256').update(value).digest('hex');
const keys = new Set(['franklin','michael','trevor','unknown']);
const scopeKey = s => [s.worldProfileId,s.characterId,s.timelineId,s.protagonistKey];
const where = 'world_profile_id=? AND character_id=? AND timeline_id=? AND protagonist_key=?';
const MAX_PAGE = 512;
const MAX_CONSUMER = 80;
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS p2_memory_replay_feed (',
  '  sequence INTEGER PRIMARY KEY AUTOINCREMENT,',
  '  world_profile_id TEXT NOT NULL, character_id TEXT NOT NULL, timeline_id TEXT NOT NULL,',
  '  protagonist_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN (\'dialogue\',\'event\')),',
  '  record_id TEXT NOT NULL, source_at_utc TEXT NOT NULL);',
  'CREATE INDEX IF NOT EXISTS p2_memory_replay_scope ON p2_memory_replay_feed',
  '  (world_profile_id,character_id,timeline_id,protagonist_key,sequence);',
  'CREATE TABLE IF NOT EXISTS p2_memory_replay_cursors (',
  '  consumer_id TEXT NOT NULL,world_profile_id TEXT NOT NULL,character_id TEXT NOT NULL,',
  '  timeline_id TEXT NOT NULL,protagonist_key TEXT NOT NULL,after_sequence INTEGER NOT NULL',
  '  CHECK(after_sequence >= 0),updated_at_utc TEXT NOT NULL,',
  '  PRIMARY KEY(consumer_id,world_profile_id,character_id,timeline_id,protagonist_key))'
].join(' ');
const TRIGGERS = [
  'CREATE TRIGGER IF NOT EXISTS p2_replay_dialogue_ai AFTER INSERT ON dialogue_journal BEGIN',
  ' INSERT INTO p2_memory_replay_feed(world_profile_id,character_id,timeline_id,protagonist_key,kind,record_id,source_at_utc)',
  ' VALUES(NEW.world_profile_id,NEW.character_id,NEW.timeline_id,NEW.protagonist,\'dialogue\',NEW.record_id,NEW.committed_at_utc); END;',
  'CREATE TRIGGER IF NOT EXISTS p2_replay_event_ai AFTER INSERT ON event_journal BEGIN',
  ' INSERT INTO p2_memory_replay_feed(world_profile_id,character_id,timeline_id,protagonist_key,kind,record_id,source_at_utc)',
  ' VALUES(NEW.world_profile_id,NEW.character_id,NEW.timeline_id,\'unknown\',\'event\',NEW.record_id,NEW.received_at_utc); END;',
  'CREATE TRIGGER IF NOT EXISTS p2_replay_event_au AFTER UPDATE OF envelope_sha256 ON event_journal',
  ' WHEN NEW.envelope_sha256 != OLD.envelope_sha256 BEGIN',
  ' INSERT INTO p2_memory_replay_feed(world_profile_id,character_id,timeline_id,protagonist_key,kind,record_id,source_at_utc)',
  ' VALUES(NEW.world_profile_id,NEW.character_id,NEW.timeline_id,\'unknown\',\'event\',NEW.record_id,NEW.received_at_utc); END;'
].join(' ');

export function ensureP2ReplaySchema(db) {
  db.exec(SCHEMA + '; ' + TRIGGERS);
  // Existing M2/M3 rows predate feed triggers. Backfill is idempotent and
  // append-only, without truncating or rewriting original accepted bytes.
  db.exec([
    'INSERT INTO p2_memory_replay_feed(world_profile_id,character_id,timeline_id,protagonist_key,kind,record_id,source_at_utc)',
    'SELECT j.world_profile_id,j.character_id,j.timeline_id,j.protagonist,\'dialogue\',j.record_id,j.committed_at_utc',
    'FROM dialogue_journal j WHERE NOT EXISTS (SELECT 1 FROM p2_memory_replay_feed f',
    'WHERE f.kind=\'dialogue\' AND f.record_id=j.record_id);',
    'INSERT INTO p2_memory_replay_feed(world_profile_id,character_id,timeline_id,protagonist_key,kind,record_id,source_at_utc)',
    'SELECT e.world_profile_id,e.character_id,e.timeline_id,\'unknown\',\'event\',e.record_id,e.received_at_utc',
    'FROM event_journal e WHERE NOT EXISTS (SELECT 1 FROM p2_memory_replay_feed f',
    'WHERE f.kind=\'event\' AND f.record_id=e.record_id);'
  ].join(' '));
}

function validatedScope(scope, world) {
  if (!scope || ![scope.worldProfileId,scope.characterId,scope.timelineId].every(isUuid) ||
      scope.worldProfileId !== world || !keys.has(scope.protagonistKey))
    fail('p2_replay_invalid_scope');
  return scope;
}
function validateOwner(db,scope){
  if (!db.prepare('SELECT 1 FROM promoted_profiles WHERE character_id=?').get(scope.characterId) ||
      !db.prepare('SELECT 1 FROM timelines WHERE timeline_id=? AND world_profile_id=?').get(scope.timelineId,scope.worldProfileId))
    fail('p2_replay_owner_or_timeline_missing');
}
function cursorDigest(scope) {return sha(JSON.stringify(scopeKey(scope)));}
function encode(scope,sequence){
  return Buffer.from(JSON.stringify({v:1,scope:cursorDigest(scope),after:sequence}),'utf8').toString('base64url');
}
function decode(scope,opaque){
  if(opaque === null || opaque === undefined)return 0;
  if(typeof opaque !== 'string' || opaque.length>512 || opaque.length<8)
    fail('p2_replay_invalid_cursor');
  try {
    const value=JSON.parse(Buffer.from(opaque,'base64url').toString('utf8'));
    if(value.v!==1 || value.scope!==cursorDigest(scope) ||
       !Number.isSafeInteger(value.after) || value.after<0 ||
       encode(scope,value.after)!==opaque)fail('p2_replay_invalid_cursor');
    return value.after;
  } catch {fail('p2_replay_invalid_cursor');}
}
function checkedConsumer(consumerId){
  if(typeof consumerId!=='string'||consumerId.length>MAX_CONSUMER||
     !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(consumerId))
    fail('p2_replay_invalid_consumer');
}
function verifiedLine(row){
  if(sha(row.envelope_json)!==row.envelope_sha256 ||
     sha(row.content)!==row.content_sha256)fail('p2_replay_dialogue_corrupt');
  let envelope;
  try {envelope=JSON.parse(row.envelope_json);} catch {fail('p2_replay_dialogue_corrupt');}
  if(envelope.recordId!==row.record_id || envelope.content!==row.content ||
     envelope.characterId!==row.character_id || envelope.timelineId!==row.timeline_id ||
     envelope.worldProfileId!==row.world_profile_id)fail('p2_replay_dialogue_corrupt');
  return Object.freeze({...envelope,attribution:{
    sessionId:row.session_id,protagonist:row.protagonist,
    hostRunId:row.host_run_id,worldEpoch:row.world_epoch
  }});
}

/** Bounded stable insertion-sequence page. Incomplete witness sidecars are
 * REJECTED, never promoted to a character's witnessed event. A cursor advances
 * past scanned-but-rejected rows only if the consumer explicitly acknowledges.
 */
export function readP2ReplayPage(db,{scope,cursor=null,limit=256},world){
  validatedScope(scope,world);validateOwner(db,scope);
  if(!Number.isSafeInteger(limit)||limit<1||limit>MAX_PAGE)fail('p2_replay_invalid_limit');
  const after=decode(scope,cursor);
  const entries=db.prepare('SELECT sequence AS seq,kind,record_id AS id FROM p2_memory_replay_feed WHERE '+
    where+' AND sequence>? ORDER BY sequence ASC LIMIT ?').all(...scopeKey(scope),after,limit+1);
  const page=entries.slice(0,limit),items=[],rejected=[],skipped=[];
  const suppressed=new Set(listSuppressedMemoryIds(db,scope,world));
  for(const correction of readCorrectionOverlays(db,scope,world))
    if(isUuid(correction.targetId))suppressed.add(correction.targetId);
  const line=db.prepare('SELECT * FROM dialogue_journal WHERE record_id=? AND '+
    'world_profile_id=? AND character_id=? AND timeline_id=? AND protagonist=?');
  for(const entry of page){
    // A correction or forget immediately masks immutable evidence, including
    // its transitive derivatives. Only an authorized restore may clear it.
    if(suppressed.has(entry.id)){
      skipped.push({recordId:entry.id,reason:'forgotten_or_superseded'});
      continue;
    }
    if(entry.kind==='dialogue'){
      const row=line.get(entry.id,...scopeKey(scope));
      if(!row){rejected.push({recordId:entry.id,reason:'source_removed'});continue;}
      items.push(Object.freeze({kind:'dialogue',sequence:entry.seq,recordId:entry.id,
        envelope:verifiedLine(row)}));
    }else{
      const proof=readVerifiedEventEvidence(db,{characterId:scope.characterId,
        timelineId:scope.timelineId,recordId:entry.id},world);
      if(!proof){rejected.push({recordId:entry.id,reason:'unverified_or_removed_event'});continue;}
      items.push(Object.freeze({kind:'event',sequence:entry.seq,recordId:entry.id,
        envelope:proof.event,sourceEvidence:proof.sourceEvidence}));
    }
  }
  const next=page.length?page[page.length-1].seq:after;
  return Object.freeze({version:1,scope:{...scope},cursor:encode(scope,next),
    fromCursor:encode(scope,after),lastSequence:next,scannedCount:page.length,
    items:Object.freeze(items),rejected:Object.freeze(rejected),
    skipped:Object.freeze(skipped),
    hasMore:entries.length>limit,status:rejected.length?'incomplete_evidence':'complete'});
}
export function readP2ReplayCursor(db,{scope,consumerId},world){
  validatedScope(scope,world);validateOwner(db,scope);checkedConsumer(consumerId);
  const row=db.prepare('SELECT after_sequence AS seq FROM p2_memory_replay_cursors WHERE consumer_id=? AND '+
    where).get(consumerId,...scopeKey(scope));
  const seq=row?.seq??0;
  return Object.freeze({cursor:encode(scope,seq),lastSequence:seq,consumerId});
}
/** Commit fence is enforced by P2SqliteProfileStore.withTimelineWrite.
 * The CAS prevents competing consumers from skipping unseen pages. It accepts
 * same-page repeated acks as idempotent after crash/reconnect.
 */
export function acknowledgeP2ReplayCursor(db,{scope,consumerId,cursor,expectedCursor=null},world){
  validatedScope(scope,world);validateOwner(db,scope);checkedConsumer(consumerId);
  const requested=decode(scope,cursor),expected=decode(scope,expectedCursor);
  const old=readP2ReplayCursor(db,{scope,consumerId},world).lastSequence;
  if(requested===old)return Object.freeze({committed:true,idempotent:true,cursor:encode(scope,old)});
  if(old!==expected||requested<old)fail('p2_replay_cursor_conflict');
  if(requested!==0){
    const point=db.prepare('SELECT sequence FROM p2_memory_replay_feed WHERE '+where+
      ' AND sequence=?').get(...scopeKey(scope),requested);
    if(!point)fail('p2_replay_cursor_not_committed_evidence');
  }
  const now=new Date().toISOString();
  db.prepare('INSERT INTO p2_memory_replay_cursors VALUES(?,?,?,?,?,?,?) ON CONFLICT(consumer_id,world_profile_id,character_id,timeline_id,protagonist_key) DO UPDATE SET after_sequence=excluded.after_sequence,updated_at_utc=excluded.updated_at_utc')
    .run(consumerId,...scopeKey(scope),requested,now);
  return Object.freeze({committed:true,idempotent:false,cursor:encode(scope,requested)});
}
