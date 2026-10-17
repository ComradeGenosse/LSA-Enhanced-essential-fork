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

## Promotion reconciliation: `main` merged into #216 — 2026-10-17

Branch `reconcile/main-into-216-20261017` is #216 (`bc3cf6dd`, which already contains the #217 reconnect fix and the #218 H2 correction) with `main` (`d9734fe`, PRs #54 and #118) merged in by an ordinary merge commit. `main` and #216 are both ancestors; no history was rewritten. `main` has no file that #216 lacks, so the work was reconciling 43 shared files. #216's evolved architecture was kept wherever the two overlapped (owner/dispose lifecycle, Memory K gates, exact-whitespace TTS, SQLite shared brain, source-authenticated timeline). The net delta over #216 is 13 files (+611/−83).

Carried over from `main` because #216 did not have it:

- PS2/PS3/radio `perception_trace` and `radio_trace` bounded diagnostics and the owner-stall/owner-resumed notifications, with the matching telemetry allowlist entries in `eventContract.mjs`.
- Native radio hardening: three-sample stable debounce, listener-join revalidation, and the hash → name → retired fallback route for radio natives (`SensorAdapters.cs`, `IntelligenceIntegration.cs`) plus the SDK-accurate game stub and radio integration assertions.
- Shared-brain source-tree digest in the candidate build manifest, and `protagonistEvidence: "off"` in the promoted-characters example.
- New in the merge: bounded `native_pcm_forward_failed` telemetry around PCM forwarding (closed reason tokens, byte counts only, no text or audio) that rethrows, so failure handling and ElevenLabs no-auto-retry billing protection are unchanged.

Three auto-merge hazards were found and fixed rather than left in: a duplicate `protagonistProtocol` import, a duplicate `CharacterService.closeStorage` that silently shadowed the ready-clearing shutdown, and a duplicate `protagonist_model` branch/double salience note in the radio path. ElevenLabs configuration, voices, provider, PCM gain/pacing and feature-default switches are not modified; experimental features remain off by default.

Validation on the merge commit (`549f3486`, exact clean HEAD), run on Linux, Node 22:

- Registered EA/Memory K corpus, `--profile all`: 2,228 tests; 2,215 passed; 10 failed; 3 skipped. All 215 scoped regression files passed. The ten failures are exactly S01–S10. The skips match #216's own run on the same machine (two Windows-only tests and the conditional #138 baseline comparison). This covers the #217 auto-resume and #218 H2 tests.
- Python isolation harness: 158 files, 1,504 passing tests; only S01–S10 failed.
- Production Windows net481 plugin and loader compile against the SHA-256-pinned RagePluginHook 1.124.0, RAGENativeUI 1.9.3 and DamageTrackerLib 2.0.0.
- Native test executables under Mono were compared with pristine #216 and are identical in outcome. `IntegrationTests` now runs 191 production assertions (165 before) because the radio assertions were added. Eight tests need real Windows (named-pipe ACLs, process APIs) and cannot run under Mono; they must pass on Windows CI before merge.
- `ws6Latency` is timing-sensitive and also failed intermittently on pristine #216 under load; it passed on the merged tree. It was not altered.

No test was disabled, skipped or weakened, and no security check was relaxed.

### Not established by this work

- **S01–S10 remain failing by design** (`SOURCE_BLOCKED_Sxx`). They are mandatory original release gates and this merge does not and cannot close them. Merge readiness must not be claimed from the passing scoped suite alone.
- **GTA-only behavior is unverified:** real ElevenLabs voice and emotional-acting output, PCM pacing and billing behavior against the live provider, native radio route/debounce and listener revalidation on a running game, UX4 hold/tap/microphone routing, and Luna fallback in game. No provider call or GTA run occurred.
- The Windows-only native tests listed above and the hosted Windows CI have not run on this merge commit.
