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
