# ASTRA-001 — Executive verdict

**Persistent ballistic & structural destruction for GTA V Enhanced** · investigated 2026-10-18 against `main` @ `c390840` and branch `research/next-gen-gameplay-experiences-20261018` @ `3eeb780`.

> **What was actually done:** a read-only audit of the repository (all 322 branches scanned for native code; PR #35 and the RPH 1.132 investigation read at exact SHAs), external research into GTA V Enhanced formats, natives, tools and policy, comparable games and libraries, and seven offline computational probes (five families, X-1…X-5) in a sandbox (scripts and outputs in [`offline-probes/`](offline-probes/)). **No GTA process was launched and no in-game test was run.** Every GTA-runtime claim below that is not marked *verified* is unproven.

## 1. Verdict in one paragraph

The dream is not blocked by physics or compute; it is blocked by **one architectural fact**: GTA's map collision is an immutable, pre-built streamed cache that no legitimate single-player interface can mutate at runtime, and map buildings are not script-controllable entities. Ordinary modding stops there — it can tune which *materials* bullets pass through and it can make *mod-placed* props destructible. The breakthrough proposed here is to stop trying to mutate GTA's world and instead **relocate collision authority**: for any structure, generate locally (between sessions) a *destructible twin* in which that structure's collision is excised from the static cache and re-hosted on entities the mod owns, keep an authoritative **World-Damage Truth** outside GTA, and treat everything GTA shows as a budgeted projection. Material-aware penetration can work across the whole unmodified city from day one; real holes, structural failure and persistence can work on any structure that has a twin; "everything destructible" becomes a progressive conversion program whose feasibility is decided by measurable thresholds, not by hope.

## 2. Status of each capability

| Capability | Status | Basis |
|---|---|---|
| Owner's exact runtime (GTA V Enhanced 1.0.1158.16, RPH 1.132.1428.17748), native calls from RPH plugins | **Known possible (verified)** | 162 RPH logs (`REPORT.md:114-115` @`3c67e1b`); LSA plugins' native calls ran in-game |
| Per-material shoot-through tuning in Enhanced | **Known possible (reported by mods)** | `materials.dat` penetration mods state Enhanced support (S-15) |
| Collision triangles classified by material, with density, penetration resistance, shoot/see-through flags | **Known (file format)** | CodeWalker `Bounds.cs` (S-04) |
| Fragments break and remove child collision; bullets apply `FragImpulse` | **Known (engine data/format)**; script parameters unknown | CodeWalker `Frag.cs`, parser dump b1158g9 (S-04, S-09) |
| Map-wide material-aware penetration (native first impact + thickness + energy model + native continuation bullet) | **Possible but unproven** | natives exist in gen9 DB (S-08); offline model sane vs FM 3-06.11 (X-1) |
| Real, traversable openings in **mod-built** walls | **Possible but unproven (likely)** | props/fragments collide natively; budget model X-3 |
| Real openings in **vanilla** Los Santos walls (excision twin) | **Possible but unproven — decisive unknown** | ybn format unchanged across editions (S-04 inference); Enhanced mods overlay exists (S-03) |
| Explosive breaches with physically scaled holes | **Possible but unproven** | blast model + FM charge anchors (S-36) |
| Causal partial collapse of converted structures | **Possible but unproven** | offline solver differentiates bridging vs collapse (X-2); events cheap with low-rank updates (X-2b); THE FINALS ships the method (S-20) |
| Exact persistence across streaming/restart/crash, scoped to a save lineage | **Possible but unproven (strong)** | no save hook is PROVEN (C-07) so a mod store is required; fixed-point replay exact (X-5); TimelineGuard exists |
| Max Payne-style bullet time/dives coherent with destruction | **Possible but unproven** | time scale + NM natives exist (S-08, S-10); ShootDodge on Legacy (S-17) |
| Runtime activation of vanilla twins via IPL swap; long-range collision of twins; portals into breached interiors | **Unknown** | pivotal for scale (E7a) |
| Usable entity/physics budget for mod projections in vanilla Enhanced | **Unknown** | only FiveM's raised pools are public (S-13) |
| Script Hook V on 1.0.1158.16 (C++ route) | **Unknown** | latest listed: 1158.13 (S-01) |
| Mutating or re-streaming static map collision at runtime | **Currently blocked** for legitimate SP modding (fragile even with deep hooks) | FiveM source (S-13) |
| Creating new meshes/collision assets at runtime in SP | **Currently blocked** | no API; startup-only asset loading |
| Physically *true* collapse of hollow-shell buildings | **Blocked by content** (structure is not in the data); only labelled synthesis | S-07, H8 |
| Pre-fracturing all of Los Santos | **Rejected** (0.9–24 TB envelope at 0.5 m; budgets) | X-4 |
| NPCs pathing through new openings | **Blocked at runtime**; latent-navmesh research only | S-08 |

## 3. Best architecture hypothesis

**C6 — Latent Destructible Twins over a decoupled World-Damage Truth** (doc 02 §8):

1. **WDT** — authoritative, fixed-point, event-sourced damage truth for the whole city (cheap: ~2 MB per 100k impacts), timeline-scoped, fingerprinted.
2. **Projection tiers** — P0 decals · **P1 ballistic oracle everywhere** (real penetration on the unmodified map) · P2 real collision via twins · P3 structural solver · P4 RAGE debris.
3. **Twins** — generated locally from the owner's install: excise the structure's collision from the static cache; pre-slice the vanilla drawable into a hierarchy (whole structure → groups → panels → damage pieces) so visuals stay vanilla and entity counts scale with *damage*; infer a baseline-relative structural skeleton (synthetic parts labelled); add latent portals/nav links.
4. **Activation** — permanent replacement first; dual-state IPL swap if E7a proves collision follows IPL state.
5. **Specialist solvers on a shared consequence bus** — ballistics (Poncelet/plugging), cutters (seeded, deterministic), structure (event-driven sparse solve with low-rank updates), debris (RAGE native), persistence (event log + snapshots). No universal physics engine.

## 4. Recommended first research experiment

**E0 — Capability census** (doc 04): one session, a separate RPH lab plugin built against the official SDK, no custom assets. It settles material hashes, exit-face probing, per-round impact capture, continuation-bullet attribution, prop-collision removal latency, fragment-break semantics, entity budgets, explosion intake, vanilla IPL collision behaviour and time scaling — the cheapest unknowns that route every architecture.

**First decisive experiment — E2b "Excision Twin":** make one wall of an existing Los Santos building genuinely destructible by excising its static collision in a local OpenRPF overlay, re-hosting it on a twin, and carving it with repeated fire. Acceptance: zero phantom collision where the twin is open (≥ 300 probe cells), intact twin stops 200/200 rounds, three stable 30-minute sessions. **This single result decides whether "everything destructible" is an asset-conversion problem (tractable) or an engine-modification problem (much harder).**

## 5. The single most valuable invention to pursue next

**Collision-authority relocation with latent destructible twins** — make vanilla structures mutable by moving their collision, offline and locally, from GTA's immutable static cache onto mod-owned entities (activated at runtime), instead of mutating the engine. It converts the hardest blocker (H1/H2) into an asset pipeline, keeps everything on legitimate tools, and composes with every other component (penetration, kits, fragments, solver, persistence).

## 6. Strongest alternative

**C5 "deep engine" (with C4 solvers):** a native hook layer that edits loaded static bounds in memory (polygon removal/BVH refit), registers runtime-generated drawables into streaming, and hooks bullet processing. It is the only route that could make *any* vanilla wall destructible mid-session without conversion. It loses on stability (FiveM documents crashes around exactly these stores), update churn, Enhanced DX12/RT complexity and legal/maintenance risk. Keep it as a lab track for one blocker at a time — opened only if E2b or E7a fail.

## 7. What would prove this verdict wrong

1. **E2b fails on three buildings** (Enhanced will not load edited collision, or invisible collision survives excision) → the existing map cannot be made destructible through assets.
2. **E0.5/E2a show phantom collision** after deleting or breaking projected entities → entity projection is unsound.
3. **E0.4/E1 show native impacts cannot prove most rounds at automatic fire** → honest per-round penetration needs engine hooks.
4. **E0.6 shows continuation bullets cannot be attributed or self-hit** → P-D3 fails; penetration needs a different damage authority.
5. **E0.9 usable entity budget < 300** → twins cannot show heavily damaged areas at useful density.
6. **E7d twin generation > 1 h or > 2 GB per typical building, or > 50 % manual fixes** → city conversion infeasible.
7. **E4 shows outcomes insensitive to which support failed, or inferred structures failing at rest** → baseline-relative inference does not produce believable causality.
8. **Any E5 restore mismatch that survives fixes** → the persistence model is unsound.

## 8. Where ordinary modding ends and novel research starts

| Ordinary (if laborious) modding | Novel research |
|---|---|
| Tuning shoot-through materials; decals; Rockstar's canned rayfire scenes | Proving each round's path and continuing it through materials with native attribution (BQ-2) |
| Destructible **mod-placed** props/fragments | Excising and re-hosting **vanilla** collision in Enhanced (BQ-1) |
| Spawning debris props | Bounded-cost vanilla-faithful fracture via pre-slicing and hierarchical demotion (BQ-3) |
| Time scale + dive scripts | Causal collapse from inferred structure with RAGE handoff (BQ-4) |
| Saving a few flags to a file | Exact, timeline-scoped, version-safe persistence of arbitrary structural state (BQ-5) |
| Converting one map mod by hand | Just-in-time local conversion of districts/the city (BQ-6) |

## 9. Confidence (subjective, evidence-weighted)

| Claim | Confidence |
|---|---|
| Material-aware penetration on the unmodified map is achievable without engine hooks (Core 1) | ~75 % (E0.4/E0.6 decide) |
| Real openings in mod-built walls (Core 2, mod structures) | ~85 % |
| Real openings in vanilla walls via excision twins (Core 2, existing map) | ~55 % (E2b decides) |
| Plausible, causal partial collapse of small converted buildings (Core 3) | ~50 % |
| Exact persistence (Core 4) | ~80 % |
| Block-scale destruction with runtime activation | ~35 % |
| Most of Los Santos destructible with vanilla visuals using today's legitimate tools | ~10–15 % (needs R6 measurements; not promised) |

## 10. Decisions only the owner can make

1. **D-001 scope (LOCKED decision):** destruction needs native world mutation that Essential does not provide. Either confirm the narrow reading (D-001 governs NPC task/session/playback lifecycles; a world-physics subsystem that never tasks peds is outside it) or host the subsystem in the standalone native core. Until then it exists only as the isolated lab plugin (doc 03 P-D1).
2. **A new non-character World State Store** next to P2 (doc 03 P-D2; D-003 stays as is).
3. **Lab exception for NPC shooters** in E1/E6, or run those parts with lab-spawned peds outside Essential's management.
4. **Physics-calibrated vs. fun-tuned modes:** the FM 3-06.11 anchors define a "physics mode"; how far a "fun mode" may deviate is a design choice.
5. **Whether to open the C5 lab track** if E2b or E7a fail.

## 11. Dossier

1. [01 — Current capability and engine evidence](01-current-capability-and-engine-evidence.md) — exact-revision audit, engine/mod/library evidence, offline probe results, verified/unknown/contradicted matrix, source registry.
2. [02 — Architecture candidates](02-architecture-candidates.md) — six candidates (incl. the novel C6 and sub-inventions N-a…N-g), diagrams, constraints, comparison.
3. [03 — Ballistics ↔ geometry ↔ structure ↔ persistence contract](03-ballistics-geometry-structural-persistence-contract.md) — authority proposals, data flow, invariants, failure handling, 32 unverified capabilities.
4. [04 — Falsifiable experiment ladder](04-falsifiable-experiment-ladder.md) — E0–E7 with hypotheses, falsifiers, thresholds, controls.
5. [05 — Breakthrough questions and roadmap](05-breakthrough-questions-and-roadmap.md) — ten moonshots, dependency graph, infeasibility thresholds, phased roadmap.
6. [`offline-probes/`](offline-probes/) — the seven executed sandbox computations (scripts and raw outputs; see its README).
