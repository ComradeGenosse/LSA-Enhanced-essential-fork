# Contextual Ballistics Perception — R0 branch and implementation sequence

Branch: `feature/contextual-ballistics-perception-r0`, based on `main@c5da20a`.
Status: **standalone tested code sketch, not wired into runtime, not deployed or GTA-accepted**.

## Architecture

**Do not call this PS5:** PS5 is already reserved for automatic experiential memory. This is an optional producer/knowledge extension to existing native source-time sensors → PS2 witnesses/episodes → PS3 salience → one frozen PS4 knowledge writer → PS6 spontaneous speech. Preserve D-004 (world fact != NPC knowledge), D-008 (single PS4 writer), D-016 (Essential original turn ownership), C-02/C-13 native anchor/lifetime, and all original Director limits, playback acknowledgements, and safety gates. No independent prompt builder, persistent event store, AI call per bullet, action proposal, or new executor.

Present code: `SensorAdapters.Shooting` captures source-keyed firing transitions, not bullet counts; `DamageSensors` can capture attacker/victim/classification but the controlled live damage-callback acceptance is still open. `WitnessPolicy` keeps visual and auditory knowledge distinct. The present PS4 claim renderer anonymizes even witnessed firing subjects; the stock Director context says only 'gunfire'. Both need future carefully verified player attribution.

## Included in R0

`src/perception/contextualBallistics.mjs` exports `projectContextualBallistics` and bounded limits. It constructs an immutable, model-safe **candidate** for future PS4, based on one exact firing event, an exact source-time witness receipt, a current locally verified player captureRef, and at most 16 independently correlated evidence rows within 1500 native game-tick milliseconds. The original firing ID, shooter source ref, original witness time, current player anchor and evidence joins must match. Internal identifiers are never projected to dialogue.

This pure code **cannot authenticate input data**. Tags like `proof: native_impact` do not themselves prove an impact. Its native ingestion caller must source-verify the original observations, actor lifetime and callbacks before constructing them. To avoid a false claim, R0 is **not imported into the production runtime** and cannot affect current NPC speech.

| Qualified evidence | Candidate output | Must not infer |
| --- | --- | --- |
| Nathan visually witnessed the source, current native source matches player anchor | `shooter: player` | player did it merely because Nathan heard the sound |
| Gunfire only heard | `witnessedAs: heard; shooter: unidentified` | bullet target, hit location, direction |
| Native callback attributed to same shot + impact and target truly visible to Nathan | `impact: person_hit` | physical hit from aim alone |
| Verified impact-associated damaged bone | `bodyRegion: head/torso/limb` | a headshot from stale or absent bone metadata |
| Actual native world impact + visible impact | `surface_hit: wall/ground/vehicle/other` | collision based only on raycast |
| Native line-of-fire geometry that Nathan saw | `trajectory: skyward/downward/toward_person/other` | a hit, miss, or shooter intention |
| No defensible outcome | `impact: unconfirmed` | 'missed', 'hit nothing', 'tried to kill' |

## Next implementation slices

### R1 — shooter attribution with existing source proofs

1. Join the original firing `sourceCaptureRef` to the current native C-02 player anchor and same host/world epoch at PS2 acquisition and frozen PS4 selection. Do **not** infer from a Ped name, identity alias or later nearby-player query.
2. Preserve PS2 `knowsSource`, visual LOS and exact observer context; current PS4 `knowledgeSelector.mjs` can project `player` for a visual source match but must preserve anonymous or unknown otherwise.
3. For PS6, update the existing *deterministic* `directorContext.mjs` renderer with the **same** original observer-qualified source proof, keeping the existing 160-unit bounded grammar, original PS3 decision identity and no new prompt writer. Existing stock special events remain unchanged.
4. Test audio-only, source unseen, different shooter, player/observer retirement and reset, stale decision, and actor replacement.

### R2 — native impact, target and body-location evidence (GTA probe required)

1. Probe GTA Enhanced/RAGE support for real weapon impact coordinates, bullet/shape test material or surface information, muzzle direction and per-shot/burst events. A raycast is a **geometric estimate, not an actual bullet impact**; upward aim does not prove a shot missed.
2. Probe `DamageTrackerService` for attacker/victim, `GET_PED_LAST_DAMAGE_BONE`, armor and source-time ordering. Verify the bone belongs to *that* damage callback and incident rather than an older hit. Until callback verification succeeds, only 'injured' remains supportable, not a precise head/leg hit.
3. Source-join current hostRunId/world epoch, lifetime captureRef, original signal/incident IDs and matching game ticks. A loose 1500ms window by itself is **not** enough to associate damage with a bullet; reject ambiguous multi-shooter, auto-fire, explosions and target swaps.
4. Sample witness visibility to shooter, target, direction and specific outcome *at event time*, with bounded native LOS/query budgets. The current witness receipt lacks `sawImpact`, `sawDirection`, and exact impact correlation, so add a versioned native/PS2 bridge only after GTA evidence. No fake JSON config activation.

### R3 — speech delivery and escalation

- Feed only the PS2-qualified, source-validated, observer-safe compact ballistics claim through the one immutable PS4 lane. Let PS3 select material incidents, not every round; if target death is later verified, allow a bounded escalation that does not rewrite earlier unverified causation.
- For spontaneous speech reuse PS6's *original* Essential special-turn ticket and safe full-playback acknowledgement. Maintain TTL, player priority, one-in-flight, scene/speaker cooldowns, global quotas and no physical DO effect.
- Examples of qualified dialogue: 'You were firing upward', 'You shot that wall', or 'You hit someone in the leg.' Weaker facts should yield 'I heard gunfire' or 'You were aiming toward that person,' never guesses about unseen impacts or deliberate intent.

## Acceptance

R0: nine isolated Node tests covering visual player attribution, auditory redaction, no fake misses, wall/ground proof, trajectory ambiguity, verified body region, source and player spoofing, timing/receipt limits and uint game-tick wrap. Syntax checked, no full suite or native build in this branch. Exact branch and test status should be revalidated after further edits.

R2/R3 must undergo controlled GTA tests: wall, ground, sky, vehicle, NPC miss, NPC injury/head/leg, automatic fire, gunfire behind Nathan, occlusion, different shooter, multiple hits, player switch, delayed callback and world reset. Confirm correct source-time proof, no hallucinated recognition, native callback availability, unchanged ordinary conversation, and rate/ownership/full-playback safety. Record exact companion/native build and deployment hashes separately. Until then, **this branch is only the initial implementation plan and testable pure projection**.
