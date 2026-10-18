# Memory Completion Agent G — M9 handoff

**Base:** PR #61 @ c26948cacf2e00b076ec1b71fb1af6f8cf1962c9  
**Branch:** feature/memory-m9-completion-20261011  
**Status:** M9 candidate and cue groundwork implemented and test harness committed. NOT registered in a running GTA host, NOT a PS2 witness source, NOT accepted for deployment. Agent H owns common registration.

## Deliverables

- **lsa-shared-brain/src/events/m9EventProducers.mjs:** hardened candidate detector. Verifies adapterEpoch/hostRunId/worldEpoch, capture scope, monotonic/tick order, freshness and optional synchronous native-host verification hook. Detects collision-backed significant crashes, rollovers, grounded stunts, water/submersion transitions, wanted-level changes, and explicit Wasted/Busted receipts from qualifying snapshots. No first-sample inference, sparse-sample edges or speed-dip-only crashes. Deterministic UUIDv4-form event IDs, bounded 512-receipt deduplication and 1,500 ms maximum continuity interval. All outputs are m9_candidate, never M3 journal events or witnesses.
- **native/intelligence/m9/M9NativeDamageAdapter.cs:** source-specific adapter from the actual pinned DamageTracker/SensorAdapters RawSignal fields for vehicle collision-classified damage >=35. Requires a verifier for the exact pinned callback signal, current player/vehicle EntityAnchors, callback freshness and capture refs. Produces neutral collision evidence; does not invent impact speed, other-vehicle identity or witness proof. No GTA-native calls were added. Agent H must include this file in the production native build if wiring it.
- **lsa-shared-brain/src/events/m9MemoryCues.mjs:** typed, inert PS6 cue proposal. Requires a positive direct M3/PS2 witness record matching eventId, native run, host, epoch, player capture, CharacterId, world, timeline and protagonist identity, plus mandatory synchronous authorizeWitness callback. Reported/unknown facts cannot become cues. Explicit player-priority/mic/interrupt/owner/timeline/Director checks fail closed. 45s per-NPC and 180s per-family cooldown, 256-entry deduplication and forged-scope protections. The output requires future Director admission, has 2s expiry, and has spokenText:null. No model call, ticket, playback or new executor.
- **Tests:** lsa-essential-e1-candidate/tests/memory-m9-completion.test.mjs and native/intelligence/m9-tests/*. Existing Agent B M3/M9 fixtures are also selected. CI: .github/workflows/memory-m9-completion.yml for Node 20/24 across Windows/Ubuntu and the isolated net481 native harness on Windows.

## Native source and integration boundary

1. Agent H must register an owner-fiber, run/epoch-fenced snapshot intake from current HostContext and EntityAnchors. A JSON authenticated flag is NOT authentication. The optional verifySource callback must revalidate the true native origin and player lifetime.
2. Existing DamageTracker-backed signal proof supports a classified vehicle collision with a real damage amount. The pinned callback does NOT supply crash speed delta; the new adapter sets damage proof, not measured velocity. Higher-level crash evidence cannot be fabricated from a speed drop. Callback provenance verifier must be furnished at integration time and must identify the exact RawSignal receipt.
3. Native orientation/roll, airborne/ground contact, water/submersion, wanted-level and Wasted/Busted source producers remain unregistered and unsupported in the current pin. Their classifiers accept only typed verified snapshots; do not feed guessed properties. Do not infer Busted from wanted zero or Wasted from a generic death sample. Verify each GTA API or callback on the pinned build before enabling.
4. M9 event candidates MUST NOT enter another NPC's memory automatically. Agent B's current M3 normalizer uses a closed event vocabulary and cannot accept a raw M9 candidate as a journalEvent. Agent H or a common-contract integrator must explicitly version/match source-qualified M9 evidence to PS2 witnessed observation plus a verified owner binding, then commit M3 journal evidence. Missing witness remains unknown.
5. Only after durable M3 commit can the future PS6 consumer supply the verified cue witness shape: status=witnessed; modality not report; certainty=direct; matching candidateEventId, observationId, witnessReceiptId, journalRecordId, characterId, worldProfileId, timelineId, observerCaptureRef, playerCaptureRef, protagonistKey (franklin/michael/trevor or unknown), nativeRun, hostRunId and worldEpoch. authorizeWitness must independently confirm that exact provenance; setting fields in user JSON is not proof.
6. PS6 Director must perform its existing C-06/C-11 authorization, original player-priority revalidation, interrupts, dedupe, cooldown and playback receipts. An M9 cue alone never authorizes speech. No changes were made to shared native bootstrap, pinned controller, Agent B normalizer, SQLite, Director runtime or essentialGlue.

## Offline harness commands

    node --check lsa-shared-brain/src/events/m9EventProducers.mjs
    node --check lsa-shared-brain/src/events/m9MemoryCues.mjs
    node --test lsa-essential-e1-candidate/tests/memory-agent-b-events.test.mjs lsa-essential-e1-candidate/tests/memory-m9-completion.test.mjs
    dotnet run --project native/intelligence/m9-tests/M9NativeTests.csproj --configuration Release

The native command requires Windows with .NET Framework 4.8.1 runtime and a supported .NET SDK. GitHub CI should be checked on the exact final head; writing the harness alone does not constitute a pass.

## GTA acceptance / physical dependencies (all outstanding)

- Verify assembly pin, DamageTracker callback classification/identity, native vehicle/player anchor correctness and full native producer wiring.
- Source-time trace roll angles, airborne and ground contact, water states, wanted levels, Wasted/Busted outcomes, sample gaps, handle reuse, respawn and GTA save/load.
- Demonstrate two NPCs witnessing independently, absent and obstructed NPCs not acquiring a memory, verified protagonist splits and unknown evidence staying unknown.
- Stress burst replay/ordering, 10k signals, timeline suspension, multi-NPC retirement/reload, and player speech/interruptions without spontaneous takeover.
- Verify PS2 accepted-observation binding, durable journal provenance, PS6 ticket and native playback receipt lifecycle through actual GTA tests before experimental enablement.

**Explicit gate:** The PR is for Agent H integration and review. It is not itself an installed, proven native event pipeline or evidence of GTA success.
