# ASTRA-001 X7 — localized native fence fracture

**Experimental X7: Windows build verified; Session A stopped on invalid restoration. Draft PR #296; base X6 `b647b29`. Milestone NOT accepted.**
Research authority: [doc 16, §§6–8 and 12](../../docs/next-gen-gameplay/astra-001/16-X7-LOCALIZED-FRACTURE-RESEARCH-20261021.md).
Offline Story Mode ONLY. Do not merge into the production mod based on cloud checks.

## X7.1 small walkable-geometry experiment — source-only, GTA NOT TESTED

**Separate `walk5` layout** with five independently native-fracturing *full-height*
sheet strips (each 0.507 m wide × 2.131 m tall). If two adjacent strips break
naturally, a roughly **1.014 m-wide, full-sheet-height lane** becomes possible.
This is a geometric possibility, **not a guarantee the RPG will detach adjacent
strips or that the GTA player can cross**. Uses the current X6 corrugation/texture,
root/post/anchor and hot swap, not script deletion. Each strip mass is 27 kg to
preserve X6's mass per sheet area; only the new assets differ.

There are just two models in this isolated pack:
`lsa_x7c_walk5_j1000` (known P0 strength candidate) and
`lsa_x7c_walk5_j550` (single fallback physics comparison). The original
X7a 12-model pack and X7b torn36 experiment are unchanged.

To export **on Windows with Blender/Sollumz, CodeWalker and GTA stopped**:

```powershell
blender.exe -b --python-exit-code 1 --python native/fragment-x7/build_fence_x7.py -- --layout walk5
powershell -NoProfile -File native/fragment-x7/convert_xml_x7.ps1 -CodeWalker "C:\Path\To\CodeWalker30_dev48"
powershell -NoProfile -File native/fragment-x7/build_pack_x7.ps1 -CodeWalker "C:\Path\To\CodeWalker30_dev48"
python native/fragment-x7/validate_x7c.py --require-exports
powershell -NoProfile -File native/fragment-x7/test-install-x7.ps1 -Mode Install -Variant x7c -GameRoot "C:\Path\To\Grand Theft Auto V Enhanced" -BackupRoot "C:\Private\X7C-Backup"
```

Run the same proven X7 prepare / shot / walk / restore sequence with
`model=lsa_x7c_walk5_j1000`, `back=4`, `aimu=0`, `aimv=0.80` on
a **fresh original 9/9** fence. Check 2+ *adjacent* strips are actually gone,
the read-only collision probes show a full-height 0.9 m lane, and the **actual
player crosses within the fence footprint**, not around it. If a simple shot
is inconclusive, try `lsa_x7c_walk5_j550` once. Preserve original physics
and fallbacks; **do not** cheat by removing pieces or forcing traversal.
Run Afterburner preset 1 and F6 OFF as in X7. Shut down and
`test-install-x7.ps1 -Mode Restore` with the same backup path; verify hashes.

This standalone feasibility probe deliberately does **not** pass the frozen
X7a Session A gate, nor authorize X7b or X8. Convert/pack/install scripts
use their existing manifest and receipts; when switching layouts, always
regenerate real XML/YFT/YTYP/pack and use a fresh backup, not stale assets.

## Latest Windows recovery retest — October 21, 20:17–20:26 EDT

Pulled `16bdb98d74d8445b76c1e0a5011f96a3ecf10319`, regenerated/compiled the driver, and reused the hash-validated 12-model X7a pack on **COMRADE / RTX 5090**. Afterburner preset 1 was confirmed at 460 W; RenoDX confirmed F6 OFF after each fresh Story Mode load. All fresh preparations started with **original 9/9, dormant twin 0/9**.

**Native position-dependent destruction works; a playable low hole remains broken. X8 is not ready.** At `j1000`, P2 detached 12 pieces (2.21 m² removed, 55.8% blocking, centroid error 0.168 m); P3 from a shorter `back=4` position detached 12 (2.05 m², 59%, error 0.269 m); P1 detached 4 (0.72 m², 85.6%, error 0.110 m). All three are LOCAL under the frozen numerical classifier, with pairwise hole IoU 0.118–0.158. P2 and P3/P1 were separate clean-world diagnostics with different launch distances, not a complete accepted Session A.

The aligned P3 shot at the original `back=9` still ended ~5.8 m short without a swap, damaging the vanilla original (restore 6/9). That session was stopped and hash-restored. Added a small **read-only corridor check**: `x7shot ... checkonly=1` logs shooter, aim and ray hit without firing; normal shots reject a ray obstruction >0.75 m before the aim. Both inspected P3 corridors returned no ray hit, so the long-shot failure's cause remains unproven. `back=4` successfully bypassed that failure in one actual P3 shot; this is an observed workaround, not a general reliability claim. Native fracture, predictor/one-tick commit, anchor and owned cleanup remain unchanged.

P1's automatic walk found no 0.9 m full-height lane. A direct physical walk at `u=0` crossed **outside** the footprint (`crossingU=-1.617`), so it failed. Two practical lower-preset diagnostics, `j550` and `j300`, produced the same four-piece / 0.72 m² low hole and no walking lane. Calibration stopped without redesign or fake detachment. **Session A NOT PASSED; Session B/X7b NOT RUN; milestone NOT MET.** These targeted recovery trials intentionally did not repeat ctl/sx/hx/P0 after traversal had already blocked progression.

Six actual RPG shots across two fresh worlds; two additional `checkonly` calls fired nothing. Five successful swaps were 1–3 frames early with commit calls 0.066–0.158 ms and reported near-event frame maxima 10.57–13.644 ms. No fallback blast, scripted fracture, or crash. All four shots in the second world restored the original 9/9. GTA is stopped, and both isolated installations have hash-verified rollback. X2–X6 are unchanged.

See [recovery results and next blocker](evidence/RECOVERY-RESULTS.md), [combined actual measurements/IoU](evidence/retest-comparison.json), [first recovery logs](evidence/retest-a/logs/), [short-range diagnostics](evidence/retest-a3/logs/), and [final safety receipt](evidence/retest-a3/final-safety.json). Historical results below remain unchanged. Analyzer now preserves every walk attempt so an edge detour cannot hide behind the first lane-rejection row.

## Windows result — October 21, 2026

All 12 predefined X7a variants were exported with Blender 5.2.2/Sollumz, converted and reloaded with CodeWalker dev48 as GEN9 v171 / 31 bones, packaged, strict-validated, and tested on desktop **COMRADE / RTX 5090**. Geometry/collision buffer fingerprints match frozen X6. The driver compiled against installed SHVDN Enhanced 3.9 and loaded with SHA256 `1d5b7f5954de252c809fad927dbe9ef41dbf0f8eeda5b87e4216a51f39ad209c`. No runtime driver or X2–X6 source changes were made.

**Session A: FAIL / stopped after six shots**, 19:49–19:53 America/New_York. `ctl` detached 30/30 (WHOLE); `sx` 0; `hx`, `j1000`, and `j1000f` each detached 5/30. `j1000@P0` measured 1.17 m² removed, 77.71% blocking, centroid error 0.2134 m: **T*=1000 is a P0 candidate only**. At P2 the projectile exploded while still 5.749 m short of the target plane; no commit or twin mask occurred. The original then restored only **6/9**, triggering the required invalid-control stop. Obstruction identity is unproven. P3/P1/traversal/position IoU were not tested; no extra shots or threshold tuning followed. **Session B: NOT RUN**, because A did not pass.

All five committed swaps preceded impact by 3 frames, commit calls were 0.062–0.086 ms, and reported near-event frame maxima were 10.347–11.357 ms. Zero fallback blasts; no scripted fracture/deletion to open a hole; no crash observed. The lower mask row was already clear in `sx` despite zero detached pieces (0.25 m²), so absolute removed area has an unresolved baseline/sampling bias. No correction was silently applied. Fire obscures parts of the screenshots. These limits prohibit a milestone claim.

GTA was stopped with X6's inherited shutdown tool. **All five install paths hash/existence-verified restored** (INI, dlclist, DLC, driver, allowlist). This successful filesystem rollback is separate from P2's failed in-world collision restoration. Afterburner preset 1 was applied before Blender/GTA (460 W = 80% of 575 W); the single post-load F6 press was confirmed OFF in RenoDX at 19:49:07.544.

See [full result and blockers](evidence/session-a/RESULTS.md), [measurements/masks](evidence/session-a-analysis/summary.md), [actual collected logs](evidence/session-a/logs/), [screenshots](evidence/session-a/screenshots/), [restoration receipt](evidence/session-a/install-restored.json), and [recovered candidate1/installed explosion numbers](evidence/x7-0-forensics.json). Tooling fixes cover Blender's script import path, actual Sollumz buffer tags, conversion/pack receipt hashes, and analysis of timing/restoration across command files. The frozen driver and physics matrix remain unchanged.

## X7 recovery plan after failed P2 shot (not yet GTA-tested)

**Do not treat the P2 failure as a fracture threshold failure.** The P0 `j1000` shot detached exactly five pieces with a 1.17 m² *raw* mask opening; native fracture and predictive swap both occurred. The failed P2 shot never committed a swap. At frame 31196 its projectile was still ~5.749 m before the target plane, local lateral `u=+0.618`, and an explosion was detected in the driver's broad **6 m** sphere on frame 31197. The actual struck object is **unknown**; the explosion detector is not a fence-plane impact confirmation. The following vanilla original was still present but only 6/9 collision rays blocked. Prior vanilla neighbor damage and the oblique flight are possible contributors, **not proven causes**.

**Immediate operator-only correction using existing supported arguments (no asset/physics/driver change):**

1. Start from a **fresh loaded Story Mode world**, rather than reusing a vanilla scene damaged by previous shots. Verify the *original* fence has **9/9** blocking witnesses and the dormant twin **0/9** before any firing. Do not patch around a damaged original by deleting props, ignoring missing rays, or relaxing the restore gate. Verify Afterburner preset 1 and F6 OFF as before.
2. The inherited example always places the shooter at `pu=1.5` while `P2` targets `aimu=-0.70`; the shot therefore travels diagonally across roughly **2.2 m** of fence width. Instead, use the **already implemented** `x7prepare pu=<target U>` to align the shooter laterally with the aimed panel for off-center shots: **P2 pu=-0.70**, **P3 pu=+0.65**, **P1 pu=0**. Preserve the prior proven `pu=1.5` P0 control for comparison. These alter *launch geometry only*, not physics, thresholds or the predictive commit. Check that each prospective launch corridor is clear; if uncertain, collect non-mutating line-of-sight and actual projectile observations before any destructive retry.
3. Run **one bounded P2 diagnostic** from the fresh world first, with exactly the candidate `j1000`; record shooter/target world coordinates, projectile path and disappearance/explosion point, model `u/t/v`, nearby vanilla objects, and all original/twin ray witnesses. On a miss or damaged original, **stop** and diagnose the obstruction rather than rerunning shots. Do not claim P2 LOCAL without a committed swap plus a valid mask.
4. Once a pristine P2 control survives, run a **new, separately numbered acceptance Session A** under the frozen 11-shot/60-minute budget; retain old six shots as failed historical evidence, not as a silently repaired accepted run. Then assess P3, P1, walk-through, IoU, early commit, cleanup and real 9/9 restoration. Keep Session B locked until Session A passes.
5. Independently correct **measurement qualification**: `sx` showed 0 detached bones but a full empty bottom mask row (0.25 m²). Capture an *intact, fully aligned* twin mask for the same grid, preserve the raw masks, and derive per-cell **newly cleared** area relative to that baseline. Do not retrospectively declare the original 1.17 m² result to be corrected. Extend actual near-event frame capture to **at least one second before and after** the event; the old 60 pre-shot baseline and −8/+90-frame window do not establish the full ±1 s requirement.

The above is a **recovery protocol, not an executed correction or successful rerun**. No gameplay result or previously frozen X7 evidence is changed. If the aligned shot still detonates early, instrument non-destructive corridor and impact-entity diagnostics *before* modifying fracture physics.

## X7 recovery code fix (cloud push; Windows rerun pending)

The driver now **automatically aligns off-centre RPG shots** with their target: `x7shot aimu=-0.70` uses lateral shooter offset `pu=-0.70` (P2), and `aimu=+0.65` uses `pu=+0.65` (P3). For **P0**, the previously successful prepared shooter offset `x7Pu` remains the default. Use `x7shot ... pu=<offset>` to explicitly override this if desired. The shot log records the actual offset.

The near-target explosion detection sphere was narrowed from **6 m to 1.5 m** so an explosion nearly 6 m short of the fence cannot masquerade as a target impact. Premature/missed shots remain **no swap, no fabricated blast**, and must not be counted as accepted. Collision-mask sampling now skips the *known clear 0.10 m bottom row* from the intact `sx` control, and the bottom frame witness samples above that dead strip. Previous logs, numerical results, and threshold remain historically unchanged.

**Still required:** a fresh undamaged Story Mode original (9/9), one observed P2 rerun, subsequent P3/P1/traversal checks, restoration and full visual validation before milestone acceptance. Re-run `python native/fragment-x7/build_x7.py` before Windows compilation, and use a new isolated backup. The X7a model binaries and physics ladder **do not need rebuilding** for this driver-only correction. Never install while GTA is running.

## Current state and non-claims

| Layer | State | Evidence |
|---|---|---|
| X6 predictor, dormant twin, one-tick commit, physical anchor, reacquisition, owned cleanup, restore | X6 proven; X7 preserved by asserted transformation | `build_x7.py`, `validate_x7.py`, prior X6 acceptance |
| X7a frozen 12-model physics matrix and source geometry | Implemented; CI/source checks | `spec.py`, `test_spec.py`, `build_fence_x7.py` |
| X7b torn36 layout, shared serrated seams, physical box collision | Implemented authoring source; not exported or shown in GTA | `spec.py`, `build_fence_x7.py`, `validate_x7b.py` |
| X7 driver: select from installed pack, position-controlled RPG and dense collision/periphery masks | Compiled and GTA-run on Windows; P2 early impact failed predictive/restore control | `evidence/session-a/` |
| X7 analyzer, classifications, threshold and fallback decisions, A/B gates | Implemented, synthetic *unit tests only* | `analyze_x7.py`, `test_analysis.py` |
| Blender/Sollumz exports, CodeWalker GEN9 YFT/YTYP conversion, DLC installation | All 12 X7a variants built/strict-validated/deployed/restored | `evidence/session-a/conversion-receipt.json`, `pack-receipt.json`, `install-restored.json` |
| Native LOCAL hole / X7a gate / visual X7b acceptance | P0 LOCAL candidate observed; **A failed; B not run; milestone not accepted** | `evidence/session-a-analysis/summary.json` |

Neither physics threshold T* nor acceptance was guessed. Only actual collected gameplay logs are committed as evidence; no fabricated binary or runtime evidence, or stock/vanilla Rockstar assets.

## Frozen X7a model list

| Model | Strength | Min damage force | Health | transmission up/down |
|---|---:|---:|---:|---:|
| `lsa_x7a_ctl` | 35 | 5 | 25 | .25/.25 |
| `lsa_x7a_sx` | 10,000,000 | 5 | 25 | 0/0 |
| `lsa_x7a_hx` | 35 | 10,000,000 | 10,000,000 | 0/0 |
| `lsa_x7a_j300` | 300 | 60 | 300 | 0/0 |
| `lsa_x7a_j550` | 550 | 110 | 550 | 0/0 |
| `lsa_x7a_j1000` | 1,000 | 200 | 1,000 | 0/0 |
| `lsa_x7a_j1800` | 1,800 | 360 | 1,800 | 0/0 |
| `lsa_x7a_j3200` | 3,200 | 640 | 3,200 | 0/0 |
| `lsa_x7a_j5600` | 5,600 | 1,120 | 5,600 | 0/0 |
| `lsa_x7a_j10000` | 10,000 | 2,000 | 10,000 | 0/0 |
| `lsa_x7a_j1000f` | 1,000 | 200 | 1,000 | .25/.25 |
| `lsa_x7a_j3200f` | 3,200 | 640 | 3,200 | .25/.25 |

The end post root remains strength/health/minimum damage force 10 million in all variants. X7a's geometry/UV/texture/collision and 4.5 kg sheet masses are derived from the *frozen X6 generator* (never copied from Rockstar). Only physics fields and fragment/model naming vary. X7b: 36 pieces (9×4), 2.22 corrugations wide, ~0.533 m high, continuously shared ±2 cm irregular horizontal seams, strip box collision thickness 0.07 m, 25 kg/m² and weapon scale 0.15. Damaged drawable is explicitly **deferred** until a real GEN9 export/reload gate exists; no invented damaged geometry.

## Reproducible cloud checks

Run at repository root, Python 3.12+:

```sh
python -m unittest discover -s native/fragment-x7 -p 'test_*.py' -v
python native/fragment-x7/build_x7.py
python native/fragment-x7/validate_x7.py
python native/fragment-x7/validate_x7b.py
python native/fragment-x7/spec.py --layout grid6x5
python native/fragment-x7/build_fence_x7.py --dry-run --layout grid6x5
```

The focused workflow `.github/workflows/astra-x7.yml` also confirms the generated C# is byte-for-byte reproducible with its checked-in output. Source validation **is not a substitute for Blender, C# runtime compilation, CodeWalker conversion or GTA**. To demand actual binaries, pass `--require-exports` to the validators after the Windows export/build steps.

## Windows handoff: prepare X7a native assets (no GTA yet)

Required locally: Blender **5.2.2**, Sollumz **2.9**, CodeWalker **30_dev48**, SHVDN Enhanced, X6-established Onigiri DLC workflow. Before **any** Blender/GTA work, run MSI Afterburner and apply **preset 1**. Confirm the X6 reference site and loaded original against `../fragment-x6/smoke-tests.txt`.

From repository root, with PowerShell:

```powershell
python native/fragment-x7/build_x7.py
blender.exe -b --python-exit-code 1 --python native/fragment-x7/build_fence_x7.py -- --layout grid6x5
powershell -NoProfile -File native/fragment-x7/convert_xml_x7.ps1 -CodeWalker "C:\Path\To\CodeWalker30_dev48"
powershell -NoProfile -File native/fragment-x7/build_pack_x7.ps1 -CodeWalker "C:\Path\To\CodeWalker30_dev48"
python native/fragment-x7/validate_x7.py --require-exports
```

*Stop on any script/export error.* The converter must actually reload **twelve** version-171 GEN9 fragments with **31** bones each; the multi-archetype YTYP must have twelve archetypes; `models.json`, `conversion-receipt.json` and `pack/pack-receipt.json` must agree. Verify geometry arrays identical across all twelve models and the authored bounds **2.536 × 2.351 m**. Check the common DDS has also been copied flat to `assets/lsa_x6_galvanized.dds` for CodeWalker's texture lookup. Inspect one intact generated twin from a fixed camera. Resolve any Sollumz/CodeWalker compatibility issue using real exported assets only.

With **GTA and RAGEPluginHook stopped**, install the isolated X7a pack and driver using a *new empty* backup directory:

```powershell
powershell -NoProfile -File native/fragment-x7/test-install-x7.ps1 -Mode Install -Variant x7a -GameRoot "C:\Path\To\Grand Theft Auto V Enhanced" -BackupRoot "C:\Private\X7A-Backup"
```

Installer preserves byte-for-byte backups and adds only the X7 DLC and isolated `scripts-x7` with `x7-models.txt`. Never run alongside an active X6 experiment. The active installed pack's list, not arbitrary model text, controls `x7prepare model=`.

## Windows Session A — 11-shot maximum, 60-minute maximum

1. **Afterburner preset 1** confirmed, GTA Story Mode only. Press **F6 once after GTA loads** to disable DLSS5 and confirm in RenoDX log. Abort if wrong version, loading order, or map site.
2. Fresh twin **for every shot**: `x7prepare model=<name> verified=1 hash=1185366416 tx=1065.758 ty=-1773.716 tz=34.851 px=1072 py=-1772.5 pz=36.5 pu=1.5 back=9` (X6 verified example; recheck against the installed target); `x7cam t=-5.5 u=1.5 z=1.5 lu=0 lz=1.1`; `x7shot label=<unique> aimu=<u> aimv=<v>`; then `x7restore`. Do not use `fallback=1` or synthetic explosions.
3. Ordered shots: **ctl@P0** (must be WHOLE, else STOP); **sx@P0**, **hx@P0**; **j1000@P0**, then move K up/down toward LOCAL per doc 16, **at most four ladder shots total**. If adjacent steps jump from ≥15 to ≤3 detached, STOP for CLIFF/F1; never tune after seeing results.
4. If T* is a real LOCAL level: optional **jT*f@P0** only for K=1000 or 3200, then **jT*@P2**, **jT*@P3**, **jT*@P1** followed by `x7walk`; optional launcher at T*@P0. Three aim points: **P1=(0,0.80)**, **P2=(-0.70,1.10)**, **P3=(+0.65,1.60)**. Centre **P0=(0,1.05)**.
5. Use `collect-evidence-x7.ps1 -GameRoot ... -Destination ...` to collect every actual run's JSONL. Stop GTA, **Restore** using same backup path, verify all original hashes including INI and dlclist, and preserve screenshots/logs. If crashed, stop for diagnosis rather than continuing. X7-0 candidate1 backup/installed explosion.meta forensics are Windows-only; record numbers in `evidence/x7-0-forensics.json` without committing game assets.

```powershell
python native/fragment-x7/analyze_x7.py <Session-A-jsonl-1> <Session-A-jsonl-2> ... --output native/fragment-x7/evidence/session-a-analysis
```

Analyze every actual JSONL for the session (or pass all files as PowerShell arguments). Dense collision area is measured **only within the 2.131 m metal sheet**, excluding the empty 0.220 m clearance above it. **WHOLE** ≥25 detached or <25% sheet blocking. **LOCAL** 4–14 detached, 0.6–2.8 m² removed, ≥40% blocking, centroid within 0.45 m. **SMALL** 1–3 detached or 0.2–0.6 m²; **NONE** 0 and <0.2 m²; **PARTIAL** otherwise. Session A also requires LOCAL at P0/P2/P3, pairwise IoU ≤0.5, P1 player traversal, predictor ≥1 frame early, commit ≤0.2 ms, no frame >50 ms near swap, zero fallback and **9/9 restored original**. If no level passes, write a one-page F1 independent-module design instead of fabricating T*.

## Windows Session B — only after actual Session A pass

With GTA closed and **Afterburner preset 1 active**, use the *unmodified* accepted A summary as T* authority:

```powershell
blender.exe -b --python native/fragment-x7/build_fence_x7.py -- --layout torn36 --session-a native/fragment-x7/evidence/session-a-analysis/summary.json
powershell -NoProfile -File native/fragment-x7/convert_xml_x7.ps1 -CodeWalker "C:\Path\To\CodeWalker30_dev48"
powershell -NoProfile -File native/fragment-x7/build_pack_x7.ps1 -CodeWalker "C:\Path\To\CodeWalker30_dev48"
python native/fragment-x7/validate_x7b.py --session-a native/fragment-x7/evidence/session-a-analysis/summary.json --require-exports
powershell -NoProfile -File native/fragment-x7/test-install-x7.ps1 -Mode Install -Variant x7b -GameRoot "C:\Path\To\Grand Theft Auto V Enhanced" -BackupRoot "C:\Private\X7B-Backup"
```

The three torn models use physics `T*/1.8`, `T*`, `T*×1.8`, with names recorded in **actual** `assets/models.json`. Repeat the same fresh-prepare / camera / shot / restore process: torn T* at **P1 (plus walk)**, **P2**, **P3**, then **P1 repeat**, identical before/after camera angles for all. Only one pre-registered ±one-step adjustment if P1 isn't LOCAL; optional five pistol rounds on an intact piece (diagnostic only). Stop after ≤7 shots or 45 minutes, collect logs and screenshots, shut down GTA, restore and hash-verify. Analyze independent B logs via:

```powershell
python native/fragment-x7/analyze_x7.py --session-a native/fragment-x7/evidence/session-a-analysis/summary.json <Session-B-jsonl-1> ... --output native/fragment-x7/evidence/session-b-analysis
```

Session B numeric gate: 4–16/36 detached, 0.6–2.8 m² holes at P1/P2/P3, ≥40% sheet blocking, end post present, ≥60% upper/lower 0.15 m bands blocking, centroid error ≤0.45 m, pairwise IoU ≤0.5, P1 repeat ±40% area / ≤0.3 m centroid, P1 traversal rise ≤0.45 m, no crash or frame over 50 ms, restoration 9/9. **Qualitative torn-hole appearance still needs the owner's same-camera screenshot judgment**. The analyzer deliberately cannot auto-pass that requirement.

## Stop / fallback / limitations

A CLIFF means jumping from ≥15 detached to ≤3 at adjacent thresholds: **F1** independent anchored modules with only near-impact modules armed, before F2 zone twins or F3 scripted detach. **F3 violates this X7 native-only experimental gate** and requires explicit new design authority. Two failed iterations of a single hypothesis → stop/escalate. No structural building collapse, no dynamic cutting, no actual bends guaranteed. `DAMAGE_WHEN_BROKEN` and the crumpled drawable are gated research, not shipped. Preserve failed attempts and raw evidence. PR stays draft.

## Reference

X2–X6 are byte-identical in the PR diff; X7 reads their frozen sources but does not mutate them. Work here is scoped to `native/fragment-x7/`, the copied research documents and `.github/workflows/astra-x7.yml`. No Windows filesystem, GTA or connected desktop was accessed during cloud coding.
