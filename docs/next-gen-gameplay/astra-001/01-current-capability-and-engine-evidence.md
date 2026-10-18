Warning: truncated output (original token count: 13342)
Total output lines: 330

# ASTRA-001 · 01 — Current capability and engine evidence

> **Dossier:** ASTRA-001 persistent ballistic & structural destruction for GTA V Enhanced.
> **Date of investigation:** 2026-10-18 (all web sources accessed this date unless noted).
> **Mode:** read-only source audit + external research + offline sandbox computation. **No GTA process was launched, nothing was installed or deployed, and no gameplay code was changed.** Every "executed" result below is an offline computation in a Linux sandbox (2 vCPU Xeon @ 2.1 GHz, 7 GB RAM), never an in-game test.
> **Player intent source:** [ballistics-destruction-vision-20261018.md](../ballistics-destruction-vision-20261018.md) (read in full before drawing conclusions).

## 0. Evidence labels used in every ASTRA-001 document

| Label | Meaning |
|---|---|
| **V-GTA** | Proven in the owner's exact GTA V Enhanced build by recorded logs/observations in this repository. |
| **CODE** | Code exists on `main` or a named branch, but is **not** GTA-accepted. |
| **DESIGN** | Design-only roadmap/contract text. |
| **MOD** | Reported by an external mod, tool page or community documentation; not independently verified here. |
| **PRIMARY** | Primary technical source: engine-format tool source code, SDK documentation, parser dumps of the actual Enhanced build, published engineering talks, official policy pages. |
| **X-OFF** | Offline computation executed in this session (scripts and outputs in [`offline-probes/`](offline-probes/)). Not a GTA result. |
| **INFER** | Informed inference from the above. |
| **SPEC** | Speculative proposal. |
| **UNKNOWN** | No adequate evidence; needs an experiment. |

Repository citations use `path:line` at an exact commit. External citations use the `S-nn` registry in §10.

## 1. Exact revisions audited

| Object | Revision | Notes |
|---|---|---|
| `main` (latest at audit time) | `c390840aba02f6e20480421f5a2a9872772890fc` (2026-10-18 16:44 −04:00, "OBS: distinguish native-owner pause…") | Same SHA the research branch was created from; 0 commits newer at audit time. |
| Research branch | `research/next-gen-gameplay-experiences-20261018` @ `3eeb78032b48fa887aa2609e41ddca7225bb63ee` | 3 docs-only commits ahead of `main`. |
| PR #35 Contextual Ballistics | `feature/contextual-ballistics-perception-r0` @ `9b1e37dc069885fb144f7e6b7126242700faa5e1` | Draft, open, 17 files, 0 behind `main`. |
| RPH 1.132 investigation | `analysis/rph-1132-investigation-opus55` @ `3c67e1b4d53d03b1ede5910edb6d44b516841b9c` | Source of the owner's runtime/build evidence. |
| Branch survey | all 322 remote branches (2026-10-18 21:3x UTC) | Scanned for C/C++/ASI sources and physics code. |
| CodeWalker (engine-format reference) | `dexyfex/CodeWalker` @ `485d56bec00262ed7fa472261cce7bbc6202b96e` (2025-04-11) | Read-only source reading (MIT-style licence, `Notice.txt`). |
| Native database | `alloc8or/gta5-nativedb-data` @ `424fb51b089049a9fbcebcc641500b1d44d255b4` (2026-09-15) | `natives.json` + `natives_gen9.json`. |
| Parser dumps of the Enhanced build | `alexguirre/rage-parser-dumps` @ `2cf8d0b4a37c49db0d765a023d3f82b3279f0a92` (2026-10-18), file `dumps/gta5/b1158g9.json` | Hashed reflection metadata of build 1158 (gen9). |
| NVIDIA Blast/PhysX | `NVIDIA-Omniverse/PhysX` @ `b97365c6ddb32fda8469bc788ec18024862b0368` (2026-10-15) | BSD-3-Clause. |
| RPH SDK documentation | NuGet `RagePluginHook` 1.124.0 (`lib/net472/RagePluginHook.xml`) | Read as development documentation only (licence forbids reverse engineering/redistribution). |

## 2. What LSA actually contains today (repository audit)

### 2.1 Runtime layer and extension routes

- **Only extension route in use: RAGE Plugin Hook (RPH) C# plugins (.NET Framework 4.8.1) plus Essential and the Damage Tracking Framework.** README requirements: `README.md:26` (@`c390840`). Project references: `native/promoted-characters/PromotedCharacters.csproj:13-14` (`RagePluginHook`, `DamageTrackerLib`). **CODE/V-GTA** (plugins load in the owner's GTA, see 2.6).
- **No C, C++ or ASI source exists on any of the 322 remote branches** (tree scan for `.c/.cpp/.h/.hpp/.vcxproj/.asi`), and `main` never mentions ScriptHookV/ASI loaders. **CODE (absence)**. Any native-C++ route (ScriptHookV ASI, custom hooks) would be new infrastructure.
- RPH loads plugins into isolated AppDomains and shadow-copies DLLs; cross-domain integration needed special handling: `docs/P2-rage-host-correction.md` (@`c390840`). Any destruction module must respect the same hosting rules. **V-GTA** (documented 2026-10-02 run).

### 2.2 Ballistics-adjacent code on `main` (what it is — and is not)

| Capability | Exact source | What it really measures | Physics relevance |
|---|---|---|---|
| Firing transitions | `native/intelligence/SensorAdapters.cs:141-150`; sampled at `native/intelligence/IntelligenceIntegration.cs:576-581` | `IS_PED_SHOOTING` false→true edge per source, ≤9 sources, 50 ms cadence, 1 ms budget, 500 ms debounce. **Not** per-bullet events, not trajectories. | None beyond "someone started shooting". |
| Damage callbacks | `native/intelligence/DamageSensors.cs:17-56` | DamageTrackerLib `OnPedTookDamage/OnPlayerTookDamage/OnVehicleTookDamage`; weapon class (bullet/melee/explosion/fire/collision); vehicle `LastCollisionPosition`. Live callback availability on Enhanced is **historically unproven** (PR #35 doc line 10). | Proof that *native damage happened to a ped/vehicle*. No wall/material/impact data. |
| Witness line of sight | `native/intelligence/IntelligenceIntegration.cs:1236-1260` | `GET_INTERIOR_FROM_ENTITY`, `HAS_ENTITY_CLEAR_LOS_TO_ENTITY_IN_FRONT`, `HAS_ENTITY_CLEAR_LOS_TO_ENTITY(…,17)` with a per-tick LOS budget. | **Important coupling:** these natives query the physics world. If destruction changes *real* collision, perception automatically sees through new holes; if destruction is only simulated in a side model, perception will not (§2.4 gap G-7). |

**Complete native inventory on `main`** (every `CallByName/CallByHash` literal under `native/**.cs`): cut-scene/mission/player-switch state, ped/vehicle state, LOS, interiors, blips, wanted level, seat queries, a few task natives, animation dictionaries, ped variation getters. **There are no shape tests, impact queries, explosion queries, object spawning/deletion, decals, navmesh/cover, IPL, fragment or physics natives on `main`.** **CODE (absence)**.

### 2.3 PR #35 — contextual ballistics is perception, not physics

PR #35 (@`9b1e37d`) implements *observer-qualified player firing attribution* and *bullet-class injury perception* for PS2/PS4/Director:

- Its own status line: "R1 and bounded R2 bullet-callback attribution wired in code; other ballistics inputs still planned; not deployed or GTA-accepted" — `docs/contextual-ballistics-perception-r0.md:4`.
- It explicitly lists as *not implemented or GTA-verified*: "impact normals/material classification (wall/ground/car), per-bullet round counts, reliable skyward trajectory, body-bone linkage, precise hit location…" — same file `:10`.
- It already encodes the epistemic rule this dossier keeps: "A raycast is a **geometric estimate, not an actual bullet impact**" — `:47`; `surface_hit` requires "Actual native world impact + visible impact", never "collision based only on raycast" — `:32`.
- Code seam worth reusing (not duplicating): the pure projector accepts evidence rows `{kind:'world_impact', proof:'native_impact', surface}` — `lsa-essential-e1-candidate/src/perception/contextualBallistics.mjs:72-77`. A future destruction subsystem should *publish* source-verified world-impact receipts that PS2 can consume under D-004, instead of re-implementing perception/ownership. **CODE (not GTA-accepted)**.
- Status register: "Ballistics beyond baseline … None accepted" — `docs/IMPLEMENTATION-STATUS-20261017.md:43`.

**Verdict:** PR #35 provides *zero* projectile penetration, geometry change, structural physics or persistence. It is relevant only as (a) a consumer of future world-impact facts and (b) a model of evidence discipline.

### 2.4 Persistence and timeline infrastructure

- **No save hook exists — PROVEN** in this project's contract register: `docs/research/system-contract-register.md:224` (C-07). Destruction persistence therefore cannot piggy-back on GTA save files.
- `TimelineGuard` is fail-closed and "never guesses the correct GTA save lineage": `lsa-shared-brain/src/characters/timelineGuard.mjs:1-27` (writes suspended on `clock_regression`/`timeline_change`, explicit `selectTimeline`). **CODE**.
- `hostRunId` + `WorldEpoch` broadcast contract (clock regression / host reload / timeline change): `docs/research/system-contract-register.md:283-290` (C-13). **DESIGN/CODE (partial)**.
- Proven atomic file pattern (exclusive create → flush → backup → replace-rename; corrupt primary preserved; persistence disabled on doubt): `docs/P1-session-identity-status.md:44-56`. **CODE, V-GTA for the identity store path.**
- D-003 makes P2 "the single durable **character/profile** store" and D-019 moves P2 to one SQLite store: `docs/research/DECISIONS.md:9,25`. A world-damage store is *not* character data — creating it needs an explicit new decision rather than a silent parallel store (proposed in doc 03 §1).

### 2.5 Authority boundaries that destruction must respect

- **D-001 (LOCKED)** "Essential is the sole native GTA executor… do not create a competing TASK/session/playback lifecycle" — `DECISIONS.md:7`; the current authority map assigns "GTA physical execution … native action lifecycle" to Essential (`docs/research/CURRENT.md:7,13`). **Destruction needs native world mutation that Essential does not offer, so it collides with the letter of a LOCKED decision.** Changing or clarifying it requires "contradictory evidence and an explicit architecture review" (`DECISIONS.md:31`). Doc 03 §1 proposes the narrow reading (D-001 governs NPC/action/playback lifecycles; world-geometry mutation by a separate subsystem that never tasks peds) or hosting the subsystem in the planned standalone native core — **an owner decision, not something this dossier may assume.**
- **D-004 (LOCKED)** "World facts, observer knowledge, salience, memory and action authority remain separate" — `DECISIONS.md:10`. Destruction state is a *world fact*; what NPCs know about it stays a PS2/PS4 concern.
- ACT/Director (D-013) propose/execute NPC activities; they must read, not own, destruction state (an activity target prop may have been destroyed).

### 2.6 Owner's actual runtime (strongest local evidence)

- "All **162** RPH logs staged from your PC (27 Sep – 18 Oct) report `RAGE Plugin Hook v1.132.1428.17748` with game `1.0.1158.16`" — `docs/standalone-replacement/rph-1132-investigation/REPORT.md:114-115` (@`3c67e1b`). **V-GTA.**
- Two earlier standalone-host crashes were caused by "compiling the host against the project's *fake* test SDK" — same report `:22`. **Lesson for every experiment here: build against the official RPH SDK and audit member imports, otherwise a "negative" result can be a build artefact.**
- Only 6 RPH members are proven by execution logs (`evidence/runtime-proven.json`); LSA plugins have run `NativeFunction.CallByName` paths in the owner's game (PS6 gunfire speech was observed: `docs/IMPLEMENTATION-STATUS-20261017.md:37`). **V-GTA for native calls in general; UNKNOWN for every specific native this dossier needs.**

### 2.7 Precise capability gaps (relevant only to this moonshot)

| ID | Gap | Consequence |
|---|---|---|
| G-1 | No per-bullet shot capture (only firing edges). | Penetration needs a new shot pipeline (native first impact + continuation). |
| G-2 | No shape tests / material queries. | Material-aware penetration has no input yet. |
| G-3 | No world mutation (spawn/delete/hide/swap/IPL/fragment) code. | No way yet to change collision. |
| G-4 | No asset pipeline (CodeWalker/gen9 conversion, dlcpack/OpenRPF). | No authored destructible assets or vanilla excision. |
| G-5 | No physics/structural solver, no native C++ layer. | Collapse must be built from scratch. |
| G-6 | No world-state store; P2 is character-scoped; no save hook. | Persistence needs a new, timeline-scoped store. |
| G-7 | Perception LOS uses the physics world. | Only *real* collision changes keep perception coherent. |
| G-8 | No experiment harness for in-game physical measurements. | Each experiment in doc 04 must bring minimal instrumentation (log lines + probe grids), not a large framework. |

## 3. GTA V Enhanced platform facts (engine evidence)

### 3.1 Edition, build, toolchain — Legacy ≠ Enhanced

| Fact | Evidence |
|---|---|
| GTA V Enhanced (PS5/XSX-generation PC build: ray tracing, DLSS/FSR, DirectStorage) launched 2025-03-04 as a separate version; crossplay with Legacy not supported. | S-40 (PCWorld 2025-02-21; Neowin). **PRIMARY-ish press.** |
| Owner's build: **1.0.1158.16** with RPH 1.132.1428.17748. | §2.6. **V-GTA.** |
| Script Hook V (Alexander Blade) latest: **v3889.0 / 1158.13**, released 2026-07-15; earlier Enhanced builds 812.8 → 1013.34 supported in turn; disabled in GTA Online. | S-01 (dev-c.com) **PRIMARY**. Support for **1158.16 is UNKNOWN** (not listed). |
| ScriptHookVDotNet Enhanced (zlib) v1.1.0.6 (2026-07-14) supports 1158.13; Legacy scripts run "granted that they do not rely on their own memory patterns"; memory patterns repeatedly broke on updates. | S-02 **MOD/PRIMARY (project page)**. |
| OpenRPF v0.3 (2025-12-18) provides an Enhanced `mods` folder, bypasses `rpf.cache` for modified files; **"Gen8 (GTA V Legacy) files on Gen9 (GTA V Enhanced) will cause a crash"**. | S-03 **MOD**. |
| CodeWalker converts YTD/YDR/YDD/YFT/YPT to gen9 (target resource versions: ytd 5, ydr/ydd 159, yft 171, ypt 71); **its converter has no YBN path and `YbnFile` loads resource version 43 with no gen9 branch** → collision files appear format-identical between editions. | S-04 (`CodeWalker.Core/Utils/Gen9Converter.cs`, `GameFiles/FileTypes/YbnFile.cs`) **PRIMARY**; conclusion **INFER**. |
| Enhanced reportedly crashes beyond **128 materials/geometries per file**. | S-06 (Sollumz) **MOD**. Hard constraint for fracture assets if true. |
| Gameplay natives are identical: 6,699 natives share identical hashes in legacy and gen9 DBs; the 49 gen9-only natives are commerce/landing-page/MP; no new physics/destruction natives. | S-08 **PRIMARY (community DB)**. |
| FiveM for Enhanced entered early access 2026-07-21 (multiplayer; out of scope; Rockstar limits multiplayer modding to its Creator Platform). | S-14, S-12. |

### 3.2 World and collision architecture

- **Static map collision is separate from map drawables.** CodeWalker reconstructs a *static bounds store* from the game cache: entries `{Name, Min, Max, Layer}` (`GameFiles/FileTypes/CacheDatFile.cs:424-446`) and streams `.ybn` files spatially (`World/Space.cs:23-33, 247-318`). Building entities (`ymap`) do not own that collision. **PRIMARY (reimplementation) / INFER for runtime.**
- Community docs: low-detail `name.ybn` and high-detail `hi@name.ybn` (S-07); Sollumz says hi@ versions are "for weapon bullets", `ma@` for procedural objects (S-06). Which layer weapon probes use **must be verified per target** (E0). **MOD (conflicting detail).**
- Bound types: Sphere, Capsule, Box, Geometry, GeometryBVH, Composite, Disc, Cylinder, Cloth (`Resources/Bounds.cs:101-113`). Composite children carry type/include flags including **`MAP_WEAPON`, `MAP_DYNAMIC`, `MAP_ANIMAL`, `MAP_COVER`, `MAP_VEHICLE`, `PED`, `RAGDOLL`, `OBJECT`, `PROJECTILE`, `EXPLOSION`, `TEST_WEAPON`, `TEST_CAMERA`, `TEST_AI`, `GLASS`, `MAP_STAIRS`** … (`Bounds.cs:4592-4627`). **PRIMARY.**
- **Per-polygon material**: low byte = material index (8 bits → ≤256 materials), plus procedural id, room id, ped density and flags `FLAG_SHOOT_THROUGH`, `FLAG_SEE_THROUGH`, `FLAG_NOT_COVER`, `FLAG_NO_NAVMESH`, `FLAG_NO_DECAL`, `FLAG_SHOOT_THROUGH_FX`… (`Bounds.cs:5138-5196`). **PRIMARY.**
- **`materials.dat` columns** (as parsed by CodeWalker): Name, Filter, FXGroup, VFXDisturbanceType, RumbleProfile, ReactWeaponType, Friction, Elasticity, **Density**, TyreGrip, WetGrip, TyreDrag, TopSpeedMult, Softness, Noisiness, **PenetrationResistance**, SeeThru, **ShootThru**, ShootThruFX, NoDecal, Porous, HeatsTyre, Material (`Bounds.cs:5279-5303, 5384-5428`). A third-party tool reports 213 rows, version 12.00 (S-42, **MOD, weak**). **The vanilla engine already classifies every collision triangle by material and carries density and a penetration-resistance scalar.**
- Collision is "formed by primitive shapes and low detailed shaping of the original form" (S-07) — buildings are mostly closed low-detail shells; most exteriors have **no interior structure at all** (no floors/columns inside non-enterable buildings). **MOD/INFER.** This is a *content* gap for structural collapse (doc 05 BQ-4).

### 3.3 Map entities, IPLs, canned destruction

- `CREATE_MODEL_HIDE` / `CREATE_MODEL_SWAP` take position+radius+model and are documented "Only works with objects!" — map *buildings* are not scriptable through them (S-08 comments). **PRIMARY (community DB comments), UNKNOWN in Enhanced.**
- IPL (ymap group) loading: `REQUEST_IPL`, `REMOVE_IPL`, `IPL_GROUP_SWAP_START`, `IPL_GROUP_SWAP_IS_READY`, `IPL_GROUP_SWAP_FINISH`, interior entity sets (`ACTIVATE_INTERIOR_ENTITY_SET`) exist (S-08). Whether an IPL swap also swaps the *static* collision associated with a mod-authored state pair is **UNKNOWN** — it is the pivotal test for the recommended architecture (doc 04 E7a).
- **Rayfire** map objects are GTA's own pre-animated destruction ("a rayfire scene is basically a map animation": cargo ship, Silt house, O'Neil farm, train bridge) driven by `GET_RAYFIRE_MAP_OBJECT` / `SET_STATE_OF_RAYFIRE_MAP_OBJECT` states 2/4/6/9 (S-16, S-08). **Canned spectacle, explicitly not the goal**, but proof the engine supports state-swapped destroyed map geometry.

### 3.4 Physics, fragments and native breakage

- RAGE physics shares heritage with Bullet: "some parts of Bullet have been co-developed and optimized with Rockstar and merged into their Rage game engine" (Erwin Coumans, quoted in S-34). **PRIMARY quote via secondary.**
- **Fragments (`.yft`) are RAGE's native breakable objects.** A fragment = drawable + composite collision (+ damaged variants); physics groups linked to bones; children = per-collision part (S-06 fragments). CodeWalker layout: **`GroupsCount` and `ChildrenCount` are bytes (≤255 per physics LOD)** (`Resources/Frag.cs:2225-2229`); groups carry **`Strength`, `ForceTransmissionScaleUp/Down`, `JointStiffness`, `LatchStrength`, `MinDamageForce`, `DamageHealth`, `Mass`, parent/child indices, glass flags**; children carry **`PristineMass`, `DamagedMass`, pristine and damaged drawables** (`Frag.cs:4016-4050, 3666-3690`). **PRIMARY.** RAGE therefore already supports *runtime removal of collision children from a composite when parts break* — but only inside fragment objects, not static map bounds.
- Natives: `BREAK_OBJECT_FRAGMENT_CHILD(Object, Any, BOOL)`, `DAMAGE_OBJECT_FRAGMENT_CHILD(Any, Any, Any)`, `FIX_OBJECT_FRAGMENT`, `GET_OBJECT_FRAGMENT_DAMAGE_HEALTH`, `SET_DISABLE_FRAG_DAMAGE`, `SET_DISABLE_BREAKING` (S-08). A community note says breaking a child "removed the entire group that the component is part of" (S-41). Parameter semantics are **UNKNOWN**; never invent signatures beyond the DB.
- `CWeaponInfo` in build **1158 gen9** has a FLOAT **`FragImpulse`**, `Force`, `ForceHitPed/Vehicle` and `ProjectileForce` (S-09 b1158g9). **PRIMARY.** Native bullets already push and break fragments.
- Euphoria/NaturalMotion messages via `CREATE_NM_MESSAGE`/`GIVE_PED_NM_MESSAGE` (S-08) and typed RPH Euphoria message classes (`Rage.Euphoria.EuphoriaMessageShot`…, S-10); `SET_TIME_SCALE` (max 1.0) and RPH `Game.TimeScale` (S-08, S-10).

### 3.5 Weapons, bullets, impacts — what the engine exposes

- **Fire types in build 1158 gen9:** `INSTANT_HIT`(2), `DELAY…3342 tokens truncated…t Blast release 5.0.6 (2024-05) → maintenance mode; Windows build tooling. |
| PhysX 5 | BSD-3 | Optional external rigid-body world. | Large dependency; GPU features not needed. |
| Jolt Physics | MIT | Deterministic, multithreaded, background loading/unloading of bodies, compound/mesh shapes, double precision; shipped in Horizon Forbidden West and Death Stranding 2. | Destruction must be built on top. |
| SuiteSparse CHOLMOD | Core LGPL-2.1+; **Modify (update/downdate) and Supernodal modules GPL-2.0** (`cholmod_modify.h` header) or commercial | Sparse Cholesky with up/downdates (validated offline §8). | GPL modules are unsuitable for anything redistributed under a non-GPL licence → research use only, or re-implement low-rank updates on an MPL/BSD solver (e.g. Eigen) as Embark did in-house. |
| Manifold | Apache-2.0 | Guaranteed-manifold mesh booleans for offline cut patterns and twin generation. | Needs manifold input (GTA meshes often aren't) → repair first. |
| OpenVDB / NanoVDB | Apache-2.0 | Sparse SDF/voxel truth for volumetric damage, offline remeshing. | Memory at city scale (§8 X-4). |
| Recast/Detour | zlib | Offline regeneration of navmesh-like data for latent-navmesh research. | Output is not GTA `ynv`; conversion would be custom. |
| Embree | Apache-2.0 | Fast offline/oracle ray queries against an extracted ballistic mesh. | Duplicate world copy in RAM. |
| Voro++ | LBNL BSD-style (check LICENSE) | Voronoi cells. | Prefer Blast's built-in Voronoi to reduce dependencies. |
| CodeWalker libraries | MIT-style | Read/write ybn/ydr/yft/ymap/ytyp XML; gen9 conversion; offline navmesh. | Gen9 fidelity warnings (S-03); Windows/.NET. |

## 7. Physical calibration references

- **US Army FM 3-06.11 (Feb 2002), Ch. 7**, quantitative weapon-versus-structure data. Provenance: every quoted sentence below was checked verbatim in the Internet Archive OCR full text (S-36); the tables are scanned images there and survive only as fragments, so **table values come from The Black Vault's PDF of Ch. 7 (S-45, read through a model-assisted fetch)** and agree with every legible OCR fragment ("Loophole 250", "Loophole 160", "Loophole 120"; Table 7-5 "100" and "6 and 24 / 30 and 200"). An early summarised copy (S-44) had collapsed Table 7-2's two-stage rows; that misreading is superseded. 5.56 mm: "interior walls made of thin wood paneling, Sheetrock, or plaster are no protection"; stopped at < 50 m by one layer of well-packed sandbags, a 2-in non-reinforced concrete wall, a sand-filled cinder block, a brick veneer; a car body is penetrated but not always exited; "maximum penetration occurs at 200 meters" and is poor at 10 m (yaw/break-up); masonry is breached with "short bursts (three to five rounds) in a U-shaped pattern"; "5.56-mm rounds cannot cut the reinforcing bars". **Table 7-2 (25–100 m)**, two-stage rows printed as "Initial / Loophole — 35 / 250" (stage-to-count pairing read in print order, consistent with the OCR fragments): 8-in reinforced concrete **initial penetration 35 / loophole (≈7 in) 250 rounds**; 14-in triple brick 90 / 160; 9-in double brick 70 / 120; 12-in cinder block with brick veneer loophole 60 / breach hole 250; sand-filled 12-in cinder block loophole 35; 24-in double sandbag wall penetration only, 220; 16-in tree trunk or log wall 1–3; 3/8-in mild-steel door 1 (penetration-only rows: no loophole). 7.62 mm ball: penetration (in) at 25/100/200 m — pine 13/18/41, dry sand 5/4.5/7, cinder block 8/10/8, concrete 2/2/2 (Table 7-3; not legible in the OCR); Table 7-5 (25 m): 8-in RC 7-in hole after **100 rounds**, 14-in triple brick 7-in hole 170, concrete block + veneer 6-in/24-in holes after 30/200, filled cinder block penetration 18, double brick 45, double sandbag 110. .50: 14 in sand / 28 in packed earth at 200 m. Explosives: "about 5 pounds of TNT" breach a 12-in non-reinforced concrete wall untamped (≈2 lb tamped); "about 10 pounds of C4" open a man-sized hole in an average masonry wall; against a non-reinforced concrete wall, satchel charges of 2/5/7/10 lb C4 give a mousehole / one-man / two-man / vehicle-sized hole. Definitions: loophole ≥ 8 in diameter; mousehole ≥ 24 × 30 in; breach hole **50 × 30 in**. Fragmentation grenades: "cannot penetrate a single layer of sandbags, a cinder block, or a brick building, but they can perforate wood frame and tin buildings if exploded close to their walls". AT4/Carl Gustav "may require 3 to 5 rounds" to penetrate brick walls; against heavy stone "surface cratering is usually the only effect".
- **UFC 4-023-03** progressive-collapse design (S-37, STRUCTURE magazine Apr 2006): tie forces; **Alternate Path Method** removing perimeter/corner columns one floor at a time; static analyses double gravity loads in bays adjacent to/above the removed element (dynamic increase ≈2).

These are *acceptance anchors*, not claims that LSA must be a military simulator.

## 8. Offline probes executed in this session (X-OFF — sandbox, not GTA)

All scripts and raw outputs: [`offline-probes/`](offline-probes/).

| ID | Question | Result | Caveats |
|---|---|---|---|
| X-1 `p1_ballistics.py` | Can a one-parameter-per-material Poncelet penetration model, fitted only to FM 7.62 data, predict other FM statements? | Fitted σ (concrete 869 MPa effective, pine 70, sand 320 at 100 m). Out-of-sample: 5.56 stopped by 2-in concrete ✔ (1.89 in); 5.56 perforates 3/8-in steel ✔ (1,378 J vs ~292 J plugging); 5.56 passes gypsum boards ✔; 5.56 stopped by brick veneer ✔ (brick σ assumed). **.50 sand failed with 100 m calibration (7.4 in vs 14 in) and passed with same-range calibration (12.6 in)** — range/yaw effects matter. | Effective σ is not a material strength; velocities at range assumed; FM's own depths are non-monotonic with range (sand 5 / 4.5 / 7 in; Table 7-3 values from S-45). |
| X-1b `p1b_erosion.py` | Can a crater-accumulation law reproduce FM's repeated-fire counts for 8-in reinforced concrete (5.56: 35 to first perforation, ≈250 to a 7-in loophole; 7.62: 100 to a 7-in hole)? | **v1 (hemispherical craters, Gaussian aim, one constant) is falsified:** calibrated to 35 rounds, it needs ≥ 589 rounds for the 5.56 loophole and 244–600 for 7.62. **v2 (wide, shallow cone/spall craters, aspect 6–10, FM's U-shaped burst pattern, two constants fitted to the two 5.56 counts):** 5.56 → 26 / 230–250 rounds; **out-of-sample 7.62 prediction 147–163 rounds vs 100 (×1.5–1.6)** → energy-only scaling under-credits the heavier round; the contract therefore carries a per-ammunition erosivity factor (doc 03 §5B). An earlier run of this probe used a misread of Table 7-2 and is superseded. | Table 7-2 pairing as printed in S-45, consistent with the S-36 fragments (§7); rebar pitch, impact energies and aim jitter assumed; best fit lies on the grid edge in one run (see `p1b_erosion_extended.out.json`). |
| X-2 `p2_structural.py` | Does a load-redistributing frame solve give causally different outcomes than a canned collapse? | 4×4×5 RC frame, one edge column removed: shallow beams → partial collapse (72/150 nodes fall); deep beams with DIF 1.3 → **bridges (0 failures)**; same deep beams with DIF 2.0 → collapse; two/three adjacent columns or one interior column → collapse; intact equilibrium error ~5e-12. | Linear-elastic, brittle member removal, no catenary/ties, no dynamics → over-predicts total collapse. |
| X-2b `p2b_solver_scaling.py` | Cost of event-driven re-analysis. | CHOLMOD (METIS) factor: 0.12 s / 2.9 s / 18.4 s for 4.9k / 20k / 52k free DOF; solve 1–61 ms; numeric refactor after one column loss 0.17 s / 4.3 s / 40 s; **support-loss event via rank-≤6 downdate + solve: 3.8 ms / 35 ms / 159 ms**, matching the full refactor to ≤6e-13. A second independent run (`p2b_solver_scaling.run2.out.json`) agrees within 16 % on every factorisation, refactor and downdate timing (sub-10 ms solves within 25 %). ~150k DOF exceeded the 7 GB sandbox (OOM). | Sandbox 2 vCPU, distro BLAS; the owner's i9-14900K/64 GB will differ (unmeasured). CHOLMOD Modify is GPL-2.0 (§6). |
| X-3 `p3_facade_tiles.py` | Entity budget to project a damaged 10 m × 3 m × 20 cm wall with pre-authored props. | Naive cells: 480 (25 cm) – 12,000 (5 cm). **Tile kit (power-of-two panels + marching-squares boundary tiles):** pristine 6–16 entities; 1.5 m blast breach 36–103; blast + 160 rifle hits 47–119 (25 cm / 10 cm). 100 scattered 5.56 hits create no through-cells (consistent with FM: single rounds do not perforate RC). | Kit sizes ~20–36 panel variants + 6 boundary shapes per material/thickness. Uses a simple hemispherical crater as a geometry stand-in (counts, not calibration). |
| X-4 `p4_scale_budget.py` | Storage envelopes. | Pre-fractured vanilla-faithful chunks at 0.5 m: **0.9–24 TB** city envelope; dense 10 cm voxels 7.5–200 GB; tile state 0.3–7.5 GB even if everything were damaged; event log ≈2 MB per 100k impacts. | Archetype buildings and counts are assumptions until E7 measures real assets. |
| X-5 `p5_persistence_replay.py` | Is event-log replay a sound persistence substrate? | Same-order replay bit-identical; **reordered float replay differs (≤4e-6 cm) while fixed-point integer replay is order-independent and exact**; 10k events replay in 0.5 s; compressed snapshot 216 KB loads in 2 ms. | Wall-scale field only. |

## 9. Verified / unknown / contradicted matrix

| # | Claim | Status | Evidence | Resolving experiment |
|---|---|---|---|---|
| 1 | Owner runs GTA V Enhanced 1.0.1158.16 with RPH 1.132.1428.17748 | **Verified (V-GTA)** | §2.6 | — |
| 2 | RPH plugins can call natives in that build | **Verified in general (V-GTA)** | §2.6 | — |
| 3 | Script Hook V supports 1.0.1158.16 | **UNKNOWN** (latest listed 1158.13) | S-01 | E0.0 |
| 4 | LSA has any projectile/penetration/geometry/structure code | **Contradicted (absent)** | §2.2–2.3 | — |
| 5 | PR #35 implements physical ballistics | **Contradicted** | PR doc `:4,:10` | — |
| 6 | Static collision lives outside building entities, streamed spatially | **Supported (PRIMARY reimpl.)** | §3.2 | E0.5 |
| 7 | Collision triangles carry material ids and shoot/see-through flags | **Verified in file format (PRIMARY)**; runtime use UNKNOWN in Enhanced | §3.2 | E0.2 |
| 8 | `materials.dat` has Density & PenetrationResistance | **Verified in format (PRIMARY)**; runtime effect UNKNOWN | §3.2 | E1 |
| 9 | Per-material shoot-through can be tuned in Enhanced | **Reported (MOD)** | S-15 | E1 baseline arm |
| 10 | Vanilla bullets penetrate walls by thickness/energy | **Contradicted by observed vanilla behaviour (INFER) / UNKNOWN for `Penetration` field** | S-09, S-15 | E1 |
| 11 | Shape tests return material hashes on Enhanced | **UNKNOWN** (native present in gen9 DB) | S-08 | E0.2 |
| 12 | Shape tests hit back faces / allow exit-face discovery | **UNKNOWN** | — | E0.3 |
| 13 | `GET_PED_LAST_WEAPON_IMPACT_COORD` updates per shot at automatic fire rates | **UNKNOWN** | S-08 | E0.4 |
| 14 | Re-emitted native bullets damage peds with player attribution and DamageTracker callbacks | **UNKNOWN** | S-08, R-PR35 | E0.6 / E1 |
| 15 | Deleting a collidable prop immediately frees bullets, LOS and movement | **Expected (INFER), UNKNOWN on Enhanced** | — | E2a |
| 16 | Static map collision can be edited offline and loaded in Enhanced | **UNKNOWN** (ybn format unchanged per CodeWalker; OpenRPF mods folder) | S-03, S-04 | E2b |
| 17 | Static map collision can be mutated or re-streamed at runtime safely | **Contradicted for unhooked SP / fragile with deep hooks (FiveM)** | S-13 | (avoid) |
| 18 | `CREATE_MODEL_HIDE` hides buildings | **Contradicted by DB comment ("only objects")**, unverified in Enhanced | S-08 | E0.7 |
| 19 | IPL swap swaps collision for a mod-authored state pair | **UNKNOWN (pivotal)** | S-08, S-16 | E7a |
| 20 | Fragment children can be broken by script and by bullets | **Supported (native + weapon `FragImpulse`)**; params UNKNOWN | S-08, S-09, S-41 | E0.8 |
| 21 | ≤255 children/groups per fragment physics LOD | **Verified in format (PRIMARY)** | S-04 Frag.cs | — |
| 22 | ≤128 materials/geometries per file in Enhanced | **Reported (MOD)** | S-06 | E2a asset gate |
| 23 | Navmesh can be extended through new openings at runtime | **Contradicted (no native)**; blocking/disabling only | S-08 | E6/E7 (latent navmesh) |
| 24 | Interior visible through a blasted hole | **Contradicted for portal-less openings (MOD)** | S-38 | E7 |
| 25 | Object/phInst pools allow ~10³ mod entities | **UNKNOWN for vanilla Enhanced** (FiveM raised: 3,300 / 16,384) | S-13 | E0.9 |
| 26 | Event-driven structural re-analysis can be cheap | **X-OFF supported** (downdate 3.8–159 ms sandbox) | §8 X-2b | E4 |
| 27 | Baseline-relative failure keeps converted structures stable at rest | **PRIMARY (The Finals) + X-OFF** | S-20, X-2 | E4/E7 |
| 28 | Event-log persistence can be bit-exact | **X-OFF supported** (fixed-point) | X-5 | E5 |
| 29 | City-wide pre-fracture of vanilla assets is storable | **Contradicted at 0.5 m (0.9–24 TB, X-OFF envelope)** | X-4 | E7d |
| 30 | GTA can render runtime-generated meshes in SP without hooks | **Contradicted (no API)** | §3.7–3.8 | — |
| 31 | Max Payne-style time scale and NM messages available | **Supported (natives/RPH docs)**, Enhanced behaviour UNKNOWN | S-08, S-10 | E6 |
| 32 | Converted Rockstar assets may be redistributed | **Contradicted (policy/copyright INFER)** | S-12 | — |

## 10. Source registry (accessed 2026-10-18)

- **S-01** Script Hook V — http://www.dev-c.com/gtav/scripthookv/ (v3889.0/1158.13, 2026-07-15); patch history mirror https://gta5mod.net/gta-5-mods/tools/script-hook-v-native-trainer-1-0-1737-0/
- **S-02** ScriptHookVDotNet Enhanced — https://github.com/Chiheb-Bacha/scripthookvdotnetenhanced ; https://www.gta5-mods.com/tools/script-hook-v-net-enhanced (v1.1.0.6, 2026-07-14)
- **S-03** OpenRPF — https://www.gta5-mods.com/it/tools/openrpf-openiv-asi-for-gta-v-enhanced (v0.3, 2025-12-18)
- **S-04** CodeWalker source — https://github.com/dexyfex/CodeWalker @485d56b (files cited inline)
- **S-05** CodeWalker gen9 update note — https://fivemx.com/gta-news/codewalker-update-gtav-enhanced-assets-support (undated)
- **S-06** Sollumz docs — https://docs.sollumz.org/tutorials/asset-conversion-for-gtav-enhanced ; https://docs.sollumz.org/2.6/documentation/collisions.ybn ; https://docs.sollumz.org/2.4/documentation/fragments.yft
- **S-07** alt:V YBN reference — https://docs.altv.mp/gta/articles/references/ybn.html
- **S-08** NativeDB data — https://github.com/alloc8or/gta5-nativedb-data @424fb51 (`natives_gen9.json`)
- **S-09** RAGE parser dumps — https://github.com/alexguirre/rage-parser-dumps @2cf8d0b (`dumps/gta5/b1158g9.json`; member names resolved by joaat hashing in this session)
- **S-10** RPH SDK 1.124.0 — https://www.nuget.org/packages/RagePluginHook/1.124.0 (XML docs; licence text)
- **S-11** LSPDFR Enhanced preview — https://www.lcpdfr.com/files/file/52970-lspd-first-response-enhanced-preview/
- **S-12** Rockstar PC single-player mods (updated 2026-09-15) — https://support.rockstargames.com/en-US/articles/5NVOAYjcTomO8v6SX2k76k/pc-single-player-mods ; Mod Guidelines — https://www.rockstargames.com/community-resources/mod-guidelines ; rule-by-rule summary (2026-09-22) — https://gtaintel.com/news/rockstar-mod-guidelines-explained-gta-6
- **S-13** FiveM source — https://github.com/citizenfx/fivem/blob/master/code/components/gta-streaming-five/src/LoadStreamingFile.cpp ; https://github.com/citizenfx/fivem/blob/master/data/client/citizen/common/data/gameconfig.xml ; licence https://github.com/citizenfx/fivem/blob/master/LICENSE
- **S-14** FiveM Enhanced early access (2026-07-21) — https://www.gtaboom.com/fivem-for-gta-v-enhanced-is-live-c7cc
- **S-15** Penetration mods — https://www.gta5-mods.com/pt/misc/rebalanced-bullet-penetration ; https://www.gta5-mods.com/zh/misc/bullet-s-penitrate-realism
- **S-16** Replayable Rayfire Scenes — https://www.gta5-mods.com/uk/scripts/replayable-rayfire-scenes
- **S-17** ShootDodge — https://www.gta5-mods.com/pt/scripts/shootdodge
- **S-18** Euphoria Ragdoll Overhaul — https://www.gta5-mods.com/es/misc/euphoria-ragdoll-overhaul-ero
- **S-19** Teardown — https://acko.net/blog/teardown-frame-teardown/ (2023-01-24); https://softwareengineeringdaily.com/wp-content/uploads/2024/12/SED1772-Teardown.txt ; https://80.lv/articles/see-what-s-new-in-teardown-creator-s-custom-voxel-physics-engine/ (2025-01-22)
- **S-20** THE FINALS GDC 2024 — https://media.gdcvault.com/gdc2024/Slides/GDC+slide+presentations/Isaksson_Mans_Engineering+Mayham+Technical.pdf ; https://gdcvault.com/play/1034307/Engineering-Mayhem-Technical-Deep-Dive
- **S-21** Rainbow Six Siege GDC 2016 — https://media.gdcvault.com/gdc2016/Presentations/LHeureux_Julien_Art_Of_Destruction.pdf
- **S-22** The Ringer (2024-02-02) — https://www.theringer.com/2024/02/02/video-games/destruction-video-games-battlefield-bad-company-red-faction-battlebit-teardown-the-finals
- **S-23** Geo-Mod 2.0 — https://www.redfactionwiki.com/wiki/GeoMod_2.0
- **S-24** Frostbite destruction masking (SIGGRAPH 2010) — https://advances.realtimerendering.com/s2010/index.html
- **S-25** Crackdown 3 cloud destruction (2018-11-13) — https://windowscentral.com/inside-crackdown-3s-azure-cloud-powered-destruction
- **S-26** BeamNG physics — https://beamng.com/game/about/physics
- **S-27** Max Payne 3 — https://www.techradar.com/news/gaming/the-technology-of-max-payne-3-1082751 (2012-06-01); https://www.gamingnexus.com/News/26211/The-evolution-of-bullet-time-in-Max-Payne-3 (2012-04-12)
- **S-28** NVIDIA Blast — https://github.com/NVIDIA-Omniverse/PhysX/tree/main/blast @b97365c
- **S-29** Jolt Physics — https://github.com/jrouwe/JoltPhysics
- **S-30** Manifold — https://github.com/elalish/manifold
- **S-31** OpenVDB — https://github.com/AcademySoftwareFoundation/openvdb
- **S-32** Recast & Detour — https://github.com/recastnavigation/recastnavigation
- **S-33** Embree — https://github.com/RenderKit/embree
- **S-34** Bullet in RAGE (Coumans quote) — https://de.wikipedia.org/wiki/Bullet-Physik
- **S-35** VACD fracture (SIGGRAPH 2013) — https://history.siggraph.org/?p=108389
- **S-36** FM 3-06.11 (Feb 2002), full text — https://archive.org/details/fm-3-06.11-fm-90-10-1-combined-arms-operations-in-urban-terrain-2002
- **S-37** UFC 4-023-03 summary (2006) — https://www.structuremag.org/wp-content/uploads/2014/09/F-DOD-Progressive-Collapse1.pdf
- **S-38** MLO portals tutorial — https://fivemx.com/blog/how-to-create-fivem-mlos
- **S-39** GTA V map area (unsourced 75.84 km²) — https://insider-gaming.com/a-list-of-every-gta-map-and-its-size/
- **S-40** Enhanced launch — https://www.pcworld.com/article/2616193/gta-v-for-pc-will-get-ray-tracing-with-big-upcoming-visual-update.html ; https://www.neowin.net/news/gta-vs-console-upgrade-is-hitting-pc-soon-here-are-the-features-and-requirements/
- **S-41** Fragment-child native note — https://github.com/vhub-team/native-db/blob/master/functions/0xE7E4C198B0185900.md
- **S-42** Third-party materials.dat catalogue generator (weak) — https://github.com/AliYa-chen/gtav-web-multiplayer-launcher/blob/main/tools/generate_material_catalog.py
- **S-43** CHOLMOD Modify module licence header (GPL-2.0) — https://floodlight.ssec.wisc.edu/docs/abom/ancil/polar2grid_v_2_2/common/ShellB3/include/cholmod_modify.h
- **S-44** FM 3-06.11 Ch. 7 HTML mirror (GlobalSecurity) — consulted first through a summarised fetch that collapsed Table 7-2's two-stage rows (superseded by S-36/S-45); the site licence-gates automated retrieval, so it was not re-read — https://www.globalsecurity.org/military/library/policy/army/fm/3-06-11/ch7.htm
- **S-45** FM 3-06.11 Ch. 7 PDF (The Black Vault) — source of the table values in §7 — https://www.theblackvault.com/documents/fm/fm30611/ch7.pdf
