# EA Final Fix B — SQLite save timeline, source authority and P2 storage

Date: 2026-10-11. **Draft / offline-only / not GTA deployable**.

## Immutable inputs and implemented source
- Base: PR #68 `4cad39198478d7f03bb8ec6657b674e52fa659dd`, branch `integration/elevenlabs-emotional-acting-ea0-ea4-20261011`.
- Imported real EA6 code from PR #76 `ab1804f6aaa4207d161e194c92c45ee89e20c4b4`, including M1 shared-brain SQLite/profile/TimelineGuard modules, the actual P2 `CharacterService` selection, editor controls, inspection tool and original EA6 test. Source originated in M1 PR #52 `1ca219fd8b95ba2dbf2d1f8031d40fe93308a404`.
- This branch deliberately **does not** import M1's native IntelligenceClient or shared bootstrap, nor memory integration PR #61's journal runtime. It contains no second SQLite implementation and no fake source authority.
- After imported-source commit `4f4ec1b1690d2f8093a3d2395385485782208069`: source-generation fences `1d1c34fa0583ca6ae9b7179f69bccdc860760a78`; no cached-host-proof reconstruction `12b78028f31a3da62ff0ab9ceee3b65afc9d7ea9`; new dedicated tests `2c0e8d0d6ea9564c3c4ea77d84d0c20c47de248d` / `6c56428dfbd0c5cea590fc9e18069766f1f5ae1e`. Consult the PR head for the ultimate handoff/documentation commit.

## Actual runtime and default compatibility
- `new CharacterService(config)` still uses `ProfileStore` by default when `promotedCharacters.storageMode` is absent or `json`. No existing profile is implicitly imported, deleted or overwritten.
- Explicit `storageMode:'sqlite'` selects `createEssentialMemoryStorage` backed by **the same** `lsa-shared-brain/src/characters/sqliteProfileStore.mjs`. It exposes `characterService.store.activeTimelineId`, `.timelineWritable`, `.timelineSourceStatus` and `.timelinePendingReason`. Selected timeline UUID may survive restart, but never its native-source authorization.
- Shared profile validation accepts OpenAI assignmentVersion 1, faster-qwen3-tts version 2 and ElevenLabs version 3. Legacy manual P2 memories remain profile data; **EA4 128-entry mood cache remains memory-only, never placed in SQLite**.
- Before proof/selection, SQLite timeline status is unavailable/read-only. A timeline may be created as a dormant label, but activation requires an **existing** timeline UUID plus identical literal user confirmation from the editor and a current post-validation native source. The editor cannot mint proof.
- Cross-host writer exclusion uses a `.writer.lock` with exclusive creation, never deletes an unknown lock, SQLite WAL/FULL, revision-checked profile replacement, serialized operations, schema validation and read-only inspection. Timeline operations re-check at serialized commit.

## Changes beyond EA6
1. Both `confirmTimeline` and `withTimelineWrite` now pin a native-source incarnation/authorization generation **before their first asynchronous wait**. Replayed/changed/identical host HELLO, clock/epoch/save/boundary revocation or re-confirmation of the same save cannot make an older queued operation valid.
2. An accepted C-13 HELLO reauthorizes neither the stored timeline nor previously queued journal writes, even if hostRunId + worldEpoch match a previous connection (ABA). It always needs a fresh operator confirmation.
3. The reported `timelineSourceStatus` is never verified when storage is closed, unavailable or uninitialized.
4. The host-reload bridge no longer synthesizes a host receipt by copying cached UUID/epoch scalars. Following host_reload, new post-validation C-13 receipt + explicit editor re-confirmation are needed. Existing selected save remains read-only.

## Frozen C-13 consumer interface and Agent A/F integration contract

The required baseline comes from **M1 PR #52's accepted authenticated IntelligenceClient**, not arbitrary socket frames:
```js
import { bindTrustedTimelineSource } from './characters/timelineSourceBridge.mjs';

// F: only if configured SQLite CharacterService initialized successfully.
// Build IntelligenceClient with its genuine C-13 native HELLO/world_epoch
// verification; NEVER call host publishers with fabricated JS objects.
const binding = bindTrustedTimelineSource({
  store: runtime.characterService.store,
  intelligenceClient: runtime.intelligence
});
// bind BEFORE intelligence.start() so initial accepted HELLO is observable.
// At orderly shutdown: intelligence.stop(); binding.close();
// then await runtime.characterService.closeStorage();
```
Required methods: `subscribeVerifiedHostContext(listener)` and `subscribeWorldBoundary(listener)` each return an unsubscribe function. Context callback receives `null` on disconnect/lease failure or a *post-validation* `{hostContextVersion:1,hostRunId:<native UUIDv4>,worldEpoch:<positive integer>}` from authenticated HELLO/epoch. Only the actual channel accepts C-13 events. On accepted consecutive epoch, it publishes the NEW verified host context first and then an ordered `{reason,hostRunId,previousEpoch,worldEpoch}` boundary (epoch exactly previous+1). On invalid/recycled/out-of-order host, failure, process shutdown or unsupported boundary it must revoke, never silently retain a prior receipt. Allowed recognized boundary reasons are `clock_regression`, `timeline_change`, `host_reload`, `world_epoch`, `save_fork`, `native_disconnect`, `unknown_source` and `source_change`; unexpected values fail closed.

**Agent A** is responsible for native event publication and independently verified active protagonist; **Agent F** must source-reconcile M1's C-13 functions into the actual PR #68 intelligence client and wire this exact bridge, avoid attaching it to the JSON store, and dispose it before storage closure. Agent F's `getRuntime` EA4 hook must read `runtime.characterService.store` and never use independent fake timeline properties. The native protagonist API is a separate authority; C-13's host/epoch does **not** itself prove Franklin/Michael/Trevor or a specific GTA save-slot identity. Without native save-slot evidence, operator exact selection is an explicitly asserted lineage, not independently proven save identity; do not overstate GTA verification.

## Migration, backup and rollback
1. **Before opt-in:** stop GTA/E1; copy original `profiles.v1.json`, its backup, any current SQLite database with WAL/SHM and lock state to an isolated versioned backup. Verify hash and retain all prior v3/v4 journal artifacts.
2. **Preflight:** Node 24 with `node:sqlite`/FTS5; inspect source JSON schema/owner `worldProfileId`, voice assignments, disk, and absence of another active writer. Do **not** clear a stale `.writer.lock` automatically.
3. **Opt-in:** configure `promotedCharacters.storageMode:'sqlite'`, `storePath` original v1 JSON and separate `sqliteStorePath`. On the first new-database import a byte-preserving `profiles.v1.json.pre-sqlite.bak` is created with copy-exclusive and verified hash. The original JSON remains untouched. Existing DB is validated before any schema changes; unsupported/corrupt DB fails closed without JSON fallback.
4. **Operator select:** start accepted C-13 listener, then from localhost authenticated editor choose an existing timeline, explicitly enter the exact UUID for confirmation. Timeline creation **alone** gives no authority. Repeat after every restart/source change/save fork.
5. **Read-only inspection:** stop the writer first. Run `node lsa-essential-e1-candidate/tools/inspectM1Sqlite.mjs --db "characters/profiles.v2.sqlite" --world-profile-id <UUID>` from repository root (provide actual file and world-profile UUID). Do not assume that inspection or a JSON rollback export includes any M2–M7 journals.
6. **Revert:** stop the application and release the known owned writer lock by orderly close; restore JSON mode and its untouched original. If editing occurred in SQLite, first use explicit `exportRollbackSnapshot()` to create a new uniquely named *profile-only* v1 export, inspect it and adopt it manually without overwriting memory journals. Never replace a v4 DB with a v2 DB or discard evidence. If an existing v4 DB is present, use the memory project's v4-aware recovery tooling instead of v2 open/export.

## v3/v4 journal compatibility and remaining risks
- M1 SQLite envelope is `PRAGMA user_version=2`. Memory integration PR #61 and later PR #75 evolve that *same* `lsa-shared-brain` foundation to v3/v4 with additive `migrateJournalSchema`, `ensureIntegratedMemorySchema`, curation, event coverage, accepted dialogue, permanent memory and correction read adapters.
- **v2 cannot open v3/v4**: current `verifyExisting` returns `unsupported_sqlite_profile_schema` before writable initialization. This is intentional data preservation, not v4 feature compatibility. Never patch the integer version back to 2, delete unknown tables, or recreate DB.
- Agent F / memory integrator must forward-port THIS branch's incarnation-generation queue fences and no-reconstruction rule into the integrated v4 `sqliteProfileStore`, while preserving PR #61/#75's additive v2→v3→v4 migrations and the same journal tables/FTS/indexes/CAS/transaction boundaries. Re-run integrated memory tests (M2–M9, P2), v4 rollback/corruption, mixed voice migration and separate active timeline/fork cases on a copied production-like DB. This branch does not claim the v4 code is integrated.
- Writing multiple SQL statements through `withTimelineWrite` must use the v4 journal's transactional methods; the outer gate serializes and validates, but a caller callback is not magically one SQL transaction.

## Evidence, exclusions and acceptance
- Previous source PR #76 [CI 38183235033](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38183235033): Windows/Ubuntu Node **24.21.0**, **34/34** EA6 + P2 tests on both, Node **22.23.3** JSON regression on both, before these new changes. M1 PR #52 also reports Node 20/22 default JSON compatibility.
- Added `tests/ea-final-b-timeline.test.mjs`: stale queued confirmation, same-host HELLO ABA, save fork and new confirmation, wrong save/host/epoch, three voice providers, qualified host_reload and synthetic higher-version journal byte-preservation. Existing `tests/ea6-storage-timeline.test.mjs` remains included.
- **Not executed on this B branch:** new tests on Windows/Ubuntu Node 24, full JSON P2 tests, actual bundled Node 24, native C-13 wire in PR #68, v4 memory integration test matrix, GTA saves or payable ElevenLabs voice. No current exact-head green claim until CI executes. The dedicated EA6 workflow from #76 was not added because workflows are Agent F/E-owned; integrator must run both dedicated test files and Node 20/22 JSON startup on the final composed head.
- **Readiness:** branch is suitable for code review and integration by F, not for GTA shadow or experimental EA4 release. Without a truly accepted C-13 source, explicit timeline confirmation and agent A protagonist/current owner, `timelineWritable` stays false and EA4 must stay neutral.
