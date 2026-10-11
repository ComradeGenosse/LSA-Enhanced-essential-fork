# Memory Closure Agent B — P2 SQLite writer, replay, privacy

**Delivery:** draft PR [#83](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/83), branch `feature/memory-close-b-p2-sqlite-20261011`, **base** `integration/memory-completion-h-review-20261011`. **Exact immutable source:** PR #75 at `8443a8adec9433626902b46b81bd3e58fc382fb2`. **Final implementation code checkpoint before this handoff:** `a0901a1dd61d2876c0e5d1715435982432f0fce5`. The final handoff commit itself changes the PR head; integrator K must pin/review PR #83's actual `head_sha` (and CI) rather than assuming a document can contain its own content-addressed SHA.

**Scope and limits:** Agent B-owned P2 files only; no edits to Essential glue, runner, bootstrap, editor, global native registration, PS4, M6, M7, integrationPorts, central CI, or other specialists. This is not a GTA build/install, controlled physical acceptance, live Luna provider test, PS4 admission, or main merge.

## Delivered working source

1. **Single mutable SQLite writer**: `m5SqlitePrivacy.mjs` no longer constructs `DatabaseSync`, holds a mutable DB handle, or commits independently. `createM5SqliteServices({store,filePath,clock,authorize})` now routes all scoped M5 reads through `store.withP2SqliteRead` and all writes/DDL/legacy tombstone reconciliation through `store.withTimelineSqliteWrite`. Both share the *original* `P2SqliteFoundation` connection, one serialized queue and current owner/world/timeline/native-source fence. Nested P2 transactions use SQLite SAVEPOINT and exact rollback; synchronous callbacks only. P2 rechecks owner and verified epoch **inside the transaction immediately before COMMIT**. Closing the M5 facade never closes P2's DB.
2. **Durable replay, no 1,000-row silent cutoff**: `p2ReplayCursor.mjs` introduces an append-only SQL feed of each accepted dialogue insert and journal-event insert/updated envelope, with idempotent backfill of preexisting M2/M3 records. Bounded keyset pages (`1..512`) are indexed by stable SQLite insertion sequence, not clock-order or OFFSET. Source-qualified witnessed events require the original M3 verified sidecar, otherwise emit a `rejected` diagnostic, not a witnessed memory. Tombstoned or superseded sources and recursively dependent IDs are immediately `skipped` before delivery (not represented as facts). Durable cursor acknowledgements are compare-and-swap, idempotent across retry, source/timeline scoped and committed only after the downstream consumer explicitly reports its own durable processing.
3. **Scoped privacy**: M5 clarifications, archive export, trash, restore and authorized seven-day purge use P2's transaction owner. Scope-wide trash also invalidates pending frozen alternatives. Physical purge removes dependent memories, commands, curation jobs, appraisals and replay-feed pointers; unresolved or expired source evidence cannot reappear through this P2 replay port. Normal trash retains immutable provenance until authorized purge. Explicit confirmed character unpromotion now removes M5 and replay tables within the P2 profile CAS transaction, preserving legacy global profile CRUD.
4. **Profile parity**: Original editor CRUD, migration from v1 profile JSON with original backup, integrity hash, `exportRollbackSnapshot()`, writer-lock CAS, WAL, existing archive and rollback behavior remain on the same P2 store. An invalid schema version or journal hash fails closed.
5. **Mock contract**: `tests/fixtures/memory-b-p2-ports.mjs` exports `P2_MEMORY_PORT_V1` and `createMockP2ReplayPort({scope,pages})` for F/G/H/K offline consumers. **This mock is not a native witness/source, SQLite implementation or physical GTA receipt.**

## Exact exported real P2 ports (trusted internal code only)

Import `createP2MemoryStorage` from `lsa-shared-brain/src/characters/sqliteProfileStore.mjs`. A valid P2 store must already have an existing promoted CharacterId, verified host run and epoch, and explicitly confirmed active TimelineId. `scope = {worldProfileId,characterId,timelineId,protagonistKey}`; `protagonistKey` must be exactly `unknown`, `franklin`, `michael` or `trevor`. **No guessing a protagonist from names, model output or actor metadata.**

| API | Input / return | Safety |
| --- | --- | --- |
| `await store.readCommittedEvidencePage({scope,cursor=null,limit=256})` | `{version:1,scope,fromCursor,cursor,lastSequence,scannedCount,items,rejected,skipped,hasMore,status}`; `items` include `{kind:'dialogue'|'event',sequence,recordId,envelope}` and events include `sourceEvidence` | Max 512 scanned entries; `cursor` opaque, source-bound; unverified native events appear in `rejected`; tombstones/corrections in `skipped` |
| `await store.readCommittedEvidenceCursor({scope,consumerId})` | `{cursor,lastSequence,consumerId}` | Durable per consumer, character, world, timeline and protagonist; never infer active owner from stale scope |
| `await store.ackCommittedEvidenceCursor({scope,consumerId,cursor,expectedCursor})` | `{committed:true,idempotent,cursor}` | CAS write gated at commit; `expectedCursor` from the preceding durable cursor read, never acknowledge unprocessed evidence |
| `await store.withP2SqliteRead(scope,db=>syncValue)` | Synchronous read on P2 DB | Privileged internal migration/service API, not IPC/network/editor API |
| `await store.withTimelineSqliteWrite(scope,db=>syncValue)` / `withP2SqliteTransaction` | SQLite transaction result, or propagated error and rollback | Single writer, no await or recursive queued-store invocation inside callback |
| `createM5SqliteServices({store,filePath:store.filePath,authorize,clock})` | `ready`, `bindCommands`, `inspect`, `exportArchive`, `writeArchive`, `trash`, `trashScope`, `restore`, `purgeExpired`, `verifyPrivacy`, `close` | Every operation requiring consent must receive actual verified `authorize({scope,operation})===true`; tests use an explicit stub only |

A cursor can represent a page whose raw sources are *deliberately omitted* because they were forgotten or lacked witness sidecars. Consumers must log/handle `rejected` and `skipped` separately; neither is a certified native negative observation. A cursor is not a memory save receipt.

## Integrator K — required edits outside B ownership

- **M6**: Replace `m6Coordinator.mjs`'s latest-N `readCommitted` and `m6_journal_replay_window_exhausted` strategy with the three real paged cursor ports above. Replay each explicitly source-verified protagonist stream separately; scan every `hasMore` page; do not advance the durable cursor until deterministic saves and optional durable queue handoff succeed. Revalidate suppressed evidence at selection and before PS4 send; do not acknowledge failed or unreported evidence as processed. Restore cursor after reconnect **only after** native owner/source confirmation and timeline selection. The legacy `maxRead=1000` call still exists in unowned M6 and does **not** auto-consume this B API.
- **M5/UX**: Construct the M5 facade using the P2 store object and authenticated, explicit player authorization. Hook accepted source-qualified M2 memory actions *before Luna*, preserve clarification command IDs, and publish receipts only after SQLite commit/readback. Hook inspect/export/trash/restore/purge to the trusted original editor; don't hand a raw P2 SQLite callback to the HTTP/editor or AI model.
- **M7/H and PS4**: Revalidate source links against P2's suppression/correction state when claiming/committing queued cloud appraisals and when sending the existing PS4/C-04 knowledge frame. Immediate deletion means no derived/joke/curation resurrection; storage filtering alone doesn't retract already formed model prompts. Original PS4 remains **one knowledge frame**.
- **A/D/J/native**: The real synchronous native promoted owner/protagonist/witness/negative certification is still missing from PR #75. The DB has no authority to infer a witnessed event or a protagonist. PS6 memory callbacks must still pass player/Director priority, source and cooldown gates.
- **Run/packaging**: Node 24 Windows/Linux full combined suite, tests below, pinned native harness and final GTA physical scenarios separately. Never merge to main/install or start paid Luna under this PR.

## Additive schema and migration implications

- **No second file, daemon, cache DB, local AI, or mandatory embeddings.** Original P2 SQLite file remains the only authority.
- Existing PR #75 `PRAGMA user_version=4` is retained; additions are compatibility-preserving tables `m5_clarifications`, `m5_trash`, `m5_privacy_ops`, `p2_memory_replay_feed`, `p2_memory_replay_cursors`, indexed feed scope, and dialogue/event triggers. The entire additive creation/backfill runs transactionally under P2's writer lock; source v1 JSON backup and profile snapshot bytes are not rewritten.
- Because additive tables **do not bump user_version**, any future schema owner must audit actual table/trigger presence and explicit compatibility before assigning v5. Unknown future versions are rejected before migration, including `user_version=999`. A legacy binary that lacks these additions should not be used to write memory rows after migration without a separately approved downgrade procedure.
- Character deletion transaction removes the new per-character rows; privacy trash retains source until seven-day authorized purge and does not claim to delete external exported JSON, old backups or copied game saves.

## Tests / evidence

New real DB tests: `lsa-shared-brain/tests/memory-b-closure.test.mjs` (imported by `memory-integrated-storage.test.mjs`, which the existing combined CI executes). These cover **2,101 exact accepted Unicode lines**, bounded cursor CAS/restart/replay and cross-protagonist rejection; 20 pending concurrent writes; exclusive writer busy/reopen; nested SAVEPOINT abort; missing event sidecar; immediate M5 suppression and seven-day purge; explicit authorization/foreign-protagonist scope; physical record removal; native write revocation queued and within the transaction before COMMIT; corruption detection and migration rejection; v1 rollback export. The preexisting M5 suite covers durable clarification, restoring within seven days, expired choice, superseded/tombstone and derived-memory suppression; preexisting M7 suite covers lease expiry/reclaim and cross-owner queue behavior.

Reproducible commands (repository root, Node 24 with `node:sqlite`):

```sh
node --check lsa-shared-brain/src/memory/p2ReplayCursor.mjs
node --check lsa-shared-brain/src/characters/sqliteFoundation.mjs
node --check lsa-shared-brain/src/characters/sqliteProfileStore.mjs
node --check lsa-shared-brain/src/memory/m5SqlitePrivacy.mjs
node --test lsa-shared-brain/tests/memory-b-closure.test.mjs
node --test lsa-shared-brain/tests/memory-integrated-storage.test.mjs lsa-shared-brain/tests/memory-m5-completion.test.mjs lsa-shared-brain/tests/memory-m6-sqlite.test.mjs lsa-shared-brain/tests/memory-m7-completion.test.mjs
```

**Observed GitHub checks at earlier code heads (not fabricated local runs):**
- Exact SHA `f76c3ae321879fcda60a286005599037060a6446`: seven original PR workflows completed **success**, including combined Windows/Linux Node 24 and M5, M6/M7, portability (this was **before** the B suite was imported).
- Exact SHA `f2849ab636ee9751cb17c0598d8c365111318e8b`: combined Windows Node 24 job `114601731333` completed **success** with eight listed `B:` test cases, including 2,101-record replay; combined Linux and some parallel workflows were still in progress when reviewed. Job [logs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38183799589).
- **This handoff's later B code checkpoint `a0901a1dd61d2876c0e5d1715435982432f0fce5` has NOT yet been certified by a completed exact-head combined run** at handoff drafting time. Recheck PR #83's final head and all checks; don't upgrade to offline GO on prior-head results.

**Remaining limitations:** K-owned M6/PS4/editor/native links remain unresolved. No negative-witness certification without actual native proof. The mock is fixture-only. No physical GTA acceptance, 4h/3-NPC soak, live paid provider call, main merge or deployment occurred.
