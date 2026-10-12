# Agent A — D01 pinned original Essential accepted input: source-proven blocker

**Date:** 2026-10-12  
**Scope:** Agent A source fence, pinned original backend call graph, denial-only runtime port, adversarial source tests.  
**Decision:** **A01a BLOCKED / NO PRODUCER / NO GTA GO.** This branch must not be used as a positive accepted-input source. It does not prove original GTA runtime acceptance.

## Pin and original source evidence

- Original pinned Essential backend bundle: `lsa-essential-e1-candidate/upstream/server.bundle.mjs`, **SHA-256 `5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2`**.
- Original stock Core DLL: `lsa-essential-e1-candidate/upstream/LosSantosAlive.dll`, **SHA-256 `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653`**.
- Original patch manifest `lsa-essential-e1-candidate/patches/essential-hooks.json` pins both. The original source AST audit verifies the *unmodified original backend* bundle hash and actual handler body SHA-256 for `ib`, `vi`, `$y`, `NK`, `AP`, `SK`, `YK`, `ZP`, `Xn`, and other original functions before describing these paths.
- Pinned native Core IL audit: PR #110. Native `SendTextPrompt` and `SendMicStop` lead to submission, not final original backend acceptance; stock Director callback is unrelated.

### Exact audited paths

| Input | Original functions / observed transition | Why it is **not** accepted-input evidence |
| --- | --- | --- |
| Typed | `ib` → `Fr(t.text)` trim/default and `Xi` turn creation → `Zi` session → `Xn` generation → `Td` recovery record → `vi` → `connection.sendText` → `Sd` input-end/watchdog | Transport send resolution / local input-end is **not** a final backend acceptance ACK. `ib` trims input before sending, so submitting original UI bytes is not proof of exact *accepted* bytes. |
| STT | `wd` generation and context hydration → `$y` → `_d` realtime activity-end → `Py` → `Sd`; provider packet `NK` emits `input_transcript` from `serverContent.inputTranscription.text` → `AP` merges fragments into mutable `e.input.transcript` via `SK`. | No final transcript revision, definitive accepted/committed indicator, or independent original acceptance callback exists in this pinned path. A late correction may change transcript; `turn_complete` denotes a different lifecycle transition. |
| Recovery | `YK` stamps misleading `providerAcceptedInputAt` on `input_transcript`; `ZP` opens a new session/generation and resends original typed text or mic audio. | Timestamp **does not** authenticate accepted bytes. A transcript from an earlier generation can neither be borrowed nor treated as an immutable final wording receipt. |
| Native | Original Core managed IL private-source audit PR #110; PR #103 T1 / PR #117 D02. | Native pre-submission and current native ownership are useful independently, but neither is an accepted-input signal. No `nativeVerified` Boolean may promote it. |

The AST source-witness check fails closed if any of these exact pinned edges diverge. The D01 new test `originalBackendSourceTransitions.test.mjs` executes the **literal original `NK`, `AP`, and `SK` function bodies**, observing preliminary and corrected STT transcript mutation. These are real *original handler transitions*, not synthetic receipt tests, and **they do not prove a final accepted-input transition**. The audited source lacks such a transition.

## Production changes completed within D01 ownership

1. `originalBackendSourceAudit.mjs`: bind source-path witnesses to pinned original SHA-256 + original function-body hashes and expose the precise blocker; mismatched audited edges reject.
2. `originalBackendAcceptedInput.mjs`: immutable schema describes the fields a future genuine issuer must provide, including original bundle hash and final accepted-input revision; `verifyAccepted(request)` is a synchronous fail-closed read-through and **always returns null** for this exact pin; `hasAuthenticatedSource()` is **false**. Caller-set source IDs, `nativeVerified`, digest, accepted flags or revision **cannot mint a receipt**.
3. Denial-only lifecycle: retire exact turns, supersede a generation, revoke a ped/session lifetime, revoke a source run, or disconnect permanently. Invalid fingerprint, old session or generation, wrong run, stale, disconnected, provisional transcript, model completion, provider send or submission cannot authorize memory.
4. New source-executing/adversarial test suite and a Windows/Linux Node24 CI workflow explicitly named *source tests only — A01a BLOCKED*. Hash checks are for original bundle and Core DLL; they are **not** positive acceptance tests.

No production accepted-input hook has been added. No shared `runSequentialTurn.mjs`, `essentialGlue.mjs`, `bootstrap.mjs`, P2 writer, patched bundle, or native production DLL is modified. There is no positive source-authenticated receipt to offer Agent C.

## What must change to unblock the original backend

The original pinned protocol/source must provide an observable **final typed and STT backend acceptance transition**, not merely a transport send, mic end, provider response, transcript fragment or history write. This requires an independently audited original backend change or a demonstrably equivalent **original host binary/protocol extension** that:

1. Authenticates the **original** actor and exact `pedId/turnId/generationId/sessionNonce` plus original run/host revision at admission time, rather than retrospectively correlating mutable ped IDs;
2. Defines and emits the *final* accepted UTF-8 text bytes and SHA-256, typed/STT source, strictly monotonic final accepted-input revision, source timestamp and unambiguous retirement identity **after** any correction, generation and session admission checks;
3. Emits original lifecycle revocation on correction/retraction, replay/supersession, session disconnect/reset, actor change, and original turn invalidation. Revised STT text must invalidate previous revisions;
4. Makes a private synchronous **original-owned** read-through verifier available for D03, with opaque issuance anchored to the actual original event; never accepts a public callback, app/user-supplied `accepted:true`, hash, or `nativeVerified` as proof;
5. Is audited at exact original compiled source/AST + protocol fingerprint, packaged with corresponding pinned patch manifest and fresh original-runner tests. Only then can Agent C combine D01 with separately authenticated D02 current native player/owner and commit at the single P2 writer.

**Do not simply hook `vi`, `_d`, `NK`, `AP`, `pt('input_transcript')`, `history.commitPlayerInput`, or `Sd`.** They are currently too early, provisional, or unrelated. Adding a new event named `accepted` without an original post-acceptance transition would fabricate evidence.

## D03 handoff and acceptance

The stable D01 read-through available to Agent C is:

```js
import {createOriginalBackendAcceptedInput,ORIGINAL_BACKEND_PIN}
  from '../memory/originalBackendAcceptedInput.mjs';
const source = createOriginalBackendAcceptedInput();
source.hasAuthenticatedSource(); // false on pinned stock
source.verifyAccepted({identity,sourceRunId,sourceRevision}); // null, always
source.retire(identity);
source.supersede({pedId,sessionNonce,generationId});
source.retireSession({pedId,sessionNonce});
source.retireSourceRun(sourceRunId);
source.disconnect();
```

**Agent C must fail closed when `hasAuthenticatedSource() === false` or `verifyAccepted() === null`.** This is a *denial-only port*, not an operational positive issuer. The required *positive* synchronous original-source-authenticated port is **blocked by missing original source capability** and must not be simulated or substituted by D02. No new caller-controlled Boolean is authorization evidence.

### Tests / reproducibility

```sh
node --test lsa-essential-e1-candidate/tests/memory/originalBackendAcceptedInput.test.mjs lsa-essential-e1-candidate/tests/memory/originalBackendSourceTransitions.test.mjs
```

The dedicated CI workflow pins Node24, runs on Ubuntu/Windows and checks original source hashes and these tests.

**Verified specialist source CI for code commit `484020be45d9654e37277e81f566aaa349232f70`:** [Actions run 38265443751](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/actions/runs/38265443751): Ubuntu Node24 **11/11 PASS, 0 fail** (job `114866320561`); Windows Node24 **11/11 PASS, 0 fail** (job `114866321012`). Both verified bundle and Core SHA-256 above; syntax and original source execution checks passed. The preceding run `38265321225` failed one newly added retired-session denial assertion; the actual missing source-run/session revocation checks were added at `484020be...`, after which both OS jobs passed. All successful tests are **source-only negative evidence**; A01a remains blocked.

This handoff documentation update itself creates a later commit. Recheck latest PR head and its exact-head CI; do not attribute the prior successful receipt to a later commit or describe it as proof of A01a. Required acceptance case 'test that actual final original backend acceptance transition occurred' is **not executable** until the original source/binary contract changes.

**Status: D01 feasible source auditing and negative controls implemented; A01a final typed/STT source capability missing. A01/A09/A10 and controlled GTA remain NO-GO.**
