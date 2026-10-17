// K-12: player corrections are NOT all the same kind of evidence.
//
//  * transcript  - a genuine speech-to-text mishearing correction of the
//                  player's OWN line. Only this kind supersedes its target in
//                  recall and replay.
//  * counter_claim - the player disputes something ("that's not what
//                  happened, it was a bus"). It is a clearly attributed,
//                  linked reported claim. It NEVER hides, revokes or
//                  rewrites the target: witnessed events, NPC speech and
//                  earlier memories stay exactly as they were recorded.
//
// The mode is persisted with the correction. Invariant, whatever the stored
// mode: witnessed events and NPC speech can never be superseded by a player
// correction. Rows written before the column existed (NULL mode) keep their
// historical superseding meaning only for targets a player could legitimately
// correct; a legacy row aimed at a witnessed event or NPC line is a
// counter-claim (fail towards preserving witnessed evidence).
import {createHash} from 'node:crypto';
import {isUuid} from '../util/identity.mjs';
const fail = code => { throw new Error(code); };

// fact_revision is privileged administration of an extracted/reported memory,
// never a conversational authority to rewrite witnessed events or raw speech.
export const CORRECTION_MODES = Object.freeze(['transcript', 'counter_claim','fact_revision','player_fact']);
const columnKnown = new WeakSet();

/** Additive, idempotent migration under the single P2 writer. */
export function ensureCorrectionModeColumn(db) {
  if (columnKnown.has(db)) return;
  const cols = db.prepare('PRAGMA table_info(memory_corrections)').all();
  if (!cols.length) return; // table not created yet
  if (!cols.some(c => c.name === 'correction_mode'))
    db.exec('ALTER TABLE memory_corrections ADD COLUMN correction_mode TEXT');
  columnKnown.add(db);
}
function hasModeColumn(db) {
  if (columnKnown.has(db)) return true;
  const present = db.prepare('PRAGMA table_info(memory_corrections)').all()
    .some(c => c.name === 'correction_mode');
  if (present) columnKnown.add(db);
  return present;
}

/** Explicit modes are validated; an absent mode is the legacy low-level form. */
export function normalizeCorrectionMode(mode, { allowLegacy = false } = {}) {
  if (mode === undefined || mode === null) {
    if (allowLegacy) return null;
    fail('memory_invalid_correction_mode');
  }
  if (!CORRECTION_MODES.includes(mode)) fail('memory_invalid_correction_mode');
  return mode;
}

/** Witnessed events and NPC speech: evidence the player cannot supersede. */
export function isProtectedEvidence(db, scopeKeys, targetId) {
  if (db.prepare('SELECT 1 AS ok FROM event_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND record_id=?')
    .get(...scopeKeys, targetId)) return true;
  const line = db.prepare('SELECT speaker FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND record_id=?')
    .get(...scopeKeys, targetId);
  return !!line && line.speaker !== 'player';
}

// Privileged fact edits must not acquire indirect authority to supersede an
// NPC's own words or a witnessed event through an extracted summary.
export function isPrivatelyCorrectableFact(db,scopeKeys,targetId,parents=new Set()) {
  if(!isUuid(targetId)||parents.has(targetId)||parents.size>=32||isProtectedEvidence(db,scopeKeys,targetId))return false;
  const memory=db.prepare('SELECT mode,evidence_ids_json AS sources FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND memory_id=?')
    .get(...scopeKeys,targetId);
  if(memory){
    const ids=JSON.parse(memory.sources),next=new Set(parents).add(targetId);
    return memory.mode==='reported_claim'&&Array.isArray(ids)&&ids.length>0&&ids.length<=64&&
      ids.every(id=>isPrivatelyCorrectableFact(db,scopeKeys,id,next));
  }
  return !!db.prepare("SELECT 1 FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND record_id=? AND speaker='player' AND delivery='accepted' AND source IN ('typed','stt')")
    .get(...scopeKeys,targetId);
}

/** Effective semantics of one stored correction row. */
export function resolveCorrectionMode(db, scopeKeys, row) {
  if (row.mode === 'counter_claim') return 'counter_claim';
  if(row.mode==='player_fact'){
    // Only authentic accepted player lines may be replaced conversationally.
    const original=db.prepare("SELECT 1 AS ok FROM dialogue_journal WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND record_id=? AND speaker='player' AND delivery='accepted' AND source IN ('typed','stt')")
      .get(...scopeKeys,row.targetId);
    if(!original)fail('memory_correction_integrity_failed');
    return 'player_fact';
  }
  if(row.mode==='fact_revision') {
    if(!db.prepare('SELECT 1 FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=? AND memory_id=?')
      .get(...scopeKeys,row.targetId)||!isPrivatelyCorrectableFact(db,scopeKeys,row.targetId))fail('memory_correction_integrity_failed');
    return 'fact_revision';
  }
  return isProtectedEvidence(db, scopeKeys, row.targetId) ? 'counter_claim' : 'transcript';
}

/**
 * All correction rows for an owner scope [world, character, timeline] with
 * their resolved mode. `supersedes` is true only for strictly verified replacements.
 */
export function readCorrectionRows(db, scopeKeys) {
  const modeSql = hasModeColumn(db) ? 'c.correction_mode' : 'NULL';
  const rows = db.prepare(`SELECT c.command_id AS commandId,c.target_id AS targetId,
    c.preferred_text AS content,c.content_sha256 AS checksum,c.created_at_utc AS atUtc,
    ${modeSql} AS mode FROM memory_corrections c
    WHERE c.world_profile_id=? AND c.character_id=? AND c.timeline_id=?
    ORDER BY c.created_at_utc DESC,c.command_id DESC`).all(...scopeKeys);
  return rows.map(row => {
    // Visibility decisions must verify the same bytes as recall overlays.
    // Unknown persisted modes cannot silently acquire transcript authority.
    if ((row.mode !== null && !CORRECTION_MODES.includes(row.mode)) ||
        typeof row.content !== 'string' ||
        createHash('sha256').update(row.content).digest('hex') !== row.checksum)
      fail('memory_correction_integrity_failed');
    const mode = resolveCorrectionMode(db, scopeKeys, row);
    return { ...row, mode, supersedes: mode !== 'counter_claim' };
  });
}

/** Targets hidden from recall/replay/candidates: verified superseding corrections. */
export function supersededTargetIds(db, scopeKeys) {
  const ids = new Set();
  const rows=readCorrectionRows(db,scopeKeys);
  for (const row of rows)
    if (row.supersedes) ids.add(row.targetId);
  // A privileged fact revision withdraws its evidence bundle from subsequent
  // extraction as well. Raw bytes remain available to private administration.
  // This prevents M6/M7 or a sibling derived record from reviving the old fact.
  const revised=new Set(rows.filter(r=>r.mode==='fact_revision').map(r=>r.targetId));
  const playerFacts=new Set(rows.filter(r=>r.mode==='player_fact').map(r=>r.targetId));
  if(playerFacts.size){
    // A corrected accepted player line cannot remain an active premise of
    // an older M6/M7 derived fact. Unlike privileged fact edits, do NOT revoke
    // upstream sources unrelated to this particular player-name assertion.
    const edges=db.prepare('SELECT memory_id AS id,evidence_ids_json AS json FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=?')
      .all(...scopeKeys).map(r=>({id:r.id,sources:JSON.parse(r.json)}));
    for(const edge of edges)if(!Array.isArray(edge.sources)||edge.sources.length>64||
      !edge.sources.every(isUuid))fail('memory_correction_integrity_failed');
    let changed=true;
    while(changed){changed=false;for(const edge of edges)
      if(!playerFacts.has(edge.id)&&edge.sources.some(id=>playerFacts.has(id))){
        playerFacts.add(edge.id);changed=true;
      }
    }
    for(const id of playerFacts)ids.add(id);
  }
  if(revised.size){
    const edges=db.prepare('SELECT memory_id AS id,evidence_ids_json AS json FROM memory_records WHERE world_profile_id=? AND character_id=? AND timeline_id=?')
      .all(...scopeKeys).map(r=>{
        const sources=JSON.parse(r.json);
        if(!Array.isArray(sources)||sources.length>64||!sources.every(isUuid))fail('memory_correction_integrity_failed');
        return {id:r.id,sources};
      });
    let changed=true;
    while(changed){changed=false;for(const edge of edges){
      if(revised.has(edge.id))for(const source of edge.sources){if(!revised.has(source)){revised.add(source);changed=true;}}
      else if(edge.sources.some(s=>revised.has(s))){revised.add(edge.id);changed=true;}
    }}
    for(const id of revised)ids.add(id);
  }
  return ids;
}

export const isSuperseded = (db, scopeKeys, targetId) =>
  supersededTargetIds(db, scopeKeys).has(targetId);

/** Recall text. A counter-claim is explicitly attributed to the player and
 *  explicitly NOT a replacement of the linked record. */
export function overlayContent(mode, content) {
  return mode === 'counter_claim'
    ? 'Player counter-claim (reported, unverified; the original record stands): ' + content
    : 'Player correction (reported): ' + content;
}
