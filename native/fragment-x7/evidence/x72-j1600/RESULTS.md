# X7.2 j1600 localization test — October 22, 2026

**Verdict: j1600 does not work. Both real RPG shots (center U=0 and off-center U=+0.65) detached 0 of 5 strips, so no opening formed and nothing localized.** Neither shot was promising, so the center repeat and the U=-0.65 shot were not run, as the test plan specified.

COMRADE / RTX 5090, branch `experiment/astra-001-x7-localized-fracture` (PR #296, draft, not merged). j1600 was built with the existing Blender 5.2.2/Sollumz → CodeWalker dev48 pipeline and differs from j1400 only by name and the 15 strip values (strength/health 1600, min damage force 320). Same driver as X7.1/X7.2 (SHA256 `6b3aa048...`). Afterburner profile 1 was already set for the session. DLSS5 was kept off by renaming the two RenoDX DLSS add-ons for the run instead of pressing F6; the ReShade log shows no add-on load (`logs/reshade-addon-check.txt`). No synthetic blast, scripted fragment removal or collision bypass.

## Results (fresh original 9/9 and dormant twin 0/9 before each shot)

| Measurement | j1600 center U=0 | j1600 off-center U=+0.65 |
|---|---:|---:|
| Projectile impact U / V (last track sample before the explosion) | -0.011 / 0.834 | 0.640 / 0.834 |
| Strips detached (native parts) | **0** | **0** |
| Strips surviving | 5 | 5 |
| Twin collision mask | 100% blocked, every cell | 100% blocked, every cell |
| Usable opening | none | none |
| Player traversal | not attempted, no opening (no teleport or bypass) | not attempted, no opening |
| Swap before explosion | 2 frames / 16 ms | 2 frames / 17 ms |
| Commit call | 0.078 ms | 0.069 ms |
| Near-event frame max (baseline median) | 10.8 ms (7.1) | 9.3 ms (7.1) |
| Frames over 50 ms | 0 | 0 |
| Fallback blast used | no | no |
| Original restored after trial | 9/9 | 9/9 |

Hot-swap, native-fracture plumbing, frame cost and restoration all behaved as in X7.1/X7.2. The impact point landed within 0.01 m of the aim point on both shots, so this is not an aiming problem.

## Comparison across thresholds (strips detached of 5)

| Strength / health | Result |
|---|---|
| j1000 | 5 (X7.1) |
| j1300 | 3 (X7.1, center) |
| j1400 | 3 (X7.1 center), 4 (X7.2 center repeat), 5 (X7.2 off-center +0.65) |
| **j1600** | **0 center, 0 off-center** |
| j1800 | 0 (X7.1, center) |

## Diagnosis

The failure at j1600 is **insufficient fracture**, the same as j1800. The failure at j1400 is **excessive detachment**. Together they point to **impact-location insensitivity** as the underlying cause: across the five equal strips the response behaves like a threshold switch, flipping from "3–5 strips go" at 1400 to "none go" at 1600, with no stable partial regime between them. The off-center j1400 shot removed all five strips, including the one ~1.4 m from a verified impact at U=0.64, which is what a near-uniform force across the sheet would produce.

This is an inference from few shots (three at j1400, two at j1600, one at j1800), not a measured force profile. At j1600 nothing broke, so these two shots carry no location information at all.

## Recommendation

More uniform-threshold tuning is not justified: 1400 and 1600 already bracket the transition and the shot-to-shot spread at 1400 (3, 4, 5) is as large as the whole range of interest. Smallest next step, in order:

1. **Instrument, don't tune.** Have the driver log the detached-strip set per frame for the ~300 ms after the explosion. If all strips detach in the first frame, force is uniform across the sheet and the blast, not chaining, decides the outcome. If they detach one after another starting near the impact, debris chaining is spreading the damage, and the fix is on the hierarchy side.
2. **If force is uniform:** the native hierarchy cannot localize it, because all five strips are siblings with equal strength and zero transmission. The smallest structural change to test is splitting the sheet into independent narrower fragment props, so the explosion's distance falloff acts per prop. This is an untested hypothesis.
3. **If chaining:** test whether lowering neighbor-strip collision or force transmission stops the cascade.

For a personal mod today, j1400 remains the usable setting: it reliably makes a player-traversable breach (X7.1, X7.2), but the breach is wide (3–5 strips) and not tied to the hit point. Do not proceed to X7.3 visual polish until localization is addressed.

## Limits

Two shots only, one session. Screenshots are the two after-shot frames (fence intact); no before or player-through shots exist for this run since no opening formed. The center repeat and the U=-0.65 shot were not run. The X7a Session A and X7b/X8 gates remain unpassed. GTA was shut down and all five install paths are hash-restored, with the DLSS add-ons renamed back (`install-restored.json`). Nothing merged.
