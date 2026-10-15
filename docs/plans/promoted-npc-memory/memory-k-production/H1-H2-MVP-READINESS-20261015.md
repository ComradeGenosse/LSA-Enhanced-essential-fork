# H1 + H2 personal GTA MVP readiness (2026-10-15)

**Assessment: CONDITIONAL GO for planning a reversible experiment; NOT YET CLEARED TO INSTALL.** Target is draft PR #138 at `d750921e85415fa998bf5d9eed987f5825d8d431`. This report deliberately does not claim GTA validation, release acceptance, or newly run tests.

## Demonstrated from exact-head source review

- `essentialGlue.mjs` calls `prepareH1ConversationHistory` only when H1 is enabled, `prepareFactualRecall` only when H2 is enabled, then uses `composeIndependentForegroundMemory` for a single PS4 context. The accepted original D01/D03 player line is a prerequisite. The empty capability map still uses the legacy `prepareLiveTurnMemory` route.
- Explicit capability modes allow H1-only, H2-only, both, and both off; M5/M8 are not prepared by the explicit H1/H2 route. `shadow` is unsupported for these readers.
- H1 and H2 each use native/current owner, host, timeline and SQLite source proofs. Combined stamps must match; prepared source is checked before requests and retries; stale preexisting memory must be rejected rather than falling back to RAM.
- H2 conservatively abstains on unsupported/incomplete counts and missing witness evidence. Feature behavior is supported by source and prior focused test definitions, not by a new exact-head test receipt in this pass.

## Test evidence and gates (DO NOT count queued/skipped as pass)

- Newly executed Windows tests by this pass: **0**; Linux tests: **0**. Passing/failing test counts on this exact integration head are **not available**. This environment cannot clone the public repository or access the user's local Windows/GTA installation, and no matching runner completed during the inspection.
- At review time, [H2 foreground matrix run 38752815246](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38752815246), [H1-B matrix run 38752815123](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38752815123) and [fast draft smoke 38752815229](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38752815229) were **queued**, not green. The first two target the PR merge head `9279d4fa`, not an independently verified physical GTA payload.
- The exact `d750921e` W09 push [run 38752967867](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38752967867) was an immediate workflow-level failure with **0 jobs**, not a failed H1/H2 test. The original W09 YAML had two `if:` keys on the `original-m0-a10` job. This branch consolidates them to one condition and preserves the original draft suppression and `always()` semantics. Re-run/validate after merge; no test success inferred from the edit.
- CI includes H1-A/H1-B/H1-C, H2 preparation/foreground activation, original D01/D03, WS6, P2, source authority and native checks. Their existence is not proof that the current head has passed.

## Severity decisions

**Deployment gate, evidence missing:** Before any installation, obtain a successful targeted Windows/Linux H1/H2 original-runner/privacy/WS6/D01/D03/P2/configuration run at the intended source revision (or an exact matching local run with retained TAP logs). Build the production `net481` native plugin against approved pinned SDKs and build a matching PS4-capable companion; hash-check staging. This is not a newly demonstrated source bug.

**Accepted non-blocking:** Historical Windows 10,000-write heartbeat starvation under unrealistic personal gameplay stress. Unsupported H1/H2 `shadow`; unrelated automatic Memory K features M5/M8/events disabled. Do not change tests to hide stress failures.

**Future scope:** Full Memory K S01-S10 release acceptance, large-scale durability, unrelated interpretation/callbacks. Actual in-game behavior remains **NOT TESTED**.

## Repeatable focused validation commands (Node 24; Windows and Linux)

From repository root on a clean checkout of the intended revision:

```sh
node --test --test-concurrency=1 lsa-essential-e1-candidate/tests/memory/h1ConversationHistory.test.mjs lsa-essential-e1-candidate/tests/memory/h1ConversationHistoryHardening.test.mjs lsa-essential-e1-candidate/tests/memory/h1IndependentActivation.test.mjs lsa-essential-e1-candidate/tests/memory/h2FactualRecall.test.mjs lsa-essential-e1-candidate/tests/memory/h2RealAuthority.test.mjs lsa-essential-e1-candidate/tests/memory/h2ForegroundActivation.test.mjs lsa-essential-e1-candidate/tests/memory/independentForegroundMemory.test.mjs
node --test --test-concurrency=1 lsa-essential-e1-candidate/tests/memory/d01OpenAIAcceptance.test.mjs lsa-essential-e1-candidate/tests/memory/d03OriginalDialogueJoin.test.mjs lsa-essential-e1-candidate/tests/memory/ws6OriginalRunner.test.mjs lsa-essential-e1-candidate/tests/memory/ws6ProductionPipeline.test.mjs lsa-essential-e1-candidate/tests/memory/ws6LiveTurnMemory.test.mjs lsa-essential-e1-candidate/tests/memory-e2-independent-privacy.test.mjs lsa-essential-e1-candidate/tests/memory-k-native-source-only.test.mjs lsa-essential-e1-candidate/tests/memory-capability-policy.test.mjs
node --test tools/memory-k-verification/tests/*.test.mjs
```

Check and preserve **every** test result/skip and GitHub job log; run production native policy harnesses on Windows. Keep known inherited stress failures separate from newly failing ordinary-turn tests.

## Build and staging (do NOT execute installation without permission)

1. On a Windows build machine with the pinned Essential inputs, Node 24, `dotnet`, and approved compile-only .NET Framework 4.8.1/RPH/DamageTracker/RAGENativeUI 1.9.3 references, check out the validated commit. Run `npm run build:characters` inside `lsa-essential-e1-candidate` after setting `LSA_IDENTITY_RPH_REFERENCE`, `LSA_IDENTITY_FRAMEWORK_ROOT`, `LSA_INTELLIGENCE_DAMAGE_REFERENCE`, `LSA_RNUI_REFERENCE`. Output: `dist/promoted-characters/` plus a manifest; **do not** copy developer/reference DLLs into GTA.
2. Set `LSA_PS4_NATIVE_PAYLOAD` to the absolute `dist/promoted-characters` directory. Run `npm run build` from `lsa-essential-e1-candidate`; ensure its native source/hash-pinning and AST patch checks succeed. Companion output: `dist/plugins/LosSantosAliveServer/`. A plain build without matched PS4 native payload is **not** sufficient evidence for H1/H2.
3. Stage matching companion, native loader `LSA.PromotedCharacters.dll` at `plugins/`, and private native bootstrap/runtime/P1 libraries under `plugins/LSA.PromotedCharacters/`. The stock Essential launcher/DLL, Node and ffmpeg are separately required; preserve existing versions and hash-check all intended staged files. Verify the installed/current RPH SDK ABI. The historical `deployment/prepare-install.mjs` / `install-e1.ps1` are an E1 replacement path, **not** a proven Memory K turnkey upgrader; do not use them blindly on a modded installation.
4. Retain the existing OpenAI `.env` privately; do not commit secrets, transcripts, database copies or user-specific absolute paths. Record source SHA, native/source hashes and installed file manifests before GTA launch.

## Required runtime configuration (merge into existing `e1.config.json`)

```json
{
  "provider": "openai",
  "persistentIdentity": { "enabled": true, "mode": "shadow", "worldProfileId": "<EXISTING-STABLE-WORLD-UUID>", "pipeName": "LSA.SessionIdentity.v1" },
  "promotedCharacters": { "enabled": true, "storageMode": "sqlite", "sqliteStorePath": "characters/profiles.v2.sqlite", "pipeName": "LSA.PromotedCharacters.v1", "editorPort": 37921 },
  "memoryK": { "capabilities": {
    "memory.dialogue.player": "on",
    "memory.dialogue.npc": "on",
    "memory.journalContext": "on",
    "memory.recall": "on",
    "memory.commands": "off",
    "memory.interpretation": "off",
    "memory.events": "off",
    "memory.coverage": "off"
  } }
}
```

Do not replace an existing config wholesale: keep existing provider, voice, API and other user settings. Set native `LSA.PromotedCharacters.json` `enabled=true` with that same stable UUID, identity/P2 pipe names and editor port. Verify existing PS4 `dialogueKnowledge.mode` and native intelligence/identity setup and required host checks using the matching package; do not assume flags alone make memory operational. These config switches require restart. For H1-only set `memory.recall=off`; H2-only set `memory.journalContext=off`; both disabled set both off.

## Safe manual backup / rollback

Stop GTA, RAGE Plugin Hook and the companion Node process. Make a separate **private**, timestamped backup of the full existing `plugins/LosSantosAliveServer` directory (including `.env`, SQLite database, WAL/SHM companions, identity files, logs and config), the native `plugins/LSA.PromotedCharacters.dll`, native runtime folder, native `LSA.PromotedCharacters.json`, and any pre-existing shared native files you plan to replace. Include a manifest of hash, size, and whether each target previously existed. Preserve unrelated plugins.

Stage/test only after verifying backup hashes and intended paths. For rollback, stop all processes, **delete only the version-owned paths that this specific test installation created or replaced**, and restore those paths from the matching backup. Remove paths that did not exist previously; verify restored hashes. Never overlay an old runtime over an incompatible new one, and never delete the only copy of the original SQLite database or `.env`. Make a separate copy of the post-test SQLite file for debugging before rollback. Simply toggling H1/H2 off and restarting is a faster temporary mitigation, but not a full binary/DB rollback.

## Five-minute GTA smoke (NOT TESTED)

1. Use one promoted NPC A. Start typed chat: `My favorite color is teal.` Complete NPC playback. Ask `What did I tell you my favorite color is?` Check the response and recorded contribution diagnostics.
2. Finish the conversation, reopen with A, then restart the game/backend and ask A the same question. Confirm P2 SQLite history survives and the previous player line is represented once.
3. Use a different promoted NPC B and ask about A's favorite-color disclosure. B must **not** retrieve A's private line.
4. Switch Franklin → Michael → Trevor when safe and chat with A. Check shared player identity and source-avatar labels, with no extra player duplication.
5. Correct or forget the fact through the existing authenticated privacy controls, then ask again. Never send the revoked line to the provider. Do **not** rely on an NPC's verbal promise to forget as proof that a privacy command executed while M5 commands are disabled.
6. Test H1-only, H2-only and both-off in **separate restarts**. Unsupported questions and unsupported counts must abstain; no crash/hang on missing SQLite/native authority.

**Diagnostic evidence:** record exact commit/build hashes, authenticated D01/D02/D03 durable receipt identity and P2 row counts (without text), H1/H2 `lastPreparation`/`lastValidation`/`contributedToModelRequest`/`requestAttempted`, PS4 outgoing request membership, RPH native plugin startup and owner sample status, no duplicate records, latency and terminal causes. Sanitized E1 JSONL path is `plugins/LosSantosAliveServer/logs/e1-run-*.jsonl`. Do not expose prompts/credentials/private dialogue in public PR artifacts.

**Decision gate:** Clear the targeted Windows/Linux tests and native staging, then use this as a reversible experimental GTA playtest. No new gameplay source defects were proven or fixed during this review; queued CI and an unbuilt current native package prevent a truthful unconditional GO.
