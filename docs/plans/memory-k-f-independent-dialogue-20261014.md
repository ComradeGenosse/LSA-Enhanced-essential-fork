# Memory K F — independent conversation recording

Architecture: PR #158, Workstream F. Integration destination: PR #138,
`integration/memory-k-production-20261012`. Temporarily stacked on E2 PR #168,
`feat/memory-k-e2-privacy-recovery-20261014`; E2 is not modified by F.

Pinned E2 base: `4bd12e3f0bc9affd38f541bf0c8592e91b3cf10c`.
Tested production implementation: `bb0cd0d4029578441f9d35a61cbe6f1b8476ba04`.
The following commit adds this handoff and makes the independent offline CI
builder run even if another gate fails; it changes no production/test bytes.
The draft PR body and validation deliverable record the final publication SHA.

## Result and scope

Five small production changes reuse the existing M2/D01/D02/D03, private speech
delivery ledger, and sole P2 SQLite writer. No schema, migration, writer,
authentication, native protocol, STT acceptance or provider lifecycle changes.
M3 event activation and H1/H2 journal-context/recall activation are outside F.
Existing assertions and legacy recording outcomes remain unchanged.

`memoryK.capabilities` uses the existing closed capability map. An explicit map
keeps unspecified optional memory consumers off. Player and NPC switches are
restart-required; creating a new runtime installs a fresh recording policy.

```json
{
  "memoryK": {
    "capabilities": {
      "memory.dialogue.player": "on",
      "memory.dialogue.npc": "off"
    }
  }
}
```

Change NPC to `on` for verified player/reply pairs. Set both to `off` to stop
both recorders. NPC `on` with player `off` is blocked, never auto-enables the
player recorder. These requests still require OpenAI D01, P1/promoted SQLite,
the original actor association, fresh D02 native ownership, a verified source
and explicitly confirmed timeline. The existing storage-only profile requires
all optional memory consumers off; it cannot be combined with recording on.
The stock Gemini source remains denial-only.

## Before/after capability matrix

| Configuration | E2 baseline | F behavior |
|---|---|---|
| Explicit player on / NPC off | Entire coupled consumer bundle disabled | Exact authenticated accepted player lines only; no NPC ledger or writes |
| Explicit player on / NPC on | Entire coupled consumer bundle disabled | Accepted player plus verified completed NPC delivery, linked to that durable player line |
| Explicit both off | No dialogue writes, but D01 issuance and recording lifetime subscriptions still installed | No accepted-input issuer/intake or optional acceptance subscriptions; no NPC delivery ledger, writes, or recording workers |
| Explicit player off / NPC on | Static policy blocked; no operational recording status | Runtime blocked with the player dependency named, effective off; no hidden player activation |
| Storage-only | All optional memory off | Still all off, mandatory P2 privacy/source guards retained |
| Absent/empty capability map | Legacy bundled recording/context behavior | Legacy behavior retained, including explicitly classified failed/interrupted NPC outcomes |
| Mandatory privacy | E2 guards remain installed independently of optional memory | Same guards plus a reply cannot append against a forgotten player dependency |

D02 is an existing independent source-plane prerequisite. Its authenticated
subscription remains even with storage-only/both-off, as the original E1
assertion requires. F adds no second D02 subscription. The recorder-owned host
and world-boundary acceptance subscriptions exist only with player recording.
P2's own host/boundary subscriptions remain mandatory for retained-data privacy
and timeline safety. No recorder introduces a timer, worker, event bus, writer,
background retry or provider call.

## Acceptance, delivery, durability and privacy

- D-022 is unchanged: only `commitPlayerInput`'s current exact typed/final STT
  acceptance mints D01. Default greeting substitution, debug/system events,
  empty/incomplete STT, superseded input and caller-fabricated bytes do not
  create memories. A genuinely accepted line survives later interruption;
  source/session/owner/world/timeline loss before commit still rejects it.
- Explicit NPC recording uses D03's existing ledger verification and accepts
  only `completed`: fully forwarded provider PCM, finalized stream, matching
  native successful playback and runner history acceptance. Its initial check
  and in-transaction evidence reread both enforce completed-only. Failed,
  interrupted, missing-ack and model-only drafts cannot become NPC memories.
  Legacy outcome classification is retained without editing its assertions.
- D03 still joins the durable player line, original acceptance source run,
  current owner incarnation/player/avatar and fresh native lease. Rechecks,
  transaction rollback, bounded native-loss retry, source provenance sidecars,
  deterministic turn IDs and independent queued durable readback are reused.
  Duplicate callbacks produce one row/sidecar and the same record ID. Retired
  capabilities cannot retry; a reconnect needs a fresh authenticated stream.
- An adversarial completed-delivery test exposed a missing privacy dependency:
  P2 previously checked a reply's parent existence/scope but not its permanent
  suppression. The existing `appendDialogue` now verifies the parent's content
  checksum and uses E2's `isSuppressedSource` in the same transaction. Recovery
  trash bytes cannot authorize a new reply. Corrupt suppression remains
  fail-closed. No suppression/correction guard is relaxed.
- Franklin/Michael/Trevor remain one human. Avatar is immutable source metadata;
  NPC, world and timeline remain separate scopes. Retained raw transcripts may
  exist for authorized recovery, while the committed evidence feed excludes
  suppressed lines across avatars and after restart. Correction semantics,
  archive publication controls and E2's recovery protections are unchanged.
- Diagnostics are read-only: per-capability requested/effective mode, stopped,
  blocked, waiting or ready, reason, delivery policy, restart requirement and
  the last operation's non-content status/durability. `ready` explicitly means
  `scope_verification_required`, not global owner/privacy integrity or proof
  that every NPC is eligible. No transcript or identity is exposed in status.

## Validation and reproducibility

Node 24.19.0, Windows 11 `10.0.26100`, Linux x86_64 Ubuntu/WSL2. Linux runs use
native temporary filesystems and exact Git archives, including vendored Acorn.
Provider HTTP/STT/TTS, P1/native frames and playback ACKs are offline fixtures;
the pinned original bundled runner, source verification, D01/D02/D03 and
file-backed SQLite are real. No physical GTA or live-provider receipt is claimed.

```text
node tools/memory-k-verification/f-suite.mjs --output work/f-validation
node tools/memory-k-verification/e2-suite.mjs --output work/f-e2-validation
node lsa-essential-e1-candidate/tools/buildCandidate.mjs
```

F's runner hashes and executes ten unchanged recording/privacy entrypoints,
then the F additions separately. E2's runner retains its 22 unchanged original
entrypoints (including WS6/10k/latency) and latest 27 prerequisite tests. F's
new suite is registered additively; no original test/inventory is removed.
The exact-head Windows/Linux workflow uploads TAP, host and hash receipts even
on failure. Its job remains red if any gate fails. Independent package build
evidence still runs on a red prerequisite gate; this does not waive that gate.

| Gate | Windows | Linux |
|---|---:|---:|
| E2 baseline original recording suites | 116/116 | 116/116 |
| Identical F tests on E2 baseline | 3/21, 18 failures | 3/21, same 18 failures |
| F candidate original recording suites | 116/116 | 116/116 |
| F candidate independent recording tests | 21/21 | 21/21 |
| Candidate original E2/WS6 inventory | Isolated 264/264; earlier staging-collision run 262/264 retained | 263/264, inherited K07 red |
| Candidate latest E2 tests | 26/27, inherited damaged-ledger assertion red | 26/27, same inherited red |
| Pristine E2 baseline latest E2 tests | 26/27, same failure | 26/27, same failure |
| Original source-verified offline builder | Passed, 70 expected AST edits | Passed, 70 expected AST edits |

The three baseline F passes are negative cases already satisfied by disabled
recording; they are not independent activation certificates. All baseline and
candidate failures remain in the receipts. The original recording and E2/WS6
test bytes match the pinned latest E2 base. All 32 original entrypoints plus
three E2 entrypoints remain unchanged; only the new F entrypoint is added.

Exact baseline archive SHA-256:
`14627eac9076e0ffb0c5dee574ef0c54a2c470168552f458b189e6ef88305f49`.
Exact tested implementation archive SHA-256:
`9c69b90cd0864e224cdc67ce1e9408d55b8d09e1142a37bdd775cff2033fe8c`.
The original patched-bundle hash on both hosts is
`eb5b3cd45c4c9b8de51c476e30e956854375e353da664e88a18e1677b7427233`.
Companion/shared runtime modules are separately staged; identical bundle hashes
do not imply identical complete release payloads or native/package acceptance.

## Investigated red gates and remaining limitations

1. **New E2 test contradiction, reproduced on pristine E2.**
   `E2 scope receipt requires the complete original suppression bundle` deletes
   one suppression while leaving its tombstone, correctly asserts that the
   privacy receipt is rejected, then expects `listSuppressedMemoryIds` to
   return successfully. The existing mandatory ledger guard rejects that final
   read with `memory_suppression_integrity_unavailable`. Both hosts reproduce
   this on the unchanged E2 base. F does not edit that assertion or weaken the
   guard. The E2 prerequisite suite remains red pending owner reconciliation.
2. **Inherited Linux K07 failure.** The same unchanged
   `K07 stale, replayed, predated and forged replies never resolve a clarification`
   fails with `memory_source_forgotten` on the current pristine E2 baseline and
   candidate. It was also documented before F in E2's handoff. This test appends
   a later line with the same `first` content after forgetting; permanent
   fingerprints can reject it. F's parent-reply guard is not involved in this
   player append. The red original result is retained.
3. **Inherited modular discovery failure.** Both candidate and pristine E2 fail
   because `ws6Original10kWriteRegression.test.mjs` is unregistered in the
   inherited inventory. F's own registration is present. The E2 runner executes
   the original 10k suite unchanged, and the general gate stays red.
4. **Local environment/runner mistakes retained.** Sandbox Windows hard-link
   denial was resolved with native execution, preserving P2 atomic publication.
   Initial F test errors (invalid configured timeout, raw-archive expectations,
   Windows FIFO teardown of a reopened database) were corrected only in the new
   tests. An early D02 gating change failed the original storage-only assertion;
   F restores the independent source subscription. Concurrent local original
   harness/package builds collided in shared ignored `dist` staging, producing
   ENOTEMPTY/ENOENT failures. The builder was rerun sequentially successfully;
   an isolated unchanged E2/WS6 rerun passes 264/264 and is recorded separately; the original
   failed receipts are preserved. No production workaround or assertion bypass.

Switches are runtime-start configuration, not live updates or persisted
per-character policy. Source loss can intentionally leave an accepted line
`not_stored`; there is no unauthenticated background reconstruction after
restart. Readiness does not guarantee current proof for any given NPC. The
offline tests cannot prove playback in GTA. Mandatory privacy services remain
available through existing privileged authorization; optional conversational
M5/context/recall are not activated by F.

Full S01–S10, independent W09/package/source gates, reviewed native SDK pins,
production native builds, physical GTA, whole-product latency and soak remain
separate #138 release gates. Existing E2 NO-GO documentation still applies.
No deployment, live cloud calls or automatic merge occurred.

## Integration instructions

1. Keep this PR draft and based on E2's branch until E2 is integrated into #138.
   Review only F's five production seams, new tests, CI/registration and handoff.
2. Reconcile E2's red assertions and inherited K07/discovery gates explicitly;
   do not turn these results green by removing tests or weakening privacy.
3. After E2 is integrated, fetch #138, verify the integrated prerequisite, and
   retarget this PR to `integration/memory-k-production-20261012`. If E2 is
   squash/rebase-merged, replay only F commits onto the integrated E2 state;
   exclude E2 commits from F's review diff. Record the new base/head SHAs.
4. Rerun F and E2 runners, original D01/D02/D03/WS6, and source/native gates on
   the retargeted exact head before the integrator merges. Preserve source and
   SQLite/privacy fences. Do not retarget to `main` or deploy GTA files.
