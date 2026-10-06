# Radio track catalog provenance

Status: **v1 hash catalog superseded; v2 research candidate present; GTA Enhanced runtime validation and redistribution decision still required.**

## Active catalog

The active v2 branch uses:

`lsa-essential-e1-candidate/data/radioTrackTextIds.v2.json`

It is keyed by GTA radio **track text ID**, not by `GET_CURRENT_TRACK_SOUND_NAME()`.

Audited candidate counts:

- 1,058 unique track text IDs;
- 951 music entries;
- 106 commercial entries;
- 1 Media Player `Off` entry;
- 26 stations with tagged content.

Live GTA runtime state remains authoritative. A catalog row does not prove that a song still exists in the current GTA V Enhanced rotation.

## Research provenance

The candidate was generated from the research recorded on `research/radio-public-catalog-v2-20261004`.

Track metadata:

- repository: `HintSystem/GTA-V-Radio-Dumps`
- pinned commit: `d85fa6d9a63a2bc0d75109a6a8a3f9f26228e0cc`
- useful inputs: GTA `dat151.rel`, `dat54.rel`, `dat4.rel`, AWC markers, nametables and `trackid.gxt2`

Station labels:

- repository: `DurtyFree/gta-v-data-dumps`
- pinned commit: `b65684e00f689fdec405c5f1055322c802d3c895`
- used only for station inventory/display labels, not song identity.

The deterministic converter is:

`tools/buildRadioTrackTextCatalog.mjs`

The runtime verifier is:

`tools/verifyRadioTrackTextCatalog.mjs`

## Runtime authority

The intended v2 runtime tuple is:

```text
station
soundHash       # secondary sound/container evidence
trackTextId     # primary candidate song/content identity
```

`GET_AUDIBLE_MUSIC_TRACK_TEXT_ID()` supplies the signed `trackTextId`.

`GET_CURRENT_TRACK_SOUND_NAME(station)` remains useful for diagnostics/container identity but must not resolve artist/title. Research found 67 sound containers containing multiple unique tagged songs, with as many as 22 songs in one container.

Resolver rules:

- known positive text ID + compatible station -> bounded metadata;
- unknown positive ID -> `trackKnown=false`;
- known ID on the wrong station -> `trackKnown=false`, catalog mismatch;
- zero/negative values retain unknown semantics until GTA acceptance establishes what they mean;
- catalog membership never creates runtime state by itself.

## GTA validation gate

The code migration does **not** establish that the native behaves as expected in GTA V Enhanced. Before merge/deployment acceptance, validate at minimum:

1. a known ordinary song maps to its candidate text ID;
2. a second independent station agrees;
3. a multi-song mix such as FlyLo FM or Soulwax FM changes `trackTextId` when the audible song changes, ideally while `soundHash` remains stable;
4. commercial, DJ/transition, news/talk and radio-off behavior is recorded;
5. the text-ID native does not crash or flap under stable audible content.

Example candidate row for a spot check:

`1004 -> Hollywood Nights / BOB SEGER / RADIO_01_CLASS_ROCK`.

## Redistribution boundary

The public research repositories did not expose an explicit license declaration when researched. Public availability is not itself redistribution permission.

Before treating this derived catalog as a public production asset, choose one:

1. obtain permission/license clarification from the source maintainers; or
2. regenerate the same metadata from the user's locally owned GTA V Enhanced files using the documented extraction/marker algorithm, retaining the public catalog only as a research cross-check.

Runtime behavior must never depend on downloading either public repository.

## Removed v1 assumption

The old empty `radioTracks.v1.json` / hash-keyed generator path is historical and is not an active runtime source on the v2 branch. Keeping two competing song-identity catalogs would be unsafe.
