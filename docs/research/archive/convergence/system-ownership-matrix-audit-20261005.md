# System ownership matrix

Part of the [system convergence architecture](system-convergence-architecture.md) research package (`research/system-convergence-architecture-20261005`, base `origin/main@8c63b20`). Research only.

**Rule:** every concept has **exactly one authoritative owner**. Other systems may *observe*, *request* or *decorate*, but they may not mutate the owner's state except through the owner's own seam.

**Flags**

- **CLEAN**: single clean owner.
- **LAYERED**: shared but intentionally layered; each layer owns a distinct slice.
- **DUPLICATE**: two systems claim the same authority. High priority.
- **MISSING**: no owner exists.
- **AMBIGUOUS**: an owner exists, but its semantics are unclear or drift.

**Evidence labels:** PROVEN · STRONGLY SUPPORTED · INFERRED · PROPOSED · UNKNOWN (definitions in the main report).

**Planes:** 0 GTA/scripts · 1 Essential · 2 LSA native adapters · 3 companion · 4 UX loader · 5 providers.

---

## 1. Required concerns

| # | Concern | Required question | Authoritative owner (plane) | Other participants (role) | Flag | Label | Evidence / notes |
|---|---|---|---|---|---|---|---|
| 1 | GTA Ped/entity lifetime | Who owns current native validity? | **GTA engine** (0) for existence, then **Essential** `NpcStateStore` for Essential state (1), then each LSA anchor validates wrapper + full handle + `MemoryAddress` + owner incarnation (2) | P2 `Encounter`, PS `EntityAnchors`, ACT capture table, UX4 frozen peds (validators) | **LAYERED**, but the LSA layer itself is DUPLICATE (row 35) | PROVEN | PS0/PS1 status (anchor rules); `ActivityDispatch.cs:159` (`AnchorLive`); UX4 address checks |
| 2 | Durable character identity | Who owns CharacterId? | **P1 `CharacterRegistry`** (3) | P2 references it; editor displays it | **CLEAN** | PROVEN | Only fresh authored-owner proof resolves an alias to a UUID (P1 status) |
| 3 | Runtime binding | Who binds CharacterId to the current incarnation? | **P1 `RuntimeBindings`** (3), from native **owner evidence** (2) | P2 registration supplies `incarnationId`/`OwnershipToken` | **CLEAN** (layered evidence) | PROVEN | Heartbeat 250 ms, lease 1.5 s, revoke; `(pedId, sessionNonce) → CharacterId` |
| 4 | Conversation target | Who owns the selected physical NPC? | **Essential `PlayerConversationPed`** (1) | Writers: Essential Talk/Text/MarkedTalk; UX4 at committed PTT start. Readers: F11, P2 `current`, PS discovery, CGE plan | **DUPLICATE** (planned): UX4 also *clears* it at PTT stop | PROVEN (code `3dadbcf`); impact INFERRED | `TalkTargetSelector.cs:118-131,289-297`; fix: §4.3 of the main report |
| 5 | UX target | Is it the same thing or a separate selection? | **UX4 `TalkTargetPolicy`** (2/4): a *proposal* that commits into row 4 | F11 Current NPC is a *view* of row 4 | **LAYERED** | PROVEN | Preview/cycle never call the setter (T0 audit, UX4 code) |
| 6 | Speech capture | Who owns start/end? | **Essential mic core** (one active mic Ped) (1) | UX4 is an input *source*; respects `mic_busy` and stops only its own mic (`EssentialMicState`, `3dadbcf`) | **LAYERED** | PROVEN | Hotfix #3 API (`SendMicStart/Stop`, `BeginMicTurn/MarkMicReleased`); `EssentialMicState.cs` |
| 7 | STT transcript | Who creates the canonical utterance? | **Companion turn pipeline** (3): one STT per Essential mic turn | PS `SharedTranscriptStore` receives text with `receipt: null` | **CLEAN** for text; **MISSING** utterance identity (row 43) | PROVEN | `runSequentialTurn.mjs:187` |
| 8 | Hearing | Who decides which NPC could hear it? | **PS2 native acoustic/witness sampling** (2) through `SpeechCaptureReceipt` | — | **MISSING in practice**: producer gated `unsupported_capture_receipt` | PROVEN (gate) | `contracts.mjs:46`, `capabilities.playerSpeech===false` |
| 9 | Social address | Who decides who was addressed? | none | Implicit today: the mic Ped is the addressee | **MISSING** | PROVEN | Social routing is research only (ROADMAP) |
| 10 | Responder selection | Who decides who may answer? | none for extra responders. The primary responder is implicitly the mic Ped's turn (Essential) | Future: social routing (PS7) + Director tickets | **MISSING** (`C-12`) | PROVEN | Turn-yield behavior **UNKNOWN** |
| 11 | Turn identity | Who creates turn/generation/session IDs? | **Essential** (1) | Companion keys all work by the tuple | **CLEAN** | PROVEN | E1 rules (ROADMAP) |
| 12 | Turn context | Who freezes knowledge for reasoning? | **P0 snapshot** (3), captured at turn start | P1/P2 `prepareTurn` decorate (canon projection) | **CLEAN** (snapshot); knowledge *content* see row 16 | PROVEN | `turnSnapshot.mjs`; `openaiConnection.mjs` prepareTurn |
| 13 | Perception | Who creates raw factual evidence? | **PS native sensors** (2) on Essential Update, reusing `PerceptionSystem.TryGetSnapshot` and Essential callbacks | Radio sampler (branch), ACT samplers (branch) | **CLEAN** (must stay one sampler family) | PROVEN | `IntelligenceIntegration.cs:206` |
| 14 | Witness | Who decides what a specific NPC perceived? | **PS2 `WitnessPolicy`** (2), a pure function over source-time geometry | Companion `EpisodeCorrelator` admits only witnessed/reported | **CLEAN** | PROVEN | `WitnessPolicy.cs`; executor callbacks are never witnessed |
| 15 | Salience | Who ranks admissible facts? | **PS3 `salienceEngine`** (3) | Director (future) consumes it | **CLEAN**. Consumption semantics MISSING (row 44) | PROVEN (stage `101b212`) | Ranks only; decision keys closed |
| 16 | Model knowledge | Who constructs Luna-visible context? | Today: `essentialDecision.buildRequest` (raw JSON) **and** the P2 canon projection. Planned: PS4, the ACT4 block and a radio selector | — | **DUPLICATE** | PROVEN | `essentialDecision.mjs:56-59`; P2 status §projection; ACT research file table; radio research §10. Canonical: PS4 `TurnKnowledgeFrame` (`C-04`) |
| 17 | Memory | Who persists experience? | **P2 `ProfileStore`** (3). Manual writer: editor. Automatic writer: PS5 (planned) | — | **CLEAN** store; automatic writer not built | PROVEN | `profileStore.mjs` (schema 1) |
| 18 | Relationships | Who owns relationship state? | **P2 profile** (3): relationship text and `relationship` memories; PS7 edges planned in P2 | — | **AMBIGUOUS** until v2 defines narrative vs structured edges | PROVEN (store) / PROPOSED (edges) | `C-08`, `C-15` |
| 19 | Goals | Who owns desired outcomes? | **ACT engine** (3) (RAM goals, deadlines) | — | **CLEAN** (branch) | PROVEN (ACT2 branch) | `activityEngine.mjs` |
| 20 | Activities | Who owns multi-step execution plans? | **ACT engine** (3) | Native `StepRunner` owns the current step (row 21) | **LAYERED** | PROVEN (branch) | ACT research §5 |
| 21 | Physical step | Who owns the currently executing step? | **Native `StepRunner`** (2) | Lease from the engine (`leaseId`, `leaseEpoch`) | **CLEAN** (branch) | PROVEN (branch) | `StepRunner.cs` |
| 22 | GTA task | Who ultimately tasks the ped? | **Essential executor** (1), then GTA (0) | ACT, P2 and dialogue `DO` *request* through the queue/wrappers | **CLEAN** | PROVEN | N8 (exclusive control, command generation bump) |
| 23 | Action receipt | Who decides execution state? | **StepRunner** for ACT steps (2). **None** for dialogue `DO` and P2 controls | Essential callback (`OnNpcActionExecuted`) is raw input | **MISSING** for dialogue actions (`C-05`) | PROVEN | `runSequentialTurn.mjs:326` vs `:367` |
| 24 | Completion | Who establishes physical completion? | **ACT completion adapters** (2) on sampled physical evidence | — | **CLEAN** for ACT; **MISSING** for dialogue actions | STRONGLY SUPPORTED (adapters per capability) | ACT research §6; N12 approach strings |
| 25 | Initiative | Who proposes autonomous behavior? | **Scene Director** (3, planned): speech tickets + activity proposals | Essential reflex = native self-preservation (not "initiative") | **CLEAN** (planned) | PROPOSED | PS/SD research §9 |
| 26 | Physical arbitration | Who decides whether an activity may run? | Tiered: **GTA/scripts** (0) > **Essential gates** (1: reflex, DI, queue gates) > **ACT engine/StepRunner lease and priority** (3/2) | P2 guards (`Safe()`), Director (proposer) | **LAYERED** | PROVEN (branch) / PROPOSED | §8.2 of the main report |
| 27 | Speech arbitration | Who decides whether autonomous speech may start? | **Essential** (playback/turn lifecycle) (1) + **Director admission** for optional speech (2/3, planned) | — | **LAYERED** | PROVEN / PROPOSED | `CancelIfPlayerStartsTurn`, `SkipIfSpeakerBusy` (PS/SD research) |
| 28 | Gaze | Who owns temporary visual attention? | **Essential `ConversationLookBehavior`** (1) during mic and playback | CGE plan (2) as an overlay | **DUPLICATE** (planned): the CGE plan never mentions Essential's look behavior | PROVEN (docs/API) | Hotfix #3 API §`ConversationLookBehavior`; CGE `runtime-contract.md` |
| 29 | Profiles | Who owns durable character canon? | **P2** (3) | Editor (UI) | **CLEAN** | PROVEN | P2 status |
| 30 | Commitments | Where do durable obligations live? | **P2 profile** (`commitments[]`, ACT7, planned) | Manual `promise` memories overlap | **AMBIGUOUS** until v2 | PROPOSED | ACT research line 1176 |
| 31 | Save/timeline | Who prevents future memories entering an earlier save? | none | Clock-regression resets protect only RAM state | **MISSING** (`C-07`) | PROVEN | Identity design review survival table |

## 2. Additional concerns found by this audit

| # | Concern | Owner | Flag | Label | Evidence / notes |
|---|---|---|---|---|---|
| 32 | Voice | **P1** `voiceAssignment` (resolution `voiceResolver.mjs:18`) | **DUPLICATE (display)**: P2 `voiceReference` (`characterService.mjs:121`) | PROVEN | P3 cleanup: derive the display from P1 |
| 33 | Dialogue history | **Companion** (E1 rules: player input once, assistant after matching `PlaybackEnded`) | **CLEAN** | PROVEN | GTA run 2026-10-01 confirmed the commit rules |
| 34 | Playback / interruption | **Essential** | **CLEAN** | PROVEN | — |
| 35 | Run-local entity reference | PS `EntityAnchors` (intended canonical by ACT research §9.4) | **DUPLICATE**: ACT2 private captures (`ActivityDispatch.cs:22-25`), P2 `Encounter.Address` | PROVEN | `C-02` |
| 36 | Clock / world epoch | none | **DUPLICATE** detectors: P2 `ResetForClockDiscontinuity`, PS `clock_reset`, ACT `ClockReset`, per-pipe epochs | PROVEN | `C-13` |
| 37 | Action-callback vocabulary | Essential (canonical tokens, N5) | **DUPLICATE** interpretations: PS1 `follow/wait` vs ACT `followtarget/waithere` | PROVEN | Fix on the ACT0/1 branch only |
| 38 | LSA-side primary-behavior token | P2 `Encounter.Mode` | **AMBIGUOUS**: becomes `idle` after `DETACHED`/`SUPERSEDED` while the Essential mode continues; dialogue `DO` is not reflected | PROVEN | `C-06` |
| 39 | LSA-initiated directed interaction | PS7 Director admission (PS/SD research) **and** ACT7 capability (ACT research/registry) | **DUPLICATE** (planned); also P2 `Safe()` self-suspension | PROVEN (docs) | `C-11`: ACT7 owns it |
| 40 | Body orientation (face/turn) | ACT3 `stop_and_face` **and** CGE2 body turns (plan) | **DUPLICATE** (planned) | PROVEN (docs) | Fold CGE2 into ACT |
| 41 | Capability / health state | none | **MISSING** (each subsystem decides) | PROVEN | `C-09` |
| 42 | Configuration | Three files | **DUPLICATE** keys: `worldProfileId`, `intelligence.mode` (+radio) in native and companion configs | PROVEN | `C-09` read model; single source per key |
| 43 | Utterance identity | none | **MISSING** | PROVEN | `C-01` |
| 44 | Salience consumption | PS3 marks consumed at grant | **MISSING** consumer acknowledgement | PROVEN | `C-03` |
| 45 | Player / protagonist identity | none | **MISSING** (identity research line 216) | PROVEN (absence) | `C-15` |
| 46 | Conversation identity (`conversationRef`) | none (PS2 receipt field optional; Essential has interaction ids for DIs) | **MISSING** | PROVEN | Allocated by social routing (PS7), RAM |
| 47 | Typed-input target | Essential `TextInputService` (recomputes best ped) | **AMBIGUOUS** relative to the UX4 selection | PROVEN (documented limitation) | HUD disclosure; follow-up |
| 48 | Seat / vehicle resource across LSA actors | none | **MISSING** | INFERRED | ACT3 seat-claim table |

## 3. Duplicate authorities (high priority)

| ID | Concept | Duplicate owners | Canonical owner | Fix | Phase |
|---|---|---|---|---|---|
| DA-1 | Conversation-partner lifetime | Essential vs UX4 (clear on stop) | Essential | Remove the UX4 clear | Before the UX4 merge |
| DA-2 | Model-visible context | stock JSON, P2 projection, planned PS4, ACT4 and radio | PS4 `TurnKnowledgeFrame` | `C-04` | PS4 |
| DA-3 | Run-local entity references | PS anchors, ACT captures, P2 `Encounter` | Shared `EntityAnchors` service | `C-02` | Before ACT3/PS4 |
| DA-4 | LSA-initiated directed interaction | PS7 admission vs ACT7 | ACT7 (lease) under Director proposal | `C-11` | ACT7/PS7 |
| DA-5 | Gaze | Essential look vs CGE | Essential; CGE is a yielding overlay | Plan amendment | Before CGE0 |
| DA-6 | Body orientation | CGE2 vs ACT3 | ACT3 `stop_and_face` | Fold | Before CGE2/ACT3 |
| DA-7 | Clock/world epoch | P2, PS, ACT, pipes | P2 host world-epoch broadcast | `C-13` | ACT0/1 reconciliation |
| DA-8 | Action-callback vocabulary | PS1 vs ACT | Essential canonical tokens | Contract test | ACT0/1 reconciliation |
| DA-9 | Voice (display) | P1 vs P2 `voiceReference` | P1 | Derive | Cleanup |
| DA-10 | Config keys | native vs companion configs | One source per key | Read model | With `C-09` |

## 4. Missing owners

Social address (9), responder selection (10), timeline/save (31), utterance identity (43), salience consumption (44), dialogue-action receipts and completion (23/24), capability/health (41), protagonist identity (45), conversation identity (46), cross-actor seat claims (48), and hearing in practice (8, gated).

## 5. Physical-control channels for a promoted NPC

One owner per channel at any instant. "Yields to" lists who takes the channel away.

| Channel | Current owner (when active) | Yields to | Never allowed |
|---|---|---|---|
| Primary locomotion/task | Whichever of {mission script, foreign mod, Essential reflex, Essential DI, Essential executor command from P2/ACT/dialogue `DO`, Essential ambient/resume, Rockstar ambient} is highest in the tier list (main report §8.2) | Any higher tier | Two LSA sources believing they own it; LSA tasking peds outside Essential's queue/wrappers/stop APIs; LSA clearing tasks broadly |
| Secondary / compatible animation | Essential behaviors and scenarios (`UseScenario*`, ACT3) | Primary owner changes | CGE issuing animation tasks |
| Gaze (head/eyes) | Essential `ConversationLookBehavior` (mic look; speaker look keyed to the turn) → otherwise CGE (planned) | Reflex, scenario/vehicle constraints, Essential look | CGE calling `ClearPedTasks*` or setting heading |
| Speech | Essential playback lifecycle | Player input (barge-in), Essential interruption | Any LSA system playing audio outside the authorized tuple |
| Observation | PS (read-only) | — | Observation mutating any of the above |
