# Radio track perception v2 — text-ID reconciliation

Status: **implemented in code on `feature/radio-track-perception-v2-text-id`; offline build/test and GTA Enhanced acceptance pending.**

Base: `feature/radio-track-perception-r5-context-projection@7be34cc98b856f86a920cea6d51faf490205eccf`.

Research authority for this migration:

- `research/radio-public-catalog-v2-20261004`
- `docs/research/radio-public-data-source-analysis.md`
- `docs/research/radio-track-perception-v2-implementation-plan.md`
- `docs/research/radio-track-perception-v2-validation.md`

## What changed

The original R0–R5 stack treated `GET_CURRENT_TRACK_SOUND_NAME()` as prospective song identity. The v2 research proved that is not sufficient: one sound/container can contain multiple independently tagged songs.

The active code now uses:

```text
GET_PLAYER_RADIO_STATION_NAME()
        -> station

GET_CURRENT_TRACK_SOUND_NAME(station)
        -> soundHash (secondary container evidence)

GET_AUDIBLE_MUSIC_TRACK_TEXT_ID()
        -> signed trackTextId (primary candidate content identity)

trackTextId + station
        -> v2 companion catalog
        -> title / artist / content kind
```

The full R3–R5 path remains intact after the identity correction:

```text
live GTA tuple
 -> bounded raw v2 event
 -> same-vehicle PS2 radio_heard
 -> low-priority PS3 salience
 -> selected R5 Luna context
```

## Catalog

The research candidate `data/radioTrackTextIds.v2.json` is packaged instead of the empty v1 hash catalog.

Counts:

- 1,058 unique text IDs;
- 951 music;
- 106 commercials;
- 1 Media Player Off marker;
- 26 stations with tagged content.

The live GTA text ID is the authority. Catalog rows only resolve metadata.

Known wrong-station mappings fail closed. Unknown positive IDs stay unknown and increment a bounded counter. Nonpositive IDs retain unknown semantics until GTA testing defines them.

## Content handling

- music -> may resolve title/artist and reach the existing R3–R5 path;
- commercial -> retained as commercial content rather than mislabeled as a song;
- cataloged Off -> closes current radio knowledge rather than becoming a `radio_heard` fact;
- unknown content -> station may be known, title/artist are not guessed.

Real GTA metadata containing ordinary `/` characters is accepted; control characters/newlines remain rejected.

## Validation status

The feature branch intentionally goes beyond the research plan's probe-only staging so the complete R0–R5 stack can be reviewed together, but **research Gate B has not been satisfied in GTA V Enhanced yet**.

Required GTA proof before merge/readiness:

1. known song: runtime text ID matches candidate title/artist/station;
2. second independent station matches;
3. FlyLo/Soulwax/other multi-song container: audible song transition changes text ID, preferably while soundHash stays unchanged;
4. commercial/DJ/news/off behavior recorded;
5. same-car passenger receives correct R3 observation;
6. outsider receives none;
7. direct “what song is this?” gets one R5 fact;
8. unrelated turn omits it;
9. track change updates next turn and radio off clears stale context;
10. native failure counters remain zero under normal use.

The full Node/.NET regression suites, candidate build, RPH package build and GTA smoke test have **not been run in this GitHub-only implementation pass**. Historical pass counts are not evidence for this branch.

## Provenance / redistribution

The candidate data is research-derived from pinned public repositories whose explicit redistribution license was not established during research. Before a public production merge, either obtain permission/license clarification or regenerate equivalent metadata from the user's locally owned GTA V Enhanced files using the documented converter/extraction approach.
