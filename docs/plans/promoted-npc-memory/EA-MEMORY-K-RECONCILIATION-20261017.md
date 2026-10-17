# EA + Memory K reconciliation — 2026-10-17

PR: [#216](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/216)
Target: #138 (`integration/memory-k-production-20261012`). Neither the target nor `main` was modified or merged.

**Status: draft / no-go for merge.** Scoped compatibility verification passes; original source acceptance gates remain open.

## Corrections

Continued the existing integration rather than replacing either implementation:

- Kept source-authenticated timeline selection, monotone queue-generation fences, privacy cancellation, and exact user-confirmation tokens. Repeated live-source samples are idempotent; actual connection replacement and ambiguous boundaries revoke authority even when host/epoch strings repeat. The production bootstrap now uses the same tested source binding as EA. A paused explicit choice never grants reads or writes until the exact authenticated run/epoch returns.
- Restored standalone/offline timeline operation without granting native authority, and preserved opt-in single-selected-timeline resume. Updated positive SQLite fixtures to supply the real explicit selection token; missing/mismatched-token denial assertions remain.
- Kept ordinary JSON-profile Luna/SELF/PS4 conversations from being mistaken for failed SQLite captures. Negotiated Memory K sources retain the three-second expiry rule; presentation-only owner-stall tolerance cannot extend their evidence lifetime.
- Preserved `knowledge_request_stale` through streaming transport errors so a privacy rejection cannot become a network retry. Preserved exact inter-segment TTS whitespace and translated public one-based segment indices to the private zero-based speech ledger.
- Reconciled pinned RAGE `PoolHandle`/native-call signatures, gesture native arguments, and the UX4 bridge constructor harness. UX4 CI now builds both production DLLs against hash-pinned public SDKs instead of reporting a successful job when local SDK variables are missing.
- Isolated stock-harness build output per process so concurrent integration tests cannot delete each other's staged modules. Restored existing main-side radio question/history behavior while retaining Memory K's dormant-consumer guard.

The existing ElevenLabs configuration, credentials, voice assignments, provider, PCM playback/gain/pacing, single-submission protection, and default feature switches were not changed by these corrections. No real provider calls or GTA deployment occurred.

## Verification

Runtime-code verification commit: `ab6e6fff4b868c63ff088b4f30299df8e19d4f36` (preceded by `9a99d6b1631a052fc6ab8e6ab7d61045924f4cba`).

- EA0–EA9 combined matrix: 12/12 rows passed, including legacy JSON and Director/native bridge regressions.
- Production Windows net481 runtime and loader: compiled against SHA-256-pinned RagePluginHook 1.124.0, RAGENativeUI 1.9.3, and DamageTrackerLib 2.0.0.
- All 24 native/Essential-ABI test projects: passed on Windows, including UX4, owner sampling, protagonist evidence/integration, source policy, gestures, voice presence, and lifecycle/bridge tests.
- Complete registered EA/Memory K corpus at the exact clean code commit: **225 files, 2,227 tests; 2,216 passed, ten failed original release gates, one conditional baseline comparison skipped. All 215 scoped regression files passed.** Overall exit remains 1 because those release gates are mandatory.
- The conditional #138 H1 baseline comparison was then explicitly exercised against an unmodified `de4b4de242e7596ca868fea18c6c694c3239f3f2` archive: all 11 tests in that file passed with zero skips.
- Repaired Python isolation harness (`d2e26a2`): 158 top-level files, 1,503 passing tests; only S01–S10 failed. Loopback editor/storage regressions pass; external provider requests remain blocked.
- Hosted CI at `d2e26a2`: 21 workflows passed, no failed workflows; I2 inspector was still running at report preparation. Twenty-two existing draft-gated workflows were skipped by their pre-existing conditions. These skips do not substitute for the full local run, and no gate was disabled by this work.
- A supplemental Essential-entrypoint repeat encountered an intermittent process-exit timeout in the G independent-events file after its 21 assertions passed. The same file passed the clean full run and Python run. Further repetition/diagnosis was stopped at the user's request to prioritize getting the personal mod working. This is retained as a harness follow-up, not converted to a pass.
- The standard Essential entry point now delegates to the registered, per-file-isolated verification harness, including nested memory tests and explicit original-scenario setup. Both entry points preserve failing source-gate exit codes.

## Original acceptance gates remain blocking

`memory-k-original-S01.test.mjs` through `S10.test.mjs` still execute the original production runner and real SQLite negative probe, then deliberately fail with `SOURCE_BLOCKED_Sxx`. Their shared probe explicitly reports missing original backend acceptance, native ownership, or playback evidence; synthetic setup does not establish those receipts. These tests were neither removed nor converted to passing assertions.

The missing original scenario proofs cover accepted typed/STT dialogue (S01), source-time witnessed events/recall and independent observers (S02/S03), clarification/acknowledgement (S04), cursor/idle recovery (S05), personality projection (S06), rollback/timeline fences (S07), pre-promotion attribution (S08), correction/suppression (S09), and Director/playback priority (S10). The passing focused production integrations are useful evidence, but do not silently close these separate original release gates. Source-backed scenario acceptance must be completed before merge readiness can be claimed. This is an acceptance-work blocker, not merely a GTA smoke-test checkbox.

## Actual GTA validation still required

Use matching built companion/native artifacts and record their hashes. Retain the user's existing working ElevenLabs configuration and enable experimental capabilities only explicitly for each test.

1. Verify authored/promoted voice assignments, expressive tags and emotional continuity through several audible turns, including segmented speech, PCM level/gain/pacing, and ordinary Luna fallback.
2. Exercise cancellation before provider submission and during playback, player barge-in, supersession and disconnect. Verify no late PCM or stale history/memory, and no duplicate paid ElevenLabs submission for one synthesis attempt.
3. Record accepted typed/final-STT player lines and genuinely completed audible NPC lines; retrieve them across restart and avatar changes within one confirmed save lineage. Verify opt-in auto-resume with one stored selection and denial for ambiguous or multiple timelines.
4. Exercise pause/menu stalls, native reconnect/replacement, protagonist switch, save/load/rollback and world reset. Verify privacy, identity, timeline and mood revocation, then fresh-source recovery or explicit reselection as required.
5. Exercise forget/correct/restore while recalling or generating speech, and verify source-fenced cancellation and durable suppression. Check UX4 direct hold, tap selection and committed-recipient microphone/playback routing.

No merge, deployment or physical GTA acceptance is asserted by this report.

## Wrap-up boundary

The user requested stopping additional validation to conserve usage and reassess. All corrections are pushed to #216; it remains draft and unmerged. The practical next step is a focused GTA smoke test with the existing working ElevenLabs configuration, followed by reassessment of the remaining formal source gates and intermittent harness shutdown.
