# Implementation task — NPC voice presence from NPCTalk

Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`  
Integration target: PR #138, branch `integration/memory-k-production-20261012`  
Plan: `docs/plans/npctalk-npc-voice-presence-implementation-20261016.md`  
Reference source: `docs/research/vendor/npctalk-20261016/` (`SpeechPlayer.cs`, `NpcVoiceScript.cs`, MIT `LICENSE`).

**Goal:** Make an NPC's mouth react to its **already-playing** LSA voice; optionally spatialize the **existing** voice output if Essential is not already doing so. No second player, no extra provider call, no task clearing, no Memory K changes.

1. Start from latest PR #138 head in a **new feature branch/draft PR**. First inspect the actual pinned Essential DLL and LSA native playback callbacks/PCM/mixer path (see plan Phase 0). Locate `NpcPlaybackCoordinator`, playback start/end, audio playout point, actor identity and currently owned mouth/spatial behavior. Write short code/IL-grounded findings. Source files in vendor are references, **not** code to compile directly.
2. If there is a safe facial-only seam, implement a minimal **Core-fiber** native observer: exact speaker/turn/generation/world-epoch binding, sampled actual playout level (or a measured safe envelope), threshold + silence hold, `PLAY_FACIAL_ANIM` with Enhanced-verified dictionaries, and explicit cleanup on end/cancel/replacement/death/reset. No `Task.ClearAll`, independent NAudio, permanent animation, or stealing Essential's existing facial/gaze ownership. If synchronized PCM can't be proven, ship only safely gated talking animation or report a blocked slice.
3. Inspect positional audio **separately**. If Essential already pans/attenuates voices, do nothing. Otherwise use only its existing output-mixer seam with validated current ped/camera position, smoothing and a bounded fade/pan. If not safely extendable, defer positional audio; don't replace playback or fake completion.
4. Use a default-off `npcVoicePresence` setting, `shadow` observational mode and small targeted tests. Ensure normal Essential, UX4, ACT follow/wait/sit, stock Gemini, memory journal/speech receipts, and future CGE retain ownership and behavior.
5. Validate representative male/female, promoted/ordinary NPCs, interruptions, target changes, camera rotation, mission/combat, and speech gaps in GTA Enhanced where available. Record whether physical GTA verification was actually performed. CI focused on touched modules; no gratuitous thousand-test rerun.
6. Push a **draft PR** with code, concise findings, scoped verification, remaining blockers, and attribution to NPCTalk/MIT. **Do not merge into #138 without review.** Keep the implementation narrow; no new TTS/STT provider or architecture rewrite.

**Success:** one voice plays exactly once as before, the matching on-screen NPC mouths in roughly audible sync and stops promptly, spatial sound is improved only if missing and safe, and no unrelated NPC activity/identity/conversation is disturbed.
