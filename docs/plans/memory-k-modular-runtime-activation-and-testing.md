# Memory K: modular runtime activation and independent testing within #138

Planning report · 13 October 2026 · Revised delivery policy for modular activation on #138. Documentation only; no runtime implementation, builds, tests or deployment performed by this revision.


## Recommendation

**Keep [PR #138](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/138) as Memory K's one canonical integration branch.** Introduce **modular activation, isolation, diagnostics, and independent testing *inside* that integrated codebase**. Do **not** dismantle #138 and extract M1–M9 into separate releases or migration PRs targeting `main`. One integrated product may contain separately switchable/testable subsystems. Modular architecture is not a mandate for modular delivery.

Add a small, explicit composition and activation layer around existing Memory K factories and ports. Keep Essential, P1, P2 SQLite, the authenticated native channel, and PS4 in their existing authority roles. Separate shared evidence infrastructure from optional consumers; independently gate dialogue capture, witnessed-event capture, foreground recall/commands, background retention, cloud curation, interpretations and callbacks.

Do not make M1–M9 nine interchangeable plugins. M1 is a storage prerequisite; M2/M3 are evidence sources; M4/M5/M8 consume authenticated turns; M6/M7 are background workers; M9 includes event producers and a Director consumer. Privacy, source authentication, native ownership and canonical storage remain non-optional enforcement boundaries.

**Development policy:** Multiple agents may still implement *small scoped PRs*, each from an isolated branch/worktree and **targeting #138's integration branch**, never `main`. Review and integrate these incrementally into #138; turn optional capabilities on/off and certify them there. Keep the full S01–S10, native, package, physical GTA and soak requirements separate. **Only after the whole integrated system is accepted should a single, separately reviewed merge of #138 into `main` be considered.** Individual capability success is not a substitute for release acceptance.

## 1. Investigated baseline and evidence limits

The investigation used immutable source snapshots:

| Source | Pinned commit | Interpretation |
|---|---|---|
| `main` | `929b6e022740b50c297ec5044591b240632825ed` | Existing Essential companion architecture. The Memory K shared-brain implementation is absent from this tree. |
| [Memory K production draft #138](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/138) | `a099766fdd5df2553addb935e067032037c489c9` | Primary implementation studied. Contains dialogue/event capture, storage/privacy/durability work, and numerous optional modules without complete production callers. |
| [WS-6 recall draft #152](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/152) | `df3a8def09c8a33153e2571ed771ab7c1a0a3df8` | Adds authenticated foreground recall, journal conversation context, M5 dispatch, M8 reads, and request fences. |
| [WS-6/WS-4b reconciliation #157](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/157) | `4dc5c6e4dae52927f2958116908742d3094d8ed8` | Pinned code reviewed; #157 subsequently merged into #138. Integration does not imply full-product acceptance. |

The historical comparison showed #152 and #138 diverged at merge base `2c56a5285825b468fd7f559b94cef89f18cfaa74`. #157 reconciled and merged those histories into #138; **#138 was at `14fc406c258c1de930e1b3dab331f343bd0762a4` when this revision was prepared.** Recheck #138's moving head before every scoped PR and merge. Do not restore older file snapshots over newer durability/privacy/recall fixes.

Repository precedence was followed: `AGENTS.md`, `ROADMAP.md`, `research/CURRENT.md`, `DECISIONS.md`, the contract register, and the current Memory K decision/audit/implementation documents. Older headers and handoffs sometimes describe earlier states; actual callers and the settled decisions determine the findings here. This is a source investigation. Historical test counts and PR claims were not independently rerun.

The full-product acceptance gate remains separate. At the inspected #138 head, `scenarios.v0.json` still marks S01–S10 unimplemented, and `memory-k-original-S01.test.mjs` deliberately fails after a negative source-blocked probe. A successful module suite cannot be relabeled as a passing original scenario. The approved native SDK, exact production package, real producer receipts, and physical GTA acceptance remain required. [Scenario manifest](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/tools/memory-sim/scenarios.v0.json), [S01 gate](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/tests/memory-k-original-S01.test.mjs), [acceptance reconciliation](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/docs/plans/promoted-npc-memory/memory-k-production/HISTORICAL-ACCEPTANCE-RECONCILIATION-20261013.md).

## 2. Current architecture and coupling

### 2.1 Authority spine

1. **Essential** owns GTA execution, native sessions/turns/generations, action dispatch, playback, and completion. Memory activation must not create another executor, turn scheduler, playback lifecycle, or retry path for physical effects.
2. **P1** supplies durable identity and current owner-authenticated associations. CharacterId is never a physical effect address.
3. **P2** owns the single durable character and memory store. The Essential storage adapter delegates to `lsa-shared-brain`; it must remain a wrapper around that implementation.
4. **Native evidence infrastructure** supplies hostRunId/worldEpoch, current anchors, observer index, owner/player proofs, witness facts, and retirements. Missing or stale evidence is unknown, never authorization.
5. **PS2** constructs observer-qualified observations. **PS3** ranks relevance and grants entitlements. Neither owns durable identity or factual truth.
6. **PS4/C-04** is the one model-visible knowledge assembler. Memory contributes typed data to its existing lanes.
7. **Director/PS6** proposes and requests through the existing native admission and Essential turn/playback path. ACT owns physical activity arbitration; memory cannot grant that authority.

These roles follow D-001–D-017 and C-01–C-15. D-018–D-023 add private verbatim game-state storage, P2-owned SQLite/FTS5, off-turn Luna interpretation, one human across avatars, OpenAI commit-decision acceptance, and observation-time M3 attribution. [Decisions](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/docs/research/DECISIONS.md), [contract register](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/docs/research/system-contract-register.md).

### 2.2 Code-backed component inventory

Paths below are repository-relative identifiers, not proposed new subsystems.

| Capability | Existing implementation and integration | Present coupling / implementation limit |
|---|---|---|
| **M1 storage** | `lsa-shared-brain/src/characters/sqliteProfileStore.mjs`, `sqliteFoundation.mjs`, `sqliteDurability.mjs`, `timelineGuard.mjs`; Essential `characters/memoryStorageAdapter.mjs` | P2 selects JSON or SQLite. SQLite opens one writer, performs migrations, and offers serialized source/timeline-fenced ports. Foundation imports journal, privacy, replay and curation schema/operations together. Feature disable must not remove their tables or checks. |
| **M2 dialogue** | Essential `memory/openaiRuntimeAcceptedInput.mjs`, `originalTurnActorLedger.mjs`, `memoryD02Port.mjs`, `d03OriginalDialogueJoin.mjs`, `npcSpeechDeliveryLedger.mjs`; `openai/runSequentialTurn.mjs` | OpenAI D01 acceptance is privately issued at `commitPlayerInput`; D02 independently proves the native owner/player; D03 joins and commits. NPC delivery comes from the private speech ledger. SQLite and a promoted profile effectively gate capture; there are no separate player/NPC recording switches. |
| **M3 witnessed events** | Essential `memory/m3ProductionMemory.mjs`; shared `events/m3Ps2ObserverAdapter.mjs`, `m3ObserverOwnerBinder.mjs`, `m3BoundedIntake.mjs`, `m3ObserverCoverageTracker.mjs` | Bootstrap attaches the synchronous PS2 accepted-observation tap when SQLite ports exist. The tap freezes attribution and enqueues; SQLite runs later. This is independent of M2 and PS3 notability. Coverage requires genuine authenticated frames; injected test authority does not produce coverage. |
| **M4 recall** | Shared `memory/recallEngine.mjs`, `sqliteIntegratedRecallProjection.mjs`, `integrationPorts.mjs`; PS4 contribution/renderer seams | #138 has engines and projection seams without the complete foreground caller. #157 uses `memory/liveTurnMemory.mjs` in the original runner and retains final-send validation. |
| **M5 commands/privacy** | Shared `memory/m5RuntimeCoordinator.mjs`, `explicitCommands.mjs`, `m5SqlitePrivacy.mjs`, `m5ScopedPrivacyFacade.mjs` | Conversational commands require a durably accepted M2 line; inspector operations use a separate privileged facade. #157 dispatches commands inside the same preflight that prepares M4/M8. Existing editor primarily exposes P2 manual-memory CRUD and timelines, not the complete learned-memory inspector. |
| **M6 deterministic retention** | Shared `memory/m6Coordinator.mjs`, `m6CursorConsumer.mjs`, `m6P2ReplayAdapter.mjs`, `selection.mjs` | Existing factory exposes scene-close, idle, and recovery hooks. It processes committed evidence, saves before cursor acknowledgment, and optionally enqueues M7 work. No production bootstrap caller was found in the inspected #138/#157 paths. |
| **M7 cloud curation** | Essential `memory/lunaCurationBridge.mjs`; shared `memory/idleCurationScheduler.mjs`, `lunaCurator.mjs`, `m7Consent.mjs`, `curationSqlite.mjs` | Existing bridge requires persisted explicit consent, matching budget caps/pricing, recovery, authenticated native idle, and one P2 connection. Construction/import do not start cloud calls or a timer. Complete production activation is separate work. |
| **M8 interpretations** | Shared `memory/m8Interpretation.mjs`, `m8SqliteHistory.mjs`; #157 `memory/p2M8ProductionRead.mjs` | Deterministic source-linked interpretations exist and can use retained facts without M7. #157 adds the authenticated reader and history seal, but currently prepares it with M4/M5/journal context. Full planned personality/relationship/joke scope remains distinct from that reader. |
| **M9 event producers** | Shared `events/m9EventProducers.mjs`, `m9Ps2CandidateBridge.mjs`; native `intelligence/m9/*` | Producer-policy modules exist, but the inspected production `PromotedCharacters.csproj` does not include the native M9 files. Policy tests are not production producer availability. Richer families must remain unavailable until compiled and physically verified. |
| **M9 memory callbacks** | Shared `events/m9MemoryCues.mjs`, `m9CommittedWitnessAuthority.mjs`; Essential `perception/m9DirectorCueAdmission.mjs` | Requires a committed M3 witness/sidecar, a current original PS3 grant, existing Director admission, and registration into PS4. No production bootstrap caller was found. It cannot create its own spontaneous entitlement. |

[Bootstrap](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/bootstrap.mjs), [runtime glue](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/integration/essentialGlue.mjs), [shared store](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-shared-brain/src/characters/sqliteProfileStore.mjs), [WS-6 preflight](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/4dc5c6e4dae52927f2958116908742d3094d8ed8/lsa-essential-e1-candidate/src/memory/liveTurnMemory.mjs), [native production project](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/native/promoted-characters/PromotedCharacters.csproj).

### 2.3 Existing switches and what they actually control

| Existing control | Actual behavior | Consequence for modular activation |
|---|---|---|
| `provider` | OpenAI constructs the provider/identity/character stack; stock Gemini retains its path. | Gemini has no qualifying D-022 memory acceptance path. Do not enable M2 by treating transport submission as acceptance. |
| `persistentIdentity.enabled` | Optional P1 support; bootstrap disables it when the build contract is missing. | A flag cannot replace current owner proof. Missing P1 blocks promoted live memory. |
| `promotedCharacters.enabled` | Constructs CharacterService for OpenAI; JSON is default. | Retain ordinary P2 profile/editor behavior independently of optional automatic memory. |
| `promotedCharacters.storageMode` | `json` or opt-in `sqlite`. | Currently doubles as a coarse Memory K activation condition. Replace this implication with explicit capability decisions. Changing backend requires restart/migration, not a live toggle. |
| Companion `intelligence.mode` | Normalizes to `off` or `shadow`; one IntelligenceClient runs source evidence plus PS2 and PS3. | Turning it off currently removes D02, host/world context, and M3. It is not merely an event-awareness switch. |
| Native host `enabled`, `intelligence.mode` | Native `RuntimeEntry.Start` requires the root enabled flag; shadow mode creates IntelligenceIntegration inside the existing Essential domain. | Root host disable is not an independent M3 or PS3 disable. Preserve its owner fiber, pin checks and P2 roster. |
| `intelligence.radio` | Optional radio sampling/catalog path when perception is shadow-enabled. | Separate factual producer; no independent model writer. Availability still needs matching native/catalog evidence. |
| `dialogueKnowledge.mode` | `off`, `shadow`, `active` choose whether the PERCEIVED preview reaches the request. | **Not a global memory-off switch.** #157 selects `memoryBase` even when this mode is off; manual P2 memories also belong to base rendering. Gate memory contributors separately. |
| `dialogueKnowledge.activityFacts`, `dialogueReceipts` | Optional SELF contributors with their own prerequisites. | Keep their independent ACT/build/host checks. Memory should not switch them on. |
| `spontaneousSpeech.mode` / native `directorMode` | Companion off/shadow/experimental plus native independent opt-in. Companion configuration requires `intelligence.mode=shadow`. | PS6 is usable without M9 memory callbacks; callbacks must be an additional consumer gate. |
| Director testing preset | Coordinated companion/native normal or testing rate limits. | Never use the testing preset as authorization or as a default for memory callbacks. |
| `activities.mode`, capability/probe gates | Off/shadow/on plus per-capability native support and local gates. | Physical activity remains separate. Memory interpretation and callbacks receive no action authority. |
| M7 consent object | Off by default; experimental cloud use needs persisted explicit consent, budgets, pricing and idle proof. | Generic `on`, a provider key, or a deployment profile cannot grant cloud consent. |
| `dialogueLogging.enabled`, observability | Private dialogue trace is separate from filtered telemetry. | Enabling diagnosis must not silently enable content tracing or evidence upload. |

[Configuration](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/config/e1Config.mjs), [P2 configuration](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/characters/characterService.mjs#L26), [PS configuration](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/perception/contracts.mjs#L8), [PS4 switch](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/config/dialogueKnowledge.mjs), [native startup](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/native/promoted-characters/RuntimeEntry.cs), [M7 bridge](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/memory/lunaCurationBridge.mjs).

## 3. Proposed activation model

### 3.1 Capability boundaries

Use a closed, versioned list of capabilities, with static descriptors and explicit factories. Avoid dynamic module discovery, third-party plugin loading, a generic dependency-injection framework, or a second event bus.

Recommended capability IDs:

| Group | IDs | Boundary |
|---|---|---|
| Shared runtime | `source.core`, `p2.sqlite` | Existing authenticated source plane and P2 backend; prerequisites, not optional proof shortcuts. |
| Perception | `ps1.producers`, `ps2.observations`, `ps3.salience`, `ps4.perceived`, `ps6.speech` | Consumer gates inside the existing native/companion pipeline. PS0 is a contract, not an independently useful runtime worker. |
| M2 | `memory.dialogue.player`, `memory.dialogue.npc` | Accepted player journaling and NPC outcome journaling separately. |
| M3 | `memory.events`, `memory.coverage`, `memory.promotionGrace` | Positive event intake, coverage bookkeeping, and optional qualified promotion import. |
| Foreground consumers | `memory.journalContext`, `memory.recall`, `memory.commands` | Journal CONVERSE, M4 evidence contribution, conversational M5 dispatch. |
| Background consumers | `memory.deterministic`, `memory.cloudCuration` | M6 retention and M7 worker independently. Queue schema belongs to P2 regardless of worker state. |
| M8 | `memory.interpretation` | Source-linked personality/joke/relationship projection; cloud appraisal is an optional input. |
| M9 | `events.<supported-family>`, `memory.callbacks` | Each verified richer producer separately; memory-informed PS6 is a distinct gate. |
| Administration | `memory.inspector` | Confidential privileged local UI. Privacy enforcement remains mandatory even if this UI is closed. |

Per-family controls initially cover only source-supported producers. PS7/social routing and unavailable speech-hearing producers report `unavailable`; listing a future capability must not make it executable.

### 3.2 Modes and state

Normalize user requests to `off`, `shadow`, or `on`; adapters map `on` to existing active/experimental vocabulary where appropriate. Each descriptor states its supported modes and whether changes are live or restart-required.

- **Off:** no capability intake, worker, timer, optional read, journal write, cloud request, or model contribution. Durable data remains stored; no deletion and no cursor advancement.
- **Shadow:** only meaningful where a bounded, private in-memory preview is safe. No production memory mutation, cloud upload, PS3 consumption, native ticket submission, or model-visible optional contribution. Do not manufacture a shadow mode for storage migration or a paid worker; return unsupported mode.
- **On:** requested operation is permitted only if the existing authority and dependency checks pass. It is not a promise that every current actor is eligible.

Maintain separate `requestedMode`, `effectiveMode`, lifecycle state, and reason. Suggested states: disabled, starting, waiting for source, blocked by dependency, ready, suspended, stopping, failed, restart required. Missing dependency leaves the request blocked; never automatically turn on capture, spend, or native execution.

A static dependency resolver may prevent impossible composition. Actual modules continue to enforce current source/owner/timeline/consent/lease checks at their existing read/write/send boundaries. `capabilityHealth` remains a read model under C-09, not a source of authority.

### 3.3 Configuration and scope

Add one versioned companion configuration section, for example `memoryK.version=1` with a closed capability-mode map. The exact field names should be ratified in the configuration PR. Reject unknown keys/modes in that new section and make contradictory requests diagnosable. Do not copy the older PS normalizer's silent downgrading behavior into new Memory K settings.

Precedence: explicit privacy pause/consent revocation; supported persisted player policy; current validated runtime request; startup configuration; documented compatibility mapping. Use a monotonically increasing policy revision and compare-and-swap updates. Per-character policies may narrow world-level permission. Scope them by `worldProfileId + characterId + timelineId`; avatars remain source provenance under D-021.

Keep M7 consent in the separately persisted P2 approval record. Configuration expresses a desire to run; it never creates that approval. Storage path/backend, world profile, native assembly loading, transport identity and protocol selection are restart-required.

Provide a global **pause learned memory** action that gates capture and all learned-memory reads/contributions, background work, and callbacks. Explicitly include selected P2 manual-memory text if the UI calls this **all memory**; keep canon/personality identity separately defined. Ordinary Memory K capability disable can preserve legacy P2 manual-context behavior, but the UI must make that distinction clear. Privacy inspection, deletion, export, and consent revocation remain available through their existing authenticated privileged boundary.

## 4. Dependency rules and achievable independence

The main change is to separate the source plane from optional semantic consumers. Today `memoryD02Port` checks current anchors and observer-index ownership inside ShadowRuntime; IntelligenceClient also refreshes salience. Preserve these checks while making correlator/salience/producers optional. Do not replace their source with a configuration boolean. [D02 port](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/memory/memoryD02Port.mjs), [shadow runtime](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/perception/shadowRuntime.mjs), [client](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/perception/intelligenceClient.mjs).

| Capability | Hard prerequisites | Optional inputs / things that may be disabled |
|---|---|---|
| M1 | Supported SQLite/FTS5, one P2 writer, valid world/profile schema and migration | M2–M9, perception semantics and cloud workers. Live writes still obey timeline/source policy. |
| M2 player | OpenAI D01, original actor ledger, P1, live promoted P2 SQLite profile, D02/D03, confirmed timeline, source core | M3, general event producers, PS2/PS3, PERCEIVED context, M6–M9 after source-plane separation. |
| M2 NPC | Exact native turn/generation and speech-delivery ledger, D03/P2 scope, **the already durable M2 player line for this reply** | Player-event awareness, M3, cloud. Player on/NPC off is supported. NPC on/player off is blocked for the current reply path; `recordNpcOutcome` explicitly rejects `d03_no_durable_player_line`. |
| M3 positive events | Source-qualified PS1 signal, PS2 accepted observation, observation-time owner/index join, P2 confirmed timeline | M2, PS3 ranking, M4–M9. Mundane observations must not require a notability grant. |
| M3 coverage | Authenticated current native samples, supported coverage contract, P2 scope | Positive-event journaling may be off, but coverage then explicitly records capture gaps. Coverage alone never proves a negative fact. |
| M4 pure queries / inspector | Retained valid scoped evidence and P2 read ports | Active M2/M3 capture, PS3, M6/M7/M8, Director. These paths can be tested offline. |
| M4 live dialogue | Current verified turn and durable accepted player line through D03, P2 suppression/evidence checks, existing PS4 assembler | M3, M6/M7/M8, PS3/PERCEIVED, M2 NPC recording. **M2 player capture remains a live dependency.** |
| Journal CONVERSE | Same authenticated durable-line/read boundary, retained journal and PS4 conversation projection | M4 retrieval and M8. Split its preparation from the current combined preflight. |
| Conversational M5 | Durably accepted M2 player line, current proof, scoped P2 command transaction/readback | M4 output, M3, M6/M7/M8, Director. Casual dialogue must not become a command. |
| Inspector privacy | Privileged local authentication, exact scope authorization and P2 privacy ports | Conversational commands and all automatic capture/consumers. Preserve current-source checks where the facade requires them; offline recovery is a separately read-only path. |
| M6 | Retained eligible committed evidence, suppression/sidecar checks, P2 replay cursor, current source/timeline admission | Current M2/M3 intake, M4, M7/M8/M9. At least one eligible source must exist; otherwise report idle/no evidence. |
| M7 worker | Valid existing jobs, same P2 queue/budget ledger, explicit persisted consent, supported Luna transport/pricing, authenticated fresh idle proof and recovery | M4/M8/M9 and current M6 execution. It can finish authorized existing jobs while M6 is off; no new unqualified jobs. |
| M8 | User-approved canon/personality, retained source-linked evidence, authenticated P2 reader and PS4 admission for live use | M7 appraisal, M6-derived records, M4 factual output. Live player-turn preparation still needs the durable D03 boundary. |
| M9 producer | Actual compiled and validated native producer, source evidence, PS2 qualification | M2, M6/M7/M8, callback consumption. Producer enable does not imply durable M3 capture. |
| M9 callback | Durable M3 witness/sidecar, current native owner/timeline, original PS3 entitlement, existing PS6 and C-06/C-11, PS4 contributor | M7/M8 and M6 unless a particular cue specifically needs their outputs. |
| Plain PS6 | Existing PS2/PS3, native priority/admission and Essential ticket/turn/playback | All Memory K callbacks and cloud curation. |

**Preserve the durable accepted-line dependency.** #157's `prepareLiveTurnMemory` refuses a missing/non-durable current accepted receipt and rereads that exact line. Do not silently invent read authority so live M4 works with player journaling off. The safe initial result is blocked live recall, while retained-data engine tests and privileged inspection still work. Any future change to that boundary requires its own authority/privacy design review.

Ordinary reads through the production `sourceRequired` P2 store still require a current confirmed source even when new capture is off. Offline module tests supply valid authority at the native/protocol boundary; they do not weaken the production port. Source-free recovery remains the separately read-only verified-snapshot path, not an unfenced live-database inspector.

## 5. Initialization, shutdown, and live transitions

### 5.1 Initialization order

1. Parse compatibility configuration and explicit capability requests without starting workers. Read build/native contracts and installed payload identity. Report unavailable modules rather than advertising all source files as compiled capability support.
2. Construct the existing runtime and P1/P2 services. Await the P2 initialization promise at one clear composition boundary. Retain the existing memoization, but stop relying on the current early best-effort initialization plus later bootstrap await to define worker readiness.
3. Open the selected P2 backend once. Validate writer ownership, SQLite/FTS5, integrity, migration and privacy schema. Schema migration is deterministic and storage-owned; it does not depend on whether optional workers are currently on.
4. Construct the existing authenticated source client once. Install owner/player and host/world subscriptions before starting its transport. Install timeline revocation subscriptions before admitting memory work. Lack of native freshness keeps capabilities waiting/suspended.
5. Bind a confirmed timeline using the existing policy. Do not enable writes merely because the previous timeline ID exists in SQLite. Automatic continuity after a proven lineage marker is separate from bypassing confirmation after rollback/ambiguity.
6. Compose enabled producers and adapters in dependency order. M2 obtains its per-turn private capabilities at the existing turn seams; M3 receives the synchronous PS2 tap. Neither writes during construction.
7. Prepare foreground consumers through a small shared authenticated read preflight, then their separate journal/M4/M5/M8 calls. Preserve PS4 assembly and final-send fencing.
8. Start M6/M7 only after their prerequisites and durable recovery checks. Start M9 callback registration only after the existing Director is eligible. Attach the editor and diagnostics to the resulting state.

### 5.2 Instance-owned resources

Replace bootstrap's module-level `shutdownClosers` ownership with a small per-runtime disposer, plus one process hook delegating to runtime disposal. Track each transport, timer, subscription/unsubscriber, worker, editor server and P2 owner explicitly. Current bootstrap starts IntelligenceClient and attaches subscriptions but does not register all corresponding stop/unsubscribe/editor-close operations in that closer set.

Dispose in reverse dependency order: block new intake and increment policy revision; invalidate turn projections; cancel callback submissions and M7 requests; stop M6/M7 scheduling; detach M3 intake and seal genuine coverage; unsubscribe adapters; stop the source client; close the editor; finish allowed already-committed accounting/recovery operations; close P2 last among consumers; flush telemetry last. Native teardown stays on the existing owner fiber and must not clear Essential tasks or conversation state.

Use existing `IntelligenceClient.stop()`, M3 `close()/shutdown()`, M7 `stop()`, CharacterService `closeStorage()`, and editor `close()` rather than introducing a second lifecycle system. A shared prerequisite stays alive while an enabled dependent or P2 still needs it. Closing an M3 writer consumer must not close the authority service used by M2.

### 5.3 Transition protocol

Every live change carries an expected configuration revision. Serialize application of changes, validate the complete resulting graph, publish a new generation, and then start/stop the affected adapters. A rejected change returns explicit reasons; it does not partially enable dependencies. Give each admitted operation a local policy-generation guard that can only deny work. Check it before entering a queued P2 operation and synchronously inside the transaction before commit, alongside all existing source/owner/timeline checks. This guard is not a native authority lease. Keep P2 callbacks synchronous; never await or call another serialized store method from inside one.

- **Disable:** admission closes immediately; generation increases; pending uncommitted work is revoked at its write/send fence. Committed rows remain. No disabled consumer advances replay cursors or acknowledges PS3 delivery.
- **Enable:** requires a fresh source and current timeline confirmation where applicable. It never revives old leases, resets suppression, grants consent, or automatically replays physical effects.
- **Dependency loss:** suspend dependents immediately and retain user intent. Resumption requires fresh existing proof, not the reappearance of a matching string/boolean. Source, policy and consent generations prevent ABA reuse.
- **Per-turn policy:** freeze enabled contributors for a turn, but permit immediate revocation. Newly enabled content starts on the next turn. A mid-turn disable cannot add content to an existing request.
- **Unsent requests:** revalidate after each awaited preparation, at each model attempt, and synchronously after JSON/streaming body composition just before fetch. Prune safely before composition; abort an already composed/sent stale attempt according to the existing WS-6 fence. Do not reintroduce forgotten journal text through RAM fallback.
- **Accepted input and playback:** optional capture failure does not change Essential acceptance/history semantics. A line already durably committed is not retroactively revoked by later interruption. Interrupted/failed NPC outcomes stay distinguishable from completed speech.
- **M7 revoke:** abort the worker and prevent future sends/results from committing; retain conservative accounting for a possibly sent request. A disable operation cannot pretend previously uploaded content was withdrawn.

Initially support live companion consumer changes and conservative native restart-required settings. Add live native producer control only in its own PR using a closed authenticated command, queued to the existing owner Update fiber, with versioned acknowledgment. Until both layers confirm a matching revision, effective behavior is the more restrictive permission. Never report a native producer stopped merely because the companion stopped consuming it. Keep new configuration/control messages within explicitly validated limits: native `RuntimeEntry.Start` currently bounds configuration text at 4,096 characters and perception frames at 8,192 bytes; expanding those limits needs a separate reviewed change.

## 6. Runtime isolation and security boundaries

- Keep one native host/owner fiber, one authenticated source channel, one P2 connection/writer, and one PS4 assembler. Use bounded local queues and existing ports; process isolation is not necessary for this change and would complicate authority and storage ownership.
- Source-core processing always validates the complete envelope, stream, sequence, host and retirement semantics before optional delivery. Do not filter wire frames before sequence validation. Keep minimal anchor/roster/player freshness available with semantic perception disabled; do not run a second world scanner.
- Separate `source.core` from optional PS1 production, PS2 correlation, and PS3 evaluation incrementally inside the current integration. Source frames may contain facts a disabled consumer ignores; stale/invalid source still revokes all relevant consumers.
- No synchronous SQLite on the native owner fiber or PS2 acceptance tap. Retain M3's bounded enqueue and truthful loss counters. Bounded worker jobs yield between batches; background work must not monopolize the shared P2 serialization queue.
- Privacy/source checks run inside P2 transactions as well as at the caller. Narrow module ports to required operations; no raw connection is exposed to model/UI code. Existing privately held D01 issuer and NPC speech recorder remain private.
- Preserve suppression and content/evidence tombstones across purge, restart, restore policy, M6 replay and M7 completion. Turning M5 commands off does not turn privacy checks off in other modules.
- D-021 joins one human across avatars, while maintaining exact NPC/world/timeline isolation and immutable avatar provenance. Unknown provenance stays unknown.
- Transcript corrections are linked superseding provenance; counter-claims remain reported overlays and do not erase witnessed facts. M8/Luna interpretations never overwrite canon or source evidence.
- Positive M3 coverage and an empty query cannot become a certified negative fact. The WS-6 policy correctly leaves native-certified negatives unavailable without an independent genuine verifier. Likewise, exact totals/first-last claims require an exhaustive supported query, not the size of a truncated recall page.
- Keep PS4 allowlists, shared byte budgets, safety reserve, source-linked references and final-send revocation. M4/M8/M9 never add a separate system prompt or direct unbounded provider parameter.
- M9 callbacks retain original PS3 entitlement, player/mic/combat priority, native C-06 owner checks, C-11 ticket/turn binding and real playback receipts. PS3 entitlement is consumed only by the correct acknowledged outcome. Producer/Director disable never grants ACT execution.
- Preserve the editor's loopback binding, Host/Origin checks, per-run token, bounded payloads, and scope authorization. Add control/inspector routes there, not a public unauthenticated diagnostics server. Inspector/export results are confidential and never become a model tool.
- Telemetry contains only closed reason codes, modes, queue sizes, aggregate counters/timing, build identity and safe lifecycle state. No stored dialogue, prompts, credentials, audio, export paths, or raw provider/error payloads. Private content tracing remains separately opt-in.

[Privacy facade](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-shared-brain/src/memory/m5ScopedPrivacyFacade.mjs), [editor](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/characters/editorServer.mjs#L91), [M3 production adapter](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/memory/m3ProductionMemory.mjs), [M9 admission](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/perception/m9DirectorCueAdmission.mjs).

## 7. Diagnostics and independent testing

### 7.1 Diagnostics contract

Extend the existing `observability/capabilityHealth.mjs` projection with memory capabilities and safe state. Report separately:

- implementation/build support and protocol/schema versions;
- requested/effective mode and policy revision;
- dependency blockers, native freshness, timeline confirmation, writer/recovery status;
- last safe failure code, intake/write/drop counters, queue pressure, replay progress, timeout/revocation totals;
- M7 consent/budget/idle eligibility without exposing credentials or content;
- source/offline/native/package/GTA validation receipts associated with the exact payload.

Do not collapse configured, supported, running, and GTA accepted into one green light. A stopped consumer must be explainable even when the shared source is healthy. Follow C-09: diagnostics read state; they cannot force a module through its gates. [Existing health model](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/src/observability/capabilityHealth.mjs).

### 7.2 Test layers

| Layer | Method | Required evidence |
|---|---|---|
| Dependency/configuration | Table-driven pure resolver tests | Every supported graph, unknown mode/key, explicit dependency-off case, compatibility mapping, scope override, consent never granted by config. |
| Module behavior | Existing real modules with fresh temporary disk P2 stores and deterministic clocks | Correct records/results and no unrelated module/provider invocation. Mock only external boundaries; do not replace the core behavior under test. |
| Authority/protocol | Existing native policy/host harnesses, authenticated socket/channel tests, real D01/D02/D03 runner fixtures | Wrong actor/owner/player, replay, stale/absent source, per-owner omission/recovery, host/world reset, ABA, overflow and sequence rejection. Plain attestation booleans must fail. |
| Runtime lifecycle | Production composition functions, instrumented resources and loopback providers | Start/stop idempotence, partial initialization cleanup, no orphan timer/subscription/connection, scoped failure isolation, disable at every await/send/commit boundary. |
| Package compatibility | Pinned build plus isolated packaged imports/startup | All shared imports/contracts staged; old JSON runtime can start without SQLite; exact native payload/contracts agree; no repository-relative imports remain. |
| Scenario/soak | Original runner + real P2 with fixtures only at external boundaries | Positive S01–S10 behavior as implemented, truthful required/unimplemented gates, capture/read/correction/forget races, bounded resource growth. |
| Native/GTA | Approved SDK build and exact installed payload; controlled scenario receipts | Actual source callbacks, owner-fiber behavior, qualified witnessing, playback, input priority and performance. Offline success is not this gate. |

Use Node 24 for Memory K Windows/Linux coverage and retain the documented legacy runtime gate for JSON/off mode. The existing top-level `tools/runTests.mjs` discovers only direct `tests/*.test.mjs`; nested memory suites need explicit discovery. Add an exhaustive suite inventory once, with narrow selections for local work and complete required discovery in CI. Do not conceal required scenario failures as successful skips. [Runner](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/lsa-essential-e1-candidate/tools/runTests.mjs), [source workflow](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/.github/workflows/memory-k-final-acceptance.yml).

Build/package suites write shared `dist/`; run them sequentially per checkout or give each job isolated output. Parallel test runners must not race on that directory. Each test instance gets its own database, writer lock, port, clocks and native fixture; all real outbound network calls remain disabled. Live provider and GTA tests stay separate explicit gates.

### 7.3 Mandatory capability combinations

Test these named profiles instead of every possible flag permutation:

1. Legacy JSON, Memory K absent/off: unchanged ordinary OpenAI/Gemini/P2 behavior and selected manual context; no new learned-memory side effects.
2. SQLite P2 only: editor/profile parity, migrations, crash recovery and privileged privacy; M2–M9 off.
3. Source core plus M2: ordinary event producers, PS2, PS3, PERCEIVED, cloud and Director off; exact player/NPC capture according to separate switches.
4. M3 events without M2 or PS3: qualified mundane observation reaches P2; unqualified second observer receives nothing.
5. Source core plus M2 player and M4: M3/M6/M7/M8/Director off; archived recall enters only PS4. A separate M2-off profile must report live recall blocked while retained-data queries remain testable.
6. Journal CONVERSE on, M4 and M8 off; then M4 on with journal CONVERSE off. Shared proof/privacy fences remain in both cases.
7. M5 conversational commands with M4/M6/M7/M8 off; inspector privacy with all automatic capabilities off.
8. M6 processing retained evidence with new capture off and M7 off: deterministic memory and restart-safe cursor advance, no cloud request.
9. M7 off/revoked/unavailable while recording and M6 continue; M7 on with authorized existing jobs while M6 scheduling is off.
10. M8 on with M7 off, then M4 factual contribution off: personality varies while facts and canon stay invariant.
11. Plain PS6 with callbacks off; M9 producer on with callback off; callback on only with valid M3/PS3/PS6; callback blocked with each dependency absent.
12. Global learned-memory pause during capture/read/cloud/Director preparation: no new optional send or uncommitted write, no old data resurrection, no effect replay.

For every enabled capability, inject a failure in each optional sibling and assert independence. For every disabled capability, assert zero intake/port calls, workers, timers, mutations, acknowledgments and outbound contributions attributable to that capability. Test dependency suspension and recovery with multiple characters, one temporarily missing owner, avatar changes and a timeline fork.

### 7.4 Acceptance criteria per capability

| Capability | Acceptance beyond common lifecycle/authority tests |
|---|---|
| M1 | One live writer; live second process refused; crash-era lock handled conservatively; atomic migrations/snapshots; JSON import and profile/editor parity; corrupted store never silently falls back to a new writable JSON history; restart/backend change explicit. |
| M2 | Exact UTF-8 accepted typed/STT content once; no provisional input; configured STT provenance; successful/ interrupted/failed NPC statuses and truthful reply linkage; accepted line survives later interruption; no fake player line from special events; each recording switch demonstrably suppresses its own writes. |
| M3 | Observation-time captureRef/index/incarnation/encounter/owner/host join; synchronous frozen receipt and bounded async intake; 2,500-event production-adapter stress; no salience dependency; loss is counted; coverage gaps recorded; no unauthorized negatives or promotion imports. |
| M4 / journal | Exact deterministic unambiguous quotes; archive labeling and bounds; source/tombstone/correction checks during read, retry and final fetch; current question excluded from historical counts; partial scans abstain; no stale RAM fallback; retained-data engine p95 target <=40 ms under 10k-row load. |
| M5 | Save/forget/correct success only after durable verified readback; ambiguous references clarify; compound commands atomic; cross-avatar clarification survives; counter-claims preserve witnesses; source/derived suppression survives purge/restart/curation; inspector remains confidential. |
| M6 | Committed eligible evidence only; save/optional enqueue before cursor CAS ack; crash at each step replays idempotently; no silent skipped page; suppressed sources never return; deterministic path complete without Luna. |
| M7 | No network/timer when off/shadow; persisted approval checked repeatedly; exact scope, model/pricing/budget and native-idle checks; abort on foreground activity/consent loss; uncertain sends conservatively accounted; queue retained through outage; cloud failure leaves capture/recall usable. |
| M8 | User-approved canon dominates; source history verified and sealed; differing personality interpretations retain identical facts; suppression/correction revokes derived outputs; repetition limits; no implicit cloud requirement. |
| M9 producer | Actual production project includes supported source; per-family native/GTA proof and PS2 qualification; unavailable families cannot be enabled; no extra scanner or unsupported inference. |
| M9 callback | No own grant/turn; exact original entitlement/native admission/PS4 registration; player priority/cooldowns respected; disable removes pending cue; submission never falsely claims native playback or human hearing. |

Measure M4 query time, whole memory preparation, every pre-send verification, and end-to-end turn latency separately. Before enabling each foreground contributor, establish an agreed end-to-end p95 regression budget against the same exact-head #138 baseline (cold and busy/restart, multiple NPCs); an M4-only 40 ms pass must not certify an otherwise slow complete turn. Under overload, drop optional unsent contributions or fail safely, never bypass freshness/privacy checks. WS-6 reports much higher preparation/verification cost than its M4 query cost. Keep the existing conservative SQLite change/source-generation fence initially; reducing invalidation on unrelated writes is a later measured optimization with new race tests, not a prerequisite refactor. Synchronous DatabaseSync work cannot be preempted merely by racing a timeout, so bound scans/batches as well as elapsed deadlines. [WS-6 implementation report](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/4dc5c6e4dae52927f2958116908742d3094d8ed8/docs/plans/promoted-npc-memory/memory-k-production/WS6-PARALLEL-COMPLETION.md).

## 8. Parallel capability workstreams and implementation order **on #138**

The rows are proposed **small PR boundaries targeting `integration/memory-k-production-20261012` (#138)**, not independent releases or PRs targeting `main`. They modify and reuse the substantial existing M1–M9 implementations already integrated in #138; do not recreate those systems. Split a row further only for safe review or demonstrable independent behavior. Every capability PR includes positive/negative tests, diagnostic reasons, and a default-off activation path. Scope can be accepted and integrated into #138 without pretending the whole product has passed S01–S10.

| PR | Scope and owned files/seam | Dependencies | Reviewable completion criterion |
|---|---|---|---|
| **A — baseline and test inventory** | Pin main/#138/#157 evidence; enumerate suite discovery, build outputs and S-gate status; CI discovery owner | None | Tests cannot disappear from discovery; exact-head receipts distinguish module/native/package/GTA gates. No default behavior changes. |
| **B — configuration and dependency descriptors** | New small runtime policy module; configuration normalizer/examples; existing health projection | A | Closed modes/IDs, explicit blockers, legacy mapping and pure resolver tests. No module started by the registry. |
| **C — composition and disposal** | `bootstrap.mjs`, minimal runtime service seams; instance disposer | B | One runtime owns every resource; initialization/partial-failure/shutdown tested; no change to D01/D02/D03 or Essential lifecycle. |
| **D1 — source/consumer separation, companion** | `intelligenceClient.mjs`, `shadowRuntime.mjs`, existing source subscriptions | B/C | D02/host/index/anchors stay current with PS2/PS3 processing off; complete envelope/sequence validation retained; old native peer supported. |
| **D2 — native source-only mode and producer gates** | `RuntimeEntry.cs`, `IntelligenceIntegration.cs`; existing native settings/owner update | D1 contract | Native authority samples remain valid with optional sensors off; no second scanner/fiber; exact native compile/host tests. Live controls can remain restart-required in this PR. |
| **E1 — P2 storage-only activation** | Existing canonical shared SQLite/profile/durability/timeline modules; Essential wrapper on #138 | A; B policy seam | Keep the present single writer/schema/privacy gates and add a P2-only startup profile with M2–M9 off. Do not extract storage files into `main`. |
| **E2 — privacy substrate and recovery** | Suppression, corrections, scoped transaction/read ports, replay revocation | E1 | Forget/purge/curation resurrection and cross-scope failures closed; mandatory privacy independent of optional M5 dispatch. |
| **F — M2 recording controls** | `essentialGlue.mjs` M2 seams, private D01/NPC recorder, runner and D03 | C, D1/D2, E2 | Player/NPC gates independently proven; fresh durable accepted-read boundary available to consumers; source and Essential acceptance invariants unchanged. |
| **G — M3 events/coverage controls** | `m3ProductionMemory.mjs`, shared M3 adapter/intake/coverage; bootstrap registration | C, D1/D2, E2 | M3 works without M2/PS3; each data sink gated; stress/loss/retirement scenarios and truthful coverage pass. Promotion grace may follow separately. |
| **H1 — journal conversation contribution** | Split #157 preflight's authenticated journal preparation and CONVERSE admission | F | Cross-session context works with M4/M8 off; privacy/pruning/RAM fallback tests at final send. |
| **H2 — M4 recall contribution** | M4 engine/read adapter and PS4 typed contributor; request fence | F, E2; coordinate H1 seam | M4 works without M8/M7/M3; 10k latency/quote/count/source races pass. Reuse #157 evidence policy; do not duplicate PS4 assembly. |
| **I1 — conversational M5 gate** | M5 coordinator and separated dispatch in foreground preflight | F, E2 | M5 works with M4/M8 off; durable statuses, compound clarification and correction/privacy regressions pass. |
| **I2 — inspector and runtime controls** | Existing editor/local control UI and scoped privacy facade | B/C, E2; consume ready modules | Authenticated mode/status controls, scope restrictions, global pause, export/delete/undo; no learned data in telemetry/model tools. Native live command is a separate addition if needed. |
| **J — M6 production orchestration** | Existing deterministic coordinator/cursor adapters; small trusted boundary wiring | E2 and available journal source (F or G) | Scene/idle/recovery path actually runs; idempotent save/enqueue/ack and off/re-enable replay tests; no M7 requirement. |
| **K — M7 production worker** | Existing Luna bridge/idle scheduler, persisted consent/budget/readback ports | E2, valid queue schema/jobs; J for new jobs | Off/revoke guarantees, authenticated idle, explicit consent UX, durable cost recovery; outage leaves other modules operating. |
| **L — M8 independent projection** | Existing interpretation/history reader and separate PS4 contributor | F/E2, common authenticated read seam | Works without M4 output or M7; canon/source history/forget and repetition tests. Broader personality features get subsequent PRs. |
| **M1… — each M9 native producer** | One event family per PR, native project inclusion, PS2 adapter | D2/G qualification seam | Supported family is compiled and physically qualified; no callback activation. Rollover/Wasted/Busted are separate gates. |
| **N — M9 memory callbacks** | Existing cue/witness/admission classes; small PS4/Director registration | G, H2 contributor seam, plain accepted PS6, available producer | Exact original grant/ticket/playback and priority tests; callback gate independent of plain PS6. |
| **O — #138 test profiles and release evidence** | Positive original S-scenarios, profiles, documentation and exact-package receipt tools | Incremental within #138; each scenario follows its capability | Module acceptance remains scoped and visible; full #138-to-main merge waits for S01–S10, approved native/package, physical GTA and soak evidence. |


### Canonical branch, safe parallelism, and integration ownership

1. **Canonical implementation:** #138 remains the single source of truth. Older #152/#157 and other specialist branches are historical source provenance, **not competing development targets**. Their code is already reconciled where merged into #138. Reuse it instead of cherry-picking entire snapshots.
2. **Small PRs, one destination:** every runtime implementation branch starts from the latest accepted #138 head, uses an isolated worktree, and opens a focused PR targeting #138. No direct pushes/force-pushes to #138; its integrator performs reviewed merges. A temporary conflict-resolution branch may be used when necessary, but must also target #138 and be retired afterward. Avoid long stacks of PRs targeting PRs.
3. **Shared-file ownership:** assign one integrator at a time to `bootstrap.mjs`, `essentialGlue.mjs`, `runSequentialTurn.mjs`, PS4/provider final-send hooks, `sqliteFoundation.mjs`, migrations, native project files, config normalization and CI discovery. Other agents deliver bounded adapters/factories/tests. Rebase or merge the latest #138 before integrating to avoid losing concurrent fixes.
4. **Foundation first:** A, then B/C; D1/D2 source separation and E1/E2 storage/privacy can proceed in parallel after shared contracts are agreed. Each accepted scoped PR lands on #138 with its own diagnostic/off/positive tests.
5. **Capture in parallel:** F (M2) and G (M3) follow the foundation independently. Do not allow optional capture gates to bypass D01/D02/D03, source, privacy or timeline checks.
6. **Foreground separately:** H1/H2, I1/I2 and L may be developed simultaneously against one authenticated read/contributor contract; only the designated owner edits the original runner and PS4 integration seams. Land and test each capability on #138 separately.
7. **Background and callbacks:** J requires committed journal evidence, K requires separate valid consent/jobs and does not block J, M9 native producer work can proceed separately, and N follows genuine PS6/native admission. O gathers exact-head acceptance progressively.
8. **Final merge is one release decision:** continue modular verification on the integrated #138 tree, rather than moving pieces to `main`. After source, complete S01–S10, native/package, physical GTA and soak gates all pass at a reviewed final SHA, separately review merging the entire #138 codebase into `main`. No assumption of production readiness from module-only success.

Every scoped PR must state its exact #138 base/head, changes to shared files, original source history preserved, effective/off modes, dependencies, module-positive tests, sibling isolation tests, source/native/package/GTA status and rollback behavior. Validate the final merged #138 head, not just the isolated feature branch. The plan preserves the monolithic *release unit* while providing modular runtime behavior and safe parallel engineering.

## 9. Compatibility and rollout

### Compatibility policy

- Keep current `main` unchanged throughout modular activation on #138. Its JSON P2, existing profiles/notes, optional perception/Director, voice, actions/playback and Gemini defaults remain the backward-compatibility baseline for the eventual single release.
- For #138's integrated experimental runtime (including merged #157), provide a versioned compatibility profile reproducing its current gated behavior. Do not silently turn on M1–M9 for existing SQLite installs. Emit a content-free notice of effective policy and expose explicit modes through the existing UI. These profiles are applied **within #138**, not as separate releases.
- Preserve existing `dialogueKnowledge.mode` semantics; new per-contributor memory switches control journal/M4/M8 output. A global privacy pause has higher precedence than both legacy and new mappings.
- New native/companion support is negotiated or validated through an explicitly versioned contract. Current validators reject unknown fields; do not append fields to old hello/frames and assume old clients ignore them. Where negotiation is unavailable, use the existing v1 path with restart-required controls and explicit unsupported status.
- JSON/off startup remains possible when `node:sqlite` is unavailable, as the foundation already intends. SQLite activation probes actual FTS5 support and fails visibly. Never silently write a second JSON store after SQLite failure.
- Turning off a worker does not downgrade schema or delete records. Switching SQLite back to JSON uses a reviewed restart/export procedure; the current rollback profile export does not represent all journals, timelines or derived memory.
- Preserve P2 backup/suppression policy in recovery: an old snapshot predating forget can resurrect confidential data. Before making a restored snapshot active, reconcile a current trustworthy suppression ledger or keep recovery read-only until an explicit reviewed procedure is satisfied. Do not promise privacy-safe restore from arbitrary old backups.
- M7 default decision O-1 remains open: retain the implemented consent-gated off default. O-2 remains conservative: native corroboration before provider work. Neither is resolved by a new deployment profile. [Open decisions](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/a099766fdd5df2553addb935e067032037c489c9/docs/plans/promoted-npc-memory/approved-decisions.md#L39).


### Rollout ladder — test/activation profiles within the same #138 build

These stages are independently diagnosable feature profiles and positive acceptance steps on **one evolving #138 integration**, **not incremental PRs to `main`**. Any physical GTA test still needs its own source/native/package prerequisite proof and user authorization; module acceptance does not imply product acceptance.

| Stage | Scoped enabled profile | Exit gate / rollback |
|---|---|---|
| 0 | New resolver/diagnostics; all new effects off | Current Essential/P2 parity, isolated packaged startup, no workers or incidental writes. |
| 1 | Opt-in M1 SQLite only | P2/editor parity, migrations, lock/snapshot and privacy recovery, storage/timeline portions of S07. Storage downgrade is not a simple live toggle. |
| 2 | Authenticated source core and M2 only | Original-runner typed/STT acceptance and native delivery, durable capture/reconnect, player/NPC switch independence. **Only M2 portions of S01/S09**; complete recall/correction scenarios require later consumers. |
| 3 | M3 independently; journal/M4/M5 each independently | Qualified two-observer/mundane event, memory retrieval, commands, final-send privacy races. Full S01/S04/S07/S09 when their complete positive traces and prerequisites pass. |
| 4 | M6 deterministic plus M8 without M7 | Scene/replay recovery, personality/canon, cursors, bounded resource load; no cloud or extra native ticket. |
| 5 | Separately consented M7 | Verified native idle, persistent consent/cost/abort/recovery; explicit live-provider authorization. Capture/M6 stay functional when M7 is off. |
| 6 | Each supported M9 producer and callbacks as separate gates | Actual native compile/project and physical witness proof, PS6 admission/priority/cooldown, disabling callbacks without disabling ordinary PS6. |
| 7 | Full #138 Memory K acceptance and release evaluation | Positive original S01–S10, exact-head Windows/Linux/package/native, approved physical GTA and multi-companion soak. **Only then consider a single #138-to-`main` merge.** |

Test and revert individual capability modes without copying the branch or deleting other capabilities' data. Preserve mandatory authority/privacy during every off/on change. A green module test is evidence for that module only; unresolved S01–S10 and full-release gates stay explicit blockers.

## 10. Architectural risks and mitigations

| Risk | Why it exists in this codebase | Required mitigation |
|---|---|---|
| Shared transport mistaken for optional perception | D02 and timeline source are carried by the perception client/runtime. | Source-core/semantic separation; keep freshness/index/retirement validation; test M2 with PS2/PS3 off. |
| Storage backend mistaken for enable-all | `storageMode=sqlite` gates current M2/M3 binding; foundation imports many later schemas/operations. | Explicit capability requests, canonical storage-only migration closure, no automatic worker activation. |
| Combined foreground preparation defeats independent switches | #157 prepares M5, journal context, M4 and M8 in one call and seals them together. | Shared authenticated read boundary with independent typed contributors; retain privacy checks for every retained contributor and conservative final-send fence. |
| Disable/re-enable revives stale work | Async DB/provider work, reconnects and repeated IDs can cross policy boundaries. | Monotone policy/source/consent generations, transaction/send rechecks, no reuse of retired leases. |
| Privacy becomes another optional feature | M5 suppression affects reads, replay, deterministic writes, cloud writes and backups. | Mandatory privacy substrate; adversarial forget/purge/restart/cloud races and recovery policy. |
| Overstated witnessing or negative knowledge | Coverage records are not an independent negative verifier; incomplete pages do not prove absence/counts. | Explicit unavailable/unknown results; positive sidecar proof, exhaustive supported-count queries only. |
| Runtime failure cascades or leaks resources | Global closer set, subscriptions and bootstrap catch blocks obscure ownership/diagnosis. | Instance disposal, narrow failure boundaries, safe reasons, resource counters and sibling fault tests. |
| Background work delays player turns | One serialized synchronous SQLite connection; WS-6 pre-send rereads can be costly. | Bounded scans/pages and background batching, foreground priority, measure complete preparation/revalidation; keep authority checks while optimizing later. |
| Native modules advertised from source files alone | M9 policy/harness code is absent from the inspected production project. | Actual compile/project/package support and producer receipts determine availability. |
| Divergent P2 ownership across branches/providers | Current audit records the ElevenLabs line's store/runner/protagonist divergence. | Separate reconciliation PR using the canonical store/authority; no second writer or provider-specific identity partition. |
| Integration loses repairs or tests | Historical #152/#138 divergence and shared glue/store/workflow edits; suite discovery is fragmented. | Current #138 as sole destination, history-preserving scoped merges, designated shared-file owners, exact-head suite inventory and reviewable PRs. |
| Monolithic integration becomes hard to audit | #138 remains a large unified release unit, even though runtime capabilities are independently controllable. | Preserve individual PR histories, per-module tests/receipts, unchanged off-defaults, complete regression inventory, final release diff/source review and explicit whole-product acceptance. |
| Green CI mistaken for release readiness | S scenarios remain red/unimplemented and native/GTA gates are separate. | Named scoped evidence tiers, explicit full-product NO-GO until original acceptance closes. |


## 11. Definition of completion for this implementation program

The modular-activation work is complete **on #138** when every supported capability has an explicit requested/effective state, dependency explanation, owned lifecycle, independent test entrypoint, safe off behavior, verified scoped positive path, rollback, diagnostics and proof that disabled siblings remain unaffected. Unsupported capabilities are unavailable rather than fake-enabled. Essential and ordinary P2 operate with optional automatic memory components disabled. Shared native authority, SQLite ownership, privacy and PS4 remain non-optional invariants.

The **entire Memory K product** is independently complete only after original S01–S10 and broader native/package/GTA/soak gates pass. Neither modularity nor staged #138 testing waives these. The final delivery decision is a **single reviewed integration of #138 into `main`**, not mandatory extraction into smaller `main` PRs. Keep #138 as the integration branch until that decision; do not duplicate implementation effort or start an additional mega-branch.



