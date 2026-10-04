# PS3 reconciliation

Date: October 4, 2026. Branch: `feature/ps3-deterministic-salience`.

Base: latest `origin/main` at `6ae6bc99c82a2d78ec1fea1091e4f8116f0c7257`, plus the unmerged PS2 fast-forward `origin/feature/ps2-witness-rules-episode-correlation` at `5ea77f8`. Those three PS2 commits are the observation, witness, and correlation contracts PS3 consumes. The research codemap is `origin/research/perception-salience-scene-director` at `be6b562`, section 6 and PS3 in section 14.

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
| Activity / driving | No salience-owned native poll. Caller passes `activity`: `idle`, `driving`, `passenger`, `in_vehicle`, `conversation`, `following`, or `waiting`. Shadow ingestion has anchors only, so it passes `idle`. |
| Distance | Observations do not include observer-relative distance. Optional `distanceBand` 0–3 is capped in the sort key so it cannot outrank safety. |
| Repetition cache | New `SalienceCache` in the salience module. Decision RAM is capped separately from the reaction ledger. Ledger expiry is 10 minutes, longer than observation TTL, and a full ledger fails closed instead of forgetting a grant. |
| Shadow path | `ShadowRuntime` records a decision after PS2 emits an observation. Failure there cannot change ingest success, prompts, or native control. Counts only are added to the existing companion shadow report. |

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
- `docs/ROADMAP.md` — PS3 status

Not modified: native intelligence, P0/P1/P2 lifecycle, dialogue, action, playback, UX menus, profile schema, and provider clients.

## Stale research assumptions

- `knowledgeSelector.mjs`, `experienceMemory.mjs`, and `director.mjs` are PS4–PS6. They are not part of PS3.
- PS3 does not populate `recognizedCharacterIds`. The contract still rejects a non-empty array.
- There is no companion-separation fact and no normalized trait vocabulary in P2. Trait policy is an exact allowlist (`protective`, `cautious`, `loyal`, `bold`) matched against a whole trait string. Biography and other trait text do not change decisions.
- Player speech hearing is still disabled (`unsupported_capture_receipt`). PS3 does not invent audibility or responder selection.
- Memory importance numbers and ProfileStore schema v2 belong to PS5. PS3 `memory: 'stage'` is only a label.
- UX phase 2–3 command and menu code does not need a salience view for this phase.

## Remaining unknowns

- Physical GTA timing of damage, witness receipts, and anchor retirement is still open for PS0–PS2. PS3 shadow reasons should be read from companion counters during that same pass.
- No source-time speech receipt exists, so speech salience cannot be accepted from post-STT text.
- Whether a live driver flag should be projected from `vehicle_state` into `activity` is later adapter work. The engine already honors an explicit `driving` activity.
