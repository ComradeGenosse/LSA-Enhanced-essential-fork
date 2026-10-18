# M3 completion — Agent B handoff to Agent H

**Base:** PR #61 at `c26948cacf2e00b076ec1b71fb1af6f8cf1962c9`.
**Status:** independent M3 implementation and fixture validation; NOT activated by Essential bootstrap, NOT in-GTA verified, NOT a standalone-host acceptance receipt. This PR intentionally leaves shared SQLite foundation, `integrationPorts.mjs`, M9 producers and bootstrap untouched.

## Delivered

1. `src/events/m3ObserverOwnerBinder.mjs` — source-checking observer-to-promoted-CharacterId binder; validates native PS2 observer index/anchor/live observation, exact native adapter run, host run, world epoch, P2 confirmed timeline, current profile status and native owner proof (owner alias, incarnation, encounter). No proximity, ped-handle-only, PS3 salience or client/model trust. Reauthorizes inside M1 commit. Optional separately verified native participant identities support Franklin/Michael/Trevor; without proof leave `unresolved:<claimId>`. Verified pre-promotion reservations use same physical owner/lifetime and expire after two minutes; no guess from a generic ambient ped.
2. `src/events/m3BoundedIntake.mjs` — synchronous non-async `offer` for the already-authenticated PS2 `acceptedObservationTap`; immutable bounded queue (default 512 items/1 MiB), 16 per asynchronous yield, explicit overflow/rejection/failure/retirement counters and diagnostic callback. Never marks a receipt durable until `WitnessedEventRecorder.capture` confirms `inserted` or `duplicate`. During backlog, stale PS2 lease or P2 timeline intentionally rejects instead of inventing a witness.
3. Recorder: immediate authorization is reconfirmed inside `withTimelineWrite`, immutable sidecar/event parity verified before append; revised bounded promotion import retains other observers' histories and is retryable after SQL failure. A mismatch of native run, epoch, incumbent incarnation, or owner alias cannot bind a new NPC's memory. Ordinary revisions and restart dedupe use PR #61's existing durable `appendEvent` logic.
4. `journalEventNormalizer.mjs` — `verifyM3DerivedEvent(event,sourceEvidence)` reconstructs and checks the **entire** strict v1 event including type, timestamp, source hash, modality, certainty, record ID, and all claims against PS2 evidence and checked participant proofs. No new top-level v1 keys.
5. `m3CoverageSqlite.mjs` — additive SQL DDL and synchronous `ensureM3CoverageSchema(db)`, `appendM3Coverage(db,record)`, `readM3Coverage(db,scope)`. Missing row returns `{status:'unavailable',certified:false}`; only an independently source-certified native negative receipt may become `did_not_witness`. Coverage is never a positive journal event.
6. `m3-completion.test.mjs` + updated original M3 tests + CI matrix Node 20/24 × Windows/Ubuntu.

## Exact integration API for Agent H

```js
import {M3ObserverOwnerBinder} from './events/m3ObserverOwnerBinder.mjs';
import {M3BoundedIntake} from './events/m3BoundedIntake.mjs';
import {WitnessedEventRecorder} from './events/witnessedEventRecorder.mjs';
import {createM3JournalPorts} from './memory/integrationPorts.mjs';

const ports = createM3JournalPorts(p2SqliteStore);
const binder = new M3ObserverOwnerBinder({
  ps2: authenticatedShadowRuntime,
  p2: p2SqliteStore,
  resolveNativeOwner: ({observerCaptureRef,observerIndex,hostRunId,worldEpoch,adapterEpoch}) =>
    /* SYNC native-verified current P2 owner ledger snapshot, else null */,
  resolveParticipants: ({observation,hostRunId,worldEpoch,adapterEpoch,ownerProof}) =>
    /* optional source-verified participant proofs; default none */,
  resolvePrepromotion: /* optional reserved CharacterId+owner alias proof */,
  verifyNativeCoverage: /* optional independent native non-witness receipt */,
});
const recorder = new WitnessedEventRecorder({
  authorize: args=>binder.authorize(args),
  authorizeCoverage: args=>binder.authorizeCoverage(args),
  withTimelineWrite: ports.withTimelineWrite,
  journalPort: ports.journalPort, // add a transactional recordCoverage port separately
});
const intake = new M3BoundedIntake({binder,recorder,
  onFailure:(kind,details)=>recordOperationalDiagnostic(kind,details)});
// Supply this sync callback when constructing authenticated ShadowRuntime:
// acceptedObservationTap: receipt => intake.offer(receipt);
```

`resolveNativeOwner` is an INJECTED trusted native cache lookup; it must not be a remote asynchronous `inspect`, unverified actor JSON, or self-asserted `trusted` field. Return `{current:true,promoted:true,characterId,ownerAlias,ownerProof}` only after independent native ownership proof matching exactly the PS2 index incarnation, encounter, observer captureRef, native host run/epoch, and P2 profile. Observer `adapterEpoch` and native `hostRunId` are different identities. On missing cache/proof, return null. For pre-promotion reservations, `resolvePrepromotion` must provide `promoted:false,reserved:true,characterId,ownerAlias,ownerProof` from a separate native reservation; absence disables grace rather than guessing a future CharacterId. Agent H must not use any cache or socket notification as ownership proof after its lease expires. Call `intake.retire();binder.reset()` on native disconnect, PS2 reset, world epoch, ownership incarnation or timeline loss; reconstruct from new native facts.

The PS2 tap accepts only already stored observations. Call it after native-channel authentication, PS2 validation/correlation and before PS3 salience, as the existing optional `ShadowRuntime.acceptedObservationTap` does. It MUST remain synchronous and fast. `offer` means queued, NOT committed. `intake.idle()` is a checkpoint with counters, not a success/coverage promise. Process each `await recorder.capture` through M1's serialized timeline gate; M2's `journalPort.append` writes source sidecar atomically with the strict event. A crash before an enqueued write reaches SQLite is an explicitly non-durable lost receipt; requiring true at-least-once delivery needs a future native replay protocol.

### Coverage port and contract

Agent H must extend the P2-owned migration and exposed persistence port with `ensureM3CoverageSchema(db)` under migration and `recordCoverage:(record,foundation,snapshot)=>...` to run `appendM3Coverage` using the actual single P2 SQLite connection/serialized write fence. This branch deliberately does not modify SQLite Foundation. A future wrapper must not open a competing writer, use a second DB, or issue nested transactions.

Recorder API: `await recorder.recordNegativeCoverage({candidate,observationId,status,reason,coverageReceipt})`. The binder calls `verifyNativeCoverage` for `did_not_witness`: it must re-obtain a native-authenticated receipt with `sourceReceiptId,status,observerCaptureRef,hostRunId,worldEpoch,sampledGameTick,channel,basis,certified:true`; never derive certification from the caller's requested status. Without this independent authority and the coverage port, the operation fails closed. Unknown/unavailable never mean the event definitively did not occur. Missing coverage is unavailable.

## Acceptance and unresolved deployment work

- Offline invariants: source v1 event derivation, unknown-vs-proven protagonist identity, two-observer isolation, queue overflow and retirement, literal event sidecar, per-owner replay, SQL coverage idempotence when `node:sqlite` exists.
- **Not yet wired:** Essential/standalone bootstrap, live authenticated PS2-to-P2 native ledger adapter, negative native receipt emission/coverage schema migration, P2 timeline activation, and M9 producer/contract extension. The source-only PS2 tap already exists; this PR cannot claim active ingestion.
- **Not yet proven:** native GTA witness accuracy, simultaneous 3+ promoted companions, owner retirement during an in-flight commit, real 10,000-signal storms at game FPS, OS crash replay, and physical RAGE host restart/epoch semantics. Do not deploy to GTA or claim M3 accepted until Agent H integrates and gathers native receipts.

## Review checklist

Ensure Agent H: (1) uses exact PS2/P2/native owner proof (never `ownerAlias` by name), (2) connects authenticated tap to bounded intake, (3) installs additive coverage schema and a serialized coverage write/read port, (4) exercises two observers/one eyewitness in-game, (5) checks native host/epoch/protagonist change and explicit rollback freeze, (6) verifies all PR CI on exact head, (7) records a diagnostic when any queued receipt fails or overflows, (8) does not merge PR #61 or deploy based on offline tests alone.
