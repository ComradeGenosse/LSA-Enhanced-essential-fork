# Memory K D02 — native owner + player source integration handoff

**2026-10-12 · Agent B production source changes · draft PR #130 · A01/D03 still NO-GO**

- Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`.
- Base: PR #128, `integration/memory-k-final-source-closure-20261012`, verified branch base `e372841918a389b2fc194ff62a84c6eec3107fa0`.
- D02 branch: `fix/memory-k-d02-native-owner-integration-20261012`.
- Implemented code head immediately before this handoff: `7e7b97a3cdb10320dedf55e4b017223c6813ecec`; the handoff creates its own later SHA, check PR head for exact CI.
- External architecture authority: PR #113 D02; specialist source PR #117; original T1 PR #103.

## Implemented production paths

1. **Same original native owner fiber, no new producer thread:** `native/promoted-characters/RuntimeEntry.cs` passes `integration.SampleMemoryCurrentOwnerPlayer` as the extra `IntelligenceIntegration` constructor sampler, retaining the existing `SampleMemoryNativeAuthority` v1 delegate unmodified. `IntelligenceIntegration.Update()` sends `memory_current_owner_player` after roster/observer-index publication in the existing 250 ms `memory_authority` cadence; source exceptions/absence never generate a positive result.
2. **Negotiated version:** `native/intelligence/IntelligenceChannel.cs` conditionally advertises `memoryCurrentOwnerPlayerVersion:1` in its authenticated original hello if the native sampler exists. Existing `memory_authority` v1 and `acceptedTurns=[]` remain unchanged.
3. **Strict schema and authenticated intake:** `src/perception/contracts.mjs` checks exact v1 source, host/world/tick, valid v4 identities, canonical live ped, unique owner/alias/ped, controlled player and frame byte bounds. `src/perception/shadowRuntime.mjs` requires the negotiated version, current exact host/world/adapter/stream/sequence, live player anchor of kind `player`, and the full current P2 owned observer index with matching incarnation/encounter. `src/perception/intelligenceClient.mjs` delivers frames to a read-only in-process subscription **only after the existing actual pipe ingest returns true**.
4. **Current read-through and lifetime revocation:** `nativeCurrentOwnerPlayerAuthority.mjs` is the existing specialist policy with the roster-refresh lifecycle correction: a legitimate same-stream refresh invalidates old leases without permanently disabling future current frames; an invalid native frame, reconnect, world/host change or socket shutdown retires the source, and an actual native `retire`/`retire_batch` permanently revokes that captureRef within the stream. It retains prior capture/incarnation/encounter mapping to refuse reuse/rebinding. Avatar changes invalidate leases; the long-term human scope remains `single_local_human`.
5. **Actual P2 bootstrap hookup:** `src/bootstrap.mjs` constructs the D02 verifier from that private IntelligenceClient subscription and the same live SQLite P2 store only when storage mode is SQLite and the native memory source is the production one. It refuses a retired/mismatched profile, non-writable timeline or unverified host context. It exposes `runtime.memoryD02` as a synchronous read-through interface for the D03 integrator and closes the authority with the runtime.

### D03 exact integration API and boundary

On the ORIGINAL normal typed/STT turn **before backend acceptance** and while the source-backed current actor is known:

```js
const lease = runtime.memoryD02?.bindActorAtTurnStart({
  pedId: originalNativeActorPedId,           // from original Core, not transcript
  characterId: boundP2CharacterId,
  ownerAlias: boundP2OwnerAlias
});
if (!lease) return null;                    // no accepted-dialogue write
```

After **independent D01 final accepted backend input**, after a NEWER authenticated native owner sample and before the single P2 serialized writer fence:

```js
const proof = runtime.memoryD02?.verifyCurrentOwnerAndPlayer({
  lease,
  identity: originalBackendReceipt.identity, // exact pedId/turnId/generationId/sessionNonce
  characterId: boundP2CharacterId,
  ownerAlias: boundP2OwnerAlias
});
if (!proof || proof.originalBackendAccepted !== false) return null;
// D03 must recheck both sources again at the actual transaction commit.
```

The lease is opaque, minted by the real native path, bound to the exact NPC lifetime (ped, observer captureRef, owner alias, incarnation, encounter), native controlled player captureRef/avatar and host/epoch/stream/adapter; its TTL is <=1000ms and proof demands a newer source sequence. **A post-acceptance or caller-guessed actor lease is prohibited.** D02 does not provide source-time original actor binding; D01/Agent C must obtain that binding from genuine original Core context, or keep the D01+D02 join and accepted-dialogue persistence inactive.

`runtime.memoryD02` is a **read-only verifier**, not a frame submission API, an accepted-input callback, a P2 accepted-dialogue writer, or a substitute for current native actor authentication. D03 must never accept a model-provided identity flag, the v1 `memory_authority` roster, a queued named-pipe write or a Director stock ticket as an accepted original typed/STT line.

## Tests and receipts

- New authenticated-socket Node24 test: `lsa-essential-e1-candidate/tests/memory/nativeCurrentOwnerAuthenticatedIntake.test.mjs`. Covers genuine negotiated socket ingestion through production `IntelligenceClient` and `ShadowRuntime`, newer source read-through, exact player/owner/lifetime, wrong native player capture, unnegotiated frames, actor retire/reuse, same-stream roster refresh, avatar switching, timeline suspension, character mismatch, reconnect, invalid C-01 event and repeated sequence. **The pipe transport is a controlled in-process socket fixture, NOT a physical GTA/RPH receipt.**
- Existing specialist Node24 policy: `lsa-essential-e1-candidate/tests/memory/nativeCurrentOwnerPlayerAuthority.test.mjs` plus v1 regression `lsa-essential-e1-candidate/tests/memory-k-native-intake.test.mjs`.
- Windows .NET 8 actual policy source: `native/intelligence/memory-authority-tests/MemoryAuthorityTests.csproj` (positive and negative exact lifetime/owner tests). Windows existing `native/intelligence/integration-tests/IntegrationTests.csproj` compilation.
- CI: `.github/workflows/memory-k-d02-native-owner.yml` and updated `.github/workflows/memory-k-final-acceptance.yml` for Node24 Linux/Windows and native policy. New D02 workflow run at initial PR head `a6938b45036ef42bcd1d11feb880403adec2a853`: [38265609050](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38265609050), **queued at inspection**, not claimed PASS. Commit-specific final CI must be checked after this handoff.
- Local environment: no .NET SDK or RPH SDK reference was present, Node 22 only; **no local .NET or Node24 run was claimed**.
- Pinned production `native/promoted-characters/PromotedCharacters.csproj` explicitly includes these source files, but a real `net481` production build requires actual original `LosSantosAlive.dll`, RPH reference and DamageTracker reference. The workflow reports **BLOCKED, not PASS** when references are unavailable; neither .NET8 policy nor SDK-free compilation may be represented as a real RPH binary build.

## Explicit remaining gates / Agent C handoff

- **D01:** original backend accepted typed/STT exact actor and immutable turn tuple needs source-pinned evidence and preturn actor association. No callback invented or enabled.
- **D03:** atomic join and P2 single-writer transaction must check both original backend acceptance and this live D02 lease at commit (including all async/cancellation/rollback boundaries). This agent has intentionally not modified `runSequentialTurn.mjs`, `essentialGlue.mjs`, M2 accepted journal or SQLite.
- **D05/A09:** pinned original main net481 compilation with genuine external SDK/binary references remains a separate proof requirement.
- **A10:** no original S01–S10 production replay acceptance is claimed.
- **GTA:** no installation, actual RPH pipe, paid calls, physical testing, merge to main or release. D02 delivered to draft PR, **production-wide A01 / A09 / A10 are still NO-GO**.
