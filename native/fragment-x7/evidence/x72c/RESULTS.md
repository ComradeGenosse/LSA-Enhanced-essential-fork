# X7.2c — Selective native fracture on five independent j1400 sections

Branch `experiment/astra-001-x7-localized-fracture`, draft PR #296, started from head `179312c2`. Windows desktop, GTA V Enhanced, SHVDN driver `WpsBreachLabX7.3.cs`. Real RPG hits only; no scripted detachment, no deleted sections, no manufactured openings, no synthetic blast.

## Experiment (smallest possible)

Existing assets (`assets-x7d/`, `pack-x7d/`, five `lsa_x7d_sec[p]_j1400` props, each with its own root anchor) and the existing hot-swap/probe/walk/restore tooling. One driver addition, `x7prepare sel=a,b` (two adjacent positions 0..4, negative U to positive U):

- while Armed, every section is invisible, collision-off and protected (`SET_DISABLE_FRAG_DAMAGE`=true, `SET_DISABLE_BREAKING`=true, `SET_ENTITY_CAN_BE_DAMAGED`=false), unchanged from X7.2b;
- at the existing 1–3 frame pre-explosion commit, `X7ActivateSelective()` makes **all five** sections visible and solid, enables native damage/breaking (false,false,true) on the two selected sections only, and leaves the other three protected (true,true,false). Flags first, collision second, visibility third; no thresholds, models or fragments are changed; sections stay anchored.
- afterwards `x7_secstate` logs each section (exists, visible, attached, moved, root alive) next to the existing per-strip collision probes, dense collision mask, native debris rows and frame timing.

`build_x7.py` carries the delta (`X72C_PATCHES`) and reproduces the checked-in driver byte-for-byte (sha256 B00ECCAE1699B324...). The driver compiled and ran in GTA Enhanced with SHVDN 3.9.

## Gameplay results (all four shots: 9/9 original restored, no frame over 50 ms)

Probe columns are the final per-strip collision class at 3 heights (`300` = blocked at all heights, `000` = open). Positions run from negative U (0, with the end post) to positive U (4).

| shot | selected | aim | strips broken | protected strips | opening | player traversal |
|---|---|---|---|---|---|---|
| `x72c_sel23_center` | 2,3 | U=0 | exactly 2 and 3 (first detach 2 and 3 frames after explosion) | 0,1,4 intact: visible, attached, solid (`300`) | mask cols 10–19 open (about 1.0 m) | crossed at U=0.228, lane 1.0 m, inside footprint, rise 0: **passed** |
| `x72c_sel34_off065` | 3,4 | U=+0.65 | exactly 3 and 4 (frames 2 and 3) | 0,1,2 intact (`300`) | mask cols 15–24 open | crossed at U=0.687, lane 0.9 m, inside footprint: **passed** |
| `x72c_sel34_hit_protected_center` (control) | 3,4 | U=0, rocket hits protected section 2 | exactly 3 and 4 (frames 3 and 6) | 0,1,2 intact, including the directly hit section 2 | same as above | not walked |
| `x72c_sel23_center_repeat` | 2,3 | U=0 | exactly 2 and 3 | 0,1,4 intact | same as shot 1 | crossed at 0.286, lane 1.0 m: **passed** |

In every shot `nativeParts` = 2, `x7_secstate` shows all five sections exist, are visible and attached with root alive, and the open strips are exactly the selected ones. Screenshots in `screenshots/` show the gap and intact neighbors.

Performance (probe on): commit call 0.080–0.446 ms (the first shot's 0.446 ms was one outlier; the rest 0.08–0.098), 1–2 frames before the explosion, frame-time window max 10.3–11.8 ms against 6.9–7.2 ms baseline median (probe overhead 0.3 ms mean). Section-state logging runs after the window.

Restoration: each x7restore returned original visible with 9/9 witnesses; GTA stopped via Steam; `x7_install.py restore` returned `ScriptHookVDotNet.ini` C9ECD8E2..., `dlclist.xml` C0C9D70C..., the DLSS add-ons (renamed to `.x72off` during runs, then restored with matching hashes D3184429... and A64BE8C4...), and removed `scripts-x7` and the x7d DLC (`install-restored.txt`).

## Decision gate: PASS

Proven here (one site, one weapon, 2.5 m fence, four shots):

1. The three native flags isolate sections that are visible, colliding and anchored during a live RPG blast. Protected sections took the blast at 0 to about 1 m and did not fracture, including a direct hit on a protected section (control).
2. Enabling the same flags on two adjacent sections made exactly those two fracture natively (native debris, real collision opening) and a player walked through the opening. No weak/strong model pairs or threshold tuning were needed, so the pre-staged j1400/j1800 fallback is not required.
3. The result repeated at the center and matched the X7.2b observation that the blast reaches the whole fence at similar strength: *which* sections break is decided by the per-object flags, not by distance.

Not proven / limits:

- The pair was chosen from the known aim in the command, not predicted from the projectile at commit. The control shows the selected pair breaks even when the rocket hits a protected neighbor 0.5 to 1.0 m away, so a wrong selection breaks the wrong sections. Selection quality is therefore the next risk, not the flags.
- Only the commit-time flag change was exercised; dormant protection in Armed state was only checked indirectly (all 9 original witnesses and 0 twin blockers at arming, intact protected strips afterwards).
- No second explosion, delayed damage, wider walls, different weapons, other sites, or -0.65 traversal (a static map obstacle blocks that lane).

## Smallest next step

Compute `sel` inside the existing commit from the predicted impact U instead of taking it from the command. `uc`/`vc` are already extrapolated by the commit predictor, and `ImpactSectionSelector.cs` (179312c2) provides tested pair selection: map U to the pair, call `X7ActivateSelective()` with that pair, and test the same center and +0.65 shots plus -0.65 and a few off-aim shots with `x7shot` args instead of `x7prepare sel=`.
