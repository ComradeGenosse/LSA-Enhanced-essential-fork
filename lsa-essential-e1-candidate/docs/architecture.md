# E1.1 Hotfix #3 native lifecycle

E1 binds each OpenAI provider job to the immutable identity allocated by Essential's stock turn store: `{pedId, turnId, generationId, sessionNonce}`. Essential and the DLL remain authoritative for native turn/generation identity, playback authorization, tagged audio, stream completion, playback completion, exact interruption, action execution, and GTA/NPC context. E1 owns provider work, decision validation, correlation, abort handles, and dialogue history stages. It does not mirror NPC or playback-owner state.

## Input sources and history

The stock source vocabulary is `player_text`, `player_mic`, `special_event`, `npc_to_npc`, `exact_speech`, and `system`. E1 preserves the source in the turn snapshot and logs. `player_text` and `player_mic` are genuine player dialogue. The microphone utterance is committed only after STT returns a usable transcript. A valid player utterance is committed once before Luna starts, so a later refusal, TTS failure, rejection, interruption, supersession, or playback timeout does not erase what the player said.

Other sources are internal. They are not appended as `user` messages. For a `special_event`, the stock `kb()` controller supplies the event as both `input.text` and `contextText`; E1 removes the duplicate only when the two fields match after trimming and whitespace normalization. It never deletes an arbitrary substring from unrelated context. The trigger is placed once in the system context as internal event information. The user-role request says that no player utterance was received. Essential-supplied actor, listener, world, and scene context remain available. A delivered internal turn may add its assistant reply to dialogue history without inventing player dialogue.

Assistant dialogue is staged only after a valid Luna decision. It is committed once, and only after the matching native `PlaybackEnded` reports `completed`, `WasInterrupted=false`, `HadAudio=true`, and `PlaybackStarted=true`. Failed delivery and duplicate/late acknowledgements discard or ignore that assistant stage. History remains bounded by `maxHistoryMessages`.

## Deadlines and delivery

`providerWorkDeadlineMs` bounds the pre-playback work phase: STT, Luna, decision validation, TTS, native authorization, PCM delivery, and the native stream-end send. Its correctness timer remains referenced so Node cannot exit while an awaited provider operation is pending. Request/response timeout timers for provider JSON and audio requests are referenced for the same reason. The legacy `turnDeadlineMs` input remains a compatibility alias for this provider/work deadline. It stops when Essential has accepted E1's stream completion call; it never limits how long an NPC may physically speak.

After the stream-end send, E1 waits under a separate native playback-completion watchdog. Its bound is based on the actual PCM size at PCM16 mono 24 kHz (`bytes / 48,000` seconds), plus `playbackCompletionGraceMs`, clamped by `playbackCompletionMinMs` and `playbackCompletionMaxMs`. Watchdog expiry is a failure/recovery event only. Estimated duration and timer expiry never establish success; only the exact native completion event does. A late completion after timeout, cancellation, or supersession cannot revive the job.

The first usable TTS chunk requests authorization through stock `RP`, sending `npcAudioTurnStart`. `RP`'s `audio.authorized` means the request was sent, not accepted. E1 subscribes before output and waits for `npcAudioTurnAccepted`. No PCM is submitted before acceptance. Stock `CP/pP` then sends only tagged `npcAudioChunk` messages; stock `IP` owns the single logical `npcAudioStreamEnded` marker. The observer keeps only acknowledgements and waiters. It does not own or mirror playback.

## Terminal causes and action safety

Each generation has one terminal outcome. The first matching native terminal event, explicit abort, provider/work timeout, or playback watchdog outcome wins; later callbacks only clean up. E1 records a bounded semantic reason: `cancelled`, `superseded`, `provider_timeout`, `stt_error`, `model_error`, `model_refusal`, `invalid_decision`, `tts_error`, `native_auth_rejected`, `playback_error`, `playback_interrupted`, `playback_ack_timeout`, or `disconnected`. Logs include the full identity, source, terminal reason, stage, and safe provider/native cause fields; credentials and prompt bodies are not logged.

If failure occurs before any audio chunk was submitted or playback started, the native turn receives the stock provider/general failure reason (`GEMINI_ERROR`) rather than `PLAYBACK_ERROR`. Once audio was attempted, delivery failure maps to the broader native `PLAYBACK_ERROR`; E1 logs retain the more specific cause. Native authorization rejection and interruption continue to use their native event/reason. Cancellation, supersession, and disconnect never become successful playback.

Actions use the validated stock parser/catalog and remain bound to the exact current native generation. Stock action timing and deduplication remain authoritative. A stale or terminal turn cannot dispatch a late action. An action already executed before later speech failure is not rolled back.

## Native trust chain

The build accepts only the pinned upstream bundle and stock DLL SHA-256 values. `docs/native-metadata.json` was extracted from that DLL using `tools/native-metadata` and CLR metadata readers without loading the assembly. The build independently checks the exact metadata artifact SHA-256 (`18edd2b47ffde748388b07a4a2d023793e183b882fe638acb5276440d45a2d23`), confirms its claimed DLL fingerprint, and requires exactly one match for each required native type, method/signature, event, completion field, and action capability. Missing or ambiguous evidence fails closed. AST hooks also require one exact stock match and the patched source must parse again.

## Stock paths and removed machinery

Controller-level tests execute the extracted stock `ib()` typed-text and `kb()` special-event functions with only GTA/network presentation boundaries harnessed. The surrounding `Xi` turn creation, native identity, `Xn` binding, OpenAI adapter, action parser, tagged audio routing, stream end, and `PlaybackEnded` path remain real candidate code. PTT coverage exercises the stock mic/hydration path and OpenAI STT/turn source.

E1 does not register OpenAI in Gemini owner maps, infer identity from the selected speaker, allocate another generation, use legacy binary audio, replay Gemini exact speech, or assume successful completion from a timer. Gemini owner/retry/watchdog behavior remains isolated and unchanged. Failure cleanup interrupts the exact authorized native identity; a successor does not wait for a stale provider promise.

## Scope and limitations

No replacement DLL, binary patch, alternate microphone subsystem, perception pipeline, production GTA deployment, or real OpenAI request is part of this candidate. Offline tests use deterministic providers and extracted stock controllers; they do not establish live API compatibility, installed-version matching, in-game acoustics, physical long-response timing, or actual action/world effects. Those remain GTA/runtime smoke-test items.
