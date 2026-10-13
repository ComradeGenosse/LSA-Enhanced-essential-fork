# Memory K PR #114 — source-level retirement blockers

**2026-10-13 · Read-only source audit**. PR #114 is **OPEN** at `6eb288f5f1d6f02f9db7d2cb959c3a985adc4613`. Compared with Memory K umbrella PR #138 **OPEN** at `a47539cce0d67bd1f33ae6856628522408fa99ce` and separate EA umbrella PR #118 at `6442f6505d414b49c9d4457d980336d423e0b688`. No change to any source PRs, no merges, and no tests executed in this read-only audit.

## Decision

**HOLD #114.** Only 6 of 9 paths exist on #138 and all six have different blobs. The distinct `ea-shared-player-memory.test.mjs`, `EA-MEMORY-UNIFIED-PLAYER-CLOSURE.md` handoff, and `ea-shared-player-memory.yml` are missing from **both** umbrella #138 and the separate EA #118. Although many one-human behaviors are duplicated by #138's five-case regression, unique security and migration cases have not been replaced. Two of the source-level gaps are material; do not close this implementation as fully superseded yet.

## Priority 1 — P2 authority revocation and stale-queue ABA

Original #114 `lsa-shared-brain/src/characters/sqliteProfileStore.mjs` uses `#authorityGeneration`, `#sourceContext` **object identity**, and exact host/timeline checks at admission and inside serialized execution for `withTimelineWrite` and `withP2SqliteRead`. `setVerifiedHostContext(null)`, `onBoundary` and `confirmTimeline` advance the generation. It does not allow an operation admitted under source lifetime A to execute after revocation and re-confirmation, even if native host key and save ID look identical (ABA).

Umbrella #138 `withTimelineWrite` (lines 218–227) and `withP2SqliteRead` (lines 238–245) check current source/timeline in the serialized callback but do **not** snapshot initial source generation or verify it still matches. Existing `m1-source-write-gate.test.mjs` contains a queued-write revocation case, but **does not test revoke → re-confirm same host/save before queue executes**. This distinction should be tested; stale callbacks on a successfully re-confirmed save must not silently execute.

**Required repair on #138:** narrow, additive source-generation or token fencing across admission, queue, and underlying SQLite commit for P2 operations; fail closed on stale read/write admission without invalidating unrelated healthy operations. Test write/read queue with a held preceding operation, revoke, restore same source and same timeline, then release queue; both stale jobs must reject even though fresh jobs succeed. Confirm new incarnation/change-of-world and hostile source rebind cases. Do not revert newer #138 source/SQL/schema protections.

## Priority 1 — Integrated recall does not use the source-fenced P2 read API

#114 `readIntegratedRecall(query)` uses `withP2SqliteRead(query?.scope, ...)` to enforce a live source+timeline+NPC fence at read execution time.

#138 `readIntegratedRecall(query)` (lines 399–404) calls `initialize()` then `#serial(()=>this.#db.readIntegratedRecall(query))`, **omitting** `#assertMemoryScope` and `timelineWritable`. The foundation-level `readIntegratedRecall` dispatches to the SQLite query/recall projection and does not have host-session confirmation state. This is a concrete authorization behavior difference. #138 can expose archived recall after native-source revocation where #114 would fail closed. It must be corrected **with a new read-boundary test** so source revoked/wrong timeline/wrong NPC cannot return previously authorized evidence. Do not confuse testing a SQL scope (world/character/timeline) with testing authorization of *current* host.

## Priority 2 — confirmTimeline source authority and harmless host reload

#114 requires `confirmTimeline(timelineId,{confirmation})` with `confirmation===timelineId`, and rechecks accepted `#sourceContext` and generation in the queued commit. #138 exposes `confirmTimeline(timelineId)` without an explicit confirmation token and uses current source at commit; a direct caller could request reauthorization without a separate explicit agreement proof. Decide the true API trust boundary in the native/editor caller and protect it. **Do not directly cherry-pick #114's `onBoundary`: it revokes for every `host_reload` whereas #138 deliberately treats harmless host reloads as non-suspending**, documented in `m1-world-epoch-bridge.test.mjs` (test 94–102). The right fix retains that lifecycle distinction but fences genuine disconnect, save fork, regression, source lifetime and confirm operations.

## Priority 2 — v1 replay cursor migration policy

#114 `p2ReplayCursor.mjs` validates a correctly scoped historical v1 avatar cursor and **rewinds to zero** before minting a new per-human v2 cursor, avoiding skipped evidence that a sibling avatar introduced. #138 `decode` only accepts canonical v2, rejects valid v1 tokens. Neither automatically proves a safety flaw, but valid opaque v1 persisted consumers may fail instead of migrating. #138 `memory-unified-player-avatars.test.mjs` tests rejection of **an invalid v1 token**, not the valid v1 legacy token or its no-skip migration. Product decision needed: safe validated v1 rewind vs explicit migration error and reset. Never carry a v1 per-avatar highwater directly into mixed-avatar scope; reject forged/wrong-scope tokens. Test the selected policy with interleaved player events, restart, stale/forged tokens, and no cross-NPC timeline leak.

## Unique missing tests, documentation, and CI

Original `lsa-essential-e1-candidate/tests/ea-shared-player-memory.test.mjs` contains **6 real SQLite cases**:
1. shared original dialogue/permanent memory across Franklin/Michael/Trevor plus source provenance;
2. valid old per-avatar v1 cursor safe rewind/new shared checkpoint;
3. M5 cross-avatar privacy and revoked-timeline read suspension;
4. M7 mixed-source deterministic curation with `multi_avatar` provenance;
5. whole-scope trash + independent cross-avatar restore;
6. persisted recall after restart only after new explicit save confirmation, with NPC/timeline isolation.

#138 retains overlapping five-case `lsa-shared-brain/tests/memory-unified-player-avatars.test.mjs` from #115, but those do not exactly cover valid v1 migration, source-revoked `readIntegratedRecall`, or whole-scope trash/reopen protections from #114. Port missing cases to **the current APIs**; do not drop them due to filename similarity. The original tests have not been executed on #138.

Archive the **3 original Git blobs** from #114 to a clearly inactive `docs/plans/promoted-npc-memory/archive/pr-114-20261012` tree, including the EA-specific handoff and workflow manifest. Keep archived workflows outside active `.github/workflows`; integrate necessary Windows+Ubuntu Node24 tests through live discovery/CI. No original source file should be overwritten by the historical #114 version.

## Actual original CI receipts

Original #114 EA Memory Shared Player V4 Acceptance workflow run [38247619211](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38247619211) completed **SUCCESS** on tested source commit `300c033d844f1cc1f3939e00a2507d22e31cf410`. #114's PR tip `6eb288f` is a subsequent documentation commit, not the tested SHA. This is evidence for #114's own source, **not** a passing integrated #138 test receipt or GTA acceptance.

## Implementation work order and retirement criteria

1. Preserve three unique #114 blobs and source hash metadata (without activating obsolete EA CI).
2. Implement bounded, explicit native/source generation revocation and source-fenced integrated recall on a **new repair branch starting from current #138**, retaining modern #138 constraints, current test semantics and the harmless-reload requirement.
3. Adopt and test an explicit confirmation authority contract and a versioned v1 replay-token migration policy. Reject forged v1 tokens; no silent page skip.
4. Port/replace six meaningful EA/P2 tests, run targeted + M1 world-epoch + M5 privacy + M6 cursors, Node24 Windows/Linux and appropriate EA/G suites on **the actual new branch SHA**.
5. Reconcile with EA umbrella #118 separately; when the unique functionality and coverage are proven on #138 (or an explicitly integrated replacement PR), then **close #114 administratively without merge**, retaining source branch and historic archive.

**Verdict:** #114 is not safe for immediate closure as fully superseded. Memory K source/offline/native/controlled GTA release status is not changed by this audit.
