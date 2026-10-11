# Phase 0 — completion evidence and acceptance register

**Overall state: IN PROGRESS.** Phase 0 is discovery/scope work only. The existing runtime has not been rebuilt, installed or tested by this PR.

## Work completed in this initial PR

| Gate | Status | Evidence |
| --- | --- | --- |
| P0-01: pinned source comparison commit | PASS (repository) | `main` `79a0aa6eb5f6b655afde65993d5d68cba269bca7` |
| P0-02: identify original Essential binary/bundle and native metadata fingerprints | PASS (source) | [Phase 0 baseline](phase-0-baseline.md) and [action evidence](../research/domains/essential/essential-action-catalog.json) |
| P0-03: lay out migration work packages with offline/GTA gates | PASS (plan) | [10-phase roadmap](roadmap.md) |
| P0-04: initial Essential ownership map and reuse/rewrite cut | PASS (representative source) | [baseline inventory](phase-0-baseline.md), [current ownership matrix](../research/system-ownership-matrix.md) |
| P0-05: MVP versus later parity scoping matrix | PASS (provisional; needs priority sign-off) | [feature-parity matrix](feature-parity-matrix.md) |
| P0-06: current `main` vs open research PR status distinguished | PASS (captured snapshot) | [main roadmap](../ROADMAP.md), draft [#32](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/32), [#35](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/35), [#37](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/37) |

**PASS (source)** means the named fact was inspected in code or existing audited metadata; it does **not** assert runtime behavior. **PASS (plan)** means the requested plan is written, not implemented.

## Remaining work before Phase 0 can be closed

| Gate | Status | Required next work / proof |
| --- | --- | --- |
| P0-07: exhaustive direct managed-code Essential call/field/type map | OPEN | Run `node tools/standalone/phase0-inventory.mjs` from the checkout, review every result and reconcile dynamic/reflection invocations; hand-label requirement owner, call-site and replacement interface |
| P0-08: independent original server protocol/lifecycle inventory | OPEN | Map all `buildCandidate.mjs` patch locations and stock Node session/turn/audio handlers to minimal native↔Node protocol; verify server event schemas/cancellation/cleanup, not just exported functions |
| P0-09: known-good installed game baseline + rollback receipts | BLOCKED (needs local GTA installation) | Capture exact installed native/server/add-on/config hashes (configs redacted), game/RPH/NAudio versions, backups, P2 profile data migration/restore plan |
| P0-10: representative evidence traces | BLOCKED (needs local game/logs) | Collect typed/PTT/audio, promoted NPC, vehicle, combat, reset, spontaneous speech where active; match same actual build before comparison |
| P0-11: spatial audio/lip sync and native host technology spike | OPEN / GTA-GATED | Source audit output options and ownership; identify legal distributable dependencies; prototype needed before final schedule commitment; only real GTA can establish audible spatial correctness |
| P0-12: feature-level omission approval | OPEN | Confirm milestone A/B required user-facing actions; explicitly document deferrals of PR/LSPDFR/hostage and uncertain legacy features; no silent feature loss |
| P0-13: legality/licenses and redistributable third-party assets | OPEN | Review original author and every dependency's terms; avoid reusing proprietary code/assets absent appropriate rights |
| P0-14: scope freeze + downstream decision reconciliation | OPEN | Approve proposed new authority model; log that existing D-001/D-012/D-016 remain current production locks until cutover; open separate architecture review before any changes |
| P0-15: standalone test strategy feasibility | OPEN | Verify RPH/.NET target SDK builds, Node offline tests, real named-pipe or chosen transport, no game assembly executed in unit tests; prepare game-fake contract outline |

## Exact acceptance rule

Phase 0 may be marked **COMPLETE** only when:
1. P0-07 through P0-15 are resolved as **PASS** or explicitly **DEFERRED WITH OWNER + RATIONALE**, except installed GTA baseline/rollback (P0-09/10), which must be captured before the **first** standalone GTA deployment. If those are deferred, Phase 0 is **research-complete / deployment-gated**, *not* fully accepted.
2. Every **Milestone A** feature has an owner, source of truth, data schema/interface plan, offline positive+negative test examples and honest GTA proof gate.
3. Missing proprietary permissions, unsupported audio-output approach, competing native owner risk or unknown vehicle/script interference are documented, never silently waived.
4. No changes to the existing Essential production DLL, bundled server patch tool, production JSON settings, P1/P2 character store or GTA files are made as part of research-only Phase 0.
5. A Phase 1 change can be reviewed against a known frozen specification and will not inadvertently introduce a second GTA control owner.

## Validation commands

From the repository root:

```bash
node tools/standalone/phase0-inventory.mjs > /tmp/lsa-standalone-phase0-scan.json
node --test tools/standalone/phase0-inventory.test.mjs
```

These commands operate only on the source checkout and **do not run GTA or any native game assemblies**. The scan is an *inventory aid*: pattern matches and counts must be reviewed for reflection, implicit protocol dependencies and unused paths before calling the map complete. They cannot certify feature equivalence.

## Branch and merge discipline

- This first draft PR records the roadmap and begins Phase 0; it should **not** be merged under the interpretation that standalone functionality exists.
- If the repo's `main` progresses (especially C-01/radio/ballistics branches), maintain a **new baseline delta** rather than overwriting this historical snapshot.
- Phase 1 must use a new independent project/namespace, isolated build output and a mutually exclusive runtime mode; otherwise it fails the design gate even if unit tests pass.

