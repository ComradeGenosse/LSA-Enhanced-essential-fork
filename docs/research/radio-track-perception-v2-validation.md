# Radio Track Perception v2 — Validation and Migration Matrix

Status: **implementation acceptance specification**  
Date: **2026-10-04**  
Companion: [radio-track-perception-v2-implementation-plan.md](radio-track-perception-v2-implementation-plan.md)

## 1. Purpose

This document defines the exact evidence required to move the radio feature from:

```text
hash-based research implementation
        ↓
text-ID-validated raw perception feature
        ↓
mergeable R0-R2
```

It intentionally separates:

- offline correctness;
- GTA native semantics;
- catalog correctness;
- packaging/build correctness;
- later NPC hearing behavior.

No PS2 hearing, PS3 salience, memory, or Luna context is accepted as part of this gate.

## 2. Stage A — Probe-only implementation

Add:

```text
GET_AUDIBLE_MUSIC_TRACK_TEXT_ID()
```

to the existing radio shadow probe.

Do not change the raw signal schema yet.

Required probe fields:

```text
vehicle
station
sound
text_id
play_ms
```

Example:

```text
[RADIO_PROBE] vehicle=1 station=RADIO_01_CLASS_ROCK sound=93E4A82B text_id=1004 play_ms=42113
```

### Offline Stage A tests

- fake native returns positive text ID;
- fake native returns 0;
- fake native returns negative value;
- text-ID native throws managed exception;
- text-ID-only change creates a new probe line;
- stable text ID does not repeat probe;
- play-time changes alone do not repeat probe;
- config off causes zero radio native reads.

## 3. Stage B — GTA text-ID proof

### Case B1: normal song

Choose one audible song present in the v2 candidate catalog.

Record:

```text
station:
soundHash:
trackTextId:
audible title:
candidate title:
candidate artist:
```

Pass:

- audible title matches candidate title;
- runtime text ID equals candidate key;
- station is compatible with candidate station membership.

### Case B2: second independent station

Repeat on a different normal music station.

Purpose:

- avoid proving the mapping from one coincidental example only.

### Case B3: multi-song container

Use one known mixed station.

Record at least two song transitions without retuning.

Pass if:

```text
audible song changes
trackTextId changes correspondingly
```

Strong confirmation if:

```text
soundHash remains constant across one or more of those transitions
```

This proves soundHash is container-level evidence rather than universal song identity.

### Case B4: commercial

Record:

```text
station
text ID
sound hash
candidate kind/title/artist if any
```

Determine whether the audible commercial maps to one of the 106 cataloged commercial IDs.

### Case B5: DJ / transition

Record exact behavior.

No pass/fail expectation except:

- no crash;
- behavior is stable enough to document.

### Case B6: news/talk

Same as DJ.

### Case B7: radio off

Expected normalized probe state should be documented.

The production stopped event will still normalize to:

```text
station=""
soundHash=0
trackTextId=0
```

regardless of the raw native's prior value.

## 4. Stage B stop conditions

Stop before raw schema migration if any of these occur:

- known song text ID does not match candidate metadata;
- ID appears unrelated to audible song;
- mixed song transition does not change text ID;
- native call crashes/tears down RPH;
- values flap rapidly while audible content is stable;
- station relationship is irreconcilable with the catalog model.

## 5. Stage C — Raw contract migration

After Stage B passes:

Replace:

```json
{
  "station": "...",
  "trackHash": 123
}
```

with:

```json
{
  "station": "...",
  "soundHash": 123,
  "trackTextId": 1004
}
```

### Contract acceptance

`radio_changed`:

- station matches grammar;
- soundHash uint32;
- trackTextId signed int32;
- source null;
- target null or valid vehicle captureRef per final contract.

`radio_stopped`:

- station empty;
- soundHash zero;
- trackTextId zero.

### Contract rejection

Reject:

- artist;
- title;
- lyrics;
- URLs;
- arbitrary metadata;
- invalid station;
- non-integer text ID;
- text ID beyond int32;
- sound hash beyond uint32;
- non-null source;
- malformed captureRef;
- extra keys.

## 6. Stage D — Edge behavior

Required native tests:

| Previous | Current | Expected |
| --- | --- | --- |
| none | A/H1/T1 | baseline only |
| A/H1/T1 | A/H1/T1 | no edge |
| A/H1/T1 | A/H1/T2 | changed |
| A/H1/T1 | A/H2/T1 | changed |
| A/H1/T1 | B/H2/T2 | changed |
| V1 A/H1/T1 | V2 A/H1/T1 | changed |
| active | off | stopped |
| off | off | no edge |
| off | active | changed |
| reset | active | new baseline only |

Notation:

```text
A/B = station
H = soundHash
T = trackTextId
V = vehicle source
```

## 7. Stage E — Catalog resolver

Candidate source:

`data/radioTrackTextIds.v2.json`

### Required resolver cases

Known single-station music:

```text
1004 + RADIO_01_CLASS_ROCK
-> Hollywood Nights / BOB SEGER / music
```

Unknown ID:

```text
999999
-> trackKnown=false
```

Known ID, wrong station:

```text
-> trackKnown=false
-> catalogMismatch=true
```

Known multi-station track:

```text
-> resolves on every listed station
```

Commercial:

```text
-> kind=commercial
```

Off marker:

```text
2095
-> kind=off
```

### String acceptance

Must accept legitimate metadata containing `/`.

Must still reject:

- NUL;
- control characters;
- CR/LF;
- malformed surrogate pairs;
- oversized values.

## 8. Stage F — Source/freshness behavior

Test that catalog presence does not create runtime state.

Scenario:

```text
catalog contains ID 1243
GTA never emits 1243
```

Expected:

- no radio fact;
- no current song;
- no observation;
- no prompt effect.

Scenario:

```text
GTA emits an unknown positive ID
```

Expected:

- raw event accepted;
- resolver returns unknown;
- bounded unknown-ID counter increments;
- no guessed metadata.

## 9. Stage G — Queue and performance

Radio remains routine.

Stress:

- 64 critical damage signals;
- hundreds of alternating radio changes.

Required:

- total queue remains bounded;
- radio cannot consume critical reserve;
- routine drop counter increases;
- critical item still accepted.

Performance:

- O(1) radio work per 250 ms sample;
- one station/hash/text-ID read sequence independent of observer count;
- no catalog disk read per event;
- no model call;
- no PS2 fan-out.

## 10. Stage H — Source vehicle/lifetime

### Vehicle exit

Preferred:

```text
active V1
-> exit
-> radio_stopped target=V1 if V1 captureRef remains valid
```

If V1 is already retired:

```text
target=null
```

Never bind the stop to a replacement using a reused engine handle.

### Vehicle switch

```text
V1 active -> V2 active
```

must produce a material change even if station/hash/text ID are identical.

## 11. Stage I — Process/reset lifecycle

Test:

- game clock regression;
- addon reload;
- companion reconnect;
- GTA restart;
- channel reset.

Expected:

- radio baseline clears;
- first fresh sample does not fabricate historical change;
- producer sequencing follows existing reset policy;
- stale captureRefs not revived.

## 12. Stage J — Full build validation

Before deploy:

- companion full suite;
- native intelligence unit suite;
- native intelligence integration suite;
- .NET -> Node interop;
- PS host/lifecycle suite;
- runtime suite;
- candidate build;
- actual RPH characters-addon/package build.

Record fresh counts.

Do not quote previous branch counts as proof of the new implementation.

## 13. Stage K — GTA deployment smoke

With both radio configs in shadow:

1. launch non-mission free roam;
2. confirm `[PS] radio_shadow`;
3. confirm one baseline probe;
4. perform Stage B cases;
5. inspect 10-second numeric diagnostics;
6. confirm native failure counter stays zero;
7. confirm no PS2 `radio_heard` observation exists;
8. confirm no Luna prompt contains radio metadata.

## 14. Stage L — Merge readiness

R0-R2 v2 is merge-ready when:

- text-ID semantics proven in GTA Enhanced;
- ordinary song resolves correctly;
- mixed station behavior confirms the identifier model;
- raw schema migrated;
- catalog resolver uses text ID;
- slash-safe metadata validation fixed;
- queue/lifetime/reset behavior passes;
- RPH/package build passes;
- no PS2/Luna leakage;
- provenance/redistribution policy is explicitly decided.

## 15. Later acceptance — not part of this merge

After v2 raw R0-R2 merges:

### PS2

Test same-vehicle passenger hearing.

### PS3

Test low salience and no initiative.

### Context

Test:

```text
"What song is this?"
```

for:

- hearing NPC;
- non-hearing NPC;
- known track;
- unknown track;
- track transition during provider await.

Those are separate future gates.
