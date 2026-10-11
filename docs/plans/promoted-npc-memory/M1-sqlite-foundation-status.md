# M1 — SQLite P2 foundation (increment 1)

**Status: started, additive and deliberately not enabled in the live companion.** This PR sits on M0 PR #51. M0 + architecture PR #49 should be integrated in order; M1 does not assume they have already merged.

## Implemented in this increment

- `src/characters/sqliteFoundation.mjs`: `P2SqliteFoundation`, a P2-owned single-file SQLite store using bundled Node's `node:sqlite`, with on-start availability/FTS5 probe, user_version=2, integrity verification, WAL, FULL synchronous durability and a transactional compare-and-swap profile snapshot writer.
- **Loss-conscious v1 import:** validate the existing P2 profile JSON using its current validators, preserve it unchanged, create a checked one-time `.pre-sqlite.bak`, stage the new database separately, write per-profile indexed rows (unique CharacterId and owner alias), verify snapshot hash/revision and then make the staged store available. Corrupt/unsupported profile sources and unexpected DB versions fail closed rather than resetting characters.
- SQLite `timelines` table with only one active entry allowed, explicit `createTimeline`/`activateTimeline`, no silent timeline selection on migration.
- `src/characters/timelineGuard.mjs`: rollback/clock regression suspends writes until the user explicitly selects a timeline. Also introduces canonical `durableSubjectRef` classification, distinguishing Franklin/Michael/Trevor while keeping scene-local strangers and vehicles non-durable.
- `tests/m1-sqlite-foundation.test.mjs`: isolated offline tests for import, manual memory preservation, restart, CAS conflict, duplicate ownership, corruption, unknown version, timeline switching and SubjectRef isolation.

## Deliberate limits / next M1 increments

- **Current live P2 still uses `ProfileStore` JSON by default.** The new foundation has no production service/editor switch yet. That's intentional: we must prove full P2 create/edit/memory/delete parity, startup paths and downgrade/export safety before flipping the format.
- SQLite's profile snapshot follows the existing **v1 profile shape**; the v2 storage envelope does not yet add structured relationship/personality fields or automatic memories. Future M2/M3 journal tables remain a separate, versioned migration.
- Timeline changes are currently explicit API calls; no F11/editor timeline picker or GTA clock signal wiring is implemented yet. A `TimelineGuard` selection alone does not commit a SQLite active-timeline change; callers must perform both after user confirmation.
- Verify `node:sqlite` and FTS5 **on the actual bundled Windows Node 24 binary**, not just a development Node. The connector environment cannot run local GTA; exact Windows binary acceptance is still open.
- Existing source JSON is not deleted, renamed or overwritten during import. Recovery/backup inspection is intentionally left visible to the user.
- **No local AI model:** this phase only uses SQLite and deterministic identity/timeline guards. Later memory curation remains existing Luna cloud inference.

## Acceptance evidence / remaining checks

The new focused tests are part of existing `tools/runTests.mjs` discovery, but **CI on this stacked branch must be checked** before claiming completion. This is M1 implementation progress, not full M1 acceptance. The full M1 gate additionally requires profile/editor API parity, safe activation/rollback, timeline UI, stress/corruption testing and bundled Windows feature probe.
