# EA0–EA4 emotional acting — final integration/review handoff

**Integration branch:** `integration/elevenlabs-emotional-acting-ea0-ea4-20261011`  
**Base:** PR #60 commit `8c33082a34e9c6f7db514c9d631135a610b788de`; stacked on ElevenLabs PR #54.  
**Scope:** All five independent implementations plus reviewer-owned composition, safety regressions and CI. Original PRs #62, #64, #65, #63 and #66 have not been merged or modified.  
**Deployment classification:** **Not approved for production / broad experimental GTA use.** Off-by-default offline-integrated candidate; controlled GTA **shadow** trial is the next acceptance stage, followed by a separately authorized experimental audio test.

## Source audit

| Phase | PR | Delivered source / test | Review |
|---|---|---|---|
| EA0 | #62 | Contract, strict config, branded intents, TTS-only six-tag allowlist, config and renderer tests | Integrated; provider renderer wired; off default |
| EA1 | #64 | Synchronous PS2 witness-based scene resolver, pure tests | Integrated with real E1 P1/PS2/turn projection; neutral without same-owner proof |
| EA2 | #65 | Early and buffered segment speech, WebSocket provider, turn-local adapter, tests | Integrated; playback-dependent callback fenced after native receipt; stage-direction sanitation closed |
| EA3 | #63 | Versioned strict Luna schemas, decoder, streaming callback, tests | Integrated; disabled by default; opt in with `expressiveDelivery.lunaDeliveryVersion=1` **only in experimental mode** |
| EA4 | #66 | Bounded ephemeral mood store, native-ack/turn runtime bridge, fixture and boundary tests | **Runtime adapter wired, source-gated inactive** until approved M1 SQLite timeline confirmation and independently verified native protagonist authority exist |

Actual modules and tests were read; independent branches do contain implementations, not only plans. Their file ownership was initially disjoint. All five sources are present on this integration branch.

## Integration defects corrected

1. EA1's plain frozen delivery objects were incompatible with EA0's WeakSet-branded tag renderer. Scene results now use EA0's trusted factory, and EA2 normalizes only through the shared contract.
2. The real provider stack had not been given EA0's pure ElevenLabs tag renderer; wired it into `createElevenLabsSpeechProvider`.
3. EA1 expected the rich observer identity and integer monotonic source-time; the original E1 turn had only its Essential tuple, and EA2 supplied a fractional clock. Added a bounded, revalidated projection using P1 `assertOwnedKnowledgeCurrent`, PS2 `ObservationStore` receipts and `directorOwnerProofFor`, then integer-clock integration. No owner join => no emotional authorization.
4. Experimental provider previously fell back to *raw* user/model bracket text when no valid delivery existed; experimental now neutralizes such markup even with no tag. Off and shadow preserve original WebSocket text.
5. EA2 previously emitted a mood-completion callback on synthesized PCM, before native audible playback confirmation. Now only after successful native `playback_ended` and `history.acceptPlaybackResult` result, and includes the receipt.
6. EA3 schema was implemented but not called by runtime; explicit `lunaDeliveryVersion` gate now feeds both early and buffered streaming requests and transfers hints without touching canonical speech or stock command fields.
7. Tag budget no longer counts segments that cannot fit the allowlisted ElevenLabs prefix inside 3,000 characters. Added a regression.
8. Added genuine Windows/Ubuntu GitHub Actions integration tests, owner-boundary fixtures, and Windows C05 test-helper compile prerequisite.

## Acceptance criteria and current evidence

- **PASS (offline targeted):** strict default off, off/shadow WebSocket parity, unsupported emotion fallback, approved single-tag rendering, malicious raw-tag rejection, 3,000-character ceiling, 24 kHz PCM WebSocket mock, no extra model calls, early/buffered/typed/STT/director mocked lifecycles, cancelled-turn rejection, strict legacy and v1 Luna schemas/reflow/action gates, scene false-witness and cross-NPC fixtures, mood isolation and expiry fixtures.
- **PASS (source integration):** only an owner-verified matching PS2 projection can drive EA1; wrong/missing native binding, host epoch, observer/incarnation, provenance or Essential generation falls neutral. No history, memory, output_transcript, stock command or canonical dialogue field is intentionally rewritten to contain emotional tags.
- **PASS (source lifecycle):** EA2 does not commit mood on synthesis, partial PCM, native interruption or before accepted playback. EA4 adapter is connected to real turn lifecycle calls but refuses to carry mood until both M1 native-confirmed timeline and revisioned native-protagonist authority exist; missing proof returns neutral.
- **CHECK CI AT EXACT HEAD:** `.github/workflows/ea-integration.yml` runs targeted and full Node tests on Ubuntu and Windows. Earlier Ubuntu suites passed. A Windows full-suite failure was traced to an unbuilt unrelated native C05 `ActivityTests.exe`; workflow now builds it before `npm test`. Consult the newest Actions run, not earlier superseded runs, for final pass/fail state.
- **NOT TESTED (requires user's GTA/native runtime):** authenticated actual GTA observer-to-speech matching under live scenes, spatial/native audio, microphone latency, PCM-to-audible time, NPC swaps, native interruptions, sustained performance and gameplay side effects.
- **NOT TESTED (requires explicit billing/audio consent):** live tagged vs untagged ElevenLabs v4 samples, first PCM median/p90, perceived acting quality, billed credit deltas and compatibility for all six ElevenLabs hints.
- **BLOCKED BY OTHER BRANCH:** EA4 can safely operate only once approved M1 native-confirmed save lineage is integrated from PR #52, and a genuinely native player-model/protagonist authority with monotonic revision for every protagonist transition is implemented and injected. No production protagonist provider currently exists on this branch. The mood bridge is now wired, but by default its reads and commits are neutral/null. Do not claim functioning live emotional continuity without receipt-backed GTA proof. No fabricated timeline UUID, player identity, scene receipt or cross-NPC inheritance is acceptable.

## Safe controlled GTA acceptance sequence

1. Keep `expressiveDelivery.mode="off"` for baseline regression. Confirm previous ElevenLabs 24k mono PCM, stock actions, native playback receipts, exact transcript/memory bytes and audible lifecycle.
2. With authenticated P1/PS2 live, switch to **shadow**. Confirm candidate categorical decisions **without** changed TTS request bytes, false reactions, or cross-NPC leakage across known witnessed/unwitnessed scenes. Test actor swaps and native interrupt/restart.
3. Only after shadow receipts and explicit user approval, turn on `experimental` for one bound promoted NPC, **with `lunaDeliveryVersion:0` initially**. Check early/buffered, director, typed and STT flows, voice quality, latency, costs, cancellations and rollback.
4. Evaluate EA3 version1 only in a separately gated experiment; enable EA4 only after independently integrated M1 lineage + native callback proof. Roll back to `mode:"off"` and restart on any false awareness, unexpected tags, delayed audio or contaminated transcript.

No GTA installation, mainline merge, live ElevenLabs call, or actual game acceptance is asserted by this review.

## EA4 integration follow-up (2026-10-11)

**Implementation on this branch:** `src/voice/emotion/moodRuntime.mjs` implements the M1/P1/PS2/native-receipt adapter, and `essentialGlue.mjs` injects it into real `readMood`, `onSpeechCompleted` and `retireTurn` paths. `runSequentialTurn.mjs` sends success only after exact native playback acknowledgement and accepted assistant-history commit; failed/aborted calls invalidate only the current turn. `sceneDelivery.mjs` ranks fresh PS2 danger and explicit dialogue above soft previous mood, and uses source `ephemeral_mood` with no source evidenceRef. `MoodStore` refuses to re-record that derived source, so the same mood cannot propagate indefinitely. The adapter clears on missing/changed proof, Essential connection/bridge retirement and M1 callbacks (when present), preserving the original 22-second / 128-entry limits.

**Activation prerequisites not satisfied by this branch:** The existing P2 JSON profile store does not implement `activeTimelineId`, `timelineWritable`, or `timelineSourceStatus='verified'`. The approved M1 SQLite foundation implementing these fields is in separate unmerged PR #52. Current runtime also has **no native-authenticated protagonist provider**. Bootstrap accepts a privileged `verifiedProtagonistAuthority` option, which must be implemented by a real host-pinned native reader; it cannot be supplied from actor JSON, inferred character names, player text or a static configuration. Its `readVerified()` must return a frozen, host/epoch-pinned version-1 `native_player_model` record with a revision changed on EVERY protagonist transition, including ABA; `isCurrent(record)` must independently recheck source generation and ownership. Without both these authorities, all EA4 read/commit calls fail closed and speech remains exactly as prior EA2.

**New regression fixtures:** `tests/ea4-runtime-integration.test.mjs` verifies one-follow-up continuity with authenticated fixtures, fail-closed M1/native source absence, playback failure/cancellation, timeline, epoch, owner, protagonist and cross-character changes. Scene selector tests prove witnessed danger and current speaker cues beat old mood. New source enum is verified by the EA0 contract tests. Do not mark these passed without the exact-head GitHub Actions result.

**Review verdict:** This fixes the previously missing *runtime wiring*, not the external M1/native authority prerequisite. Controlled **off/shadow** GTA acceptance can proceed after exact-head CI; **experimental EA4 continuity and production deployment remain blocked** until real source providers and GTA receipts are verified. Native C#/ABI and isolated-offline harness must be green at the latest commit.
