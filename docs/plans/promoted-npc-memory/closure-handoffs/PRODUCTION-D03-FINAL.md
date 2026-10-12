# Agent C — D03 original dialogue and atomic P2 source join

> **Status update - 2026-10-12 (same draft PR).** D03 is now wired to a positive D01 source for the OpenAI provider and to a real original-turn actor ledger (`memorySourceLedgers` was never defined). Added fences: a receipt-source allowlist selected by the verifier pin, a P1 binding to D02 incarnation cross-check, a bounded wait for a D02 owner sample newer than the lease (G1 ordering kept; adds up to one native sample interval before the model request), and a native-loss retry that never weakens the in-transaction proof. After acceptance the receipt, not the turn, governs validity (memory plan section 5.5): a line accepted before an interruption is still written; session close, identity retirement, disconnect, source-run/host/world change and D02 actor or player change still revoke before COMMIT. OFFLINE TESTED only; S01-S10 and GTA acceptance remain open.

2026-10-12. DRAFT PR #131. **A01/D01/A09/A10 remain NO-GO.**

## Source and branch

- Original K parent: PR #128 branch integration/memory-k-final-source-closure-20261012, exact base e372841918a389b2fc194ff62a84c6eec3107fa0.
- Agent A D01: PR #129, fix/memory-k-d01-original-backend-acceptance-20261012, SHA da6670222cee1a74950bedaad30d3072f0989931. Handoff PRODUCTION-D01-FINAL.md.
- Agent B D02: PR #130, fix/memory-k-d02-native-owner-integration-20261012, SHA 2acd8fc6bb0226d0f535c462aa41967e3ab526ce. Handoff PRODUCTION-D02-FINAL.md.
- Agent C D03: branch integration/memory-k-d01-d02-d03-complete-20261012, draft PR #131 targeting PR #128's head. A and B changes integrated in b3d501ba5267875df777820ce681c86c4af26451 with no conflicting files.
- D03 implementation: lsa-essential-e1-candidate/src/memory/d03OriginalDialogueJoin.mjs, wired in src/integration/essentialGlue.mjs.
- D03 unit tests: lsa-essential-e1-candidate/tests/memory/d03OriginalDialogueJoin.test.mjs, with dedicated .github/workflows/memory-k-d03-atomic-join.yml.

## Actual implementation

**D01 imported, source-blocked.** The pinned original backend lacks a verifiable post-acceptance typed/STT transition. The originalBackendAcceptedInput source declares acceptedSourceHookAvailable:false; its verifyAccepted() returns null and hasAuthenticatedSource() returns false. Original typed submission, mutable STT input_transcript, history.commitPlayerInput, provider completion, and replay timestamps are NOT independent final acceptance. D01 source verification may not be replaced with a new fabricated callback.

**D02 imported.** Native original owner-fiber SampleMemoryCurrentOwnerPlayer() registration and authenticated intelligence pipe v1 source require real current player/NPC identity. Private runtime.memoryD02 exposes preturn lease binding, current corroboration and revocation. D02 proves CURRENT ownership, NOT accepted input. Its native production net481 build is blocked on pinned RPH, DamageTracker and original Essential references.

**D03 original source join implementation.** The join is inert on the actual pinned original source and never requests native leases or writes SQLite in that case. For a future independently source-authenticated original acceptance issuer, D03 requires (a) backend.hasAuthenticatedSource and a positive pinned build capability; (b) private original Core actor association at turn start, before STT/provider work; (c) authenticated D02 preturn lease and a matching newer native sample; (d) exact accepted final typed/STT bytes/hash/length and monotonic revision, ped/turn/generation/session identity, source run/revision/binary, timestamp and retirement identity; (e) same NPC character/owner alias, incarnation/encounter, player capture, live world/host epoch and P2 timeline.

The existing runSequentialTurn binder after turn hydration but before STT is now routed through this D03 join. An original Core actor association is NOT currently exposed; the module will not guess it from a JavaScript ped ID, nearby ped, model context or user text.

D03 uses the ORIGINAL P2 store's withP2SqliteTransaction scope. The source is checked before the queue, again INSIDE the single serialized transaction, and again after append before COMMIT. The existing P2 v4 appendDialogue schema/unique-turn/content hash is used. A memory_d03_accepted_sources JSON/hash sidecar is inserted under that very same SQLite transaction and connection, keyed by actual player dialogue recordId. Conflicting replay/provenance or source revocation rolls back both the dialogue and source sidecar. Independent P2 queued readback verifies content/hash/delivery and sidecar/hash before returning durable:true. An INSERT acknowledgement alone never grants M5 authority. The return preserves one human player scope with avatar as historical provenance.

No second SQLite writer, no new accepted native message, and no success based on synthetic actor or source flags is added to real production.

## Verification and CI

The new tests deliberately separate real pinned-D01 negative checks from clearly labeled UNIT synthetic ports. The contract tests run against the real P2 SQLite storage code, but fixture backend/native receipts are NOT independent original GTA events. Four D03 cases test:
1. Pinned D01 yields no actor lease and zero P2 writes.
2. Exact UTF-8/profanity, P2 transaction/sidecar/readback, and duplicate exactly-once under unit source fixtures.
3. D01, D02, avatar, final revision and source-retirement denial without overwriting committed records.
4. Revocation AFTER both SQLite inserts but BEFORE COMMIT rolls back both records, including no orphaned source table. Successful new source can retry.

CI run https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38268618659: Ubuntu Node24 and Windows Node24 D03 source contract jobs BOTH PASSED on the source commit immediately preceding this documentation. It also executes 11 pinned D01 original source negative tests per OS. Original S01–S10 A10 gate is separate and necessarily fails closed. Inspect PR #131 for the exact final head and its rerun before asserting full CI completion.

All original S01–S10 positive production acceptance remains **0/10**. The prior 205 dialogue and 2501 PS2 event fixture stress and forgery-receipt tests remain unmodified.

## S01–S10 disposition

| Scenario | Current status | Missing original evidence |
|---|---|---|
| S01 exact Unicode/profanity after reconnect | SOURCE BLOCKED | Original final accepted typed text, original actor association, authenticated native join |
| S02 3+ minute mundane firing recall | SOURCE BLOCKED | Authenticated original native witness and original PS4 recall |
| S03 different two NPC witnesses | SOURCE BLOCKED | Actual two independent native witnessed events |
| S04 clarification | SOURCE BLOCKED | D01 accepted command and M5 runtime dispatch |
| S05 offline recovery/curation | SOURCE BLOCKED | Original native idle, durable settings approval and full integrated runtime |
| S06 NPC-specific opinions | SOURCE BLOCKED | Original PS4 merged source-bound interpretation |
| S07 save rollback | SOURCE BLOCKED | Original native rollback evidence and source retirement |
| S08 prepromotion grace | SOURCE BLOCKED | Actual native prepromotion identity reservation |
| S09 corrected STT | SOURCE BLOCKED | Original final accepted/corrected STT revision. D03 rejects same-turn source rewriting |
| S10 original Director | SOURCE BLOCKED | Actual original Director priority grants, PS2 witness and playback proof |

## Remaining work and restrictions

1. The original pinned backend must expose a genuine final accepted-input event with immutable source text/revision and revocations; D01 currently does not. The original Core must independently associate actual numeric actor ped with that turn BEFORE original acceptance. These are missing source capabilities, not repairable by a mocked positive receipt.
2. D03 cannot yet deliver positive original accepted P2 lines or M5 commands. It is a future-source-gated implementation only. Connect actual original Core preturn actor ownership and post-acceptance source when genuinely proven, then extend source-backed M2/W03 completed NPC playback and M5 dispatch.
3. Native packaging remains blocked on genuine original references. The real GTA/RPH build, authorized installation, physical player/NPC source evidence, and original S01–S10 replay have NOT passed.
4. Do not mark tools/memory-sim/scenarios.v0.json implemented:true, merge main, claim real GTA production acceptance, change source verifier to trust caller-supplied hashes/flags, or use paid Luna calls to mask absent source contracts.

**Final verdict: D01+D02 imported; D03 atomic implementation and source-negative tests completed. Production acceptance remains A01/A09/A10 NO-GO pending original accepted backend event and original actor/native registration proof.**
