# X7.2c native API references and architecture comparison

Research date: October 22, 2026. Audited X7 source: `a613f8e2987fba85e63c4444b61b8d037dc2b56c`. This document specifies a candidate adapter; it does not wire a runtime path, change assets, or establish gameplay acceptance. GTA was not launched for this work.

## Recommendation and evidence boundary

Recommend **five existing weak native section props with selective per-object fracture enabling** as the smallest gated candidate. Every section remains visible and colliding after the original is hidden; only the selected pair becomes damageable and breakable. This is possible at section granularity because each X7d section is a separate native object. It is not a per-child native interface, a runtime change to authored fragment thresholds, or scripted detachment.

The decisive unverified assumption is that the three existing protection flags can preserve a **visible, colliding** weak section during an actual RPG blast while its selected neighbors fracture. Dormant twins have collision disabled, so the prior dormant observations do not prove that assumption. If an isolated gameplay discriminator fails, use **pre-staged strong/weak native pairs** instead: select one active prop per position, leaving the alternative dormant. The fallback also requires its own staging, collision and cleanup verification.

The current [X7.2b results](../evidence/x72b/RESULTS.md#phase-2--independent-sections-assets-x7d-pack-x7d-dlc-lsa_fence_x7d) support the following limited observations:

- Five separate `j1400` props still broke five of five sections in the uniform center trial.
- An inverted profile broke the two outer weak sections while its three strong middle sections stayed intact.
- Near-weak profiles broke the selected pairs `[1,2]`, `[3,4]`, and `[0,1]`. Center and positive-offset trials produced within-footprint traversal; the negative-offset traversal was blocked by another map obstacle.
- The profiles were chosen during preparation, not from a newly observed projectile at commit. `j2400` was built but not tested. The successful positive-offset repeat is useful evidence, not a broad reliability guarantee.

These observations support the inference that the strength pattern controls the broken-section set in the tested cases. They do **not** measure equal damage, establish a RAGE force formula, distinguish every blast/secondary-collision mechanism, or prove performance on wider walls, new weapons, accumulated hits, or arbitrary impacts. The stronger wording about near-uniform damage magnitude in the old results is an interpretation of outcomes, not an instrumented force measurement.

## What the available APIs establish

The primary sources below were inspected on the research date. Upstream `main`/`master` source is documentation evidence, not proof that it exactly matches the installed SHVDN Enhanced 3.9 binary. The explicit hash calls already present in X7 avoid adding reliance on newer wrappers.

| Native or source | Documented interface / source fact | Limit relevant to X7.2c |
| --- | --- | --- |
| [SET_DISABLE_FRAG_DAMAGE](https://github.com/citizenfx/natives/blob/master/PHYSICS/SetDisableFragDamage.md) | Object and Boolean parameters; hash `0x01BA3AED21C16CFB`. | No child/group parameter and no documented guarantee covering live Enhanced blasts, delayed damage, or later rearming. |
| [SET_DISABLE_BREAKING](https://github.com/citizenfx/natives/blob/master/PHYSICS/SetDisableBreaking.md) | Object and Boolean parameters; hash `0x5CEC1A84620E7D5B`. | Signature confirms an object-scoped toggle. Its name alone does not prove complete protection against every fragment failure path. |
| [SET_ENTITY_CAN_BE_DAMAGED](https://github.com/citizenfx/natives/blob/master/ENTITY/SetEntityCanBeDamaged.md) | Entity and Boolean parameters; hash `0x1760FFA8AB074D66`. | General damage permission is distinct from authored fragment-group strength/health and from collision visibility. |
| [SET_ENTITY_COLLISION](https://github.com/citizenfx/natives/blob/master/ENTITY/SetEntityCollision.md) | Entity, collision Boolean and `keepPhysics` Boolean; hash `0x1A9205C1B9EE827F`. | X7 explicitly uses `keepPhysics=true`. Do not infer that collision-off alone blocks explosion damage. |
| [SET_ENTITY_COMPLETELY_DISABLE_COLLISION](https://github.com/citizenfx/natives/blob/master/ENTITY/SetEntityCompletelyDisableCollision.md) | A separate native with collision and `keepPhysics` parameters; hash `0x9EBC85ED0FFFE51C`. | Do not replace the existing collision call with a similarly named native without new evidence. |
| [SET_OBJECT_PHYSICS_PARAMS](https://github.com/citizenfx/natives/blob/master/OBJECT/SetObjectPhysicsParams.md) | Mass, gravity, damping, margin, angular-speed and buoyancy parameters. | This is not a documented setter for section-child strength, minimum damage force or fragment-group health. |
| [SET_ENTITY_PROOFS](https://github.com/citizenfx/natives/blob/master/ENTITY/SetEntityProofs.md) | Separate bullet, fire, explosion, collision and other proof switches. | These are additional damage flags, not established substitutes for fragment-breaking controls in this experiment. Adding proof flags would introduce another hypothesis. |
| [SHVDN Enhanced `Entity.cs`](https://github.com/Chiheb-Bacha/ScriptHookVDotNetEnhanced/blob/main/source/scripting_v3/GTA/Entities/Entity.cs) | The fragment region exposes inspection and scripted detachment. The `IsCollisionEnabled` setter passes `keepPhysics=false`; explosion-proof access uses native-memory flags. | Preserve X7's explicit collision native with `true`. Inspection APIs do not establish per-group threshold mutation. Scripted detachment would violate the proposed native-fracture gate. |
| [GET_OBJECT_FRAGMENT_DAMAGE_HEALTH](https://github.com/citizenfx/natives/blob/master/OBJECT/GetObjectFragmentDamageHealth.md) | Read interface with partly opaque parameters. | It does not supply a demonstrated per-section threshold setter or independently verify the actual damage field. |
| [BREAK_OBJECT_FRAGMENT_CHILD](https://github.com/citizenfx/natives/blob/master/OBJECT/BreakObjectFragmentChild.md) | Explicit child-breaking interface, partly opaque parameters. | Excluded: selecting damage eligibility is allowed by the proposal; manufacturing a broken child is not. |
| [FIX_OBJECT_FRAGMENT](https://github.com/citizenfx/natives/blob/master/OBJECT/FixObjectFragment.md) | Resets children of a fragment object. | Excluded from impact/second-impact handling: restoring children could heal a previously opened breach. |

This review found no supported per-child threshold-setting interface in these sources. That is a scoped finding, not a claim that no reverse-engineered internal engine mechanism could exist. Raw fragment-memory edits are outside the smallest safe implementation.

## Exact candidate flags and physical state

Use independent state setters for rendering/collision and damage permission. In the current source, [`X7SetDormantOne`](../WpsBreachLabX7.3.cs) couples both, and its active branch enables breaking and damage on every section. Reusing that active branch for all five weak props would remove the proposed isolation.

| State of a section prop | `IsVisible` | `SET_ENTITY_COLLISION` (`toggle`, `keepPhysics`) | `SET_DISABLE_FRAG_DAMAGE` | `SET_DISABLE_BREAKING` | `SET_ENTITY_CAN_BE_DAMAGED` |
| --- | --- | --- | --- | --- | --- |
| Prepared dormant, either architecture | `false` | `false, true` | `true` | `true` | `false` |
| Recommended candidate: selected weak section | `true` | `true, true` | `false` | `false` | `true` |
| Recommended candidate: nonselected weak section | `true` | `true, true` | `true` | `true` | `false` |
| Fallback: chosen weak section | `true` | `true, true` | `false` | `false` | `true` |
| Fallback: chosen strong section | `true` | `true, true` | `false` | `false` | `true` |
| Fallback: unused alternative at any position | `false` | `false, true` | `true` | `true` | `false` |

For the fallback, active strong sections survive by **authored `j1800` thresholds**, not by damage immunity. Their survival is established only for the tested static profiles and RPG conditions; repeated damage or another explosive may break them. The weak and strong asset roots retain the high authored root thresholds. Position zero needs the post-bearing `secp` variant for either selected strength.

After the existing physical attachment, the section wall is **not position-frozen**: `AttachNativeAnchor` sets `wall.IsPositionFrozen=false`, makes it dynamic and attaches it physically to a frozen, invisible, noncolliding, invincible anchor. This differs from `SET_ENTITY_COLLISION(..., ..., true)`: preserving physics is not the same operation as freezing the wall. Do not leave the wall frozen to enforce isolation, and do not toggle its dynamic/attachment state as part of selecting a fracture pair. Preserve the existing native attachment and let RAGE create debris.

Install all protection flags immediately after creation and before any yield in a future adapter. Current `Spawn` initially hides and disables collision, then yields twelve times; full damage protection follows later. `ConfigureWall` also enables damage before the final dormant call. Those windows must be closed before protection is relied upon during unrelated live explosions.

The proposed commit remains contiguous script calls with no model requests, spawning, logging or yields. That removes script scheduling gaps, but is not a proven engine-level transaction. Collider replacement order and the chosen state must still be observed during gameplay.

## Cost and failure comparison

| Concern | Runtime enabling on five weak sections | Pre-staged weak/strong pairs |
| --- | --- | --- |
| Prepared native objects | Five section roots plus five anchors. | Ten section roots plus ten anchors; only five section props active. |
| New assets needed | None: existing `j1400` plain/post models. | None: existing `j1400` and `j1800` plain/post models. |
| Timed decision | Enable damage/breaking on the selected pair; keep all section collision/rendering on. | Activate one prepared alternative per position; keep the other dormant. |
| Closest existing evidence | Collision-off dormancy and successful native `j1400` fracture; live isolation is unproven. | Successful active static mixed-strength profiles; paired dormancy and commit-time switching are unproven. |
| Principal new risk | A protected visible/colliding neighbor can still fracture, accumulate damage, or fail when later rearmed. | An inactive duplicate can be damaged or leave debris; both alternatives may collide; ownership/cleanup must include both. |
| Second-impact complexity | Same objects can in principle preserve old damage, but rearming and broken-child detection require proof. | Switching to a fresh duplicate risks healing a breach or losing accumulated damage; inactive alternative health may already be changed. |

The runtime option has fewer entities and fewer selection/lifetime transitions. Its unverified isolation behavior is a reason for one discriminating gameplay test before broader integration, not a reason to declare it implemented. The fallback trades that assumption for previously observed active strength-profile behavior and additional staging assumptions.

## Original hiding and restoration reference

[`CREATE_MODEL_HIDE_EXCLUDING_SCRIPT_OBJECTS`](https://github.com/citizenfx/natives/blob/master/ENTITY/CreateModelHideExcludingScriptObjects.md) targets objects of a model intersecting a sphere and excludes script-created objects. Therefore the tiny X7 hide radius is not an exact-handle identity filter: another matching object intersecting that sphere may also be affected. `surviveMapReload=true` preserves the hide across a map reload; cleanup must remove the matching hide even after an error or stream transition.

[`REMOVE_MODEL_HIDE`](https://github.com/citizenfx/natives/blob/master/ENTITY/RemoveModelHide.md) with `lazy=false` restores in-scope matches immediately according to the reference. Neither documented visibility semantics nor a successful call independently certify restored collision or an undamaged original. Reacquire the placed original, verify its identity and restore witnesses, and preserve a failure state when that verification fails. Original 9/9, dormant 0/9 and restored 9/9 remain separate physical observations.

## Required gameplay discriminators

1. **Isolation:** activate five weak sections, protect three using the exact table and expose them to the same real RPG blast as the selected pair. Observe per-position native fracture and collision, including any delayed secondary debris damage.
2. **Rearming:** after a protected survivor experiences the blast, arm it without firing. It must not break from stored damage; then perform a separate bounded hit. Do not assume a fixed 0.5-second delay is sufficient.
3. **Selection timing:** observe actual projected impacts at center, positive/negative offsets, pair boundaries and footprint edges. Verify selection uses projected `uc/vc`, explicit section IDs and a stable frame, not `aimu` or list order. Current lists start with the center section.
4. **Collision and visibility:** nonselected weak sections stay solid; fallback has exactly one active alternative per position. Opening rays and player traversal must distinguish section collision, native debris and unrelated map obstacles.
5. **Predictor and miss safety:** verify oblique/reverse-direction trajectories, unrelated projectiles, tracking gaps, premature disappearance, late arrivals and misses. A nearby explosion is not proof of the tracked projectile's section impact.
6. **Second impacts:** retain the existing single-impact `Armed` to `Active` rejection initially. A later extension must preserve earlier holes and native debris without respawn, `FIX_OBJECT_FRAGMENT` or full-profile replacement. A second hit through an existing hole must not manufacture a new break elsewhere.
7. **Restoration and performance:** after normal, aborted, missed and faulted paths, verify the original, hide cleanup, all owned roots/anchors/debris and pool counts. Measure the actual new selection/commit cost and a full one-second window on either side of the event. Old short windows and finite `j1800` survival do not certify the new design.

The implemented offline selector tests establish deterministic geometry, rejection and tie-breaking. They do not test the runtime lifecycle or establish any native behavior in this section.
