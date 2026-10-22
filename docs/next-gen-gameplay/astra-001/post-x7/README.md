# After X7: reusable destructible props, then a small asset palette

Research checkpoint: **2026-10-22**, based exactly on #300 head
`39eb1601e17b770a616cb93c2bda0e337fa305f8`. This is a separate research/prototype
branch targeting #300, not main. #301 owns live automatic impact selection;
its code, generated driver, tests, workflow and smoke runner are untouched.
Nothing here is installed or newly GTA-validated.

## Executive decision

**Build X8: a catalog-driven, bounded prop-twin manager using the existing
`prop_fnccorgm_02e` corrugated-fence recipe at two approved placements.** Keep
RAGE's native fracture, the X7 protection flags, #301's selector and the existing
custom GEN9 assets. Start with one shot at a time and no more than two prepared
or active fence contexts. Two contexts mean up to ten section roots and ten
anchors before debris; this is a proposed starting budget, not an engine limit.

This is the most useful next experiment because the present driver is a
singleton with hardcoded dimensions, a single original, global cleanup and a
one-shot state machine. Another bespoke wall would repeat the demonstration.
The same definition working at two differently oriented locations tests the
actual reuse boundary: placement identity, transforms, collision ownership,
independent state and restoration. It requires no new art or physics research.

This gets us from **one destructible test fence to a reusable destructible
category at deliberately registered Los Santos locations**. It does not make
arbitrary city geometry destructible. After that, the largest cost is approving
and authoring a small palette of eligible asset families, especially their
collision and LOD ownership.

Read [the evidence and conversion decisions](RESEARCH.md) for source-backed
details, and [the executable implementation handoff](HANDOFF.md) for X8.

## Evidence and milestone reconciliation

Labels: **G** = recorded gameplay on a named candidate; **S** = inspected
source/tooling contract; **I** = engineering inference/decision; **U** = untested.
No proprietary RAGE engine source was available. Public wrappers/native
annotations establish interfaces; only the recorded trials verify behavior in
this installation. Neither category establishes universal engine behavior.

| Work | Established evidence | Boundary |
| --- | --- | --- |
| X1/X2 | **G:** native fragments remove collision; original authored anchored wall, real player/NPC traversal | X2 formal acceptance partial; not every explosive/position makes a usable hole |
| X3 | **G:** four old full-wall objects across two launches; targeted cleanup preserves unrelated sentinels | Not four X7 layouts; no hard debris cap proved; cold hitches and strategy matrix unresolved |
| X4 | **G:** eligible vanilla fence hide clears 360/360 rays and 7/7 sweeps; neighbors unchanged 24/24 | This prop's collision can be removed without editing YBN; not a building result |
| X5 | **G:** predictive JIT commit before real RPG; original remains until commit | Concrete art mismatch; original handles become stale |
| X6 | **G:** original procedural fence twin matches footprint, native breach, traversal, reacquired original 9/9 | Approximate appearance; not copied Rockstar materials or a general asset converter |
| X7.2c | **G:** four shots; two selected independent props fracture, protected direct-hit control survives; three walks; each restore 9/9 | Command-selected pair; one site/category/RPG; no serial rearming |
| #300 | **G:** one P2 trial, two native parts, pair 2/3, four frames/28ms early, 1m lane crossed in 1820ms; world 9/9 and filesystem rollback | Live candidate `acfe7be9`; final `39eb1601` changes failure receipts only. Commit cost .470ms here, not a universal .2ms bound |
| #301 | Separate active automatic-selector work | No acceptance claim made by this PR |

The [old master plan](../06-MASTER-PLAN-explosion-destruction-20261020.md)
used **X5=persistence, X6=support release**. Implemented **X5=JIT,
X6=visual twin, X7=localized fracture** reused those names. Old M4 persistence
and M5 building/support ambitions remain future capabilities. X4's planned YBN
excision was avoided for this eligible prop. Historical X7a Session A failed,
and torn36 Session B was not run; useful later strip/protection results do not
retroactively pass those gates. Do not reopen all old matrices to ship a personal
mod; retain the specific limitations.

## Ranked architectures

Ratings compare this project's next achievable step, not theoretical engine power.

| Rank / architecture | Complexity | Scale | Visual quality | Principal failure risk / verdict |
| --- | --- | --- | --- | --- |
| **1. Approved placements + local dormant cache + JIT original hide** | Medium: extract instance state, retain existing commit | Good for repeated eligible props; bounded cache; one recipe serves many placements | Original appearance/behavior until swap; authored twin quality after | Hide sphere affects neighbors, late commit, stale identities. **Choose now**; all essential mechanisms already demonstrated |
| **2. Preinstalled curated site overlay: excise original visuals/collision, place authored kit** | High asset/site work; simpler runtime switch | Good for a few selected walls/buildings; poor universal coverage | Can match exact seams/interiors and damaged LODs | Every YBN layer/LOD/occlusion dependency must agree; installation conflicts. Use when an intended building truly needs map surgery |
| **3. Replace every matching prop with fragments on approach** | Medium runtime, potentially extensive asset work | Poorer pool/anchor/streaming cost; many untouched objects become physical | Consistent twins, but intact behavior/material/LOD can change everywhere | Consumes resources before damage; semantic regressions for doors/dynamic props. Defer until cache evidence justifies it |
| **4. Native model swap to one monolithic fragment archetype** | Low swap code, uncertain asset/runtime adaptation | Potentially broad model scope | Depends on twin fidelity | Does not reproduce five independently protected prop scopes; shape/resource compatibility untested. A later discriminator only, not a replacement for the proven path |

Reject generic runtime mesh fracture/custom physics and a pre-fractured whole
city. They add the hardest work before proving reuse. A map overlay is a useful
second architecture for a curated building, not a prerequisite for every fence.

## X8 implementation specification

**Input:** one versioned family definition plus a tiny explicit placement list.
Definition: source archetype/model, measured local source-to-twin offset,
supported transform constraints, section physical IDs/models/local transforms,
collision witnesses, material/trigger policy and asset manifest hashes.
Placement: authored stable ID, definition revision, source model pivot and full
measured basis/transform, neighbor exclusion information. Do not derive durable
identity from handles or rounded coordinates. Initially accept upright unit-scale
placements only. No city scanner or registry service is needed.

**Runtime:** one small manager holds instance contexts, owned roots/anchors,
verified debris, exact hide tuple and state. Use the same X7 native mechanics.
Replace global `CleanupAll` use inside per-instance paths; unloading A must not
restore, delete, reconfigure or forget B. Revalidate native handle type, model,
position and basis after waits and before destructive operations. Model+nearest
1.5m alone is too weak for a growing placement list.

```text
Original -> Preparing -> Armed -> Active -> RestorePending -> Original
                  \-> cleanup pending on prepare failure
```

Preparing loads/spawns and verifies outside the commit path. Armed must show
original 9/9, dormant twin 0/9, unchanged neighbors, correct models and pool
headroom. #301 supplies the qualified selection and projectile decision. Commit
activates replacement collision/protection and hides the original without yield,
allocation, disk access, model request or log formatting. These native calls
are ordered, not an engine transaction; retain enough state to diagnose partial
failure. Do not clear the hide record/state until verified restoration succeeds.

Keep the original authoritative outside a bounded prearm radius and until the
qualified commit. Start with policy values **30m prepare / 45m retire**, two
contexts and one commit in flight; these are tuning hypotheses. Require a
collision-loaded original and approach/velocity conditions the predictor
supports. If preparation is late, leave the original and record unsupported
activation; no synthetic replacement explosion. No promise that arbitrary
player-fired rockets, rear approaches, hitscan or vehicle impacts work yet.
Carry #301's actual trigger envelope forward unchanged.

X8 preserves a damaged live instance and never rebuilds it on another hit.
Only one qualified breach per instance is accepted initially; expanding a breach
is a later native rearming experiment. Retirement explicitly restores vanilla
and reports session damage reset. **X8 is session-local, with no persistent
destruction claim across streaming or save/load.** Do not permit silent native
stream loss to masquerade as a reset: detect missing owned roots and enter
reconciliation/restoration. Broken objects remain managed while within the
supported area. Abort/failure outcomes stay distinct from gameplay acceptance.

**First category:** `prop_fnccorgm_02e` (recorded hash 1185366416), at two
unobstructed differently headed instances chosen in a later local audit. It has
measured dimensions, matched original art, removable collision, known seams and
existing protected native fragments. Reuse uniform j1400 section assets. The
prototype's coordinates are synthetic, not the two real placements. Avoid the
known negative-U obstruction and NVE-overridden resources.

**Go:** same definition at both placements, automatic selection retained,
original-only collision before impact, correct two-section native breach and
actual player passage at each; A cleanup leaves B and unrelated sentinels
unchanged; 9/9+visible originals and stopped-game hash rollback. Two loaded
contexts must be observed at least once; one shot at a time is sufficient.

**Stop/cut scope:** after two failures of the same identity/restore hypothesis,
stop rollout and preserve evidence. If concurrent ownership needs a host rewrite,
ship a sequential one-loaded-instance registry first. If a candidate leaves ghost
collision or hides a neighbor, reject that placement after at most two focused
checks. Do not tune fragment strength or rewrite physics to fix ownership.
No pool-limit increases. One cloud coding slice plus one short local acceptance
window should decide whether to continue; a second window requires a specific
failure hypothesis, not another broad matrix.

## Three bounded milestones after X8

| Order | Work | Concrete success / stop criterion |
| --- | --- | --- |
| **X9: one additional freestanding masonry-panel family** | Inventory one short isolated concrete/brick perimeter panel with open ground behind; prove collision owner first; no-edit round trip; author 4–8 independently protected fragment section roots along joints, following X7 and staying within measured pool headroom. Keep first material policy RPG-only | One new definition/recipe, two placements, approved intact visual match, native walkable hole, protected neighbors, full restore. Source assets stay private. If ghost collision remains or two authoring iterations need predictor/physics changes, choose another asset; no whole-block YBN surgery |
| **X10: serial impact on the existing fence** | Two deliberately spaced native RPG impacts; rearm only intact eligible sections, retain earlier roots/holes, latch per-impact decisions | Prior broken mask never shrinks; no respawn/healing, no extra blast, no unintended delayed fracture of protected survivors, final passage and restoration. If protection rearming exposes stored damage or first blast still acts unpredictably, keep one-breach policy and defer widening; no per-child memory hacks |
| **X11: logical persistence for the fence family** | Generate two root-only remnant types; versioned JSON snapshot; rebuild survivors/remnants across stream-out/in and explicit mod save slot | Identical hole and retained rail/post, two streaming cycles and one process/save-slot reload, no replayed impacts or saved debris, corrupt/revision mismatch disables/logs safely. If original cannot be suppressed before approach, restrict supported area; no exact physics serialization |

These are capability gates, not promises to complete a universal simulator.
Building work starts after a small stable palette and lifecycle are useful in
ordinary play, not after an exhaustive city conversion program.

## What a small building actually requires

A convincing first building is an **authored single-storey shed with breakable
nonstructural wall modules under a stable roof/frame**. Add interior/back faces,
foundation edges, corner caps, door/window boundaries, debris budget and broken
LOD representation. Existing city buildings also require auditing shared normal
and hi@ YBNs, multiple drawables, world LOD parents, occlusion and possibly MLO
portals. Choose a different site if those owners cannot be isolated cheaply.

Genuine collapse additionally needs defined load-bearing members, connectivity
and support-loss rules, cluster collision transitions and a controlled outcome
for occupants. A tiny authored dependency graph can release one roof cluster
after specified supports disappear. That is a playable staged collapse, not
stress simulation. Continuous structural solving, arbitrary fracture, exact
rubble saves, navmesh regeneration and universal interiors can all be deferred.

## Prototype and validation boundary

[tools/destruction-catalog](../../../../tools/destruction-catalog/README.md)
contains a dependency-free compiler using existing custom X7 XML/manifest data.
It checks the narrow j1400 family contract and compiles physical section origins
and nine witness rays for translated/rotated synthetic placements. It rejects
unsupported transforms and ambiguous IDs/scopes. Output explicitly cannot be
fed to today's runtime. It is useful evidence that the placement/asset seam can
be small; it is not an asset converter, runtime manager or gameplay test.

Offline validation and publication details are in [VALIDATION.md](VALIDATION.md).
