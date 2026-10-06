# Genesis / Recent LSA Direction — Research & Enhancement Opportunities

Date: 2026-10-06  
Status: research-only; no runtime behavior changes  
Branch: `research/genesis-runtime-opportunities-20261006`

## Purpose

Capture implementation ideas suggested by Los Santos Alive's recent public direction—especially Genesis, Realcast, dynamic dispatch, Simulation 2.0, AI Callouts, autonomous partners, and the LSA API—and translate them into concrete research avenues for this fork.

This is **not** an attempt to copy private/proprietary implementation details. It is a clean-room architectural exercise based on publicly demonstrated behavior and publicly described features.

The goal is to answer:

1. What capabilities appear to be emerging upstream?
2. Which of those capabilities overlap with systems we already have?
3. Which missing primitives would unlock the most new behavior in our fork?
4. What can be prototyped safely outside GTA or in shadow mode?
5. What requires explicit GTA acceptance before it should be enabled?

## Public signals reviewed

### Genesis / Realcast / dynamic dispatch video
Video supplied for review:
https://youtu.be/ujJdqHC2h4U

Publicly demonstrated/described themes from the supplied video summary:

- a real-time AI runtime/inference platform called **Genesis**
- dynamic routing across AI infrastructure for latency/reliability
- **Realcast** voice infrastructure with a growing contextual voice library
- live AI-generated emergency-radio / dispatch interaction
- player speech to dispatch and other units
- Genesis positioned as reusable foundation for future LSA work and another game project

Exact internals are unknown. Treat all implementation details below as our own proposed architecture, not claims about how Genesis itself works.

### Simulation 2.0 / Context 2.0
Official public description:
https://www.patreon.com/LosSantosAlive/posts/los-santos-alive-162199476

Important signals:

- shared contextual foundation for player and NPCs
- individuals act on perceived information rather than hidden omniscient game state
- richer understanding of people, vehicles, locations, and ongoing situations
- intent-driven activities
- destination inference
- public/restricted-area awareness
- future persistence, investigations, social behavior, and larger world interactions

### AI Callouts
Official public description:
https://www.patreon.com/LosSantosAlive/posts/los-santos-alive-163995772

Important signals:

- dynamically generated incidents rather than only fixed scripted callouts
- stronger NPC-to-NPC interaction and action execution
- patrol behavior
- free-driving behavior
- contextual vehicle entry
- continued integration with Context 2.0

### Autonomous police partner + emotion/gesture + LSA API
Official public description:
https://www.patreon.com/LosSantosAlive/posts/los-santos-alive-168048926

Important signals:

- partners execute multi-step procedural tasks independently
- emotional state affects visible body language
- dynamic AI callouts continue expanding
- a public API exposes AI actions/scenarios/gameplay integrations to other mods

### Earlier architectural direction
Official public description:
https://www.patreon.com/LosSantosAlive/posts/los-santos-alive-159824248

Important signals:

- direct NPC-to-NPC interaction
- NPC-on-NPC actions
- destination/waypoint driving
- context refactoring
- explicit future emphasis on memory, persistence, companions, and emergent interaction

---

# What this suggests architecturally

The common pattern is not merely “better chatbot NPCs.”

A more useful mental model is:

```
Game observations / events
        ↓
Perception + salience + world-state projection
        ↓
Agent/session identity + memory
        ↓
Inference/runtime broker
        ↓
Intent / plan / dialogue decision
        ↓
Capability-gated action execution
        ↓
Voice / radio / animation / game action
        ↓
New world events
```

Some agents are embodied peds. Others do not need to be:

- dispatch
- mission/callout controller
- organization/gang
- police unit coordinator
- news/rumor system
- companion group
- future world simulation services

That distinction is important. We should avoid designing every intelligent thing as “an NPC with a prompt.”

---

# Mapping to our current fork

The fork already has useful pieces of this architecture:

- P0–P2 perception/context foundations
- PS2 witness/event rules and episode correlation
- PS3 salience work
- promoted-character persistence
- structured streaming / early TTS
- character-aware voice/session work
- UX talk targeting
- ACT0/ACT1 contracts and observer structure
- ACT2 player-assigned activities
- radio track perception R0–R2
- shadow-mode intelligence and capability-gated execution
- telemetry work around companion/shadow reporting

Therefore the highest-value direction is **not** to restart around a Genesis clone.

The better move is to add several missing platform primitives that let the systems above compose cleanly.

---

# Recommended research tracks

## G0 — Inference Runtime Broker

### Goal

Decouple “what intelligence task needs to happen” from “which model/provider executes it.”

### Proposed primitives

`IInferenceBackend`

- backend id
- supported capabilities
- health state
- latency observations
- streaming support
- model/context limits
- optional cost metadata

`InferenceRequest`

- task class
- character/session id
- latency class
- required capabilities
- maximum response budget
- retry/fallback policy
- privacy/logging flags

`InferenceRouter`

- capability filtering
- health filtering
- latency-aware ranking
- circuit breaker
- bounded retry
- fallback provider selection
- sticky routing where character/session continuity matters

### First implementation avenue

Do **not** route live gameplay across multiple providers immediately.

Start with:

1. introduce an interface around the currently selected provider
2. measure time-to-first-token, completion latency, failures, retries, cancellation
3. add a second mock/test backend
4. validate fallback entirely offline
5. optionally shadow-score alternate backends without using their answer
6. enable live failover only after deterministic failure tests

### Why this matters

This gives us the useful part of a Genesis-like runtime:

- outages stop being catastrophic
- provider experiments stop contaminating gameplay code
- future STT/TTS/text-model routing can share one health model
- latency can become an observable engineering metric

### Important constraint

Character identity/session behavior must not silently change because routing changed. Provider routing and character identity need separate state.

---

## V0 — Voice Identity & Voice Broker

### Goal

Separate a character's **voice identity** from a specific TTS provider/model.

### Proposed `VoiceProfile`

- stable `voiceProfileId`
- provider-independent descriptors:
  - age band
  - presentation
  - accent/region when known
  - texture
  - energy
  - pace
  - expressiveness
- preferred backend voice ids
- fallback backend voice ids
- optional deterministic seed/session strategy
- speaking-style state

For promoted characters, persist the **voice profile identity**, not only a raw provider voice name.

### MVP

- normalize existing character-aware voice selection behind `VoiceProfile`
- add fallback voices
- emit telemetry when fallback is used
- preserve the same perceived character as closely as possible across backend changes

### Later

Emotion can influence delivery without changing identity:

```
character voice identity + current emotional delivery -> synthesis request
```

This gives us a clean route toward Realcast-like behavior without coupling personality, persistence, or memory to one vendor.

---

## W0 — World Event Ledger

### Goal

Create one canonical event backbone that perception, memory, dispatch, rumors, investigations, and institutional agents can consume.

This is arguably the most important missing primitive.

### Proposed event shape

```
WorldEvent
  eventId
  episodeId
  type
  occurredAt
  position / area
  actors
  objects
  severity
  source
  confidence
  publicFacts
  restrictedFacts
  lifecycle
```

Events are **facts/events**, not automatically memories.

Each character should still receive information through a perception path:

```
WorldEvent
   ↓ visibility/witness check
Observation
   ↓ salience
Memory candidate
```

This preserves the PS2/PS3 principle that characters should not become omniscient.

### Immediate overlap

PS2 witness rules and episode correlation appear to be the natural seed for this.

Research should determine whether PS2's event/episode contracts can be promoted into a generalized ledger rather than creating a competing representation.

### High-value consumers

- dispatch
- police units
- witnesses
- promoted characters
- rumor propagation
- investigations
- companion awareness
- crime persistence
- ambient NPC conversation

---

## D0 — Institutional Agents

### Goal

Support intelligent actors that are **not peds**.

Dynamic dispatch should be our first example.

### Proposed `InstitutionalAgent`

- stable agent identity
- domain
- authorized world/event views
- channel membership
- short-lived working state
- persistent operational state where justified
- callable capabilities
- response policy

Potential agents:

- emergency dispatch
- police coordination
- gang/organization controller
- news/rumor service
- mission/callout narrator
- future businesses/factions

### Dispatch MVP

Shadow-only:

1. subscribe to selected WorldEvents
2. maintain a bounded incident record
3. ingest player radio transcript/events
4. generate a proposed dispatch response
5. log the proposal
6. execute **no GTA behavior**

Then add TTS/radio output while keeping unit/action requests capability-gated.

### Later

Dispatch can mediate unit requests through explicit commands:

```
player radio
  -> dispatch intent
  -> validated dispatch command
  -> capability gateway
  -> game action
```

The model should never directly manipulate game natives.

---

## C0 — Communication Bus / Agent-to-Agent Messaging

### Goal

Make speech, radio, and social communication first-class events that other agents may perceive.

### Proposed message types

- spoken utterance
- radio transmission
- direct address
- overheard conversation
- dispatch broadcast
- organization message
- nonverbal signal

### Critical rule

A message being emitted does **not** mean every NPC knows it.

Delivery should depend on:

- range
- channel
- listener state
- witness rules
- occlusion/context when available
- affiliation/authorization
- relevance/salience

### Immediate opportunities

- ambient NPC dialogue awareness
- proximity chat
- companion overhearing
- dispatch/unit radio awareness
- promoted-character social memory
- rumor propagation

This should reuse PS2/PS3 rather than bypassing perception.

---

## A0 — Intent / Activity Planner Layer

### Goal

Extend ACT from player-assigned action execution into **bounded autonomous intent**.

ACT0–ACT2 already give us contracts and safe execution structure. The missing layer is a planner that selects *why* and *what next* without being allowed to execute arbitrary capabilities.

### Proposed plan object

```
ActivityIntent
  actorId
  goal
  reason
  priority
  targetKind
  targetId / area
  candidateActions
  expiry
  interruptionPolicy
```

### Safe first avenue

Offline/shadow planner:

- produce activity intents for promoted characters
- do not execute
- compare intent against known context/personality/profile
- measure churn and repetition
- validate interruption rules

Then permit only a tiny allowlist of existing ACT2 activities.

### Longer-term

- go eat
- wander/patrol
- visit known location
- meet another promoted character
- drive somewhere
- return home/work
- investigate nearby event
- assist companion/player

This is the bridge from “do this command” to “this person has something they are trying to do.”

---

## E0 — Emotion / Embodied Expression Adapter

### Goal

Map internal conversational/situational state to bounded GTA animation/gesture behavior.

Do not make emotion another free-form model output.

Use a controlled state vocabulary such as:

- calm
- alert
- nervous
- afraid
- angry
- confident
- distressed

Then translate state + intensity into approved animation/look-at/stance behaviors.

### Why later than W0/D0

This improves presentation, but it does not unlock as much architecture as shared events, institutional agents, or runtime routing.

---

## API0 — Stable Capability / Extension API

### Goal

Eventually expose safe, versioned contracts so new systems do not need to reach directly into native/game code.

Potential interfaces:

- observe world events
- query public character metadata
- request approved actions
- submit a dialogue/intent request
- subscribe to radio events
- define a new institutional agent
- register an activity provider

ACT's capability contracts are a natural starting point.

Do not expose raw native execution.

---

## RED0 — Organization / Underworld Simulation

This is a speculative longer-term avenue inspired by the public “RED” direction, not a claim about upstream implementation.

An organization should not simply be a giant NPC prompt.

Potential model:

```
Organization
  members
  relationships
  territory/interests
  resources
  knowledge
  active goals
  current incidents
```

Characters belong to organizations but maintain their own perception and memory.

Organization knowledge should be propagated through explicit reports/messages/events rather than magically synchronized.

Potential gameplay:

- crimes occur without player initiation
- witnesses and rumors create investigative trails
- gang members coordinate
- promoted characters develop associates/rivals
- dispatch/police respond to persistent incidents
- unresolved events remain meaningful later

This track depends on W0 + C0 + A0 and should not be first.

---

# Priority recommendation

## Tier 1 — Foundation / highest leverage

1. **W0 World Event Ledger**
2. **G0 Inference Runtime Broker**
3. **C0 Communication Bus**

These are reusable primitives and mostly testable outside GTA.

## Tier 2 — Visible capability

4. **D0 Institutional Agent: Dispatch**
5. **V0 Voice Identity/Broker**
6. **A0 Intent/Activity Planner**

These turn the foundation into obvious gameplay improvements.

## Tier 3 — Expansion

7. **E0 Emotion/Embodied Expression**
8. **API0 Extension API**
9. **RED0 Organization/Underworld Simulation**

---

# Suggested implementation sequence

### Research branch 1 — `research/world-event-ledger-w0`
Reconcile PS2 event/episode contracts with a proposed canonical `WorldEvent`. No runtime mutation.

### Research branch 2 — `research/inference-router-g0`
Inventory all current model/STT/TTS call sites and propose a provider-neutral request/health model.

### Prototype branch 3 — `feature/world-event-ledger-w0-shadow`
Emit a bounded event ledger in shadow mode. No added NPC knowledge.

### Prototype branch 4 — `feature/comms-bus-c0-shadow`
Normalize nearby speech/radio as messages and feed only through witness/perception gates.

### Prototype branch 5 — `feature/dispatch-d0-shadow`
Generate dispatch state/response proposals from ledger + radio input. No action execution.

### Prototype branch 6 — `feature/inference-router-g0`
Wrap existing provider, then add test/fallback backend behind runtime flags.

### Prototype branch 7 — `feature/voice-profile-v0`
Persist provider-neutral character voice identity and fallback mappings.

### Prototype branch 8 — `feature/activity-planner-a0-shadow`
Generate non-executing activity intents using ACT contracts; later allowlist safe ACT2 execution.

---

# Questions each research branch must answer

## World events

- Are PS2 events already sufficiently general to become the ledger?
- What is a fact vs an observation vs a memory?
- How are event corrections/retractions represented?
- How long are events retained?
- How are event/episode ids stable across save/restart?

## Runtime routing

- Which current provider calls require sticky sessions?
- Which can safely retry?
- Can streaming resume/fallback or must the whole request restart?
- How do we prevent duplicate speech/actions on retry?
- What metrics can be collected without logging dialogue?

## Dispatch

- What events may dispatch know globally?
- What still needs witness/reporting?
- How are unit states represented?
- Which commands are informational vs action-bearing?
- How do we prevent generated dispatch text from becoming an implicit action command?

## Voice

- Which voice attributes are identity and which are transient delivery?
- How should fallback preserve identity?
- How do we avoid repeated/generated characters converging on the same voices?

## Activities

- What can interrupt an activity?
- How do we distinguish player-assigned vs autonomous intent?
- How do we avoid planner thrashing?
- What activities are safe to validate outside GTA?
- What requires native acceptance probes?

---

# Rollout discipline

Continue the existing conservative pattern:

```
research
  -> offline implementation
  -> focused tests
  -> shadow runtime
  -> telemetry review
  -> GTA-pending
  -> GTA acceptance
  -> gated enablement
  -> default-on only after evidence
```

For any model-generated request that could alter GTA state:

```
model output
  -> typed intent
  -> schema validation
  -> policy/capability validation
  -> runtime safety checks
  -> explicit executor
```

Never:

```
model text -> raw native/action execution
```

---

# Recommended next move

Start **W0 World Event Ledger research first**, while running **G0 Inference Runtime Broker research in parallel**.

Reason:

- W0 connects PS2, PS3, radio, promoted characters, ambient awareness, investigations, dispatch, and future persistence.
- G0 improves reliability/performance without requiring us to redesign cognition.
- D0 dispatch becomes much easier and cleaner once W0 and C0 exist.

The flashy target is dynamic dispatch.

The architectural target should be:

> a shared, perception-safe event substrate plus provider-neutral intelligence/runtime services.

That foundation can support dispatch, companions, ambient NPCs, autonomous activities, factions, and future game integrations without each feature becoming a separate one-off AI subsystem.
