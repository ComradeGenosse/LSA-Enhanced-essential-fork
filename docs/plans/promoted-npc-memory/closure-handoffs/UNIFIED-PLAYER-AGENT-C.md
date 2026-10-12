# Agent C — One-player M6/M7/M8 replay, curation and relationship handoff

**Branch:** `fix/unified-player-memory-agent-c-replay-relationships-20261012`  
**Draft PR:** [#121](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/121)  
**Exact baseline:** PR #115 / `073094a8c13d323cb9e1b0f8054aba86b03a09d1`  
**Disposition:** DRAFT / NO-GO for GTA installation, main merge, or original native acceptance.

## Applied code fixes

- `p2ReplayCursor.mjs`: the cross-avatar v2 cursor still keys exclusively by existing verified world/timeline/NPC owner, while dialogue replay now refuses a feed provenance mismatch against original committed protagonist. Event rows must still be `unknown` historical attribution. The v2 compatibility ack refuses a jump larger than one bounded 512-entry feed page. Original legacy v1 per-protagonist rows stay untouched; none is collapsed to a dangerous maximum.
- `selection.mjs`: Franklin/Michael/Trevor may group together when independently sourced native epochs/owner lifetimes agree. A source missing host/lifetime proof cannot silently bridge a proved scene. `consolidation.mjs` already uses shared owner scope and was inspected but not changed: overlap of immutable evidence IDs remains required; no fuzzy text-only merging.
- `curationSqlite.mjs`: enqueue now rechecks current scoped source authorization and suppression (not source protagonist equality). M7 appraisal reads page past suppressed/tombstoned/corrected newer rows before enforcing the visible result limit, including on restart. Original curation consent/idle/budget gates are unchanged.
- `m8Interpretation.mjs`: duplicate committed memory IDs are rejected instead of overwriting one relationship across avatar reads. Relationship source IDs now include every contributing interpretation (including familiarity/jokes), not only gratitude. Source opinions remain separate from immutable facts and canonical personality.

## Regression coverage

- `memory-m6-completion.test.mjs`: real P2 SQLite, interleaved Franklin/Michael/Trevor accepted lines, original source provenance, legacy v1 cursor coexistence, v2 replay/ack/idempotency/restart and poisoned replay feed.
- `memory-m7-completion.test.mjs`: real SQLite older valid appraisal behind a newer cross-avatar tombstone, limit=1 and reopen, plus suppressed curation enqueue veto.
- `memory-m8-closure.test.mjs`: real P2 SQLite three-avatar friendship/joke continuity, restart and distinct NPC/world boundaries; duplicate memory identity refusal.

Run on Node 24 from repo root:

```sh
node --check lsa-shared-brain/src/memory/p2ReplayCursor.mjs
node --check lsa-shared-brain/src/memory/curationSqlite.mjs
node --check lsa-shared-brain/src/memory/selection.mjs
node --check lsa-shared-brain/src/memory/m8Interpretation.mjs
node --test lsa-shared-brain/tests/memory-m6-completion.test.mjs
node --test lsa-shared-brain/tests/memory-m7-completion.test.mjs
node --test lsa-shared-brain/tests/memory-m8-closure.test.mjs
node --test lsa-shared-brain/tests/memory-unified-player-avatars.test.mjs
```

**Verification:** GitHub Actions Node 24 Ubuntu/Windows exact-head runs were queued/in-progress when the draft was initially opened; confirm job conclusions and log lines against the **latest** PR #121 commit before claiming a pass. The local container cannot clone the connected repository; do not claim local tests ran. CI workflow status and any remaining failures belong in a PR follow-up.

## T6 integration — explicit contract conflict

T6 PR #100 is a **different, stronger production M6 cursor**. It introduces `m6P2ReplayAdapter.mjs`, `readM6Checkpoint/readM6JournalPage/ackM6Checkpoint`, durable `m6_p2_checkpoints`, source-hash receipts and SQLite transaction-bound save/queue CAS. This PR retains PR #115's separately owned per-consumer `readCommittedEvidenceCursor/Page/ackCommittedEvidenceCursor` compatibility cursor (`p2_memory_replay_player_cursors`) for nonproduction readers.

- **Do not swap** T6's `ackM6Checkpoint` for this PR's `ackCommittedEvidenceCursor`, or treat the latter as atomic M6 production acceptance.
- T6 changes `lsa-shared-brain/src/characters/sqliteFoundation.mjs` and `sqliteProfileStore.mjs`; PR #115 also touches the former to clean up `p2_memory_replay_player_cursors`. K integrator must preserve *both* v2 cleanup and T6's `m6_p2_*` cleanup when reconciling those exact files, and register both schemas on the **same P2 connection**. T6 does not import this PR's new cursor directly.
- T6 consumes the shared `p2_memory_replay_feed` containing every avatar. It must preserve append sequence and recorded source protagonist; no per-avatar max cursor migration.
- The v2 compatibility cursor still lacks T6's independently persisted source-hash/save/queue receipts; it cannot certify original M6 end-to-end replay.

## Residuals / handoff to integrator

- M8 relationship scores and running jokes are recomputed from the **bounded authenticated source set** supplied by K. Cross-avatar SQL/query wiring must supply all historical protagonists for that same world/NPC/timeline. This branch does not invent an unlimited durable M8 relationship ledger or claim friendship cannot decay when qualifying source rows fall outside a 128-source projection; that is an integration/design limitation to address separately if long-horizon relationship stability is required.
- Neither memory replay nor M8 pure projection proves original native accepted C-01 turns or source-time PS2 witnesses. Independent D01/D02, T6 source-bound acceptance, and S01–S10 original native tests remain NO-GO gates.
- Do not merge T6 or other K branches automatically; no Agent A M4 storage/recall, Agent B M5 commands/privacy, or umbrella test `memory-unified-player-avatars.test.mjs` edits were made.
