# Radio track catalog provenance

Status: **source data unavailable**. The committed catalog is intentionally empty.

## What is committed

`lsa-essential-e1-candidate/data/radioTracks.v1.json` is a valid version-1 catalog with no track rows. `generatedFrom` is the token `unavailable`. That means this repository does not contain a mapping from `GET_CURRENT_TRACK_SOUND_NAME` hashes to artist and title.

The resolver treats every runtime hash as unknown until a catalog built from the source below replaces that file. It does not guess, and it does not query the network.

## Source data still required

A locally owned GTA V Enhanced radio metadata extract is required before a real catalog can be generated. Each row must already contain:

- internal station key, matching `GET_PLAYER_RADIO_STATION_NAME` and `^[A-Z0-9_]{1,64}$`
- display station name
- track sound hash, the unsigned 32-bit value returned by `GET_CURRENT_TRACK_SOUND_NAME`
- artist
- title

The expected origin is Rockstar audio/radio metadata shipped with the game the operator owns. Community track lists, websites, and runtime lookups are not inputs.

This workspace does not include those game files. Do not invent rows to fill the gap.

## Generator input

`tools/buildRadioTrackCatalog.mjs` accepts only a local JSON document:

```json
{
  "version": 1,
  "game": "gta-v-enhanced",
  "generatedFrom": "local-rockstar-radio-metadata",
  "tracks": [
    {
      "station": "RADIO_01_CLASS_ROCK",
      "stationName": "Los Santos Rock Radio",
      "trackHash": "93E4A82B",
      "artist": "Example Artist",
      "title": "Example Track"
    }
  ]
}
```

`generatedFrom` is a short provenance token, not a filesystem path. The same hash cannot map to two rows. Hash `00000000` is not a track. The generator sorts keys and is byte-stable for the same input. `unknown` in its report stays zero until a complete Rockstar master list exists to compare against; it does not mean missing songs were identified.

`tools/verifyRadioTrackCatalog.mjs` checks the closed schema, canonical ordering, and size ceiling.

Tests use `lsa-essential-e1-candidate/tests/fixtures/radio-tracks.v1.json` only. They do not depend on real song names in the production catalog.
