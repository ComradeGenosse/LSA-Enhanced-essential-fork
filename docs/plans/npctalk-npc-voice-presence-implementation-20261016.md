# NPC voice presence: lip motion and positional audio (NPCTalk-inspired)

**Date:** 2026-10-16  
**Base:** latest Memory K integration PR #138 (this research commit started at `158c5884d0c6befc0bdc35539c952ea9f5e06556`)  
**Scope:** presentation of existing NPC voice only. No change to dialogue generation, Memory K, ACT, player speech, or canonical NPC identity.  
**Sources:** [vendored MIT-licensed NPCTalk snapshot](../research/vendor/npctalk-20261016/README.md); original upstream [commit 59635ceb8ee010599c3caf9d9d1ee1aa114af91d](https://github.com/christos-antono/NPCTalk/commit/59635ceb8ee010599c3caf9d9d1ee1aa114af91d).

## User-visible goal

During an already-authorized LSA NPC reply, the same on-screen NPC visibly moves their mouth in rough time with audible speech. If the current Essential playback implementation does **not** already provide positional sound, allow its **existing** output to pan/fade with relative camera angle and speaker distance. Both enhancements are optional and fail soft. No extra LLM/TTS calls, duplicate voices, task disruption, or degraded playback.

## Reality check: existing playback and upstream techniques

- LSA's companion `lsa-essential-e1-candidate/src/openai/speak.mjs` streams 16-bit mono PCM through `runSequentialTurn.mjs`; `src/integration/nativeDelivery.mjs` observes turn-scoped acceptance / playback terminal events. The pinned native contract in `patches/essential-hooks.json` names `TryAuthorizeTurn`, `QueueTaggedAudioChunk`, `MarkStreamEnded`, and `InterruptExactTurn`, with Essential/native owning actual audio playback and `npcPlaybackEnded` completion. Do **not** create an independent NAudio player or change the PCM/turn protocol as an assumed prerequisite.
- Existing [conversation-gaze plan](conversation-gaze-engagement/runtime-contract.md) describes `NpcPlaybackCoordinator` start/end as a proposed native observer seam, as well as Essential look-at ownership. That is **planning**, not proof a matching lip/audio callback exists or an implementation is active on PR #138.
- NPCTalk's `SpeechPlayer.cs` plays streamed PCM via **its own** NAudio `WaveOutEvent`; `LevelTap` reads actual output samples and schedules levels against its own assumed 120 ms output latency, with a 150 ms prebuffer. That timing is **not portable** to Essential by copying constants.
- NPCTalk's `NpcVoiceScript.UpdateSpeaker` does linear gain fade (default 4–30 m) and camera-relative pan; `UpdateMouth` uses `PLAY_FACIAL_ANIM` with `mp_facial/mic_chatter` during louder audio and `facials@gen_male@base/mood_normal_1` after silence, using 0.04 level, 180 ms close-hold, 1.5 s refresh. These are **reference starting points**, not proven GTA Enhanced settings or universal facial dictionaries.

## Phase 0 — pin the real Essential audio seam (required before runtime implementation)

1. Against the **current pinned Essential DLL** and native addon, locate `NpcPlaybackCoordinator` playback-start/end notifications, their exact turn/actor fields, the output mixer (NAudio or other), the actual PCM enqueue/dequeue/playout point, sample-rate conversion, channel count, and current buffering/latency. Inspect how built-in GTA/Essential voice mouth motion, subtitles, spatial gain/pan, and existing gaze behave. Record positive/negative findings with exact source / IL / method evidence rather than assuming an API from NPCTalk.
2. Verify whether Essential's existing output **already** spatializes audio. If yes, do not duplicate it. Determine whether its output mixer has a safe local pan/volume hook; do not capture and replay via a second output device.
3. Prefer sampling the actual playout-buffer/renderer PCM level on the audio side, with an epoch/turn-keyed, bounded transfer to the native game update. If unavailable, consider a bounded envelope computed while forwarding the existing PCM plus a **measured, calibrated** playback-start offset. Do not claim lip-sync from chunk-arrival time alone; if buffer drift/jitter cannot be bounded, implement only correctly gated talk/open-close animation, or leave active lip-sync off and document the blocker.
4. Confirm `PLAY_FACIAL_ANIM` works on representative GTA Enhanced male/female ped models, is facial-only, is non-disruptive alongside Essential's own facial/conversation behavior, and can be released without clearing general tasks. If Essential already owns mouth animation, yield or don't ship the overlay.
5. Write an audit note: exact callbacks/fields, audio ownership, measured playout offset, facial dictionary support, potential conflicts, and go/no-go for separate lip and spatial features.

## Phase 1 — tiny, native-owned facial observer

- New narrowly scoped native module, compiled into `LSA.PromotedCharacters.Runtime` on Essential's Core/owner fiber; callback handlers **only enqueue bounded immutable event facts**. Reuse an existing playback observer if CGE is implemented by then; never create a second mic, speech scheduler, or target owner.
- Bind an active speaking NPC to the exact native playback **turn/generation**, native run/world epoch, and ped handle **plus MemoryAddress/incarnation where available**. A late end from A may not stop B; a dead, retired, reused, changed, or scripted actor is invalid.
- Read playout-level data for the matching active voice only, throttle face updates (e.g. 10–20 Hz, configurable), apply hysteresis and a short closing hold; only issue confirmed facial-only natives on the game fiber. Never perform sample analysis on the game/render fiber.
- No `TASK_PLAY_ANIM`, `ClearAll`, forced ped heading, audio stop, default-behavior reset, or Essential task cancellation. Do not permanently set a facial clip or overwrite an existing stronger owner. On finish/cancel/death/mission/world change/host reload, cease **only our** face overlay; use a neutral/reset animation only if phase 0 proves it safe for that ped, otherwise let a finite native animation expire.
- Works for current native-speaking NPCs including ordinary peds if exact actor proof is available; must not require promotion and must fail closed when mapping cannot be verified.
- Feature flag `npcVoicePresence.mode`: `off` (default), `shadow`, `on`, with separate `mouthEnabled` gate after phase-0 proof. Bounded settings and clear diagnostics; no transcript or audio logged.

## Phase 2 — optional positional sound on the existing playback path

- Only if phase 0 proves output is non-positional and exposes a safe **single-mixer** gain/pan extension. Apply per-speaker camera-relative pan and range fade similar to NPCTalk, on the same PCM/output path. Respect Essential's existing volume, mute, interrupts, and gain control; don't apply two distance curves.
- Base the sound position on validated current native speaker/camera facts, not a stale ped handle or Node-side guess. Use gentle bounded/smoothed changes; support off-screen speakers and player camera changes without abrupt stereo jumps.
- Explicitly **do not** add NPCTalk's independent `WaveOutEvent`, rewrite `QueueTaggedAudioChunk`, or change the sample-rate/format contract. If there is no safe seam, defer phase 2. A facial-only slice is a valid outcome.

## Targeted verification (no redundant giant suite)

- Offline, test per-turn lifetime: start A, PCM levels, end A; rapid A→B; interrupted/superseded turns; lost ped/reused handle; multiple simultaneous audio events; world epoch reset; disabled/shadow mode; missing or malformed envelope; bounded allocations and updates. Shadow must never mutate a ped or mixer.
- Runtime in GTA Enhanced: representative female/male regular and promoted NPCs, subtitles/actual audible onset vs mouth, silence gaps, cancellation during speech, camera rotation and approach/retreat (if spatial on), vehicle/mission/combat exclusions. Record video + audio, and verify zero repeated/persistent mouth motion or task changes afterward.
- Regression checks: one audible NPC stream only, no invented speech-delivery receipt; no changes to conversation-history / Memory K, ACT follow/wait/sit, UX4 microphone ownership, or CGE/Essential gaze; stock Gemini path remains unchanged. Run targeted relevant native tests/build and companion tests, then relevant CI. Report Windows/local GTA-only gates honestly rather than asserting they passed.

## Delivery boundaries

Implement as **separate small PRs** if both enhancements are viable: (a) audio/facial seam audit; (b) mouth observer behind off/shadow/on; (c) spatialization only if needed and supported. If phase 0 establishes an already-working feature, document and **skip** it. No provider keys, cloud hosting, TTS engine replacement, prompt changes, or vendored runtime integration. MIT notice accompanies any adapted upstream code. Leave Memory K #138 untouched until separately reviewed.
