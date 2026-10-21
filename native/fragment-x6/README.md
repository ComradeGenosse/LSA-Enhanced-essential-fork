# ASTRA-001 X6 — corrugated fence twin (draft, experimental)

X6 follows X5 at `995828adf2dbc9809eafa4f6d8dedadb05c5532f` / PR #293. Offline Story Mode lab only. X2–X5 are unchanged.

## Asset

`build_fence.py` creates an original mesh and original seeded procedural DDS in Blender 5.2.2 / Sollumz 2.9. The installed vanilla `prop_fnccorgm_02e` was inspected locally for its silhouette, metal weathering, post and rail arrangement; no extracted Rockstar geometry or textures are included. X5's measured 2.536 m width and 2.351 m overall height replace the 3 × 2.5 m concrete slab. The sheet is 2.131 m tall, with a taller slim end post, 20 modeled vertical corrugations, and two rear rails. It is centred horizontally for X5's footprint/heading placement. Thirty closed thin sheet meshes have individual native physics groups and thin box collision, corrugated-iron collision material and 4.5 kg mass each; the narrow end post is the anchored root. The boxes approximate folded sheets rather than reproducing every corrugation in collision. Native strength 35, damage force 5, damage health 25, force transmission .25. These are MVP gameplay tuning values, not a structural material simulation.

Authoring: `assets/lsa_x6_corrugated.blend`, `build_fence.py`, `assets/lsa_x6_galvanized.dds`. Exports: GEN9 version-171 YFT, Dynamic YTYP, XML sources and `pack/dlc.rpf`. Texture is embedded. CodeWalker dev48 imports the XML, calls EnsureGen9, saves and reload-checks all 31 bones. The DLC is named `lsa_fence_x6`, separate from X2's installed pack.

## Integration

`build_x6.py` reproducibly transforms the frozen X5 driver into `WpsBreachLabX6.3.cs`. Commands use `x6` in place of `x5`; model is `lsa_x6_corrugated`. Preparation guards the measured target size. Dormant staging, projectile TTC prediction, no-yield/no-log one-tick commit, real RPG collision/explosion, native fixed anchor, ownership-qualified debris cleanup and player traversal are retained. Restore re-finds the original by model/position before witnessing it, fixing X5's stale-handle measurement. Existing inherited diagnostic verbs are not newly qualified for the fence.

`x6preview` is an explicitly labelled **art diagnostic**: it commits without firing, only from Armed. It is for same-camera intact comparison, not an impact-timing pass. Restore and prepare again before a real shot. No artificial blast fallback is used in the acceptance runs. No part is script-detached or deleted to produce a breach.

## Build / isolated test / rollback

1. Apply MSI Afterburner preset 1 and keep it running before Blender/GTA tests.
2. `blender.exe -b --python native/fragment-x6/build_fence.py`
3. Run `convert_xml.ps1 -CodeWalker <CodeWalker30_dev48>` then `build_pack.ps1 -CodeWalker <same>` from this folder.
4. `python native/fragment-x6/build_x6.py` and `python native/fragment-x6/validate_x6.py`.
5. With GTA stopped: `test-install.ps1 -GameRoot <Enhanced root> -BackupRoot <new private backup directory>`. It backs up exact INI/list bytes, installs a separate pack/script directory and switches only ScriptsLocation. Normal scripts remain untouched. Existing ASI mods remain loaded; this is not an unmodded-stack claim.
6. Launch via the existing Steam SHVDN path in X2's `tools/launch-shvdn.ps1` (its loaded-hash check assumes the X2 filename, so for X6 inspect the fresh X6 status directly). Press F6 once after Story Mode loads. Confirm fresh `WpsBreachLab/status.json`, X6-0.1 and the exact source SHA in `evidence/offline-checks.json`.
7. Submit `smoke-tests.txt` through `WpsBreachLab/command.txt`, or submit each stage separately for screenshots. Keep GTA focused; an overlay can pause it. `collect-evidence.ps1` adapts X2's sanitised collector for X6.
8. Run `x6restore`, stop GTA with X2's `tools/gt4_stop.ps1`, then `test-install.ps1 ... -Mode Restore`. Restore refuses unexpected intervening file changes and verifies all pre-test hashes. Newly added X6 pack/script files are removed.

## Validation

Results are recorded below after live tests. `evidence/candidate1/` preserves the first tuning attempt: successful 3-frame / 28 ms predictive swap, five detached native parts, no 0.9 m lane, no traversal. Its overly tall sheet, large rust blobs and insufficient breach motivated the final asset tuning; this is not counted as acceptance. Initial same-camera screenshots are retained as candidate evidence.

## Limits / next step

The art is a gameplay approximation: original procedural rust, simplified frame, regular rectangular fracture tiles and box collision. No bent or torn sheet deformation, matching normal/specular shader, exact rusty texture reproduction, structural collapse, persistence, broad prop registry or rollout. Native breakup must be tested in GTA, not inferred from export success. The existing real script-fired RPG path is the acceptance scope; real launcher/high-speed/manual shots and off-centre/material tuning remain separate. Blast can damage vanilla neighbours outside lab ownership; cleanup deliberately does not delete unproven debris. Recommend a close-range art pass and a real-launcher timing trial before any registry expansion.
