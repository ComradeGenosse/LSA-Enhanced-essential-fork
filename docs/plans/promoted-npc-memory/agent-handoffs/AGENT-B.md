# Agent B — M3 witnessed events / M9 producer handoff
**Branch:** `feature/memory-agent-b-m3-events` from exact M1 `1ca219fd8b95ba2dbf2d1f8031d40fe93308a404`. **Status:** offline implementation, not GTA acceptance or active memory ingestion. No SQLite schema, shared contracts, recall engine or PS6 code changed.

## Implemented
- `lsa-shared-brain/src/events/journalEventNormalizer.mjs`: PS2 Observation v1 to strict `journalEvent` v1, with deterministic v4-format recordId, canonical SHA-256 sourceHash, immutable observation sidecar, modality/certainty and provenance mapping. A reported claim remains reported; uncertain evidence is `unknown`, never upgraded to direct. Source/target capture refs are not durable identities. Unresolved actors get `unresolved:<claimId>`; only fresh, explicitly verified identity proofs may name a protagonist or durable CharacterId.
- `lsa-shared-brain/src/events/witnessedEventRecorder.mjs`: fail-closed `authorize` and M1 `withTimelineWrite` injected ports; journal append happens synchronously *inside* the actual serialized timeline fence. Append must explicitly report `inserted` or `duplicate`. Non-P2 observers and stale native/world/timeline proofs fail. Supports strict same-physical-NPC promotion import of up to 120,000ms / 128 buffered PS2 observations. Expiry, buffer reset, replay idempotence and optional negative-coverage port.
- `lsa-shared-brain/src/events/m9EventProducers.mjs`: native-snapshot *candidate detector*, not a model/world-fact producer. Independent classifications for collision-backed vehicle crashes, witnessed-native-orientation rollover candidates, airborne-to-grounded stunts, water/submersion transitions, wanted-level edges and explicit native Wasted/Busted outcome receipts. No speed-dip-only crash, initial-state wanted, model narrative or unproven outcome. Reset on epoch/player change, reject stale/out-of-order source samples and dedupe native receipt IDs.
- `lsa-essential-e1-candidate/tests/memory-agent-b-events.test.mjs`: offline happy/negative/source spoofing, multi-NPC, timeline freeze, idempotency, hearsay, original raw sidecar, promotion grace, bursts and M9 activity fixtures.
- `.github/workflows/memory-agent-b-events.yml`: Node 20/24 and Ubuntu/Windows offline event + memory.v1 fixture CI. **This is source-level verification, not actual RAGE/GTA signal coverage.**

## Strict event acceptance and coverage
1. PS2 `validateFrame` on an authenticated native pipe and `validateObservation` happen **before** the M3 callback. PS2 observation is admitted from the correlator **before** PS3 notability/filtering and before PS2 expiry. Authentication must come from native pipe, not `trusted:true` in arbitrary JSON, a model, a client HTTP request, or a guessed ped handle.
2. Invoke recorder with an authority callback `authorize({observation,candidate,stage})` that checks current PS2 observer index + anchor + current P2 OwnerEvidence binding: exact `observerCaptureRef`, `ownerAlias`, `encounterId`, `incarnationId`, `adapterEpoch`, `hostRunId`, `worldEpoch` and current selected `characterId/worldProfileId/timelineId`. Return `{promoted,current,characterId,worldProfileId,timelineId,adapterEpoch,ownerProof}` **only if native source proof is current**. In `prepromotion` stage, return `promoted:false` only for the same known stable owner lifetime; no unrelated ped buffer. `identity.current` is not a substitute for authenticating the producer.
3. Journal source evidence is frozen in `sourceEvidence`, separate from the contract's restricted top-level `journalEvent`: original PS2 observation (including observed UTC and game tick), current source context, stable owner proof, participant identity proofs, receipt modality, native adapter epoch and optional pre-promotion owner proof. Store `event` and `sourceEvidence` in **one transaction**, compare event.sourceHash to sourceEvidence.sourceHash on append and reject mismatch.
4. The v1 envelope stores `receiptStatus=witnessed|reported` and claims with `modality=self|visual|auditory|report`, `certainty=direct|reported|unknown`, `sourceEvidenceId` and proven/unresolved `durableSubject`. M3 does not invent GPS, victim names, crash causation, songs or narrator summaries from PS2 claims. PS2 native `observedAt.nativeRun` is **adapterEpoch**, not `hostRunId`; both must be independently checked.
5. Journal event dedupe key: `(worldProfileId,timelineId,characterId,observationId,revision)`; enforce monotonic revision per `(world,timeline,character,observationId)` in SQLite across process restarts, even after the in-memory cache is cleared. Distinct promoted NPCs can legitimately have separate journal rows for the same raw incident, never read one another's rows. Stale/rollback revisions may not supersede newer evidence.
6. Negative coverage `did_not_witness|unknown|unavailable` can use optional `journalPort.recordCoverage` under the same fence, but **never** creates a positive `journalEvent`. Missing coverage is `unavailable`, not proof an event never occurred.

## Required integration for Agent A and follow-up M3 adapter
**No Agent A schema/storage files were touched.** Wire this new recorder into `lsa-essential-e1-candidate/src/perception/shadowRuntime.mjs` only at the successful `correlator.ingest` return containing accepted `observations` (both radio and regular) **before PS3 `noteSalience`**. Call the authenticated PS2/P2 binding adapter, not a generic transcript callback. If direct async SQLite writes would block the pipe, enqueue immutable accepted receipts into a bounded, loss-accounted queue, then consume under `withTimelineWrite`. Do not declare receipt committed until append confirms transaction, and never silently drop overflow. The standalone adapter must call the same shared-brain recorder. M3 event storage should be disabled until Agent A's durable journal port and official adapter bind are available.

Expected injected interface:
```js
new WitnessedEventRecorder({
  authorize: ({observation,candidate,stage}) => verifiedP2AndPs2OwnerOrNull,
  withTimelineWrite: (timelineId,synchronousCommit) =>
    p2Store.withTimelineWrite(timelineId,synchronousCommit),
  journalPort: {
    append: ({event,sourceEvidence},db,snapshot) => ({inserted:true}) // or {duplicate:true}
    // optional: recordCoverage(record,db,snapshot)
  },
  now: () => monotonicMilliseconds,
})
```
Write `journalPort.append` as a **synchronous** SQLite transaction inside the callback. Async promises inside the fence are rejected. Normalize accepted observations even when mundane; no PS3 salience or Luna threshold. Audit that PS2 `observationStore.put` actually accepted before handing to M3. PS2's current `observedAt.receivedUtc` is receipt time, **not** exact in-game occurrence time; preserve `gameTick` separately.

Promotion: call `bufferBeforePromotion` only for prepromotion PS2 receipts already qualified by native witness and stable owner lifetime. On verified promotion, call `importOnPromotion` with current CharacterId and original `ownerProof`. Same captureRef alone is insufficient: exact incarnation, encounter, host run, epoch and owner alias are all required. Flush the buffer after attempted import or authority loss, and do not claim imported observations survive process restart before persistent capture is implemented.

## M9 future native wiring (not yet GTA-active)
Native sampling seams exist in `native/intelligence/SensorAdapters.cs` and `IntelligenceIntegration.cs`. **Current PS2 `contracts.mjs` does not accept these richer event kinds or producer identifiers.** Thus M9's detector produces `m9_candidate` only and sets `requiresPs2WitnessReceipt:true`; attempting to send it as an existing PS2 event would violate the locked wire contract and invent witnessing.

To activate M9, in a separate contract/versioned PR:
- RAGE native layer must sample vehicle collision callbacks with stable native receipt IDs and speed delta, roll orientation/ground contact, airborne transition/landing, native water flags, wanted level, and real game Wasted/Busted outcomes. Document API-native reliability and sampling cadence before enabling each producer.
- Extend native PS2 signal and witness schemas with named native event kinds and proof fields, preserving old clients' behavior. Re-verify source/destination actor capture refs, distance, LOS/acoustic awareness, current native run and world epoch. Apply `WitnessPolicy` per observer; proximity alone is NOT a witness.
- Correlate/dedupe per physical incident and produce PS2 `Observation v2` (or an approved backwards-compatible typed extension). Map to `journalEvent` v1 **only after the qualified witness receipt**, not on M9 candidate creation.
- Keep PS6 unsolicited memory callbacks deferred to Director priority/permission and memory recall integration. Do not bypass the player turn or read unfinished journal commits.

## Known limits and remaining acceptance
- Tests are deterministic fixture-based and cannot prove Rockstar natives reliably expose collision, orientation, pursuit outcome or promotion-bound source lifetime; no in-GTA acceptance performed.
- The approved strict `journalEvent` v1 cannot include arbitrary extra scene/timestamp detail, so journal must store immutable raw sidecar and M4 can retrieve provenance from that owned store after A integrates.
- A native source callback can be lost, out of range or partial. Treat absent evidence as unknown; do not force a positive memory. The current M9 candidate detector receives native snapshots from a **future** GTA adapter and is not automatically a live producer.
- Full durable retention, crash recovery and cross-session replay depend on Agent A's M2 SQLite journal port. Perceived observations recorded only into a process-local grace buffer are **not durable**.
- Real acceptance: two promoted observers of same incident, ambiguous protagonist, save/load rollback, native disconnect, captureRef reuse, ten-thousand-signal storm, three simultaneous NPCs, crash/recovery, and PS6 callback admission. These require integrated versions and real GTA receipts.

## Changes owned by Agent B
`lsa-shared-brain/src/events/journalEventNormalizer.mjs`,
`lsa-shared-brain/src/events/witnessedEventRecorder.mjs`,
`lsa-shared-brain/src/events/m9EventProducers.mjs`,
`lsa-essential-e1-candidate/tests/memory-agent-b-events.test.mjs`,
`.github/workflows/memory-agent-b-events.yml`,
`docs/plans/promoted-npc-memory/agent-handoffs/AGENT-B.md`.
