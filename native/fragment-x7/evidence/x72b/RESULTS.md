# X7.2b — Impact-localized destruction: results

Branch `experiment/astra-001-x7-localized-fracture`, PR #296 (draft, unmerged). Windows, GTA V Enhanced, SHVDN driver `WpsBreachLabX7.3.cs`. All shots are real RPG hits with native fracture; no scripted detachment, no deleted sections, no manufactured openings.

## Phase 1 — Instrumentation of the existing j1400 fence (physics unchanged)

Per-strip collision probes (3 heights/strip, every frame from commit to explosion+320 ms) plus native-debris scan. Files: `phase1-summary.json`, `probe-center.jsonl`, `probe-off065.jsonl`, `logs/20261022-1342*`, `20261022-1343*`.

| shot | strips detached | first-detach frame after explosion (strip -U..+U) | spatial order (nearest first) |
|---|---|---|---|
| center (U=0) | 5/5 | 5,3,2,4,6 | 2,1,3,0,4 |
| off-center U=+0.65 | 5/5 | 8,5,4,2,3 | 3,4,2,1,0 |

Detachment is **sequential and distance-ordered** (~1 frame per 0.5 m ring), starting at the strip nearest the impact. It is not simultaneous. Whether that is a blast front or physical chaining was unresolved by Phase 1 alone.
Probe overhead: mean 0.27–0.31 ms/frame, max 1.6 ms; frame-time window max 9.7–10.3 ms vs baseline median 7.4–7.6 ms; zero frames >50 ms.

## Phase 2 — Independent sections (`assets-x7d/`, `pack-x7d/`, DLC `lsa_fence_x7d`)

The fence is rebuilt as five separate native props (same visuals, size and collision footprint, each with its own root anchor and fracture physics). The j1400 assets (`assets/`, `pack/`) are untouched.

`phase2-shots.json` has per-shot masks, first-detach frames, walk results and timing.

| shot | strength per position (-U..+U) | strips broken | walkable lane / player |
|---|---|---|---|
| independent sections, uniform j1400, center | 1400 x5 | 5/5, frames 4,2,2,3,5 | n/a |
| inverted profile, center | 1400,1800,1800,1800,1400 | 2/5 (the two OUTER strips) | none |
| near-weak profile, U=+0.65 | 1800,1800,1800,1400,1400 | 2/5 (strips 3,4) | 0.9 m lane, player crossed at U=0.677, passed |
| near-weak profile, center, strips 1,2 (v1) | 1800,1400,1400,1800,1800 | 2/5 (strips 1,2) | **failed traversal**: `no_clear_lane_0.9m` (a pre-existing static map obstacle blocks the left lane); no crossing |
| near-weak profile, center, strips 2,3 (v2) | 1800,1800,1400,1400,1800 | 2/5 (strips 2,3) | ~1.0 m lane, player crossed at 0.278, passed |
| near-weak profile, U=-0.65 | 1400,1400,1800,1800,1800 | 2/5 (strips 0,1) | blocked by a pre-existing static map obstacle at the site (not the fence); no lane test |
| near-weak, U=+0.65 repeat | same | identical mask | identical: crossed at 0.678, passed |

All shots restored the original object (9/9 witness rays). Window max frame time 9.5–11.8 ms vs baseline median 6.8–7.8 ms; commit call 0.07–0.10 ms; no frame over 50 ms.

## Findings

Proven (this site, few shots):
1. Separating the strips into independent props did **not** improve localization at uniform strength: all five still broke, in the same order. The shared hierarchy is not the cause.
2. Native explosion damage reaches every section across the whole 2.5 m fence with near-uniform magnitude (between the j1400 and j1800 thresholds). Distance sets the *arrival order*, not a usable damage difference. **The strength profile decides what breaks.**
3. Because the profile decides, a profile whose weak sections are next to the hit and strong sections away from it produces localized destruction with native fracture, native debris and a real collision opening. A player walked through the opening (center, +0.65 twice). The inverted profile broke the outer strips instead, confirming strength, not proximity, selects the result.
4. Restoration (original object, hashes of game files) is clean; overhead is negligible.

Hypotheses (untested):
- Production design: choose the strength profile (which sections are weak) at hot-swap commit time from the predicted impact U (predictor already knows it ~1-3 frames ahead), e.g. several pre-spawned dormant profile twins or a profile set per fence.
- Walls much wider than the ~1.5 m near-uniform blast reach may localize naturally without profiles.
- j2400 models were built but not tested.

Limits: 2.5 m fence only; profile was selected at prepare time from the known aim, not at commit time; only center, +0.65 (x2), -0.65 and one inverted shot; -0.65 lane untested (static map obstacle).

## Smallest remaining obstacle

Selecting the strength profile from the actual predicted impact position at commit time (and verifying it for arbitrary impact points and wider walls). The native-physics path itself works.

## Restoration

GTA stopped. `ScriptHookVDotNet.ini` C9ECD8E2..., `dlclist.xml` C0C9D70C... match originals; x7d DLC, `scripts-x7`, DLSS add-on renames reversed (hash-verified); see `phase1-install-restored.json`, `phase2-install-restored.json`. DLSS add-ons were disabled by renaming to `.x72off` during runs instead of F6.

## Erratum (found by Astra's PC review, ddca5fb8)

An earlier version of the table above attributed the center crossing (U=0.278, passed) to the strips-1,2 profile. The raw logs (`phase2-shots.json`) show strips 1,2 did **not** produce a traversable lane (`no_clear_lane_0.9m`, static map obstacle) and the strips-2,3 profile did. Fracture localization (2/5 strips, the weak pair) was correct in both. Also, `x7cmd.py` could exit 0 on runtime errors; the corrected version exits 3 on any error/exception/refused row, and all X7.2b/X7.2c conclusions here are taken from the raw `trials.jsonl` rows (no error/exception rows are present in the x72b/x72c logs).
