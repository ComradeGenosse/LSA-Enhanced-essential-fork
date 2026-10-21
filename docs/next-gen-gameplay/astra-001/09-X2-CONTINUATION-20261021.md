# X2 continuation — qualification in progress

The checkpoint in 08-X2-STATUS remains historical. A later measured trial now demonstrates an anchored native breach, but full X2 GO remains open.

## First verified anchored breach

Run `20261021-111824-82a45b`, X2-0.10, source SHA `5be72312804d55e7c0ea9b68c2182fbad7fdf4aead86852623bd1c4ffb78adae`, pack SHA `63cedeef9c25f196d6e5e62d4e1d70956071a8616fb170fdce66cad35e5be995`.

Normal groups used strength 100 / MinDamageForce 100 / health 100, with reinforced root and outer columns. Native physical fixed joint retained root dynamics. No scripted group release, deletion or debris clearing was used in this blast trial.

- Intact control: 120 blocked rays, all swept columns blocked, anchored collision faces.
- Grenade scale 1: 20 explicit native detached wall props, 63 clear cells; retained debris obstructed swept traversal. NOT_CONFIRMED.
- Rocket scale 10: 20 explicit native detached wall props, 80 clear cells, zero residual cells, 1.5 m swept opening at radius .3 and four heights. Ped crossing U -.009 m, lateral .009 m, height gain .08 m, inside wall footprint. All 40 outer cells blocked and 20 outer collision face hits preserved within .008 m. LOCAL_ANCHORED_BREACH_CONFIRMED.

The removed interior is broad; it does not yet prove the approved off-centre locality matrix. Three-launch repeatability, charge/area response and 20-blast stability remain open. First-pass assets are recoverable in commit ada43a1b.

## Failed diagnostics retained

X2-0.8 `releasegroup=15` removed one interior group through the native detach API while anchored; it is always acceptance-ineligible. X2-0.9 failed at baseline because this SHVDN OutputArgument constructor rejected a boxed integer. X2-0.10 reverted explicit initialization and reads the native hit flag as a 32-bit integer. Runtime errors and incomplete measurements are retained rather than accepted.

## Next candidate

Strength 500 / MinDamageForce 100 / health 100. Aggregate fragment/drawable bounds are corrected to enclose the full wall, because Sollumz computed only bone-local single-chunk extents. The correction changes bounds only; per-chunk geometry/colliders remain unchanged. Bounds and intermediate strength must be validated together as a new asset revision. Native XML, build scripts and SHA-linked runtime records provide provenance.

## Fixed candidate launch 1

Pack SHA `180618adbe9e56bdaa9a6220e82a87effc6d624ea2b78926cc348263e60af347`, loaded UTC `2026-10-21T11:22:41.4393928Z`. Runs `20261021-112312-5588e1` and `20261021-112658-91c08f` preserve eight blasts plus an intact control, no crash. Centre rocket scale10 passed twice with 64 clear cells, 16 explicit detached parts, 1.5 m swept opening and actual traversal; the top strip and both columns remain. Before/after screenshots are `candidate500-repeat-centre-baseline.png` / `candidate500-repeat-centre-post-blast.png`. Other screenshots named after-batch or between-trials are not blast proof.

Initial scale1 grenade/sticky tests are tuning diagnostics. Calibrated centre charge comparison (.25 grenade, 3 sticky, 10 rocket) measured 0, 2.5625 and 4 square metres clear respectively. This is a native AddExplosion calibration on one concrete asset, not stock weapon balance or a multi-material result. The upper rocket cleared 3.5 square metres; left rocket clearance was obstructed by debris and did not pass traversal. Native debris remains in all acceptance measurements.

## Fixed candidate launch 2

Fresh loaded UTC `2026-10-21T11:33:07.5507356Z`, run `20261021-113317-10c8bb`. Intact control passed; centre rocket passed twice more with 64 clear cells / 16 native detached pieces / 1.5 m swept opening and actual traversal. Fourteen fixed-asset blasts now complete without crash. Low-charge left grenade, left sticky and upper grenade produced no clear area; these count as centroid failures under the strict current oracle. Locality score is 10/14, below 80%, so full GO is still incomplete despite repeatable anchored centre breaches. Upper sticky created 2.5 square metres clear centred within .15 m of its projection, but did not pass traversal or all face-hit anchoring probes.

## Fixed candidate launch 3 — core repeatability demonstrated

Fresh loaded UTC `2026-10-21T11:40:16.4465966Z`, run `20261021-114027-98d666`. Intact control and two further centre rocket traversals passed. The fixed asset has now completed 20 blast trials with no crash and six verified centre traversals across three fresh launches. Every successful centre trial retained 40 outer control cells and 20 face hits, produced native wall debris and a 1.5 m swept window, and logged a direct ped crossing inside the wall footprint. The same asset and script SHA were loaded across all three launches.

Full strict locality remains 14/20 (70%), because no-opening trials count as failures. The native explosion screenshot `launch3-centre-native-explosion.png` captures actual fragment separation; `launch3-after-batch.png` is a post-cleanup camera view and is not traversal evidence. Confirmation proceeds as a balanced 3×3 matrix at interior targets, preserving all boundary-hit/weak-charge failures. No 80% GO is claimed yet.
