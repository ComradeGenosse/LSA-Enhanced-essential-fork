# Project roadmap

Updated October 1, 2026.

This roadmap tracks the Essential-based LSA companion from the hardened E1.1 foundation through low-latency dialogue, durable NPC identity, richer perception, autonomous scene behavior, and final long-session acceptance.

The governing architecture remains:

```text
OpenAI / other providers
        ↓
E1.1 + later E-stages
        ↓
Los Santos Alive Essential
        ↓
GTA V
```

Essential remains authoritative for native NPC state, turn/generation identity, action execution, playback authorization, interruption, and completion. Later phases extend those native seams rather than create a second competing lifecycle.

## Status overview

| Phase | Status | Purpose / current gate |
| --- | --- | --- |
| E1 / E1.1 | ✅ Implemented | Hardened OpenAI/Luna integration on Essential's native lifecycle |
| E4 (pulled forward) | ✅ Implemented | Persistent observability, lifecycle metrics, Windows-safe logging/retention, offline reporting |
| E2 | ✅ Implemented | Provider abstraction, stable session voices, bounded acting guidance |
| E3 | ✅ Implemented | Stage-aware retries and provider failure recovery |
| E5 | ✅ Implemented + live API validated | Structured Responses streaming; configured Luna produced a validated segment before response completion |
| E6 | 🟡 Implemented; physical GTA acceptance pending | Early segmented TTS works through the stock-controller/native-lifecycle harness and is staged for live GTA testing |
| SESSION_IDENTITY | ⏭ Next feature phase after E6 acceptance | Durable character identity beyond one native session |
| PERCEPTION | Planned | Richer world/event/context awareness |
| SALIENCE | Planned | Decide what an NPC should care about right now |
| SCENE_DIRECTOR | Planned | NPC initiative and coordinated autonomous behavior |
| CUSTOM ACTIONS / ACTIVITIES | Planned | Expose more native Essential capabilities and add new extensions where needed |
| E7 | Planned | Full regression, soak testing, and GTA acceptance |

## Completed foundation

### E1 / E1.1 — Hardened Essential + OpenAI/Luna integration

E1/E1.1 established the safe provider/native boundary.

Core guarantees include:

- Essential-owned `pedId + turnId + generationId + sessionNonce` identity.
- OpenAI STT, Luna reasoning, and OpenAI TTS integrated without replacing Essential's native lifecycle.
- Stock action validation/dispatch remains authoritative.
- Native playback authorization and exact interruption remain authoritative.
- Genuine player input commits once accepted.
- Assistant history remains staged until a matching successful `PlaybackEnded`.
- `SPECIAL_EVENT` and internal/system sources do not become fake player dialogue.
- Source-pinned build/native contract validation fails closed when expected hooks drift.

The old/custom LSA 2.1 branch remains a reference and migration source, not the runtime foundation of this companion.

### E4 — Observability, completed early

Observability was originally planned after E2/E3 but was deliberately pulled forward so later work could be measured rather than debugged blindly.

Implemented coverage includes turn/source binding, microphone capture, STT/reasoning/TTS timing, provider attempts/retries, first TTS byte, action-validation boundaries, native authorization, PCM forwarding, playback start/end, interruption/supersession, history mutation, terminal summaries, and incomplete/dropped trace detection.

The later Windows logging/retention fix is also part of the current foundation. Runtime telemetry remains privacy-filtered and passive.

## Provider quality phases

### E2 — Provider abstraction, voices, and acting

Implemented in the current source tree. E2 converts the hard-wired provider path into explicit reasoning, transcription, and speech provider seams while preserving E1.1 lifecycle ownership.

It adds deterministic per-native-session voice profiles, configurable voice pools, bounded speed, and optional trusted acting/style instructions. It intentionally does not claim durable cross-session character identity; that belongs to SESSION_IDENTITY.

### E3 — Stage-aware reliability and retries

Implemented in the current source tree. E3 retries provider operations only while they are still safe to repeat.

Key rules remain:

- at most one automatic retry after the original provider request;
- retries consume the original provider deadline;
- no whole-turn retries;
- no automatic provider fallback;
- no retry after cancellation, supersession, terminal state, or stale generation;
- action dispatch, native authorization, playback completion, and history commit are never replayed by retry logic;
- action-bearing TTS closes retry eligibility before stock action publication;
- dialogue-only TTS may retry only before the first native PCM/effect boundary.

See [E2/E3 implementation status](E2-E3-implementation-status.md).

## Low-latency pipeline

### E5 — Structured model/output streaming — implemented

E5 is no longer a future architecture phase. The repository now contains the bounded Responses SSE adapter and complete-segment decoder.

The current protocol uses one strict JSON decision envelope:

```json
{"mode":"dialogue_only","segments":[{"text":"..."}],"command":""}
```

The decoder does **not** parse arbitrary half-finished JSON as a decision. It only exposes a speech segment after that segment object is closed, parsed, bounded, and locally validated. The complete terminal response is then reconciled and passed through the existing Essential decision/action validators.

Important properties now implemented:

- exact native identity remains external to/model-independent from the stream;
- complete segments become immutable once released;
- `dialogue_only` is irrevocable; a later command is a protocol failure;
- action-bearing `buffered_action` turns remain behind the final validation barrier;
- final transcript/action publication still occurs once;
- refusal, incomplete output, malformed framing, duplicate/conflicting data, and terminal mismatch fail closed;
- stock Gemini stays on its existing path.

#### E5 live capability gate

The explicit one-request streaming smoke passed against the configured `gpt-6-luna` endpoint.

Recorded timing from that capability check:

- first locally validated dialogue-only segment: about **1.05 s**;
- `response.completed`: about **1.19 s**.

That demonstrates that the configured Luna path can expose a usable complete segment before full response completion. It validates the key provider capability needed by E6; it is not itself a GTA playback test.

See [E5/E6 streaming notes](../lsa-essential-e1-candidate/docs/e5-e6-streaming.md).

### E6 — Early segmented TTS — implemented, GTA gate open

E6 is implemented behind `structuredStreamingEnabled` and `earlyTtsEnabled`. Both remain default-off in the checked-in example config; the controlled live GTA test config has been staged with both enabled.

For eligible `dialogue_only` turns, the implemented path is:

```text
Luna emits first complete safe segment
        ↓
segment TTS starts
        ↓
Essential authorizes the exact generation once
        ↓
PCM can begin before model completion
        ↓
later segments are synthesized serially/in order
        ↓
full model response validates
        ↓
one final transcript + one stream-end
        ↓
matching PlaybackEnded
        ↓
assistant history commits once
```

Action-bearing turns deliberately **do not** get early speech. They remain buffered until the final decision passes validation, preserving E3 side-effect rules.

Implemented safeguards include:

- one serial TTS consumer;
- no speculative concurrent PCM queue;
- aggregate PCM cap before native authorization;
- exact-generation cancellation/supersession fences;
- one logical authorization/stream-end lifecycle;
- no assistant history commit before matching `PlaybackEnded`;
- abort of early speech when the model fails;
- rejection of malformed/incomplete PCM16 output;
- no stale action/segment/history resurrection.

#### Current E6 evidence

A stock-controller integration test now drives two delayed TTS segments through the actual patched stock controller and Essential lifecycle bridge. It verifies:

- first PCM occurs before the model terminal event;
- segment order is preserved;
- all audio retains the same native identity;
- there is one final stream-end handoff;
- assistant history remains staged until matching `PlaybackEnded`.

The current full offline suite passes **149 tests with 0 failures** ([test output](../lsa-essential-e1-candidate/docs/e5-e6-test-results.txt)). This includes `84df8e30` model-failure/PCM16 hardening and the production telemetry repair reproduced from the first failed E5/E6 GTA runs. The stock E6 integration test now exercises the real logger; physical GTA acceptance of the repaired build remains open.

The E5/E6 payload was also staged/installed for controlled GTA testing with backups and hash verification. However, the repository does **not** yet contain a post-deployment GTA log proving physical playback for the current E6 path.

#### E6 remaining release gate

Physical GTA acceptance must still demonstrate:

- the first segment is audibly played before model completion on an eligible turn;
- later segments continue on the same logical native stream across real queue gaps;
- no premature successful `PlaybackEnded` occurs before final stream end;
- interruption/late model failure kills the exact generation without stale PCM or history;
- action-bearing turns remain buffered;
- final assistant history commits once and only after matching native playback completion.

Prior Phase 10B evidence (13 turns, 11 with audio/acknowledgements, observed PCM gap up to about 2.98 seconds) remains strong prior evidence for open-stream behavior, but it is not counted as validation of this exact E1.1/E6 runtime path.

Once this physical GTA gate passes, the next feature phase is **SESSION_IDENTITY**.

See the [E5/E6 implementation status](E5-E6-implementation-status.md) for the current checkpoint, deployment distinction, and remaining GTA gate.

## NPC intelligence roadmap

After the provider/latency foundation is stable, development shifts from transport architecture toward persistent characters and autonomous behavior.

### SESSION_IDENTITY — Durable character identity

Current `pedId + sessionNonce` identity is correct for runtime safety but is intentionally not permanent character identity.

This phase should introduce a durable identity resolver capable of distinguishing:

- the same continuing character;
- a new session for an existing known character;
- a recycled GTA handle;
- a genuinely new NPC.

Durable identity can later own:

- long-term voice assignment;
- relationship state;
- memories;
- personality/state continuity;
- longer-term goals.

Do not build persistent memory on raw ped handles.

### PERCEPTION — Richer world and event awareness

Use Essential's existing extension seams and native state rather than creating a duplicate world scanner.

Candidate native surfaces identified during Hotfix #3 analysis include:

- `IIntegration.EnrichActor()`;
- `PerceptionSystem`;
- `NpcStateStore`;
- `ReflexSystem`;
- location/activity registries;
- directed interaction/native turn systems.

Examples of useful observations:

- nearby threats or gunfire;
- vehicle crashes;
- injuries;
- police arrival;
- theft or aggression witnessed by an NPC;
- changes in activity/location;
- nearby characters with relevant relationships;
- meaningful vehicle/object state.

Perception should expose facts, not decide behavior.

### SALIENCE — Decide what matters

A richer perception system can produce far more information than a model should receive every turn.

Salience should rank/filter observations based on factors such as:

- immediacy;
- threat;
- relationship;
- recency;
- current goals/activity;
- prior memory;
- direct relevance to the player or current conversation.

The goal is to prevent NPCs from reacting to every minor event while still noticing genuinely important changes.

Conceptually:

```text
PERCEPTION
    ↓
candidate observations
    ↓
SALIENCE
    ↓
small relevant context set
    ↓
reasoning / initiative
```

### SCENE_DIRECTOR — NPC initiative and coordination

This phase moves beyond primarily player-triggered interaction.

Target behavior:

```text
NPC perceives event
      ↓
salience says it matters
      ↓
NPC/native system initiates a turn
      ↓
NPC speaks and/or acts
```

Examples:

- an NPC warning the player about someone following them;
- a companion deciding to leave danger;
- a police NPC requesting backup;
- characters initiating conversation with one another;
- coordinated multi-character reactions.

Prefer Essential-native mechanisms such as directed interactions, reflex/state systems, and native/special-turn scheduling. Do not bypass the authoritative turn/playback lifecycle.

### CUSTOM ACTIONS / ACTIVITIES

Before writing new GTA behaviors from scratch, expose useful native capabilities already present in Essential but not currently available to the model.

Candidates identified in the native analysis include behavior such as:

- taking cover;
- chasing a target;
- becoming an accomplice;
- approaching/talking to nearby characters;
- richer item interactions;
- scenario/activity behaviors.

Where Essential lacks a required behavior, add it through native extension seams such as `NpcActionRegistry.Register()`, `IActionStateModifier`, or `IIntegration` rather than creating a parallel action system.

## E7 — Full regression and GTA acceptance

E7 is the integrated product-level acceptance phase.

It should cover more than isolated happy-path conversations:

- long play sessions / soak tests;
- multiple NPCs and rapid speaker switching;
- PTT and typed input;
- long responses;
- interruption/supersession;
- vehicles;
- weapons;
- police/civilian role actions;
- provider/network failures;
- rate limits and retries;
- reconnects and reloads;
- durable identity continuity;
- autonomous turns;
- custom actions;
- stock Gemini regression;
- OpenAI regression;
- performance and latency;
- observability/log consistency.

The final acceptance criterion is not merely that an NPC can answer. The complete system must remain generation-safe, action-safe, identity-safe, and understandable under real GTA runtime stress.

## Ongoing architectural rules

Across every future phase:

1. **Essential remains authoritative.** Do not recreate native turn, action, playback, or NPC-state ownership unless a demonstrated native gap requires a deliberately reviewed extension.
2. **Extend before replacing.** Prefer existing Hotfix #3 extension seams and native behaviors over forks or parallel state machines.
3. **Never trust raw ped handles as permanent identity.**
4. **No stale work may publish.** Supersession/cancellation must continue to invalidate late model, TTS, action, and telemetry work.
5. **Actions are side effects.** Streaming/retry work must never duplicate them.
6. **Playback completion is native evidence.** Generated PCM length or provider completion is not proof that speech was delivered.
7. **Observability remains passive.** Logging/reporting must never alter lifecycle success or failure.
8. **Privacy remains bounded.** Do not persist credentials, prompts, transcripts, dialogue, raw provider responses, URLs, or audio in telemetry.
9. **Offline verification and runtime validation are separate gates.** Unit/build success must never be reported as proof of live API or GTA behavior.
10. **Keep the old custom LSA branch as a feature reference, not a source of code to merge blindly.** For each old capability, first determine whether Essential now provides it natively or exposes a better extension seam.
