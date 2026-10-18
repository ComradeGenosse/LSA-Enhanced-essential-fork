# Agent D — M3 witness and coverage closure

**Date:** 2026-10-11. **Starting point:** PR #75 exact commit `8443a8adec9433626902b46b81bd3e58fc382fb2`. **Dedicated branch:** `feature/memory-close-d-m3-coverage-20261011`, PR #84, base `integration/memory-completion-h-review-20261011`. **Last functional-code commit at handoff drafting:** `0ece4f4e9b8b4b6ea99f181030e263a8bc39f0c2`. The final commit containing this handoff is the PR #84 head; use the PR's immutable `head.sha` as the authoritative final artifact SHA (the file cannot embed its own future Git commit hash). No merge, installation or paid API calls occurred.

## Owned changes and what they actually do

- `lsa-shared-brain/src/events/m3ObserverOwnerBinder.mjs`: source-time native owner attestation (not merely current ped), mandatory `nativeVerified`, independent PS2 accepted-observation/index/anchor check at tap **and** synchronous reauthorization inside P2's serialized timeline writer, same physical owner/run/epoch/incarnation/encounter, native-reserved prepromotion. Participant protagonist claims now require a source-verified matching claim evidence tick, otherwise actor attribution remains unresolved. A null/malformed/throwing participant resolver preserves the qualified PS2 witnessed event with an unresolved actor; only missing **owner/witness** proof prevents capture. `requireSourceTimeProof` defaults to **true**. No PS3 salience or nearby-actor inference.
- `lsa-shared-brain/src/events/m3BoundedIntake.mjs`: bounded nonawaiting PS2 offer; separate offered/queued/committed/duplicate/overflow/retired/failure counters; safe diagnostic callbacks; explicitly stalled scheduler/retry diagnostics; a queued callback is **never** an SQLite durability ack. Crash loses uncommitted callbacks; it does not establish negative coverage.
- `lsa-shared-brain/src/events/witnessedEventRecorder.mjs`: commit-time verification and exactly the existing P2 `withTimelineWrite` + journal/sidecar append. Negative receipt is scoped to observation ID and adapter epoch. Unresolved promotion-grace imports remain retryable until the max 120-second limit; they cannot migrate to a recycled lifetime.
- `lsa-shared-brain/src/events/m3CoverageSqlite.mjs`: no independent DB/migration. Existing H-installed additive table retained, stricter JSON certificate validation tying actual native `sourceReceiptId`, `nativeVerified`, observation, epoch, alias, incarnation, encounter, run and witness modality. Missing coverage reads `{status:'unknown',certified:false,evidencePresent:false}` rather than declaring an unseen event. Legacy fixture records without the new native proof are not accepted as `did_not_witness`.
- **New** `lsa-shared-brain/src/events/m3Ps2ObserverAdapter.mjs`: `createM3Ps2ObserverAdapter` assembles existing binder, intake, `createM3WitnessRecorder`, and the original P2 store's one serialized writer. No new worker, database, daemon, model or extra knowledge frame.
- `lsa-essential-e1-candidate/tests/m3-completion.test.mjs`: upgrades native mock certificates and imports the new focused suite in the existing M3 CI command.
- **New** `lsa-essential-e1-candidate/tests/m3-closure-agent-d.test.mjs`: positive and adversarial tests with separately injected PS2, native owner and P2 journal fixtures.

## Exported API and integrator K fixture contract

```js
import {createM3Ps2ObserverAdapter} from '../../lsa-shared-brain/src/events/m3Ps2ObserverAdapter.mjs';
const m3 = createM3Ps2ObserverAdapter({
  ps2: intelligence.runtime, p2: p2Store, store: p2Store,
  nativeAuthority, // source-confirmed Agent A native authority only
  onLoss: (stage, detail) => telemetry?.emit?.('memory_m3_intake_loss', null, 'internal', {stage}, 'internal')
});
const tap = (acceptedPs2Receipt) => m3.acceptedObservationTap(acceptedPs2Receipt);
// tap is SYNCHRONOUS. It returns {accepted:true, queued:true}, NEVER 'committed'.
await m3.idle();     // test/shutdown checkpoint only: inspect counters, not a success promise
m3.snapshot();       // {offered,queued,committed,duplicate,overflow,failed,...,recovery}
m3.retire();         // PS2 C-13 run/epoch, owner lifetime or P2 timeline boundary
m3.close();
```

Additional separate methods: `m3.prepromotionAcceptedTap(receipt)` only for a native-reserved, verified **future** CharacterId and the same physical owner; later `await m3.importOnPromotion({candidate})` only after verified promotion; `await m3.recordNegativeCoverage({candidate,observationId,status,reason,coverageReceipt})` only after a **separately certified native negative**, never absence of PS2/PS3 signal. Never run those asynchronous functions on the synchronous PS2 signal callback.

### Trust-boundary native fixtures required from A and K

`nativeAuthority.resolveNativeOwner({observerCaptureRef,observerIndex,hostRunId,worldEpoch,adapterEpoch,observedGameTick,observationId,observationRevision})` returns synchronously or fails closed. Result must contain `{nativeVerified:true,current:true,promoted:true,characterId,ownerAlias,ownerProof,sourceAtObservation}`. `ownerProof` contains matching `{ownerAlias,hostRunId,worldEpoch,observerCaptureRef,incarnationId,encounterId}`, and `sourceAtObservation` contains `{nativeVerified:true,gameTick,adapterEpoch,hostRunId,worldEpoch,observerCaptureRef,ownerAlias,incarnationId,encounterId}` attested by a **real native source-time owner ledger**, not an echo constructed from the callback arguments. Bind the native observer lifetime at the actual observation game tick and recheck it at commit. A's native adapter MUST document whether this historical source proof exists. If not, reject, keep the event unknown, and retain the blocker.

Optional `nativeAuthority.resolveParticipants({observation,hostRunId,worldEpoch,adapterEpoch,ownerProof})` returns 0–16 individually `nativeVerified:true, verified:true` proofs with `{captureRef,subjectKind,subjectKey,hostRunId,worldEpoch,adapterEpoch,sampledGameTick}`. Subject is `protagonist:franklin|michael|trevor` only if independently proven **for the claim's evidence tick**; otherwise `unresolved:<claimId>`. Native metadata, generic protagonist selection, names and opposite participants do not prove the actor.

Optional prepromotion `resolvePrepromotion` must return `promoted:false,reserved:true` with source-time owner certificate for the **reserved future** P2 CharacterId; no ambient-NPC grace otherwise. Optional `verifyNativeCoverage({candidate,coverageReceipt,observationId,hostRunId,worldEpoch,adapterEpoch,observerCaptureRef})` must independently confirm a native certificate containing `{nativeVerified:true,certified:true,status:'did_not_witness',sourceReceiptId,observationId,adapterEpoch,ownerAlias,incarnationId,encounterId,hostRunId,worldEpoch,observerCaptureRef,sampledGameTick,channel,basis}`. Unsupported native continuous negative coverage => `unknown`; a single missing observation/callback, PS3 omission or expired buffer is **not** a native negative receipt.

### K-only exact wiring edits (DO NOT implement by bypassing owner files)

1. In `bootstrap.mjs`, after P2 SQLite initialization/timeline confirmation and `IntelligenceClient` construction, replace the manual H binder/intake block with this exported adapter and Agent A authenticated source-time resolver. The existing `acceptedObservationTap` in `intelligenceClient.mjs` / `ShadowRuntime` already runs synchronously **after PS2 accepted correlation and before PS3 salience**. Keep it strictly synchronous, fail-closed, optional, and free of SQL. Do not register the M9 candidate stream as if PS2 had witnessed it.
2. On the same authenticated host-run/world-epoch, PS2 owner retirement/reset, incarnation/encounter invalidation, P2 timeline rollover/suspension, or promoted CharacterId replacement, call `m3.retire()` and require fresh owner proof; preserve P2 `setVerifiedHostContext`/TimelineGuard source confirmation. Avoid wiping committed SQLite journal rows.
3. The `store` must be **the same P2 SQLite profile store** with `withTimelineWrite`, `appendJournalEvent`, `get`, verified host context and `appendM3Coverage` already installed by H/B. `createM3WitnessRecorder` reuses `integrationPorts.mjs` and the existing journal-sidecar transaction. Do not create an independently opened SQLite connection, perform SQL in PS2's callback, or add a second knowledge-frame producer.
4. If A supplies genuine source-time owner reservation, route prepromotion accepted PS2 receipt to `prepromotionAcceptedTap`, then call `importOnPromotion` after source-proven P2 promotion. Keep the max 120 s. Without A's ledger keep prepromotion disabled.
5. Native certified negatives are a separate K/A observer-coverage surface; do not synthesize them by iterating non-observing NPCs, by proximity, by no PS3 salience or by M9 candidate lack. Preserve `report` separate from `visual/self/auditory`. PS6 Director/player speech priority is untouched by this M3 module.
6. **Unowned combined fixture compatibility patch required** in `lsa-shared-brain/tests/memory-integrated-storage.test.mjs` (K owns shared acceptance): its H-era M3 test expects missing read status `unavailable` and constructs a certified native negative with only `certified:true`. Change missing-read assertions to `unknown`; add `adapterEpoch` to the record, and `nativeVerified:true, observationId,adapterEpoch,ownerAlias,incarnationId,encounterId` to the native receipt. This is an **old test fixture**, not permission to weaken the stricter production validator. Current combined red remains a K integration blocker.

## True test commands and evidence

- Reproduce focused Node 24 suite (Linux and Windows) with:
  `node --test lsa-essential-e1-candidate/tests/m3-completion.test.mjs lsa-essential-e1-candidate/tests/memory-agent-b-events.test.mjs lsa-essential-e1-candidate/tests/memory-agent-b-ps2-tap.test.mjs lsa-essential-e1-candidate/tests/memory-contract-v1.test.mjs`
- Reproduce source parser:
  `node --check lsa-shared-brain/src/events/m3ObserverOwnerBinder.mjs && node --check lsa-shared-brain/src/events/m3BoundedIntake.mjs && node --check lsa-shared-brain/src/events/m3CoverageSqlite.mjs && node --check lsa-shared-brain/src/events/witnessedEventRecorder.mjs && node --check lsa-shared-brain/src/events/m3Ps2ObserverAdapter.mjs`
- First GitHub Node 24 Ubuntu exact PR branch SHA `d10977aa47f87b37c60854ef63144f13ad00cf0b`, workflow **Memory H combined integration acceptance**, run `38183782676`: **70/70 passed in the M2/M3/M9 first group**, including nine new Agent D tests, and pinned native job passed. Combined second M4/M5/M6/M7/SQLite group **57/58**: one test fails at `memory-integrated-storage.test.mjs:245`, expecting `unavailable` but receiving safe `unknown`. Windows job also failed this group. This is NOT a combined CI pass. Additional source-tick/certificate and participant-outage adversarial cases were appended after that run; rerun/check final head. Never claim tests passed without exact final-head logs.
- No local full-repository test was run in the isolated tool container (Node 22 there, repository not mounted); source-only JS syntax for initial new files was checked locally. GitHub Actions is the authoritative offline test runner here.

**Positive/adversarial coverage:** two observers same incident, absent witness, isolated CharacterIds, visual/auditory/report distinctions, source-qualified or unknown protagonist, source hash and claimed modality tamper, unavailable/throwing participant resolver, ped captureRef reuse and changed incarnation, PS2 missing/retired owner, in-flight late receipts, 10,000-offer overflow, timeline rollover suspension, PS3 salience omission, native negative missing/stale certificate, bounded prepromotion grace and restart/idempotent accepted replay.

## Known blockers / scope boundaries

- **NO real GTA native source-time historical owner ledger established on this branch.** Agent A must prove and expose it; otherwise live capture is intentionally rejected. Fixture-provided `nativeVerified` is not physical proof.
- **NO native certified negative coverage exporter established.** Absence remains unknown.
- In-memory accepted PS2 callback queue is not crash-durable before P2 commit. Genuine crash-loss recovery requires fresh authenticated native PS2 replay (with scoped dedupe); no unsent callback can be inferred or reconstructed as a factual journal entry. `snapshot().recovery` makes this explicit. Persistent enqueue would require an approved source/replay contract and B/K store changes; no independent second writer was added.
- Strict integrated M3 read/negative fixture needs K's unowned shared test update. PS4 recall admission, M6 scene-close, M7 Luna idle consent, M8, M9-native/PS6 and physical game acceptance remain K/other-agent scope. No claims of offline final integration GO, GTA install, actual witnessing acceptance or live billed Luna calls.
