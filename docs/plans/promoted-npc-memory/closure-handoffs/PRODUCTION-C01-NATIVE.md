# C01-NATIVE / D02 — independently authenticated CURRENT owner + controlled player

**2026-10-12 · Specialist draft · A01 BLOCKED / no GTA deployment.**
Base: T1 PR #103 `daa8759389cc79b155769c3338697b9332f8840e`.
Plan: PR #113 D02 (explicit revised A01), PR #97 W01; original Core audit PR #110.
Branch: `feature/memory-k-c01-native-owner-corroboration-20261012`.
**This does NOT enable or claim an accepted ordinary player turn.**

## Source provenance and positive assertions

- Native source: `PromotedCharactersIntegration.SampleMemoryCurrentOwnerPlayer()` in `native/promoted-characters/MemoryOwnerAuthority.cs`. Called **only** by K from the existing Core owner fiber after current P1/P2 anchor/roster maintenance. It uses `HostContext.HostRunId`, `WorldEpoch`, source `Game.GameTime` and `Host.Anchors` to read actual promoted NPC incarnation, encounter, owner alias, P1 owner claim, native actor ped, reference-equal live ped object, memory address and native retained observer captureRef. No address is transmitted.
- Controlled player: `MemoryProtagonistSource.Sample()` checks real `PLAYER_PED_ID`, actual local player ped/model, active switch/cutscene/network vetoes, exact player anchor (captureRef, handle, address, retained live source). Double-sampled on the same owner fiber before/after owner roster, with host/world recheck. Source records `franklin`, `michael`, `trevor` or `unknown`, never a guessed speaker.
- Pure policy: `MemoryOwnerProofPolicy.ExactOwner` plus `ExactActorLifetime`. The source must match native ped and **the exact observer captureRef, P1 incarnation and encounter**; matching a recycled handle alone is refused.
- Proposed new **separate** payload: `memory_current_owner_player` version 1, with `nativeOwnerPlayerProofVersion:1`, `source:'native_p2_owner_fiber_current_only'`, `hostRunId`, `worldEpoch`, `sampledGameTick`, up to 16 complete `owners[]` (`observerCaptureRef`, `incarnationId`, `encounterId`, `ownerAlias`, `hostRunId`, `worldEpoch`, `nativeActorPedId`, `sampledGameTick`), and `protagonist` (`source:'native_player_model'`, `key`, `playerCaptureRef`, `sampledGameTick`).
- **No C-01 accepted player line in this frame.** T1 `memory_authority` v1 stays byte-for-byte compatible and `acceptedTurns=[]`. `OriginalC01SourceGate.PinnedSourceExposed=false`; proposed `memory_c01_accepted` v2 stays DISABLED. Original Core `SendTextPrompt`/`SendMicStop` and PS6 stock `TryDirectorOriginalTurnBinding` are NOT substitutes.

## Synchronous JS read-through interface (K must privately wire)

New specialist module: `lsa-essential-e1-candidate/src/memory/nativeCurrentOwnerPlayerAuthority.mjs`

```js
import {createNativeCurrentOwnerPlayerAuthority} from './memory/nativeCurrentOwnerPlayerAuthority.mjs';
const nativeCurrent = createNativeCurrentOwnerPlayerAuthority({
  // K only: successful original authenticated IntelligenceClient pipe ingest.
  // NEVER an arbitrary caller callback, public flag, socket or test stub.
  subscribeAuthenticatedNativeOwnerPlayerFrames:
    (onFrame,onRetire)=>intelligence.subscribeAuthenticatedNativeOwnerPlayer(onFrame,onRetire),
  // K only: same single P2 store + verified host/world/profile/timeline.
  profileForAlias: alias => {
    if(store.timelineWritable!==true || !store.verifiedHostContext) return null;
    const p=store.list().find(x=>x?.promotion?.ownerAlias===alias &&
      x.worldProfileId===store.worldProfileId && x.status!=='retired');
    return p ? {...p,timelineWritable:store.timelineWritable,
      worldEpoch:store.verifiedHostContext.worldEpoch} : null;
  }
});
// At original normal-turn START, before backend acceptance:
const opaqueLease=nativeCurrent.bindActorAtTurnStart({
  pedId:originalActorPedId,characterId:boundP2CharacterId,
  ownerAlias:boundP2OwnerAlias
});
// AFTER D01's separate source-pinned ORIGINAL backend final acceptance,
// and AFTER a newer native receipt has been independently authenticated:
const nativeProof=nativeCurrent.verifyCurrentOwnerAndPlayer({
  lease:opaqueLease,identity:backendReceipt.identity,
  characterId:boundP2CharacterId,ownerAlias:boundP2OwnerAlias
});
// null means NO memory write. Never reinterpret nativeProof as accepted input.
// Recheck the same lease/proof and D01 backend source under P2 writer fence.
```

A lease is an opaque WeakMap-backed reference to the native-bound preturn
actor lifetime, owner, host/stream/adapter, player captureRef, avatar and
native source sequence. A **newer** native authenticated sample, same
incarnation/encounter/captureRef and actor ped, same controlled player and
writable P2 association must exist before a positive read-through result.
Lifetime: sample <=750ms, preturn lease <=1000ms (both tunable only within
hard max 1000ms); current native game tick cannot regress. Re-keying the
lease to another accepted turn is denied. `verifyCurrentOwnerAndPlayer`
returns a frozen `NativeCurrentPlayerAndOwnerV1` with
`nativeCurrentOwnerVerified:true`, `originalBackendAccepted:false`;
it contains no player dialogue, `sourceMode`, accepted-line or source
authorization. `unknown` is valid ONLY with positive native controlled-player
captureRef; it never authorizes guessing Franklin/Michael/Trevor. The output
has `humanPlayerScope:'single_local_human'` for K mapping to one stable
human player key across avatar switches; K must NOT scope durable player
memory by avatar. Avatar switches revoke in-flight leases.

**Critical stop condition:** if original backend cannot establish which
original Core actor ped was bound *before* the accepted input, this API
cannot cure that missing source link. A lease minted only after acceptance,
or a later equal ped handle without continuous captureRef/incarnation
lifetime, must not be treated as source-time actor proof. Keep A01 blocked.

## Exact K-owned registration / protocol patch (NOT edited here)

1. `native/promoted-characters/RuntimeEntry.cs`: pass
   `integration.SampleMemoryCurrentOwnerPlayer` as one **additional**
   constructor delegate to the existing `IntelligenceIntegration`; retain
   `integration.SampleMemoryNativeAuthority` unchanged.
2. `native/intelligence/IntelligenceIntegration.cs`: add a separate
   `readonly Func<object> memoryCurrentOwnerPlayerSample` and optional
   constructor argument; in the **existing** `now>=nextMemoryAuthority`
   block after the existing `channel.Send("memory_authority",sample)`,
   send `channel.Send("memory_current_owner_player",sourceSample)` only
   when nonnull. Same owner-fiber/stream/adapter/monotonic send sequence;
   no new fiber, pipe, actor action or extra source. Do not send any v2
   `memory_c01_accepted` frame.
3. `native/promoted-characters/PromotedCharacters.csproj`: current
   specialist code lives in existing compile-included
   `MemoryOwnerAuthority.cs`, `MemoryProtagonistSource.cs` and
   `MemoryOwnerProofPolicy.cs`; no new native compile entry is needed.
   K must still build/pin the actual net481 binary using real reference
   libraries. No stubbed RPH.
4. `lsa-essential-e1-candidate/src/perception/contracts.mjs`: negotiate
   the new **distinct CURRENT-only frame**, exact payload keys listed above,
   valid UUIDv4/alias, canonical positive native ped string, uint32 game
   tick, <=16 unique observer refs/aliases/peds, and positive player
   reference. Keep v1 `acceptedTurns.length===0` and reject
   `memory_c01_accepted` v2. Require frame <=8192 bytes.
5. `src/perception/shadowRuntime.mjs`: only after the original authenticated
   hello+stream+adapter+host/world epoch and strict incrementing frame
   sequence, require every owner to equal current `observer_index` owned
   P2 incarnation/encounter; require native playerCaptureRef to be a
   currently retained `player` anchor (not NPC). Reject stale/unknown
   indexes and epoch transitions, no fallback on nearest ped or JS history.
6. `src/perception/intelligenceClient.mjs`: introduce a **private**
   `subscribeAuthenticatedNativeOwnerPlayer(onFrame,onRetire)` used
   ONLY for `accepted && v.type==='memory_current_owner_player'` after
   `ShadowRuntime.ingest(v,{authenticated:true})`. Retire subscriber on
   authenticated hello/world_epoch, invalid source fault, socket close,
   stop, native shutdown. It must not be exposed over public APIs or
   inferred from a `nativeVerified` field.
7. `src/bootstrap.mjs`: construct the verifier from that single private
   source and the SAME live P2 profile/timeline store. K owns disposal.
   Only K's D03 source arbiter can pair its proof with independent
   `OriginalBackendAcceptedInputV1` D01 evidence; match preturn lease,
   full original `pedId/turnId/generationId/sessionNonce`, backend
   source revision and current generation, actual NPC lifetime, current
   native player/world, same owner/profile and atomic P2 write fence.
   Abort on every await/cancellation/reset/mic correction/timeline change.
8. The **original acceptance** happens only at D01's original backend
   source-pinned final acceptance point. Native D02 is current-state
   corroboration, not contemporaneous native post-acceptance attestation.
   Do not promote either an E1 JS transcript or a named-pipe queued write
   into acceptance.

K should validate that the P2 profile returned from `profileForAlias`
is currently writable; a profile object without an affirmative
`timelineWritable:true` MUST NOT grant D02. An authenticated stream alone
cannot authenticate the source actor at acceptance if preturn capture
was absent; no silent fallback.

## Native + Node 24 verification

Source fixtures added:
- `native/intelligence/memory-authority-tests/Program.cs`: actor capture,
  ped, incarnation, encounter, entity/address/anchor and registration
  mismatch cases, using real production pure policy.
- `lsa-essential-e1-candidate/tests/memory/nativeCurrentOwnerPlayerAuthority.test.mjs`:
  opaque lease, post-binding native sample, immutable original tuple,
  two NPCs, reused handles, current P2 timeline, source rollback and
  replay, disconnect and host epoch, avatar transitions and unknown,
  absence of invented accepted-turn status.

Commands after K integration / clean exact head checkout:

```sh
node --check lsa-essential-e1-candidate/src/memory/nativeCurrentOwnerPlayerAuthority.mjs
node --test lsa-essential-e1-candidate/tests/memory/nativeCurrentOwnerPlayerAuthority.test.mjs
dotnet run --project native/intelligence/memory-authority-tests/MemoryAuthorityTests.csproj --configuration Release
# K only: real pinned source + net481 compile and integrated authenticated pipe tests.
```

No clean repository checkout, .NET SDK or authentic pipe is available in
this specialist execution environment. **These tests are committed but NOT
claimed as executed**, until exact commit-specific CI job receipts exist.
The Node test injects synthetic *private port frames*, not actual authenticated
GTA frames. Its success cannot prove K's shared registration, original
native source execution, source-time actor link or backend acceptance.

## Exit verdict / limitations

**D02 SOURCE CODE DELIVERED; D02 PRODUCTION AUTHORITY BLOCKED pending K's
authentic native registration, protocol admission, real pinned native compile,
backend preturn actor association and integrated source receipts. A01 NO-GO.**

Do not merge to main, install GTA, activate provider calls or generate
synthetic accepted line receipts. P2 is one human player across
Franklin/Michael/Trevor/unknown (avatar retained as provenance), but
NPC owners remain distinct. No SQLite data was changed here.

The handoff cannot contain its own final commit SHA; K must pin the PR head
from GitHub and record exact CI receipts for that head before acceptance.
