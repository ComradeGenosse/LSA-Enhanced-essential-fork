# PR #37 — promoted-only acoustic reality: implementation and acceptance

Status: **DRAFT / NOT GTA ACCEPTED** (October 18, 2026).
Base: `main`. Existing branch: `feature/c01-source-time-utterance-lifecycle`.
No changes are intended for ordinary GTA pedestrians or the pinned Essential DLL.

## Safe foundation now wired

- The existing C-01 native player-mic pipeline is retained. It samples hearing
  candidates **only when their current native anchor has a promoted-owner lifetime
  and is an admitted observer**. This selection happens before acoustic/LOS/vehicle
  native reads. Other PS0–PS4 perception for ambient pedestrians remains unchanged.
- Source-time movement/LOS sampling stays bounded: at most 16 promoted candidates,
  at most three shared LOS probes per sweep, 75 ms cadence, 30 seconds per
  utterance, four independent positive intervals per observer.
- A single conservative `SpeechAcousticGrade` function classifies clear,
  muffled or inaudible based on distance, interior separation, cabin state,
  same-car identity and LOS. It uses no unverified window assumption. An unknown
  source/listener cabin mode or exhausted LOS budget **cannot grant transcript
  knowledge**.
- Only **clear positive sample intervals** enter existing v2 hearing receipts.
  Other grades are observable transition diagnostics, not speech knowledge
  authorization. This intentionally under-approximates muffled hearing until
  validated native acoustic evidence exists. No guessed words or fabricated
  audio playback occur.
- The authenticated companion requires each incoming witness to have a **current
  promoted/owned observer index**. Demotion or identity retirement between native
  receipt and STT prevents that NPC from receiving the later observation.
  Only the original, exact P0 mic identity can authorize player words.
- `[C01_ACOUSTIC]` transition lines contain host/game times, one-way trace
  codes for utterance and observer, grade, reason, measured distance,
  vehicle/interior evidence, and explicit unknown window/DSP evidence.
  They never log transcripts or raw identities. The per-utterance transition
  log is capped at 48 lines.

## What is **not** implemented or demonstrated

1. **Promoted NPC → promoted NPC dialogue knowledge.** Core's playback START/END
   callbacks expose actor and turn identity, not trustworthy rendered per-word
   timestamps. A separate verified text-to-playback binding is necessary before
   generating another NPC's word-level hearing rights. Do **not** use
   generated-but-unplayed dialogue as evidence.
2. **Actual player-facing cabin muffling/attenuation/panning.** Pinned
   `NpcSpatialAudio` is the sole Essential/NAudio renderer for all TTS.
   Public methods checked so far expose `IsAudibleAudioPlaying`,
   `GetLastChunkRms` and `HasBufferedAudioForTurn`. They do **not** expose
   per-ped gain, pan or DSP controls. `SetAudioVolume` is global and would
   incorrectly alter unrelated speakers. Existing Essential positional output
   is not proven in GTA. No second player, unsupported mixer interception,
   destructive binary patch, or fraudulent DSP flag is introduced.
3. **Window-state fidelity and fine-grained geometry.** An enclosed-vehicle flag
   is not proof that its windows are closed. The current model logs
   `window_evidence=unknown`. LOS alone is not acoustic ray tracing.
   Interior boundaries and walls are conservative diagnostics; physical
   audible transmission through them is not proven.
4. **Muffled speech presence in PS4.** This foundation errs on the privacy
   side: it grants neither words nor presence from speculative muffled grades.
   Actual source-time positive hearing evidence is required first.
5. **Full shared DSP/knowledge reality.** Until the renderer exposes and
   confirms a real source-specific playout curve, do not call an internal
   acoustic grade proof of a real-world audio effect.
6. **Windows pinned-production build and actual GTA listening.** Source-only
   tests do not substitute for the genuine dependency build or manual game run.

## Required renderer/source research before DSP implementation

- Inspect actual pinned `LosSantosAlive.dll` API and bytecode/native playback
  contract with legal access, including `NpcSpatialAudio` mixer ownership,
  `IWaveProvider.Read`, mixing of simultaneous speakers, PCM queue sample
  times, and whether Core already applies positional panning/distance.
- Establish **one** authoritative per-speaker render-time input that carries
  exact speaker/turn/generation and world epoch, and supports gain/pan/low-pass
  changes safely **before mixing**. Do not add post-mix global gain or duplicate
  ElevenLabs/OpenAI/local TTS calls. If no supported interception exists,
  obtain an Essential single-mixer extension; preserve pinned binary
  compatibility and explicitly document the version gate.
- Match the callback's actual rendered/played span (not merely TTS generation or
  chunk enqueue) to the existing NPC text receipt and observer source-time
  hearing windows. Without trusted word timestamps, distribute presence only.
- Use the same model parameters/samples to drive both renderer DSP and hearing
  rights; never let acoustic "clear" knowledge survive a muted or cancelled
  player-facing voice. Recheck movement during playback, pause/resume and
  world/identity transitions. All effects must be measured by listening and logs.

## Physical GTA acceptance checklist — Nathan and Sarah

Record game build, native DLL hashes, Core hash, config, UTC timestamps,
mic/turn identities (trace codes only), playback lifecycle, and observed sound.

| Test | Setup/action | Pass criteria |
| --- | --- | --- |
| A1 promoted-only | Nathan + Sarah promoted; ordinary pedestrians nearby | No ordinary C-01 hearing candidates or personal dialogue rights |
| A2 direct clear | Player and Nathan standing ~2–3 m apart, UX4 target Nathan | Normal targeted response and audibility; no duplicate STT |
| A3 overhear | Sarah ~3 m away; address Nathan | Sarah may know only verifiably heard part later; no unsolicited reply or target change |
| A4 cabin separation | Nathan inside stopped closed-window vehicle, player outside | Measurable actual muffling/attenuation and limited NPC knowledge; currently **blocked on DSP seam** |
| A5 same vehicle | Nathan and Sarah both in same vehicle, speak to one | Clearer mutual sound/knowledge than cabin-separate case |
| A6 movement | Nathan speaks; player walks away and returns mid-sentence | Playout fades/reappears smoothly; only played/heard spans provide later knowledge |
| A7 wall | Place a solid wall between listener and speaker | No fabricated full transcripts; actual audibility and filtering reflect obstacle |
| A8 late arrival | Sarah walks into range halfway through Nathan's line | Sarah never quotes unheard earlier words |
| A9 cancel/despawn | Interrupt TTS, retarget UX4, despawn Sarah, reset world, reconnect host | Stale/failed/unplayed dialogue gives nobody knowledge; no stuck audio |
| A10 overlap | Nathan and Sarah speak at overlapping moments | Exact actor-turn routing, bounded samples, no cross-speaker or private text leak |
| A11 performance | Repeat with 1, 2, 4, and 16 promoted NPCs | No ambient simulation overhead, no excess LOS budget, no audio artifacts |
| A12 providers | ElevenLabs, OpenAI and local TTS | Same one-renderer spatial behavior without any added TTS/STT/network requests |

**No A4–A12 gate is marked passed by source tests alone.** Keep PR in draft.
The production native build must use the genuine pinned RPH/RAGENativeUI/
DamageTracker references, not test stubs. Run companion C-01 Node tests and
native integration-policy assertions and distinguish pre-existing main failures
from introduced regressions in the PR check log.

## October 19 — genuine Core renderer inspection and playback-monitor implementation

**Source evidence:** [Pinned renderer census workflow](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/39232302379) ran a SHA-256 verification against actual `LosSantosAlive.dll` and decoded its CLR method bodies using a **metadata-only** .NET 8 analyzer. No DLL was modified or loaded into GTA. The inspected binary has 251 candidate audio methods; `NpcSpatialAudio` exposes `TryQueueMonoChunk`, `IsAudibleAudioPlaying`, `GetLastChunkRms`, `SetAudioVolume`, and numerous obfuscated **private** DSP/render internals. **There is no established public per-speaker render-time gain, pan, occlusion low-pass or timestamp callback.** The actual audible stereo/cabin behavior is not verified by IL call lists. No unsupported Harmony mixer mutation was introduced.

**New code:** `PromotedPlaybackAcousticMonitor`, compiled with the existing native runtime, consumes the *existing* Core `NpcPlaybackStartedEvent` and `NpcPlaybackEndedEvent` on the game's original owner fiber under the same opt-in `intelligence.captureMode=experimental` setting as C-01. It only admits a current P2 promoted speaker with exact native handle/address/owner association. Its listener set is the player plus **current promoted owners**; ambient pedestrians are filtered before sampling. Callback threads only enqueue bounded immutable identity facts; geometry/GTA natives are read on Update.

Monitoring is strictly bounded: 32 pending Core callback facts, 4 concurrent speaker turns, 4 pair samples per owner tick, at most 2 shared-budget LOS reads, a 100 ms sampling cadence and 120-second timeout. Samples use the existing C01 `SpeechAcousticGrade` classification, including physical distance, vehicle cabin and interior, same-vehicle identity and LOS. Transitions (including approaching/leaving, obstructing/unobstructing, cancelled playback and lost owner) are timestamped `[PR37_ACOUSTIC]` and `[PR37_PLAYBACK]` diagnostic lines. **Every line explicitly marks real output DSP as unimplemented and grants no words or hearing rights.** Neither the audio renderer nor the TTS/STT provider is changed.

**Verification:** dedicated [C01 source-time tests](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/39231797204) and [genuine renderer census](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/39232302379) are part of the PR chain. A new native Windows test exercises the real playback monitor's promoted-only admission, Sarah's hearing geometry, car-to-foot barrier, walking out of range, solid LOS obstruction, terminal interruption and despawn. The latest per-commit compilation and acceptance evidence must still be checked separately; no source test is physical GTA verification.

**Actual audio requirements still blocked:** a stable source-specific pre-mix signal and the rendered PCM time cursor from Essential's sole mixer. Only after this is exposed can per-speaker stereo pan, distance gain, cabin low-pass and sample-continuous smoothing be applied without double rendering or corrupting unrelated voices. The NPC-to-NPC text bridge also requires a proven generated-text-to-native-playback binding and intervals; no cancelled/unplayed words are distributed.

### Source-isolated DSP prepared, not yet wired

`native/intelligence/PromotedVoiceDsp.cs` provides the **actual sample processor** planned for the Essential pre-mix render path: per-voice distance gain, equal-power stereo pan, low-pass filtering through cabin/occlusion, ~35 ms gain/pan ramps, ~60 ms cutoff ramps, and immediate reset on cancellation. Its `PromotedVoiceMixTarget.FromAcoustic` uses the same `SpeechAcousticGrade` vocabulary as the native hearing monitor. Invalid geometry or unknown source conditions map to silent targets. The kernel takes isolated per-voice mono float samples and adds to a stereo float bus; it contains no socket, player, model call or GTA native.

**Deployment gate:** the kernel is compiled into the promoted-character native assembly and tested, but **no runtime invocation exists** because the pinned Essential `NpcSpatialAudio` public ABI does not expose isolated pre-mix render buffers or reliable playout timestamps. Hooking the existing global mixed output would be wrong; altering early provider PCM once cannot account for walking away halfway through already-buffered speech. Do not describe this kernel as an audible in-game feature until that seam exists and GTA acceptance confirms it.

