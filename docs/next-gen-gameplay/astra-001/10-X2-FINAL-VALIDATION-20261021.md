# X2 final controlled validation and research closure — 2026-10-21

**Core technical feasibility: PROVEN. Formal X2 acceptance: PARTIALLY PASSED.** Research is closed after the requested final pass. Proceed to X3 with the limitations below; do not continue indefinite X2 tuning. X3 implementation has not begun. Draft [PR #289](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/289) remains unmerged.

The approved authority is [06 master plan, Task 2](06-MASTER-PLAN-explosion-destruction-20261020.md), informed by X1's native detachment/collision proof and whole-panel movement failure. [08](08-X2-STATUS-20261021.md) and [09](09-X2-CONTINUATION-20261021.md) remain historical checkpoints; this document records closure without promoting their failures.

## Frozen candidate and method

The proven strength-500 asset and X2-0.10 driver were frozen before the pass. No asset, physics, charge or script tuning occurred during or after it. The existing calibrated charge configuration was retained rather than adopting stronger exploratory pilots.

- Pack SHA256: `180618adbe9e56bdaa9a6220e82a87effc6d624ea2b78926cc348263e60af347`.
- Script SHA256: `5be72312804d55e7c0ea9b68c2182fbad7fdf4aead86852623bd1c4ffb78adae`.
- Original Blender/Sollumz wall: 3 × 2.5 × .2 m, 30 concrete chunks plus root, native GEN9 fragment. Root and outer columns reinforced; dynamic wall held by a native fixed joint to an invisible collision-disabled frozen anchor. No custom physics or script deletion to manufacture a hole.
- Native AddExplosion scales: grenade .25/front offset .4 m; sticky 3/.1 m; rocket 10/.4 m. These are explicit test charges, not vanilla weapon balance claims.
- Wall-local targets: centre region `(u=0, height=1 m)`, left third `(-.75,1)`, upper third `(0,1.75)`.
- A fresh GTA process cleared prior pilot residue. Only WpsBreachLab was started through SHVDN; existing ASI mods remained. This is not an unmodded-stack claim.
- Existing X1 probes, native debris parent checks, NPC tests and file bridge were reused, together with Claude's shutdown/launch automation and the existing evidence collector.

The exact preregistered batch and configuration are [final-validation.txt](../../../native/fragment-x2/final-validation.txt) and [final-validation-config.json](../../../native/fragment-x2/final-validation-config.json). Runtime run: `20261021-121637-e54c46`, fresh loaded UTC `2026-10-21T12:16:19.967887Z`. The installed script and pack hashes matched repository copies.

## Final representative matrix

All nine impact baselines had 120/120 blocked ray cells, zero clear swept columns, 20/20 anchored face hits, and no failed ray requests. Both bookend intact controls returned `CONTROL_CLOSED`. All nine explosions were detected; every blast released explicitly identified native wall fragments. The batch reached DONE with no errors or crashes.

| Target | Charge | Clear area m² | Native parts | Debris-obstructed cells | Swept opening m | Anchoring | Original strict verdict |
|---|---|---:|---:|---:|---:|---|---|
| centre | rocket | 4 | 16 | 0 | 1.5 | verified | LOCAL_ANCHORED_BREACH_CONFIRMED |
| centre | sticky | 2.8125 | 16 | 19 | 0 | unverified (19/20 post-blast faces) | NOT_CONFIRMED |
| centre | grenade | 0 | 14 | 56 | 0 | verified | NOT_CONFIRMED |
| left | rocket | 1.125 | 5 | 2 | 0 | verified | NOT_CONFIRMED |
| left | sticky | 0 | 3 | 12 | 0 | verified | NOT_CONFIRMED |
| left | grenade | 0 | 3 | 12 | 0 | verified | NOT_CONFIRMED |
| upper | rocket | 4 | 16 | 0 | 0 | verified | NOT_CONFIRMED |
| upper | sticky | 3 | 16 | 16 | 0 | verified | NOT_CONFIRMED |
| upper | grenade | 0 | 13 | 52 | 0 | verified | NOT_CONFIRMED |

The centre rocket repeated the complete proof: 4 m² of real clearance, 1.5 m swept opening, 16 native fragments, all 40 outer cells still solid, all 20 outer face hits retained, maximum measured face movement .011 m and root movement .007 m. The NPC crossed inside the wall at u=-.007 m, lateral deviation .007 m, climb gain .077 m, in 2456 ms. Post-walk faces were still anchored. Native debris remained present throughout collision and walking measurements.

The other eight cases had zero standing-height swept opening, so hole walking was correctly skipped. Upper rocket damage left an elevated opening with a lower strip blocking traversal; it is localized destruction, not a traversable breach. Intact-control peds bypassed the finite wall edge; that is never counted as crossing intact collision.

## Strict acceptance and interpretation

Original thresholds and verdicts are preserved. The original three-launch/20-blast cohort remains **14/20 (70%)** within the strict .5 m centroid gate, below the required 80%, with six confirmed traversals across three fresh launches. No-opening trials still fail that gate. The full [original qualification report](x2-evidence/original-20-qualification.json) is preserved byte-for-byte from commit `31ef2489`; [strict-initial-20.json](x2-evidence/strict-initial-20.json) identifies its cohort.

The full frozen-source/frozen-asset aggregate remains `INCOMPLETE`: 31/47 command cases meet that centroid gate. It contains 46 measured detonations and one earlier baseline-invalid pilot command that never detonated, and ten confirmed traversals across five fresh launches. The conservative debris gate also remains false because that invalid pilot has no geometry measurement; measured native part counts never exceeded 20 of 30 chunks. This missing measurement is not evidence of an observed piece-budget overflow. [qualification.json](x2-evidence/qualification.json) keeps its original logic and counts.

A weak grenade against concrete is a legitimate non-breach: here all three grenade targets detached native pieces but cleared no collision cells, with surrounding anchoring verified. Their strict `NOT_CONFIRMED` results remain unchanged. Partial sticky openings and narrow left rocket openings likewise do not meet traversability acceptance. Centre sticky additionally lost one post-blast root-face hit to obstruction; anchoring was therefore unverified at that stage even though all 20 final hits returned. It remains a measurement/acceptance failure, not an inferred structural pass.

## Remaining limitations and recommended X3 work

- Native debris can remain fitted or piled in an opening. Detachment alone does not establish clearance; retain rays, swept volumes and actual traversal as separate checks.
- Locality is imperfect: strong centre/upper charges remove a broad 4 m² interior, while left impacts can produce only a narrow opening. Reinforced boundaries constrain damage; the MVP is not finely controlled production fracture.
- Elevated openings can be real yet unusable by a standing NPC. A future breach policy must distinguish damage, openings and traversable routes.
- Debris can occlude anchoring probes, and an earlier high-charge pilot left a baseline-invalid measurement. Improve measurement/cleanup isolation without deleting debris during active tests.
- Candidate stability is demonstrated by the original 20-blast/three-launch proof and this final fresh nine-blast pass. Earlier unsafe bone-query crashes and failed exports remain in the evidence; this is not a claim that every historical revision was stable.
- Existing ASI mods and explicit native charge calibration limit generalization. Production debris budgets, lifetime/performance, broader asset/charge coverage and integration remain X3 work.

**Recommendation: proceed to X3 with documented limitations.** No fundamental engine/export blocker prevents the demonstrated anchored native breach. Full formal X2 acceptance has not been claimed, and no marginal-result optimization or X3 implementation follows this pass.

## Restoration and reproducible evidence

GTA and RPH were stopped after DONE. The only temporary mod-loading change, `AutoLoadScripts=false`, was restored to the exact original INI bytes and `AutoLoadScripts=true`. Original/restored SHA256: `C9ECD8E277F8C7012793E8A2368700C71BE626D3D270F0B68E6DBA0ACA53BB72`. All 15 tracked ASI/DLL files were unchanged across restoration, no command remained pending, and the frozen X2 deployment was intentionally retained. Existing pre-disabled mods were not altered. See [final-restoration.json](x2-evidence/final-restoration.json).

[Final raw telemetry](x2-evidence/20261021-121637-e54c46.jsonl), [DONE status](x2-evidence/20261021-121637-e54c46-status.json), [matrix interpretation](x2-evidence/final-validation.json), source snapshots, correctly attributed screenshots, run inventory and SHA256 manifest are committed beside the report. Screenshots illustrate events; collision and traversal claims depend on telemetry, not appearance.

Regenerate reports without running GTA:

```powershell
python native/fragment-x2/summarize_evidence.py docs/next-gen-gameplay/astra-001/x2-evidence
python native/fragment-x2/qualify_evidence.py docs/next-gen-gameplay/astra-001/x2-evidence
python native/fragment-x2/closeout_report.py docs/next-gen-gameplay/astra-001/x2-evidence 20261021-121637-e54c46
python native/fragment-x2/inventory_evidence.py docs/next-gen-gameplay/astra-001/x2-evidence
```
