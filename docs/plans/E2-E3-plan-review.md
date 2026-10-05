# E2/E3 plan review

> **Historical planning review:** E2/E3 were subsequently implemented. Source/workspace availability statements and “no runtime/live test” notes below describe this October 1 review only. See `../E2-E3-implementation-status.md` and the root ROADMAP for current status.

Reviewed October 1, 2026 against both supplied files.

**Verdict: the architecture and scope are good, but the original plan needed several implementation-critical clarifications.** The revised plan keeps Essential authoritative, preserves E1.1 and stock Gemini, and implements E2 before E3. The E2/E3 goals document itself can remain unchanged.

The updated declarative plan is [E2-E3-revised-plan.mjs](E2-E3-revised-plan.mjs). It contains the full original stage structure plus the changes below, rather than requiring an implementer to merge review notes manually. It is a planning artifact, not application code.

## Changes that matter most

| Issue in the original plan | Change in the revised plan |
| --- | --- |
| Native generation checks cannot distinguish two attempts within the same generation. A timed-out request may still deliver a late result or PCM callback. | Add attempt-local tokens, composed cancellation, reader cleanup, and guards immediately before every publication. Close a failed attempt before retrying. |
| First PCM was presented as the TTS retry boundary, while the goals also prohibit retry after another gameplay/native effect. | Use the earliest irreversible effect: action dispatch, native playback start, or first usable PCM handoff. Inspect authorization semantics. Unknown effect state forbids retry. |
| Retry placement could be interpreted as wrapping both providers and the orchestrator. SDK retries were not addressed. | One orchestrator-owned executor wraps each single-request provider invocation. Disable underlying automatic retries and assert actual request counts. |
| Every 429 was retryable, and bounded Retry-After could be misread as shortening a long server delay. | Distinguish temporary throttling from quota/billing errors. Respect a valid server minimum; skip retry if it exceeds the cap or remaining deadline. |
| Shared deadline was described without fully specifying stalled body reads and late output. | Preserve E1.1's actual provider-work start, use a monotonic shared deadline, abort active work/backoff, and reject late output. Distinguish attempt timeout from total deadline expiry. |
| A default voice pool of only nova cannot deliver varied NPC voices and may override an existing ttsVoice. | Derive the legacy singleton pool from ttsVoice when no pool is supplied. Require at least two supported voices to demonstrate variety. Hashing permits collisions. |
| Profile stability did not explicitly cover configuration changes, ped reuse, or delayed teardown. | Freeze profiles for the session; define versioned canonical hashing and identity-aware cleanup. Configuration changes affect new sessions. |
| Acting support and exact audible wording were treated too strongly. | Validate model capabilities, speed, and bounded trusted instructions. Enforce exact request text locally and evaluate audible wording/performance through live listening. |
| E2 required live validation before E3 while live API/GTA work also required separate authorization. | Separate an offline E2 implementation checkpoint from full release acceptance. Continue offline E3 after the checkpoint; mark unavailable external checks deferred. |
| The claimed 106-test baseline and planned filenames were assumed to be established facts. | Add E2P to verify the actual repository, accepted source fingerprint, test results, interfaces, and effect ordering before edits. |

## The important boundary decision

The revised plan follows the conservative rule in your goals: **automatic retry stops once an irreversible gameplay/native effect starts.** If E1.1 dispatches an action before TTS, TTS cannot automatically retry afterward, even if it has produced no PCM. Do not reorder accepted E1.1 behavior merely to enable a retry.

Native authorization needs inspection: a permission reservation may not start an effect, but authorization that starts playback does. The plan treats an unknown boundary conservatively. It also closes retry eligibility immediately before a native handoff, so a throwing PCM consumer cannot accidentally reopen it.

Accepted player history remains durable. It is not rolled back or committed again when a later provider stage retries. Assistant history still follows the existing matching PlaybackEnded success boundary. Failure cannot undo a gameplay action that already occurred.

## API assumptions checked

OpenAI voice availability depends on the selected model. Its documented raw PCM output is signed 16-bit little-endian at 24kHz; its example uses mono. The adapter must preserve sample framing across arbitrary network chunk boundaries and discard failed-attempt buffers. [Text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech)

Speech instructions do not work with tts-1 or tts-1-hd. The documented speed range is 0.25–4.0. The revised plan detects unsupported acting configurations without silently changing models. [Speech API reference](https://developers.openai.com/api/reference/cli/resources/audio/subresources/speech/methods/create)

Retry-After is a minimum delay. A delay above the local maximum should stop automatic retry rather than be shortened. Application retries also need to account for or disable SDK retries. [Rate-limit guide](https://developers.openai.com/api/docs/guides/rate-limits)

429 can represent exhausted credits or billing/spend/usage limits, as well as temporary throttling. Those cases require different recovery behavior. [Error-code guide](https://developers.openai.com/api/docs/guides/error-codes)

## Validation and remaining evidence

The revised module was syntax-checked and imported locally. Its stage IDs and dependency graph were checked for missing dependencies, duplicates, and cycles. These checks establish that the planning artifact is usable; they do not validate the application.

No implementation repository was supplied or present in this chat workspace. Therefore the 106 passing tests, actual module names, E1.1 ordering, and lifecycle behavior remain supplied claims to verify during E2P. No runtime regression tests, live API calls, or GTA deployment/launch were performed during this review.

With those preflight checks and revised safeguards, this is a suitable plan to implement the stated goals. Full release acceptance still requires the specified offline, live API, and GTA evidence.
