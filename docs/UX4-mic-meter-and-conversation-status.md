# UX4 live microphone meter and conversation status

Status: implemented offline on top of PR #138; **not validated in GTA**. Nothing is deployed.

## What the player sees

A small line and bar just below the screen center (the screen space the talk-target brackets use), scaled by screen height so it stays readable at 4K.

| Moment | Shown |
|---|---|
| Key held past `talkHoldMs`, native start not yet committed | `Starting microphone…` |
| Native commit result for the exact ped, key still held | `Talking to: <verified name or Promoted NPC / Nearby NPC / NPC>` |
| ...and the companion reports the capture is live | the bar, driven by the real microphone peak |
| Key released | bar gone immediately |
| Companion reports the audio was submitted | `Transcribing…` |
| Companion reports STT finished and the model/TTS is working | `<name> is thinking…` |
| Native `playback_started` for that exact turn | `<name> is speaking…` |
| Turn completed | cleared |
| Refused start, STT/model/TTS/playback failure, cancel, timeout | one short line with the reason, about 2.5 s |

A press that is released before the hold threshold (a tap) shows nothing. A new hold replaces whatever the previous conversation was showing. Every line past `Talking to` is shown only after the companion reported that stage; if the companion cannot be reached the status line and the bar stay off and the conversation is unchanged.

## Where the level comes from

Essential's server captures the microphone with one persistent FFmpeg process (16 kHz mono s16le) and forwards each chunk, while a mic turn is open, to `OpenAIConnection.sendRealtimeAudio` (`lsa-essential-e1-candidate/src/openai/openaiConnection.mjs`). The pinned `LosSantosAlive.dll` contains no microphone capture (NAudio is used only for NPC playback), so there is no in-game stream to hook. `src/voice/voiceActivity.mjs` takes the peak of each chunk it is already handed. No second recorder, device change or Essential patch is involved, and no samples are kept.

The pipeline phases come from the same tracker: `runSequentialTurn` stage transitions, the native `playback_started` event it already observes, and its terminal reason.

## Data path

`voice_status` (read-only action on the existing companion editor API) returns `{v, conv, phase, reason, phaseMs, convMs, level, levelAgeMs}`. The loader polls it from a thread-pool call at about 15 Hz while recording and 4 Hz while following the pipeline, never on the game fiber, one request in flight, and stops after three failures until the next press. It binds only to a conversation that began after the current press.

## Limits

- The bar appears when the companion's mic turn is bound (after Essential's context hydration), so it can start a little after `Talking to`.
- Needs the character editor API (promoted characters enabled). Without it only `Starting microphone…` and `Talking to` appear.
- Standalone companion (`lsa-standalone-companion`) does not implement `voice_status` yet.

## Checks for the next GTA run

Hold the key and speak: bar moves with the voice, stops on release. Say nothing: bar stays flat. Check `…` renders in Arial. Quick taps show nothing. Hold on one NPC and re-press on another mid-reply: old line is replaced at once.
