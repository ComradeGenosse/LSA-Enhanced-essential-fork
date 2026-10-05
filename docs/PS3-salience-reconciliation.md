# PS3 reconciliation

> **Historical reconciliation record.** The staging work described below was subsequently merged to `main`, followed by runtime-observability hardening and live GTA verification. For current status use [PS3 deterministic salience](PS3-deterministic-salience-status.md), [the first logging-session review](ps3-logging-session-analysis-20261005.md), and [the later combined UX4/PS3 run](ux4-ps3-run-analysis-20261005.md).

Date: October 5, 2026. Staging branch: `stage/ps3-ready-20261005`.

Sources fetched for this reconciliation: `origin/main@df84a70e76e0aaba34c3675ceefdfad67f8a4078` and `origin/feature/ps3-deterministic-salience@579b6df697bf73082b6590bd17ba4a7670b69bf3`. The PS3 commits were applied onto a fresh branch from current `origin/main`; the feature branch was not merged wholesale. Current-main README, roadmap baseline, PS2 contracts/diagnostics, production fixes, UX/input/Harmony sources, and native production sources were preserved. At the time of this staging record GitHub `main` was unchanged; that statement is historical, not the current repository state.

The corrected companion suite passed 384/384 tests across all 36 discovered modules with zero import failures. The 12-suite native offline matrix passed 979 assertions. The source-pinned combined candidate build succeeded with 48 stock patches and PS3 listed in its build manifest.

PS3 remains deterministic salience. No architectural blocker turned up. The adjustments below are interface corrections, not a different ranker.

## What stays authoritative

- One decision per observation revision, with separate `context`, `memory`, and `response`.
- At most four controlled reason codes.
- Gates, in order: evidence and lifetime, safety, involvement and relationship, current activity, novelty and repetition, then explicit trait-policy tags only.
- Lexicographic order: safety, direct involvement, explicit relationship, material novelty, capped distance, recency, trait tie-break, then `observationId`.
- Zero model calls. No turns, actions, playback interruption, memory writes, Scene Director behavior, or responder arbitration.
- `urgent` is a priority label. Native reflex and self-preservation stay authoritative.
- A replayed or older revision cannot regain a reaction or a memory entitlement. A material severity or harm-kind escalation can.
- A backend capture UUID is not a social relationship. Recognition is an explicit binding supplied beside the observation.

## Actual interfaces consumed

| Research assumption | Current code |
| --- | --- |
| `salienceEngine.mjs` reads observations | `validateObservation` in `lsa-essential-e1-candidate/src/perception/contracts.mjs`. PS2 `EpisodeCorrelator` emits those objects. `recognizedCharacterIds` is valid only when it is an empty array. |
| Character identity on the observation | Not present. Social relevance comes from a caller-supplied binding `{ captureRef, characterId, recognized: true, relationship }`. `recognized !== true` is backend-only even if a CharacterId is attached. |
| Profile / relationship revision | P2 `validateProfile` has `revision`, `relationship.state` (`associate`, `friend`, `trusted`, `strained`, `neutral`), `personality.traits`, and manual `memories`. Perception modules must not import `profileStore.mjs` or `characterService.mjs` (`perception-contract.test.mjs`). `situationFromCharacterView` accepts that plain shape. |
| Activity / driving | No salience-owned native poll. Caller passes `activity`: `unknown`, `idle`, `driving`, `passenger`, `in_vehicle`, `conversation`, `following`, or `waiting`. Shadow ingestion has no activity evidence, so it passes `unknown`. |
| Distance | Observations do not include observer-relative distance. Optional `distanceBand` 0–3 is capped in the sort key so it cannot outrank safety. |
| Repetition cache | New `SalienceCache` in the salience module. Decision RAM is capped separately from the reaction ledger. Ledger expiry is 10 minutes, longer than observation TTL, and a full ledger fails closed instead of forgetting a grant. |
| Shadow path | `ShadowRuntime` records a decision after PS2 emits an observation. Failure there cannot change ingest success, prompts, or native control. The live shadow caller currently has authenticated anchor/player/lifetime facts only, so it supplies `activity:'unknown'` and no P2 profile bindings, memories or trait policies. Relationship/memory/trait rules are implemented as pure policy but are not claimed live until a trusted captureRef→character/profile seam exists. Counts only are added to the existing companion shadow report. |

## Files

Added:

- `lsa-essential-e1-candidate/src/perception/salienceEngine.mjs`
- `lsa-essential-e1-candidate/tests/salience-engine.test.mjs`
- `docs/PS3-salience-reconciliation.md`
- `docs/PS3-deterministic-salience-status.md`

Modified:

- `lsa-essential-e1-candidate/src/perception/shadowRuntime.mjs` — shadow decisions only
- `lsa-essential-e1-candidate/src/perception/intelligenceClient.mjs` — numeric PS3 counters in the existing report
- `lsa-essential-e1-candidate/tests/perception-contract.test.mjs` — boundary scan includes the new module
- `lsa-essential-e1-candidate/tools/buildCandidate.mjs` — manifest phase label
- `native/promoted-characters/runtime-tests/RuntimeTests.csproj` — includes current-main input-interception sources referenced by `RuntimeEntry.cs`; test harness only
- `docs/ROADMAP.md` — PS3 status

Production native intelligence, P0/P1/P2 lifecycle, dialogue, action, playback, UX menus, profile schema, and provider clients were not modified. The runtime test-project change only repairs compilation of the current-main lifecycle test harness; it changes no production assembly source.

## Stale research assumptions

- `knowledgeSelector.mjs`, `experienceMemory.mjs`, and `director.mjs` are PS4–PS6. They are not part of PS3.
- PS3 does not populate `recognizedCharacterIds`. The contract still rejects a non-empty array.
- There is no companion-separation fact and no normalized trait vocabulary in P2. Trait policy is an exact allowlist (`protective`, `cautious`, `loyal`, `bold`) matched against a whole trait string. Biography and other trait text do not change decisions.
- Player speech hearing is still disabled (`unsupported_capture_receipt`). PS3 does not invent audibility or responder selection.
- Memory importance numbers and ProfileStore schema v2 belong to PS5. PS3 `memory: 'stage'` is only a label.
- UX phase 2–3 command and menu code does not need a salience view for this phase.

## Remaining unknowns

- Physical GTA timing of damage, witness receipts, and anchor retirement is still open for PS0–PS2. PS3 shadow reasons should be read from companion counters during that same pass.
- No authenticated live binding currently maps an intelligence `captureRef` to a P2 CharacterId/profile relationship. Production shadow therefore validates evidence/safety/novelty/repetition only; relationship, prior-memory and trait-policy behavior remains offline-tested until that seam exists. Do not infer the mapping from `owned`, names, models or handles.
- No source-time speech receipt exists, so speech salience cannot be accepted from post-STT text.
- Whether a live driver flag should be projected from `vehicle_state` into `activity` is later adapter work. The engine already honors an explicit `driving` activity.
