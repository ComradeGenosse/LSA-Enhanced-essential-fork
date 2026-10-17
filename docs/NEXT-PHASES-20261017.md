# Development work packages and acceptance gates — October 17, 2026

**This is the implementation queue, not a new architecture.** Start at [ROADMAP.md](ROADMAP.md) for priorities and [IMPLEMENTATION-STATUS-20261017.md](IMPLEMENTATION-STATUS-20261017.md) for verified scope. Recheck main beyond c9ad717a and open PRs before changing code. Use the existing [master technical plan](research/UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md), [C-01–C-15 contracts](research/system-contract-register.md), ACT registry and preserved Memory K/EA specifications. Work on independent, reviewable PRs; **do not put new task runners or model schedulers alongside Essential**.

**Acceptance rule for every task:** demonstrate the change in source, merge only after code review and scoped tests, then separately record installed matching binary and actual GTA evidence. An offline test is not a physical proof. Unsupported native hooks should block the capability, not become guessed behavior.

## Immediate — mainline reliability and PR inventory

| ID | Task / exact scope | Ready / dependency | Acceptance and exclusions |
| --- | --- | --- | --- |
| R-01 | **Exact-head deployed baseline**: record main/native DLL/companion/version hashes, actual experimental switches and a one-page regression manifest; run current E1→Luna→ElevenLabs player talk, radio, PS4 gunfire and PS6 spontaneous speech. | Ready now. | Observe actual playback start/end, exact speaker owner and PS4 evidence. Record negative player priority and STT interruption. No enabled claim merely from defaults. |
| R-02 | **#231 D03 and M5 natural correction**: accepted bytes survive temporary readiness-sample stall under the *same* D02 lease; ask about four dog names; correct “Nora” to “Nara”, verify source revision, SQLite receipt and refreshed Luna PS4 view. | Ready, first capture R-01 build/hash. | Never rescue input with no D01 acceptance; never commit after genuine D02 revocation or owner/timeline change. Multiple corrections remain idempotent. |
| R-03 | **#220/#227/#229 factual recall + voice cutoff**: compare verified player facts to old repeated NPC replies; interrupted first ElevenLabs reply followed by “what were they, you got cut off?” must retrieve the original authenticated player question without inventing that unheard NPC sentence as memory. | Ready in parallel with R-02. | Bounded same-character/world/timeline recall, correct 4-name answer from accepted facts, exact PCM16 odd split, early abort, pause and no assistant history before completed playback. |
| R-04 | **#219 M3, #214 PS6 and #225 PS4 native cases**: native reconnect without permanently suspended coverage; collision versus gunfire, near/inside vehicle crash, witnessed injury/death and delayed body discovery; inspect PS3 grants and PS4 C-04 frame. | Ready in parallel. | Distinguish native source callback from inferred witness; no stale grant/unknown owner; no generic undocumented threat claims. |
| R-05 | **#230 M7 / #213 M9 gated rollout**: verify M7 pricing + explicit persistent opt-in + W07 authenticated native/backend joint idle with no paid call on uncertainty; verify explicit M9 native build flag/producer and once-only callback. | Source ready; require validated current Windows build and consent before paid action. | Cancel on any active Core/player/Director turn, changed host/NPC, revoke; preserve cost ceiling, durable queue. M9 unknown witness never becomes memory. |
| R-06 | **Open PR triage**: [#37 hearing](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/37), [#35 ballistics](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/35), [#47 local STT](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/47), [#50 standalone](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/50), [#222 gesture docs](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/222). | Ready independently; no blind retarget/merge. | Audit each diff relative to latest main. #222 old integration base and #226 overlap; #47 Qwen base; #50 explicit standalone isolation. Preserve closed superseded PRs as history. |
| R-07 | **E7 bounded smoke/soak plan**: performance/quality counters for concurrent NPC conversations and optional features, failure injection, native pipeline backpressure, provider cost, memory growth/reconnect, fallback and install rollback. | Define now; execute after selected enabled systems stabilize. | Named scenarios with saved build hashes and pass/fail or "not run", no manufactured score/percentage. |

## Next — ACT3 then ACT4/ACT5; presentation probes independently

### ACT3-A — one real stop-and-face capability

**Status:** ACT0–ACT2 runner/leases and the ACT3 row already exist, but ACT3 is not a runtime-complete feature. [Capability registry](../contracts/activity-capabilities.v1.json) labels stop_and_face ACT3 and [companion registry](../lsa-essential-e1-candidate/src/activities/capabilityRegistry.mjs) parses it. [intentTemplates](../lsa-essential-e1-candidate/src/activities/intentTemplates.mjs) is closed to four ACT2 intents, while native [StepRunner](../native/activities/StepRunner.cs), [CapabilityTable](../native/activities/CapabilityTable.cs) and [Essential world adapter](../native/activities/ActivityWorld.cs) still need ACT3-specific physical handling and truthful completion rules.

**Implementation** (single targeted PR):
1. Establish exact existing Essential stopandfacetarget handler signature, actual current-target anchored ped/address, stock conversation/ACT ownership and preflight; **do not add another scheduler**. Keep current ACT2 paths unchanged.
2. Add one closed player-approved intent to the ACT plan builder and capability exposure only where the native hello/capability probes certify dispatch on this build. Keep source identity, target reference, lease/generation and policy requirements from registry.
3. Implement any missing native mapping/dispatch/stop and owner-fiber outcome interpretation using current StepRunner/ActivityWorld/CompletionAdapters; prevent handler-accepted from masquerading as genuinely facing the target.
4. Apply current supersession and cancellation: mic/text, foreign script/reflex, combat, ped retirement, world reset, target loss and two rapid commands cannot leave an unowned turn/task or stale completion.
5. Add focused native/Node positive/negative tests, production Windows build, then GTA observe target acquired + rotation and cleanup. If Essential already performs a similar action through direct Luna commands, *reuse the same native capability*, don't duplicate dispatch.

**Gate:** one supported exact actor/target and physically observed result, plus rejected stale/wrong actor and player priority. A contract row, hello capability or test mock alone does not close it.

### ACT3-B — approach-person; ACT3-C–F capability expansion

Following accepted ACT3-A, add **approach_person** with actual target proximity/arrival (historical plan warns an Essential “approach finished” signal can be medium evidence; require verified distance). Then independent slices for **vehicle seat entry/exit**, **scenario_here/scenario_at**, **walk-away/cover**, **held-item exchange** and **follow_vehicle/begin_driving** where stock handlers and proof allow. Verify vehicle anchor/seat occupancy, scene/position evidence and termination; report unsupported registry-only commands as deferred.

**Existing design:** [master plan §7.2](research/UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md#72-act3-act4-and-act5-are-separate-deliverables), [ACT2 state machine](ACT2-status.md), [native action audit](research/domains/essential/essential-action-execution-completion-audit.md) and [activity-domain index](research/domains/activities/README.md).

**Hard boundaries:** do not implement chase_person or vestigial perform_activity as an arbitrary ACT3 ability; do not confuse entering a player vehicle via existing Essential follow/vehicle commands with implementing all of ACT3.

### ACT4 — activity-aware requested dialogue

**Dependency:** reliable ACT0/2 facts and at least accepted ACT3-A for body-facing actions; PS4 single writer and C-05/C-06 truth. A narrowly scoped ACT4 pass can start with proven ACT2 modes while other ACT3 extensions continue.

**Implementation:** from the existing ActivityFacts, ActivityKnowledge, native primary owner state and StepRunner receipts, freeze an owner/time/lease-scoped self-view into the one PS4 request: what Nathan is doing, paused, awaiting response, physically complete, failed or unknown. Reconcile normal talk with the ACT lifecycle without clearing held tasks, and keep resume conditional on exact live lease, player priority, native actor and timeout. Use ActivityEngine interruption policies, not ad hoc Luna intentions.

**Gate:** in GTA, ask an NPC while following/waiting/sitting and after cancelled/failed action; receive truthful distinct answers without background plan resuming after target retirement. No guessing position/arrival from a handler callback.

### ACT5 — Luna-proposed *player-dialogue* activity

**Dependency:** ACT4 acceptance and at least one approved runtime ACT2/ACT3 capability. **Not** PS7 or ACT7 autonomous planning.

**Preserved specification:** [master plan §7.2](research/UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md#72-act3-act4-and-act5-are-separate-deliverables). Gate a strict decision v2 with activity intent + closed slots, exclusive with stock command and forced buffered_action (never speculative early TTS). Extend the existing decision/stream validators, frozen P0 refs, actor owner proof, native pre-send/source checks, ActivityValidator and GoalStore to a validated player_dialogue source. The model must not author actor IDs, coordinates, priorities, native command, execution steps or arbitrary capability names. Disabled mode retains existing protocol and Gemini behavior.

**Gate:** one Luna-proposed short activity admitted once after valid decision, with real native receipt, and wrong/foreign/unavailable/ambiguous proposal rejected. A spoken “I'll do it” before physical admission is not an accepted completed action. Durable promises remain ACT7.

### CGE0, G0/G1 — separate visual feasibility tasks

- **CGE0:** observe existing Essential ConversationLookBehavior and P2 follow focus in a build-hashed GTA session. Build optional playback-only head/eye overlay **only if a real gap is proven**; never rotate the body outside ACT3 stop_and_face, never steal player/Essential animation/task ownership. Listening-stage CGE requires C-01 source-time mic.
- **G0/G2 gestures:** default-off #204/#226 facepalm, dismissal, nod/shrug need GTA Enhanced dictionary/clip/task coexistence, per-speaker playback fence, owned upper-body cleanup and ElevenLabs delivery-veto validation. Do not add arbitrary new gesture/model call.
- **G1 facial:** [blocked feasibility verdict](plans/npc-facial-acting-g1-verdict.md). Prove a query/coordination seam with Essential lip-sync and #215 experimental mouth overlay before any face animation. A diagnostic-only result is legitimate; do not force G1b implementation.

These probes can run in parallel with ACT3-A and R-02.

## Intermediate — C-01 → PS7 → ACT7, plus memory-aware Director

### C-01 source-time hearing integration

**Implementation source:** [open #37](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/37), not main. Compare all four claimed source slices against current PS2/PS3/PS4/Memory K patches and ownership; preserve source-start mic/utterance ID, bounded native observer sample, strict versioned receipt, partial-hearing-only projection and exact authorized multi-observer delivery without multiple STT calls. Prove no transcript fanout on stale/missing source. Reconcile native/companion source policy selectively; do not copy the branch wholesale.

**Gate:** multiple promoted observers at known distances and walls: one real player utterance, qualified listener words and unqualified listener no words, same-id end/turn proof, cancellation, changed avatar and revoked owner. No accepted GTA proof yet.

### PS7-A/B — Social Director / one responder at a time

**Dependency:** accepted C-01 proximity proof, original C-12 silent-yield/reservation policy and safe Director/PS4 source boundaries. PS7 must not be announced complete solely because PS6 can speak spontaneously or C-01 detects speech.

**Implementation:** (A) select primary addressed/responder NPC with deterministic spoken target, observer/salience and current owner priorities; reserve exactly one Essential turn, allow other observers to retain only their private observations; yield gracefully to player mic/text and interrupt. (B) permit a bounded two-character NPC-to-NPC exchange reusing their **separate** original NPC identity and PS4 evidence, not a single mixed “all NPCs” Luna conversation.

**Gate:** two promoted NPCs, one player utterance, no duplicate STT/model/voice reply, correct selected responder, qualified bystander awareness, canceled/retired speaker and no crosstalk or cross-character facts. Keep distinct NPC consent and limits. See [social specification](research/domains/social/README.md), [master §11.4/Phase 14](research/UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md#phase-14-c-12-routing-ps7-social-and-act7-di-commitments).

### ACT7-A/B — directed interaction and commitments

**Dependency:** PS7-A/B, verified P2 identity/timeline and ACT owner/receipt seam. Stage first one bounded paired DI with source and partner authorizations, player-priority interruption, outcome and private peer memory; only then add **durable** promises/relationships with exact character and timeline provenance. Persist the commitment state, not native task queues; never replay a physical plan from SQLite after startup.

**Gate:** successful and denied pair, wrong-world/retired partner, one responder, playback/physical admission/failure separation, restart with no unintended movement and no cross-NPC record exposure.

### PS6 13b — memory-aware spontaneous reactions

**Dependency:** stable PS6 13a ticket/playback lifecycle and accepted M2/M3/M4/M6 memory source; opt-in M8/M9 only where verified. Implement/select one bounded memory-associated cue through existing Scene Director/C-11/SpecialEvent single-turn admission; add personality/context and recent-topic/cooldown checks only after verified facts/score. M9 callback code in main is a *component*, not acceptance that Nathan initiates appropriate natural conversations.

**Gate:** Nathan makes one relevant source-grounded remark without repeating stale details, no fabricated recall, no mic collision, no extra Luna per unqualified observer, correct cancel/forget/privacy and no unsafe model activities. Record what the player actually hears. See [M9 design](plans/memory-k-m9-activation-20261016.md), [Memory K plan](plans/promoted-npc-memory/implementation-roadmap.md) and [PS6 source audit](PS6-PHASE-13A-RELIABILITY-AUDIT-20261017.md).

## Longer horizon — ACT6, PS8, standalone parity

**ACT6 navigation:** PR #239 implements gated ACT-owned native navmesh walk and long-range drive with verified retained destination, native task progress/arrival/failure, road-node targeting, cancellation and world/actor/vehicle scope. Contract exposure remains historically "missing" pending GTA Enhanced exact-build acceptance. Do not call task invocation or passing CI proof of physical game completion; do not relabel startdriving as navigation.

**PS8 world awareness:** source audit first, one new event at a time. Expand PS2 witness semantics and PS3 salience, then PS4/Director output, with strong negation/occlusion tests. Proposed explosion/theft/siren/event vocabularies are not current claims. New public APIs/SDKs require pinned native tests.

**Standalone #50:** hold the Essential-based main as production authority. Harden exact native actor cookie, RPH load, typed/mic/STT, PCM/positional playback, lips, stop/interrupt and local rollback in an **isolated** GTA environment with Essential/legacy controller disabled. Bring P2 Memory K, ACT, PS4/Director and social functionality only through proven shared contracts. Decide cutover after separately authorized real-game parity; no automatic replacement.

**E7 release:** after each enabled capability branch settles, run repeated microphone + AI + multiple NPC + audio + radio + spontaneous + memory scenarios with native/source tracing, cache/store load, cancellation under game GPU stress, wallet cost and rollback; publish evidence by SHA, not as an invented “100% complete.”

## Dependency/parallel execution map

| Parallel lane | Work packages | Can run before | Must wait for |
| --- | --- | --- | --- |
| A — reliability | R-01…R-05 | Any future features, independently | Exact main build and source-pinned switches for live claims |
| B — physical behavior | ACT3-A → ACT3-B… | Hearing and standalone | ACT4 truthful state uses accepted ACT proof; ACT5 waits for ACT4 |
| C — voice/animation | #229 GTA, CGE0, G0, #47 branch reconciliation | ACT3 and M7 | Facial G1b requires safe native clip/ownership; CGE listening requires C-01 |
| D — hearing/social | #37 C-01 → PS7-A → PS7-B → ACT7 | ACT3, M7 | Exact source-time hearing before social routing; approved DI actor seam before ACT7 |
| E — memory initiative | M2/M4/13a/M9 tests → 13b | ACT3 and #37 | Verified memory facts and one native Director ticket |
| F — standalone | #50 exact-head isolated R0 smoke → parity → authorized cutover | All Essential mainline work | Native ownership/reversible install/physical parity; no cutover by PR merge |

**Agent handoff template:** cite baseline SHA; name exactly one work-package ID; inspect referenced source, contracts and PR diff; list existing code versus missing code; implement bounded delta with default-off behavior retained; test both allowed and denied paths; report native compile and **separate GTA physical status**; open a PR (no unrequested merge). Do not reread the historical master plan as a demand to restart phases 1–11.
