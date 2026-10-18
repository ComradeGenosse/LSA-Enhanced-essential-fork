> **Mainline update — 2026-10-17:** This file documents the original radio-v2 branch and test design, not current merge status. Radio R0–R5/v2 is now **in main** via #32 with October 17 native revalidation/repair merged in #223. The user has reported working live radio after fixes; the full GTA negative/regression matrix on the latest exact build remains open. See [current status](IMPLEMENTATION-STATUS-20261017.md#perception-context-and-autonomous-speech), [roadmap](ROADMAP.md) and [next tasks](NEXT-PHASES-20261017.md). Original “not merged / branch only” paragraphs below are historical snapshots.

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

## Long-running song freshness (October 11 radio integration fix)

Radio is **current perception, not persistent music memory**. A witnessed song
had an initial PS2 observation TTL of 120 seconds. Native R0–R2 originally
published only tuple changes; a long unchanged song could expire even while
still playing. The radio integration branch now:

- Samples GTA's station/sound/text-ID tuple every 250 ms while radio is enabled.
- After a normal baseline or change, reconfirms the **unchanged, still-playing
  tuple at most once per 60 seconds**, using a fresh native GTA read, a new
  bounded signal ID, and freshly qualified same-vehicle PS2 witness receipts.
- Reuses the existing `radio_changed` wire contract for source-verified
  revalidation (not a new song-transition claim); **does not increment the
  native real-change `radioEdges` counter** or add PS6 speech/memory authority.
- Renews the active R3 observation/episode (120-second TTL from each accepted
  confirmation). Repeated confirmations keep the same song available beyond
  two minutes **only while source + witness remain current**.
- Does not refresh when radio is off, the player is out of a vehicle, the
  native read fails, or the source is otherwise unverified. Existing stop,
  world reset, observer-lifetime, channel freshness and expiry gates remain.

Matching native integration and companion correlation tests cover a same-song
reconfirmation without a fake change counter, a multi-minute continuous track,
and radio-off expiry. GTA Enhanced acceptance remains outstanding.

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
