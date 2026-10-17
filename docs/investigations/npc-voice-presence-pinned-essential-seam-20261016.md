# NPCTalk voice presence — pinned playback seam audit (2026-10-16)

Target: #138 at 57f65baae72d570b71fb90b02725896ecd0557ca. Source: PR #198 and SHA-pinned NPCTalk SpeechPlayer.cs / NpcVoiceScript.cs (MIT notice remains in #198).

## Evidence
- Checked-in Essential DLL: lsa-essential-e1-candidate/upstream/LosSantosAlive.dll, SHA-256 9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653.
- Its checked-in docs/native-metadata.json provides **public native** NpcPlaybackCoordinator.PlaybackStarted / PlaybackEnded with SpeakerPed, PedId, TurnId and GenerationId. End adds Reason/WasInterrupted/HadAudio/PlaybackStarted; methods include QueueTaggedAudioChunk, MarkStreamEnded and InterruptExactTurn.
- The current public metadata / E1 native contract exposes **no rendered PCM level**, renderer cursor, output latency or gain/pan mixer hook. These absent *public* seams do not prove anything about private IL; full renderer IL inspection is outstanding.
- lsa-essential-e1-candidate/src/openai/speak.mjs emits 24 kHz mono PCM16; runSequentialTurn.mjs forwards it into Essential's native-owned queue. PCM **enqueue time is not audible playout time**, so it cannot be substituted.
- Upstream NPCTalk LevelTap is in its separate NAudio WaveOutEvent, with 120 ms latency and 150 ms prebuffer. Its UpdateMouth uses threshold 0.04, 180 ms silence hold, PLAY_FACIAL_ANIM(mp_facial, mic_chatter) and male idle face. Neither that latency nor the Enhanced native and reset behavior are verified in LSA. Its pan/fade is applied to its **own** mixer, not to Essential.

## Delivered in this branch
- Optional native \`npcVoicePresence.mode\` defaults to **off**. \`shadow\` and \`on\` both remain **observation-only**, with one event subscriber on Essential's existing Core update fiber. No replacement player, AI/TTS request, mixer write or ped native/task call.
- Bounded event queue, strict per-turn generation, original Ped handle/MemoryAddress, host world epoch, invalid/dead/player filtering, cancellation/end, timeout and unload cleanup. Ordinary as well as promoted peds are admitted from Essential's authenticated native event, independent of UX4 selection.
- Small independent rendered-level policy with sound/silence hold and stale-level rejection, ready **only** for a future trusted playout callback. There is no production caller yet, therefore **no visible mouth animation and no positional audio change**.
- No Memory K, provider, spontaneous speech, player microphone, ACT, stock Gemini, NPC audio lifecycle or other playback components changed.

## Open gates before active mode
1. Inspect pinned Essential renderer **IL/source** and determine if it already spatializes; obtain an actual per-turn *rendered* PCM tap or request an Essential change. Do not re-play or use Node chunk timestamps.
2. Physically verify male/female \`PLAY_FACIAL_ANIM\` compatibility and a face-only, task-safe neutral close in GTA V **Enhanced**; verify it does not fight Essential's own face behavior.
3. Only with both gates satisfied, wire actual level to native face refresh (10–20 Hz), validate player motion and audible timing, interruption, A→B, combat, mission, vehicle and unload. Only add spatial processing at the **existing mixer** if not already present.
4. Real net481 compile needs genuine RPH and DamageTracker references. Offline .NET policy CI is not a production native build. **No GTA test performed**.

**Status: safe phase-0 foundation only; not full #198 acceptance. Do not merge automatically.**


## Follow-up: gated, approximate facial presentation (2026-10-16)

Added `NpcVoiceMouthOverlay.cs` to the production native target, driven by the **public** `NpcPlaybackCoordinator.IsPedCurrentlySpeaking` signal for an exact, alive, native-bound NPC turn. Unlike enqueue timestamps, this method reports the Essential NPC speaking state. It **does not expose a rendered PCM envelope**, so this is experimental talking motion, **not audio-synchronized mouth movement**.

- `npcVoicePresence: {"mode":"on","mouthEnabled":true}` is required to invoke facial natives. Missing flags, `off`, `shadow`, and `on` without a literal JSON boolean `true` remain observational.
- Only `PLAY_FACIAL_ANIM` (`mic_chatter` from `mp_facial`) and a facial-only `mood_normal_1` reset are used; 1.25-second refresh limit, no ped task/heading/voice playback control. The two neutral dictionaries are requested before applying an open animation.
- Same-original-wrapper, handle, native memory address, world epoch, identity, generation, and player-exclusion checks prevent event leaks; old turn supersession closes its own face and stale incarnation/world transition never calls a native on an invalid ped. Cutscenes, player switches, and network sessions suppress the overlay.
- A native exception disables the experimental mouth feature for this run; audio and ordinary conversation must continue normally.
- This feature has NOT been demonstrated on male/female GTA V Enhanced models or checked for facial ownership conflicts. It is **opt-in experimental** and must not be enabled by default or claimed as production lip-sync. No local GTA testing was available.
- **Spatial audio remains blocked**: the pinned Essential API has no public gain/pan hook, and existing spatialization is not verified. Never add a second player or change PCM wire format.
- A production-quality lip-sync and positional implementation requires an Essential renderer upgrade exposing exact-turn playout levels and optional *single-mixer* spatial controls, followed by actual GTA Enhanced hardware verification. Do not enable either by default without those gates.

Offline policy/observer regression tests now include observational mode, strict opt-in, not-yet-speaking audio, visible start, rate limiting, supersession, exact end, and recycled actor fail-closed behavior. CI results and GTA status must be recorded separately.


## Correction and follow-up (2026-10-17)

The statements above that Essential exposes "no rendered PCM level" and "no verified spatialization" were based on `NpcPlaybackCoordinator` only. The public `LosSantosAlive.Audio.NpcSpatialAudio` class (already listed in `docs/plans/LosSantosAlive_Hotfix3_Extension_API_Analysis.md`) is Essential's actual playout class and exposes `IsAudibleAudioPlaying(Ped)`, `GetLastChunkRms(Ped)` and `HasBufferedAudioForTurn(...)`; `LosSantosAlive.Audio.NpcLipSync` is Essential's own facial talking. The mouth overlay now reads those getters instead of the speaking flag, and positional audio is left to Essential pending an in-game check. See [../npc-voice-presence.md](../npc-voice-presence.md). Internal (obfuscated) renderer code was not analysed or modified.
