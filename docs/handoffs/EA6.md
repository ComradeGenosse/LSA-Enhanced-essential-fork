# EA6 — M1 SQLite timeline/save authority source reconciliation

Base PR #68 exact `4cad39198478d7f03bb8ec6657b674e52fa659dd`; M1 provenance PR #52 exact `1ca219fd8b95ba2dbf2d1f8031d40fe93308a404`; EA6 branch `feature/ea6-m1-timeline-storage-20261011`.

## Delivery
- Imported M1's **actual shared brain** profile policy, schema, SQLite foundation, durable SQLite store and TimelineGuard, plus thin Essential adapters. The SQLite foundation remains M1 **v2**, with exclusive writer lock, WAL/FULL, CAS, source JSON/backup preservation, read-only inspection, and rollback profile export. No invented in-memory writable-timeline shim.
- Current PR #68 CharacterService now selects the same core through `promotedCharacters.storageMode:'sqlite'` only; JSON remains default, profiles, promotion, editor, manual notes and revisions use their original APIs. JSON reports unavailable timeline. SQLite exposes `activeTimelineId`, `timelineWritable`, and `timelineSourceStatus` on the REAL `characterService.store` consumed by EA4.
- Reconciled PR #68's newer `assignmentVersion:3` ElevenLabs and `assignmentVersion:2` faster-Qwen voice schema into the imported M1 shared schema; raw PR #52 schema only recognized OpenAI v1 and would have rejected newer saved promoted characters.
- Migrated M1's authenticated editor save-lineage selection and profile rollback-export controls. Explicit exact-timeline confirmation is required by the core method itself; selecting requires a non-null verified native C-13 source, not just a browser request. Creating a timeline never selects it.
- Added `bindTrustedTimelineSource` to consume ONLY accepted C-13 subscription callbacks; unknown context, disconnection, save forks, epoch/boundary changes and clock rollback revoke immediately. Source confirmation never persists across restart.
- Added targeted offline EA6 tests for migration and voice compatibility, constructor actual storage, explicit save selection, boundary revocation, stale queued write, restart, invalid DB/schema and missing subscription rejection.

## Integration owner obligations / unresolved
1. The PR #68 IntelligenceClient **does not implement** the accepted C-13 `subscribeVerifiedHostContext` / `subscribeWorldBoundary` APIs currently present in M1 PR #52. FINAL integrator MUST source-reconcile PR #52 IntelligenceClient and authenticated hello/world epoch processing with PR #68, without replacing unrelated PS/EA logic; wire `bindTrustedTimelineSource({store:runtime.characterService.store,intelligenceClient:runtime.intelligence})` in owned `bootstrap.mjs` before `intelligence.start()`. If unavailable, leave EA4 disabled; NEVER inject sample host JSON as proof. Dispose bridge on shutdown.
2. FINAL integrator owns config examples, bootstrap shutdown `characterService.closeStorage()`, staging of `lsa-shared-brain` in isolated candidate builds (M1 tools `stageSharedMemory.mjs` / buildCandidate edits), and exact-head cross-platform CI. With default JSON startup, new shared dependencies are lazy-reachable only in SQLite mode, but candidate packaging must stage `_shared` correctly before any SQLite rollout. Do not enable SQLite as default.
3. M1's v2 SQLite is NOT PR #61's v4 memory journal. A final cross-project reconciliation must adapt migrations **additively from M1 through v3/v4**, preserve M2–M7 tables and tests, and carry approved M1 snapshot/schema safeguards. EA6 does not cherry-pick unrelated PR #61 changes. A v4 DB against this v2 store fails closed rather than auto-downgrading.
4. Current EA4 needs BOTH this verified timeline AND EA5 protagonist evidence and real playback receipts. No native on-device GTA evidence, bundled Node 24 evidence, paid ElevenLabs voice evidence or full exact-head CI claimed in this handoff.

## Safety
No automatic selection; no fabricated save/protagonist ID; no SQLite failure fallback to JSON for timeline-scoped authority. Player-edited global P2 notes remain separate from source-scoped memories. Corrupt/unknown SQLite stays untouched. Restart may expose the previously selected timeline ID as read-only but cannot authorize writes until a new native event AND explicit operator confirmation. No native or provider files modified.

## Exact source + actual offline verification
- Source head validated: `f151dbf906fbc08e249eda7862abea6994169e67` (all EA6 application changes, before this handoff-only update).
- [GitHub Actions run 38183235033](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38183235033): **Windows and Ubuntu completed successfully**. Each ran Node **24.21.0** SQLite EA6 + existing P2 profile regression: **34/34 tests passed**. Separate Node **22.23.3** legacy JSON P2 test command completed successfully on both platforms. These are offline tests, not native in-game, real source-client, or GTA receipts.
- Earlier runs **38183047157** and **38183147639** caught an undeclared UUID import and replayed C-13 epoch acceptance respectively; both bugs were corrected before the green run. Do not cite those runs as acceptance.
- New tests also verify corrupt SQLite keeps the original legacy JSON and its .pre-sqlite backup byte-for-byte, concurrent writer lock exclusion, stale queued writes, unknown versions and strict source revocation.
- **Not executed here:** full Essential/npm + native GTA/ABI suites, M2–M7 PR #61 integration tests, bundled-install Node 24, actual GTA saves, and paid ElevenLabs acoustic validation. Those remain final-integrator/release gates.

## Exact changed-file handoff
- Core imports from M1: `lsa-shared-brain/src/util/identity.mjs`, `lsa-shared-brain/src/characters/{profileSchema,profileCommands,sqliteFoundation,sqliteProfileStore,timelineGuard}.mjs`.
- Essential adapters from M1: `lsa-essential-e1-candidate/src/characters/{memoryStorageAdapter,sqliteFoundation,timelineGuard}.mjs` and `lsa-essential-e1-candidate/tools/inspectM1Sqlite.mjs`.
- Reconciled M1 + EA application source: `lsa-essential-e1-candidate/src/characters/{characterService,profileStore,editorServer}.mjs`. The default JSON ProfileStore now imports the **same** M1 schema and commands as SQLite, with PR #68 ElevenLabs/Qwen voice compatibility retained in the shared validator.
- New EA6 trusted-source bridge: `lsa-essential-e1-candidate/src/characters/timelineSourceBridge.mjs`; verifies the post-validated C-13 host callback precedes an ordered world_epoch boundary and refuses repeated/out-of-order epochs. Both subscriptions are mandatory and native disconnect revokes.
- Tests: `lsa-essential-e1-candidate/tests/ea6-storage-timeline.test.mjs`.
- Dedicated isolated CI: `.github/workflows/ea6-sqlite-timeline.yml`.
- Handoff: `docs/handoffs/EA6.md`.

**Operator safety:** This PR is a draft source implementation. No file in the installed GTA profile was read or changed; no PRs #52, #61 or #68 were merged. Save authority only becomes possible after authenticated M1 C-13 bootstrap wiring and explicit editor confirmation of an existing timeline.
