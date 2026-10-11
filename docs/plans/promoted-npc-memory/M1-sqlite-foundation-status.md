# M1 — SQLite P2 foundation, shared host adapters and guarded integration (increments 1–3)

**Status: M1 increments 1–3 implemented in source; SQLite is opt-in, NOT enabled in the live installed GTA companion, and no real GTA test has been accepted.** This PR sits on M0 PR #51. M0 + architecture PR #49 must be integrated in order; M1 does not assume they have merged. The standalone replacement stack (#50/#53) is **independent** and has NOT been merged into this memory branch.

## Implemented in this increment

- `src/characters/sqliteFoundation.mjs`: `P2SqliteFoundation`, a P2-owned single-file SQLite store using bundled Node's `node:sqlite`, with on-start availability/FTS5 probe, user_version=2, integrity verification, WAL, FULL synchronous durability and a transactional compare-and-swap profile snapshot writer.
- **Loss-conscious v1 import:** validate the existing P2 profile JSON using its current validators, preserve it unchanged, create a checked one-time `.pre-sqlite.bak`, stage the new database separately, write per-profile indexed rows (unique CharacterId and owner alias), verify snapshot hash/revision and then make the staged store available. Corrupt/unsupported profile sources and unexpected DB versions fail closed rather than resetting characters.
- SQLite `timelines` table with only one active entry allowed, explicit `createTimeline`/`activateTimeline`, no silent timeline selection on migration.
- `src/characters/timelineGuard.mjs`: rollback/clock regression suspends writes until the user explicitly selects a timeline. Also introduces canonical `durableSubjectRef` classification, distinguishing Franklin/Michael/Trevor while keeping scene-local strangers and vehicles non-durable.
- `tests/m1-sqlite-foundation.test.mjs`: isolated offline tests for import, manual memory preservation, restart, CAS conflict, duplicate ownership, corruption, unknown version, timeline switching and SubjectRef isolation.

## Increment 2 — one shared memory implementation, two thin storage adapters

The shared source of truth is now `lsa-shared-brain/src/`, completely free of Essential or standalone native runtime imports.

- `characters/profileSchema.mjs` has the unchanged P2 v1 profile validation contract (including owner alias, manual memories, revision, and size quotas). `characters/profileCommands.mjs` implements ONE set of add/edit/manual-memory/delete mutation rules. The existing Essential JSON `ProfileStore` now uses these shared functions instead of defining its own copies.
- `characters/sqliteFoundation.mjs` and `timelineGuard.mjs` have moved to the shared brain. Their previous Essential module paths are *compatibility re-exports*, preserving the existing tests/API consumers. No second memory database or parallel curation module was introduced.
- `characters/sqliteProfileStore.mjs` provides an **opt-in SQLite-backed ProfileStore-like interface**: `initialize/list/get/create/edit/memory/remove`, CAS writes, explicit timeline management, and a create-exclusive `.writer.lock` to refuse concurrent Essential/standalone writers. A crash can leave a stale lock: do NOT auto-delete it; verify all writers stopped and retained data/backups before manual recovery.
- Thin M1 storage adapters: `lsa-essential-e1-candidate/src/characters/memoryStorageAdapter.mjs` and `lsa-standalone-companion/src/memory/memoryStorageAdapter.mjs`. Both import `createP2MemoryStorage` from the SAME shared module and point to the SAME SQLite path when configured. **Neither is activated by default, and the standalone adapter does not claim completed live NPC binding or event routing.**
- Essential `CharacterService` now accepts an explicit `promotedCharacters.storageMode: 'sqlite'` opt-in with a separate `sqliteStorePath`; `json` is the unchanged default. It supplies the original JSON as a migration source, rejects a SQLite path equal to the original JSON path and registers an orderly shutdown closer for its SQLite writer. **This is a guarded activation seam, not an accepted GTA deployment or a default switch.**
- Essential candidate build copies the shared source into distributable `e1/_shared/`, rewriting only staged import locations. The installed package must **not** depend on the developer's Git checkout. The standalone *future* packager must analogously include the shared brain when #50 is reconciled; no standalone packaged integration is claimed yet.
- `editorServer.mjs` gets a hidden-by-default SQLite-only timeline panel: list, create (does NOT select), explicit confirmation and writable/suspended diagnostics. Native clock-regression notifications/F11 timeline UX are **not** wired yet, so no automatic lineage recognition is claimed.

## Increment 3 — source-verified world reset gating, rollback and packaging

- **C-13 native source:** `IntelligenceClient.subscribeWorldBoundary` forwards only a **post-validation, authenticated, correctly sequenced** PS `world_epoch` change with an exact matching host run and +1 epoch. No callback for duplicates, invalid jumps, missing C-13 context or rejected frames. The existing Essential bootstrap routes those accepted events to the opt-in SQLite `TimelineGuard` before the native perception pump starts, and a boundary received during initial SQLite migration retains its write veto after initialization. **Native clock/save signal generation itself is preexisting and still needs real GTA acceptance.** This hook requires the PS shadow channel; absence of that channel does not prove timeline continuity.
- **Explicit rollback snapshot:** `P2SqliteProfileStore.exportRollbackSnapshot` creates a *new* checksummed, versioned-identity-equivalent **P2 v1 JSON profile** export using exclusive file creation, fsync, transaction serialization, and validation; it NEVER overwrites the historical JSON or SQLite. An authenticated SQLite-only editor button initiates this export. Manual intervention is required to switch runtimes back; **M2/M3 journals/timeline history will not be represented in this v1 format** and must never be silently discarded.
- **Actual P2 lifecycle in SQLite mode:** an integration test runs `CharacterService.promote/edit/memory/control/remove` against the shared SQLite store and verifies P1-owned control behavior, one profile identity, and export contents. Another test runs the **staged candidate's** memory adapter through create/edit/export, exercising packaging rather than only verifying import syntax.
- **Legacy Node compatibility:** the SQLite dependency is an optional dynamic import rather than a mandatory static `node:sqlite` load on every Essential JSON startup. JSON remains the default, even when the installed Node runtime cannot provide SQLite/FTS5. A dedicated Node 20/22 Windows+Linux import check guards against regressing this guarantee; Node 24 must still prove FTS5 for SQLite opt-in.
- **Packaging compatibility:** shared source staging is idempotent if a preexisting candidate output directory exists (as the concurrent stock-controller tests require). Existing source hash validation and staged import rewriting remain intact; no runtime source is loaded from the developer checkout after staging.
- **Negative cases:** stale `.writer.lock` is never stolen automatically; no concurrent Essential/standalone SQLite writer; no invalid native epoch can authorize timeline reassignment; archive source files remain intact, and rollback export does not mutate the active store.

## Tests and validation for increment 2

- New `tests/m1-shared-memory-parity.test.mjs`: shared command behavior, JSON import parity, SQLite CRUD, singleton writer lock, both adapters taking turns with one DB, guarded timelines, authenticated editor confirmation, staged-package import regression.
- New [Node 24 Windows/Linux workflow](../../../.github/workflows/memory-m1-portability.yml) probes `node:sqlite` + FTS5 and runs both focused M1 test modules with native Node 24.
- **Current evidence:** Node 24 Windows/Linux CI has already passed the shared-storage parity tests on intermediate branch heads; exact current-head CI, including the expanded existing P2 regressions, must be rechecked after each update. Prior [green CI run 38168728141](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38168728141) covered **increment 1 only**, NOT the shared adapters or editor changes. Do not promote its result to new code.
- The JSON production P2 store remains the default. This increment is deliberately backward compatible; no mutation of the installed database, no automatic switch, no migration of users' live files, and no GTA test is claimed.

## Remaining M1 gates before activating SQLite in real GTA

1. CI PASS on **the exact final head**, including Node 20/22 JSON compatibility, Node 24 FTS5 on Windows/Linux, expanded P2/source-packaging tests, and a fully isolated candidate build manifest.
2. **Implemented as source opt-in:** `CharacterService` supports explicit `storageMode: 'sqlite'`; finish full editor/promote lifecycle and rollback proof against *actual packaged Essential* before recommending in-GTA opt-in. Never silently change an existing `profiles.v1.json` user's store.
3. **Source bridge implemented:** verify the authenticated C-13 world-epoch signal and user timeline confirmation in **actual GTA**, including no-signal/disabled-PS, pause/reload, gameplay/save rollback and disconnection. Never claim coverage when the channel is unavailable.
4. Finish standalone packager integration and actor owner proof when that independent stack is reconciled; the adapter file here is not evidence of running standalone memory.
5. Test profile editing, promotions, deletion, manual notes, restart/crash, corrupted DB, last-writer locks, version mismatch, and restore in an **isolated hash-pinned GTA deployment** before changing the default.
6. Confirm any future ElevenLabs/Qwen voice assignment schema extension separately; the current v1 P2 `voiceReference` still validates its historical OpenAI shape. A speech-provider switch must not mutate character identity or memory facts.

## Compatibility policy for M2–M10

Memory capabilities are implemented **once** in `lsa-shared-brain`. Neither M2 journals nor M3 events, M4 recall, M5 commands, nor M7 Luna curation import Essential-native or standalone-native modules. Runtime adapters only normalize trusted source-time NPC ownership/identity and verified playback/event receipts. No unauthenticated memory attribution by ped handle/name, no concurrent dual writers. An eventual Essential retirement removes its adapter, **not** the shared brain or DB.

## Deliberate limits / next M1 increments

- **Live P2 still uses `ProfileStore` JSON by default.** A guarded, explicit SQLite service/editor switch exists in source, but its packaged Windows/GTA activation and rollback remain unaccepted; do not flip the user default.
- SQLite's profile snapshot follows the existing **v1 profile shape**; the v2 storage envelope does not yet add structured relationship/personality fields or automatic memories. Future M2/M3 journal tables remain a separate, versioned migration.
- Timeline changes have an editor confirmation panel and a verified C-13 PS-pipe consumer in source. In-game source coverage, disconnected/disabled PS channels and GTAV save-lineage accuracy are still GTA test gates; a `TimelineGuard` selection alone is not a native proof.
- Verify `node:sqlite` and FTS5 **on the actual bundled Windows Node 24 binary**, not just a development Node. The connector environment cannot run local GTA; exact Windows binary acceptance is still open.
- Existing source JSON is not deleted, renamed or overwritten during import. Recovery/backup inspection is intentionally left visible to the user.
- **No local AI model:** this phase only uses SQLite and deterministic identity/timeline guards. Later memory curation remains existing Luna cloud inference.

## Acceptance evidence / remaining checks

The focused tests are included in the Node test suite and the M1 GitHub Actions matrix. **Check the exact current-head CI result**; an intermediate pass does not certify a later edit. This is M1 implementation progress, not full M1 acceptance. The full M1 gate additionally requires profile/editor API parity, safe activation/rollback, timeline UI, stress/corruption testing and bundled Windows feature probe.
