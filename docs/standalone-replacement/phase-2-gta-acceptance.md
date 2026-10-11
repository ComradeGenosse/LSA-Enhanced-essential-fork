# Phase 2 RAGE adapter — physical acceptance register

**Status: UNTESTED in GTA Enhanced.** This is a controlled test plan, not a completed game validation or a deployment instruction. All existing Essential files remain unchanged. A final standalone profile must have zero enabled Essential controllers.

## Prerequisites

1. Use an isolated verified GTA Enhanced RAGE profile with the current Essential plugin **not enabled/loaded**. Record installed GTA exe and approved RPH SDK version (hashes, no credentials).
2. Run the read-only `tools/standalone/verify-standalone-profile.ps1 -GameRoot "<GTA Enhanced folder>"` and manually inspect RPH enabled-plugin list. Do not treat a successful filename scan as definitive if a DLL has been renamed.
3. Build `LSA.Standalone.RageHost.dll` against the SDK actually installed with GTA Enhanced, using `-p:RphReferencePath=...`. Published NuGet SDK build does not prove the installed loader API is the same.
4. Deploy **only when a reviewed build/backup and explicit mode switch are prepared**. No server keys, private configs or Essential binaries belong in the standalone package.

## Host and transport smoke acceptance

- Native logs exactly one accepted startup and one clean shutdown; repeated load/unload does not leave pipes or actor leases alive.
- Starting a second standalone host instance is refused, including forced plugin load and separate AppDomains.
- A mixed profile containing Essential is rejected before NPC state mutation; manual review of enabled plugin list is still required.
- Node `health-check.mjs` connects, validates host run/epoch, completes a native owner-fiber snapshot, detects disconnect and refuses any old request after reconnect.
- Host crashes, Node crashes, long stalls, bad/fragments/malformed frames, queue saturation and duplicate/replayed requests fail closed. No game-thread native function is called on IPC worker.
- World/time reset and RPH unload leave no surviving actor or turn ticket.

## Physical actor lifetime spike — REQUIRED BEFORE ANY NPC EFFECTS

Current production RAGE resolver compiles as a genuine implementation of RAGE handle/Ped lookup and two GTA INT decorators. Its adoption capability is **disabled by default**; it refuses actor observation and issuance until validated and explicitly enabled in a follow-on accepted change. The decorator approach may be invalid if registration is locked or an entity preserves its cookie across reuse.

Test both a newly spawned disposable pedestrian and an ambient adopted pedestrian:

1. Observe baseline `PoolHandle`, `Ped.MemoryAddress`, model and both DECOR ints, including the initial registration state and exact native readbacks.
2. Adopt/tag while alive, then kill, delete, dismiss, despawn via distance, replace with the same model, and repeat across a world reload. Confirm the old cookie does not attach to the new physical entity.
3. In a high-churn loop, look for reuse of **both** handle and address, including missed polls. If a new entity retains the old cookie or the decorator readback is unstable, fail the adapter gate, not just the test.
4. Try switching mission scripts, cutscenes, player swap and network/unsafe world states. Existing native authority must revoke, never regrant, a previously retired lease.
5. Repeat on a summonable promoted character. Verify retirement fan-out clears conversation and actor ownership and cannot attach old history to a replacement ped.
6. Record only neutral handle/hash/cookie comparisons and fixed diagnostic reason codes, not conversation transcripts or user configuration.

## Explicit disposition

- **Source-only:** independent DLL design, RPH adapter compilation, owner-fiber dispatch, local IPC, native-only ticket allocation and tests.
- **Physical-only:** actual in-game entity cookie registration/lifetime reliability, game-fiber identity after yielding, RPH plugin start/unload, loaded plugin mutual exclusion and device/spatial audio. Do not call these PASS without logs.
- **Future phases:** Phase 3 owns game-sourced target/typed-turn provider dispatch; Phase 4 owns audio device/playback and PCM streamed output. Phase 2 reserves the wire and policy for these without pretending their effects operate.
