# X7.2c runtime audit

Audit baseline: X7 branch head `a613f8e2987fba85e63c4444b61b8d037dc2b56c`, October 22, 2026. This is a source audit and integration design. No GTA process, installation, asset export or gameplay test was used. Line links refer to the unchanged checked-in runtime at this baseline.

## Findings and minimal integration repairs

| Area | Current source fact | Required repair before selective gameplay activation |
| --- | --- | --- |
| Projected impact | The predictor computes projected `uc/vc`, then retains current projectile `u/v`, TTC and an on-course boolean. [Projection and candidate ranking](../WpsBreachLabX7.3.cs#L827). | Carry projected impact U/V into the decision and commit log. Never select from the requested `aimu`, current projectile U, or a prepare-time strength profile. |
| Projectile eligibility | Any existing projectile within 90 m is considered. There is no weapon/owner binding. A nearer off-course projectile can replace an on-course candidate because ranking is by plane distance before testing `bon`. [Query and ranking](../WpsBreachLabX7.3.cs#L818). | Filter qualified approaching/on-course candidates before ranking. Use a deterministic tie-break and bind the tracked projectile to the controlled shot where the API permits. If attribution is unavailable, restrict the experiment to one projectile and disclose that limit. |
| Passed plane / bad samples | Positive local-T velocity is required, but the predictor accepts up to 0.6 m beyond the face and clamps TTC to zero. Finite values, sample age and velocity discontinuities are not explicitly checked. [Prediction](../WpsBreachLabX7.3.cs#L824). | Reject passed-plane, non-finite, stale or invalid samples for selection. Keep the first version scoped to the current front-face approach. Do not use a broad explosion query to repair a late decision. |
| Eligibility footprint | The current on-course test admits 0.4 m outside each sheet edge. [Bounds](../WpsBreachLabX7.3.cs#L833). | Keep broad tracking separate from strict selection eligibility. A prediction outside the actual sheet must produce no section decision, rather than clamp to an edge pair. |
| Stable section identity | Section-list order is center, 0, 1, 3, 4. All `Lab.Index` values are zero for shared debris accounting. [Section creation](../WpsBreachLabX7.3.cs#L693). | Store an explicit position-indexed map `0..4` from negative U to positive U. Neither list position nor `Lab.Index` is a section address. Derive the position axis from the same local-U transform used by prediction; the present section placement uses `RightVector`. |
| Dormant versus protected | `X7SetDormant(false)` activates every section; `true` hides it and disables its collision as well as damage/breaking. [State helpers](../WpsBreachLabX7.3.cs#L604). | Separate presence (visible and colliding) from fracture permission. All five sections must be present after commit, while only the selected pair may fracture. Calling `Dormant(true)` for retained sections would create invisible holes. |
| Preparation exposure | At creation, the dormant fast path sets visibility/collision only, then yields twelve frames. `ConfigureWall` enables damage/breaking before the final whole-layout dormant call. [Spawn](../WpsBreachLabX7.3.cs#L1111), [configuration](../WpsBreachLabX7.3.cs#L2032), [final dormant call](../WpsBreachLabX7.3.cs#L716). | Apply full dormant protection immediately after creation and preserve it through configuration, before any yield. Validate all roots and anchors before entering Armed. Sparse 0/9 witnesses alone do not prove every section is intact. |
| Hot commit | The commit has no yield, log, file read or model request. Replacement activation precedes original-model hiding. [Commit](../WpsBreachLabX7.3.cs#L625). | Preserve those properties. Precompute the pair, validate handles and prepare the native-call plan beforehand. Record one committed decision after the native calls. Do not spawn or request models in the timing-critical commit. |
| Partial failure | A failed native call can leave some replacements active. The command catch logs the exception and skips normal cleanup while X7 state is non-None. [Command handling](../WpsBreachLabX7.3.cs#L119). | Add an explicit failed-commit state and rollback path. Revalidate roots before mutation; account for partial activation and a possibly installed model hide. Do not treat an exception as a clean miss or permit a second shot until restored. |
| Original hiding | `CREATE_MODEL_HIDE_EXCLUDING_SCRIPT_OBJECTS` targets the original model/position at radius 0.15 m, after replacement activation. [Hide](../WpsBreachLabX7.3.cs#L630). | Preserve the original's recorded transform/model. Verify no original collision remains and neighboring originals survive. Paired fallback props are script objects and need explicit activation/deactivation; the model hide will not choose among them. |
| Collision evidence | `IsWall` recognizes all registered section handles when using the center frame. Bidirectional classification treats debris and unknown/map hits as blocking. [Section classification](../WpsBreachLabX7.3.cs#L578), [rays](../WpsBreachLabX7.3.cs#L1152). | Retain that conservative classification. Register exactly the active roots; inspect both directions and full-height passage. Keep a static map obstacle distinct from retained sheet collision. |
| Ownership and debris | Native parent-detachment evidence attributes debris. Cleanup revalidates that evidence before deleting; newly streamed ambient props remain observation-only. [Attribution](../WpsBreachLabX7.3.cs#L1979), [deletion guard](../WpsBreachLabX7.3.cs#L2082). | Keep ownership verification. Include every staged root/anchor in ownership, while retaining debris attribution for every activated section. Do not delete a section or ambient obstacle to manufacture an opening. |
| Restoration | Cleanup deletes debris, roots and anchors, then removes the model hide and waits 60 frames. The original handle is reacquired by model/proximity. `restoredToOriginal` accepts 8/9 witnesses. [Cleanup](../WpsBreachLabX7.3.cs#L1803), [restore](../WpsBreachLabX7.3.cs#L1053). | Require the experiment's stricter fresh-world 9/9 restoration criterion. Keep the player clear during restoration, check replacement/debris residue, and distinguish filesystem rollback from in-world recovery. Deletion helpers catch failures, so clearing ownership lists is not a physical cleanup receipt. |
| Second impact | `x7shot` accepts Armed only; a committed result becomes Active. A second controlled shot is rejected, while active roots can still receive ambient/manual damage. [Guard](../WpsBreachLabX7.3.cs#L738), [result state](../WpsBreachLabX7.3.cs#L923). | Keep the first experiment single-impact and require restore/reprepare. Do not reset the whole twin, resurrect detached pieces, or imply multi-impact support. A separate later design must preserve broken-section identity and define cumulative health, residual blast and rearming behavior. |

## Architecture recommendation and fallback

The smallest runtime candidate uses the current five weak independent native props and their five anchors. At commit, all five become visible and colliding; only the deterministic selected pair has fragment damage, breaking and damageability enabled. Retained sections stay protected for the entire Active lifetime. This removes prepare-time knowledge of the aim without adding models or props.

This recommendation is conditional on a discriminator gameplay test: the protection flags must preserve a **visible, colliding, anchored** unselected section under the same real RPG explosion that breaks selected sections. Existing collision-off dormant evidence does not establish that property. Do not rearm neighbors after an assumed 0.5-second blast lifetime. The earlier research explicitly identifies live-blast protection as unverified: [doc 16, engine limits](../../../docs/next-gen-gameplay/astra-001/16-X7-LOCALIZED-FRACTURE-RESEARCH-20261021.md#10-tool-and-engine-limits-verified-vs-assumed).

If that discriminator fails, use two pre-staged native props per position: weak j1400 and strong j1800, each with its own anchor. Activate exactly one of the pair at each position; the other stays invisible, noncolliding and damage-disabled. Position 0 needs post-bearing `secp` variants of both strengths. This costs ten roots plus ten anchors rather than five plus five, and introduces exclusive-collision/cleanup obligations, but the [X7.2b fixed-profile trials](../evidence/x72b/RESULTS.md#phase-2--independent-sections-assets-x7d-pack-x7d-dlc-lsa_fence_x7d) directly support weak/strong profile behavior at the tested site. They do not prove paired staging or arbitrary impact adaptation.

Neither architecture changes native fracture into scripted detachment. The selector grants damage eligibility; the real projectile and native physics must still create the hole.

## Tests and gameplay assumptions

Offline tests can establish deterministic projection and pair selection, including oblique velocity, sheet edges and seams, stable ties, candidate reordering, invalid/non-finite samples, receding/passed-plane projectiles, out-of-sheet impacts, no eligible candidate and repeatability. A future runtime adapter should also have fake-native call-order tests for all five positions present, exactly two fracture-enabled, no yield/load in commit, and rollback after each possible failing mutation. These are logical properties, not native-engine observations.

Gameplay must establish all of the following before enabling the candidate:

1. Live-blast protection with retained collision and visible geometry; no delayed detachment, root movement or hidden cumulative damage.
2. The projected point is accurate enough at the actual commit horizon, including seam/edge/oblique shots and projectile tracking gaps. The existing explosion sphere is proximity evidence, not attribution to the tracked projectile or proof of a fence-plane hit.
3. Protected sections transmit or block collision and explosion forces without causing unintended detonation, overlap or propagation into other sections.
4. The selected two adjacent sections break natively and produce a real full-height passage; player crossing stays inside the footprint and does not use static-map detours. Negative-U traversal remains obstructed at the previous site.
5. The original is fully hidden, neighbors remain unchanged, every replacement is removed, and original collision restores to 9/9 after success, miss, abort and partial failure.
6. Fallback only: dormant weak/strong overlap does not introduce collision, physics or render artifacts; exactly one root per position is active, and doubled pool usage remains acceptable.
7. Second-impact behavior is explicitly **unaccepted**. Later manual/ambient impacts, residual explosions, cumulative j1800 damage and any future rearming require independent tests; the first candidate remains restore-between-shots.
8. Performance uses a real time-based window spanning at least one second before/after the event. The inherited frame-index window at [lines 898 onward](../WpsBreachLabX7.3.cs#L898) does not guarantee that duration at every frame rate.

## Reproducible generator repair made with this audit

`build_x7.py` previously regenerated the earlier X7 baseline from frozen X6, omitting the checked-in X7.2b independent-section and probe changes. That would overwrite the current experiment when following the documented build command.

The repair adds thirteen explicit, uniquely checked substitutions for that delta, preserving the frozen X6 derivation. It does not copy the whole driver into a second template and changes no runtime behavior. Generation aborts before writing if any X7.2b match is missing or ambiguous.

Validation on this source audit:

- `python native/fragment-x7/build_x7.py` succeeds.
- `git diff --exit-code -- native/fragment-x7/WpsBreachLabX7.3.cs` succeeds after generation.
- SHA-256 before and after: `e16d89ad3c48faa86416f649ba3d52cea0093e4d064fed3f4276fd7f7975750d`.
- `python native/fragment-x7/validate_x7.py` passes source checks; it does not claim real export validation or gameplay acceptance.
- `python -m unittest discover -s native/fragment-x7 -p 'test_*.py'`: twelve existing tests pass.
- A scratch-copy mutation of the frozen-source section-identity anchor is rejected by the new drift guard, and the previous generated output remains byte-identical after rejection.

No runtime integration repair listed above is silently included in the generator change.
