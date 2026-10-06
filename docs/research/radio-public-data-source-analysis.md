# Public radio metadata source analysis and v2 catalog recommendation

Status: **research complete; candidate catalog generated; GTA text-ID probe still required**

Implementation handoff:

- [Radio Track Perception v2 — Full Implementation Plan](radio-track-perception-v2-implementation-plan.md)
- [Radio Track Perception v2 — Validation and Migration Matrix](radio-track-perception-v2-validation.md)  
Date: 2026-10-04  
Baseline: `feature/radio-track-perception-r0-r2@41604c715ec16cdcaccf0096274ae3dc7da47481`

## Executive conclusion

Use **HintSystem/GTA-V-Radio-Dumps** as the primary public research source for per-track metadata and **DurtyFree/gta-v-data-dumps** only for station display labels/current station inventory.

Do not use Mango Radio as the source because its 1,056-track table is not publicly available. Mango is useful as independent corroboration: its author reports that GTA exposes the current item as an internal text ID and that the table was generated from the same `dat54/dat151` metadata family.

The current R0-R2 implementation should **not** promote `GET_CURRENT_TRACK_SOUND_NAME()` to the canonical song key. The public game-derived dump proves that one audio/sound container can contain multiple independently tagged songs. A second GTA native, `GET_AUDIBLE_MUSIC_TRACK_TEXT_ID()`, is therefore the strongest candidate for the actual per-song key.

The candidate converted catalog is:

`lsa-essential-e1-candidate/data/radioTrackTextIds.v2.json`

It is keyed by decimal `trackTextId`, not sound hash.

## Sources

### Primary: HintSystem/GTA-V-Radio-Dumps

Pinned commit:

`d85fa6d9a63a2bc0d75109a6a8a3f9f26228e0cc`

Repository:

https://github.com/HintSystem/GTA-V-Radio-Dumps

Why it is the best fit:

- derived from GTA `dat151.rel`, `dat54.rel`, `dat4.rel`, AWC marker data, nametables and `trackid.gxt2`;
- processed JSON preserves radio stations, track lists, audio containers and per-track markers;
- each Track marker provides an integer `Id`, `Title`, `Artist`, and offset;
- its parser shows the integer ID is the base text ID used to retrieve title/artist from `trackid.gxt2`;
- it preserves mixed/continuous radio containers where multiple song markers occur inside one sound container.

The parser's `resolve_marker_trackid` logic takes the numeric text ID and looks up:

- `<id>S` -> title
- `<id>A` -> artist

through the game's extracted track text table.

### Secondary: DurtyFree/gta-v-data-dumps

Pinned commit used by this conversion:

`b65684e00f689fdec405c5f1055322c802d3c895`

Repository:

https://github.com/DurtyFree/gta-v-data-dumps

Use only for:

- canonical station inventory;
- English station display names;
- cross-checking internal station keys.

Its `radioStations.json` is substantially better for current station metadata than for song identification. It does not contain the per-song text-ID/title/artist mapping needed by LSA.

### Corroboration only: Mango Radio

Public release discussion:

https://forum.cfx.re/t/mango-radio-the-vehicle-radio-rebuilt/5425526

The author reports:

- GTA exposes currently playing content as an internal text ID;
- their generated table contains 1,056 GTA radio tracks;
- the table was generated from GTA `dat54/dat151` audio metadata.

That independently matches the architecture found in HintSystem's dump, but the Mango table itself is not a suitable public dependency.

## Dataset audit

Across all 13 processed HintSystem dumps inspected:

| Metric | Result |
| --- | ---: |
| Radio station definitions | 27 |
| Audio track/container records | 1,709 |
| Track marker rows | 1,226 |
| Unique track text IDs | **1,058** |
| Conflicting title/artist mappings for one text ID | **0** |
| Containers containing multiple unique track IDs | **67** |
| Maximum unique songs in one container | **22** |
| Music IDs | **951** |
| Commercial IDs | **106** |
| Media Player `Off` marker | **1** |
| Minimum text ID | 1 |
| Maximum text ID | 4187 |
| Maximum title length | 69 |
| Maximum artist length | 75 |

The generated catalog has 26 stations with tagged content. The 27th Hint station definition without tagged catalog content is not forced into the track table.

## Why the current sound-hash catalog is insufficient

The existing R0-R2 branch samples:

`GET_CURRENT_TRACK_SOUND_NAME(station)`

and treats its hash as the prospective catalog key.

That is useful as a **sound/container identifier**, but it cannot identify every audible song.

Examples from the public game-derived metadata:

- `radio_14_dance_02_flylo_part1` contains **22** unique song markers.
- `radio_07_dance_01_soulwax_fm_final_mix_32k` contains **18**.
- `radio_08_mexican_mex_final_mix_32` contains **15**.
- multiple DLC and Media Player mix containers contain 10+ tagged songs.

Therefore:

```text
sound container hash != universally unique song identity
```

A hash-only lookup can work on ordinary one-file-per-song stations but necessarily collapses multiple tracks on mix stations.

## Better runtime key

GTA exposes:

`GET_AUDIBLE_MUSIC_TRACK_TEXT_ID() -> int`

Hash:

`0x50B196FC9ED6545B`

The public native databases do not document its semantics beyond the name/type, so the exact relationship remains a GTA acceptance gate.

However, three independent facts line up:

1. Rockstar radio metadata contains numeric per-song **track text IDs**.
2. HintSystem's parser resolves those IDs directly to the game's artist/title strings.
3. Mango Radio independently says GTA exposes the current track as an internal text ID.

The recommended next GTA probe therefore logs all four values:

```text
station
soundHash
trackTextId
playMs
```

Do **not** remove `soundHash`; retain it as secondary evidence/diagnostics.

## Candidate v2 catalog

Generated file:

`lsa-essential-e1-candidate/data/radioTrackTextIds.v2.json`

Shape:

```json
{
  "version": 2,
  "game": "gta-v-enhanced",
  "key": "trackTextId",
  "generatedFrom": {
    "trackMetadata": {
      "repository": "HintSystem/GTA-V-Radio-Dumps",
      "commit": "d85fa6d9a63a2bc0d75109a6a8a3f9f26228e0cc"
    },
    "stationLabels": {
      "repository": "DurtyFree/gta-v-data-dumps",
      "commit": "b65684e00f689fdec405c5f1055322c802d3c895"
    }
  },
  "tracks": {
    "1004": {
      "title": "Hollywood Nights",
      "artist": "BOB SEGER",
      "kind": "music",
      "stations": ["RADIO_01_CLASS_ROCK"]
    }
  }
}
```

The catalog intentionally includes `kind`:

- `music`
- `commercial`
- `off`

This lets future perception distinguish a song from an advert without guessing from strings.

## Reproducible converter

Added:

`lsa-essential-e1-candidate/tools/buildRadioTrackTextCatalog.mjs`

Usage:

```text
node tools/buildRadioTrackTextCatalog.mjs \
  <HintSystem-info_merged.json> \
  <DurtyFree-radioStations.json> \
  <output.json> \
  [hintCommit] [durtyCommit]
```

The converter:

- builds TrackList -> station ownership;
- deduplicates by integer text ID;
- fails if one ID maps to conflicting title/artist;
- preserves multi-station songs/commercials;
- assigns a controlled content kind;
- uses case-insensitive station-label lookup while preserving Hint's runtime-facing station key;
- emits deterministic numeric-ID order;
- permits legitimate slash characters in song/artist metadata.

## Current R2 validator incompatibility

The existing v1 catalog validator rejects `/` in display text.

That is incompatible with real GTA metadata.

Examples present in the source:

- `MONO/POLY AND THUNDERCAT`
- `JESSE JOHNSON / MOODYMANN`
- `SAMA' ABDULHADI / JAMIE JONES`
- `Abolish Government/Silent Majority`
- `One Girl/One Boy`

The future validator must continue rejecting control characters/newlines and dangerous arbitrary structures, but ordinary slash characters cannot be classified as unsafe metadata.

## GTA proof required

Before changing the production raw contract, add `GET_AUDIBLE_MUSIC_TRACK_TEXT_ID()` to the existing shadow probe only.

Minimum acceptance:

### Single-file station

On Los Santos Rock Radio, wait for a known tagged song.

If `Hollywood Nights` is audible, the candidate database predicts:

```text
trackTextId = 1004
title = Hollywood Nights
artist = BOB SEGER
station = RADIO_01_CLASS_ROCK
```

The exact song used does not matter; compare the emitted ID to the candidate catalog.

### Mix station

Test a station/container known to contain several marker IDs, such as FlyLo FM or Soulwax FM.

Required observation:

- `trackTextId` changes when the human-readable song changes;
- it can change while `soundHash` remains unchanged.

If this happens, it directly proves why text ID must be the song key and sound hash is only the enclosing audio object.

### Non-song content

Capture:

- commercial;
- DJ chatter;
- news/talk;
- Media Player off if practical.

Record whether `GET_AUDIBLE_MUSIC_TRACK_TEXT_ID` returns a cataloged commercial ID, zero/negative, a previous ID, or another value. Do not infer semantics for unsupported values.

## Proposed production event after GTA validation

Preferred raw facts:

```json
{
  "station": "RADIO_01_CLASS_ROCK",
  "soundHash": 2481236011,
  "trackTextId": 1004
}
```

Rules:

- station remains validated raw GTA state;
- `trackTextId` is the primary title/artist lookup key when it has been GTA-validated;
- `soundHash` is retained for source/container diagnostics;
- a track-change edge should be driven by material station/text-ID/source-vehicle changes;
- do not use soundHash alone to decide song identity on mix stations;
- title/artist remain companion-side only.


## Freshness caveat for October 2026 Enhanced

The HintSystem source commit predates the current October 2026 GTA V Enhanced build. That makes it an excellent structural/text-ID baseline, but not a claim that every row is still in the live PC Enhanced rotation.

A concrete example is text ID **1243**, `MOLOKO — The Time Is Now`. Public GTA metadata identifies 1243 as that song, while September 2026 reporting says Rockstar removed the track from PC Enhanced. Keeping a stale extra row in the resolver is harmless because it will never resolve unless GTA emits that ID; missing newly-added IDs remain explicit unknowns.

Therefore runtime semantics are:

```text
live GTA trackTextId = authority that something is audible
catalog row = metadata resolver only
```

Do not use catalog membership as proof that a song is currently available in the user's build. Record unknown IDs during GTA acceptance so newer content can be identified separately.

## Licensing / redistribution note

Both source repositories are public, but neither repository currently exposes an explicit GitHub license file/license declaration.

That does **not** make the technical data unusable for research, but public availability should not be treated as an explicit redistribution license.

For a public production merge, the conservative options are:

1. obtain permission/clarification from the source maintainers; or
2. regenerate the same catalog from the user's locally owned GTA V Enhanced metadata using the documented extraction/marker algorithm and retain this public dataset only as a research cross-check.

The generated candidate is therefore intentionally kept on a research branch until the runtime mapping and redistribution approach are settled.

## Recommendation

Do **not** merge the v1 hash-only catalog as the final song database.

Next implementation step:

1. add `GET_AUDIBLE_MUSIC_TRACK_TEXT_ID()` to the R0 probe;
2. GTA-test a normal song plus at least one multi-song mix;
3. if IDs match this catalog, update R1 to carry `trackTextId` alongside `soundHash`;
4. replace/upgrade the companion resolver to v2 text-ID lookup;
5. keep `GET_CURRENT_TRACK_SOUND_NAME` as secondary source/container evidence;
6. only then proceed to PS2 `radio_heard`.

This requires a **small R0/R1 refinement**, not a redesign of the radio-perception architecture.
