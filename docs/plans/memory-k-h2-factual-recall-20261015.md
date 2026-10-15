# Memory K H2 — independent M4 factual recall preparation

Goal: an independently callable, source-authenticated M4 factual-recall preparer that reuses the existing M4/P2/G3–G5/PS4 contracts and needs none of H1 conversation context, M5 commands, M6/M7 curation, M8 interpretation, PS3 salience or live M3 recording. Scoped implementation only: no merge, no deployment to GTA, no change to `main`, and **no claim of full runtime activation, GTA readiness or end-to-end MVP completion**.

Base: `3f4138d6f108ae6feda6d03ed54ac7c5e4e9c04a` (#138 head including E2, F and G). Branch: `feat/memory-k-h2-factual-recall-20261015`. Architecture: #158, Workstream H2. The exact head SHA is recorded in the draft PR (a document cannot contain its own commit SHA).

## What was added (and what was deliberately not touched)

| Path | Purpose |
|---|---|
| `lsa-essential-e1-candidate/src/memory/h2FactualRecall.mjs` | The H2 component: `prepareFactualRecall`, `createFactualRecall` |
| `lsa-essential-e1-candidate/tests/memory/h2FactualRecall.test.mjs` | 20 focused tests on the real P2 SQLite store |
| `lsa-essential-e1-candidate/tests/memory/h2RealAuthority.test.mjs` | 4 tests on the real D01/D03/D02 harness |
| `lsa-essential-e1-candidate/tests/memory/h2Latency.test.mjs` | 10,000-row phase latency |
| `lsa-essential-e1-candidate/tests/memory/h2-p2-fixture.mjs`, `h2-fixture.mjs` | Test fixtures only |
| `tools/memory-k-verification/registrations/h2-factual-recall.json` | Registers the three new test files with the inventory guard |
| `.github/workflows/memory-k-h2-factual-recall.yml` | Ubuntu + Windows focused run and inherited-suite comparison against the unchanged base |

No existing file is modified. In particular H2 does **not** modify `liveTurnMemory.mjs`, `essentialGlue.mjs`, `bootstrap.mjs`, `runtimeComposition.mjs` or any PS4 assembly/rendering file; `liveTurnMemory.mjs` is imported read-only by one test (parity check) and nothing else. `recallEngine`, `integrationPorts`, `recallEvidencePolicy`, the P2 read ports and PS4 contribution code are reused unchanged. There is no new SQLite database, writer, event bus, prompt writer, background worker, embedding server or model request.

## Contract

```js
import {prepareFactualRecall, createFactualRecall} from '.../memory/h2FactualRecall.mjs';

const r = await prepareFactualRecall({
  store,            // production P2 store (the same object the combined path receives)
  turn,             // live turn: characterProjection/characterInputs + m2Capture
  acceptedReceipt,  // D03 durable receipt {status:'stored'|'duplicate', durable:true, recordId, protagonistKey}
  input, source,    // authentic accepted player text; 'player_text' | 'player_mic'
  isCurrent,        // live turn-ownership predicate
  nowUtc,           // optional clock
  queryId,          // optional UUID v4 (tests); default random
  maxContributionBytes // optional, 512..14336, default 4096
});
```

Result (frozen): `{status, reason, preparedRecall, timings, recallCurrent, verifyPrepared, sendCurrent, revalidationMs}`.

| status | meaning | `preparedRecall` |
|---|---|---|
| `ready` | at least one authenticated, labelled item, or a verified exact count / known witness result | `{status:'ready', stamp, contribution, answerEvidence}` |
| `abstained` | recall ran but evidence cannot support an answer (nothing recorded, `first/earliest`, unsupported/non-literal count, no event proof). Contribution has **no items**; nothing is fabricated | same shape, `items: []` |
| `unavailable` | the retained source could not be read (for example a damaged row fails the inherited P2 integrity read) | `null` |
| `blocked` | authority missing, forged, retired or revoked (receipt, M2, D02 identity, host/world epoch, owner, timeline, evidence labels) | `null` |
| `disabled` | only from `createFactualRecall({mode:'off'})`; the store is never touched | `null` |

`preparedRecall` is byte-compatible with what the combined path already hands PS4: `contribution` is the existing typed `m4_recall` / `RECALLED` contribution (items carry the existing `category`, `sourceAvatar`, `sourceEvidenceIds` labels), `stamp` is the same scope + host + accepted-record stamp, and `answerEvidence` is the same G3/G4/G5 object. `recallCurrent(refs, seenStamp)` has the same signature as the combined path's.

### Authority (cannot be manufactured by the caller)

Nothing about authority is accepted as caller data. Preparation requires, all re-checked after every `await`:

1. A durable D03 accepted-line receipt **and** a readback of that exact line from the P2 journal (byte-equal to `input`, correct source typed/stt, same NPC/world/timeline, same host run/world epoch, valid session and turn hash). The line is never synthesized from client input. M2 accepted-line verification is not bypassed.
2. `turn.m2Capture.openMemoryCurrent()` / `verifyMemoryCurrent()` and the D02 source identity from `turn.m2Capture.memoryIdentity()`; the identity must match the store's verified host context and the NPC's current owner alias.
3. The store's synchronous `memoryReadFence`, so a source retirement, reconnect, purge or timeline change between the last read and the request boundary invalidates the preparation.

Extra fields such as `authority`, `memoryRead`, `config` or `enabled` are ignored (tested). A different NPC's turn, a guessed identity or a wrong-host D02 identity yields `blocked`.

### Retrieval and evidence (reused, not reimplemented)

- Query: the same typed `recall_query` the combined path builds (intent `exact_quote` for quote requests, otherwise `open_recall`; `maxBytes` 4096).
- Search: `recallMemory` over `createP2IntegratedRecallAdapter(store)`, i.e. the single source-qualified P2 projection (dialogue, witnessed events, permanent memory, canon) with its 384-row cap. The accepted current line is excluded from history.
- Evidence: `createRecallEvidencePolicy` for G3 labels, G3 exhaustive exact counts (literal `how many times did I/you say "…"` shape only; every other first/last/how-many question abstains), and G4/G5 witness (only persisted, sidecar-verified M3 events; otherwise `unknown`, never inferred from dialogue or proximity).
- Exact quotes: never truncated. The engine already skips anything over 3072 code points rather than shorten it; H2 additionally requires the evidence-labelled bytes to equal the item bytes exactly and drops any item the policy cannot authenticate (the combined path passes such items unlabelled).

### Revalidation (final send and every retry)

`await verifyPrepared()` must be awaited before every model attempt; `sendCurrent()` is the synchronous request-boundary check.

`verifyPrepared()` re-reads the accepted line (must be byte-identical), re-reads suppression + correction overlays, re-runs the M4 query and requires an identical contribution, re-runs labels, count and witness, and checks reference visibility (hash/sidecar integrity) for the accepted line and every recalled record, all under the same authority fence. **Any failure latches the prepared object invalid for good**: restoring the previous host/epoch/owner/timeline or retrying cannot revive stale recall, and no cache, archived dialogue or RAM fallback is consulted. The caller prepares afresh from the current authority.

Covered by tests: source retirement and reconnect, host-run and world-epoch change, NPC ownership change, timeline change, forgetting and correcting a recalled record (before preparation and between preparation and send), a privacy change after a successful verification, invalid/damaged evidence sidecar, replay from an earlier source generation, retry after source invalidation, and a real native D02 expiry/renewal.

## Independent operation

H2 imports only the engine, the P2 read adapter and the evidence policy. It does not import `liveTurnMemory`, M5 (`m5*`), M6/M7, M8 or PS3 modules (asserted by a test), and a store spy shows no writer, command, curation or interpretation surface is touched. M3 recording is not required: events recorded earlier remain recallable and are verified against their sidecars. `createFactualRecall({mode:'off'})` (the default) performs no store access at all (tested).

## Activation contract for the integrator (not wired here)

1. After H1-A defines its contract, the foreground preparer calls `prepareFactualRecall` with the same arguments it already passes to the combined path, in parallel with or after the H1 journal context. H1 context, M5, M8 and H2 stay independently optional.
2. Use the single existing PS4 assembler: pass `result.preparedRecall` and `result.recallCurrent` exactly where the combined path passes `preparedRecall` / `recallCurrent`, and await `result.verifyPrepared()` / `sendCurrent()` where the runner currently awaits the combined `verifyPrepared` / `sendCurrent`. The runner must **not** keep a second privacy fence for recall.
3. Switches (`memory.recall`) belong in the shared runtime composition files, which this PR does not edit. Map the capability to `createFactualRecall({mode})`.
4. Once H1-A lands, delete the duplicated recall block from `liveTurnMemory.mjs` (accepted-line readback, query construction, count/witness regexes, label merge, recall revalidation) so H2 is the sole owner; the parity test (`H2 contribution is byte-identical…`) is the safety net for that refactor and should then compare against a frozen fixture instead of importing `liveTurnMemory`.
5. Required store surface: `readDialogueLines`, `readIntegratedRecall`, `listSuppressedMemoryIds`, `withP2SqliteRead`, `verifiedHostContext`, `activeTimelineId`, `timelineWritable`, `get`, `memoryReadFence` (all present on the production P2 store). H2 returns `blocked` if the surface or fence is missing.

## Before / after M4 behaviour

| Behaviour | Combined path (#138) | H2 |
|---|---|---|
| Contribution for the same turn (items, order, bytes, stamp, `answerEvidence`) | reference | byte-identical (tested on the production P2 store and on the real D03/D02 harness, modulo random `queryId` and, on D01, the label fields) |
| Requires H1 journal assembly, M5 parse, M8 read | yes, in one function | no |
| Item the evidence policy cannot label | passed through unlabelled | dropped |
| No D02 source identity | `ready` recall; send verification silently fails | `blocked` up front |
| Source read fault with authority intact | `unavailable` (all memory lost) | `unavailable` / `source_read_failed` or `prepare_fault`, reason reported |
| Failed verification | recoverable (later success can set valid again) | latched invalid |
| Status vocabulary | `ready` / `unavailable` | `ready` / `abstained` / `unavailable` / `blocked` (+ `disabled` via factory) |
| Retrieval, ranking, evidence classification, caps, exact-quote handling | engine / policy | same code, unchanged |

## Measurements

10,000 retained dialogue rows, one on-disk production P2 SQLite connection, 35 warm iterations after a cold run (Linux, Node 22.22.0, this sandbox; Windows not run here). Each phase is measured separately; the whole foreground pipeline is not claimed.

| Phase | median | p95 |
|---|---|---|
| Accepted-line readback (M2 verification) | 3.8 ms | 8.1 ms |
| SQLite retrieval (M4 query over the P2 projection) | 4.9 ms | 7.1 ms |
| Contribution preparation | 0.03 ms | 0.07 ms |
| Evidence / provenance verification (labels, suppression, witness) | 4.1 ms | 8.3 ms |
| Total preparation | 13.3 ms | 20.5 ms |
| Final-send revalidation (`verifyPrepared`) | 14.9 ms | 23.8 ms |
| M4 query + contribution (original target ≤ 40 ms p95, asserted) | 4.9 ms | 7.1 ms |

An exhaustive G3 count over the same 10,000 rows took about 360 ms in the evidence phase (inherited cost of the existing exhaustive scan; count questions only, not the ordinary path). The existing WS6 latency suite passes unchanged on both the base and this branch.

## Test results (Linux, Node 22.22.0)

- New: 20 + 4 + 1 = 25 H2 tests, all passing.
- Inherited, run on the unchanged base (`3f4138d6`) and this branch with identical selection: `ws6LiveTurnMemory`, `ws6Latency`, `ws6OriginalRunner`, `ws6Original10kWriteRegression`, `ws6ProductionPipeline`, `memory-m4-closure`, E2 (`memory-e2-ws6-privacy-recovery`, `memory-e2-independent-privacy`, shared-brain `memory-e2-privacy-recovery`), `memory-m4-recall`, `memory-ws6-g3-g5-evidence`, S01–S10: **identical results on both**. Everything passes except the original runner scenarios S01–S10, which are intentional red source gates (`SOURCE_BLOCKED_S01 … S10`, identical messages on base and branch; S02 names `T5_M4_RECALL_MISSING`, which belongs to the later integration work, not H2).
- Inherited failures that remain visible and untouched: `tools/memory-k-verification/tests` (inventory guard) and `run.mjs`, both of which fail on the unchanged base because `ws6Original10kWriteRegression.test.mjs` is unregistered there. The H2 files are registered and are not reported as unregistered.
- Windows: the workflow runs Ubuntu and Windows, but no Windows execution was possible from the authoring environment. **Windows results are not claimed.**

## Risks and unresolved items

- One damaged retained row makes the inherited P2 read throw (`m4_corrupt_dialogue`), so recall is `unavailable` for that NPC until repaired, in H2 and in the combined path. H2 never presents the damaged text; whether to quarantine the row and continue is a P2 decision outside this PR.
- The accepted line is located within the 200 most recent lines (inherited limit). Very large concurrent bursts could in principle push it out; H2 then blocks.
- H2 temporarily duplicates the recall block from `liveTurnMemory.mjs` (cannot be edited while H1-A is in progress). Step 4 of the activation contract removes the duplication.
- Test doubles: the lightweight fixture derives M2/D02 callbacks from live store state; full D01/D03/D02 authority is exercised separately. Native frames are scripted offline fixtures, not GTA receipts.
- Not verified: Windows, native build, packaging, physical GTA, soak, and the combined foreground path with H1-A.

