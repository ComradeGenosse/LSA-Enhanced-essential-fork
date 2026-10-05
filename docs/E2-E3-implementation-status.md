# E2/E3 implementation status

> **Checkpoint note:** this document records the E2/E3 implementation checkpoint from October 2. Later phases subsequently exercised the OpenAI path through live API and GTA runs. The implementation remains current; statements below about “no live API/GTA run” describe this checkpoint, not the repository's present validation history.

Updated October 2, 2026. Offline implementation is complete in the current source tree. The change preserves E1.1's native lifecycle and the existing Gemini path.

## Delivered

- Added separate reasoning, transcription, and speech provider contracts and an OpenAI provider stack that wraps the existing single-request implementations.
- Added one immutable deterministic voice profile per native session. The original mode selects from the configured pool using ped/session identity; the character-aware extension can instead use Essential's hydrated actor gender/age to filter and rank configured profiles, with ped/session identity breaking ties. Added bounded speed and optional trusted acting instructions.
- Added a shared two-attempt provider executor for STT, reasoning, and speech. It uses one original turn deadline, composed cancellation, per-attempt timeouts, bounded jitter, Retry-After minimums, and conservative transient-error classification. Quota/billing, invalid requests, unknown 429 responses, and semantic output failures are not retried.
- Kept transcript publication, history effects, action routing, native authorization, and stream completion outside provider retry closures. Action-bearing TTS is ineligible as soon as its transcript is published. Dialogue-only TTS is eligible only until its first usable PCM callback enters native authorization.
- Extended allowlisted telemetry for provider selection/attempt/retry events and voice profile dimensions. Late attempt telemetry is suppressed after timeout/closure.
- Added focused provider, voice, reliability, lifecycle, and telemetry tests; preserved existing stock controller, Gemini, native contract, and pinned build checks.

## Configuration

See `lsa-essential-e1-candidate/e1.config.example.json`. Retry defaults are enabled, two maximum attempts, 500 ms base delay, 3,000 ms maximum delay, bounded jitter, a 1,000 ms retry budget reserve, and no separate attempt timeout. `Retry-After` is honored by default. Runtime defaults preserve `deterministic-session`, disabled acting, and the legacy singleton `ttsVoice`; the checked-in example demonstrates the opt-in `character-aware-session` profile map and acting guidance.

The executor only retries clearly transient network/timeouts, 408, recognized transient 429 rate limits, and selected 5xx responses. A recognized server `Retry-After` above the configured maximum suppresses the retry rather than shortening the server's requested wait. Root cancellation, turn deadline expiry, or supersession never triggers a retry.

## Native demographic audit follow-up

A direct Hotfix #3 DLL audit after the first character-aware implementation established the exact native contracts used by voice selection:

- `Gender`: `male`, `female`, `unknown`
- `AgeRange`: `young`, `middle-aged`, `old`, `unknown`
- `PedId`: the current `Rage.PoolHandle` rendered as a string
- core demographic assignment occurs before shipped integration enrichment

That audit found one implementation regression: the exact native `AgeRange = "old"` value was not recognized and therefore degraded to `unknown`. The native-contract follow-up maps `old` to the coarse internal `older` band and adds regression coverage for every exact native gender and age-range value.

The audit also confirmed that the current session-level identity design remains appropriate for this phase. It did **not** establish a better universal durable NPC identifier, and it did not establish enough semantics to safely promote Policing Redefined `modelAge`/`birthday` or other integration-specific identity data into voice assignment. Those behaviors remain unchanged.

## Validation and remaining gates

The baseline before implementation was 106 passing tests. The expanded offline suite passes **131 tests** with no failures, cancellations, or skips. The pinned candidate build succeeds with 25 source-pinned patches. Its patched launcher SHA-256 is `0443800cf148f10baa58558f106baa1e97e6edc2d227c0d48cf8fef15c457ed9`; the E1 source tree SHA-256 is `c2aa248e59d1b5d4de75484eedbfa15f6109d7a3747ea42f5c81dacb0f032ae9`; the release payload SHA-256 is `7154b685e9a4a79d3a92d82068d0cad6c974775482c4ca2dc125018e80babc12`.

At this E2/E3 checkpoint no live API request, injected live provider fault, game launch, or GTA deployment had been performed. Later E5/E6 work supplied live OpenAI capability and GTA playback-path evidence. Dedicated voice audition/calibration and injected provider-fault quality checks remain useful follow-up coverage.

The first character-aware voice extension passed the repository-wide offline gate on October 2, 2026: **164 tests, 0 failures**, followed by a successful pinned candidate build with **25 source-pinned patches** (launcher SHA-256 `0443800cf148f10baa58558f106baa1e97e6edc2d227c0d48cf8fef15c457ed9`). [Validation run](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/36948145647).

The native-contract follow-up added focused demographic regression coverage and the corrected `old → older` mapping is part of the later repository baseline. Physical GTA voice audition/calibration remains open.
