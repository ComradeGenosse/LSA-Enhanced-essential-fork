# Research-to-master-plan workflow

> **Current step: Phase 1 / player experience definition.** This is a proposed process, not a claim that its investigations or experiments are complete.

## Phases, outputs, and completion gates

### 1. Define the desired player experiences — **FIRST PHYSICS INTERVIEW COMPLETE; OTHER IDEAS DRAFT**
**Output:** [28 experience cards](28-favorite-experiences.md) with vivid player moment, dream, first fun slice, irreplaceable flair, and experiential acceptance question. Collect edits/preferences and obtain player sign-off **per idea**, not a single blanket approval. Keep all IDs stable.

**Exit:** Selected ideas approved/revised/parked; no hidden assumptions about autonomy, permission, persistence, performance, or surprise events. **Physics scope clarification completed 2026-10-18:** [ballistics-destruction vision](ballistics-destruction-vision-20261018.md), preserving user answers and separate researcher-proposed test ladders. Other idea cards still require review.

### 2. Audit the real LSA capability baseline
**Output:** current main/branches source map, observed runtime behavior, available native actions, perception, memory, character identity, activity receipts, director, animation, world state, persistence, input/UX, and actual installed GTA evidence. Connect *each capability* to supported dream/first-slice features.

**Exit:** reproducible references and evidence tiers. Do not infer in-game performance from registry declarations or synthetic CI.

### 3. External engine/mod/gameplay research
**Output:** researched GTA V Enhanced/RAGE/RPH/native/streaming/physics/collision/navigation constraints; reusable existing mods (with licensing/compatibility analysis); and game-design lessons from cited examples (Teardown, BeamNG, The Finals, Max Payne, etc.). Separate documented engine facts, observed mod behavior, and speculation.

**Exit:** per-idea candidate approaches and constraints, plus clearly defined unknowns.

### 4. Shared foundation and dependency architecture
**Output:** evidence-backed clustering (revisit 7 provisional programs), dependency graph, stable capabilities/API interfaces, reuse boundaries, and distinct feature acceptance checks. Look for narrow shared services, not a mega-engine by default.

**Exit:** major shared dependencies, blockers, optional dependencies, and parallelizable work mapped without losing any selected idea.

### 5. Tiny risk-reduction experiments
**Output:** small isolated prototypes of the hardest assumptions. Example: destructible wall with updated collision; one structured visual scene-grounding proof; verifiable generated 3-step mission; physics damage impacting one vehicle subsystem. Capture real performance, failure evidence and reproducibility.

**Exit:** risk claims labeled verified/unverified/disproven, with exact builds, environment, outcomes and limitations.

### 6. Astra breakthrough dossiers
**Output:** for genuinely unsolved research challenges, one brief per boundary: dream target, concrete success criterion, current facts/source citations, explored alternatives, failed experiments, constraints, cost/performance envelope, and specific open questions. Astra asked to invent and test architectures for *unsolved capabilities*, **not ordinary bugs**.

**Exit:** research conclusion/prototype/design judged against a verifiable gate; inconclusive results preserved.

### 7. Final overarching master development plan
**Output:** accepted feature definitions, chosen foundational systems, implementation waves, cross-project contracts, prototypes, integration/rollout/test gates, and milestone dependencies. Preserve all 28 individual gameplay goals.

**Exit:** user approves sequence and priority. Only then translate into implementation PRs.

## Standard research record per idea
| Field | Meaning |
|---|---|
| Idea ID + player experience | Stable original number and user-approved dream + first fun slice |
| Existing LSA support | Source paths, branch/main SHA, runtime feature mode and *actual* test level |
| GTA/engine affordances | Engine documentation/mod source/experimental evidence |
| Candidate approaches | Pros, limitations, reuse and licensing/compatibility |
| Distinct technical risks | Unknowns and reasons, not vague “hard” labels |
| Dependencies | Mandatory vs optional, shared vs feature-specific |
| Experiment | One concrete test and observable pass/fail evidence |
| Astra threshold | Unsolved after credible research/experiments; high potential payoff |
| Stage/owner/status | Design-only, researched, prototype, verified, blocked, parked |

## Ready-to-run Astra investigation prompt
See [ASTRA-001 — Ballistics and Structural Destruction Research](ASTRA-001-BALLISTICS-DESTRUCTION-RESEARCH-PROMPT.md). This is an **investigative bootstrap**, not a claim Phases 2–5 are complete: Astra is instructed to perform source and external research, contrast architectures, and design falsifiable experiments **before** any implementation. It must label limits rather than asserting established physics integration. The user-defined target remains physically meaningful, persistent destruction across Los Santos.

## First Astra candidate research direction
The [ballistics-destruction vision](ballistics-destruction-vision-20261018.md) is sufficiently defined as a **research question**, but there has not yet been a source/engine audit or proof-of-concept. Next actions for this candidate: map current GTA Enhanced/LSA ballistic, collision, geometry and persistence affordances; survey existing mods and source/libraries; identify competing physics/structural architectures and decisive experiments. **Do not require broad AI NPC, generalized sandbox, or #95 fire features.**

## Existing repo research anchors (not a completed audit)
- [Canonical LSA roadmap](../ROADMAP.md) — last described as audited October 17; check newer `main` on every new investigation.
- [Implementation status matrix](../IMPLEMENTATION-STATUS-20261017.md).
- [Source ownership](../research/system-ownership-matrix.md) and [contracts](../research/system-contract-register.md).
- [Dependency synthesis](../research/system-convergence-dependency-graph.md).
- [Next phase work packages](../NEXT-PHASES-20261017.md).

**Initial inferred reuse, to be verified in Phase 2:** PS perception/context for #1/#7/#39; P2 memory/identity for #13/#30/#41; ACT action-planning/execution for #12/#28/#32/#94; Scene Director for #3/#6/#20/#23; voice/performance for #14/#15/#25. This does *not* establish present support for dream-level behavior.

## How to avoid accidental premature commitments
- Do not make branch docs authoritative over accepted gameplay or existing mainline contracts.
- No giant implementation PR, no gameplay code changes, no forced decision on “seven programs”.
- The initial playable slices are **proposals for discussion**, not promises or reductions to the dream.
- Preserve all 100 archived ideas and all 28 selected ideas even if some are parked.
- Do not demand a full autonomous AI society if the player only wants a fun mechanics-based sandbox.
