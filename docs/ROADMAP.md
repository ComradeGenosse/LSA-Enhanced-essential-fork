# LSA project roadmap — canonical mainline view

**Audited:** October 17, 2026, against canonical main at 3410c1772cd2012bde8a16fe37035e231faf695f. **Status is source/PR evidence, not a certification of the installed GTA build.** Recheck the current main SHA and newer PRs before executing this backlog.

This is the **one current roadmap and priority queue**. The [implementation/evidence matrix](IMPLEMENTATION-STATUS-20261017.md) records what exists, is integrated, has offline evidence, has GTA evidence, and still needs acceptance. The [next-phase work packages](NEXT-PHASES-20261017.md) give agent-ready boundaries, dependencies and gates. The enormous [unified intelligence checkpoint ledger](unified-intelligence-implementation-status.md) is historical; the [October 8 master design](research/UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md) and [research/contract index](research/README.md) remain technical specifications, **not** live project status.

## Operating rules

- **Implemented** means production-path source exists. **Integrated** means it is contained in canonical main. **Offline** means tests/builds have evidence, scoped to the commit/head named in that evidence. **GTA** means physically observed, on the particular installed revision. These are independent facts.
- An experimental/default-off code path is not an enabled feature; a registry declaration, closed schema, test stub or branch-only code is not an executable capability.
- Los Santos Alive **Essential remains the native authority** for Ped lifetime, owner, action dispatch, interruption, playback, player priority and turn identity. PS4 remains the single assembled evidence-to-Luna writer. ACT and PS6 cannot become a parallel task/turn executor.
- Keep privacy, original accepted-input bytes, authenticated native source, player/character/timeline scope, source-age limits and replay/idempotence fencing. Do not make memory reliable by committing dialogue after genuine owner revocation.
- Preserve the existing designs, contracts and research. A proposed design is not a call to redesign it. No percentages or blanket acceptance based on a merged PR.

## High-level source inventory (main, October 17)

| System | Mainline source/integration | GTA acceptance and key limits |
| --- | --- | --- |
| **E1–E6, E7** | E1–E6 provider, Luna/STT/TTS, safe retries, structured streaming and segmented speech integrated. ElevenLabs v4 emotional-acting path (EA0–EA9) integrated through #224; split-PCM failure fix #229. E7 is an integration/soak gate, not an implemented feature toggle. | Historical E6 and voice gameplay exist. #229 and current combined pipeline need exact-build GTA playback/interruption/long-run checks. |
| **P0–P2** | Frozen context, P1 identity, promoted NPC profiles/editor/summon and P2 memory ownership integrated. | Prior GTA promotion/summon/follow examples exist; test current Memory K + P2 lifetime/reconnect, not just old branch demonstrations. |
| **UX0–UX4, unified settings** | Shared Talk, targeting, mic/recipient feedback and experimental controls are in main. #221 offline master settings importer + #228 preservation of existing bindings are in main. | Talk/control path has earlier GTA evidence. The unified master is **opt-in/offline**, not automatically created or applied; current runtime files remain authoritative. Regression of held/tap, active targets and player-specific Steam Input remains open. |
| **PS0–PS3** | Native sensing, verified observer episodes, PS3 salience and source-qualified gating integrated. #214 expands native collision/injury/body events. | Earlier PS2/PS3 shadow GTA evidence; current #214 callbacks, witness/freshness and failure paths need GTA tests. |
| **PS4 / C-04 and C-05/C-06** | Single grounded requested-turn knowledge writer, self/action receipts, original native owner priority/Director admission. #225 repairs PS4 knowledge contract after main integration. | One prior real gunfire→PS4→Luna playback verified; **81-case audit, cross-feature regression and current exact-head acceptance are still open**. |
| **PS5 / Memory K M0–M10** | M0 contracts; P2 SQLite, native D01/D02/D03 captured dialogue, H1/H2/M4 recall, M3 witnessed records, M5 correction/forget, M6 retention, M7 Luna curation, M8 interpretation, M9 optional events/callbacks composed in main. #217/#219/#220/#227/#230/#231 carry critical recovery, recall, idle-proof and correction changes. | Storage and recall have earlier partial GTA traces; **new #231 recovery and natural corrections, #230 M7 paid idle path, #213 M9 callbacks and M8 personality semantics are not GTA-accepted**. M7 and M9 remain gated/off by default. M10 standalone parity/soak not closed. |
| **PS6 Phase 13a / 13b** | Existing bounded Scene Director spontaneous **speech-only** path, native original-turn binding, tickets and receipt rules; #214 adds events; M9 has opt-in callback-to-Director integration (#213). | User observed actual spontaneous gunfire/crash lines in earlier runs, not proof of every producer or this main SHA. Need reliable admission→Luna→audio→ack and player-interrupt GTA matrix. **13b fully memory-aware, natural spontaneous initiative remains an acceptance/expansion phase**, not simply done because M9 glue exists. |
| **Radio R0–R5/v2** | Integrated mainline radio witness/song knowledge (#32) and #223 reconnect/in-vehicle revalidation. | **October 17 GTA evidence reports radio working after repairs**, but pin installed hashes, station/track resets, passenger, error and PS4 replay. Do not still call #32 open/unmerged. |
| **ACT0–ACT2** | Promoted-actor registry, exact native execution leases/receipts, pause/resume, player-directed follow/wait/sit/resume integrated (#18). Some Essential-native follow/vehicle commands already work independently of ACT3. | October 6 GTA ACT smoke, plus later player experience, but individual task completion, cancel, residual owner and vehicle cases need bounded live evidence. |
| **ACT3–ACT7** | This branch proposes ACT3 templates, multi-step plans, ownership fencing, physical completion adapters, per-capability probe gates, and focused native/companion tests. ACT4 activity-aware dialogue, ACT5 Luna proposals, ACT6 navigation and ACT7 DI/durable commitments remain future scoped implementations. | ACT3 remains off until each capability's required probe is recorded. No capability is GTA-accepted by this PR; do not mistake command acceptance for physical completion. |
| **C-01 / PS7 / PS8** | C-01 source-time microphone/proximity branch [#37](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/37) **open, not main**. PS7 multiple-NPC responder routing and social conversations and PS8 expanded qualified world sensing are designed, not accepted implementations. | #37 requires reconciliation, native + exact-mic proof and GTA acoustic hearing; PS7 requires one responder and multi-character turn admission; PS8 needs one source-verified sensor at a time. |
| **CGE, gestures, face/mouth** | CGE playback/listening gaze remains a design. #204/#226 integrate default-off, bounded gesture selection and optional nod/shrug. #215 supplies opt-in playback-level mouth overlay in main via #224 lineage. | GTA Enhanced animation/coexistence is **not** established. Facial expression G1 explicitly blocked by missing safe mouth/face ownership evidence; #222 is an **open docs-only PR targeting an obsolete integration base**. |
| **Standalone replacement** | Experimental isolated [#50](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/50) branch includes native/typed/audio smoke work and modular descendants; **not merged to main, no Essential replacement cutover**. Parakeet local STT [#47](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/47) remains open on an old Qwen TTS branch. | Exact-head CI, isolated GTA/RPH with Essential disabled, rollback, identity/PCM/mic/perception/action parity and authorized cutover all outstanding. |

For phase-by-phase evidence and source paths read [IMPLEMENTATION-STATUS-20261017.md](IMPLEMENTATION-STATUS-20261017.md).

## Prioritized remaining development

### P0 — immediate: make the merged build trustworthy

1. **Baseline/release trace:** capture main SHA, build hashes, installed native DLL and companion versions, on/off/shadow feature modes, voice/controls, and original source/character/timeline per case. Run the E7 short smoke without enabling all experimental systems at once. Record separate source/offline/installed/GTA verdicts.
2. **Memory correctness:** test #231 D03 owner-stall versus genuinely revoked owner; “Nara, not Nora” correction and all dog-name follow-up retrieval across fresh sessions; #220/#227 H2 candidate ranking; #219 M3 coverage recovery. Inspect exact SQLite committed bytes and the **PS4 prompt actually supplied to Luna**. A never-accepted D01 utterance remains unrecoverable by design.
3. **Speech/perception stability:** reproduce #229 split/odd PCM and cut-off reply in real ElevenLabs speech; validate PS4 #225, radio #223, and #214 crash/injury/death/body native observations. Preserve player interruption and genuine source-negative cases.
4. **Branch triage:** #37 C-01; #35 contextual ballistics; #47 Parakeet; #50 standalone; #222 stale-base gesture docs. Reconcile individually, with ownership/overlap review. They are **open PRs**, not automatically blockers of main's baseline.
5. **M7/M8/M9 rollout review:** M7 (#230) opt-in consent/price/native verified quiet proof and real Luna cancellation; M8 source-linked personality output; M9 (#213) default-off native switch and event callbacks. Never assert a paid/background or uncompiled native producer is running.

### P1 — next: capability and naturalness wins

1. **ACT3 acceptance** — review the dedicated implementation PR and validate each gated capability on GTA Enhanced. Confirm Essential remains the sole executor, physical completion adapters distinguish success from accepted commands, and cancellation/preemption preserves higher-priority owners. Keep unsupported follow-vehicle, give/take-item, named-place scenarios and bench sitting blocked until their evidence seams exist.
2. **ACT4** — expose current truthful ACT/C-05/C-06 state to an NPC's *requested dialogue*: active mode, pause, failure, source-qualified completion and safe resume. No implicit task clearing or stale lease replay. Depends on stabilized ACT2/selected ACT3 and PS4.
3. **ACT5** — closed Luna-proposed **player-dialogue** activity through existing strict/segmented schema version, exact actor/slots, buffered-action validation and ACT GoalStore; retain existing command-only schema when disabled. Depends on ACT4 and accepted underlying capabilities. No free-form planner and no autonomous Director physical actions.
4. **CGE0/G0** — check if stock Essential look/mouth behavior already suffices; gather GTA Enhanced compatibility evidence before optional playback-only head/eye overlay or expressive clips. Lip sync and #215 mouth overlay have face ownership priority; never run speculative facial expressions.

### P2 — intermediate: social intelligence with safe arbitration

1. **C-01** — reconcile #37 against current main, exact mic utterance ID, native source-time witness interval, privacy, owner/session/world fences and partial-hearing-only evidence; one STT may serve eligible observers. Do not synthesize hearing from transcript text after the fact.
2. **PS7 / C-12 Social Director** — select and reserve **one** authorized responder, yield others, build each NPC's own PS4 frame and preserve player priority. Prove two-character turn arbitration, cancellation and no duplicate Luna/STT session on one utterance.
3. **ACT7** — one bounded directed-interaction pair and durable, timeline/character-scoped commitments only after PS7 source and ACT actor/receipt gates. No replay of saved execution plans after restart.
4. **PS6 13b** — measured memory-aware spontaneous callbacks/running jokes through the existing Director's one ticket, frozen verified M4/M6/M8/M9 evidence, privacy and cooldowns. Implement the missing natural selection and acceptance boundaries incrementally; do not create a second speech scheduler.

### P3 — long term: navigation, expanded world and independent hosting

1. **ACT6** — bounded walk-to / drive-to navigation with verified place resolution, path/pathfinding failure, arrival/cancel and native priority; contract declaration is not an implementation. Existing start-driving command is not destination navigation.
2. **PS8** — one new native-qualified world sensor at a time (explosion, siren, theft, etc. only where a real source/observer proof exists), then PS2/PS3/PS4/Director and GTA negative cases.
3. **Standalone #50** — continue distinct R0–R5 host/IPC/audio/memory parity/rollback, behind a reversible isolated installer. No concurrent Essential authority or forced mainline cutover.
4. **E7** — fully integrated soak and release gate, performance under GPU/gameplay load, reconnect, timeline, interruption, three-character concurrency, no cross-NPC leakage, bounded provider cost and rollback.

## Dependencies and parallel work

| Lane | Can begin independently | Hard integration gate |
| --- | --- | --- |
| Memory/reliability | #231/#229/#230 GTA matrices, H2 and M3 evidence, safe tests | Exact-current-main install; no real owner-revocation bypass |
| ACT | ACT3 first capability and separate CGE0 source probe | ACT4 consumes proven ACT2/ACT3 self facts; ACT5 follows ACT4 and approved capabilities |
| Hearing/social | Rebase/test #37; design C-12 reservation against source contracts | PS7 needs C-01 qualified hearing and silent-yield/source ownership; ACT7 follows PS7 + ACT owner/DI proof |
| Spontaneous | 13a producer/reliability and M9 source/provenance testing | 13b memory behavior needs accepted durable recall + PS6 admission; not a replacement Director |
| Voice/presentation | #229 GTA checks, #215 mouth/gesture feasibility, optional #47 STT branch | Facial expression requires verified ownership; CGE listening needs C-01; no voice/mic duplication |
| Standalone | #50 exact-head CI and isolated smoke | Parity/cutover authority and rollback approval; not a dependency of Essential-first feature progress |

**Recommended order:** establish P0 reliability on the new main; implement ACT3 stop-and-face as the next discrete code PR while the C-01 branch is reconciled in parallel; ACT4 then ACT5; integrate social routing after source-time hearing; only then broaden DI, navigation and world autonomy. Every work package, file seam and acceptance oracle is indexed in [NEXT-PHASES-20261017.md](NEXT-PHASES-20261017.md).

## Technical specifications — retained, not reinvented

- [Original cross-system master implementation specification, §7–15](research/UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md) — ACT3–ACT7, C-01/C-12, PS6 13b, PS7, PS8, tests, preconditions and dependency graph.
- [System contracts](research/system-contract-register.md), [ownership matrix](research/system-ownership-matrix.md), [dependency graph](research/system-convergence-dependency-graph.md) — native and producer authority.
- [ACT0/1](ACT0-ACT1-status.md), [ACT2](ACT2-status.md), [runtime registry](../contracts/activity-capabilities.v1.json), [activity domain](research/domains/activities/README.md) — current dispatch and older design.
- [Memory K design/decisions](plans/promoted-npc-memory/README.md), [original M0–M10 specification](plans/promoted-npc-memory/implementation-roadmap.md), [production closeout/acceptance](plans/promoted-npc-memory/MEMORY-INTEGRATION-ACCEPTANCE.md) — do not discard original invariant/gate IDs.
- [PS6 13a native producer reliability audit](PS6-PHASE-13A-RELIABILITY-AUDIT-20261017.md), [PS4 audit](ps4-v1-acceptance-audit.md), [radio technical history](radio-track-perception-v2-status.md).
- [CGE design](plans/conversation-gaze-engagement/README.md), [gesture/native compatibility](plans/npc-gestures-findings.md), [facial G1 blocked verdict](plans/npc-facial-acting-g1-verdict.md), [mouth overlay](npc-voice-presence.md).
- [EA/ElevenLabs specifications](plans/ELEVENLABS-V4-EMOTIONAL-ACTING-IMPLEMENTATION.md) and [GTA release gate](ea9/GTA-ACCEPTANCE.md); [original standalone architecture (PR #50 branch)](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/50).
- [Historical checkpoint ledger](unified-intelligence-implementation-status.md), [old v1 scope milestone](lsa-v1-implementation-milestone.md), [historical research](research/README.md). Their dated claims are not current-release claims.

**Agent entrypoint:** read this roadmap, then the exact row in the [evidence matrix](IMPLEMENTATION-STATUS-20261017.md) and corresponding [next-phase work package](NEXT-PHASES-20261017.md); verify main SHA and PR state first; implement only the missing slice; record exact build/offline/GTA evidence without overwriting completed work.
