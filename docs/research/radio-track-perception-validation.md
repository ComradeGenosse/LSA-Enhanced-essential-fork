# Radio Track Perception — Validation and Rollout Plan

Status: **research / acceptance specification**  
Companion to:

- [radio-track-perception-implementation-plan.md](radio-track-perception-implementation-plan.md)
- [radio-track-perception-contracts.md](radio-track-perception-contracts.md)

## 1. Validation philosophy

This feature crosses four boundaries that must be tested independently:

```text
Rockstar native truth
  -> native edge producer
  -> companion normalization/catalog
  -> NPC-specific hearing + salience
```

A green unit test cannot prove the Rockstar native behaves as expected in GTA V Enhanced. A correct native value cannot prove the right NPC receives it. An NPC observation cannot prove it should be model-visible on every turn.

Each boundary therefore has its own exit gate.

## 2. Gate A — GTA V Enhanced native probe

### Goal

Prove the actual runtime behavior of:

- `GET_PLAYER_RADIO_STATION_NAME`
- `GET_CURRENT_TRACK_SOUND_NAME`
- optionally `GET_CURRENT_TRACK_PLAY_TIME`

### Temporary probe output

At no faster than 250 ms sampling, print only on change:

```text
[RADIO_PROBE] vehicle=1 station=RADIO_01_CLASS_ROCK track=93E4A82B play_ms=42113
```

Use `vehicle=1/0`, not raw handle/address.

### Manual sequence

Perform in a non-mission free-roam session.

1. Stand outside any vehicle with radio inactive.
2. Enter a normal vehicle.
3. Turn radio on.
4. Remain on one station for at least one full song transition.
5. Manually retune to another station.
6. Retune back.
7. Toggle radio off.
8. Toggle radio on.
9. Exit vehicle while radio is active.
10. Re-enter same vehicle.
11. Enter a different vehicle.
12. Test one talk-heavy/news station if available.
13. Test a station during an advertisement/DJ segment if applicable.
14. Pause/unpause.
15. Reload/restart the addon/runtime.
16. Restart GTA.

### Record

For every transition record:

| Observed audio | station native | track hash | play time | expected edge? |
| --- | --- | --- | --- | --- |
| radio off | | | | no/stop |
| first song | | | | baseline/change |
| song transition | | | | change |
| station change | | | | change |
| DJ/ad segment | | | | document |
| vehicle exit | | | | stop |
| same vehicle re-entry | | | | change/baseline |
| different vehicle | | | | change |

### Exit criteria

- No crash/invalid native call.
- Station string follows the audible station.
- Track identifier is stable during a song and changes at a real material audio-track transition.
- Behavior during ads/DJ/news is explicitly documented.
- Radio-off behavior is deterministic enough to normalize.
- Vehicle-exit behavior is understood.
- Restart establishes a clean baseline.
- No assumption is made about track identity until catalog mapping is independently confirmed.

If any of these fail, stop before PS2 integration and document the actual seam.

## 3. Gate B — Native unit tests

Target: `native/intelligence/tests/Program.cs`

Use production `SensorAdapters.cs`.

### Required cases

#### Baseline

```text
sample A/X first time -> 0 signals
sample A/X again      -> 0 signals
```

#### Track change

```text
A/X -> A/Y -> exactly one radio_changed
```

#### Station change

```text
A/X -> B/Z -> exactly one radio_changed
```

#### Radio off

```text
A/X -> off -> exactly one radio_stopped
off -> off -> no repeat
```

#### Start after off

```text
off -> A/X -> exactly one radio_changed
```

#### Vehicle change

```text
V1 A/X -> V2 A/X -> exactly one radio_changed
```

#### Reset

```text
A/X
Reset()
A/X -> establishes baseline, no fake historical edge
```

#### Storm/bounds

Feed hundreds of alternating routine radio changes while critical signals are present.

Assert:

- queue never exceeds existing bound;
- critical reserve remains available;
- routine drops increment existing drop accounting;
- no unbounded dictionary/list growth.

#### Producer sequence

Assert radio producer sequence:

```text
1, 2, 3...
```

and resets only when the existing sensor reset policy resets producer sequences.

## 4. Gate C — Native integration tests

Target: `native/intelligence/integration-tests/Program.cs`

Add a controllable fake native radio seam to `GameStub.cs` only if the current harness architecture requires it.

Test production `IntelligenceIntegration` behavior:

- sampler runs no faster than intended fake-clock cadence;
- sampler is independent of observer count;
- no radio call when feature unavailable/disabled;
- radio exception/failure does not tear down ordinary intelligence;
- current vehicle source is retained/resolved without retargeting;
- raw signal serializes through real `IntelligenceChannel`;
- reset/clock regression clears baseline;
- diagnostics counters remain bounded;
- no model/storage/dialogue calls occur.

The test should inspect actual serialized frame shape, not a duplicate hand-built object.

## 5. Gate D — Companion contract tests

Target: `lsa-essential-e1-candidate/tests/perception-contract.test.mjs`

### Accept

- valid `radio_changed`;
- valid `radio_stopped`;
- max UInt32 track hash;
- valid vehicle captureRef;
- null target when allowed by chosen final contract.

### Reject

- unknown radio kind;
- non-radio producer with radio kind;
- lowercase/arbitrary station if grammar requires uppercase;
- station > 64 chars;
- negative hash;
- hash > UInt32;
- blank station on changed;
- nonzero hash on stopped;
- extra fact keys;
- non-null source;
- malformed UUID;
- age > TTL;
- oversized frame.

If the final design decides a source vehicle is mandatory, remove the null-target acceptance case and fail closed instead.

## 6. Gate E — Catalog tests

Target: `tests/radio-track-catalog.test.mjs`

### Resolver

- known hash + correct station -> known metadata;
- unknown hash -> `trackKnown:false`;
- known hash + wrong station -> mismatch + unknown;
- zero hash -> unknown unless explicitly treated as non-track;
- hexadecimal key normalization deterministic;
- input object not mutated;
- returned objects immutable where practical.

### Catalog validation

- duplicate keys rejected;
- malformed hex rejected;
- blank title rejected;
- blank artist rejected;
- malformed station rejected;
- invalid version rejected;
- unexpected top-level keys rejected if using closed schema;
- output deterministic across two generation runs.

### Golden fixture

Keep a tiny committed fixture independent of the full catalog:

```json
{
  "version": 1,
  "game": "gta-v-enhanced",
  "tracks": {
    "00000001": {
      "station": "RADIO_TEST_A",
      "stationName": "Test Radio",
      "artist": "Artist A",
      "title": "Track A"
    },
    "00000002": {
      "station": "RADIO_TEST_B",
      "stationName": "Test Radio B",
      "artist": "Artist B",
      "title": "Track B"
    }
  }
}
```

Do not make tests depend on one copyrighted/real track name staying in the production catalog.

## 7. Gate F — PS2 witness tests

Only after PS2 has been reconciled onto the implementation baseline.

Target: existing witness/correlation suites plus a radio-specific fixture.

### Same vehicle

```text
source vehicle V
observer A vehicle V
observer B vehicle null
observer C vehicle Q

radio changes in V

A -> witnessed
B -> unknown in conservative v1
C -> unknown/did_not_witness according to final evidence policy
```

### No omniscience

Assert B/C do not receive `radio_heard` merely because they are registered observers.

### Missing source vehicle

Raw radio event has no valid source vehicle:

```text
all observers -> unknown/no observation
```

Do not attach the event to "nearest" vehicle.

### Lifetime replacement

1. V1 has captureRef R1.
2. R1 retires.
3. game creates a new vehicle that reuses an engine handle.
4. radio event referencing R1 arrives late.

Assert the event cannot be attributed to the replacement.

### Track revision

A hears:

```text
A/X -> A/Y
```

Assert:

- one radio episode family for the source vehicle;
- material revision changes;
- no duplicate observations for stable A/Y samples.

### Stop

When radio stops:

- current episode closes/expires according to policy;
- no continuing "currently audible" projection remains indefinitely.

## 8. Gate G — PS3 salience tests

Only after PS3 has been reconciled onto the implementation baseline.

### Default

A routine `radio_heard` observation:

```text
response = none
memory = none
context = low/omitted according to final category vocabulary
```

### Safety competition

Given simultaneously:

- radio track change;
- nearby injury/threat.

Assert injury/threat outranks radio.

### Repetition

Repeated equivalent radio observation does not increase response category or defeat repetition suppression.

### Conversation relevance

If the final salience API has an explicit environment-query/input flag, test that an active music/radio question may make radio context eligible **without** changing response to urgent/autonomous.

If PS3 does not yet own semantic turn relevance, keep this test for the later knowledge selector instead of adding heuristic keyword logic to PS3.

## 9. Gate H — Knowledge/context tests

When immutable knowledge projection is implemented.

### Relevant question

Observer is in source vehicle and has supported `radio_heard`.

Player asks a direct question about the current song.

Assert the frozen model input contains exactly one compact radio fact.

### Unrelated question

Same scene, player asks about an unrelated topic.

Assert radio can be omitted under normal context budget.

### Non-hearing NPC

NPC has no supported radio observation.

Player asks "what song is this?"

Assert no title/artist is supplied as factual context. Luna should be allowed to say it does not know/hear it rather than receiving global metadata.

### Unknown catalog entry

NPC validly hears station/hash, but catalog lookup fails.

Assert model input says track is unidentified, not guessed.

### In-flight immutability

1. begin turn while track X is playing;
2. freeze turn context;
3. song changes to Y during provider await.

Assert current turn still sees X; next turn may see Y.

This mirrors the existing P0 immutable-turn principle.

## 10. Diagnostics tests

Recommended counters:

```text
radioSamples
radioEdges
radioNativeFailures
radioUnknownTracks
radioCatalogMismatches
radioWitnessed
radioWitnessUnknown
```

Requirements:

- saturate at existing diagnostics integer ceiling;
- zero/reset according to existing runtime policy;
- no artist/title in periodic production diagnostics;
- no raw audio;
- no prompt/transcript;
- no filesystem provenance path;
- no entity address/handle.

## 11. Performance targets

These are acceptance targets, not claims.

### Native

- sampling cadence: 250 ms;
- O(1) work per sample;
- no actor × observer loop;
- no allocation proportional to nearby entity count;
- no disk read during `Update`;
- no catalog parsing in native code;
- no measurable regression that causes total intelligence Update p95 to violate the existing perception budget target.

### Companion

- hash lookup O(1);
- catalog loaded once;
- no per-event disk read;
- radio observations count against existing bounded observation/episode stores;
- no model call created solely by a track change.

## 12. Full regression

Before implementation branch is considered mergeable, rerun all suites required by the current baseline, including the latest:

- E1-E6/P0/P1/P2 companion suites present on the implementation baseline;
- PS0/PS1 perception suites;
- PS2 witness/correlation suites if merged;
- PS3 salience suites if merged;
- native P1/P2 policy/factual/control/host suites;
- native intelligence policy/integration suites;
- real .NET-to-Node perception interop where supported;
- package builds and source-pinned verification tools.

Do not copy old pass counts into the result. Record fresh counts from the implementation branch.

## 13. GTA acceptance matrix

### Case 1 — Passenger knows current track

Setup:

- player + promoted NPC passenger in same vehicle;
- radio on known catalog track.

Expected:

- raw radio edge exists;
- PS2 marks passenger as hearing;
- observation has correct station/title/artist;
- when asked, Luna can answer from bounded context.

### Case 2 — Nearby outsider does not magically know

Setup:

- promoted NPC outside vehicle;
- conservative v1 same-vehicle hearing only.

Expected:

- no supported radio observation;
- asking outsider about song does not inject title.

### Case 3 — Song transition

Stay in same vehicle across song boundary.

Expected:

- exactly one material raw change;
- one episode revision/new current radio state;
- next eligible turn sees new track.

### Case 4 — Station retune

Retune manually.

Expected:

- station + track update once;
- no old station remains "current".

### Case 5 — Radio off

Turn radio off.

Expected:

- one stop edge;
- active audible radio state expires/clears;
- later turn does not say old song is still playing.

### Case 6 — Unknown segment

Reach ad/DJ/news/unknown hash.

Expected:

- station can remain known;
- track remains unknown if catalog has no entry;
- no fabricated song.

### Case 7 — Vehicle switch

Leave V1 and enter V2.

Expected:

- source change is material;
- observers from V1 do not inherit V2's radio fact through handle reuse or stale refs.

### Case 8 — Danger competition

While radio is playing, create a controlled supported danger event.

Expected:

- radio remains routine;
- danger wins salience/context priority;
- no spontaneous music comment caused by the radio event.

### Case 9 — Restart

Restart addon/GTA.

Expected:

- no fake "song changed" history from stale baseline;
- fresh state is established;
- no old vehicle captureRef is revived.

## 14. Rollout modes

### Mode 0 — disabled

No radio calls, no signals.

### Mode 1 — shadow raw

Collect edge/counter evidence only.

No observations, no context.

### Mode 2 — shadow knowledge

PS2 produces radio observations and PS3 ranks them.

No Luna projection.

### Mode 3 — context

Selected radio observation may enter player-requested dialogue context.

Still no autonomous speech/memory.

### Future mode — initiative

Not part of this implementation. A later Scene Director may decide a character comments on music, but only under separate initiative policy/call budgets.

## 15. Rollback

Radio integration must be independently disableable without disabling ordinary dialogue/perception.

Rollback should require one of:

- configuration disables radio producer; or
- revert/remove radio producer registration.

It must not require reverting PS0/PS1/PS2 as a whole.

No persistent migration should be necessary for v1 because routine radio observations are not durable memories.

## 16. Evidence package for final review

Attach or commit:

- implementation commit SHA;
- baseline SHA;
- GTA/RPH/Essential/package versions;
- sanitized radio probe log excerpt;
- catalog generator input provenance without private filesystem paths;
- catalog counts by station;
- unknown/duplicate report;
- fresh unit/integration regression counts;
- GTA acceptance checklist results;
- measured intelligence Update p95 before/after if available;
- known limitations, especially ad/DJ/news and exterior-hearing behavior.

## 17. Stop conditions

Do not enable Luna-visible radio context if any of these remain unresolved:

- track hash does not reliably follow audible content;
- station/track lookup collision cannot be disambiguated;
- source vehicle lifetime can retarget;
- PS2 cannot prove same-vehicle occupancy at source time;
- unknown tracks are being guessed;
- stable tracks generate repeated observations;
- routine radio displaces danger/safety context;
- mixed package versions silently accept incompatible schemas;
- performance regression violates existing perception acceptance targets.

The feature is successful when radio becomes a **small, trustworthy environmental fact**, not merely when the system can print a song title.
