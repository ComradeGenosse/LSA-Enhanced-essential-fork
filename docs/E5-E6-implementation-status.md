# E5/E6 implementation status

Updated October 1, 2026.

## Summary

**E5 structured streaming is implemented and live-API validated.**

**E6 early segmented TTS is implemented and validated through the patched stock-controller / Essential lifecycle harness. Physical GTA acceptance remains open.**

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

The latest **recorded** full regression checkpoint is:

- commit `b604b5e1`;
- **140 tests passed, 0 failures**.

Current `main` subsequently added commit `84df8e30`, which aborts early speech when model processing fails and rejects an incomplete PCM16 sample. A new complete-suite result after that final hardening commit has not yet been recorded in the repository docs.

## Deployment state

A controlled E5/E6 payload was staged/installed in the GTA server directory with both runtime flags enabled, with rollback backups and hash verification recorded in [deployment/DEPLOYMENT.md](../deployment/DEPLOYMENT.md).

That deployment record predates the latest repository-head hardening commit unless a later deployment receipt supersedes it. Do not assume the installed GTA payload is identical to current `main` without a new hash-verified deployment.

## Remaining E6 gate

Physical GTA acceptance still needs to demonstrate:

- audible early playback before model completion;
- continued playback across real segment gaps under one logical native stream;
- no premature successful `PlaybackEnded`;
- correct interruption and late-failure cancellation;
- no stale PCM/action/history after supersession;
- buffered behavior for action-bearing turns;
- one final history commit only after matching playback completion.

Prior Phase 10B evidence—13 turns, 11 with audio/acknowledgements and an observed PCM gap of about 2.98 seconds—remains useful prior open-stream evidence, but it is not counted as validation of this exact E1.1/E6 runtime path.

Once the physical GTA gate passes, the roadmap moves to **SESSION_IDENTITY**.

See also:

- [Project roadmap](ROADMAP.md)
- [E5/E6 streaming design and gates](../lsa-essential-e1-candidate/docs/e5-e6-streaming.md)
- [GTA smoke checklist](../lsa-essential-e1-candidate/docs/gta-smoke-checklist.md)
