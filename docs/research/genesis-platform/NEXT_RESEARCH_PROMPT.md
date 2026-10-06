# Next Research Pass Prompt

Use this prompt with a repo-aware coding agent against this branch.

---

Work in `ComradeGenosse/LSA-Enhanced-essential-fork` on branch
`research/genesis-runtime-opportunities-20261006`.

This is a **research/reconciliation pass only**. Do not implement runtime behavior yet.

Read:

- `docs/research/genesis-platform/README.md`
- `docs/research/genesis-platform/IMPLEMENTATION_MATRIX.md`
- current PS2/PS3 status/design docs
- ACT0/ACT1/ACT2 contracts/status docs
- radio R0–R2 research/status docs
- promoted-character/profile persistence code/docs
- current inference/provider/session/STT/TTS integrations
- telemetry/logging contracts

Then reconcile the Genesis-inspired research against the **actual current repository**.

## Required outputs

### 1. Current architecture inventory

For each proposed track:

- W0 World Event Ledger
- G0 Inference Runtime Broker
- C0 Communication Bus
- D0 Institutional/Dispatch Agent
- V0 Voice Profile/Broker
- A0 Activity Planner
- E0 Emotion Adapter
- API0 Extension API
- RED0 Organization Simulation

identify:

- current files/classes/contracts that already solve part of it
- duplicated concepts we must not recreate
- missing primitives
- runtime/config boundaries
- existing tests
- current telemetry
- GTA-dependent pieces

Do not rely on filenames assumed by these research notes. Find the real code.

### 2. W0 feasibility decision

Determine whether the existing PS2 event/episode model can become the canonical shared event substrate.

Answer explicitly:

- extend existing PS2 contract
- add adapter around PS2
- or introduce a new canonical event contract

Prefer reuse unless there is a concrete architectural blocker.

Produce a proposed schema for:

- WorldEvent
- Observation
- EventRevision/correction if needed
- event/episode identity
- retention/persistence boundary
- visibility/witness projection

Keep facts/events separate from actor memories.

### 3. G0 call-site inventory

Find every model-related integration:

- text intelligence
- STT
- TTS
- streaming
- character/session identity
- provider-specific configuration

Classify each call site as:

- stateless
- sticky-session
- retry-safe
- retry-unsafe
- action-bearing
- dialogue-only

Identify where duplicate response/action protection would be required before provider failover.

### 4. C0 communication model

Map existing speech/radio producers and consumers.

Propose the smallest typed message envelope that supports:

- local speech
- direct address
- overheard speech
- radio unit traffic
- dispatch messages

Delivery must pass through existing witness/perception rules.

### 5. D0 shadow dispatch architecture

Design a non-embodied DispatchAgent that consumes only authorized W0/C0 information.

The first version must:

- maintain bounded incident state
- accept player radio transcript/events
- generate proposed dispatch responses
- perform zero GTA actions
- remain disabled or shadow-only by default
- fail without affecting gameplay

Identify exactly which later actions would need ACT/capability gating.

### 6. V0 voice identity reconciliation

Inspect the current character-aware voice/session implementation.

Determine the minimum change required to make voice identity provider-neutral without destabilizing current speech.

Propose persistent fields only where justified.

### 7. A0 autonomy bridge

Inspect ACT0–ACT2.

Design `ActivityIntent` so autonomous planning reuses ACT capabilities instead of bypassing them.

Separate:

- player-assigned activities
- autonomous activities
- interruption/cancellation
- capability authorization

The first planner must be shadow-only.

### 8. Risk register

For every track, list:

- hallucinated/false world state risk
- omniscience leakage risk
- duplicate action risk
- persistence corruption risk
- provider outage behavior
- performance/latency risk
- GTA-native/runtime risk
- privacy/logging risk

### 9. Revised implementation order

Update the research docs if repository reality changes the proposed order.

Use the existing project maturity terminology where applicable:

- research
- offline-complete
- shadow
- GTA-pending
- GTA-verified
- deployed

Do not mark anything GTA-verified without actual GTA evidence.

## Deliverables

Update the two Genesis research documents in-place and add:

`docs/research/genesis-platform/RECONCILIATION_REPORT.md`

The reconciliation report must contain:

1. executive conclusion
2. architecture map using actual repo symbols
3. W0 decision
4. G0 provider call-site table
5. C0 producer/consumer map
6. D0 dispatch proposal
7. V0 voice proposal
8. A0 integration proposal
9. risk register
10. recommended first implementation branch and acceptance criteria

Do not implement production code in this pass.

Run documentation/link/static checks that are relevant and available. Commit the research changes to this branch and report the commit SHA.
