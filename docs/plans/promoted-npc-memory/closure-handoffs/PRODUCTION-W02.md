# Production W02 / T2 — M3 original source-time PS2 witnessing

**PR:** https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/105 (**DRAFT**).  
**Branch:** `feature/memory-k-t2-m3-source-time-20261011`.  
**Exact immutable starting commit:** PR #94 `0201731973a1c02a8852271897e2c8df420396b9`.  
**Last specialist source/test commit before this handoff:** `7d24d922a4a89842850b2636ef4d205e25546c30`. The commit *containing* this handoff must be taken from the final draft PR head after the file is pushed; a file cannot embed its own future commit SHA.

## Delivery and exact changed sources

- `native/intelligence/memory-m3/SourceTimeWitnessLedger.cs` — bounded (2,048 native records / 8 per frame) immutable owner-at-witness-tick receipts keyed by **original native signalId + observerCaptureRef + host/epoch**, exact incarnation/encounter/alias; no timer-based historic construction. Requires native game clock to equal witness receipt's source tick; delayed source callbacks deny. Separate two-observer receipts, no reused captureRef with changed lifetime, no mixed host/adapter epoch. `PeekBatch` + `AcknowledgeQueued` only after original pipe accepted bytes; queue overflow/duplicate/denied/retired counters. Participants are optional only if a separate source-time native resolver supplies exact identity; never guessed. Witness, explicitly native-reported, and unknown are kept distinct.
- `native/promoted-characters/M3SourceTimeOwnerSampler.cs` — new P2-native current physical incarnation lookup callable by K **inside the original native witness source**. Checks original Host anchor/Ped identity/owner registration/liveness/alias/epoch with `MemoryOwnerProofPolicy.ExactOwner`. Never builds an earlier record on a later callback. The native module requires K's csproj/owner-fiber inclusion.
- `lsa-shared-brain/src/events/m3SourceTimeAuthority.mjs` — authenticated-reader-only (no public push or fixture setters), consumes explicitly negotiated `m3_source_time` frames *after K's existing named-pipe envelope authentication*, host/stream/epoch/sequence fencing, sealed signal owner receipts and exact claim ticks, bounded TTL (<= 120 s) and collision retirement. Resolves **every** PS2 claim against a matching original native signal + observer lifetime + modality + source tick. Optional source-time participant proofs require the same native event; conflicting/absent actors remain unresolved. Without frames it returns null, not current-owner-derived history. `verifyNativeCoverage` and `resolvePrepromotion` deliberately remain null until real ABI support.
- `lsa-shared-brain/src/events/m3ObserverOwnerBinder.mjs` — forwards the original PS2 observation and enforces correlation for *every* claim: `details.eventSignalId`, claimId, sourceReceiptId, tick, channel, basis, observer identity, episode observationId/revision, native sample owner/host/epoch. Exposes `identity.sourceTimeEvidence` for K's eventual **atomic P2 sidecar** extension; no claimed source-time proof from a current 250-ms owner snapshot.
- Existing W02-adjacent M3 test fixtures updated: `lsa-essential-e1-candidate/tests/m3-closure-agent-d.test.mjs`, `m3-completion.test.mjs` supply exact native signal-to-claim attestation rather than bare `nativeVerified:true` tags.
- New tests: `lsa-essential-e1-candidate/tests/memory-k-w02-source-time.test.mjs`, `native/intelligence/memory-m3-tests/{MemoryM3Tests.csproj,Program.cs}`.
- Dedicated `.github/workflows/memory-k-w02-source-time.yml` for Node24 Linux/Windows and .NET8 Windows isolated policy harness. This workflow is *not* physical GTA acceptance, and passing fixture tests can never flip the integrated A02 or M0 scenario flags.

## K-only mandatory integration steps (NOT modified by T2)

1. Include `SourceTimeWitnessLedger.cs` and `M3SourceTimeOwnerSampler.cs` in the original native project compilation (`native/promoted-characters/PromotedCharacters.csproj`), avoiding a second fiber/pipe/SQLite owner. Wire a single `SourceTimeWitnessLedger` to the current native Host, original PS adapter epoch, `Game.GameTime`, `PromotedCharactersIntegration.ResolveM3OwnerAtNativeSource`, and an optional **truly native source-time** participant resolver.
2. Call `ledger.Record(originalRawSignal,originalWitnessReceipt)` **at the original PS2 witness source** while its independently sampled owner and exact tick are available. Do not do this from JS `acceptedObservationTap`, from `Publish` 250 ms later, from PS3, from memory model text, or from current native owner sampler. Existing `WitnessPolicy` often copies `signal.gameTick`; if actual witness sampling is deferred into a *later* game tick, it cannot honestly attest the earlier signal and MUST fail closed. K must add a genuine source-time hook to satisfy A02; current native ABI may not provide it.
3. Publish native `m3_source_time` **new negotiated type**, payload `{sourceProofVersion:1,hostRunId,worldEpoch,proofs:[...]}`, via existing `IntelligenceChannel.Send` only. Check serialized UTF-8 is <= 8,192 bytes, original adapterEpoch/streamId/sequence, authenticated hello/capability, owner-fiber order, dropped frames, and channel retire. `ledger.PeekBatch()` must be followed by `ledger.AcknowledgeQueued(batch)` ONLY after successful `Send`. Do not claim this is SQLite persisted. No backchannel or alternate transport.
4. K extends original `contracts.mjs`, `shadowRuntime.mjs`, `intelligenceClient.mjs` to admit and dispatch only post-authenticated source-time receipts with the same original channel host-run/world-epoch and stream/sequence enforcement. The `subscribeAuthenticatedNativeFrames(accept,retire)` port must feed `{frame}` only **after** native pipe validation. No tests or UI may call `accept` directly in production. Example:
   ```js
   const sourceTime = createM3SourceTimeAuthority({
     subscribeAuthenticatedNativeFrames: registerAuthenticatedM3FrameSource,
     currentAuthority: existingNativeMemoryAuthority,
     onLoss: telemetryLoss,
   });
   const m3 = createM3Ps2ObserverAdapter({
     ps2: intelligence.runtime,p2: p2Store,store:p2Store,
     nativeAuthority: sourceTime,onLoss: telemetryLoss
   });
   ```
   The example `registerAuthenticatedM3FrameSource` is a **required K integration adapter**, not an API currently present in the repository.
5. K extends original P2 `journalEventNormalizer` / serialized journal sidecar contract so the **exact `identity.sourceTimeEvidence` native sourceReceiptId(s)** are atomically stored and verified with their PS2 `eventSignalId`, journal event and source hash. Current sidecar only persists the PS2 observation and ownerProof; its strict `verifyM3DerivedEvent` parity rejects arbitrary post hoc fields. T2 intentionally did not change this shared normalization or `integrationPorts.mjs`. Until K implements exact parity, A02 cannot pass.
6. Route `m3.acceptedObservationTap` after actual accepted correlated PS2 and *before* PS3, synchronously and without SQL. The existing `M3BoundedIntake` performs bounded async single-P2-writer work and commit-time source reauthorization. Reauthorize historical source tickets and current native ownership again inside P2 transaction, and test recovered P2 readback. Demotion, recycled incarnation, host/adapter stream change, save rollback, timeline switch, native pipe retirement => `m3.retire();sourceTime.retire()`.
7. **Negative coverage:** Existing v1 native source lacks event-complete certified observer coverage. W02 intentionally **does not certify negative** from `WitnessPolicy` geometry, skipped observer, lack of PS2/PS3 entry, or native queue overflow. `verifyNativeCoverage()` returns null: absent fact reads `unknown`. K must independently establish an event-specific native coverage certificate and authenticated PS2 correlation before enabling `did_not_witness`.
8. **S08 prepromotion:** No native-reserved future CharacterId/ownerAlias tied to a prepromotion physical incarnation exists at this baseline. `resolvePrepromotion()` returns null; do not manufacture the future identity from a later P2 profile. Enforce native first-event source and elapsed <= 120 s if an actual native reservation ABI is subsequently delivered. No unrelated ambient import.
9. **Participant identity:** The ledger can carry only separately sourced original native participant proofs. K must supply a real native resolver for source/target/protagonist on the same sampled tick, **not** `MemoryProtagonistSource.Sample` taken later or current player selection. No proof => `unresolved:<claimId>`.

## Tested cases / evidence level

New Node suite covers two promoted observers on same native incident with separate P2 journal/evidence sidecars; unknown before native receipt; delayed/mismatched observer lifetime/tick; exact-signal duplicate/readback and revision spoofing; explicit report-only vs witnessed; source collision and replay; source retire/TTL; P2 timeline rollback; missing certified negatives; optional native-proven protagonist identity and invalid/unknown provenance. Original Agent D M3 fixture suite is upgraded to source-signal correlation. C# harness tests two native P2 owners, exact game-tick rejection, native replay, owner lifetime recycling, host change, positive acknowledgment, source-only participant and >2,048 bounded overflow.

**Commands:**  
`node --test lsa-essential-e1-candidate/tests/memory-k-w02-source-time.test.mjs`  
`node --test lsa-essential-e1-candidate/tests/m3-completion.test.mjs`  
`dotnet run --project native/intelligence/memory-m3-tests/MemoryM3Tests.csproj --configuration Release`

**Execution status at handoff drafting:** New W02 exact-head workflow was **queued** (not passed), and no GTA runtime receipt, no local .NET/native build, no original pinned Essential compilation, and no physical source-time capture was obtained. Workflow runs: https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions?query=branch%3Afeature%2Fmemory-k-t2-m3-source-time-20261011 . Check **latest PR head**, not a previous run, before accepting. Real P2 SQLite/file-backed original integrated replay plus exact sidecar extension belongs to K.

## Gate decision

**A02 = BLOCKED / controlled GTA testing = NO-GO.** Source-time native capture ABI is not original-runtime registered; negative certification, native reserved S08 identities and atomic raw native ticket persistence are incomplete. Fixture witnesses are not evidence that NPCs witnessed anything in GTA. No main merge, installation, paid cloud traffic or runtime enablement.
