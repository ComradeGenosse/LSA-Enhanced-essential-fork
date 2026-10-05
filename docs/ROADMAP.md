# Project roadmap

Updated October 4, 2026.

Current runtime/code baseline: `main@0c254049` contains unified UX phases 0–3, the production input/Harmony fixes, and PS2 witness/episode correlation. Source-time player-speech hearing remains disabled pending the native capture receipt probe. PS3 salience, ACT0/ACT1, and ACT2 now have real implementations on unmerged feature branches. PS3 was additionally reconciled on local staging and hash-deployed in shadow on October 5 for GTA acceptance, but is still not merged to GitHub `main`; ACT0/ACT1 and ACT2 still require reconciliation before merge/deployment.

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
| E6 | ✅ Implemented | Early segmented TTS is complete in the production path; remaining early-audio/multi-segment stress checks are follow-up validation |
| P0 — TURN_CONTEXT | ✅ Merged to `main` + offline-verified; GTA acceptance pending | Immutable per-turn actor/listener/world snapshots and time-of-use P/V target-reference validation |
| P1 — SESSION_IDENTITY | ✅ Implemented | Explicit owner-authenticated durable UUIDs, runtime bindings, and persistent voice assignments are merged to `main` |
| P2 — PROMOTED_CHARACTERS / CHARACTER_PROFILE | ✅ Implemented | Merged to `main` and exercised in GTA: promotion, character editor/profile memory editing, summon, follow/wait and native vehicle behavior |
| UX0–UX3 — CONTROLS / NATIVE MENU | ✅ Merged to `main` + offline-verified; GTA acceptance pending | Command bridge, input router/chords, F11 native menu, Current NPC / Characters / Controls / AI / Diagnostics pages |
| UX4 — TALK TARGET SELECTOR | 🔵 T0A audit + implementation plan complete; not implemented | Visible target select/cycle plus exact-Ped held PTT without replacing Essential's conversation lifecycle |
| CGE — CONVERSATION GAZE / ENGAGEMENT | 🔵 Plan amended after convergence audit; not implemented | Yielding head/eye attention overlay for the current conversation partner. Essential's own conversation-look behavior wins; whole-body `stop_and_face` belongs to ACT3, not CGE |
| RADIO TRACK PERCEPTION | 🔵 Implementation-ready research; not implemented | Source-time vehicle-radio producer feeding PS2 witness attribution and PS3 salience; no direct prompt injection |
| PS0 / PS1 — PERCEPTION FOUNDATION | ✅ Implemented offline on `main`; physical GTA validation pending | Default-off shadow contracts, lifetime anchors, bounded factual transport and supported native producers |
| PS2 — WITNESS / EPISODE CORRELATION | Implemented offline on `main`; GTA acceptance pending | Witness rules, episode correlation, immutable observer revisions and speech contracts are merged. Source-time player-speech hearing remains disabled until native mic/capture receipts are proven. |
| PS3 — DETERMINISTIC SALIENCE | 🟡 Implemented; reconciled/deployed from local staging; GitHub merge pending | Deterministic context/memory/response ranking in shadow only. October 5 staging was hash-deployed for GTA testing; fix the salience test-import defect, rerun the full suite, add grant-vs-consumption acknowledgement, then merge the corrected PS3 branch to `main` |
| PROXIMITY_CHAT / SOCIAL_ROUTING | 🔵 Architecture researched; not implemented | Route one player utterance through hearing/address/overhearing and responder arbitration without creating a second dialogue stack |
| SCENE_DIRECTOR | 🔵 Architecture researched; not implemented | NPC initiative and coordinated autonomous behavior built on perception, salience, social state and ACT capabilities |
| ACT0 / ACT1 — ACTIVITY FOUNDATION | 🟡 Implemented + post-review hardened on `feature/act0-act1-contracts-shadow-observer`; unmerged | Closed capability/contracts layer plus shadow observation/correlation. Needs reconciliation with current `main`, full post-hardening regression/build, then GTA shadow probes |
| ACT2 — BASIC PLAYER ACTIVITIES | 🟡 Implemented + post-review hardened on `feature/act2-player-assigned-basic-activities`; unmerged | F11 Follow/Wait/Sit/Resume lifecycle with pause/resume/cancel/status/history. Stacked on ACT0/1; full rerun and GTA gates still required |
| ACT3 — RICH PLAYER ACTIVITIES | 🟣 Architecture settled; next new ACT implementation after ACT2 gates | Approach/face, vehicles, short-range scenarios, walk-away, cover and optional item interactions with physical completion evidence |
| ACT4 / ACT5 — DIALOGUE + AI ACTIVITIES | 🟣 Planned from settled architecture | Activity-aware dialogue/interruption, then closed validated Luna activity proposals |
| ACT6 — NAVIGATION | 🟠 Research-gated | Add real `lsawalkto` / `lsadriveto` only after the required GTA navigation probes |
| ACT7 — COMMITMENTS / DIRECTOR INTEGRATION | ⏳ Blocked on later PS phases | Durable commitments/home anchor, Scene Director activity proposals and directed NPC↔NPC interaction; depends on PS5/PS6/PS7 |
| E7 | Planned | Full regression, soak testing, GTA acceptance and integrated long-session validation |

## Active development queue — October 4, 2026

The branch list is now large enough that branch existence must not be confused with roadmap status. The near-term queue is:

1. **PS3 correction / merge candidate** — PS3 was reconciled on local staging and hash-deployed in shadow for the October 5 GTA pass, but is not on GitHub `main`. The convergence audit found a duplicate test binding that caused 60 later tests not to load despite a green-looking summary; the corrected feature branch must rerun the complete suite, retain grant-vs-consumption acknowledgement semantics, then merge to `main`.
2. **ACT0/ACT1 reconciliation / merge candidate** — `feature/act0-act1-contracts-shadow-observer@5d11ee9` contains the closed activity contract and hardened shadow observer. It is unmerged and behind the later PS2/production-fix baseline. Reconcile first, run the full post-hardening Node/.NET/build matrix, then merge with ACT still default-off/shadow-only.
3. **ACT2 stacked merge candidate** — `feature/act2-player-assigned-basic-activities@1388954` is real implementation, not planning. It is stacked on ACT0/ACT1, so do **not** merge it first. After ACT0/ACT1 lands, rebase/reconcile ACT2, rerun its full matrix, and only enable individual capabilities after their GTA probes.
4. **Next new core implementation work** — after that consolidation, the PS track moves to **PS4 immutable dialogue knowledge**, while the ACT track moves to **ACT3 rich short-range activities**. These can proceed in parallel because they solve different problems.
5. **Independent UX/presentation side tracks** — `research/ux4-talk-target-selector@2ddb8ae` has T0A complete and an implementation-ready plan; `docs/conversation-gaze-engagement-plan@f20193f` has a bounded CGE0–CGE3 plan; `research/radio-track-perception-20261004@7f6ad8e` is implementation-ready research. None is a prerequisite for merging PS3/ACT0/ACT2.

Open PRs #3, #10 and #12 are research/evidence branches, not production runtime branches: remaining native context audit, perception/salience/Scene Director architecture, and Essential action-completion audit respectively. Their findings are inputs to the implementation branches; merging those PRs is not a prerequisite for the current runtime queue.

Historical feature branches for P1, P2, PS0/PS1, PS2 and UX0–UX3 should be treated as implementation history/reference now that their production equivalents are already on `main`; do not infer unfinished work merely because those branch refs still exist.

## GTA deployment / physical validation state — perception track

Keep this separate from implementation status:

| Phase | Repo status | Last recorded GTA deployment state | Physical GTA acceptance |
| --- | --- | --- | --- |
| PS0 / PS1 | Merged on `main` | Included in the later PS2 production payload lineage; intelligence configured in `shadow` for the recorded PS2 deployment | **Pending.** The full PS0/PS1 acceptance sequence has not been closed |
| PS2 | Merged on `main` | The reviewed PS2 payload at `5ea77f8` was deployed/installed before the later combined-source integration; shadow mode remained enabled | **Pending.** Witness/episode behavior needs a deliberate GTA validation pass. Player-speech hearing remains intentionally disabled |
| PS3 | Implemented; corrected feature branch remains unmerged | **Deployed in shadow from local staging on October 5; 73/73 staged files were hash-verified.** This deployment does not make PS3 merged | **Pending / in progress.** GTA acceptance must be recorded separately from deployment; the corrected full offline suite must also be rerun before merge |
| PS4+ | Not implemented | Not deployable | Not applicable yet |

The October 4 combined production-source integration on `main` passed offline regression/build validation but explicitly did **not** itself establish a new GTA deployment or controller/GTA acceptance record. Therefore "merged", "built", "installed" and "physically accepted" must remain separate states.

### Recommended next GTA perception milestone

Do not spend a full acceptance session certifying an older PS0–PS2 payload if PS3 is about to be reconciled. The preferred milestone is:

1. reconcile PS3 onto current `main`;
2. rerun its offline regression/build checks;
3. build one combined PS0–PS3 payload from current `main`;
4. make the normal verified rollback backup and deploy/hash-verify that exact payload;
5. keep intelligence in `shadow`;
6. run one structured PS0–PS3 GTA acceptance session.

That session should cover startup/host health, observer roster and lifetime behavior, firing edges, isolated player/NPC damage callback counts, injury/death versus disappearance, vehicle damage/entry/exit/seat transitions, stable location/activity transitions, dismiss/recreate and stale-anchor rejection, reconnect/restart behavior, PS2 witness/episode correlation, and PS3 decision/suppression counters. It must also confirm that shadow perception produces **no** new Luna turns, automatic memory writes, autonomous actions or playback interruption.

The separate source-time microphone/capture-receipt probe remains an independent gate for `speech_heard`. Until that exact begin/end linkage is proven, PS2/PS3 may validate other perception events in GTA while player-speech hearing stays disabled.

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

### E6 — Early segmented TTS — implemented

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

At the E5/E6 checkpoint, the offline suite passed **149 tests with 0 failures** ([checkpoint test output](../lsa-essential-e1-candidate/docs/e5-e6-test-results.txt)). Current `main`, including merged P0, passes **187 tests with 0 failures**. This includes `84df8e30` model-failure/PCM16 hardening and the production telemetry repair reproduced from the first failed E5/E6 GTA runs. The stock E6 integration test now exercises the real logger; physical GTA acceptance of the repaired build remains open.

The first repaired-build GTA run covered 13 microphone turns: all 13 reached native playback, 10 completed normally, and 3 were interrupted. TTS started slightly before model completion on eight eligible turns, but first PCM followed model completion; all replies contained one segment. See the [run review](E6-GTA-verification-2026-10-01.md). Multi-segment playback and audible early speech still need live verification.

The E5/E6 payload was also staged/installed for controlled GTA testing with backups and hash verification. However, the repository does **not** yet contain a post-deployment GTA log proving physical playback for the current E6 path.

#### E6 follow-up validation

The implementation phase is complete. Additional GTA stress validation should still cover:

- the first segment is audibly played before model completion on an eligible turn;
- later segments continue on the same logical native stream across real queue gaps;
- no premature successful `PlaybackEnded` occurs before final stream end;
- interruption/late model failure kills the exact generation without stale PCM or history;
- action-bearing turns remain buffered;
- final assistant history commits once and only after matching native playback completion.

Prior Phase 10B evidence (13 turns, 11 with audio/acknowledgements, observed PCM gap up to about 2.98 seconds) remains strong prior evidence for open-stream behavior, but it is not counted as validation of this exact E1.1/E6 runtime path.

E6 is considered complete for roadmap purposes. The remaining early-audio, multi-segment, interruption, and history checks are non-blocking regression evidence and belong with ongoing validation/E7 rather than holding E6 open.

See the [E5/E6 implementation status](E5-E6-implementation-status.md) for the current checkpoint, deployment distinction, and remaining GTA gate.

### P0 — Turn-scoped context snapshots and target-reference safety

P0 is merged to `main` and offline-verified. Each turn captures immutable actor, listener, actor-associated world, and P/V reference-map context before asynchronous provider work. Omitted listeners retain same-session state; explicit `null` clears it. Target aliases are checked against the reasoning-time snapshot and the latest actor reference map immediately before the unchanged stock dispatcher. GTA runtime acceptance remains pending; see the [P0 status and checklist](P0-turn-context-status.md). Those live checks validate the merged implementation but do not block beginning P1. E6's separate early-audio and multi-segment physical gate also remains open.

## NPC intelligence roadmap

After the provider/latency foundation is stable, development shifts from transport architecture toward persistent characters and autonomous behavior.

### P1 — SESSION_IDENTITY — Durable character identity

V1 is implemented and verified offline. Only a fresh explicit authored-owner ledger assertion resolves the structured `(worldProfileId, sourceNamespace, sourceKey)` alias to a durable UUID CharacterId. Ambient/PR/Nexus identity inference is not enabled. See [P1 implementation, pins, and controlled GTA checklist](P1-session-identity-status.md).

The companion persists aliases, revisions, and the actual character voice assignment. Runtime bindings, incarnation/adapter epochs, ped/session/turn/generation IDs, connections, and bounded dialogue history stay in RAM. A recreated character can retain its UUID/voice but always starts a fresh native session/history. All effects remain addressed by Essential's exact native tuple; stale work never redirects to a character's newest ped.

The feature defaults off and supports shadow metadata verification before character voice adoption at a clean session boundary. Invalid/unsupported storage or unavailable optional evidence leaves ordinary ephemeral dialogue usable. Known identity/incarnation contradictions retire the affected exact session. No fuzzy matching, auto-merge, binding theft, persistent memory, relationships, personality, or goals are included.

P1 is considered implemented and complete for roadmap purposes. Additional recreation, revocation, persistence, and stale-work stress cases remain valuable regression coverage and should roll into E7. Later character state must build on owner-authenticated aliases, never raw handles.

### P2 — PROMOTED_CHARACTERS / CHARACTER_PROFILE

P2 is implemented and merged to `main`. GTA testing has confirmed the corrected RAGE host path, console registration, `LSACharacters`, `LSAPromote`, persistent character creation, the local editor, profile/memory editing, and working native vehicle/driver behavior. Follow-up fixes in PRs #7–#9 corrected the active RAGE AppDomain host and loader-owned console-command registration. It provides bounded application-assigned encounter names/voice profiles, explicit idempotent promotion through P1 authored ownership, independent versioned profiles keyed by CharacterId, biography/personality/relationship/notes editing, durable manual memory CRUD/selection, safe summon/recreation and a local character editor.

The optional RAGE owner plugin uses existing Essential selection, follow/wait, focus and vehicle-state seams. It guards missions/cutscenes/script ownership and suspends optional behavior conservatively, without a second TASK scheduler or automatic mission rejoin. Only addon-created peds can be explicitly deleted; dismissal never erases a character. The canonical P1 identity/voice schema and exact native dialogue/audio/action tuple remain unchanged. Appearance recreation is limited to supported standard model/components/props; exact freemode/third-party customization remains unclaimed.

The architecture now splits into two parallel tracks after P2:

```text
P0 TURN_CONTEXT
  → P1 SESSION_IDENTITY
  → P2 PROMOTED_CHARACTERS / CHARACTER_PROFILE
        │
        ├─→ PS0/PS1 PERCEPTION FOUNDATION
        │      → PS2 WITNESS / EPISODE CORRELATION
        │      → SALIENCE
        │      → PROXIMITY_CHAT / SOCIAL_ROUTING
        │      → later knowledge / memory / SCENE_DIRECTOR phases
        │
        └─→ ACT0 CONTRACTS / CAPABILITIES
               → ACT1 SHADOW OBSERVATION
               → ACT2 BASIC PLAYER ACTIVITIES
               → ACT3 RICH SHORT-RANGE ACTIVITIES
               → ACT4 DIALOGUE AWARENESS
               → ACT5 MODEL PROPOSALS
               → ACT6 NAVIGATION EXTENSIONS
                       │
                       └───────────────┐
                                       ↓
                 later PS5 / PS6 / PS7 → ACT7
                                       ↓
                                      E7
```

The PS track answers **what NPCs perceive, know and care about**. The ACT track answers **what NPCs can reliably and verifiably do**. They can advance in parallel through ACT6; Scene Director eventually consumes both.

P2 supplies the durable foundation, not automatic memory extraction, event perception, salience ranking or autonomous coordination. See [implementation, file formats and follow-up GTA checklist](P2-promoted-characters-status.md), [focused pinned native evidence](P2-native-evidence.md), and [offline verification](../lsa-essential-e1-candidate/docs/p2-verification.md). One observed follow-up regression target is order-dependent vehicle entry: driver-seat/drive behavior works, but companion entry can depend on whether the NPC receives the vehicle command before the player claims/enters the vehicle.

### PERCEPTION — Richer world and event awareness

Current status: PS0/PS1 are merged to `main` in default-off shadow form. PS2 witness rules and episode correlation are merged to `main`, together with the deployed injury, report and harm correlation fixes. The PS2 branch deliberately keeps player-speech hearing unavailable until a source-time native mic/capture receipt can be proven in GTA; post-STT proximity is not accepted as evidence that an NPC heard an earlier utterance.

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
- meaningful vehicle/object state;
- player speech as an audible event, including who could physically hear it based on distance, line of sight/occlusion, local context and conversation membership.

Perception should expose facts, not decide behavior. For speech, the perception layer should answer **who could hear this utterance?**, not who should respond.

### PS3 — SALIENCE — Decide what matters

**Current status:** PS3 has been implemented and reconciled in local staging and was hash-deployed in shadow on October 5, but it is still not merged to GitHub `main`. The convergence audit found and corrected a test-import defect plus the distinction between response entitlement and actual consumer acknowledgement on the pushed PS3 feature branch. PS3 still creates no turns, actions, memory writes, playback changes or native authority. Its relationship/memory/trait branches remain inactive until the shared authenticated `captureRef → CharacterId/profile` seam exists. Full corrected offline verification and physical GTA acceptance remain gates before/alongside merge.

A richer perception system can produce far more information than a model should receive every turn.

Salience should rank/filter observations based on factors such as:

- immediacy;
- threat;
- relationship;
- recency;
- current goals/activity;
- prior memory;
- direct relevance to the player or current conversation;
- direct address cues such as a character's name, gaze/facing, active conversation membership, group-address language and whether the NPC merely overheard the utterance.

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

After PS3, the settled PS implementation sequence is:

- **PS4 — immutable dialogue knowledge:** freeze observer-safe observations/profile/memory inputs at turn start and rebuild Luna-facing narrative context from an allowlist rather than leaking raw backend facts.
- **PS5 — automatic experiential memory:** add the explicit P2 profile-schema migration and bounded provenance-aware event-memory writer; no direct model writes to storage.
- **PS6 — ticketed passive initiative:** allow bounded NPC warnings/reactions through Essential's existing special-turn lifecycle, with no physical action authority.
- **PS7 — multi-character / directed exchange:** add bounded NPC↔NPC and shared-conversation coordination on top of the same evidence, salience and ticketing contracts. Scene Director proposes interactions; ACT7 owns physical directed-interaction execution under the ACT lease.
- **PS8 — broader verified events/actions:** expand producers only where native/GTA evidence has been physically validated.

### PROXIMITY_CHAT / SOCIAL_ROUTING — Shared spoken-space conversation

Proximity chat should be implemented as a consumer of **PERCEPTION + SALIENCE**, not as a separate dialogue stack. The player speaks once; LSA transcribes once; nearby NPCs are classified as addressed listeners, possible responders, or overhearers using the same world-awareness infrastructure that later feeds SCENE_DIRECTOR.

Target flow:

```text
player mic / PTT / later optional VAD
        ↓
STT once
        ↓
PERCEPTION: who could physically hear it?
        ↓
SALIENCE / attention: who notices or cares?
        ↓
SOCIAL_ROUTING: who was addressed, who overheard, who may respond?
        ↓
existing P2 character-authority + reasoning/action pipeline
        ↓
overhearing / conversation events return to perception and later memory/director systems
```

Core rules:

- do not require the player to mark an NPC before ordinary nearby conversation;
- do not run independent STT for each NPC;
- do not blindly fan one utterance out into simultaneous model/TTS turns for every nearby ped;
- use native spatial facts such as distance, line of sight/occlusion, facing/attention and current conversation membership to build the hearing set;
- use explicit names, gaze/facing, active conversation state, group-address language and semantic relevance to distinguish **addressed** NPCs from **overhearers**;
- arbitrate responders so one clear speaker normally answers first, while allowing later multi-character exchanges where appropriate;
- overhearers should receive a factual perception event even when they do not speak, allowing later salience, memory, relationship or Director behavior to use what they heard;
- promoted-character canon remains authoritative for personality/willingness and Essential/native validation remains authoritative for actual action capability;
- keep the existing turn/generation/playback lifecycle; proximity routing selects participants, it does not create a parallel conversation engine.

This phase is intentionally before SCENE_DIRECTOR because it establishes reusable social-scene state: who is present, who heard what, who was addressed, who is engaged, who responded, and who merely observed. SCENE_DIRECTOR should consume that state rather than rebuilding its own hearing/attention model.

### SCENE_DIRECTOR — NPC initiative and coordination

This phase moves beyond primarily player-triggered interaction.

Target behavior:

```text
NPC perceives event / social exchange
      ↓
salience says it matters
      ↓
proximity/social state identifies participants and attention
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

### CUSTOM ACTIONS / ACTIVITIES — ACT0 through ACT7

The October 4 activity/goal-execution research changes this from one late roadmap phase into a **parallel execution track** that can start now. ACT0–ACT6 do not depend on Scene Director. Player-assigned activities can ship through the existing F11/native-menu UX first; later Luna and Scene Director reuse the exact same validated machinery instead of inventing separate action paths.

Authoritative flow:

```text
F11 / player command / later Luna / later Scene Director
        ↓
closed ActivityIntent + typed slots
        ↓
deterministic activity template
        ↓
closed capability registry
        ↓
native StepRunner
        ↓
Essential queue / wrapper / registered extension
        ↓
physical evidence + ActionReceipt
        ↓
continue / retry / recover / pause / cancel / finish
```

Essential remains the executor. ACT owns planning/lifecycle and native evidence around one step at a time; it does not become a competing GTA TASK scheduler.

#### ACT0 — Contracts, registry and metadata

**Status: implemented on the unmerged ACT0/ACT1 branch.** The closed activity vocabulary, capability registry, native/companion contracts and metadata verification are present on `feature/act0-act1-contracts-shadow-observer@5d11ee9`. The branch includes post-review hardening and now needs reconciliation with current `main` plus the full post-hardening regression/build run before merge.

#### ACT1 — Native shadow observer

**Status: implemented on the same unmerged branch; GTA gates open.** The activity channel, StepMachine/receipt correlation and supersession observation exist in shadow mode and do not dispatch new gameplay actions. Post-review hardening moved state mutation back onto the owner/update fiber, tightened reconnect/sequence handling and bounded diagnostics. GTA probes still need to pin callback names/counts/threading before ACT is considered production-validated.

#### ACT2 — Player-assigned basic activities

**Status: implemented on `feature/act2-player-assigned-basic-activities@1388954`; stacked on ACT0/ACT1 and not merged.** The branch adds the real F11 activity lifecycle for `hold_position`, `follow_person`, `resume_ambient` and `sit_on_ground`, plus status, history, pause, resume and cancel. It includes post-review hardening for lease sequencing, runtime ticking, owner-before-dispatch, strict frame validation, hold anchors and paused-state visibility. Historical green test counts predate the latest hardening, so the complete regression/build matrix must be rerun after reconciliation. Individual physical capabilities remain probe-gated and default-off.

#### ACT3 — Rich short-range world activities

**Status: next new ACT implementation after ACT2 is reconciled and its prerequisite gates are understood.** Add tested capabilities such as approach/face, enter/exit vehicle, short-range scenarios, walk-away/leave-scene, bounded cover and optional item interactions. Menu pickers mint validated temporary references rather than passing raw GTA handles.

#### ACT4 — Dialogue awareness and interruption hardening

**Status: planned from settled architecture.** Expose bounded current-activity context to dialogue and make conversation interruption/resume deterministic. An NPC can know what it is doing and why it stopped without claiming unverified physical completion.

#### ACT5 — Model-proposed activities

**Status: planned from settled architecture.** Luna may propose only closed activity intents for the current promoted actor. Existing P0 target-reference validation and action publication fences remain authoritative; the model never supplies coordinates, natives, handles, registry names or arbitrary step lists.

#### ACT6 — Navigation extensions and places

**Status: research-gated.** Static analysis proved Essential Hotfix #3's apparent `walktodestination`, `drivetodestination` and activity-queue state are vestigial. Real destination travel therefore needs separately registered `lsawalkto` / `lsadriveto` extensions, enabled only after the navigation/vehicle GTA probes demonstrate they coexist safely with Essential and installed vehicle mods.

#### ACT7 — Commitments, home anchor and Director integration

**Status: blocked on later PS phases.** Add durable commitments/home anchor, Scene Director activity proposals and directed NPC↔NPC interaction only after the required PS5/PS6/PS7 contracts exist. Commitments remain descriptive across restart; they never silently auto-execute on reload/summon.

#### Initial capability progression

ACT2 starts with wait/hold, follow, ambient resume and sit. ACT3 adds approach/face, vehicle entry/exit, scenarios such as smoke/coffee/phone/lean/bench, walk-away, cover and optional item transfers. ACT6 adds true arbitrary walk/drive-to waypoint/place behavior. Offensive combat, weapons, policing/hostage verbs and other unsafe/high-conflict families remain excluded until separately designed and gated.

The ACT research also corrected an important prior assumption: **handler acceptance is not physical completion**. ACT therefore records native `ActionReceipt` progression and uses capability-specific world evidence before reporting arrival/completion. This same evidence layer will later support perception, memory, Luna planning and Scene Director without falsely remembering that an accepted action actually happened.

## E7 — Full regression and GTA acceptance

E7 is the integrated product-level acceptance phase.

It should cover more than isolated happy-path conversations:

- long play sessions / soak tests;
- multiple NPCs and rapid speaker switching;
- proximity hearing/address resolution, overhearing, group-address routing and responder arbitration;
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
