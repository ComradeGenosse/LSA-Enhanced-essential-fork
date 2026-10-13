# Memory K PR cleanup — Wave 7: cross-avatar PRs #114 and #115

**Date:** 2026-10-13 · **Read-only code audit** · **No PR closed, no merge, no code or tests executed.**

**Compared immutable source heads:** [#114](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/114) `6eb288f5f1d6f02f9db7d2cb959c3a985adc4613`; [#115](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/115) `073094a8c13d323cb9e1b0f8054aba86b03a09d1`; canonical [Memory K #138](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/138) `a47539cce0d67bd1f33ae6856628522408fa99ce`.

## Disposition

| PR | All changed paths in #138? | Exact Git blobs | Conclusion |
|---|---|---:|---|
| **#115** — shared player identity across three avatars | **27/27** | **8/27**; 19 further modified | **Candidate for safe administrative closure** after unchanged-head check. The 19 revisions were inspected at the production-source and test-suite level; newer safety changes supersede rather than require reintroducing the original variants. All five cases in the byte-identical `memory-unified-player-avatars.test.mjs` are retained. Preserve source branch, closed-without-merge comment, and retain independent held repairs (#99/#100/#104). |
| **#114** — EA G-based shared-player memory | **6/9**; 3 unique files absent | **0/9** | **HOLD; not safe to close as equivalent**. Apart from missing tests/EA handoff/workflow, source has meaningful safeguards and migration semantics missing from #138. Base is a separate EA repaired G line, so EA/Memory ownership must be explicitly reconciled. |

## #114 missing files (retain before any retirement)

1. `lsa-essential-e1-candidate/tests/ea-shared-player-memory.test.mjs` — **six real P2 SQLite cases**: dialogue/permanent memory across three source avatars, valid legacy v1 avatar cursor rewind, cross-avatar forget/restore + save boundary, mixed-avatar deterministic `multi_avatar` curation, whole-scope deletion and restore, and restart with fresh save authorization and NPC isolation.
2. `docs/handoffs/EA-MEMORY-UNIFIED-PLAYER-CLOSURE.md` — EA G ancestry, hashes, CI history, source guarantees, native and GTA caveats.
3. `.github/workflows/ea-shared-player-memory.yml` — Node 24 Windows+Ubuntu matrix for the six tests and EA/G suite. If archived, place under `docs/.../archive` instead of active `.github/workflows`. Restore equivalent **active** test discovery only after tests are ported and verified.

## Source-level differences that block closing #114

**A. P2 source-generation/ABA fence present in #114 but absent in #138.** In `lsa-shared-brain/src/characters/sqliteProfileStore.mjs` #114 has an `#authorityGeneration` revocation counter. `setVerifiedHostContext(null)`, `onBoundary`, `confirmTimeline`, `withTimelineWrite`, and `withP2SqliteRead` capture/check this generation and exact `#sourceContext` across asynchronous queue admission. The #114 queued-write/read path rejects operations initially admitted before a disconnect/fork/host change, even if the store is subsequently re-confirmed to the same timeline (preventing an ABA permission resurrection). #138's `withTimelineWrite` and `withP2SqliteRead` check present scope/authority after the queue, but do not snapshot/recheck admission generation; `onBoundary` has fewer explicit revocation reasons. **Do not claim a proven exploit** until a deterministic queued-operation test is run; this is a concrete missing defense needing adversarial reproduction or demonstrated equivalent protection elsewhere.

**B. Explicit confirmation contract differs.** #114 `confirmTimeline(timelineId,{confirmation})` rejects missing or mismatched `confirmation!==timelineId` and rechecks generation/source inside queue. #138 `confirmTimeline(timelineId)` has no equivalent argument and may set `#confirmedSource` from a current native context. Confirm the caller's privileged UI boundary and D-021/D-023/C-13 contract before choosing which semantics to retain; tests must prove untrusted/direct model/JS callers cannot activate writes.

**C. Old cursor migration behavior differs.** #114 `p2ReplayCursor.mjs` validates a genuine v1 per-avatar cursor digest, then **rewinds to zero** rather than carrying its offset into a mixed-avatar feed (prevents skipping another avatar's events). #115/#138 `decode` accepts only canonical v2 tokens and rejects v1. #138 separately keeps legacy v1 database rows and has M6 migration tests; that does **not** prove a persisted old opaque replay cursor is handled the same way. Decide deliberate v1 rejection versus safe rewind and add an explicit authenticated legacy-token regression. Reject forged/mismatched v1 tokens either way.

**D. Unique scope-delete and restart tests.** #138 has a byte-identical #115 regression suite (`lsa-shared-brain/tests/memory-unified-player-avatars.test.mjs`, five cases), plus some overlapping privacy/cursor/recall tests. It does **not** retain #114's exact six E1/P2 integration cases. Port equivalent coverage or demonstrate tests that specifically prove cross-avatar `trashScope`, fresh confirmation on reopen, and selected old-cursor behavior.

**E. EA lineage.** #114 targets `fix/ea-final-g-completion-audit-20261012`, not #138/main. Preserve its G/EA compatibility regression list and evaluate in consolidated EA integration, rather than treating a Memory K source-only path comparison as approval to retire the EA branch.

## #115 source and tests assessed

- All **27 changed paths** are present. **Eight exact** source/test/workflow files: `.github/workflows/memory-unified-player-avatars.yml`, `lsa-essential-e1-candidate/tests/memory-m4-closure.test.mjs`, `lsa-shared-brain/src/memory/{consolidation,recallEngine,sqliteRecallReadAdapter}.mjs`, `lsa-shared-brain/tests/{memory-b-closure,memory-m4-recall,memory-unified-player-avatars}.test.mjs`.
- Nineteen paths are later modified. Production diffs inspected include `sqliteFoundation.mjs`, `integratedSqlite.mjs`, `curationSqlite.mjs`, `m5SqlitePrivacy.mjs`, `m5ScopedPrivacyFacade.mjs`, `explicitCommands.mjs`, `fixtureMemoryCommandStore.mjs`, `integrationPorts.mjs`, `m8Interpretation.mjs`, `p2ReplayCursor.mjs`, `sqliteIntegratedRecallProjection.mjs`, and `selection.mjs`. Legacy/new key ownership is unified by NPC+world+timeline, while old native avatar provenance is retained.
- Important later tightening: cross-avatar scene grouping now demands matching native epoch and owner lifetime rather than treating missing evidence as a match; M5 clarification reply is authorized from a new accepted line with original request provenance retained; privacy writes and deletion have revised idempotency/suppression; P2 replay cursor ack is additionally bounded; verified event and dialogue source intake has stricter evidence requirements.
- Named test inventories: `m5-explicit-memory-commands` 20 originals retained and one additional; `memory-integrated-storage` 10/10; `memory-m5-closure` 12/12 names plus one negative; `memory-m5-completion` 10/10; `memory-m6-completion` 9/9 plus 3; `memory-m8-closure` 15/15 plus 3. M7 suite retains 22 of 23 original names and replaces pricing-estimator test with a stronger explicit durable approval/budget-before-fetch test, plus pagination coverage. Specific changed assertions in M5 reflect revised atomic/fail-closed acknowledgment behavior.
- **Caution:** Source comparison is not a full acceptance test or proof every nuanced behavior is identical. Closing #115 as administratively superseded must **not** close/open/retarget #114 or unresolved security/consent/cursor/purge repair branches; do not merge to main.

## Next steps

1. **#115 is the sole administrative closure candidate from this wave.** Recheck both PR tips and #138 tip before comment and close; leave all branches intact.
2. **Hold #114.** Port its E1/P2/EA six tests (or functionally equivalent targeted tests), preserve its unique handoff and workflow history, and review/restore its source-generation revocation, explicit confirmation and old-v1-cursor policies with regression tests.
3. Keep #99/#100/#104, D02 #117/#130 and repairs #139–#143 open. Do not assert production or controlled GTA readiness based on either PR.

Reviewed solely by fetching pinned GitHub source and comparing test declarations/implementation fences. No unit, CI, Windows, native, or GTA execution performed.
