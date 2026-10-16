# PR #184 vs Memory K #138 — current-head reconciliation audit (2026-10-16)

**Base inspected:** `57f65baae72d570b71fb90b02725896ecd0557ca` (PR #138 after PR #201).
**Original source:** PR #184, `57fe1c5fc5d9f268f5751f17c31ecf9967100f48`.
**Existing reconciliation:** PR #185, merged into #138 as `599ab1baecff81de3f90d40fa54ab13074b06d8d`.
**Disposition:** No runtime transplantation required. Keep #184 unchanged. This PR is a verification record only; no source/config/audio changes.

## Reconciliation outcome

PR #185 already reconciled #184's 37 changed files: 33 nonoverlapping paths copied, and four paths (`bootstrap.mjs`, `editorServer.mjs`, `essentialGlue.mjs`, `sqliteProfileStore.mjs`) manually integrated alongside I1/I2 functionality. The source-level cross-check against today's #138 confirmed #184's added substantive lines throughout the touched files; the sole nonliteral signature was the editor constructor, which now retains **both** `inspectorControls` and `diagnostics`. Line-presence checks alone do **not** prove equivalent runtime behavior: retain the test and live acceptance gates below.

| #184 requirement | On current #138 | Action |
| --- | --- | --- |
| Summoned promoted NPC registration across equivalent RAGE wrappers | `native/promoted-characters/PromotedCharactersIntegration.cs` retains `SameRegisteredActor`, address/handle checks, registered anchor, and current owner/P1 verification | Keep newer code; do not recopy old native integration |
| Typed input recorded in M2/H1/H2 | `openaiRuntimeAcceptedInput.mjs`, `d03OriginalDialogueJoin.mjs`, `essentialGlue.mjs` retain exact authored keyboard route and capture diagnostics | Keep |
| Routine roster maintenance does not cancel live conversations | `nativeCurrentOwnerPlayerAuthority.mjs` and original D02 tests preserve an unchanged roster's live lease, without renewing TTL or resurrecting revoked ownership | Keep |
| Native actor IDs match across intake/ledger/receipts | `nativeActorId.mjs`, native integration and original-turn ledger preserve exact hex keys, legacy decimal compatibility, no unsafe numeric conversion | Keep |
| Verified identity recovery | `identityResolver.mjs` caches *hints*, then requires fresh native proof before rebinding; revocation/conflict clears hints | Keep safety gates |
| Same-run source interruption | P2 source/timeline state includes previously verified same-host recovery; **newer PR #191** added opt-in single-timeline resume and must not be rolled back to #184's older selection rules | Defer to current code and its own tests |
| Read-only diagnostics, bounded admission, radio SDK overload | Implementations and tests present, editor retains newer inspector controls | Keep |

## Newer work must take precedence

- **PR #201 is already merged:** pre-admission uses the strict source fence; only genuinely in-flight requests use the separate privacy-aware fence. A benign SQLite background write must not cancel a sent Luna answer. Actual M5 forget/correct/purge, profile or host changes, and source revocation must still invalidate it. Do not reintroduce `total_changes()` as an in-flight blocker.
- **PR #202 is an investigation**, not a finished generic Luna fallback. Optional-memory failures before STT and deadline starvation are tracked separately; do not paste older admission behavior over a future fallback implementation.
- **PR #191 is merged:** its opt-in timeline auto-resume changes supersede older #184 startup wording where enabled.
- Preserve existing ElevenLabs provider/deployment overlay and installed audio settings. No voice files, configs, databases, keys, binaries or profiles are changed here.

## Existing focused verification (execute on this PR's exact head)

```sh
node --import ./tools/memory-k-verification/offline.mjs --test --test-concurrency=1 \
  lsa-essential-e1-candidate/tests/memory/h1ConversationHistory.test.mjs \
  lsa-essential-e1-candidate/tests/memory/h2FactualRecall.test.mjs \
  lsa-essential-e1-candidate/tests/memory/h1ArchiveCapVsH2Recall.test.mjs \
  lsa-essential-e1-candidate/tests/memory/d01OpenAIAcceptance.test.mjs \
  lsa-essential-e1-candidate/tests/memory/nativeActorId.test.mjs \
  lsa-essential-e1-candidate/tests/memory/nativeCurrentOwnerAuthenticatedIntake.test.mjs \
  lsa-essential-e1-candidate/tests/memory/memoryRequestFence.test.mjs \
  lsa-essential-e1-candidate/tests/memory/d03OriginalDialogueJoin.test.mjs \
  lsa-essential-e1-candidate/tests/p1-session-identity.test.mjs \
  lsa-shared-brain/tests/pause-source-confirmation.test.mjs
```

The pre-existing **Memory K development smoke** workflow is configured to run on draft PRs when `tools/memory-k-verification/**` changes, so this record triggers the existing focused H1/H2/policy smoke without modifying runtime files or inventing a one-off workflow. Check the exact-head Actions conclusion before calling it green. This audit did **not** execute native/C# harnesses or local Node tests itself.

## Remaining acceptance gates

1. Review actual CI results for the new audit PR; run wider D01/D02/M2/H1/H2/privacy suites and native lifecycle/integration harnesses if the smoke check does not cover them.
2. In GTA, summon Nathan, use mic and typed chat, confirm normal replies and durable player/NPC journals through repeated **unchanged** roster refreshes and equivalent RAGE wrappers.
3. Trigger genuine actor death/replacement, native ownership revocation, M5 forget/correct, host/world change and privacy pause; ensure stale answers **do not** speak.
4. Check real ElevenLabs playback compatibility and installed configuration separately; no replacement deployment from this documentation branch.
5. No automatic merge. #184 remains open and untouched for provenance.
