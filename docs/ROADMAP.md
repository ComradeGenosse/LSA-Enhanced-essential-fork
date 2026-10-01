# Project roadmap

Updated October 1, 2026.

This roadmap tracks the Essential-based LSA companion from the hardened E1.1 foundation through lower-latency dialogue, durable NPC identity, richer perception, autonomous scene behavior, and final long-session acceptance.

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

Essential remains authoritative for native NPC state, turn/generation identity, action execution, playback authorization, interruption, and completion. Later phases should extend those native seams rather than create a second competing lifecycle.

## Status overview

| Phase | Status | Purpose |
| --- | --- | --- |
| E1 / E1.1 | ✅ Implemented | Hardened OpenAI/Luna integration on Essential's native lifecycle |
| E4 (pulled forward) | ✅ Implemented | Persistent observability, lifecycle metrics, and offline reporting |
| E2 | ✅ Implemented offline / runtime validation gate | Provider abstraction, stable session voices, bounded acting guidance |
| E3 | ✅ Implemented offline / runtime validation gate | Stage-aware retries and provider failure recovery |
| E5 | ⏭ Next major architecture phase | Structured model/output streaming |
| E6 | Planned | Early TTS and lower perceived response latency |
| SESSION_IDENTITY | Planned | Durable character identity beyond one native session |
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

Implemented coverage includes:

- turn/source binding;
- microphone capture;
- STT, reasoning, and TTS timing;
- first TTS byte;
- provider request correlation and reported usage when available;
- action validation and stock-handler boundaries;
- native authorization;
- PCM chunk/byte forwarding;
- playback start/end;
- interruption/supersession;
- history mutation;
- provider retry activity;
- terminal summaries;
- incomplete/dropped trace detection.

Runtime telemetry is privacy-filtered and written to bounded rotating JSONL logs. The offline reporter produces JSON/Markdown summaries without network access.

## Current validation work

### E2 — Provider abstraction, voices, and acting

Implementation is present in the repository. E2 turns the previously hard-wired provider path into explicit reasoning, transcription, and speech provider seams while preserving existing E1.1 lifecycle ownership.

E2 also adds:

- one immutable deterministic voice profile per native NPC session;
- configurable voice pools while preserving legacy singleton `ttsVoice` behavior;
- bounded speed settings;
- optional trusted acting/style instructions;
- no long-term character identity claims yet;
- no stock Gemini migration into the new provider stack.

Runtime validation should confirm:

- the same NPC session retains the same voice across repeated turns;
- two NPC sessions do not cross-contaminate voices;
- context refresh does not reroll the voice;
- acting guidance changes delivery without changing validated dialogue text;
- stock Gemini behavior remains unchanged.

### E3 — Stage-aware reliability and retries

Implementation is present in the repository. E3 adds conservative provider-level recovery without retrying native/gameplay side effects.

Rules:

- at most one automatic retry after the original request;
- retries consume the original provider deadline;
- STT and reasoning may retry only inside their unpublished provider stages;
- dialogue-only TTS may retry only before its first usable PCM/native side-effect boundary;
- action-bearing TTS closes retry eligibility before stock action publication;
- no whole-turn retries;
- no automatic provider fallback;
- no retry after cancellation, supersession, terminal state, or stale generation;
- native authorization, action dispatch, playback completion, and history commit are never replayed by retry logic.

Runtime validation should specifically exercise supersession, interruption, dialogue-only TTS recovery, action-bearing failures, and wrong-NPC/late-result prevention.

See [E2/E3 implementation status](E2-E3-implementation-status.md) and the [source-grounded E2/E3 implementation plan](plans/E2-E3-implementation-plan.md).

## Next: E5 — Structured model/output streaming

E5 creates the structured streaming foundation needed to reduce response latency safely.

Current behavior is approximately:

```text
wait for complete Luna decision
        ↓
validate
        ↓
begin TTS
```

The E5 target is an explicitly framed stream where useful dialogue segments and final decision/action information can arrive incrementally without parsing arbitrary half-written JSON.

Conceptually:

```text
Luna stream
   ├─ safe dialogue segment
   ├─ safe dialogue segment
   ├─ final action/decision data
   └─ terminal completion
```

Requirements:

- preserve exact native generation identity;
- preserve strict decision validation;
- never allow a stale segment to escape after supersession;
- distinguish provisional speech from final action-bearing state;
- keep stock action authorization outside provider parsing;
- instrument segment timing and cancellation through the existing observability system.

E5 is primarily an architecture phase. It should make E6 possible without yet aggressively changing audible timing.

## E6 — Early TTS and lower perceived latency

E6 uses E5's structured segments to start speech before the entire model turn has completed.

Target:

```text
Luna produces first safe segment
        ↓
TTS begins for segment 1
        ↓
NPC starts speaking
        ↓
Luna continues generating later segments
```

Key problems to solve:

- segment ordering;
- cancellation and supersession;
- preventing already-spoken dialogue from contradicting a later action decision;
- ensuring audio from stale attempts/generations cannot leak;
- preserving Essential as playback authority;
- deciding when a segment is safe enough to synthesize early.

Success should be measured with existing telemetry: player-input-ready → first audible/native playback start, model segment latency, TTS first byte, and total completion.

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
