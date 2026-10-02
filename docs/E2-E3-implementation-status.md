# E2/E3 implementation status

Updated October 1, 2026. Offline implementation is complete in the current source tree. The change preserves E1.1's native lifecycle and the existing Gemini path.

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

## Validation and remaining gates

The baseline before implementation was 106 passing tests. The expanded offline suite passes **131 tests** with no failures, cancellations, or skips. The pinned candidate build succeeds with 25 source-pinned patches. Its patched launcher SHA-256 is `0443800cf148f10baa58558f106baa1e97e6edc2d227c0d48cf8fef15c457ed9`; the E1 source tree SHA-256 is `c2aa248e59d1b5d4de75484eedbfa15f6109d7a3747ea42f5c81dacb0f032ae9`; the release payload SHA-256 is `7154b685e9a4a79d3a92d82068d0cad6c974775482c4ca2dc125018e80babc12`.

No live API request, injected live provider fault, game launch, or GTA deployment has been performed. Those checks require separate explicit authorization and remain open; offline test success does not claim provider listening quality or in-game behavior.

The later character-aware voice extension has also passed the repository-wide offline gate on October 2, 2026: **164 tests, 0 failures**, followed by a successful pinned candidate build with **25 source-pinned patches** (launcher SHA-256 `0443800cf148f10baa58558f106baa1e97e6edc2d227c0d48cf8fef15c457ed9`). [Validation run](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/36948145647). Physical GTA voice audition remains open.
