# Production W06 — M6 atomic P2 replay cursor and memory lifecycle

**Owner:** T6. **Gate:** A06. **Status:** implemented source + unverified real-SQLite stress; **NO-GO** for GTA testing/deployment/merge.  
**Repository:** `ComradeGenosse/LSA-Enhanced-essential-fork`  
**Draft PR:** [#100](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/100)  
**Branch:** `feature/memory-k-t6-m6-sqlite-cursor-lifecycle-20261011`  
**PR base:** `integration/memory-closure-final-k-20261011`  
**Exact approved starting commit:** `0201731973a1c02a8852271897e2c8df420396b9` (PR #94)  
**Final source-and-test checkpoint before the handoff revision:** `38a00c7b20892440250e242e6e6a13efa454afd1`; the documentation commit advances the PR head. K must retrieve PR #100's final GitHub `head_sha`, test logs and changed files, not infer test success or mergeability from this document.

## Work completed

- Inspected PR #97 W06/A06 plan and `closure-workstreams.v1.json`, PR #83 (B) and PR #82 (G), their actual SQLite/M6 source and handoffs. B exposed `readCommittedEvidenceCursor/Page/ackCommittedEvidenceCursor` with a durable per-protagonist append feed; G instead requires `readM6Checkpoint/readM6JournalPage/ackM6Checkpoint` and atomic proof of downstream commits. They were *not* equivalent.
- Added `lsa-shared-brain/src/memory/m6P2ReplayAdapter.mjs`: additive M6 schema, exact P2 append-sequence projection across qualified per-character protagonist streams, original journal content/JSON checks, actual PS2 sidecar checks, tombstone/correction masking, durable diagnostic and SHA-256 receipts, CAS checkpoint and hour count. Backfill and existing B triggers remain authoritative; M6 does **not** use source timestamps as its cursor.
- Added `readM6Checkpoint/readM6JournalPage/ackM6Checkpoint` methods through **the same** `P2SqliteProfileStore` serialized read/transaction queue and `P2SqliteFoundation` connection. `ackM6Checkpoint` runs under the original P2 native/timeline-source write fence, with a single SQLite commit/rollback for the checkpoint, ordered source hashes, deterministic saved proposal readbacks, optional M7 queue readbacks, rejected-row diagnostics, clock/source veto and idempotent ack receipt. No second SQLite writer, daemon, file or PS4 knowledge frame.
- Adapted `m6CursorConsumer.mjs` and `m6Coordinator.mjs` to process bounded, checkpointable prefixes instead of overflowing or skipping old backlog. Keep `archiveComplete:false` until all pages are safely acknowledged. Persist/compare last source clock and UTC cutoff, preserve original deterministic source-ID selection and soft six-per-hour pressure, and return source-qualified `replay_rejection` diagnostics without classifying them as witnessed.
- Added per-character M6 ledger cleanup during the existing P2 profile deletion transaction and source-receipt/diagnostic cleanup when B's authorized physical replay-feed purge deletes an entry. No edits to K-exclusive host wiring files.
- Final hardening after the initial handoff: required `timelineSourceStatus==='verified'` and `verifiedHostContext` at each W06 public P2 read/ack boundary (test-only `sourceRequired:false` is rejected). A persisted checkpoint must resolve to a durable CAS acknowledgement; matching source row and immutable SHA receipt must be internally consistent, with a fresh digest check for currently visible evidence. Authorized privacy suppression does not unmask old sources just to verify their hashes. Added adversarial test that tampers with persisted checkpoint sequence and source SHA receipt after a successful commit.
- Added `lsa-shared-brain/tests/memory-m6-p2-production.test.mjs`, hooked from `memory-m6-completion.test.mjs` on Node 22+ (Node 20 legacy harness remains unaffected). The suite is written for **2,501 real, committed M3 SQLite event/sidecar records plus 203 accepted M2 dialogue lines, two promoted NPCs**, multi-page cursor replay/restart; deterministic-save→restart and queue→restart; CAS rollback on missing M7 job; deleted/corrupted journal source and invalidated authority; rejected-source accounting; 51-item bounded-prefix continuation, correction/tombstone and clock regression. Mock authenticated PS2 fixtures do **not** replace original native GTA source proof.

## Exact owned changes

- `lsa-shared-brain/src/memory/m6P2ReplayAdapter.mjs` (new)
- `lsa-shared-brain/src/memory/m6CursorConsumer.mjs`
- `lsa-shared-brain/src/memory/m6Coordinator.mjs`
- `lsa-shared-brain/src/characters/sqliteProfileStore.mjs`
- `lsa-shared-brain/src/characters/sqliteFoundation.mjs`
- `lsa-shared-brain/tests/memory-m6-p2-production.test.mjs` (new)
- `lsa-shared-brain/tests/memory-m6-completion.test.mjs`
- `lsa-shared-brain/tests/memory-m6-sqlite.test.mjs`
- This document

No edits to `bootstrap.mjs`, `integrationPorts.mjs`, original Essential runner/glue, native global registration or other K-exclusive files.

## Adapter and K-owned lifecycle wiring

```js
import {createM6P2ReplayAdapter} from
  'lsa-shared-brain/src/memory/m6P2ReplayAdapter.mjs';
import {createM6SelectionCoordinator} from
  'lsa-shared-brain/src/memory/m6Coordinator.mjs';

const p2 = existingP2SqliteProfileStore; // one existing P2 writer, sourceRequired:true
const m6 = createM6SelectionCoordinator({
  store:createM6P2ReplayAdapter(p2),
  quietMs:90_000,
  pageSize:250, maxRows:8192, maxPages:64,
  softTargetPerHour:6, minScore:0.56,
  cloudQueueEnabled:false // enable only after W07 explicit consent + native-idle gates
});
// Trusted, currently verified P2/native owner scope; never infer from nearby ped/model:
const scope = {worldProfileId, characterId, timelineId};
const closed = await m6.onSceneClose({scope,atUtc:verifiedSceneCloseUtc});
const idle = await m6.onIdle({scope,atUtc:verifiedNativeIdleUtc});
const recovered = await m6.recover({scope,atUtc:confirmedRecoveryUtc});
```

K must construct this only *after* the real P2 store initializes and source authority and active writable timeline are independently confirmed. Wire `onSceneClose` after all ordinary accepted M2 player lines, completed audible NPC output and M3 witness sidecars have committed. Wire `onIdle` only with W07's independently verified, native-sourced idle/player-turn and PS6 Director priority proof and consent; no paid Luna call here. Wire `recover` after reconnect, replay or save change only after fresh native epoch/owner/protagonist evidence and human-approved timeline selection. Never call these on native game fiber.

On `archiveComplete:false`, request a *new* scheduler pass after the committed checkpoint (respect priority and quiet cutoff), with bounded paging; never truncate old archive, perform tight main-thread retry loops or treat `blockedByQuiet` as full completion. If page/ack fails, treat it as **paused**; propagate error and keep previous durable cursor, require fresh source/timeline verification before retry. Native rollback, clock regression, character deletion, host/adapter epoch change or unknown authority are vetoes, not auto-confirmations. Also coordinate W02/W03 active source-time PS2 and exact C-01 accepted-turn implementation before interpreting observed game events or original dialogue as proven.

The `createM6P2ReplayAdapter(p2)` facade demands both B's committed evidence cursor API and T6's new atomic M6 API on the *same* object. Do **not** replace P2 with a second SQLite connection. The latter cursor includes all append-ordered B feed rows for a character; B's per-protagonist cursor remains separate for legacy consumers.

## Reproduction and precise evidence state

At repository root on Node 24 and real SQLite:

```sh
node --check lsa-shared-brain/src/memory/m6P2ReplayAdapter.mjs
node --check lsa-shared-brain/src/memory/m6CursorConsumer.mjs
node --check lsa-shared-brain/src/memory/m6Coordinator.mjs
node --check lsa-shared-brain/src/characters/sqliteFoundation.mjs
node --check lsa-shared-brain/src/characters/sqliteProfileStore.mjs
node --test lsa-shared-brain/tests/memory-m6-p2-production.test.mjs
node --test lsa-shared-brain/tests/memory-m6-completion.test.mjs
node --test lsa-shared-brain/tests/memory-m6-sqlite.test.mjs
node --test lsa-shared-brain/tests/memory-integrated-storage.test.mjs
```

**Not a passing test claim.** At creation of this handoff, the W06 real-SQLite test suites at the current implementation checkpoint had been pushed but their GitHub Actions Node 24 Windows/Linux checks were **queued**; no confirmed 2,501+203 original SQLite pass receipt or completed exact-head CI was available. Inspect M6 workflow run [38241739727](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38241739727) (queued as observed at source SHA `38a00c7b20892440250e242e6e6a13efa454afd1`), plus final PR head checks, and read the actual test-step logs.

An *earlier* head `1a82aa839330f37f8b5599949bc148426b48ea4c` showed mock M6 19/19 pass and M7 12/12 pass in Node24 Ubuntu; that does **not** qualify W06 real P2 SQLite. The combined integration job at source SHA `1a82aa839330f37f8b5599949bc148426b48ea4c` (M6 [run 38240038755](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38240038755), Ubuntu24 job 114780082225) additionally failed an existing unrelated H/M3 coverage assertion (`unknown` vs `unavailable`, `memory-integrated-storage.test.mjs:245`); do not silently mark combined acceptance green. Exact-head real DB, native build, final CI and physical-game receipts remain unverified unless later linked with executed assertions and original P2 readbacks.

## Remaining source/security limitations and handoff gating

1. **Native authenticity:** These are genuine P2 SQLite APIs, not proof that PR #94's original normal C-01 native accepted-turn producer, authenticated source-time PS2 M3 witness/negative coverage, or native-idle producer exists. W01/W02/W03/W07/K must provide positive original source provenance; unsupported pinned ABI remains NO-GO. This test uses synthetic PS2 fixtures and must be labeled fixture-only.
2. **M7:** Cloud queue verification proves an existing durable SQLite job before cursor ack when enabled. It is not the independent native idle/consent/provider budget gate, nor authority to invoke Luna. W07/K own that.
3. **Race/source scope:** M6 ack rechecks current SQLite provenance and scoped source hashes, tombstone/correction records, epoch/timeline writer gate; it does not retroactively manufacture missing historical PS2 owner identity. Native interruptions must invalidate P2 source authorization and K must not call the old in-memory `allowLegacyBoundedReplay` production path.
4. **K integration and acceptance:** K exclusively owns `bootstrap.mjs`, `integrationPorts.mjs`, actual scene/idle/restart hooks, source/host registration, original player-turn priority, packaging and exact-head acceptance. K must inspect the final PR diff and rerun the 2,501-event/203-line SQLite suite and original M0 scenarios with verified native receipts; do not install into GTA, merge to main, or claim controlled GTA GO from this branch.

**Final disposition:** draft source handoff for integrator K, controlled GTA testing **NO-GO** until actual exact-head SQLite and original native acceptance evidence exists.
