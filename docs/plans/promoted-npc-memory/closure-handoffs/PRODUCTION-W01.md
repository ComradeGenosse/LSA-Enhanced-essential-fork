# Production closure W01 / T1 — original C-01 native authority

**Target:** PR #94 `0201731973a1c02a8852271897e2c8df420396b9` -> draft into `integration/memory-closure-final-k-20261011`.  
**Branch:** `feature/memory-k-t1-native-c01-20261011`.  
**Last implementation commit before handoff:** `6954cb2ff9cc00163885baa3c59382ebe657fde9`. The handoff itself creates a later commit, so **pin the final PR head with GitHub**; no self-referential SHA is possible inside the committed document.  
**Verdict:** **A01 BLOCKED — missing original native normal C-01 typed/STT accepted-turn ABI.** Owner/protagonist hardening and a future-source v2 verifier are delivered, but this is not a genuine runtime C-01 receipt. **NO-GO** for GTA install, release, main merge, or physical acceptance.

## Source audit (pinned runtime)

- `native/promoted-characters/MemoryOwnerAuthority.cs::SampleMemoryNativeAuthority` samples a bounded full owner roster from P2/PS2 anchors and source-verified protagonist from `MemoryProtagonistSource.Sample`; v1 intentionally emits `acceptedTurns=[]`. T1 now checks the controlled protagonist before and after walking owners, and refuses any player switch or host-run/epoch change mid-sample.
- `native/intelligence/IntelligenceIntegration.cs` posts `memory_authority` on the existing owner fiber around lines 417–423, but the only original turn tuple binding around lines 633–674 is `TryDirectorOriginalTurnBinding` for **PS6/Director stock requests**. That is NOT the original ordinary accepted player typed/STT line. The original request frame is read from a pipe after separately reserved stock entitlement, not from a general Core acceptance callback.
- `lsa-essential-e1-candidate/src/perception/contracts.mjs::validateMemoryAuthorityPayload` explicitly requires `acceptedTurns.length===0` in v1. **Correct**: never relax it to accept synthetic positives.
- `lsa-essential-e1-candidate/src/integration/essentialGlue.mjs::bindM2Turn` still uses older M2 capture; `m2EssentialCapture.mjs` requires exact `verifyCurrentTurn().identity` and real accepted-input ports, not currently available through the original runner. These shared integration files belong only to K/T3.
- `native/intelligence/MemoryProtagonistSource.cs` uses the actually controlled player handle + game model + player anchor to emit Franklin/Michael/Trevor/**unknown**; never infer the player from speaker name, proximity or reused ped handles. The existing native source is supported for read-only player snapshots but still needs pinned net481 and physical verification.

**Precisely missing:** a callable/event subscription in the **pinned original Essential Core/native host** emitted at the ordinary final accepted typed/STT input transition that binds original `pedId,turnId,generationId,sessionNonce` to the real still-live speaker/player and source game tick, with cancellation/retirement and source run/epoch. The observed Director stock binding is ticket-scoped only. The current normal runner's JS accepted text/STT and provider generation state cannot substitute for this native-origin callback. T1 did not invent an accepted-turn producer.

## Delivered code / ownership

- `native/promoted-characters/MemoryOwnerAuthority.cs`: native same-fiber initial/final protagonist sample, host/world epoch recheck, abort on transition. **Keeps acceptedTurns empty.**
- `native/intelligence/memory-c01/OriginalC01SourceGate.cs`: immutable structural tuple/owner/player proof shapes and source-independent policy; an explicit pinned-source-unavailable gate. `PinnedSourceExposed` is false, `TryReadPinnedAcceptedTurn()` is null. This file **does not implement an accepted-input callback, never creates a claim, and is not globally registered**. K may add its compile entry only if needed for future verified implementation.
- `lsa-essential-e1-candidate/src/memory/nativeMemoryAuthority.mjs`: v1 nonempty turn arrays are rejected. Optional separate `subscribeAuthenticatedOriginalC01Frames` **private privileged port** adds strict versioned read-through; absent it, `verifyCurrentTurn` continues to return null. Positive v2 evidence checks immutable tuple, source, P2 alias/profile, current owner incarnation+encounter+observer captureRef, host/world/stream/adapter epoch, monotonic sequence, exact protagonist player captureRef/model key, ped equality, source game ticks and <=1,000-ms bounded expiry; replacement turns retire prior generations. Readback includes exact `identity` required by T3's M2 adapter. Delete, retired profile, player switch and disconnected stream deny writes.
- `lsa-essential-e1-candidate/tests/memory/{nativeMemoryAuthority.test.mjs,nativeC01Authority.test.mjs}`: v1 cannot grant C-01 (including mock flags); privileged v2 schema fixtures exercise two promoted owners, Franklin/Michael/Trevor/unknown, tuple reuse, generation/session, player changes, spoofed source, out-of-order sequence, expiry, native retirement and suspended SQLite profile.
- `native/intelligence/memory-c01-tests/{OriginalC01SourceTests.csproj,Program.cs}`: isolated source-policy tests for tuple, models, owner, incarnation, invalid nonce, retroactive/expired ticks and explicit unavailable-source gate. **Structural positives in tests are not producer positives.**

**No K-owned registration, protocol, compile list, intelligence client, bootstrap, runner or global source was edited.** No SQLite path, secondary daemon or callback registration added.

## Proposed exact protocol revision — K owns admission

**DO NOT deploy this revision at this pin.** It is an exact proposed v2 *additional* native frame, not a change to existing v1 `memory_authority`.

The original Core callback, when and ONLY when independently proven in the pinned native host, should enqueue one immutable native original accepted event with the Core-provided game tick and tuple. The native owner fiber then rechecks same host/epoch/observer/player against P2, emits a complete positive receipt only if it is source-authenticated, and never synthesizes it from a Director, PS3, JS, transcript, model or clock estimate. K adds a strictly negotiated, max-8192-byte, sequenced `memory_c01_accepted` message version 2 to the **existing** authenticated native pipe:

```json
{
  "version": 2,
  "type": "memory_c01_accepted",
  "streamId": "<UUID>",
  "adapterEpoch": "<UUID>",
  "sequence": 42,
  "payload": {
    "c01ProofVersion": 2,
    "source": "original_essential_c01_normal_accepted_callback",
    "status": "accepted",
    "sourceMode": "typed",
    "hostRunId": "<UUID>",
    "worldEpoch": 1,
    "acceptedGameTick": 123,
    "expiresGameTick": 623,
    "identity": {
      "pedId": "101", "turnId": "normal-1",
      "generationId": 7, "sessionNonce": 2
    },
    "nativeOwnerPedId": "101",
    "ownerProof": {
      "hostRunId": "<UUID>", "worldEpoch": 1,
      "observerCaptureRef": "<UUID>",
      "incarnationId": "<UUID>",
      "encounterId": "<UUID>",
      "ownerAlias": "promoted.<UUID>"
    },
    "protagonist": {
      "source": "native_player_model",
      "key": "franklin",
      "playerCaptureRef": "<UUID>",
      "sampledGameTick": 123
    }
  }
}
```

Here `<UUID>` is descriptive only; production packets require actual lowercase version-4 UUIDs. The frame above is a **schema example, NOT an observed original receipt**. Fields are exact: no extra fields or missing values; owner keys match the existing v1 positive owner index; integer generation/session are nonnegative and nonce >0, safe-integer bounded; `sourceMode` only typed/stt; provenance category fixed; future/expired/source-time tick and player/owner mismatch forbidden. No wraparound claim: reject ambiguous tick rollover and renegotiate epoch. Each receipt lives no longer than 1,000ms and a newer genuine turn supersedes the previous turn. No v1 accepted turns are enabled.

K must validate the new v2 frame **before** the private subscription through `ShadowRuntime.ingest(...,{authenticated:true})` plus original Core producer attestation (not a caller flag). Require authenticated hello/capability negotiation, native-issued host run and epoch, adapter/stream matching, single monotonic sequence shared with v1, 8,192-byte bound, no old stream reuse, full native provenance field checking, source-time-to-current admission <=1s, and native roster reconciliation. The JS verifier does not independently prove source origin; the native producer + strict pipe admission must. A network writer or raw `options` callback is not an eligible producer. Avoid the existing unrestricted `subscribeAuthenticatedNativeFrames` seam for C-01 unless K proves dispatch isolation. K must retire both subscriptions on the same socket disconnect/epoch/save rollback and before restarting sessions.

**Future K integration sequence (only after original Core callback proof):**

1. Prove the actual original accepted-turn Core callback and its tuple/source tick from a pinned binary/source inspection. Build native module from that callback only; never use `TryDirectorOriginalTurnBinding`, `OriginalTurnReceipts`, PS3 or JS `DialogueHistory` as replacement.
2. On existing owner fiber, reconcile native callback's actual speaker ped handle+incarnation, P2 alias/encounter, controlled protagonist native player anchor, source time, host epoch and stream. Preserve `acceptedTurns=[]` in v1; send only v2 positive with complete proof.
3. K edits `IntelligenceChannel`, `IntelligenceIntegration`, `PromotedCharacters.csproj`, `contracts.mjs`, `shadowRuntime.mjs`, `intelligenceClient.mjs`, `bootstrap.mjs` to add version-negotiated strict v2 validation and a private `subscribeAuthenticatedOriginalC01Frames(cb,onRetire)` AFTER authenticated native ingest; no synthetic injection path.
4. Bind this port to the **same single** `createNativeMemoryAuthority` instance as P2's current `profileForAlias` lookup, proving writable world/profile/timeline scope on every call. Wire `verifyCurrentTurn` into T3/K M2 **original accepted typed/STT** adapter. Return null on missing source, current generation switch, owner retirement or SQLite timeline freeze.
5. Run Node 24 on Windows/Linux, native .NET8 policy harness, pinned .NET framework native project build, original input receipt replay, full M0 scenarios, and separate authorized physical tests. Gate A01 is not complete on structural/mock-only positives.

## Test commands and evidence

```sh
node --check lsa-essential-e1-candidate/src/memory/nativeMemoryAuthority.mjs
node --test lsa-essential-e1-candidate/tests/memory/nativeMemoryAuthority.test.mjs lsa-essential-e1-candidate/tests/memory/nativeC01Authority.test.mjs
dotnet run --project native/intelligence/memory-c01-tests/OriginalC01SourceTests.csproj --configuration Release
dotnet run --project native/intelligence/memory-authority-tests/MemoryAuthorityTests.csproj --configuration Release
```

**Executed in this agent environment:** an isolated V8 JavaScript evaluation of the exact fetched JS source and both fetched test bodies (import/test/assert shims, not Node's runner): **19 source-contract fixtures passed, 0 failed** after fixing tuple separator and profile lookup. This does **not** establish Node test-runner, Node 24, native DLL compilation or runtime source provenance. Available container has Node 22 but no repository clone (GitHub DNS unavailable) and no dotnet; therefore **Node CLI and both .NET commands were NOT RUN**, and pinned net481 native project, platform CI, GTA, streamer, installer and physical tests are **NOT VERIFIED**. Report exact per-SHA CI run links from GitHub once available; pending/not-present does not mean green.

## Required final acceptance / stop conditions

**A01 remains BLOCKED**. A source-authenticated ordinary typed/STT Core callback must be demonstrated before K can mark A01 complete. No `nativeVerified:true` mock, source-mode string, JS callback, normal transcript, v2 hypothetical example, stock Director tuple, model/provider output, or passing policy fixture is that proof. Existing memory capture remains disabled if original acceptance cannot be demonstrated.

**Integration owner:** K. Other agents may consume the proposed verifier interface but may not activate it or alter shared files. No merge to main, GTA installation, production memory enablement, or physical testing was performed.
