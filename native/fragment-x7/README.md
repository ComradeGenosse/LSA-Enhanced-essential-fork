# ASTRA-001 X7 — localized native fence fracture

**Experimental X7: Windows build verified; Session A stopped on invalid restoration. Draft PR #296; base X6 `b647b29`. Milestone NOT accepted.**
Research authority: [doc 16, §§6–8 and 12](../../docs/next-gen-gameplay/astra-001/16-X7-LOCALIZED-FRACTURE-RESEARCH-20261021.md).
Offline Story Mode ONLY. Do not merge into the production mod based on cloud checks.

## Windows result — October 21, 2026

All 12 predefined X7a variants were exported with Blender 5.2.2/Sollumz, converted and reloaded with CodeWalker dev48 as GEN9 v171 / 31 bones, packaged, strict-validated, and tested on desktop **COMRADE / RTX 5090**. Geometry/collision buffer fingerprints match frozen X6. The driver compiled against installed SHVDN Enhanced 3.9 and loaded with SHA256 `1d5b7f5954de252c809fad927dbe9ef41dbf0f8eeda5b87e4216a51f39ad209c`. No runtime driver or X2–X6 source changes were made.

**Session A: FAIL / stopped after six shots**, 19:49–19:53 America/New_York. `ctl` detached 30/30 (WHOLE); `sx` 0; `hx`, `j1000`, and `j1000f` each detached 5/30. `j1000@P0` measured 1.17 m² removed, 77.71% blocking, centroid error 0.2134 m: **T*=1000 is a P0 candidate only**. At P2 the projectile exploded while still 5.749 m short of the target plane; no commit or twin mask occurred. The original then restored only **6/9**, triggering the required invalid-control stop. Obstruction identity is unproven. P3/P1/traversal/position IoU were not tested; no extra shots or threshold tuning followed. **Session B: NOT RUN**, because A did not pass.

All five committed swaps preceded impact by 3 frames, commit calls were 0.062–0.086 ms, and reported near-event frame maxima were 10.347–11.357 ms. Zero fallback blasts; no scripted fracture/deletion to open a hole; no crash observed. The lower mask row was already clear in `sx` despite zero detached pieces (0.25 m²), so absolute removed area has an unresolved baseline/sampling bias. No correction was silently applied. Fire obscures parts of the screenshots. These limits prohibit a milestone claim.

GTA was stopped with X6's inherited shutdown tool. **All five install paths hash/existence-verified restored** (INI, dlclist, DLC, driver, allowlist). This successful filesystem rollback is separate from P2's failed in-world collision restoration. Afterburner preset 1 was applied before Blender/GTA (460 W = 80% of 575 W); the single post-load F6 press was confirmed OFF in RenoDX at 19:49:07.544.

See [full result and blockers](evidence/session-a/RESULTS.md), [measurements/masks](evidence/session-a-analysis/summary.md), [actual collected logs](evidence/session-a/logs/), [screenshots](evidence/session-a/screenshots/), [restoration receipt](evidence/session-a/install-restored.json), and [recovered candidate1/installed explosion numbers](evidence/x7-0-forensics.json). Tooling fixes cover Blender's script import path, actual Sollumz buffer tags, conversion/pack receipt hashes, and analysis of timing/restoration across command files. The frozen driver and physics matrix remain unchanged.

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
