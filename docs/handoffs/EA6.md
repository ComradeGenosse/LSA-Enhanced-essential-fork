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

## Verification
The new `tests/ea6-storage-timeline.test.mjs` is written and requires Node 24+ (`node:sqlite`). Standalone execution and CI status must be reported separately from this source delivery; no tests are claimed as passing solely because they were committed.
