# Native dependency contract

All hard dependencies fail closed. The build pins the complete upstream source and stock DLL bytes. It also pins the exact `docs/native-metadata.json` bytes to SHA-256 `18edd2b47ffde748388b07a4a2d023793e183b882fe638acb5276440d45a2d23`. The metadata was extracted from the pinned DLL using `tools/native-metadata` with `System.Reflection.Metadata` and `PEReader`, without loading or executing the assembly. Build verification hashes the metadata artifact before parsing it, checks that its claimed DLL hash matches the pinned DLL, then verifies each required type, exact signature, event, completion field, and action method appears exactly once. The manifest records both fingerprints. Missing, altered, or ambiguous evidence fails closed.

| Hard dependency | Actual contract / hook |
|---|---|
| Turn and generation identity | Essential `le` / `hy`, `Xn`, `le.bindGeneration`, `le.allocateGenerationId`; session nonce and immutable metadata retained |
| Context/hydration | Existing typed/PTT controllers and `WP/qK` session actor/listener context and `BK` stock prompt; no synthetic perception |
| Playback authorize | `NpcPlaybackCoordinator.TryAuthorizeTurn(Rage.Ped, string, long, out string, Rage.Ped, string, bool) -> bool`; `RP -> npcAudioTurnStart -> npcAudioTurnAccepted/npcAudioTurnRejected` |
| Tagged PCM | `QueueTaggedAudioChunk(byte[], Rage.Ped, string, long, out string) -> bool`; `CP/pP -> npcAudioChunk` |
| End marker | `MarkStreamEnded(string, string, long, out string) -> bool`; `wP/IP -> npcAudioStreamEnded` |
| Exact interruption | `InterruptExactTurn(string, Rage.Ped, string, long, string) -> bool`; `Ey -> npcSpeechInterrupted` with full triple; ped overload also exists |
| Completion | `PlaybackStarted` / `PlaybackEnded`; `NpcPlaybackEndedEvent` fields `SpeakerPed`, `PedId`, `TurnId`, `GenerationId`, `Reason`, `WasInterrupted`, `HadAudio`, `PlaybackStarted`; stock `by/vK` forwards exact turn events |
| Native action dispatcher | `NpcActionRegistry.HasAction/TryExecute`, native role routing; server `ra/h4/Cb/N4/Rb/wb` preserves the current stock action semantics |
| Protocol capability handshake | Connected/ready version **3**, turn identity, stream end, exact interruption, playback-started, stale-generation rejection flags. Checked before inference and on every provider event. |

The endpoint handshake has no separate `supportsPlaybackEnded` flag. The pinned DLL and server hooks establish that contract. E1 sends the stream-end marker once via native `IP`, then waits under a bounded playback-completion watchdog. Watchdog expiry is failure only. Only a matching `PlaybackEnded` event with successful native fields establishes assistant-history commit.

## New and retained hooks

The authoritative edit inventory is `patches/essential-hooks.json`, generated from the current build manifest. Each label includes the exact source range and inserted byte count in `dist/plugins/LosSantosAliveServer/build-manifest.json`.

- Provider factory and bridge attach: choose OpenAI without constructing Gemini transport; expose exact native operations.
- `WP` context/session metadata and resume handle: keep hydrated context; no Gemini resume handle on OpenAI.
- `Xn`: retain native allocation/binding, bypass Gemini owner registration for OpenAI, bind immutable provider identity.
- `a4`: bound OpenAI pre-hydration PCM without the stock drop-oldest behavior.
- `yy`: OpenAI session nonce preflight without Gemini owner-map arbitration.
- `rP`: preserve exact provider route if an OpenAI event reaches the generic router.
- `_P`, `Sd`, `Td`, `AP/wP`: prevent Gemini retries/watchdogs/exact-speech synthesis for OpenAI.
- `td`: no Gemini retirement for OpenAI HTTP work.
- `Qi`, `hK`, `Zt`: abort exact provider work; native cancel/failure cleanup targets the original authorized triple, including zero-PCM cases.
- `CP`, `IP`: native acceptance/current identity gates for PCM/end.
- `mK`: exclude OpenAI PCM from Gemini debug accumulation.
- `Rb`: stale generations cannot dispatch stock actions.
- `qK`: refresh provider context when the native session is reused.

No hard lifecycle fallback exists. Unknown source/DLL hashes, missing signatures, hook ambiguity, incompatible endpoint or rejection cannot downgrade to the old audio path.

## Optional and fallback-safe capabilities

Optional: correlation debug logging, radio-speech presentation and action-specific integration capabilities already filtered by Essential. Their absence does not establish playback success. Extra third-party action registrations are not automatically made available to Luna.

Fallback-safe: selecting the separately configured stock Gemini provider; dialogue-only model decisions; absence of optional world/inventory fields when no action requires them. OpenAI errors never trigger automatic provider fallback. Missing mandatory lifecycle/context capabilities are not fallback-safe.

## Re-extracting metadata

With .NET SDK 10 available, run the metadata utility against `upstream/LosSantosAlive.dll`; direct only its JSON output to a temporary candidate file, review it, then update the checked-in evidence. This is an audit operation, not normal build/deployment. Normal Node builds need no .NET runtime. Never update source/DLL pins merely to get a build past a mismatch.
