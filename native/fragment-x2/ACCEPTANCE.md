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
