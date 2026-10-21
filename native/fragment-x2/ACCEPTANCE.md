# X2 preregistration — 2026-10-20

Authority: ASTRA-001 06 master plan §6 Task 2, current X1 branch 3fa135c4. Scope: one original 3 × 2.5 × .2 m concrete fragment; no X3/X4.

31 groups: high-strength root plus 30 concrete chunks. Two outer chunk columns reinforced. Frozen entity variant first, static diagnostic if needed. No damage callback deletes or replaces any chunk. Debris retained until all measurements and walks finish.

Acceptance per blast: fragment true and 31 groups; every baseline face ray blocked; baseline swept columns blocked; at least four formerly blocked rays completely clear; ≥0.6 m swept-column window at radius .3 and four heights; direct ped crossing with existing X1 .6 m lateral/.35 m climb limits; intact-column ped blocked; explicit native detached-parent evidence; root/corner-bone max movement ≤.02 m, orientation dots ≥.999, and all reinforced outer face cells still blocked. Report actual partial masks, not bounding box alone.

Run no-blast control and repeated center blasts before expanding to center/left/upper × grenade/sticky/rocket. Three fresh launches and 20 blasts required for full plan GO. Never promote a single successful run to full acceptance. If unavailable or failed, preserve exact results and identify which criteria remain open.

## Diagnostic amendments (recorded while acceptance remains open)

- Initial collider geometry used off-center vertices with zero primitive centers. Corrected to centered local primitives and distinct bone transforms; invalid baselines retained as failures.
- Added Dynamic archetype flag 131072, explicit archetype pack registration, DDS texture, and automatically hashed bone tags.
- Vehicle physics-child meshes (fragment flag 64) removed for the prop convention. First fresh frozen grenade then returned without crashing, but produced no break. Repeated spawn still reported zero bones and is refused before damage.
- Enabled rotation/translation channels on the fragment bones and restored Sollumz's default .25 force transmission. Previous zero transmission was an untested authoring assumption, not an engine requirement. Retest intact control, repeated spawn and blast before acceptance.
- X1's .6 m walk tolerance admits a path around a .5 m edge column. Such outcomes are recorded as failed controls, even when all intact rays/sweeps block. No threshold has been relaxed to accept them. Native obstacle steering was disabled for disposable test peds in X2-0.3; this did not prevent edge bypass in the measured run.

### X2-0.6 pre-registered oracle correction

The stock fence positive control establishes frozen = zero detached parts, static = five native detached parts for the same grenade. Use static anchoring for the wall. Normal concrete chunk Strength 5000 and MinDamageForce 2000 exceed one 120 kg chunk's resting weight; DamageHealth starts at 100. Root and perimeter remain strongly reinforced. All baseline rays and swept columns must still block before any blast.

Bone-count zero is observed on repeated instances, including CodeWalker output. Native bone-position queries in that state crashed the game. Avoid those APIs. Verify the actual surviving collision faces instead: 20 bidirectional surface points across both outer columns must remain root hits within .02 m of baseline, all 40 outer face-grid cells must remain blocked, and the root pose must meet the original movement/orientation bounds. This directly tests surviving structure rather than relying on a render skeleton.

Walking now records the ped's interpolated crossing of the wall plane. A crossing outside the wall footprint is `bypassed_edge`, never a valid hole traversal. An intact control may bypass the finite wall edge; its collision faces must remain closed. The hole must be crossed inside the wall footprint and retain the original .6 m lateral/.35 m climb bounds. Earlier control failures remain in evidence; they are not relabeled as passes.

### X2-0.7 native joint diagnostic

Static anchoring failed: the whole wall moved. The physical variant attaches the dynamic wall through a native fixed joint to a collision-disabled frozen stock anchor. No custom physics solver is used. The final no-blast, grenade and rocket run retained the measured outer collision faces within .02 m, but neither blast opened a hole. Acceptance remains NOT CONFIRMED; three-launch and 20-blast GO criteria have not been met.

### X2-0.8 / X2-0.9 diagnostic continuation � 2026-10-21

X2-0.8 adds an explicit releasegroup diagnostic, always ineligible for explosive acceptance. Group 15 was released through DetachFragmentPart under the physical joint. A visible single-chunk gap appeared while outer collision faces remained anchored, but no detached-parent prop was enumerated and no passable swept window formed. This proves only a scripted native group release, not an explosive breach.

X2-0.9 lowers normal group Strength to the approved starting value 100 and MinDamageForce to 100; health remains 100 and reinforced groups remain unchanged. Native output buffers are initialized explicitly, and hit flags read as 32-bit values. Failed/unresolved queries remain blocked. Compare a no-blast control and grenade/sticky/rocket trials before drawing conclusions.

### Fixed candidate qualification

Pack 180618adbe9e56bdaa9a6220e82a87effc6d624ea2b78926cc348263e60af347: strength 500, MinDamageForce 100, health 100, aggregate bounds corrected. Centre rocket scale10 passed a 1.5 m opening and actual traversal with surrounding faces anchored. Freeze this asset for three-launch / 20-blast checks. Charge comparison uses native AddExplosion scales grenade .25, sticky 3, rocket 10; these are explicit calibrated test charges, not assertions about vanilla weapon balance. Keep initial scale1 grenade/sticky diagnostics separately. Test positions centre (du0,height1), left third (du-1,height1), upper third (du0,height2). No native-release diagnostic may count as an explosive pass. Retain all failed traversal, face-query and debris-obstructed trials.

### Target-boundary investigation (before confirmation matrix)

The original left-third projection du=-1 lies exactly on the reinforced outer-column boundary. A third-launch repeat released only one part and made no clear opening; retain it as a failure. Confirmation targets the centre of the adjacent breakable chunk at du=-.75, still within the left third, and upper-third height1.75. Use a balanced 3-position � 3-charge matrix with native scales grenade .5, sticky3, rocket10, keeping the asset and script unchanged. Run the whole matrix, preserve every outcome, and report original boundary/low-charge failures alongside it. No earlier result or threshold is reclassified.
