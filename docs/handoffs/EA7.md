# EA7 — EA4 emotional-continuity completion handoff

Date: 2026-10-11
Base: PR #68 exact immutable planning commit `4cad39198478d7f03bb8ec6657b674e52fa659dd`
Branch: `feature/ea7-emotional-continuity-completion-20261011`
Source code/test commit: `953b03b875321d69d816270c8203bf48d25fbfa3` (cumulative EA7 changes).
No EA5 native or EA6 SQLite implementation is represented as integrated or installed.

## Actual changes (only EA7 owned paths)

- `lsa-essential-e1-candidate/src/voice/emotion/moodStore.mjs`: duplicate completion of the SAME native generation is now rejected, instead of resetting the mood and extending the 22-second expiry. A delayed older-generation callback cannot undo a newer completed turn.
- `lsa-essential-e1-candidate/src/voice/emotion/moodRuntime.mjs`: invalid/retired OLD-turn cancellation no longer performs a global mood clear and erases a NEWER generation. Fail-closed reads/commits still clear when live proof is missing; clear() remains the lifecycle hook for real save/host/source revocations.
- `lsa-essential-e1-candidate/src/voice/emotion/resolveSpeechDelivery.mjs`: of all completed audio segments, select the LAST fresh, eligible, actually taggable delivery for the full native playback-accepted turn, NOT first callback order. Ignore `ephemeral_mood` as a fresh source; only allow one native completion callback per turn. Reject explicitly mismatched native receipt tuple fields. Do not commit a shadow-only acting proposal, since shadow sends unmodified provider speech.
- `lsa-essential-e1-candidate/src/voice/emotion/sceneDelivery.mjs`: after higher-priority current verified scene evidence and anchored current speech cues, recognize narrowly anchored present-tense NPC statements (e.g. **I'm fine now**) that explicitly repudiate an older soft mood; do not treat this as a newly witnessed event or general sentiment inference.
- `lsa-essential-e1-candidate/tests/ea7-emotional-continuity-completion.test.mjs`: dedicated native receipt, last-segment, shadow, stale cancellation, replay, TTL, current-speech override, source and isolation regressions.

Audited but deliberately unchanged: `deliveryContract.mjs` (strict source/enum/factory) and existing EA4 context and receipt gates. All canonical dialogue, Luna schema, SQLite, P2 permanent personality and memory are untouched.

## Frozen semantics

- Mood is in-process only, bounded by 15–30 second TTL (22 seconds default) and at most 128 in-memory mood entries. No timer, DB, file, memory or LLM rewrite is added.
- One follow-up generation can consume the same soft hint multiple times across segments; a second follow-up cannot reuse it unless the first produced NEW evidence-backed, successful *native-played* emotional audio.
- Only accepted full native `playback_ended` plus stock `history.acceptPlaybackResult` may authorize the turn runner's completion callback. No PCM-generated, partial audio, aborted, interrupted, rejected, superseded or stale native owner callback authorizes new mood.
- The runner currently invokes `synthesized` *after* its native receipt, once for each rendered delivery, which permits selection of the last qualifying candidate without editing another owner's turn runner. Only `verified_scene`, `dialogue_cue`, `luna_hint` may seed new mood. `ephemeral_mood` must not re-seed itself.
- Current P1 binding/claim, PS2 owner, live Essential generation, native host and world epoch, M1 approval and authoritative protagonist revision must all be rechecked. Null/unknown/untrusted proof returns neutral. The runtime tracks revision for Franklin→Michael→Franklin ABA; it never invents the revision.
- Existing scene selector always favors fresh verified danger and anchored *current NPC speech* cues over soft mood. Mood does not create a witness event, knowledge claim, permanent personality trait or history change.
- Last fresh *taggable* delivery is the final audio-acting selection. Unsupported vendor hints (including currently untagged `fearful`/`concerned`) cannot be claimed as demonstrated audible emotion. A provider adapter that silently drops a requested tag will need EA8 feedback to distinguish requested from actually applied delivery.

## Test evidence

New offline suite: `cd lsa-essential-e1-candidate && node --test tests/ea7-emotional-continuity-completion.test.mjs`.

Adjacent regressions:
```sh
node --test tests/ea7-emotional-continuity-completion.test.mjs tests/ea4-runtime-integration.test.mjs tests/emotional-mood-continuity.test.mjs tests/ea2-speech-delivery.test.mjs tests/scene-delivery.test.mjs
npm test
```
Execution evidence: The actual changed module source and checked-in EA7 test source from exact commit `953b03b...` were executed together in a strict in-memory V8 harness with non-EA7 native/perception imports replaced by trusted fixtures: **10/10 EA7 cases passed**. The existing `emotional-mood-continuity.test.mjs` test source was likewise executed with the actual MoodStore source: **14/14 passed**. The original EA4 runtime suite produced **8/8 passes** only after one *in-memory* parse repair, described below, against actual moodRuntime/sceneOwnerProjection/knowledgeInputs source with external service stubs. Aggregate executed behavioral checks: **32/32 passing in the harness**. These are not the stock Node `node:test` CLI, GitHub Actions, real native runtime or GTA.
 
**Inherited blocker requiring integrator/EA9 ownership resolution:** Existing PR #68 file `lsa-essential-e1-candidate/tests/ea4-runtime-integration.test.mjs` line 128 literally contains `assert.equal(f.mood.readMood(next),null;` (missing a right parenthesis). It fails JS parsing and consequently prevents the existing EA4 targeted/full Node CI from passing until corrected. EA7 intentionally did not modify another phase's original test file. After temporary *in-memory-only* parse repair, its eight fixtures passed. The repo remains unmodified at that path.
 
**CI trigger caveat:** `.github/workflows/ea-integration.yml` triggers PRs against `plan/elevenlabs-v4-emotional-acting-20261011` and pushes to `integration/elevenlabs-emotional-acting-ea0-ea4-20261011`, but EA7 PR #78 targets the integration branch and is a different head branch. This means no EA7 exact-head workflow run was scheduled. EA9/Agent F owns the workflow trigger adjustment and full Windows/Ubuntu/native/ABI suite verification. Do not claim green exact-head CI or GTA/billable vendor tests.

## Final integrator requirements (Agent F)

1. Import EA5 authenticated native model/protagonist provider with revocable `readVerified()` and independently checked `isCurrent(record)` on trusted P1 native channel, host/run/epoch/revision and age lease. Verify revision changes for every transition including ABA; never substitute names, model-written content or a local JSON flag.
2. Import EA6's **actual** confirmed M1 SQLite `activeTimelineId`, `timelineWritable`, `timelineSourceStatus` on the actual runtime P2 character store. Observe proof revocation, selected save/timeline changes, read-only transitions and lifecycle invalidation.
3. Inject both authorities into `createMoodRuntime({getRuntime,protagonistAuthority})` through approved bootstrap and native source paths. Keep ordinary voice neutral if either is absent.
4. Ensure native playback receipts include the exact complete Essential `pedId,sessionNonce,turnId,generationId` and accepted history result before invoking `synthesized`. All rendered segment hints must have completed audio, and terminal callback ordering must remain "resolve all segments → native/history accepted → invoke `synthesized` for rendered segments → `retire(true)`".
5. Preserve explicit `clear()` wiring at true host disconnect/source invalidation/reconnect, native epoch changes, protagonist revision changes, save load/fork/selection, owner retirement and bridge shutdown. Avoid using stale-turn finally as a global clear; current reads/commits still fail closed.
6. Correct the inherited original EA4 test syntax error above and ensure an EA7 branch/stacked PR CI trigger. Coordinate with EA8 so unsupported tags and a provider-side fallback are not falsely recorded as actual acted audio. Currently EA2 knows selected intents, not independently proven ElevenLabs audible expressiveness. Its native receipt proves audio completion, not vendor tag effectiveness.
7. Verify `off` and `shadow` provider bytes and no new persistence/stock actions; run targeted and full Node suites, isolated Python, native Windows/ABI, packaging, then source-proven GTA shadow acceptance. Require explicit billing authorization for tagged/untagged experimental A/B.
8. Validate real P1-promoted NPC cross-owner, incarnation, native session, world/timeline changes, interruption, early-buffered/director paths, per-segment callback order, 22-second expiry and rapid protagonist ABA with GTA-backed source receipts. CI mocks do not establish live correctness.
9. Preserve latest-head PR review gates and upstream PRs unmerged; no production declaration until native provider, confirmed M1, CI, GTA and tagged-audio quality receipts are independently accepted.

## Deployment classification

EA7 is a correctness patch for the frozen EA4 API, **not** deployment authority. Even with green CI, runtime EA4 remains intentionally neutral without the genuine EA5 and EA6 sources. Real native/GTA and vendor-audio acceptance remain Agent F/EA9 gates.
