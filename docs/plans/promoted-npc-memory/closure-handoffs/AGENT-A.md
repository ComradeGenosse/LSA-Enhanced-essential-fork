# Memory Closure Agent A — source-proof native authority handoff

**Pin:** PR #75 / \`8443a8adec9433626902b46b81bd3e58fc382fb2\`.  
**Branch:** \`feature/memory-closure-a-native-authority-20261011\`; target \`integration/memory-completion-h-review-20261011\`.  
**Exact completed implementation source SHA before this handoff:** \`edd4e564252ce72b83ac8ca0e7e808ca6c7cf2b5\`. The handoff commit necessarily changes the branch head; the **exact post-handoff final SHA is the head of Agent A's PR**. A committed Markdown file cannot contain its own SHA without changing it. Integrator K must pin the PR head via GitHub before merging.  
**Status:** native owner/protagonist *read-only source* and fail-closed JS cache implemented. **Not globally registered, not built against installed RPH/GTA, not real-C-01 accepted-turn verified, not PS2 negative coverage certified, not prepromotion certified. NO-GO.**

## Changed owned files

- \`native/promoted-characters/MemoryOwnerAuthority.cs\`: new partial \`PromotedCharactersIntegration.SampleMemoryNativeAuthority()\`. Called on the existing Core owner fiber; samples exact \`Host.Anchors\` observer capture refs, checks P2 encounters, handle/address/wrapper, non-suspended live registration, P1 current \`NativeIdentityClaim\` (sourceKey, worldProfileId, incarnationId), host run/epoch, and returns **a bounded full owner snapshot**. Generic PS2 observers have no memory owner. Failure to validate a registered observer invalidates the complete sample. No new native worker, memory engine, or channel.
- \`native/intelligence/MemoryProtagonistSource.cs\`: native-controlled player handle \`PLAYER_PED_ID\` + \`GET_ENTITY_MODEL\`, compared to live \`Game.LocalPlayer.Character\`, current retained player anchor, and no active cutscene, switch, or network session. Only the base story-player model hashes distinguish Franklin/Michael/Trevor; all other cases return unknown/unavailable. A model alone or an actor name is not sufficient.
- \`native/intelligence/MemoryOwnerProofPolicy.cs\`: testable exact alias/current-registration predicates and model-key mapping.
- \`lsa-essential-e1-candidate/src/memory/nativeMemoryAuthority.mjs\`: \`createNativeMemoryAuthority({subscribeAuthenticatedNativeFrames,profileForAlias,now,maxAgeMs})\`. Immutable synchronous \`resolveNativeOwner\`, \`resolveParticipants\`, \`verifyCurrentTurn\`, \`verifyNativeCoverage\`, \`resolvePrepromotion\`, \`status\`, \`close\` exports. **No public memory-authority setters or untrusted \`nativeVerified\` shortcut**. Cached owner records expire at 1,000 ms by default, and all proofs retire on connection/epoch change, malformed receipt, recycled observer ref, or missing P2 profile. Only the source callback supplied from K's authenticated, sequence-checked PS2 socket may deliver native snapshots. **Do not bind this subscription to an arbitrary event emitter or caller JSON.**
- \`lsa-essential-e1-candidate/tests/memory/nativeMemoryAuthority.test.mjs\`: offline source-contract fixtures and adversarial isolation/reuse/retirement/reconnect/epoch/protagonist/turn/rollback/negative/prepromotion tests.
- \`native/intelligence/memory-authority-tests/{MemoryAuthorityTests.csproj,Program.cs}\`: isolated pure native-policy assertion harness, no GTA binaries or RPH linkage.

All changes are additive inside Agent A's owned paths. No SQLite schema changes, K-owned file edits, model calls, deployment, runtime registration, save manipulation or Director changes.

## Source output and JS/mock contract

The native method emits **an object payload for the EXISTING IntelligenceChannel's \`Send("memory_authority", payload)\`** (K must add this single publication). It has:

\`\`\`js
{
  memoryProofVersion: 1,
  hostRunId, worldEpoch, sampledGameTick,
  owners: [{
    observerCaptureRef, ownerAlias, hostRunId, worldEpoch,
    incarnationId, encounterId, sampledGameTick
  }],                  // <=16, full per-owner-fiber snapshot
  protagonist: null | {
    source: 'native_player_model',
    key: 'franklin' | 'michael' | 'trevor' | 'unknown',
    playerCaptureRef, sampledGameTick
  },
  acceptedTurns: []   // pinned native source has NO normal C-01 turn receipt yet
}
\`\`\`

The existing authenticated IntelligenceChannel adds envelope \`{version:1,type:'memory_authority',adapterEpoch,streamId,sequence,payload}\`. **The new JS subscriber must only receive the frame after the existing source-owned named-pipe authentication, hello negotiation, frame ordering and runtime host/epoch validation; the string \`trusted\` or \`nativeVerified\` in arbitrary JSON is worthless.** The subscriber mock used for unit fixtures simulates *this privileged internal seam only*, not a live source. A direct caller of any authority resolver cannot set a verification flag to gain trust. Replay of an already retired \`streamId\` is refused.

The JS \`profileForAlias(alias)\` is K's *live* P2 mapping: return a profile from the **same** SQLite store only if the world/timeline matches, \`timelineWritable===true\`, and profile status is current. Importantly, native \`ownerAlias\` and P2 \`CharacterId\` are **not numerically or textually equivalent**: original \`characterService.promote\` creates \`'promoted.'+randomUUID()\` separately from P1's \`record.characterId\`. Never parse an alias UUID as a CharacterId. The returned owner shape is:

\`\`\`js
{ nativeVerified:true, current:true, promoted:true,
  characterId, ownerAlias,
  ownerProof:{ownerAlias,hostRunId,worldEpoch,
    observerCaptureRef,incarnationId,encounterId} }
\`\`\`

\`resolveNativeOwner({observerCaptureRef,observerIndex,hostRunId,worldEpoch,adapterEpoch})\` is synchronous and checks every native field against the **current PS2 observer index**. \`resolveParticipants({observation,hostRunId,worldEpoch,adapterEpoch,ownerProof})\` returns a bounded immutable array of only independently proven native promoted owners and the player anchor with native model proof; all unsupported participant refs remain unresolved. \`verifyCurrentTurn({identity,characterId,ownerAlias,hostRunId,worldEpoch})\` accepts \`identity:{pedId,turnId,generationId,sessionNonce}\` and requires a true C-01 source receipt with the exact owner, generation, session, native host and protagonist. **It returns null with the current native producer** because \`acceptedTurns\` is empty. The fixture using a synthetic acceptedTurn exercises matching only; it is not proof that the native producer emits this in game. Never adopt a Director stock turn receipt as normal C-01 input.

\`verifyNativeCoverage()\` and \`resolvePrepromotion()\` always return null, intentionally. The current shipped \`Publish\` path filters negative \`WitnessPolicy\` receipts, and M3 has no certified native negative-coverage protocol. Prepromotion has no *native-reserved future* \`CharacterId\` plus alias before registration; even a 120-second temporal buffer cannot invent the recipient. K must keep both feature gates OFF until new independent native receipts are established and tested. No negative observation may be inferred from a missing PS2 event.

## EXACT minimal K-owned global registration recipe

1. In \`native/promoted-characters/PromotedCharacters.csproj\`, add to the explicit \`Compile Include\`: \`MemoryOwnerAuthority.cs\`, \`../intelligence/MemoryOwnerProofPolicy.cs\`, \`../intelligence/MemoryProtagonistSource.cs\`. These are NOT automatically included by the pinned \`EnableDefaultCompileItems=false\` project.
2. In \`native/promoted-characters/RuntimeEntry.cs\` where \`IntelligenceIntegration\` is constructed with the same \`host\` and \`integration.PerceptionRoster\`, pass \`integration.SampleMemoryNativeAuthority\` as a new final \`Func<object> memoryAuthoritySample\` constructor argument. In \`native/intelligence/IntelligenceIntegration.cs\`, retain that callback and, **on the existing Core native owner \`Update\` only, immediately after observer-index and anchors are synchronized and sent**, call the callback and \`channel?.Send("memory_authority", sample)\` only if non-null. Do not call it in the pipe thread, create another fiber, or treat socket send success as an accepted P2 memory journal write. On channel overflow/disconnect, existing channel retirement applies.
3. Extend \`lsa-essential-e1-candidate/src/perception/shadowRuntime.mjs\` / \`contracts.mjs\` strict frame vocabulary to accept only schema-checked \`memory_authority\` after the existing authenticated hello, stream-sequence and epoch fences. In \`intelligenceClient.mjs\`, add a private \`subscribeAuthenticatedNativeMemoryAuthority(cb,onRetire)\` and publish ONLY after native client ingest acceptance. Retire on disconnect/world epoch/stream replacement; never publish from model, caller flags, test event emitters, raw \`options\` payloads or unparsed JSON.
4. Instantiate \`createNativeMemoryAuthority\` **once** in K's Essential bootstrap, binding that private subscriber and current writable P2 \`profileForAlias\` lookup (world, timeline, live \`promotion.ownerAlias\`, profile current). Supply the same authority to existing \`essentialGlue\` M2 and \`bootstrap\` M3 injection ports; avoid independent competing caches. At PS2 channel reception ensure owner sample is newer than or equal to the matching published observer index. Never mark an unverified owner as \`nativeVerified\` just because a mocked JavaScript callback returned a boolean.
5. Normal accepted C-01 turn generation/sessionNonce proof must be added **from the actual original Essential backend**, not the unrelated \`DirectorOriginalTurnBindingCodec\`. Until then, \`verifyCurrentTurn\` returns null, so M2 write binding remains correctly disabled. Treat this as a **release blocker**, not a green native implementation.
6. Do not register \`verifyNativeCoverage\` or \`resolvePrepromotion\` as successful native providers. The latter additionally requires qualifying prepromotion PS2 receipts **from the same still-live physical ped**, a reserved future P2 character ID, a stable alias and <=120-second capture/promotion lifetime. No source presently proves all these.
7. Keep the original PS6 Director/player priority gates and one PS4 knowledge frame; source authority grants no dialogue scheduling priority, no gameplay action and no memory writes by itself.

## Offline test commands / honest results

\`\`\`bash
node --check lsa-essential-e1-candidate/src/memory/nativeMemoryAuthority.mjs
node --test lsa-essential-e1-candidate/tests/memory/nativeMemoryAuthority.test.mjs
dotnet run --project native/intelligence/memory-authority-tests/MemoryAuthorityTests.csproj --configuration Release
\`\`\`

**Observed test execution:** **NOT RUN**. This connector-only session has no authenticated clone/worktree accessible to Node and no installed .NET SDK in its container. GitHub file creation/compare confirms source paths and commits only; no unit-test or native binary completion may be claimed. K must run the exact commands above on the PR head (Linux/Windows Node24; .NET8 for pure harness; pinned net481 RPH compilation on Windows separately) and record actual outputs, including failures, before source acceptance. Tests are committed, but that is not a test receipt.

## Source gaps and explicit no-go cases

- **C-01 accepted player turn:** no verified native normal-turn \`turnId/generationId/sessionNonce\` frame at the selected pin. M2 remains fail-closed; typed/STT source integration cannot be certified by a Director stock receipt.
- **Native negative PS2 coverage:** no separately published authenticated negative receipt (status, observer, source, epoch, observation, modality, sampled tick). Missing signal is *unknown*, never \`did_not_witness\`.
- **Prepromotion:** no reserved future P2 identity before promotion; cannot authorize an ambient ped's earlier journal as a promoted owner. Explicit grace feature remains disabled.
- **Native model hash:** three player hashes and invoked RAGE natives are source-grounded design, but need the pinned DLL/RPH Windows build and physical receipts; cutscenes, switch transitions, unsupported/modified player models are unknown.
- **Timelines and native restarts:** P2 must provide the live timeline guard and freeze on rollback. A changed model/protagonist or owner incarnation revokes the verified cache; it does not choose a different timeline.
- **Two characters / handle reuse:** JS tests cover source-fenced typed fixtures; actual P2/PS2 same-fiber ordering, observer retirement, channel overflow and 3-NPC soak still need integrator and physical tests.
- **No physical GTA testing** and no confidence claim for latency, coverage completeness, Director interruptions, paid Luna/API billing, or deployment.

**Decision:** SOURCE SUBSTRATE PARTIAL; **NO-GO** for complete live memory feature, main merge, GTA install, or physical acceptance until K's owned patches, real C-01 producer, tests/build and end-to-end receipts are available.
