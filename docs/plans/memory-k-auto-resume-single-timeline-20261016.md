# Memory K — opt-in automatic single-timeline reconfirmation (implementation plan only)

**Date:** 2026-10-16  
**Integration target:** draft PR #138, `integration/memory-k-production-20261012`  
**Reviewed baseline:** #138 head `cb39610698dd10870f3eb35656605a2264177ae4` at investigation time.  
**Scope:** documentation/design; do **not** implement, enable, deploy, or merge from this plan. **Do not modify PR #184.**

## 1. Summary and central feasibility finding

Implement `memoryK.autoResumeSingleTimeline: false` as a strictly opt-in *attempt* to restore a previously **manually** selected SQLite timeline after a new authenticated native host session, with all existing source/ownership/write fences intact. On success, the editor is optional; on failure, keep the current explicit `timeline_confirm` path.

**Blocking fact discovered in source:** the currently forwarded, verified C-13 host context contains `hostContextVersion`, `hostRunId` (random per run), and `worldEpoch` (within-run epoch). These prove a **current authenticated native host/epoch**, *not* that the loaded GTA save is the same lineage as last launch. The persisted `activeTimelineId` alone is a prior user choice, not a save identity. A single timeline in SQLite is likewise insufficient proof. Accordingly, an unconditional automatic confirmation based solely on `hostRunId + worldEpoch + activeTimelineId` would violate the requested fail-closed save-change behavior.

**Decision gate, before coding:** inventory the existing C-13/native frames for a trustworthy, stable across-restarts **save-lineage proof** and its authority chain. If one is already produced and authenticated but currently dropped by JavaScript, extend the JS projection only. If no such proof exists, the safe implementation is **configuration + diagnostic/manual fallback only** until an independently trustworthy save discriminator can be provided. A native DLL change is **not automatically required**, but may become technically necessary; do not silently substitute protagonist identity, current character, game clock, slot index, worldProfileId, random hostRunId, or a filename unverified against the loaded GTA save.

A user-declared “I always use one save” policy can be offered separately in the future, but **cannot** satisfy this plan's strict fail-closed-on-save-change acceptance criterion without verifiable lineage. The option name `autoResumeSingleTimeline` describes the allowed candidate count, **not** authority to guess.

## 2. Code-grounded inventory (checked at #138 branch)

| Existing file | Observed contract / planned responsibility |
| --- | --- |
| `lsa-essential-e1-candidate/src/config/e1Config.mjs` | `normalizeConfig()` delegates `memoryK` to `normalizeMemoryKConfig()`; keep top-level config and TTS parsing unchanged. |
| `lsa-essential-e1-candidate/src/memory/capabilityPolicy.mjs` | `normalizeMemoryKConfig` currently permits **only** `capabilities`, `profile`, `pauseLearned`; add strict boolean field defaulting false. Preserve `storage-only` policy and all capability-mode checks. |
| `lsa-essential-e1-candidate/src/bootstrap.mjs` | Initializes P2 SQLite early, starts IntelligenceClient later; uses `subscribeVerifiedHostContext` → `store.setVerifiedHostContext(context)` and `subscribeWorldBoundary` → `store.onBoundary(...)`; editor starts subsequently. Hook auto-resume *after* an authenticated verified host event and alongside, not before, source subscription. |
| `lsa-essential-e1-candidate/src/characters/characterService.mjs` | Creates `createEssentialMemoryStorage({filePath,sourceRequired:true,legacyJsonPath,worldProfileId})` for live SQLite. Do not weaken `sourceRequired:true`. |
| `lsa-essential-e1-candidate/src/characters/memoryStorageAdapter.mjs` | Delegates to shared P2 storage; don't introduce another SQLite writer. |
| `lsa-essential-e1-candidate/src/characters/sqliteFoundation.mjs` | Re-export of shared SQLite foundation. |
| `lsa-shared-brain/src/characters/sqliteProfileStore.mjs` | `P2SqliteProfileStore` uses one serial writer, cross-host lock, private `#authorityGeneration` fences, `#sourceContext`, `#confirmedSource`; `setVerifiedHostContext` revokes on changed host/epoch; `confirmTimeline()` currently activates DB and stamps current source; `onBoundary` rejects save fork/epoch/clock regression; `withTimelineWrite`, `withP2SqliteRead`, `withP2SqliteTransaction` validate generation and timeline at execution. Preserve all. |
| `lsa-shared-brain/src/characters/timelineGuard.mjs` | `TimelineGuard` retains selected UUID, but suspends on `clock_regression`/`timeline_change`. Keep `assertWrite` unchanged. |
| `lsa-essential-e1-candidate/src/characters/editorServer.mjs` | UI `timeline_list`, `timeline_create`, `timeline_confirm` (requires identical UUID confirmation token); preserve manual flow. Surface auto-resume state/reason without implying that the selected timeline is presently writable. |
| `lsa-essential-e1-candidate/src/memory/nativeMemoryAuthority.mjs`, `memoryD02Port.mjs`, `nativeCurrentOwnerPlayerAuthority.mjs` | Native owner/turn authority separate from timeline proof. Do not treat actor/owner proof as save-lineage proof; leave D02 checks in place. |
| `lsa-essential-e1-candidate/src/memory/sourceActivation.mjs` and `lsa-essential-e1-candidate/src/perception/intelligenceClient.mjs` | Inspect C-13 verified-host and boundary subscription internals and liveness/ordering before choosing final insertion point. |
| `lsa-essential-e1-candidate/e1.config.example.json` | Document default-off setting plus prerequisite comment in nearby documentation (JSON itself has no comments). |
| `lsa-shared-brain/src/characters/sqliteFoundation.mjs` | Owns durable `activeTimelineId()`, `listTimelines()`, `activateTimeline()`; avoid migrations unless durable user-confirmation metadata cannot be safely represented via existing storage. |
| `native/promoted-characters/MemoryOwnerAuthority.cs` and native C-13 producer/contract files (locate during phase 0) | Inspect only initially: find whether a save identity is already available in authenticated frame; require review before touching DLL. |

Specific observed source behavior:
- `P2SqliteProfileStore.timelineSelectionConfirmed` is defined as `#confirmedSource !== null`, and `timelineWritable` requires both TimelineGuard and `#sourceValid()`; these are *runtime* facts, not durable prior-user-consent fields.
- `setVerifiedHostContext(null)` increments authority generation and suspends authority. Changed `hostRunId:worldEpoch` increments generation and removes confirmed stamp. A repeat same-source sample does not revoke.
- `confirmTimeline(timelineId,{confirmation})` serializes activation and guards against authority-generation/context changes, but its optional confirmation token is **not by itself independent save-lineage proof**. Never call it naively from a host-context callback.
- `editorServer.mjs` explicitly says “Confirm the current GTA save once per game launch”; its `timeline_confirm` handler checks `confirmation===timelineId`.
- `bootstrap.mjs` constructs the host *before* its authenticated pipe becomes available. Initialization of SQLite is not a proof of current game save.

## 3. Proposed security contract

### Preconditions for auto-resume

All of the following MUST be simultaneously true *at the serialized authorization point*:

1. `memoryK.autoResumeSingleTimeline === true`; SQLite/promoted-character storage initialized, writer owned, database healthy, persistent identity enabled, appropriate Memory K profile supported, and runtime not shutting down.
2. Verified live C-13 native host context from the **production authenticated channel** (not test injection, UI request, model output, player text, endpoint file, or merely a connected socket). Exact current `hostRunId` and `worldEpoch` are pinned.
3. A valid **stable, native-authenticated save-lineage claim** matches a securely persisted claim previously bound at an **explicit human confirmation**. Its origin, freshness, unforgeability in this threat model, identity across game relaunches, handling of save copy/overwrite, and world-reset semantics must be documented and tested. If no reliable claim exists, return `save_proof_unavailable` and require manual confirmation.
4. **Exactly one eligible timeline** for the current world profile and lineage, and that timeline is precisely the durable `activeTimelineId`. Distinct additional timelines, forks, empty/mismatching ID, missing/manual-confirmation provenance, corrupted metadata, or an unknown legacy history fail closed. Do not select by newest, label, creation time, character or most recent write.
5. No source/world boundary has occurred between the snapshot used to decide and the actual serialized commit; no pending `clock_regression`, `timeline_change`, `save_fork`, `world_epoch`, `native_disconnect`, `unknown_source`, or `source_change` revocation. Explicit manual confirmation may recover according to existing policy.
6. Same `worldProfileId` and expected identity domain. No cross-world, cross-profile, player-avatar or native owner shortcut. The unified human player identity decision remains orthogonal.
7. No competing manual selection/confirmation request. A manual decision wins; an already-queued automatic operation with an older generation must fail, not overwrite it.

**Security invariant:** no learned-memory read, recall injection, conversation/history replay, journaling, witness event, privacy mutation, or command may become authorized because of auto-resume unless the same guard would authorize it after a legitimate manual confirmation for that authenticated source. Preserve source-specific D01/D02/D03 and privacy fences beyond the timeline layer.

### Provenance persistence (design, conditional on proof availability)

Use an **additive** single-record SQLite provenance binding in the existing P2 database, written **only after** a successful human `timeline_confirm` and current proof validation. Suggested shape:

`timeline_resume_binding_v1(world_profile_id PK, timeline_id, save_proof_type, save_proof_digest, manually_confirmed_at_utc, binding_version, updated_at_utc)`.

Store a domain-separated SHA-256 digest of canonical validated proof bytes (not raw save names, full paths, credentials, or arbitrary game state), and include a format/version and world-profile namespace; hashing offers data minimization, **not** authentication. The proof must be authenticated **before** hashing. Prefer an existing durable metadata table if schema support is available; create a tiny migration only if required. Historical/legacy manually selected timelines lacking a verified binding are **not** silently enrolled; user confirms once to establish it. Avoid destructive schema migrations, automatic merging, automatic timeline creation, or changes to existing memory rows.

Revoke eligibility for a conflicting confirmation, ambiguous save transition, intentional reset/clear, DB restore or binding/schema mismatch. Do not erase existing journal/profile data when refusing auto-resume. A source loss should revoke the **current session's authorization**, not delete a legitimate prior binding by default; a new genuine save mismatch must not be silently rebound.

## 4. Proposed JS API surface (names provisional; preserve manual semantics)

**Shared storage** `P2SqliteProfileStore`:
```js
// Read-only candidate query; no selection, confirmed source, or write effect.
async inspectAutoResumeCandidate({worldProfileId, saveProof}) =>
  {eligible, timelineId:null|string, reason:string};

// Atomic, queued reauthorization; **not** a wrapper around manual confirmTimeline.
async autoResumeConfirmedTimeline({
  timelineId, expectedAuthorityGeneration, expectedHostRunId,
  expectedWorldEpoch, saveProof
}) => {resumed:boolean, reason:string, timelineId?:string};

// Explicit confirmation continues through existing confirmTimeline API;
// in a separate guarded post-confirmation transaction bind fresh proven lineage.
// No auto-resume path creates/updates the binding.
async bindManuallyConfirmedSaveLineage({timelineId, hostContext, saveProof}) => boolean;
```

Return sanitized enumerated reasons, never raw save-proof material. Keep `#authorityGeneration` private; expose a **read-only opaque snapshot/fence token** or move the inspect+validate+authorize operation fully into the store queue; never let bootstrap guess a generation. The atomic method must independently validate the current source reference/value, boundary veto, persisted binding, timeline cardinality, and DB active ID **inside the serialized writer** immediately before updating activation/`#confirmedSource`. Reuse `#serial()`, existing `#db.activateTimeline()`, and increment `#authorityGeneration` exactly as current confirmation does. Existing `confirmTimeline` must retain UX/manual-only semantics and not become a generic “trusted caller” bypass.

**Coordinator** (new small `lsa-essential-e1-candidate/src/memory/autoTimelineResume.mjs`):
```js
createAutoTimelineResumeCoordinator({
  enabled, store, subscribeVerifiedHostContext,
  subscribeWorldBoundary, getAuthenticatedSaveProof,
  diagnostics, onSafeFailure
}) => {start(), status(), close()};
```
The proof getter MUST return only a source-bound proof from the already authenticated native channel. If proof is absent, coordinator records `manual_required/save_proof_unavailable`. `start()` registers listeners only when eligible; `close()` unsubscribes, invalidates in-flight attempts and prevents authorization after shutdown. Coalesce repeated host samples by run+epoch+proof generation, but revalidate at commit. A *new* host/epoch requires a new proof and decision.

**Status view**: `{enabled, state:'disabled'|'waiting_native'|'checking'|'resumed'|'manual_required', reason, timelineId?}` read-only, never reports `resumed` unless `store.timelineWritable` for the currently pinned source. Do not expose proof digest, secrets, actor identity or journal content.

## 5. Exact integration order and lifetime

1. `createRuntimeForBundle()` parses validated configuration and creates the existing scope/cleanup owner.
2. `createRuntime(... deferCharacterInitialization:true ...)`; acquire P2 lock and run `characterService.initialize()`. Timeline remains non-writable until source and confirmation.
3. Construct IntelligenceClient/verified C-13 source and boundary subscriptions as today. Install the existing store source/boundary observers **before** auto-resume observer. A synchronous verified callback first updates `store.setVerifiedHostContext(context)`; the auto coordinator then schedules one fenced attempt. Do not do async DB work inside unguarded event delivery.
4. Verified host context arrives. Obtain *matching* authenticated save proof from the **same source run+epoch**, not from a late cached frame. If unknown, remain paused and expose manual fallback.
5. In the existing P2 serialized queue: verify stable snapshot, DB/lock health, previously manually bound lineage, exact active timeline, one eligible candidate and no prior boundary veto. Atomically stamp authority for **that** run/epoch and update store generation. All late work from an older generation fails.
6. Enable normal consumers naturally through `timelineWritable`/verified context; do not directly enable H1/H2/M2/M3/M4/M5/M8 or alter configuration/pauseLearned. If paused by privacy policy or feature gate, auto-resume does **not** override it.
7. On native disconnect, epoch change, save fork, reset, clock regression, writer loss, manual selection or shutdown, existing `onBoundary`/source revocation immediately suspends reads/writes and revokes pending automatic work. A manual user confirmation remains the only fallback when proof or selection is ambiguous.
8. Editor `timeline_list` and diagnostic view explain whether automatic resume occurred or why user action is needed; `timeline_confirm` remains unchanged. Update UI text to conditional behavior, not “always once per launch.”
9. On process close, unsubscribe coordinator *before* storage teardown using composition owner. Do not modify voice/TTS pipeline, ElevenLabs keys/provider settings, speaker profiles, native speaking code or DLL packaging unless proven unavoidable.

## 6. Phased implementation tasks and exit criteria

### Phase 0 — evidence and go/no-go (read-only; mandatory)

- [ ] Record exact #138 base commit and trace `IntelligenceClient.subscribeVerifiedHostContext`, authenticated C-13 frame validators, native hello/epoch producer, and `subscribeWorldBoundary` ordering; enumerate all fields and trust boundary.
- [ ] Inspect `native/promoted-characters/MemoryOwnerAuthority.cs` and producer contract for stable save proof. Verify it actually identifies the loaded save *across restarts*, differentiates load/rollback/fork, and cannot be spoofed via browser or model input. Record field-level evidence and tests.
- [ ] Inspect shared `sqliteFoundation.mjs` schema, upgrade strategy, active-timeline uniqueness, recovery/snapshot behavior, worldProfile ID derivation, lock restoration and manual-confirm data persistence.
- [ ] Inspect #138's current tests for genuine manual-confirm, reconnect and ABA edge cases; compare #184 changes for **awareness only** without touching #184. Document any differences before implementation.
- [ ] **GO** only if stable native-authenticated proof exists or a separately approved native extension supplies it. Otherwise **NO-GO for automatic authorization**, though configuration/diagnostics can be separately planned.

### Phase 1 — configuration and storage contract

- [ ] `src/memory/capabilityPolicy.mjs`: allow only strict `autoResumeSingleTimeline` boolean with default `false`. Maintain existing rejection of unknown keys.
- [ ] `e1.config.example.json` and docs: show option off, explain single-timeline and proof prerequisites.
- [ ] `lsa-shared-brain/src/characters/sqliteFoundation.mjs`: if needed, add non-destructive binding metadata schema and migration, backup/recovery parity. Never rewrite journal or active timeline on migration.
- [ ] `lsa-shared-brain/src/characters/sqliteProfileStore.mjs`: add guarded, serialized read-only inspection, explicit-confirm binding and atomic automatic resume; preserve generation/read/write fencing.
- [ ] Unit tests: disabled-by-default, wrong type, unknown key, existing capabilities/ElevenLabs config normalization unchanged, legacy DB no implicit opt-in, strict cardinality, bindings created only by user-confirmed path.

### Phase 2 — authenticated integration

- [ ] `src/memory/autoTimelineResume.mjs`: coordinator with source-specific cancellation and bounded retries (no polling for trust).
- [ ] `src/bootstrap.mjs`: register after source store observers, before IntelligenceClient.start(); owner-managed teardown. If authenticated proof is projected from an existing frame, change only the narrow JS adapter/contract and validate it against the verified source stamp.
- [ ] `src/characters/editorServer.mjs`: expose sanitized read-only status, show actionable manual fallback; retain manual confirm and timeline creation behavior exactly.
- [ ] Tests using real/faithful source proof harness: source arrives after SQLite bootstrap, duplicate verified samples, delayed proof/DB callback, native disconnect between check and commit, source replacement (including A→B→A), restart, editor manual confirmation racing automatic attempt.
- [ ] If proof requires **new DLL data**, pause here; prepare a separate justified native design/PR, explicit authenticated contract versioning and backward-compatible failure (old DLL => manual confirmation), rather than mixing unsanctioned native change into this workstream.

### Phase 3 — end-to-end safety and compatibility

- [ ] Fresh install/no timelines => manual. One legacy timeline without binding => manual once. One bound matching save => resume after authenticated fresh session. Several timelines (even one active) => manual unless a rigorously proved uniquely bound candidate policy has been explicitly approved.
- [ ] Different save, copied save/fork, older checkpoint, save overwrite, world reset, clock regression, unknown source, null host context, epoch transition, conflicting timeline ID => **no automatic writes or memory-context reads**; manual UI operable.
- [ ] Generation race: queued write/recall admitted before revocation and executed after candidate reauthorization fails; no stale H1/H2 evidence injection or restored privacy-hidden content.
- [ ] D01 acceptance receipts, D02 owner binding, D03 joins, M2/M3 event journaling, H1 conversation history, H2 factual recall, M4/M5/M8, inspector, memory privacy/forget operations remain source/owner gated.
- [ ] Corrupted SQLite/binding, lock contention, disk full, startup failure, repeated source samples, graceful/ungraceful shutdown => no fake success and no data deletion.
- [ ] Run focused shared-brain timeline/SQLite tests, E1 config/bootstrap/editor tests, native-source authority tests, Memory K H1/H2/privacy/replay suites, then existing PR #138 compatibility CI. Report actual test counts and failures; no claim of passing until executed.
- [ ] Regression-smoke deployed OpenAI + ElevenLabs voice configurations; all automatic changes are storage/source-only, no audio or voice behavior changes.
- [ ] Manual GTA validation: launch same save, observe automatic resume and remembered preference across complete game restart; launch a different save/reset and prove pause+manual prompt; simulate disconnect/reconnect and verify source-fenced behavior.

### Phase 4 — integration decision (future, explicitly NOT part of this plan-only change)

- [ ] Review provenance security evidence, source proof, native necessity and test logs; keep any unresolved proof issue as a blocking NO-GO.
- [ ] Review implementation separately and target #138 only after approval. Leave #184 open and unchanged. No merges, native deployment or runtime toggle during this planning task.

## 7. Race/edge-case register

| Race / case | Required behavior |
| --- | --- |
| SQLite initialization finishes after boundary | Preserve existing pending veto; auto operation rechecks it under queue. |
| Verified C-13 host sample repeats unchanged | Coalesce; no unnecessary revoke. |
| New host run or epoch while proof query pending | Invalidate old attempt; forbid old proof from authorizing new source. |
| Host A → B → A / ABA source swap | Monotone generation fence blocks delayed A work even with matching stamp. |
| Browser manual confirmation races auto | Manual wins; generation/selection CAS rejects stale auto attempt. |
| Different save but same worldProfileId/protagonist | Cannot auto-authorize without exact trustworthy save proof match. |
| Save slot copied/overwritten or rollback | Treat as ambiguous until discriminator semantics confirmed; never infer sameness from slot alone. |
| Previous active timeline but no consent/proof binding | Do not silently enroll; manual confirmation required. |
| More than one timeline in DB | No naive “last active” guess; fail closed. |
| Disconnected native source but previously confirmed stamp | Writable must be false; don't infer live authority from persisted ID. |
| DB restored to prior snapshot | Never auto-approve from potentially stale binding without current matching authoritative lineage; reject uncertain rollback. |
| Memory privacy revocation / forget during resume | Authority and data read fences recheck; never resurrect deleted/hidden memories. |
| Old native addon lacks new claim | Backward compatible manual flow; disabled/unavailable diagnostics. |

## 8. Acceptance criteria

1. Default behavior is identical to existing #138: no auto-resume, same manual UI and write safety.
2. A properly opted-in player with one **previously manually confirmed, provably matching** save lineage automatically regains `timelineWritable` only after a **fresh authenticated native source** and atomic in-store authorization, without opening `127.0.0.1:37921`.
3. Every missing, ambiguous, stale, conflicting, revoked or different-save condition leaves learned memory paused, visibly explains why, and retains functioning manual confirmation.
4. All existing SQLite rows, timeline IDs, character ownership, D02/D03 proof checks, privacy rules, read/write generations, H1/H2 and other capability modes survive unchanged.
5. No naive auto invocation of `confirmTimeline`, no “one row means correct save” assumption, no clock/player/world-profile heuristic, no second SQLite writer, no unconditional suppression of native boundary callbacks.
6. No native DLL changes unless Phase 0 proves they are indispensable and a separate review approves their scope.
7. ElevenLabs voice path and #184 unchanged. Tests/logs substantiate behavior before any future merge or deployment.

## 9. Planning task completion / present disposition

This document is a plan, **not a claim that automatic resume is currently safe or implemented**. Source inspection establishes the native session/epoch proof and SQLite fencing, but **does not establish a stable authenticated save-lineage discriminator**. The implementation therefore begins with a proof-feasibility gate; without it, automatic reconfirmation must remain unavailable and manual confirmation remains mandatory. Do not turn the setting on or merge anything based solely on this document.
