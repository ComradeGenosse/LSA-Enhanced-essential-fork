# Phase 4 — standalone audio: production PCM TTS and bounded native queue

**Branch:** `feature/standalone-phase4-audio-escrow`, PR #44 stacked on Phase 3 PR #43. **NOT installed in GTA, NOT physically audible, and NO Essential loaded in standalone source.** The current Essential-based installation and `main` are untouched.

## Implemented

1. **Exact audio authority.** Only a native-confirmed, staged, physically current `NativeTurnPermit` can open a separate `LeaseKind.Audio`. Every IPC write validates host run, world epoch, connection, actor incarnation, conversation turn, audio lease ID, generation, and strict sequence. Node cannot mint an actor or audio owner.
2. **24 kHz raw PCM16LE mono** frames use canonical Base64 over the existing bounded local pipe. Up to 3,000 bytes per chunk, **480 chunks / 1,440,000 total bytes (30 seconds)** per stream, at most four live streams. Every chunk index and exact total byte count must match.
3. **Rolling output queue.** A stream may send up to 30 seconds while **only 192,000 bytes / 4 seconds per stream** are waiting in native memory. Only `IAudioOutput.TryPush` acceptance, on the owner fiber with the exact audio lease rechecked, releases these credits. A null/unaccepted physical sink cannot drain or silently discard audio. `audio.status` reports `queuedBytes, acceptedBytes, forwardedBytes, creditsBytes, sealed`. These are queue/acceptance counters, **not physical played-byte counters**.
4. **Interrupt and backpressure.** Unknown/replayed/out-of-order packets fail. Explicit backpressure can be retried at the same index only after confirmed rejection, bounded by a 2.2-second credit wait; unknown timeouts or disconnect do **not** replay audio. Abort/cancel, native actor recycling, world reset or transport retirement releases buffers/leases. No durable audio files or user speech logs.
5. **OpenAI TTS production adapter**, independent of Essential: `createSpeechPcmProvider` sends `POST /v1/audio/speech` with `response_format: "pcm"`, configured model/voice, and streams raw binary frames. `stageNativePcmStream` preserves even PCM16 samples across arbitrarily split HTTP chunks without materializing the full TTS output. A finite deadline, abort and 30-second audio budget apply. API credentials are read only from the local environment.
6. **Optional typed dialogue → speech**: once an independently produced AI text reply is staged, the standalone `service.mjs` may invoke the PCM speech provider and pass bytes to the native host. Successful result is **`pcm_sealed_not_played`**, not conversation history completion. Without TTS opt-in, existing typed conversations remain text-only.

## Approved direction for the next Phase 4 engineering slices — **planned, not coded**

The [speech architecture upgrade](speech-architecture-upgrade.md) incorporates the separate Qwen TTS [PR #39](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/39), proximity/microphone [PR #37](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/37), and their performance/identity lessons. It is a **versioned extension** of the existing standalone architecture, not an automatic merge of Essential-dependent components.

| Slice | Next implementation deliverable | Current blocker / acceptance |
| --- | --- | --- |
| **S1 Provider-neutral speech** | OpenAI and local Faster Qwen3-TTS `streamPcm` adapters; per-NPC versioned/persisted voice assignment; safe reversible switching; local GPU model family registry | Current standalone `createSpeechPcmProvider` and `service.mjs` are OpenAI/global-env only. Validate Qwen localhost/no-key isolation, clone/custom/design voice contract and PCM format with fixtures before gameplay. |
| **S2 Early dialogue segments** | Luna verified structured text segments -> bounded ordered per-segment TTS; new native segment identity, generation, acknowledgement and cancellation | Existing Phase 3 `TryStageReply` stages **one complete answer only**. Do not claim early TTS or patch segment messages into one-shot audio protocol without schema change. |
| **S3 Playback-first lifecycle** | Native output-backed audio progress, safe 4-second rolling credit window, start/interrupted/completed terminal receipts and later lipsync | Existing audio records `buffered/forwarded/sealed_not_played`. Device/spatial audio backend is missing; adjust 2.2-second credit timeout using real device-progress watchdog rather than assuming Qwen-fast generation is a stall. |
| **S4 GPU and voice performance** | Qwen GPU single-family residency and prioritized warmup/cancellation; matched TTS-only and separate full-conversation latency benchmarks | First PCM != first audible. Measure GPU frame pacing, cold/warm loads, queue pressure and voiced-NPC identity under verified game workload. |

**Not Phase 4:** Independent microphone start/stop, PCM capture, OpenAI/local STT, native utterance ID, one STT reused for multiple source-time verified listeners, and UX4 PTT belong to **Phase 6 M1–M2**. They receive interface/schema planning now so Phase 4 segments/audio do not create an incompatible microphone or history model. Phase 5's first GTA slice remains *typed input*; do not make Phase 5 contingent on completed STT. Both provider adapters and mic-hearing grants must still respect the same native physical actor/turn/epoch fences.

## Local runtime switches — future isolated profile only

`LSA_STANDALONE_TYPED_MODE=enabled`, `OPENAI_API_KEY`, `LSA_STANDALONE_MODEL` enable Phase 3 AI text. Independently set `LSA_STANDALONE_TTS_MODE=enabled`, `LSA_STANDALONE_TTS_MODEL`, `LSA_STANDALONE_TTS_VOICE` to enable the optional Phase 4 PCM source; `LSA_STANDALONE_TTS_INSTRUCTIONS` is optional. No configuration template carries a secret. **Do not attempt GTA cutover until actor and output gates pass.**

## Verified offline

- Core safety and rolling-queue simulation: exact lease, wrong actor, audio-before-staged denial, stale/reordered PCM, byte alignment, duplicate EOS, queue full with no sink, drain credits only when a **simulated test sink** accepts bytes, 13.75-second PCM transfer under a 4-second native memory budget, cancellation and actor ABA.
- Node tests: production speech request shape, raw HTTP response streaming, odd frame boundaries, bounded total bytes, error and abort paths, explicit backpressure retries and verified `sealed_not_played` without history mutation.
- Windows CI builds net481 native plugin against the public RPH SDK and executes a separate .NET Framework native process ↔ Node stream, including a loopback HTTP TTS provider with the production speech adapter. **No real OpenAI call or in-game device is used.**

## Remaining Phase 4 requirements and safety gates

- **Actual RAGE-targeted output backend:** route stream PCM to the correct NPC through a verified real audio device with spatial position, occlusion/attenuation if applicable, speaker association, and safe concurrent arbitration. Production host currently constructs `NativeAudioRegistry` with **no** `IAudioOutput`. This is intentional; a long stream then stalls after four seconds and fails closed.
- **Physical callback receipts:** distinguish device accepted, audible playback started, interrupted and physically completed before allowing any `PendingDialogue`/character history commit. Neither native FIFO acceptance nor EOS alone can assert speech completion. Device-backed lip sync remains unimplemented.
- **GTA acceptance:** validate installed RAGE SDK, actual plugin fibers and native DECOR actor lifetime/reuse under live GTA Enhanced conditions. The standalone actor adoption gate remains `allowExperimentalAdoption=false`.
- **No rollout, merge or playable replacement claim.** Phase 4 audio pipeline is source-integrated and offline tested only.

The [OpenAI Audio API reference](https://platform.openai.com/docs/api-reference/audio) documents the speech endpoint and raw PCM response format; actual output sample conventions/device routing must still be validated with real output in game.
