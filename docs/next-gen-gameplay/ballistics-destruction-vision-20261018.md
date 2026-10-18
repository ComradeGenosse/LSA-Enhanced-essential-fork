# LSA — Ballistics, Destruction & Structural Physics: player-approved vision

**Date:** 2026-10-18  
**Status:** User vision interview complete and captured. Research, feasibility, prototypes and implementation decisions **not yet completed**. This is the authoritative *player-intent description for the first Astra candidate*, not a commitment that GTA V Enhanced supports the requested systems.

## The player's actual goal

> Realistic bullet physics: shoot through walls; bullet penetration; bullets removing chunks of objects and walls; explosions taking out bigger chunks; and eventually bringing down buildings.

This is **not** primarily a Garry's Mod-style general physics playground, and the user does not want a general AI civilization, NPC physics-agent autonomy, or environmental fire as prerequisites. The thrill is physically consequential *shooting and destruction* that changes the world.

**Fantasy:** In ordinary GTA gameplay, shoot at a wall and rounds pass through materials appropriately, chipping away actual pieces instead of only making decals. Continue firing to open a new line of sight or passage. Explosives tear out larger sections. If load-bearing parts fail, floors or entire buildings can collapse in plausible ways; bridges and major structures are included in the long-term ambition. When returning later or restarting a session, the altered world is still there. Max Payne-like gunplay—dives, slow motion, dynamic physical impacts—makes these changes thrilling to play.

## Exact vision interview results (9 questions)

1. **Destruction extent:** Holes through walls, knocking out floors, collapsing entire buildings and bridges. **Dream: everything destructible**, not just specially selected buildings.
2. **Structural behavior:** Wants realistic, causally meaningful collapse, including the consequences of removing supports, despite expecting this may be extraordinarily hard. Convincing spectacle alone is not the goal.
3. **Vehicles:** **BeamNG realism over Burnout insanity.** Keep advanced damage as a separate, related ambition, not the center of this first investigation.
4. **Fire/disasters:** **Explicitly withdrawn from this investigation:** “scratch the fires lets lose that tht seems too ambitious.” #95 remains documented in the historical 100-idea archive, but is no longer an active requirement here.
5. **Combat:** Max Payne-style shoot-diving/bullet time, realistic ragdolls and dynamic hit reactions. **Bullet penetration is especially important** because it must interact with holes and broken walls.
6. **General physics sandbox:** Not a priority. Focus on realistic bulletplay and environmental destruction rather than generic pickup/tether/crane experimentation.
7. **NPC integration:** Nathan and other NPCs do **not** need new destruction-use or physics reasoning abilities yet.
8. **Persistence/performance:** **Persistent world** is a core goal; destruction should endure beyond leaving the area and across GTA sessions/saves where valid. Willing to accept **very large FPS penalties** for correct physics initially and optimize later; no numeric FPS floor was specified.
9. **Ideal first thing to try:** Shoot through walls with believable penetration; bullets take out chunks; explosions cause bigger fractures; ultimately reduce buildings to collapse.

The prior brainstorming's #100 “Unified Physics Playground” name is retained for traceability but **its active research scope is narrowed and made much more specific**: realistic ballistics and destructible world with structural physics; #90 combat is an explicit partner capability. This does not erase #82/#98 vehicle realism or #93 demolition gameplay from the longer-term favorites.

## Research priorities and scope

| Order | Player experience | Selected ideas | Definition and non-negotiable flair |
|---|---|---|---|
| **Core 1** | **Material-aware bullet penetration** | #90 + #81 | Projectiles/impacts produce believable entry, exit, penetration and stopped-round behavior across walls and other surfaces; physical holes must matter. Not merely a VFX decal, invisible hit-through toggle or altered damage multiplier. |
| **Core 2** | **Projectile-driven destructible geometry** | #81 + #100 | Repeated bullets erode/chip actual portions of world geometry, changing cover, openings, line of sight and collision where appropriate. Damage is proportional and materially meaningful. |
| **Core 3** | **Explosive destruction & structural collapse** | #81 + #93 + #100 | Bigger damage from explosives, load paths/supports, localized floor damage and whole-building/bridge collapse. Actual physics must govern consequences; avoid guaranteed canned collapse for every explosion. |
| **Core 4** | **Persistent modified world** | #41 + #81 + #100 | World damage reappears when the player returns and across valid restarts/save lineages, with coherent collision and safe restoration/rollback. It is part of the vision, not an optional afterthought. |
| **Companion gameplay** | **Max Payne-inspired shooting feel** | #90 | Bullet-time diving, responsive shoot-dodge, believable ragdolls/hit reactions. The central novelty is their interaction with penetrable/destructible surroundings, not bullet time alone. |
| **Adjacent, secondary** | **Vehicle deformation and damage** | #82, #98 | Prefer mechanical realism/handling consequences over arcade Burnout exaggeration. Preserve for later dedicated research; do not force a new vehicle solver into the first ballistic destruction investigation. |
| **Potential gameplay layer** | **Demolition challenges** | #93 | Optional contracts/challenges exploiting real destruction. No player requirement yet to prioritize gamified demolition over unscripted free-play destruction. |

### Out of scope for this initial Astra frontier
- **#95 spreading fire, wildfires and disasters:** explicitly dropped from the current vision.
- NPC physical-reasoning integration, Nathan autonomous physics manipulation, squad behavior: not required for the first breakthrough.
- General playground tools (rope/tether systems, physics construction, cranes, object pickup): not the desired focus.
- Burnout-first arcade stunt/vehicle combat as a required component of the destruction proof.
- Procedurally creating all GTA content or remaking the entire GTA engine without clear evidence of necessity.

### Deliberately ambitious, NOT quietly reduced
- **Every building destructible** is the long-term ambition, including bridges. An isolated wall prototype is a research test, *not* a redefinition of the feature as “a few preselected destructible walls.”
- **Plausible physics** is an explicit goal; purely scripted/animated collapse is at best a fallback to evaluate transparently, not a disguised full success.
- **Persistent physical state** matters, including gameplay-relevant collision/openings, not just saved scorch textures.
- Heavy performance cost is initially acceptable, but the investigation should still quantify resource requirements and identify possible future optimizations, not assume infinite RAM or compute.

## Gameplay demonstration sequence (research targets; not implementation commitments)

1. **Penetrate:** Fire through multiple test materials. A target or object behind a suitable wall is affected only if the projectile plausibly passes through; solid stopping material resists appropriately. Compare entry/exit effects and physical geometry against collision checks.
2. **Erode:** Repeated fire breaks chunks out of one wall. The resulting opening becomes usable for lines of sight, projectiles, and eventually movement as appropriate—not just a decal.
3. **Blast:** An explosion removes a much larger, physically consistent portion of structure. Nearby geometry and debris reflect the actual damage.
4. **Collapse:** Damage supports/floor elements and watch a structure fail based on stability/load consequences, not a fixed cinematic animation.
5. **Remember:** Leave the zone, reload the world or restart GTA, and revisit the damaged structure. Its changed collision, geometry and appearance remain consistent.
6. **Fight inside it:** Perform Max Payne-style dynamic gunplay while rounds and explosions affect surrounding cover; visible hit reactions/ragdolls integrate with the changing environment.
7. **Scale the ambition:** Investigate what prevents extending from one proof structure to arbitrary vanilla buildings, multi-floor structures and bridges. Report scalability/fidelity tradeoffs honestly.

A test success is not evidence that the GTA world can already do this at city scale. Each level of demonstration must be identified separately.

## Astra: the actual research problem

**Find credible ways to give GTA V Enhanced materially correct, persistent, runtime-destructible environments and meaningful ballistic penetration at progressively larger scales, ultimately aiming for virtually all structures, including large buildings and bridges, without assuming GTA's original engine natively supports any of it.**

Astra's job is not to fix incidental bugs, implement an attractive illusion, or simply enumerate existing mods. It is to assess truly different architectures (engine-native augmentation, destructible proxy/collision replacement, external solver coupled to game world, offline-converted assets and hybrid approaches, or genuinely novel alternatives), identify fundamental limits with evidence, propose decisive experiments, and, where feasible, invent approaches that break through existing constraints.

**Important:** We have defined the *player experience* and *research destination*. A rigorous Astra brief must also contain a current-main source/engine capability audit, external mod/physics research, licensing issues, and experimentable hypotheses. Those are the **next research tasks**, not facts established by this interview.

## Scope and sign-off
- **Player-confirmed (2026-10-18):** all nine answers summarized above and the narrower realistic-ballistics/structural-destruction focus.
- **Assistant-proposed (not yet separately approved):** ordering of core modules, the staged demonstrations, fallback architectures, integration order and acceptance mechanics.
- **Not decided:** detailed material model, penetration accuracy, precise projectile representation, failure models, persistence implementation/save compatibility, initial prototype location, time budget, test assets, final technology, performance goals after proof, and whether vehicle work gets its own Astra dossier.

## Relationship to other idea documents
- [28 favorite experiences](28-favorite-experiences.md) remains the record of the original selected set, including ideas deferred from *this* investigation.
- [Seven provisional programs](provisional-programs.md) is an older conceptual grouping, superseded **for Physics Playground priority and scope only** by this player interview.
- [100 idea archive](100-idea-catalog.md) remains unchanged historical context; no deletion from the brainstorm.
