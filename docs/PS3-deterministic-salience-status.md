# PS3 deterministic salience

Status, October 4, 2026: **implemented offline in shadow; physical GTA validation pending**.

PS3 ranks PS2 observations. It does not create turns, actions, memories, playback changes, or native authority. `urgent` means the observation outranks other candidates. Reflex and self-preservation remain native.

The decision shape is `observationId`, `revision`, `context` (`omit` | `candidate` | `must_include`), `memory` (`none` | `stage`), `response` (`none` | `eligible` | `urgent`), at most four reason codes, and `expiresAtMonotonicMs`.

`memory: 'stage'` is a label for a later writer. This phase does not open the profile store. `response` does not select a speaker.

## Bounds

- 256 cached decisions, 32 per observer.
- 1,024 reaction-ledger entries, 10-minute TTL.
- A full ledger refuses new non-urgent grants. Forgetting a grant is not a way to react again.
- Same revision and non-escalating later revisions lose reaction and memory entitlement.
- A higher severity, or a new `dead` / `attack` claim, may earn entitlement again.
- Explicit bindings with `recognized: true` are the only social identities. A backend CharacterId is not a relationship.
- Trait policy accepts only a whole trait equal to `protective`, `cautious`, `loyal`, or `bold`.
- Shadow mode passes `activity: 'idle'` because the anchor roster has no driver flag. Callers can pass `driving`, `passenger`, or `in_vehicle`.

## Checks

Companion coverage is `lsa-essential-e1-candidate/tests/salience-engine.test.mjs`, included in `node tools/runTests.mjs`. The candidate build manifest phase list includes `PS3`. No native project changed.

## GTA validation still open

1. Enable intelligence shadow mode only. Confirm no new Luna turn, memory file write, action, or playback interruption during damage and gunfire.
2. Record sanitized `ps3` counters from the companion shadow report: decisions, urgent, eligible, staged, suppressed, faults.
3. Confirm a companion who is shot produces an urgent self-danger decision while native reflex still owns movement.
4. Confirm a repeated burst does not keep the urgent response after the first revision, and that a later death revision can become relevant again.
5. Confirm an unrecognized ped and a promoted friend do not receive the same relationship reason.
6. If a driver flag is supplied by a later adapter, routine nearby presence stays omitted while vehicle impact does not.
7. Player speech remains disabled until a source-time capture receipt exists. Do not treat post-STT text as hearing.
