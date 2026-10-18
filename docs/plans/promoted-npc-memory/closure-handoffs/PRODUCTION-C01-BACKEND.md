# PRODUCTION-C01-BACKEND — D01 original Essential accepted input

**STATUS: SOURCE CAPABILITY MISSING / A01a BLOCKED / CONTROLLED GTA NO-GO.**

Branch: feature/memory-k-c01-backend-accepted-input-20261012. Exact parent: PR #94 commit 0201731973a1c02a8852271897e2c8df420396b9. Source requirements: PR #113 D01 / revised A01, PR #97 W01, PR #103 T1, PR #110 pinned native Core IL audit. The final SHA is reported in this branch's pushed draft PR body; embedding a commit's own SHA into itself is impossible.

## Exact original pinned source audit

- server.bundle.mjs pinned SHA-256: 5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2.
- LosSantosAlive.dll original Core pinned SHA-256: 9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653.
- Patch source manifest: lsa-essential-e1-candidate/patches/essential-hooks.json, unchanged. Offsets below refer to the original minified source and are verified by the added Acorn AST audit; the branch does NOT introduce an offset-based source edit.

| Source anchor, original offset | Actual contract | Why it is not accepted-turn proof |
| --- | --- | --- |
| Xn at 800772 | binds turn/generation/session; emits GENERATION_STARTED | reservation, not acceptance |
| AP at 801918 | INPUT_TRANSCRIPT is merged using SK, current generation checked by xP | mutable STT fragment, not final |
| SK at 818087 | merges/duplicates chunks | corrections are not finalized |
| NK at 833603 | parses serverContent.inputTranscription.text when nonempty | no final/accepted flag |
| vi at 838487 | trims text and calls connection.sendText | transport submission only; whitespace altered |
| YK at 847414 | assigns providerAcceptedInputAt on input_transcript | misleadingly named; not final accepted marker |
| ZP at 851429 | session recovery and new generation after silent-turn failures | replay invalidates earlier identity |
| ib at 854202 | typed input via Fr(t.text), default Hello fallback, Xi, Zi, Xn, Td, vi, Sd | trims/defaults text; success is send only |
| lb at 855976 | microphone starts and creates turn | not acceptance |
| wd at 857488 | mic hydration, generation bind, realtime activity start | not STT completion |
| ub at 859141 | mic stop and audio drain request | mic release not acceptance |
| $y at 862054 | sends activityEnd then Py/Sd | local input-end not final transcript |

This establishes the missing capability precisely: the pinned original Essential backend does NOT expose a verified post-acceptance typed/STT transition with exact final UTF-8 bytes/digest, original run/revision, original pedId/turnId/generationId/sessionNonce, accepted lifecycle status, source timestamp and retirement/cancellation identity. No exact native speaker attestation is implied by original backend transport. The pinned native Core audit confirms submission methods, not ordinary accepted input callback. The OpenAI adapter in src/openai/runSequentialTurn.mjs has its own STT and RAM history path; this is NOT an original backend C-01 callback. Neither a completed provider send, INPUT_TRANSCRIPT, model output nor DialogueHistory.commitPlayerInput may be elevated into original acceptance.

## Delivered source and API

- lsa-essential-e1-candidate/src/memory/originalBackendAcceptedInput.mjs: immutable OriginalBackendAcceptedInputV1 **future schema**, exact-byte UTF-8 SHA-256 diagnostic helper, strict tuple/source run/revision gates, stale generation and retire/disconnect vetoes, exhaustive rejection of submission/transcript/history/provider/model claims. No positive issuer is exported. verifyAccepted() ALWAYS returns null at this pinned source.
- lsa-essential-e1-candidate/src/memory/originalBackendSourceAudit.mjs: checks upstream SHA-256 against unchanged pin, parses vendor Acorn AST, checks function declarations, semantic anchors and hashes; returns source_verified_missing_capability or rejects source drift. No patch.
- lsa-essential-e1-candidate/tests/memory/originalBackendAcceptedInput.test.mjs plus root suite registration tests/original-backend-accepted-input.test.mjs: Unicode, profanity, punctuation, byte/whitespace differences, empty/surrogate rejection, typed/STT partial/reissued/late correction, forged status, wrong nonce/revision, stale generations, duplicate/retired/disconnected and original-source AST guards.

Expected K/T3 private read-through API:

    import {createOriginalBackendAcceptedInput} from './memory/originalBackendAcceptedInput.mjs';
    const port=createOriginalBackendAcceptedInput();
    port.verifyAccepted({identity,source,text,host}); // ALWAYS null: no original hook
    port.retire(identity);
    port.supersede({pedId,sessionNonce,generationId});
    port.disconnect();

Never interpret describeSignal or digestExactUtf8 as proof, and never register an ordinary app-supplied emitter, mock nativeVerified status, PS3/PS6/Director acceptance or source callback in production.

## Precise integration guidance for Agent K

**There is currently NO valid original source positive hook location.** Do not hook ib immediately after vi, AP on INPUT_TRANSCRIPT, YK.providerAcceptedInputAt, $y after activityEnd, Xn after allocation, or the OpenAI adapter's history commit. These are earlier or different events and would falsely accept rejected, superseded or corrected input.

To unblock: independently establish a real pinned original backend post-acceptance final typed/STT lifecycle event and original final bytes, and its cancellation/supersession/reconnect fences. Re-audit actual source using Acorn plus the unchanged pin contract or a separately reviewed versioned source manifest. K alone edits the original AST patch coordinator, runner, essentialGlue, bootstrap and integration. The new positive issuer must be lexically private to the authenticated source-backed hook, with no caller-accessible accept/setAccepted or Boolean bypass. Join only with separate current authenticated native owner/player evidence at the one P2 SQLite writer, recheck lifetime at commit and report an actual durable receipt. Do not mark A01a or A01c accepted until actual positive and negative tests at one exact head succeed. The proposed OriginalBackendAcceptedInputV1 is NOT emitted by this branch.

## Verification (do not overstate)

Executed in isolated container: node --check on both source modules PASS; Node v22.16.0 (NOT Node24) adversarial policy subset: 5 pass / 0 fail. Command:

    node --test --test-name-pattern='C01 backend|SHA-256|typed submission|mic release|invalid tuple' lsa-essential-e1-candidate/tests/memory/originalBackendAcceptedInput.test.mjs

Full original AST test was not locally runnable: local workspace lacked original upstream bundle/vendored Acorn. The code and test are committed for Node24 repository CI. Required independent confirmation:

    node --test lsa-essential-e1-candidate/tests/memory/originalBackendAcceptedInput.test.mjs
    cd lsa-essential-e1-candidate && npm test
    npm run build

No Node24 green receipt was available while authoring; no net481 build, real original positive accepted event, full GTA/SQLite original acceptance replay, GTA deployment, main merge or production enablement claimed. **D01 remains BLOCKED and source-safe.**
