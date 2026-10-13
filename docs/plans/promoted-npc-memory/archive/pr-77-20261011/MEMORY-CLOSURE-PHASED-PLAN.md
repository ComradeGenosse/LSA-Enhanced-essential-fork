# Memory closure — phased implementation and parallel agents

**Planning-only document (2026-10-11). No code or GTA deployment acceptance.**
Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`. Immutable code starting point: draft PR #75 at `8443a8adec9433626902b46b81bd3e58fc382fb2`, base `integration/memory-completion-h-review-20261011`.
Authority: `docs/plans/promoted-npc-memory/MEMORY-INTEGRATION-ACCEPTANCE.md`, `implementation-roadmap.md`, `approved-decisions.md`, `contracts/memory.v1.json`, PS0–PS4/PS6 contracts, and `tools/memory-sim/scenarios.v0.json`.

## Current problem

PR #75 assembled M2/M3/M4/M5/M6/M7/M9 but does **not** produce a complete, working NPC memory experience. Still missing: independently verified native owner/protagonist/negative coverage proof; robust real accepted STT/NPC-audio hooks; prepromotion/PS2 witness integration; admission to the *sole* PS4 model frame; M5 pre-Luna commands and scoped privacy UX; M6 idle/scene-close durable replay; consented M7 Luna background work; **M8 personality/relationships/jokes**; actual native M9 gameplay producers and PS6 callback priority; combined CI/build/soak/physical GTA receipts.

PR #75 CI has some successful component checks, but its complete combined integration run was still queued at this review. Treat `pending` as **not passed**. Source modules plus mock tests are not complete gameplay behavior.

## Delivery phases

| Phase | Parallel owners | Deliverable | Gate |
| --- | --- | --- | --- |
| **P0 — baseline/contract freeze** | All agents (read-only audit before changes) | Verify exact SHA, current CI, schema, PS2/PS6/native ownership, existing source and integration APIs; agree typed/mock fixtures | No guessed native authority or unowned shared-file changes |
| **P1 — substrate** | **A native source authority**, **B P2 SQLite/cursors/privacy** | Native source-fenced proof & epoch/owner adapter; a single P2 write/transaction system with durable replay cursors and privacy semantics | Native invalid owners denied; SQLite migration/rollback/restart tests |
| **P2 — deterministic memory** | **C M2 dialogue**, **D M3 witnesses**, **E M4 PS4**, **F M5 commands**, **G M6 selection** | Real verified capture adapters, bounded witness intake, strict recalled frame projection, durable pre-Luna command coordinator, restart-safe deterministic selection | Each specialist proves positive + negative fixtures and publishes stable exports |
| **P3 — delight without fabrication** | **H M7 Luna**, **I M8 personalities**, **J M9 gameplay cues** | Consented bounded idle cloud curation, source-linked NPC opinions/jokes, source-qualified native events/Director gates | No paid request during player turn; same fact/different opinion; never false-witness |
| **P4 — source integration** | **K final integrator only** | Combine ten PRs, resolve APIs, own native registration/bootstrap/shared runner/config/editor/PS4 and integrated acceptance suite | Real end-to-end source pipeline, single authority for database and frame |
| **P5 — offline release gate** | K | Windows/Linux Node24 tests, native harnesses, strict v1 schema + RecallBundle totalBytes, pinned original patch/build, cross-agent real SQLite, full M0 S01–S10 replay and soak where runnable | All offline claims backed by SHA-specific logs; unresolved gates precisely documented |
| **P6 — controlled physical GTA** | Authorized operator after K GO | Backup-based install, actual gameplay receipts for S01–S10, three-NPC soak/rollback, cost and latency measurements | **Never infer physical acceptance from mocks; no automatic install** |

Ten specialists A–J start concurrently from the **same immutable SHA**; their dependency APIs use mocks until compatible implementations are available. Final integrator **K must not begin** before **every** A–J PR and handoff is pushed. Agents may not merge into a common branch or `main`.

## Shared safety rules

1. **One P2-owned SQLite database / writer**. No second memory daemon, local AI, GPU model, speculative database, or independently committing M5 SQLite connection. Explicit migrations preserve legacy backups, WAL integrity and timeline suspension.
2. **One PS4/C-04 knowledge-frame renderer**, no second system prompt or parallel memory model context. Recall and correction suppressions must revalidate before provider send/retry.
3. Native event detection only proposes candidate facts; **PS2** separately proves what a particular promoted NPC witnessed. Never convert proximity, PS3 salience or a report into direct observation. No native negative receipt means **unknown**, not "did not see".
4. WorldProfileId, TimelineId, CharacterId, ownerAlias, hostRunId, epoch, incarnation, encounter, observer, protagonist and accepted turn must be source-fenced at write/activation. Missing protagonist stays `unknown`. Handle reused ped IDs and owner retirement.
5. M2 preserves verbatim typed/STT accepted bytes (including Unicode/profanity); NPC lines only after matched `playback_ended(completed)`; early and buffered speech paths must reflect exact native-audible text.
6. M5 only announces `saved`, `forgotten`, `corrected` after SQLite commit + readback. Deletion immediately suppresses derived memories; clarification choices preserve offered IDs. Seven-day trash/restore/purge is authorized and scoped.
7. M6 offline deterministic memories always function without M7, with a ~6/hour **soft** target. A bounded 1000-row scan cannot silently abandon older evidence: use durable cursor/backfill or report explicitly incomplete.
8. M7 uses **existing Luna cloud** only after explicit consent, idle/low-priority, durable daily/monthly reservations, cancellation, retries, expired leases and safe appraisals; no paid operations while talking.
9. M8 may add subjective humor/relationship interpretation but cannot rewrite evidence, player-approved canon, quotes, participants, events or facts.
10. M9 callbacks need approved existing PS6 Director native C-06/original turn entitlement, player mic/typed priority, combat gating and cooldown; never bypass those controls.
11. **No merge to main, GTA installation, live paid Luna tests or physical-acceptance claims** without explicit authorization and actual receipts.

## Exclusive agent ownership

| Agent | Exclusive implementation files/area | Shared files reserved for K |
| --- | --- | --- |
| **A Native** | New proof/resolver/codec modules under `native/promoted-characters/`, `native/intelligence/` (not `m9/`); new `lsa-essential-e1-candidate/src/memory/nativeMemoryAuthority.mjs`; native harnesses | `native/intelligence/IntelligenceIntegration.cs`, `IntelligenceChannel.cs`, original `HostContext.cs`, `bootstrap.mjs` |
| **B P2 store** | `lsa-shared-brain/src/characters/sqliteFoundation.mjs`, `sqliteProfileStore.mjs`, `src/memory/m5SqlitePrivacy.mjs`, new cursor/transaction helper modules, DB tests | `integrationPorts.mjs`, Essential editor/character service |
| **C M2** | `lsa-shared-brain/src/memory/m2TurnCapture.mjs`, `conversationRecorder.mjs`, new `lsa-essential-e1-candidate/src/memory/m2*.mjs`, focused tests | `essentialGlue.mjs`, `runSequentialTurn.mjs` |
| **D M3** | `lsa-shared-brain/src/events/m3ObserverOwnerBinder.mjs`, `m3BoundedIntake.mjs`, `m3CoverageSqlite.mjs`, `witnessedEventRecorder.mjs`, new witness adapters/tests | `intelligenceClient.mjs`, `bootstrap.mjs`, `integrationPorts.mjs` |
| **E M4 PS4** | `lsa-shared-brain/src/memory/ps4RecallContribution.mjs`, `recallEngine.mjs`, `recallSchemaV1.mjs`; `lsa-essential-e1-candidate/src/context/knowledgeRenderer.mjs`, `knowledgeSelector.mjs`, `knowledgeDelivery.mjs`, tests | Shared runner/glue and integration ports |
| **F M5** | `lsa-shared-brain/src/memory/explicitCommands.mjs`, new `m5RuntimeCoordinator.mjs`, new scoped privacy/editor facade module and tests | `m5SqlitePrivacy.mjs` (B), original Essential editor and runner (K) |
| **G M6** | `lsa-shared-brain/src/memory/m6Coordinator.mjs`, `selection.mjs`, `consolidation.mjs`, new cursor consumer module/tests | P2 foundation/store (B), bootstrap (K) |
| **H M7** | `lsa-shared-brain/src/memory/idleCurationScheduler.mjs`, `lunaCurator.mjs`, `lsa-essential-e1-candidate/src/memory/lunaCurationBridge.mjs`, optional new bounded config helper and tests | `curationSqlite.mjs` (modify only via B/K migration contract), central config/bootstrap |
| **I M8** | New `lsa-shared-brain/src/memory/m8*.mjs` interpretation, joke/relationship source-link modules, tests | SQLite/schema and PS4 renderer |
| **J M9** | `lsa-shared-brain/src/events/m9EventProducers.mjs`, `m9MemoryCues.mjs`, `native/intelligence/m9/**`, new cue adapter and harness | Global native registration, existing PS6 sceneDirector files, bootstrap |
| **K Integrator** | Only K may edit `bootstrap.mjs`, `essentialGlue.mjs`, `runSequentialTurn.mjs`, `integrationPorts.mjs`, `intelligenceClient.mjs`, central config `e1Config.mjs`, native global registration, original editor, all combined CI and acceptance documents | Resolve all cross-agent seams |

**Shared-file rule:** A specialist who discovers a required change to K-owned code must deliver a **tested standalone adapter**, exact exported API, and a minimal patch recipe in its handoff—not silently touch it. Agents B/F/G/H coordinate storage APIs as typed fixtures, without concurrent edits to foundation/privacy/curation database code.

## Agent handoffs and branching

All specialists: create `feature/memory-close-<letter>-<topic>-20261011` from `8443a8adec9433626902b46b81bd3e58fc382fb2`; PR base **`integration/memory-completion-h-review-20261011`** (not `main` or this docs-only planning branch); add `docs/plans/promoted-npc-memory/closure-handoffs/AGENT-<letter>.md`. Include exact source SHA, changed files, exported API and fixture contract, tests run/results, schema migrations, remaining native/PS4/K-only edits, evidence gaps, safety-case tests, and deterministic reproducible commands. Push dedicated PR, **do not merge**.

K: after all ten PRs/handoffs, start a new integration branch from the **then-verified** PR #75 head; audit exact code and CI, merge/cherry-pick all ten; fix interface and packaging defects without weakening proof/priority; open a **draft** PR against `integration/memory-completion-h-review-20261011`; publish updated `MEMORY-INTEGRATION-ACCEPTANCE.md`. Require actual combined SHA-specific green CI before claiming offline GO.

## Original M0 ten scenarios — final checklist

S01 exact Unicode/profane quote across reconnect; S02 mundane PS2-witnessed gunfire after PS3 expiry; S03 two observers/no false witness; S04 ambiguous remember two-turn clarification with durable ack; S05 Luna outage still durable deterministic memory; S06 different personality interpretations with immutable facts; S07 timeline rollback freezes writes; S08 <=120s verified same-owner prepromotion; S09 STT mishear and linked correction; S10 PS6 spontaneous callback obeys 10-minute cooldown/player priority. **Offline and physical GTA have separate states.** Do not mark scenario `implemented:true` after a fixture-only partial pass.

See standalone `closure-prompts/AGENT-A-*.md` through `AGENT-K-*.md`. Each is intended to be copied verbatim into its own agent conversation.
