# Radio track perception R3 — PS2 hearing

> **R4 branch note:** this file describes the standalone R3 milestone. On `feature/radio-track-perception-r4-ps3-salience`, R3 observations now feed deterministic PS3 radio salience; see `radio-track-perception-r4-status.md`.

Status: **implemented on `feature/radio-track-perception-r3-ps2-hearing`; build/test/GTA acceptance pending**.  
Base: `feature/radio-track-perception-r0-r2@6262c6257cc26bdc5ee14377829ed64120cfbfba`.

R3 turns the existing raw radio edge into observer-specific PS2 knowledge. It does not add PS3 salience, Luna context, memory, or autonomous dialogue.

## Implemented behavior

- Native radio edges use the existing PS2 witness-receipt path.
- A current observer ped gets a supported radio witness only when its live `CurrentVehicle` matches the exact retained source-vehicle lifetime.
- Same-vehicle evidence is `channel: "auditory"`, `basis: "audibility_model"`, reason `same_vehicle_radio`.
- Exterior/on-foot/different-vehicle listeners are not granted radio knowledge. R3 deliberately does not infer exterior audibility.
- Companion normalization resolves the station/hash through the bounded radio catalog.
- PS2 creates a routine `radio_heard` observation with a `sound` claim.
- Known catalog rows may add bounded station name / artist / title. Unknown tracks remain unknown; no metadata is guessed.
- A track/station change replaces the current radio claim for qualified listeners instead of accumulating stale song claims.
- Listeners that no longer have same-vehicle evidence are pruned on the next radio change.
- `radio_stopped` removes the current source-vehicle radio episode and its observations.
- Radio knowledge is bounded to at most two minutes if no later edge arrives.
- On the standalone R3 branch, radio returns before PS3 salience. The stacked R4 branch adds that separate layer.

The production catalog is still intentionally empty, so real GTA observations will normally know the validated station/hash but report `trackKnown: false` until the catalog is populated from trusted game metadata.

## Tests added/updated

Coverage was added for:

- same-vehicle positive witness vs exterior unknown;
- radio edges carrying source-time auditory witness receipts;
- native serialized frames including only the qualified passenger receipt;
- `radio_heard` observation schema and catalog metadata;
- no-observer/no-omniscience behavior;
- current-track revision replacing the previous claim;
- radio stop clearing current knowledge;
- Standalone R3 not incrementing PS3 decision counters; the stacked R4 branch intentionally replaces this expectation.

These tests have **not been executed in this GitHub-only implementation pass**. No GitHub Actions run is attached to this branch. The normal Node/.NET regression/build run is still required.

## GTA acceptance still required

1. Player + promoted passenger in the same vehicle: a real track change produces one supported `radio_heard`.
2. Promoted NPC outside or in another vehicle receives no supported radio observation.
3. Track/station change replaces the old current radio fact.
4. Radio off / vehicle exit clears the current fact.
5. Vehicle replacement / stale captureRefs cannot transfer hearing to a new vehicle lifetime.
6. Unknown production catalog entries remain unidentified rather than guessed.

R3 should remain shadow-only until those checks pass.
