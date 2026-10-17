# NPC voice presence (mouth movement + positional voice)

Status: **opt-in, experimental, default off. No GTA run has been performed.** Companion to the plan in PR #198 and the seam audit in `docs/investigations/npc-voice-presence-pinned-essential-seam-20261016.md`.

## What Essential already provides (public API of the pinned `LosSantosAlive.dll`)

The pinned DLL (SHA-256 `9b6de42d…d653`) is obfuscated internally, but its public type and member names are readable and are already listed in `docs/plans/LosSantosAlive_Hotfix3_Extension_API_Analysis.md`. The earlier PR #209 audit looked only at `NpcPlaybackCoordinator` and missed these:

| Public member | Meaning for this feature |
| --- | --- |
| `NpcSpatialAudio` (static class) | Essential's actual playout class (an NAudio `IWaveProvider`; every provider's PCM reaches it through `QueueTaggedAudioChunk` → `TryQueueMonoChunk(pcm, sourcePed, turnId, generation)`). Its queue methods take the **source ped**, so spatialization by speaker is very likely already done here. **Unverified by listening.** |
| `NpcSpatialAudio.IsAudibleAudioPlaying(Ped)` | Per-ped "audible output right now". |
| `NpcSpatialAudio.GetLastChunkRms(Ped)` | Per-ped 0..1 level from the playback class. Whether it is sampled at render time or at enqueue time is **not documented and not verified**. |
| `NpcSpatialAudio.HasBufferedAudioForTurn(pedId, turnId, generation)` | Exact-turn buffer probe. Logged only; not used as a gate until its semantics are confirmed. |
| `NpcLipSync.StartTalking/StopTalking(Ped)` | Essential has its **own** facial talking. The overlay here may be redundant or may fight it (see checks below). |

## What this branch does

- **Mouth driven by Essential's playout level.** `NpcPlayoutLevelSource` reads the three getters above (read-only, no queueing/mute/gain). `NpcVoicePresenceObserver` feeds the level for the exact authorized turn into `VoicePresenceTurnTracker`, whose result drives `NpcVoiceMouthOverlay`.
- The old "Essential says the NPC is speaking" approximation is gone as a mouth driver. Speaking state is only a gate and an immediate-close signal.
- **No estimates.** If the getters are missing or throw (different Essential build), or return a non-finite value, the mouth stays closed, one `[VP] playout_level=unavailable` line is logged, the reader stays off for the run, and speech continues unaffected.
- **Natural pauses and smoothing.** Open at `mouthOpenLevel` (default 0.015 RMS), stay open down to 60% of it (hysteresis), close after 180 ms below that, even without further samples. Level-driven transitions respect a 150 ms minimum open and 120 ms minimum closed dwell, so a wavering level cannot spam facial natives. The facial clip is binary; this is smoothing by hysteresis and dwell, not a graded jaw.
- **Immediate stops.** Turn end, interruption, supersession by another turn or speaker, Essential reporting "not speaking", world-epoch change, despawn, recycled handle/address, and shutdown all close or forget the overlay without waiting for dwell timers. Stale/changed peds never receive a native call.
- Shadow mode and `mouthEnabled: false` never call a facial native.
- Authored cutscene, player switch and network session suppress the overlay.

## What this branch deliberately does not do

- **No positional-audio code.** `NpcSpatialAudio` is Essential's mixer and takes the source ped; adding our own pan/attenuation on top risks double processing, and the only public gain control (`SetAudioVolume`) is global. Adding a hook would require modifying Essential's obfuscated binary; this branch does not deobfuscate, patch, or redistribute a modified copy of `LosSantosAlive.dll`, and the repo's own rule is to use only public seams. See "Spatial audio: what unblocks it".
- No second audio player, no change to the PCM format or provider paths.

## Configuration (native `Plugins/LSA.PromotedCharacters.json`)

```json
"npcVoicePresence": {
  "mode": "off",          // off (default) | shadow | on
  "mouthEnabled": false,  // literal true required, and mode must be "on"
  "mouthOpenLevel": 0.015,// optional, 0.002..0.5, Essential RMS level that opens the mouth
  "levelLog": false       // optional literal true: read-only "[VP] level ..." lines, 4/s max
}
```

`levelLog` works in `shadow` and `on`, writes only to the RAGE log, and prints generation, `speaking`, `audible`, `rms`, `turn_buffered`, `open` and distance to the player (no text, names or audio).

## Essential interface changes

None. Only public static getters on `NpcSpatialAudio` are called. `essential-hooks.json` and the pinned DLL/metadata hashes are untouched.

## Tests

`dotnet run --project native/promoted-characters/voice-presence-tests/VoicePresenceTests.csproj -c Release` (101 checks) covers: audible-level-only opening, quiet/loud volumes, hysteresis, natural pause close and reopen dwell, flapping bound, exact-turn level requests, A→B speaker change, late end from an old turn, audio tail after end, interruption, stop-speaking, missing/throwing hook and non-finite level, reader failure while open, world change, despawn, recycled handle/address, cutscene, shutdown, three provider-style id sets, and the read-only level log. Existing P2/UX4/Memory K harnesses were rebuilt against the new signatures (`RuntimeTests` 154, `OwnerSampleTests` 319, `PSHostTests` 12 pass under Mono; `LifecycleTests` and the bridge harness need Windows named pipes and run in CI).

No distance-attenuation or stereo tests exist because no spatial code was added.

## Remaining in-game checks (nothing here is verified)

1. **Does Essential already move the mouth?** Talk to an NPC with `mode: "off"`. If lips already move in time with speech (`NpcLipSync`), leave `mouthEnabled` off; PR #198 says to yield in that case.
2. **Is Essential's voice already positional?** Stand near, then walk away from, and turn the camera relative to a speaking NPC. Check volume falloff and left/right pan. If yes, spatial is done by Essential.
3. **Level semantics.** With `mode: "shadow"`, `levelLog: true`, listen while reading the log: does `rms` fall to ~0 in audible gaps and track loudness as heard, or does it jump at chunk arrival? Does `rms` fall as you walk away (post-attenuation) or stay constant (pre-attenuation)? Set `mouthOpenLevel` just above the idle floor and below normal speech.
4. **Overlay on** (`mode: "on"`, `mouthEnabled: true`): male and female, regular and promoted NPCs; mouth onset/offset vs audio; silence gaps; interrupt mid-sentence; A→B speakers; camera rotation; vehicle, combat, mission and cutscene exclusions; no lingering mouth motion; no conflict with Essential's own facial behavior; `mood_normal_1` reset on Enhanced.
5. Native `net481` production build needs genuine RagePluginHook/DamageTracker references (not available in CI here).

## Spatial audio: what unblocks it

If check 2 shows Essential is **not** positional, the smallest correct fix lives inside `NpcSpatialAudio`'s `Read` path (per-source pan and distance gain on the one existing provider). That needs either the Essential author to add it or an explicit decision to maintain a patched fork of the obfuscated DLL with its license implications. A gain-only alternative through the public global `SetAudioVolume` is possible but would also scale unrelated audio and would double-attenuate if check 2 turns out partly positive; it is not implemented.

## PR #198 acceptance reassessment

- Phase 0 seam audit: **complete for the public contract**; internals not read beyond the public getters. Finding: Essential already ships `NpcSpatialAudio` and `NpcLipSync`.
- Mouth observer behind off/shadow/on with `mouthEnabled`: **implemented**, now level-driven; unverified in GTA.
- "Rough time with audible speech": depends on check 3 (render-time vs enqueue-time level).
- Positional sound: **not implemented here, probably already provided by Essential**; pending check 2.
- Not yet complete: all GTA verification above.
