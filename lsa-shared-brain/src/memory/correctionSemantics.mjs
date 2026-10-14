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
const fail = code => { throw new Error(code); };

export const CORRECTION_MODES = Object.freeze(['transcript', 'counter_claim']);
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

/** Effective semantics of one stored correction row. */
export function resolveCorrectionMode(db, scopeKeys, row) {
  if (row.mode === 'counter_claim') return 'counter_claim';
  return isProtectedEvidence(db, scopeKeys, row.targetId) ? 'counter_claim' : 'transcript';
}

/**
 * All correction rows for an owner scope [world, character, timeline] with
 * their resolved mode. `supersedes` is true only for transcript corrections.
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
    return { ...row, mode, supersedes: mode === 'transcript' };
  });
}

/** Targets hidden from recall/replay/candidates: transcript corrections only. */
export function supersededTargetIds(db, scopeKeys) {
  const ids = new Set();
  for (const row of readCorrectionRows(db, scopeKeys))
    if (row.supersedes) ids.add(row.targetId);
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
