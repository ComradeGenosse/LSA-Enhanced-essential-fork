# Seven provisional development programs — consolidation hypothesis

> **2026-10-18 | Research grouping only.** The seven buckets are not locked architectural modules, branch boundaries or a recommended build order. All 28 player-facing experiences stay separate.

## 1. NPC World Intelligence

**Selected ideas:** #1 (NPCs that actually understand what you're doing); #7 (NPCs that can see the game like you do); #25 (Characters understand how you sound, not just what you say); #30 (NPCs possess genuine spatial memory); #39 (NPCs understand and anticipate real-world physics).

**Reason for grouping:** A shared, source-grounded picture of situations, vision, vocal cues, locations and physical risk. Distinct sensors and prediction models may remain independent.

**Preserve:** The numbered experiences' distinct acceptance questions in [28-favorite-experiences.md](28-favorite-experiences.md). Shared infrastructure is allowed; flattening their gameplay goals is not.

## 2. General-Purpose NPC Physical Intelligence

**Selected ideas:** #12 (NPCs that can learn new physical abilities); #28 (AI improvises physical interactions with the environment); #32 (NPCs can change their minds); #38 (AI discovers GTA mechanics we haven't programmed).

**Reason for grouping:** Discoverable capabilities, composable skills, feedback and replanning. Experimental native discovery must not be conflated with live NPC freedom.

**Preserve:** The numbered experiences' distinct acceptance questions in [28-favorite-experiences.md](28-favorite-experiences.md). Shared infrastructure is allowed; flattening their gameplay goals is not.

## 3. AI Game Master & Adventure Generator

**Selected ideas:** #3 (AI-generated adventures); #6 (AI that can improvise entire action scenes); #20 (An AI Game Master that invents gameplay); #23 (Fully improvised missions); #72 (AI-generated immersive experiences inside GTA).

**Reason for grouping:** Common experience orchestration, outcome tracking and intervention controls. Outings, action scenes, missions and genre experiences remain distinct modes.

**Preserve:** The numbered experiences' distinct acceptance questions in [28-favorite-experiences.md](28-favorite-experiences.md). Shared infrastructure is allowed; flattening their gameplay goals is not.

## 4. Character Personality, Social & Cinematic Performance

**Selected ideas:** #13 (Spontaneous humor that actually develops); #14 (AI-directed cinematic moments); #15 (NPCs can negotiate anything).

**Reason for grouping:** Common character context, motivations and expressive timing; separate negotiation state/actions from presentation controls.

**Preserve:** The numbered experiences' distinct acceptance questions in [28-favorite-experiences.md](28-favorite-experiences.md). Shared infrastructure is allowed; flattening their gameplay goals is not.

## 5. Persistent & Generative Los Santos

**Selected ideas:** #40 (LSA can invent entirely new gameplay mechanics); #41 (Los Santos physically remembers everything you've done); #45 (AI-generated explorable interiors).

**Reason for grouping:** Potentially shared content, persistence and lifecycle services; executable mechanics, persistent environment changes and generated spaces are separate hard technical challenges.

**Preserve:** The numbered experiences' distinct acceptance questions in [28-favorite-experiences.md](28-favorite-experiences.md). Shared infrastructure is allowed; flattening their gameplay goals is not.

## 6. Next-Generation Physics & Destruction

**Selected ideas:** #81 (Actual destructible buildings and environments); #82 (BeamNG-level vehicle destruction); #93 (Physics-based demolition missions); #95 (Real fire propagation and environmental disasters); #98 (Burnout-style vehicle combat and stunt physics); #100 (A fully dynamic destruction-and-physics playground).

**Reason for grouping:** Common exposed consequences and integration, but likely different specialist solvers: structures, vehicles and fire. #93 reuses #81; #98 reuses parts of #82; #100 is the integration flagship.

**Preserve:** The numbered experiences' distinct acceptance questions in [28-favorite-experiences.md](28-favorite-experiences.md). Shared infrastructure is allowed; flattening their gameplay goals is not.

## 7. Cinematic Combat & Tactical Teams

**Selected ideas:** #90 (Max Payne-style cinematic gunfights); #94 (A real tactical AI squad).

**Reason for grouping:** Shared tactical awareness and combat evidence, while moment-to-moment combat feel and squad coordination remain independent gameplay features.

**Preserve:** The numbered experiences' distinct acceptance questions in [28-favorite-experiences.md](28-favorite-experiences.md). Shared infrastructure is allowed; flattening their gameplay goals is not.

## Particularly promising engineering reuse
- **#81 + #93:** a destruction-capable structural environment provides *mechanics*, while demolition missions supply objectives, progression and player mastery.
- **#82 + #98:** vehicle crash/damage information can be shared, but serious mechanical damage and playful arcade takedowns need separate tuning and feedback.
- **#20 supports #3/#6/#23/#72:** candidate shared orchestration and consequence verification; each remains a distinct player experience.
- **#7 + #28 + #94:** grounded perception can empower spatial improvisation and coordinated squads without automatically requiring a universal visual planner.
- **#41 + #45 + #81:** generated explorable spaces and destructible states may reuse persistent world-state tooling if actual geometry/collision research supports it.
- **#6 + #14 + #90:** emergent playable action scene, cinematic presentation and responsive gunfighting can combine into an especially fun moment.
- **#38 + #12 + #32:** independently discovered/reusable capabilities can support learned skills, feedback and replanning.

## Research cautions
- Structural destruction, deformable vehicle mechanics and fire propagation are likely *different* simulation problems; a single universal physics solver is not an assumed requirement.
- #40 (invent executable game mechanics) is distinct from #72 (assemble new experiences using existing mechanics).
- #20 is an overall player-experience director; it must not pretend a proposed event physically happened or override player agency.
- #14 is cinematic *presentation*, while #6 is the underlying physically playable action.
- #15 requires verifiable bargains and consequences beyond generated dialogue.
- #100 should be evaluated as a coherent interactive sandbox **integration goal**, not an all-or-nothing prerequisite to shipping #81/#82/#95.
- #90 and #94 can share combat facts but are distinct modes: responsive personal action versus multi-character tactical coordination.

## No-loss traceability
Every selected ID occurs in exactly one provisional program: **28 mapped / 28 selected**. An idea may enable other programs through dependencies/crossovers without being duplicated or erased.
