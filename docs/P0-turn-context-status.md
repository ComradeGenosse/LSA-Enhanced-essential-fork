# P0 turn-context snapshot status

Updated October 2, 2026.

**Status:** merged to `main` and offline-verified; GTA runtime acceptance is pending. P0 closes turn-context attribution and target-reference races without changing Essential's native turn, playback, or action-dispatch ownership.

## Scope and behavior

- A turn captures a frozen snapshot of its actor, listener state, actor-associated world facts, and P/V alias-to-entity reference map before provider work can yield. Missing actor or world data is represented as unknown rather than borrowed from a global or previous actor context.
- A listener omitted by the caller retains the value already associated with that native session. Explicit `null` clears it, including on repeated clears; a later omitted value cannot revive a cleared listener. A replacement native session starts with its own listener state.
- Typed, microphone, and special-event entry points carry the context they captured through their asynchronous work. A later actor or world change cannot rewrite an in-flight turn's snapshot.
- Before a stock action is dispatched, P/V references are checked against both the turn's reasoning-time alias map and the latest actor alias map. Reordered maps that resolve to the same entity remain valid. Missing, invalid, reassigned, or superseded references fail closed. The existing stock dispatcher remains the action execution boundary.
- Telemetry reports only allowlisted event names, status values, counts, and reference categories. It does not record listener values, world facts, entity IDs, prompts, transcripts, or other private context.

The implementation is intentionally limited to P0. It adds no durable character identity, cross-session memory, new perception or salience system, autonomous scene behavior, or new actions; no P1–P8 work is included. E6's separate physical GTA acceptance gate remains open.

## Offline verification

- `node tools/runTests.mjs`: **187 passed, 0 failed** on the merged P0 implementation. The suite includes stock controller lifecycle tests, real stock normalization for typed/microphone listener clears, real special-event hydration with separate actor/listener worlds, delayed context capture, real stock action dispatch for stable and changed P/V references, generation replacement, and telemetry privacy checks.
- `node tools/buildCandidate.mjs`: succeeded with **46** expected source-pinned stock-code hooks. Candidate status: `candidate-built-offline-and-live-api-verified-gta-pending`; output hash: `d5043a0da151f34f1480b79aa7d329906b8acf0be5beace3b0df8fca3f444750`.
- Main-path tests: [P0 turn-context tests](../lsa-essential-e1-candidate/tests/p0-turn-context.test.mjs), [decision/request tests](../lsa-essential-e1-candidate/tests/decisions-and-requests.test.mjs), and [stock lifecycle tests](../lsa-essential-e1-candidate/tests/stock-controller-lifecycle.test.mjs).

These checks exercise the checked-in source and stock controller harness. They do not establish GTA entity validity, RAGE behavior, or in-game action outcomes.

## GTA acceptance checklist

Run the following in GTA with safe, non-destructive actions and retain secret-safe logs. Mark each item with a result and build/game/server versions:

- [ ] In one session, verify omitted listener retains the current listener; explicit `null` clears it; a second `null` stays cleared; a later object sets it; object A→B replaces it; an omitted value after B retains B. Reconnect or replace the session and confirm no old listener leaks into it.
- [ ] Alternate turns between two actors with distinct world state through typed input, microphone input, and a special event. Delay a provider response, change the active actor/world, and confirm the delayed turn still uses only its captured actor and world. Missing world data must remain unknown.
- [ ] Exercise P and V aliases whose entity mapping stays the same while map property order changes; confirm the action remains eligible. Change an alias to another entity, remove it, supply an invalid target, or change it while the provider is pending; confirm no stale action reaches the stock dispatcher.
- [ ] Replace/supersede the turn or native session after reasoning but before action dispatch; confirm the old generation cannot dispatch. Verify the next generation can use its own fresh alias map.
- [ ] Remove/despawn or otherwise invalidate a referenced GTA entity between context capture and dispatch. Confirm the current runtime and stock action path reject it safely and report the observed result; the offline harness cannot prove this engine-level behavior.
- [ ] Confirm action capability changes are respected at dispatch time and a valid current action still dispatches at most once.
- [ ] Inspect telemetry from the run and confirm it contains only allowlisted statuses/counts/categories, with no listener text, world facts, raw entity IDs, prompts, dialogue, or provider payloads.
- [ ] Keep E6 acceptance separate: verify audible first-segment playback before model completion, ordered multi-segment continuation across queue gaps, correct interruption behavior, and assistant history commit only after matching native playback completion.

## Files changed

Implementation: `lsa-essential-e1-candidate/src/context/turnSnapshot.mjs`, `decisionValidator.mjs`, `essentialDecision.mjs`, `integration/essentialGlue.mjs`, `observability/eventContract.mjs`, `openai/openaiConnection.mjs`, and `tools/buildCandidate.mjs`. The production-path coverage is in `lsa-essential-e1-candidate/tests/p0-turn-context.test.mjs` and its stock harness.
