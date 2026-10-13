# Memory K — production implementation plan (living document)

**Created:** 2026-10-12. **Owner:** Memory K lead orchestrator (Claude). **Integration branch:** `integration/memory-k-production-20261012`.
**Inputs:** [independent audit](MEMORY-K-INDEPENDENT-AUDIT-20261012.md) (PR #132), the original plan at `c493133` ([approved decisions](approved-decisions.md), [roadmap](implementation-roadmap.md), [architecture study](architecture-study-20261011.md)) and the M0 corpus `tools/memory-sim/scenarios.v0.json`.

This plan turns every audit finding into owned, testable work and records progress with evidence. It is not a merge approval, a deployment instruction or GTA acceptance. A row moves to **Done** only after the orchestrator independently re-ran the evidence named in the row; an agent's own report is never sufficient.

**Evidence labels** (as in the audit): **SOURCE VERIFIED** (read in code), **OFFLINE TESTED** (real modules or suites re-run by the orchestrator), **NATIVE COMPILED** (production `net481` project compiled in the sandbox against NuGet reference assemblies; not the approved-SDK gate and not a GTA build), **GTA VERIFIED** (physical game receipts; none exist), **BLOCKED**, **UNTESTED**.

Session provenance, toolchain, measurements and blockers: [complete session record](memory-k-production/SESSION-RECORD-20261012.md).

## 1. Non-negotiables

1. **The original plan is the acceptance authority.** No workstream may reduce scope, weaken privacy, redefine acceptance or drop planned functionality. Deviations are allowed only as an explicit decision record (`docs/research/DECISIONS.md` or the amendment table in `approved-decisions.md`) and must be listed in §8.
2. **Verbatim content.** Player and NPC text is stored and recalled byte-exact. Nothing is filtered, masked or paraphrased for profanity or mature themes (study §3.3, §8.6).
3. **Fail closed, never fabricate.** Missing proof writes nothing and says so; it never guesses. Production code contains no mocks; test fixtures exist only at the native and protocol boundary.
4. **One store, one writer, one assembler.** P2 SQLite is the only memory store (D-003/D-019); D03/W03 are the only dialogue writers; PS4 is the only model-visible writer (D-008).
5. **Truthful readiness.** Offline tests never become GTA claims. Failing tests are reported, not hidden; expected-fail gates are labelled and counted as not passing.
6. **Boundaries.** No merge to `main`, no GTA deployment or installation, no branch deletion, no force-push, no closing of PRs. The ElevenLabs line (#96, #106–#109, #112, #118, #124–#127) and the unified-player branches (#114, #115, #121–#123) are not modified; reconciliation happens on new branches only (WS-8).

## 2. Baseline (orchestrator-measured)

Measured at `1b288c1` (merge of PR #132 head `bcb21f6` onto PR #131 head `f78970a`), Node **v24.21.0** on Linux. The counts match the audit's numbers for `215fc7d`.

| Suite | Command (from repo root unless noted) | Tests | Pass | Fail |
| --- | --- | --- | --- | --- |
| Shared brain | `node --test lsa-shared-brain/tests/*.test.mjs` | 215 | 211 | 4 (W04 ×3, W06 ×1) |
| e1 top-level | `cd lsa-essential-e1-candidate && node tools/runTests.mjs` | 1040 | 1022 | 17 (S01–S10 red gates ×10, W03 ×6, M1 editor ×1) |
| e1 memory | `cd lsa-essential-e1-candidate && node --test tests/memory/*.test.mjs` | 98 | 98 | 0 |
| Memory sim | `node --test tools/memory-sim/tests/*.mjs` | 7 | 7 | 0 |
| Native policy (net8) | `dotnet run --project native/intelligence/memory-authority-tests/MemoryAuthorityTests.csproj -c Release` | 23 assertions | PASS | — |

The two e1 suites both rebuild `dist/`; run them sequentially, never concurrently in one worktree.

**Reproduced:** K-01 (`ERR_MODULE_NOT_FOUND` for `plugins/lsa-shared-brain/src/memory/journalSqlite.mjs` when importing the isolated `dist/plugins` copy; four dist files still reference `lsa-shared-brain/src`).

**New finding K-22 (P0, native packaging) — fixed at `4079609`, NATIVE COMPILED.** `native/promoted-characters/PromotedCharacters.csproj` did not compile at the PR #131/#132 heads: 12 × CS0104 (`Object` ambiguous between `Rage.Object` and `System.Object`) in `MemoryOwnerAuthority.cs` and `MemoryProtagonistSource.cs`, and CS1501 (`PoolHandle.ToString(IFormatProvider)`). The fix uses `object.ReferenceEquals/Equals` and `Handle.ToString()`, the same pedId formation as P1 `SessionIdentityIntegration`. One error remains and is **inherited unchanged from `main`**: `IntelligenceIntegration.cs` radio `NativeFunction.CallByName<string>` (CS0453 against NuGet `ragepluginhook` 1.124.0). It depends on the RPH reference version; the owner's real build environment decides it (B-4).

## 3. Toolchain and integration model

- **Node 24:** `/opt/node24/bin` (CI parity). **.NET SDK 8 and 10:** `/opt/dotnet`. **Mono:** `/usr/bin/mono` runs the `net481` harness executables.
- **Production native compile check** (sandbox; NuGet packages, not the approved SDK pins):
  `dotnet build native/promoted-characters/PromotedCharacters.csproj -c Release -p:AutomaticallyUseReferenceAssemblyPackages=true -p:RphReferencePath=/opt/lsa-native-refs/ragepluginhook/lib/net472/RagePluginHook.dll -p:DamageReferencePath=/opt/lsa-native-refs/damagetrackerlib/lib/DamageTrackerLib.dll -o <tmp>`
  Package SHA-256: ragepluginhook 1.124.0 `b48e24aa…8c36`, damagetrackerlib 2.0.0 `6b1546b8…de8f`. Expected residual: exactly the one inherited radio error above.
- **Branching:** every workstream branches from the integration branch at the wave's base SHA and is integrated back with a **merge commit** (never file copies — root cause 3 of the audit). Conflicts are resolved by the orchestrator, who re-runs every suite on the merged head.
- **CI visibility:** this session cannot read GitHub Actions results (the API is blocked by the egress proxy). All suite results here are local Linux runs; Windows results are UNTESTED until CI is observed.
- **Test discovery contract (WS-1 implements `memory-all`):** a new test is covered automatically if it lives in `lsa-shared-brain/tests/*.test.mjs`, `lsa-essential-e1-candidate/tests/*.test.mjs`, `lsa-essential-e1-candidate/tests/memory/*.test.mjs` or `tools/memory-sim/tests/*.test.mjs`. Native harness projects are listed in `memory-all` explicitly. Only WS-1 edits `.github/workflows/`.

## 4. Finding register and ownership

Every audit finding, the new finding K-22, and every deviation the audit lists under "silently dropped, weakened or reinterpreted" has exactly one owning workstream. Status values: **Open**, **In progress**, **Implemented** (branch exists, not yet verified), **Verified** (orchestrator re-ran evidence), **Integrated**, **Blocked**.

| ID | Sev | Finding (short) | Owner | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| K-01 | P0 | Packaged backend fails to start (shared imports not rewritten; contracts not staged) | WS-1 | Fixed (offline tested) | Staging rewrites `lsa-shared-brain/src` at any depth, stages `contracts/`, excludes the non-runtime acorn audit module and fails the build on any residual reference; `packaged-import-smoke.test.mjs` imports every `e1/**/*.mjs` from an empty directory. Not GTA verified. |
| K-02 | P0 | No production read path (M4/M8 frame, CONVERSE from journal, M5 dispatch, M6/M7/M9 callers) | WS-6a, WS-6b, WS-7a–c | Open | — |
| K-03 | P0 | No production write path: (a) D01 issuer, (b) actor ledger, (c) NPC capture, (d) M3 source proof, (e) coverage/prepromotion stubs, (f) `worldProfileId` predicates | (a)(b)(f-D02) PR #132; (c) WS-5a; (d)(f-M3) WS-5b; (e) WS-5b coverage, WS-5c prepromotion | Partly integrated (#132) | #132 OFFLINE TESTED per audit §D; re-verified by WS-5a |
| K-04 | P1 | D02 lease lifetime makes the D03 join unreachable | PR #132; WS-5a verifies and bounds total latency | Integrated (#132), re-verify | Audit §D probes A–H |
| K-05 | P1 | Forget then purge resurrects the source line | WS-4a | Open | W04 test fails at baseline |
| K-06 | P1 | Curation recreates a forgotten memory | WS-4a | Open | — |
| K-07 | P1 | M5 compound commands and clarifications lost in integration | WS-4a | Open | W04 tests fail at baseline |
| K-08 | P1 | Failing suites hidden by fragmented CI | WS-1 | Open | 21 failures at baseline |
| K-09 | P1 | ElevenLabs line forks the P2 store, runner and protagonist authority | WS-8 | Open | — |
| K-10 | P1 | Stale writer lock disables the store after a crash | WS-4b | Open | — |
| K-11 | P1 | Acceptance escalated beyond the original plan | Decision D-022 (recorded); WS-5a verifies implementation | Decision recorded | `DECISIONS.md` |
| K-12 | P2 | Counter-claims hide witnessed facts | WS-4a | Open | — |
| K-13 | P2 | No certified negative coverage (G5) | WS-5b (write side), WS-6a (bundle) | Open | — |
| K-14 | P2 | Timeline re-confirmation every launch; no in-game prompt (F11) | WS-4c | Open | — |
| K-15 | P2 | Public unfenced journal writers | WS-5a | Open | — |
| K-16 | P2 | Retention, quotas and snapshots missing | WS-4b | Open | — |
| K-17 | P2 | One-human decision unrecorded | Decision D-021 (recorded) | Done | `DECISIONS.md`, `approved-decisions.md` |
| K-18 | P2 | M8 and M9 at reduced scope; M9 native not compiled | WS-7b (M8), WS-7c (M9) | Open | — |
| K-19 | P2 | S01–S10 are red gates, not scenarios | WS-1 (label expected-fail), WS-9 (positive scenarios) | Open | — |
| K-20 | P3 | Minor items (see §4.1) | split, see §4.1 | Open | — |
| K-21 | P2 | Native D02 owner sample is all-or-nothing | WS-5c | Fixed on `feature/memory-k-k21-per-npc-owner-sampling-20261012` (native only; owners omitted individually, strict per-owner proof kept) | OFFLINE TESTED: `native/promoted-characters/owner-sample-tests` (30 scenarios, 319 assertions); GTA UNTESTED. Follow-up `fix/memory-k-k21-d02-per-owner-recovery-20261012` changes the JS consumer and ShadowRuntime to admit freshly re-proven exact owners after temporary omission without reviving prior leases; explicit native retirement and lifetime substitution stay rejected. D02 authenticated-socket integration tests and K-21 harness CI gate added |
| K-22 | P0 | Production `net481` plugin did not compile (Memory K native code) | Orchestrator | **Fixed** (`4079609`) | NATIVE COMPILED; WS-1 adds the gate |

### 4.1 K-20 sub-items

| Item | Owner |
| --- | --- |
| Clarifications stored per avatar (lost on avatar switch) | WS-4a |
| Replay page permanently skips suppressed items that are later restored | WS-4a |
| STT model recorded as `'unknown'` | WS-5a |
| Unregistered `memory_journal_not_committed` telemetry event (guarded in #132; must become a registered, emitted signal) | WS-5a |
| `npm test` red: M1 editor test uses `fetch` under the runner stub | WS-1 |
| Extension DDL outside the v4 migration transaction | WS-4b |
| Dead code: `m2EssentialCapture` (wire), `lunaCurationBridge` (wire), `m9DirectorCueAdmission` (wire) | WS-5a, WS-7a, WS-7c |
| `fixtureMemoryCommandStore.mjs` shipped in `src` | WS-4a |
| Legacy `m4_recall_records_v1` path in `sqliteRecallReadAdapter` | WS-6a |
| Turn hash duplicated in D03 and `conversationRecorder` | WS-5a |
| C-01 v2 path "unavailable with pinned ABI" | Recorded limitation (§8), no change |

### 4.2 Deviations from the original plan (audit §C) and their restoration

| ID | Original requirement | Deviation found | Restoration | Owner |
| --- | --- | --- | --- | --- |
| DV-1 | Player line = accepted input at `commitPlayerInput` (§3.3) | Escalated to "original Core must emit acceptance" | D-022 recorded; #132 issuer verified | Decision + WS-5a |
| DV-2 | Avatars separate (#4) | One human, unrecorded | D-021 recorded | Decision |
| DV-3 | Luna curation by default (#3) | Off by default with consent, unrecorded | Recorded as open owner decision O-1; conservative default kept, consent must be one in-product action | Decision + WS-7a |
| DV-4 | Witnessed facts unchanged by counter-claims (§5.6) | Counter-claims revoke evidence | Linked `reported_claim` overlay | WS-4a |
| DV-5 | Evidence-key + content-hash tombstone (§4.5) | Target-only tombstone deleted at purge | Permanent suppression records | WS-4a |
| DV-6 | NPC lines `completed`/`interrupted` ("possibly not heard")/`failed`; `reply_to` (§3.3) | Only `completed`; no `reply_to` | Full delivery statuses and reply links | WS-5a |
| DV-7 | Behaviour, not scaffolding | S-gates red; interfaces without callers | Production wiring + positive scenarios | WS-5a–c, WS-6a–b, WS-7a–c, WS-9 |
| DV-8 | G5, AD-8, retention, inspector UI, F11, M10 | Deferred indefinitely | Owned below; M10 standalone adapters blocked externally (B-5) | WS-5b/6a, WS-5c, WS-4b, WS-10, WS-4c, WS-9 |

## 5. Workstreams

Each workstream branch is `feature/memory-k-<ws>-<topic>-20261012` (repairs: `fix/memory-k-<ws>-…`). Each writes a handoff at `docs/plans/promoted-npc-memory/memory-k-production/<WS>-HANDOFF.md`.

| WS | Scope | Requirements | Depends on | Wave |
| --- | --- | --- | --- | --- |
| **WS-1** Packaging, native build gate, CI integrity | K-01 rewrite at any depth, staged contracts, build fails on any residual `lsa-shared-brain/src`, packaged-import smoke (empty dir, import `e1/bootstrap.mjs` and every `e1/**/*.mjs`), installer consistency, W09 manifest reconcile, native compile gate (K-22), `memory-all` workflow (Node 24, Windows + Linux, globs in §3, native harnesses, packaged smoke), consolidation without coverage loss, M1 editor test, W06 precedence failure, S01–S10 labelled expected-fail (todo with reason) | K-01, K-08, K-19 (label), K-20 (npm test), K-22 gate | — | 1 |
| **WS-4a** Privacy and M5 integrity | Upward source closure or permanent evidence-key + content-hash suppression that purge never deletes; write gates (`persistDeterministicMemory`, `completeCuration`, Luna path) use the read suppression set; `curation_source_forgotten`; restore `commitCommandBatch`/`findPendingClarification` with #123 cross-avatar hashing; counter-claims as linked `reported_claim` overlays, only STT transcript corrections supersede; clarifications survive avatar switch; replay feed re-offers restored items; move `fixtureMemoryCommandStore` to tests | K-05, K-06, K-07, K-12, K-20 (4 items), DV-4, DV-5 | — | 1 |
| **WS-4b** Durability and retention | Lock file `{pid, hostRunId, startedAt}`, dead-owner reclaim, live second process still refused, status visible; `quick_check` on open with read-only fallback; `VACUUM INTO` snapshots at session end and before migrations (7 daily, 4 weekly); per-character caps (25,000 events / 64 MiB) and 1 GiB global cap that stop journaling with a visible warning, never silent deletion of verbatim lines; free-recall window ≥ 200 player lines or current + previous session (cap 1,000 lines / 512 KiB) and archive tier per approved decision #6 (no 60-day expiry); extension DDL inside the migration transaction | K-10, K-16, K-20 (DDL), AD-6 | — | 1 |
| **WS-4c** Timeline continuity and F11 | Automatic continuation on `host_reload` when the lineage marker matches; suspend and prompt only on `clock_regression` or ambiguity; in-game F11 confirmation in addition to the editor; writes stay suspended until chosen; never blend or delete diverging futures | K-14, M1 F11, AD-5, S07 | — | 1 |
| **WS-5a** Dialogue write path (M2) | Verify #132 issuer/ledger/D02 in the runner; W03 NPC capture wired through `createM2EssentialCapture` sharing D03's `memory.turn.v1` hash; NPC `completed`, `interrupted` (possibly not heard), `failed` (never presented as said); `reply_to`; STT provider and model recorded; capability-gated writers (no public unfenced writer); single turn-hash derivation; W03 fixture repaired and all W03 tests executing; D03 total pre-model wait bounded by one shared budget; `not_stored` documented as "no durable receipt"; registered journal-failure telemetry | K-03(c), K-04 re-verify, K-11 verify, K-15, K-20 (4 items), DV-1, DV-6, G1, M2 | — | 1 |
| **WS-5b** Event write path (M3) and coverage | D-023 observation-time attribution in the production adapter; M3 `profileForAlias` predicate (`bootstrap.mjs`) fixed; durable subjects; 2,500-event run through the production adapter; native-receipted coverage per observer window derived only from authenticated frames, with gaps on stall/reset/pause; per-character isolation | K-03(d), K-03(e) coverage, K-03(f) M3, K-13 (write side), G2, M3, S02/S03 store side | — | 1 |
| **WS-5c** Native owner availability and promotion grace | Per-anchor omission instead of whole-frame null in `SampleMemoryCurrentOwnerPlayer`, with per-owner checks kept; native harness case (one healthy, one suspended NPC); `resolvePrepromotion`: same physical ped, ≤ 120 s observations and ≤ 12 open-session messages imported as `imported_at_promotion` only with witness, lifetime and identity proofs | K-21, K-03(e) prepromotion, AD-8, S08 | — | 1 |
| **WS-6a** Recall into the frame (M4/M8) | `finalizeKnowledgeFrame` prepares M4 recall and M8 opinions after the accepted-line readback and before the model call; RECALLED, coverage statement (G5), "best plus exact count" (G3), labels (G4), frozen per turn for retries; remove legacy `m4_recall_records_v1`; latency measured | K-02 (frame), K-13 (bundle), G3, G4, G5, AD-1, AD-7 | WS-4a, WS-5a, WS-5b | 2 |
| **WS-6b** Journal CONVERSE and M5 dispatch | CONVERSE rebuilt from the journal by `CharacterId` and timeline (current conversation ≤ 20 messages / 12 KiB, 5-minute continuity, `CONVERSE.earlier` block, archived lines labelled); RAM history only as the documented fallback; M5 dispatch after the durable receipt and before the model, `MEMORY_ACTION` in SELF with truthful statuses | K-02 (CONVERSE, M5), M2 cross-session, M5 | WS-4a, WS-5a | 2 |
| **WS-10** Memory inspector | Editor inspector: browse, search, pin, edit (manual lock), forget, trash and undo, export, per-character "forget everything", global memory off switch; localhost only | M5 inspector, §8.6 | WS-4a, WS-4b | 2 |
| **WS-7a** M6 orchestration and M7 curation | Boundary-driven M6 coordinator in production (scene/conversation/session ends, deterministic notability, budgets, digests, fading, `ps5_memory` acks after commit); M7 Luna curation through `lunaCurationBridge` behind consent (O-1), idle scheduling, durable queue replay, grounding validator | K-02 (M6/M7), DV-3, M6, M7, S05 | WS-6a, WS-6b | 3 |
| **WS-7b** M8 personality layer | Memory personality profile field with owner approval; beliefs, relationship dimensions (trust, affection, respect, annoyance, familiarity), grudges with forgiveness half-life, running-joke lifecycle, storytelling rules; canon precedence | K-18 (M8), M8, S06 | WS-6a | 3 |
| **WS-7c** M9 producers and callbacks | Rollover, Wasted and Busted producers; M9 native sources in the production project; cue monitor and 13b `recall_callback` through Director admission with budgets; optional bundle `callback` item; `m9DirectorCueAdmission` wired | K-18 (M9), K-20 (M9 dead code), M9, S10 | WS-6a | 3 |
| **WS-8** ElevenLabs reconciliation | Divergence inventory; K's store as the single owner module; a **new** reconcile branch merging #118 onto this integration branch with one protagonist authority feeding both mood and D02; both builds open one database; no edits to EL branches | K-09 | WS-4a, WS-4b stable | 3 |
| **WS-9** Scenario acceptance | S01–S10 as positive runner scenarios (fixtures only at native/protocol boundary) with GTA receipt checklists; M4 harness metrics (≥ 95 % recent factual, ≥ 98 % exact quotes, p95 ≤ 40 ms); offline soak harness | K-19, M4 metrics, S01–S10, M10 (offline part) | WS-6a, WS-6b, WS-7a–c | 3 |
| **WS-R** Adversarial review and repairs | Fresh review of the integrated head against the audit and the original plan; targeted repair branches for every defect found | All | Waves 1–3 integrated | 4 |

```text
Wave 1: WS-1 · WS-4a · WS-4b · WS-4c · WS-5a · WS-5b · WS-5c   (independent; merge conflicts resolved by orchestrator)
Wave 2: WS-6a · WS-6b · WS-10                                    (after wave 1 verified + integrated)
Wave 3: WS-7a · WS-7b · WS-7c · WS-8 · WS-9                     (after wave 2 verified + integrated)
Wave 4: WS-R review → repair branches → re-review               (after wave 3 integrated)
```

## 6. Acceptance gates

1. **Offline gate:** `memory-all` green on Node 24 (Linux locally; Windows when CI is observable); packaged-import smoke green; positive runner scenarios S01, S07, S09; K-04 timing tests; all privacy tests; no expected-fail gate counted as passing.
2. **Native gate (owner's machine):** `PromotedCharacters.csproj` built against the owner's real RPH, DamageTracker and Essential references, hash-pinned packaging.
3. **Controlled GTA (explicit owner authorization):** S01, S09, S07 as in audit §E, with JSONL telemetry and SQLite rows as receipts. Then WS-7 scenarios and the M10 soak.

## 7. Progress log

| Date | Event | Evidence |
| --- | --- | --- |
| 2026-10-12 | Integration branch created: merge commit `1b288c1` of PR #132 onto PR #131 | Tree equals `bcb21f6` |
| 2026-10-12 | Baseline suites re-run on Node 24.21.0 | §2 |
| 2026-10-12 | K-22 found and fixed (`4079609`) | NATIVE COMPILED; one inherited radio error remains |
| 2026-10-12 | Decisions D-021, D-022, D-023 recorded; O-1, O-2 opened | `DECISIONS.md`, `approved-decisions.md` |

## 8. Blockers, open decisions and recorded limitations

| ID | Type | Description | Effect |
| --- | --- | --- | --- |
| B-1 | Environment | Push denied: the git proxy has no credential for this repository in this session | Branches are committed locally; pushed when the owner grants access, otherwise delivered as git bundles |
| B-2 | Environment | GitHub API blocked: CI results and PR metadata unobservable | Windows CI evidence UNTESTED |
| B-3 | Physical | No GTA access | Every GTA gate UNTESTED |
| B-4 | Native | Radio `CallByName<string>` compile error against NuGet RPH 1.124.0 (inherited from `main`) | Owner's real RPH build decides; outside Memory K |
| B-5 | External dependency | M10 standalone adapters depend on standalone P2/PS migration acceptance (roadmap) | Offline soak only |
| O-1 | Owner decision | Luna curation default (approved #3) versus consent-gated off default | Conservative default kept |
| O-2 | Owner decision | D03 corroboration before versus after the model request | G1 ordering kept |
| L-1 | Limitation | C-01 v2 native path "unavailable with pinned ABI" | Unchanged; D-022 does not depend on it |

## 9. Readiness board (updated as work lands)

| Dimension | Verdict | Basis |
| --- | --- | --- |
| Source implementation readiness | NO-GO | Baseline: K-02, K-03 |
| Offline integration readiness | NO-GO | Baseline: 21 failures, privacy defects |
| Native packaging readiness | NO-GO | K-01; K-22 fixed but no approved-SDK build |
| GTA deployment readiness | NO-GO | Do not install any Memory K integration build |
| S01–S10 production acceptance | 0 / 10 | Red gates; no GTA receipts |
