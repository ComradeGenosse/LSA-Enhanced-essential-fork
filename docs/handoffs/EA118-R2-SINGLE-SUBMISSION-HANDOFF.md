# EA118 R2 — ElevenLabs Single-Submission Retry Safety Handoff

**Workstream:** R2 of planning PR #124, planning commit bf7957510135f9956af8dc463a1b9be2f8d6cefa.
**Original:** PR #118, source commit 4db9eeea534ddf90a1eb0a173c7b7167d363a784.
**Draft code PR:** [#125](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/125) against integration/elevenlabs-emotional-acting-consolidated-20261012.
**Last code/test commit before this handoff:** 7c3fe5c7fcd02ed0c9b1b604b2ab318025651390.

## Root cause and fix

The actual ElevenLabs Text-to-Dialogue provider sends its WebSocket inputs frame **before** receiving PCM. The original turn runner only sets nativeHandoffStarted after PCM enters forwardPcm, leaving retries eligible when an already-submitted request times out. This impacts both early streaming and buffered/final speech operations.

One shared canRetryTts closure in runSequentialTurn.mjs now blocks **every automatic retry of a single ElevenLabs TTS operation**, even before any PCM. It is used at both TTS sites. The buffered path retains its existing !hasAction guard. A distinct valid speech segment still gets its own first submission.

Reasoning and STT retries, stock OpenAI/Qwen speech retry behavior, cancellation, timeout deadlines, native authorization, original dialogue, PCM handling, history acceptance, emotional acting tags, provider-result WeakMap brand and EA4 mood commitment are unchanged.

## Exact changed files and commits

1. lsa-essential-e1-candidate/src/openai/runSequentialTurn.mjs — code patch 4bb840d307bd54c05d04ffbc119d9a35e1c350c5.
2. lsa-essential-e1-candidate/tests/ea118-elevenlabs-retry-safety.test.mjs — initial test 7fc9319aa63cf5b735fa12f101edadbca49961c7; corrected tagged-payload expectations e1d8fd8ca16873053bce420355d3a0f21ece2564; strengthened partial-PCM and buffered-action fences 7c3fe5c7fcd02ed0c9b1b604b2ab318025651390.
3. docs/handoffs/EA118-R2-SINGLE-SUBMISSION-HANDOFF.md — this handoff, documentation only.

No modifications to Agent A/native files, PR #54 speech provider, main, Memory K or GTA installation.

## RED — reproduced original duplicate

The test-only source commit 7fc9319aa63cf5b735fa12f101edadbca49961c7 retained the original runner and executor.

[GitHub Actions 38256118566](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38256118566), Ubuntu Node 24 full Essential: **1,018 tests, 1,013 passed, 4 failed, 1 skipped**.

The fake WebSocket captured two identical submitted inputs for one TTS operation, both buffered (R2.01) and early-segment (R2.02): **two copies of “[laughs] First joke.”** A no-open timeout additionally caused **two** real executor attempts (R2.03). This proves duplicate submission risk, not duplicate vendor billing.

The initial test assertions accidentally expected an untagged payload in experimental mode; this was corrected in e1d8fd8 to assert the legitimate [laughs] prefix. Thus initial R2.04 failure was a test expectation issue, not a claim of duplicate submission after native PCM.

## GREEN — repaired code and mandatory cases

[GitHub Actions 38256586135](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38256586135), Ubuntu Node 24 Full Essential step on e1d8fd8ca16873053bce420355d3a0f21ece2564: **1,018 tests, 1,017 passed, 0 failed, 1 skipped**. All eight new tests collectively covering R2.01–R2.09 passed. The parent workflow was subsequently superseded/cancelled; only its completed green Essential step is claimed here.

[Latest code/test head workflow 38256764610](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38256764610) tests commit 7c3fe5c7fcd02ed0c9b1b604b2ab318025651390. Inspect its final job status separately, as well as the eventual documentation-only handoff HEAD; earlier green tests do not substitute for exact-head CI.

All tests use **actual runSequentialTurn + executeProviderOperation + ElevenLabs speechProvider**, fake WebSocket, and fake native host (no network). Retry policy is explicitly enabled with maxAttempts=2, attemptTimeoutMs=45 ms, baseDelayMs=0 and overall provider deadline 650 ms.

| Cases | Evidence |
| --- | --- |
| R2.01, R2.09 | Buffered timeout yields one socket input and one real executor attempt |
| R2.02, R2.09 | Early timeout yields one first-segment input; no subsequent segment |
| R2.03 | Before-open timeout and post-send errors yield no automatic ElevenLabs retry |
| R2.04 | Zero-PCM failures never create native acceptance, output PCM, history or mood; partial PCM cannot create completed playback/history/mood |
| R2.05 | Successful tagged result retains genuine WeakMap brand; approved native/history completion yields one mood; rejected history yields none |
| R2.06 | Off/shadow serialized frame arrays are byte-identical and untagged; experimental verified tags unchanged |
| R2.07 | Model, STT, OpenAI TTS and Qwen TTS still retry transient errors; native side-effect and published action guards preserved |
| R2.08 | Cancellation/supersession closes sockets and ignores late PCM; no retry |

## Limitations / release boundary

Offline tests do not establish whether ElevenLabs billed either original attempt or whether its live v4 implementation and timing behave as the fake does. **No paid ElevenLabs requests and no physical GTA tests** were performed. Native game event receipts, audio A/B, and deployment remain unverified. R1 protagonist recovery and R3 final EA integration are independent workstreams; no production release or main merge is authorized by R2 alone.
