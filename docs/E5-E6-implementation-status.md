# E5/E6 implementation status

Updated October 2, 2026.

## Summary

**E5 structured streaming is implemented and live-API validated.**

**E6 early segmented TTS is ✅ implemented and complete for roadmap purposes.** It is validated through the patched stock-controller / Essential lifecycle harness and has been exercised through the live GTA playback path; remaining early-audio/multi-segment checks are non-blocking regression evidence.

Both features remain opt-in and default off in the checked-in example configuration.

## E5 — structured streaming

The current OpenAI reasoning path can use a bounded Responses SSE adapter with one strict JSON decision envelope. Complete speech segments are exposed only after a segment object is closed, parsed, bounded, and locally validated. The complete terminal response must still reconcile exactly and pass the existing Essential decision/action validators.

The explicit live capability smoke passed against the configured `gpt-6-luna` endpoint:

- first locally validated dialogue-only segment: about **1.05 s**;
- complete `response.completed`: about **1.19 s**.

This demonstrates that the configured model/endpoint can produce a usable complete speech segment before full response completion.

## E6 — early segmented TTS

For an eligible `dialogue_only` response, E6 can begin segment TTS and native PCM handoff while the same model response is still running.

The implementation preserves:

- exact `pedId + turnId + generationId + sessionNonce` identity;
- one serial segment-TTS consumer;
- one logical native authorization/stream-end lifecycle;
- strict final response reconciliation;
- no early speech for action-bearing turns;
- aggregate PCM bounds before native authorization;
- cancellation/supersession fences;
- assistant history commit only after matching successful `PlaybackEnded`;
- model-failure abort of early speech;
- malformed/incomplete PCM16 rejection.

Action-bearing `buffered_action` turns remain behind final model completion and existing stock action validation.

## Validation evidence

The stock-controller integration gate runs two delayed speech segments through the actual patched stock controller and Essential lifecycle bridge. It verifies:

- first PCM is produced before the model terminal event;
- segment order remains correct;
- both segments retain the same native identity;
- one final native stream-end handoff is used;
- assistant history stays staged until matching `PlaybackEnded`.

The current full offline regression result is **149 tests passed, 0 failures** ([test output](../lsa-essential-e1-candidate/docs/e5-e6-test-results.txt)). It includes the `84df8e30` model-failure/PCM16 hardening and the production telemetry repair reproduced from the first failed E5/E6 GTA runs.

The real-telemetry stock E6 test was observed failing before the repair with the same first-segment/zero-TTS signature as the GTA logs, then passing afterward. Microphone tests exercise real and disabled logging with early TTS enabled and disabled. Detailed diagnosis is recorded in the [streaming notes](../lsa-essential-e1-candidate/docs/e5-e6-streaming.md).

The first repaired-build GTA verification run covered 13 microphone turns: all 13 reached native playback, 10 completed normally, and 3 were interrupted. Eight dialogue-only turns started TTS before model completion, but PCM and playback still began after the model finished. Each response contained only one segment, so no multi-segment gap was exercised. See the [full run review](E6-GTA-verification-2026-10-01.md).

## Deployment state

A controlled E5/E6 payload with both runtime flags enabled is installed in the GTA server directory. The repaired installation was backed up and its E1 source-tree hash verified before the run; history is documented in [deployment/DEPLOYMENT.md](../deployment/DEPLOYMENT.md) and the [run review](E6-GTA-verification-2026-10-01.md).

The repaired candidate's E1 source-tree SHA-256 is `78dc5318bb79b945d683498531788523ee0cb426c4c4716e07db2474cf0027d9`. Do not assume the installed GTA payload is identical to current `main` without a hash-verified deployment; the launcher hash alone does not identify changes to the separate E1 modules.

## E6 follow-up regression validation

Additional GTA regression coverage should still demonstrate:

- audible early playback before model completion;
- continued playback across real segment gaps under one logical native stream;
- no premature successful `PlaybackEnded`;
- correct interruption and late-failure cancellation;
- no stale PCM/action/history after supersession;
- buffered behavior for action-bearing turns;
- one final history commit only after matching playback completion.

Prior Phase 10B evidence—13 turns, 11 with audio/acknowledgements and an observed PCM gap of about 2.98 seconds—remains useful prior open-stream evidence, but it is not counted as validation of this exact E1.1/E6 runtime path.

E6 no longer blocks roadmap progression; SESSION_IDENTITY and PROMOTED_CHARACTERS are already implemented on `main`. These checks remain useful for E7/soak validation.

See also:

- [Project roadmap](ROADMAP.md)
- [E5/E6 streaming design and gates](../lsa-essential-e1-candidate/docs/e5-e6-streaming.md)
- [GTA smoke checklist](../lsa-essential-e1-candidate/docs/gta-smoke-checklist.md)
