# ASTRA-001 X6 — corrugated fence twin (draft, experimental)

X6 follows X5 at `995828adf2dbc9809eafa4f6d8dedadb05c5532f` / PR #293. Offline Story Mode lab only. X2–X5 are unchanged.

## Asset

`build_fence.py` creates an original mesh and original seeded procedural DDS in Blender 5.2.2 / Sollumz 2.9. The installed vanilla `prop_fnccorgm_02e` was inspected locally for its silhouette, metal weathering, post and rail arrangement; no extracted Rockstar geometry or textures are included. X5's measured 2.536 m width and 2.351 m overall height replace the 3 × 2.5 m concrete slab. The sheet is 2.131 m tall, with a taller slim end post, 20 modeled vertical corrugations, and two rear rails. It is centred horizontally for X5's footprint/heading placement. Thirty closed thin sheet meshes have individual native physics groups and thin box collision, corrugated-iron collision material and 4.5 kg mass each; the narrow end post is the anchored root. The boxes approximate folded sheets rather than reproducing every corrugation in collision. Native strength 35, damage force 5, damage health 25, force transmission .25. These are MVP gameplay tuning values, not a structural material simulation.

Authoring: `assets/lsa_x6_corrugated.blend`, `build_fence.py`, `assets/lsa_x6_galvanized.dds`. Exports: GEN9 version-171 YFT, Dynamic YTYP, XML sources and `pack/dlc.rpf`. Texture is embedded. CodeWalker dev48 imports the XML, calls EnsureGen9, saves and reload-checks all 31 bones. The DLC is named `lsa_fence_x6`, separate from X2's installed pack.

## Integration

`build_x6.py` reproducibly transforms the frozen X5 driver into `WpsBreachLabX6.3.cs`. Commands use `x6` in place of `x5`; model is `lsa_x6_corrugated`. Preparation guards the measured target size. Dormant staging, projectile TTC prediction, no-yield/no-log one-tick commit, real RPG collision/explosion, native fixed anchor, ownership-qualified debris cleanup and player traversal are retained. Restore re-finds the original by model/position before witnessing it, fixing X5's stale-handle measurement. Projectile reacquisition also clears the inherited `gone` flag, preventing a transient low-speed tracking gap from ending observation 90 frames later. Existing inherited diagnostic verbs are not newly qualified for the fence.

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

## Validation — revised asset accepted for this MVP

One clean corrected-driver cycle in offline Story Mode on October 21, 2026 (GTA Enhanced 2.0.1158.16, SHVDN 3.9). This is a personal-mod MVP result, not production rollout qualification. The unchanged revised pack SHA256 is `76c9fb43729504b79b82687440c6071aa73e9027b5dd312df0e69f1ab99dcce6`; YFT `8ab26769bc59e2f121a276e2aa4f00806adc8dcdc98b4c6ae202228d33320920`; measured driver `f598eff04535fed4c0420533a5f928f9a44fccb1e288b9a534b985ef703e98e3`.

| Check | Observed result |
| --- | --- |
| Before impact | Original visible and blocking 9/9 witness rays; invisible dormant twin 0/9. |
| Art match | Same-camera original/twin screenshots show matching footprint/heading and similar sheet/post silhouette, vertical corrugations and grey rusty metal. Materially closer to the original than the X5 concrete slab; exact shader/weathering match is not claimed. The labelled preview was restored and preparation repeated before firing. |
| Just-in-time impact | `qualified-s1`: commit frame 15473, real explosion 15476: **3 frames / 28 ms before explosion**, TTC 50.7 ms, distance 0.605 m; projectile speed 12.069 m/s. No late swap or fallback blast. |
| Native fracture | 30 detached native pieces observed at frame 15479; original/twin witness rays 0/9 afterward. No scripted detachment or deletion to create the opening. |
| Performance | Commit call 0.067 ms; baseline median 9.2 ms; worst near-swap frame 12.897 ms; zero measured frames >50 ms. |
| Player traversal | Automatic lane finder: **1.6 m clear lane**. Actual player crossed at u=0.334 m inside the footprint in 1.821 s, outsideFootprint=false, maxRise=0, passed=true. No forced lane override. |
| Cleanup / restore | Original re-found, visible, exists, and blocks **9/9** rays, restoredToOriginal=true. Cleanup conservatively skipped four objects not proven to be lab debris, their ownership was not asserted. |
| Machine rollback | GTA stopped. All six pre-test hashes/existence states match: INI, DLC list, original X2 script/pack, absent X6 script/pack. Afterburner remains running. |

Primary evidence: `evidence/acceptance/20261021-212748-37d95b.jsonl` (prepare/shot), `20261021-212815-cbe52d.jsonl` (walk), `20261021-212959-84413d.jsonl` (restore), plus `summary.json`, `key-rows.jsonl` and screenshots. `session.json` binds asset/pack/driver hashes. `install-restoration.json` verifies rollback.

Afterburner was running before all tests; 460 W against 575 W default verifies preset 1's 80% cap. Claude supplied foreground/held-key assistance. The final launch's RenoDX log explicitly confirms `F6: DLSS Neural Rendering OFF` at 17:26:12 local; see `dlss-off.log`. Existing ASI mods remained loaded; this is not an unmodded-stack claim. SHVDN compiled the measured source successfully; focused local export/source checks also pass.

### Preserved failures and the small X6 driver fix

`evidence/candidate1/` is untouched: the first art/strength candidate swapped 3 frames / 28 ms before impact, detached five pieces and restored the fence, but failed traversal. Its taller sheet, large rust blobs and insufficient breach motivated the current revised asset.

`evidence/acceptance/pre-fix/` preserves two revised-pack attempts with the old driver: committed=false, no recorded explosion event or qualified fracture. Claude reported detonations about 2 m short of the fence. Independently, both traces prove the observation loop ended exactly 90 frames after the first transient missing sample even though the projectile was tracked again afterward (`diagnosis.json`). The inherited `gone` flag was never cleared on reacquisition. X6 now clears that flag and timestamp when a projectile is reacquired; X5 remains unchanged. The final corrected run used the same revised asset, position, firing path and default prediction threshold and completed the full impact/walk/restore cycle. The early attempts are not counted as acceptance, and the precise interception/detonation cause in those unobserved intervals is not asserted.

An earlier revised-asset launch was blocked by focus/keyboard input, and a later redundant game process showed ERR_NO_LAUNCHER. Both are historical setup issues, superseded by the clean Steam/PlayGTAV launch and log-confirmed F6 above. No raw game-executable launch is part of the documented workflow.

## Limits / recommended next step

The art is a gameplay approximation: original procedural rust, simplified frame, regular rectangular fracture tiles and box collision. The blast released all 30 sheet pieces in the successful run, so this is a convincing open breach, not tuned localized tearing. No bent sheet deformation, matching normal/specular shader, structural collapse, persistence, broad prop registry or rollout. Vanilla neighbours can take blast damage outside lab ownership; cleanup deliberately does not delete unproven debris. Only the real script-fired RPG at roughly 12 m/s is live-qualified; a real launcher/manual/high-speed shot is not.

Recommend a close-range metal shader/fracture-shape pass and one real-launcher timing trial before expanding to a prop registry. One clean corrected cycle meets this phase's requested focused acceptance scope; repeatability beyond that is not claimed.

Focused GitHub CI (`ASTRA X6 fence export`) validates GEN9 binary/XML header, dimensions, groups/masses, one-tick source contract, restore reacquisition and deterministic driver regeneration. It does not run Blender, compile SHVDN or certify live GTA physics.