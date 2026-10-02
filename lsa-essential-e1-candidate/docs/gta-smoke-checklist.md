# GTA manual acceptance

The E5/E6 payload is installed in the current GTA server folder with `structuredStreamingEnabled=true` and `earlyTtsEnabled=true`. The repaired build has now been exercised in a 13-turn microphone run; see the [run review](../../docs/E6-GTA-verification-2026-10-01.md). All turns reached native playback, but each reply contained only one segment, and first PCM arrived after model completion. This run does not verify multiple segments or real inter-segment gaps. Use the E1 JSONL logs and `node tools/summarizeRun.mjs <logs directory>` to inspect `pedId`, `turnId`, `generationId`, `sessionNonce`, source, timings, and terminal reasons. Do not log credentials or full prompts.

RAGE Plugin Hook logged Talk=Mouse4, Text=Mouse5, Mark=F9, and MarkedPedTalk=F10 for the latest run; these controls may differ from the stock defaults. The native launcher uses the bundled Node and `server.bundle.mjs`; E1 bootstrap loads supported credentials from the server `.env`, with inherited environment variables taking precedence.

- [ ] Typed normal turn through the stock text controller: one native turn, accept before PCM, one stream end, matching playback completion, player history retained, assistant history committed once.
- [ ] PTT turn through stock mic/hydration: press/release, rapid release before hydration, duplicate controls; full prefix retained, pending sends drained, one STT submission. Exceed the configured duration/byte bound and confirm no truncated transcript submission.
- [ ] Long spoken response whose actual physical speech lasts longer than the former 45-second limit; confirm provider work completes and only matching native `PlaybackEnded` commits the assistant reply.
- [ ] Interrupt long response while it is playing; confirm `InterruptExactTurn` carries the old ped/turn/generation identity, old assistant text is discarded, and no late PCM, stream end, history commit, or action affects the next generation.
- [ ] Follow up after interruption; confirm the prior player utterance remains in dialogue context while the interrupted assistant response does not.
- [ ] Same NPC receives multiple rapid typed turns; inspect generation isolation, input history idempotence, and one terminal outcome per turn.
- [ ] Two NPCs receive turns in quick succession; confirm independent native identities, sources, playback acknowledgements, and histories.
- [ ] Special/internal event through the stock event controller; confirm source remains `special_event`, event text appears once as internal context, no fake player message is committed, and any assistant response is committed only after native success.
- [ ] Stock action plus dialogue: use a valid available action and confirm stock timing and at-most-once dispatch; interrupt/supersede a pending action turn and confirm no stale dispatch.
- [ ] Dialogue-only response: confirm no action dispatch and one assistant history commit after native success.
- [ ] With `structuredStreamingEnabled=true` and `earlyTtsEnabled=false`, confirm segmented Responses reaches the final validation barrier before the ordinary whole-dialogue TTS path; compare transcript/actions/history against sequential mode.
- [ ] First controlled dialogue-only turn with both flags now enabled: verify first PCM arrives before `response.completed`, segment order is preserved through one authorized native stream, and there is only one final stream-end handoff.
- [ ] Send an action-bearing `buffered_action` response with both flags enabled; confirm no TTS starts before the completed model decision and current stock action validation.
- [ ] Fault after the first early segment (late command, model refusal/incomplete response, TTS failure, native interruption); confirm the exact generation is interrupted, no action dispatch or stream-end success occurs, and assistant history is discarded.
- [ ] Native authorization rejection: no tagged PCM or stream end follows; player dialogue remains available and assistant text is absent.
- [ ] Missing playback completion: watchdog records failure, does not commit assistant history, and late completion does not revive the turn.
- [ ] Disconnect/reconnect during model, authorization, and playback; old work retires and cannot commit into the new session.
- [ ] Follow-up uses refreshed actor/world context and delivered prior dialogue only.
- [ ] Stock Gemini typed and microphone/audio turns retain their existing owner handoff, exact-speech recovery, and completion behavior.
- [ ] RequestBackup or another available final-only action retains native final-event timing and radio presentation where applicable.

Record game/server/DLL versions, test identities, logs with secret-safe correlation fields, and pass/fail for every applicable item.
