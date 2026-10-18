# EA9 separately approved paid ElevenLabs A/B

**STATUS: NOT RUN. NO BILLABLE SYNTHESIS IS AUTHORIZED BY THIS PR.** This is a separate human-controlled acceptance gate, after Agent F has combined EA0–EA9 and green exact-head CI + isolated off/shadow GTA evidence.

## Authorization gate

The operator must supply a new written billing approval naming the combined Git SHA, voice/model, account, **maximum payable credits or dollar budget**, maximum 20 samples (10 paired A/B), and operator/date. Explicitly set the local environment flag LSA_EA9_BILLING_APPROVED=1 **only for the approved A/B invocation**; unset it immediately afterward. Any absent or other value is denial. Public CI always sets this value to 0 and clears ELEVENLABS_API_KEY. Never put API tokens or written approval into GitHub artifacts, console logs or a PR.

The preflight produces a **plan only** and never calls the vendor. If the approved sample count or budget is unknown, do not run. The operator must separately enforce the billing limit using their vendor account controls and stop upon reaching the cap. The flag is an additional explicit gate, not proof of authorization by itself.

## Design

Use exactly ElevenLabs v4 Turbo with one authorized voice profile (Nathan if properly licensed/available), 24 kHz mono PCM16. Each pair must use **identical canonical spoken words**: A receives plain untagged text, B receives a single approved audio-only delivery tag. Test 10 paired samples balanced between whisper, excited, angry, amused, sad, sarcastic and fearful mapped to the **verified Turbo scared** tag, plus one concerned/no-tag negative control and one raw-bracket sanitization negative control. The actual EA8 allowlist and F-owned resolveSpeechDelivery gate control eligibility. Never substitute an invented concerned, fearful or SFX tag. Keep Luna schema v0 for initial GTA test and opt into v1 only after independent schema acceptance.

Randomize A/B playback order, keep volume, voice, text, endpoint and environment equal, and blind the human listener to the label if feasible. Record vendor audio payload and native output separately with consent. A vendor request successfully returning PCM proves transport only; accepted exact native playback receipt plus actual audible capture is needed to validate game delivery.

For every pair record approved sample ID, request time, canonical speech SHA-256, selected EA intent, exact prefix emitted (or none), model ID, output bytes SHA-256, API status, credits before/after, native first PCM/first audible monotonic latency in milliseconds, sample count, text integrity, any bracket text spoken aloud, stutter, intelligibility, quality and subjective emotion score using the same scale. Do not publish raw dialogue, secrets, payer identity or unconsented recordings.

## Pass/fail

PASS requires no canonical/history/memory text alterations, no unauthorized prefix, no mis-spoken bracket instructions, no hidden cost overrun, no dropped/stuck audio, exact native/history completion, and a meaningful blinded listener result consistent with the intended cue. Separate the measurable transport/latency pass from subjective emotional quality; vendor hints cannot guarantee audible expressiveness. Record NOT RUN if the flag or human approval is absent. Immediately set expressive mode off and perform isolated rollback on material regression, non-equivalent dialogue, unsafe tag behavior or costs exceeding the approved cap.

The EA9 agent did not make API calls, use a real credential, install anything into GTA or perform this A/B test.
