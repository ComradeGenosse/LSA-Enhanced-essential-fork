# Genesis-Inspired Enhancement Matrix

This matrix is the actionable companion to `README.md`.

Legend:

- **Offline** — can be meaningfully implemented/tested without GTA.
- **Shadow** — can run in GTA without affecting gameplay.
- **GTA gate** — requires explicit in-game acceptance before capability enablement.
- **Reuse** — expected to build on existing fork work rather than replace it.

| Track | User-visible outcome | Existing fork leverage | First deliverable | Offline? | Shadow? | GTA gate? | Priority |
|---|---|---|---|---:|---:|---:|---|
| W0 World Event Ledger | Shared, persistent event understanding | PS2 witness rules, episode correlation, PS3 salience | Canonical event/fact schema + adapters | Yes | Yes | Before event-driven actions | P0 |
| G0 Inference Runtime Broker | Faster/more reliable AI with fallback | Existing intelligence provider/session layer, telemetry | Provider-neutral request + health/router abstraction | Yes | Yes | Before live multi-provider fallback | P0 |
| C0 Communication Bus | NPCs can actually overhear/receive radio/social messages | PS2/PS3, proximity concepts, radio work | Typed message events + delivery/witness policy | Yes | Yes | Before gameplay reactions | P0 |
| D0 Dispatch Agent | Natural player↔dispatch radio | Radio input, W0/C0 once available | Shadow institutional-agent incident state + proposed responses | Yes | Yes | Before TTS/actions | P1 |
| V0 Voice Broker | Stable contextual voices with fallback | Character-aware session/voice work, promoted profiles | Provider-neutral VoiceProfile | Yes | Yes | Minimal for TTS playback | P1 |
| A0 Activity Planner | NPCs develop bounded goals/routines | ACT0–ACT2 capability/action contracts | Shadow ActivityIntent generator | Yes | Yes | Before ACT execution | P1 |
| E0 Emotion Adapter | Body language matches emotional state | Dialogue/context state, action executor | Controlled emotion state → approved animations | Partial | Yes | Yes | P2 |
| API0 Extension API | Other modules/mods can safely use LSA intelligence/actions | ACT contracts, event bus | Versioned observer/action interfaces | Yes | Yes | For exposed game actions | P2 |
| RED0 Organization Simulation | Gangs/factions have goals, knowledge and relationships | W0+C0+A0+promoted persistence | Offline organization model + event/message flow | Yes | Yes | Much later | P3 |

## High-confidence reuse points

### PS2 → W0

Do not replace PS2 witness rules.

Investigate turning PS2's event and episode concepts into adapters feeding a canonical ledger:

```
native/game signal
 -> event normalization
 -> WorldEvent
 -> witness/visibility projection
 -> Observation
 -> PS3 salience
 -> memory candidate
```

The ledger must never bypass witness gating for ordinary characters.

### PS3 → event consumption

PS3 should decide what matters to an individual agent. It should not become the source of truth for what happened.

That distinction should remain:

- **WorldEvent:** what the system believes happened
- **Observation:** what this actor could perceive
- **Salience:** how important the observation is to this actor
- **Memory:** what survives

### ACT0–ACT2 → A0/API0

The ACT stack should remain the execution safety boundary.

Autonomy should generate typed intentions that eventually request ACT capabilities; it should not create another parallel action system.

### Radio R0–R2 → C0/D0

Radio perception should evolve from track/song awareness into a generalized channel concept without mixing music metadata and institutional radio semantics into the same event type.

Candidate hierarchy:

```
AudioPerception
  MusicEvent
  SpeechEvent
  RadioMessage
    DispatchMessage
    UnitMessage
```

### Promoted characters → V0/A0/W0

Promoted characters are ideal early consumers because they already justify stable identity and persistence.

Potential additions:

- `voiceProfileId`
- current activity intent
- relationship-linked event references
- bounded organization affiliations later

Do not dump the entire world ledger into a promoted profile.

---

# Proposed branch ladder

## 1. `research/world-event-ledger-w0`

Questions:

- inventory PS2 event/episode types
- determine what is canonical vs perception-local
- propose `WorldEvent`, `Observation`, `EventRevision`
- retention and persistence policy
- event-id / episode-id stability
- privacy/logging boundaries
- migration/adapters from current producers

Exit criteria:

- no code required
- one agreed schema
- producer/consumer map
- no duplicate competing event model

## 2. `research/inference-router-g0`

Questions:

- inventory all LLM/STT/TTS call sites
- identify provider-specific assumptions
- distinguish sticky-session tasks from stateless tasks
- define health state
- define retry/fallback semantics
- define duplicate-output protection
- identify safe telemetry

Exit criteria:

- provider-neutral contracts
- failure-state table
- test plan using mock backends
- clear boundary between identity and provider selection

## 3. `feature/world-event-ledger-w0-shadow`

Implementation:

- in-memory bounded ledger
- JSONL telemetry optional
- adapters for a small number of existing event producers
- no new memories
- no new NPC knowledge
- no new actions

Tests:

- stable ids
- episode correlation
- bounded retention
- correction/revision handling
- producer failure containment
- deterministic projection tests

## 4. `feature/comms-bus-c0-shadow`

Implementation:

- normalized message envelope
- speaker/source/channel
- intended recipients where explicit
- audibility/delivery candidates
- witness/perception gate
- correlation to world events

Initially log delivery decisions only.

## 5. `feature/dispatch-d0-shadow`

Implementation:

- non-embodied `DispatchAgent`
- bounded incident board
- world-event subscriptions
- player radio transcript input
- proposed text response
- no game-state mutation
- no unit spawning/movement

Acceptance evidence:

- no invented incident state
- no accidental omniscience beyond dispatch policy
- bounded response latency
- graceful inference failure
- no dialogue/transcript logging unless explicitly allowed by existing policy

## 6. `feature/inference-router-g0`

Implementation stages:

### G0.1 wrapper
Current provider behind `IInferenceBackend`. Behavior should remain identical.

### G0.2 health/telemetry
Latency/errors/cancellation/circuit state.

### G0.3 fake fallback
Deterministic mock provider for automated failure tests.

### G0.4 optional second live backend
Feature flagged, disabled by default.

### G0.5 live failover
Only after duplicate prevention and session-continuity behavior are proven.

## 7. `feature/voice-profile-v0`

Implementation:

- `VoiceProfile` identity
- current provider adapters
- promoted-character persistence
- fallback mapping
- voice uniqueness/collision checks

Do not introduce personality changes here.

## 8. `feature/activity-planner-a0-shadow`

Implementation:

- `ActivityIntent`
- planner reads perception-safe context
- generates only known ACT capability requests
- no execution initially
- churn/repetition telemetry
- expiration/interruption semantics

Then permit one or two GTA-verified ACT2 capabilities behind an explicit allowlist.

---

# Architecture experiments worth doing

## Experiment A — provider failure harness

Simulate:

- timeout before first token
- timeout mid-stream
- 429/rate limit
- provider 5xx
- malformed response
- cancellation
- backend marked unhealthy

Measure:

- whether exactly one user-visible response occurs
- whether gameplay remains responsive
- whether retries duplicate action intent
- failover latency

This can be almost entirely offline.

## Experiment B — event-to-observation projection

Create synthetic events:

- gunshot 10 m away
- gunshot 300 m away
- player says something in another room
- police radio dispatch on authorized channel
- private NPC conversation
- witnessed collision
- event learned secondhand

Assert which characters receive:

- nothing
- observation only
- salient memory candidate

This directly tests the anti-omniscience architecture.

## Experiment C — shadow dispatch

Feed a deterministic incident stream:

```
traffic collision
officer marks en route
suspect flees
unit requests backup
suspect detained
scene clear
```

Verify the dispatch agent maintains coherent incident state and does not resurrect stale facts.

## Experiment D — voice fallback identity

For one promoted character:

- primary voice backend healthy
- primary unavailable
- fallback selected
- primary returns

Evaluate whether the voice remains recognizably the same character and whether switching causes session shimmer.

## Experiment E — autonomous activity churn

Run the planner repeatedly against unchanged state.

Fail if it repeatedly changes its mind without new evidence.

Use a minimum commitment window / interruption threshold before any GTA execution work.

---

# Things we should deliberately NOT build yet

1. A general autonomous GTA-playing agent with unrestricted natives.
2. A giant monolithic “world prompt” containing all events and characters.
3. Direct LLM → native/action execution.
4. Organization-wide magical shared memory.
5. Dispatch that knows every event merely because the engine knows it.
6. Multi-provider live failover before duplicate response/action protection exists.
7. A second action framework competing with ACT.
8. A second perception/event framework competing with PS2/PS3.
9. Persistent storage of raw transcripts solely for debugging convenience.
10. Emotion represented as arbitrary free-form model prose.

---

# Candidate milestones

## Platform M1 — Shared event spine

W0 shadow ledger receives existing PS2-compatible events and produces no behavioral changes.

## Platform M2 — Message spine

C0 routes speech/radio/message observations through perception gates.

## Platform M3 — Runtime resilience

G0 supports deterministic provider failure tests and live health telemetry with one production provider.

## Platform M4 — Living radio prototype

D0 produces coherent shadow dispatch responses from W0+C0.

## Platform M5 — Stable voices

V0 lets persistent characters retain provider-neutral voice identity.

## Platform M6 — Bounded autonomy

A0 proposes and then executes a tiny allowlist of GTA-verified ACT activities.

---

# Recommended first implementation target

**W0, not dispatch.**

If W0 is clean, dynamic dispatch becomes one consumer of a useful system.

If dispatch is built first as a bespoke pipeline, we risk later rebuilding the same event/state machinery for:

- memories
- ambient awareness
- investigations
- companions
- factions
- rumors
- autonomous activities

So the practical roadmap is:

```
PS2/PS3 reconciliation
        ↓
W0 World Event Ledger
        ↓
C0 Communication Bus
        ↓
D0 Dispatch Agent
        ↓
A0 / API0 / RED0 consumers
```

G0 and V0 can proceed mostly in parallel because they address service/runtime concerns rather than world-model semantics.
