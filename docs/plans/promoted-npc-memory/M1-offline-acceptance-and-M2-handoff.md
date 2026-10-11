# M1 offline acceptance and M2 handoff — October 11, 2026

**M1 status:** implementation ready for the **offline M2 development dependency** after successful exact-head CI. Real GTA acceptance is separately pending; this document is not permission to deploy SQLite into an existing installation.

**Repo ownership:** this is committed on draft PR #52, stacked on M0 PR #51 and original architecture PR #49. PRs #50/#53 are an independent standalone-host stack. None of these are implicitly merged. M2 may start as a *stacked implementation branch from the validated M1 head*; do not fork a second database or reimplement M1 for standalone.

## What is completed in code

- One host-independent source implementation in `lsa-shared-brain/src`: P2 profile validation and mutations, additive SQLite storage schema v2, manual memory CRUD, timeline guards and identity constraints. Essential and standalone use small importing adapters, not two databases. **The standalone adapter defaults to sourceRequired:true**, so future native timeline writes cannot begin until authenticated host/epoch evidence is wired; explicit sourceRequired:false is for isolated, host-free storage tests only.
- Schema v2 is a **SQLite storage envelope**, not a new automatic-memory profile format. Existing P2 `profileVersion:1` JSON/manual memory records are preserved, validated and indexed during one-time import; source JSON remains unchanged and has an exclusive `.pre-sqlite.bak` backup.
- SQLite write CAS, integrity and per-character ownership checks, WAL/FULL synchronous durability, explicit timelines and fail-closed schema version/world mismatch handling. Only one writer can claim the lock. Stale crash locks are never automatically cleared.
- Full Essential P2 promotion/edit/manual memory/control/removal can work through opt-in SQLite, including staged-import packaging; **JSON remains the default**. Standalone's memory storage adapter exists, but standalone native identity and playback are M10 integration concerns.
- Source-aware **timeline-scoped** M2 write fence: `withTimelineWrite(timelineId, synchronousCommit)` checks at the **serialized writer boundary**; an active timeline and (for live Essential) a verified C-13 native `hostRunId/worldEpoch` and manual user confirmation are required. A native epoch change or PS-channel disconnect revokes approval; reconnect and process restart do not auto-restore it. Legacy P2 *player-edited global profile fields and manual notes* remain global v1 CRUD, not fabricated timeline observations. The *future M2 journal insert* must invoke this gate when committing.
- Source verification uses the existing authenticated PS hello and ordered `world_epoch`, not an LLM event or ped/name guess. If the PS channel is disabled/unavailable, timeline-scoped writes remain suspended; manual profile editing is independent.
- Explicit non-destructive profile-only rollback export plus a **read-only** integrity/ownership/timeline inspector. The export is a new checked JSON file; neither original JSON nor the SQLite store is overwritten. Future M2 event journals will not appear in v1 JSON export.

## Offline acceptance matrix

| Area | Evidence / gate |
| --- | --- |
| Node runtime | Node 24 `node:sqlite` + FTS5 on **Windows and Ubuntu** |
| Backward compatibility | Default JSON-mode import on Node **20.19.0 and 22**, Windows and Ubuntu |
| Storage/migration | Profile v1 import; byte-preserved JSON and backup; checksums, indexed rows, schema/world protection, restart and recovery |
| Host-portability | Essential/standalone adapters share one store; sequential owner handoff and lock contention |
| Editor/native P2 behavior | Existing P2 editor/identity/control suites + opt-in SQLite promote/edit/memory/summon/dismiss/remove integration |
| Timeline provenance | Native authenticated hello / epoch change / disconnect, no implicit reauthorization, queue-time write check, process restart veto |
| Rollback and inspection | New profile-only JSON export; read-only `inspectP2Sqlite` and CLI; corruption/lock refusal; never auto-repair |
| Packaging | Candidate stages `e1/_shared` without dependency on source checkout; packaged adapter executes create/edit/export |
| Real GTA | **Not done; never count a successful offline test as an in-GTA result.** |

CI workflow: `.github/workflows/memory-m1-portability.yml`. It explicitly serializes legacy stock-controller test modules that share a single output directory. Record the **exact validated commit and run** on PR #52; never count an earlier green run as proof of a later source edit.

## Read-only operator inspection (after stopping GTA/companion)

Run with Node 24 from `lsa-essential-e1-candidate`:

```powershell
node tools/inspectM1Sqlite.mjs --db "C:\path\to\profiles.v2.sqlite" --world-profile-id "YOUR-EXISTING-WORLD-PROFILE-UUID"
```

The command reports schema, revision, profile count and selected timeline, **not NPC names or memories**. It refuses absent, corrupt, mismatched-world and unknown-version stores; it never removes a `.writer.lock`. First stop all Essential/standalone writers, preserve the DB and matching WAL/SHM as an offline set, inspect identity and rollback export, and only then consider manual recovery of a stale lock. Never delete an active writer's lock. Do not copy only the main DB while a WAL writer is active.

To export a *new* profile-only JSON snapshot, use the authenticated character editor **SQLite mode** export button. It cannot automatically downgrade the active DB, and is **not a future journal backup**. Test any restore with isolated paths before copying into a real installation.

## Exact handoff contract for M2

1. Branch from the accepted **M1 code head**, not separate Essential/standalone forks. Keep M2 journal/recorder/retention modules in `lsa-shared-brain`.
2. Append a separately versioned transactional SQLite migration for journals. Never silently mutate v1 P2 profile shape or drop unknown schema. Include one timelineId, durable CharacterId, source-qualified fact type, accepted receipt/turn ID and immutable raw evidence per record.
3. Do **not** accept a model proposal, transient ped handle, unverified proximity transcript, unplayed TTS or disconnected native host as a committed experiential memory. Track reason/acceptance separately from raw archive.
4. Every timeline-scoped journal write must run under `withTimelineWrite(timelineId, synchronousCommit)` (or an equivalent stricter atomic gate) and must remain blocked until the verified host/epoch and save-lineage choice are current. Synchronous commit logic must be bounded and transactional; asynchronous callbacks are refused by the M1 gate.
5. Essential bridge is temporary; standalone bridge delivers the same typed source/ack semantics. Adapt only source evidence; never fork the memory DB or Luna curator.
6. Record additional M2 migration/replay/de-duplication/rollback cases in Windows+Linux CI. Do not activate automatic memory in GTA merely because M2 source tests pass.

## Deferred **GTA** acceptance, not a blocker for writing M2 code

- Validate bundled/installed Node 24 provenance and the complete Essential candidate deployment in an isolated GTA profile, including original controls/audio and rollback.
- Test save-game reloads, fast game-clock rewind, PS disconnect/reconnect, native ownership loss, F11/editor confirmation and wrong-lineage handling in the real game; collect receipts. No source-only test proves exact native production timing.
- Verify profile count, edits, backups, crash recovery and explicit rollback against **actual GTA data copies**. Never enable SQLite by default before these pass.
- Native standalone P1/P2 actor binding, speech receipts and in-game resilience belong to the separate standalone integration track; the shared core already exists for M2 work.

**Decision:** offline M1 acceptance can unblock **starting M2 implementation** after green final CI. It does **not** close GTA acceptance, merge the PR stack, or activate SQLite in a user's installed game.
