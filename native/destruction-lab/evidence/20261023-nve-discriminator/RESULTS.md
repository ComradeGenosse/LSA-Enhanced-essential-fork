# Exact-binary NVE loader discriminator and partial X8 acceptance

**Starting head:** `4f5b7528`. **Answer: YES, the exact laboratory YMAP streams through NVE's proven working path.** Both authored LSIA fences appeared with correct transforms, 9/9 original collision and clear approaches. This rules out the authored binary, model references and conservative bounds as sufficient causes of the previous absence. The failing stage is the **standalone DLC / inner-archive registration or lookup path**. Its exact faulty field remains unresolved; no permanent standalone fix is claimed.

## Controlled discriminator

With GTA stopped, cloned the original NVE_props_addon archive locally, added the existing `lsa_destruction_lab.ymap` to `x64/city_props.rpf`, and appended only its `v_fences` dependency to the existing manifest. The standalone lab DLC was absent. No NVE archive or asset bytes are redistributed here.

Input RSC7 SHA-256: `53026f7d12d5556c4e1d744a43e00ddc1b5cf386dd65dcc9a9578e740b3881a5`. The resource payload extracted from both the prior standalone pack and NVE candidate is exactly `22d66daf0c4f4f96ec0735c60513e535c9ed10f682eae37617fdfe5788524626`; CodeWalker extraction returns the uncompressed payload, so it must not be compared directly with the compressed RSC7-file hash. Resource entry kind/version and page metadata are unchanged. No YMAP regeneration or flag change was used for injection.

Offline checks reopen the finished candidate and prove: original 161 leaf entries become 162; all 160 unaffected original entries retain identical extracted bytes; the existing manifest's entire semantics remain unchanged after removing the one appended lab entry; lab resource v2, identity hash and both entities reload correctly. `injection-validation.json` records the proof. Full original/candidate NVE archives and their asset inventories stay private.

CodeWalker `SetArchetype` + `CalcExtents`, using the actual stock fence archetype, produces bounds wholly inside the generator's extents. `discriminator-summary.json` retains original/calculated values. The existing working `rocks.ymap` has compatible resource/LOD/map flags. In the same modified-NVE runtime, its two exact native model/pivot matches still pass (`0c0041e00ffc40f3806e46746cdeec6b`). Lab audits A `050b9d24c0894d7e9a531b030fca37ab`, B `6392efee1dbd4a2b8b32c0543b98462c` both pass. Thus this is conclusive, not a damaged-loader or DLC-presence-only result.

A bounded standalone identity test (`lsa_lab` DLC/device name; unchanged map/manifest/inner archive, normal v3 streaming group) still failed A/B source lookup. It was discarded and restored. This does not establish a name-length defect. No further XML combinations, SP/startup/placement-flag/IPL experiments were run. NVE's exact original hash was restored before that standalone test, then the verified reversible NVE-backed package was used for the personal laboratory's acceptance session. This is a temporary local integration, not a final standalone dependency/fix.

## Actual X8 results — one RPG total

| Check | A | B |
|---|---|---|
| Genuine streamed map object and correct pivot/heading | PASS, 0 degrees | PASS, 90 degrees |
| Original collision | PASS 9/9 | PASS 9/9 |
| Upright/unit basis, approach rays, ground | PASS | PASS |
| Dormant twin before firing | PASS 0/9 | NOT PREPARED |
| Real RPG / native two-section fracture | PASS | NOT RUN |
| Automatic selected sections | PASS, 2 and 3; mask 12 | NOT RUN |
| Surrounding sections retained | PASS, 0/1/4 | NOT RUN |
| Physical player traversal | PASS, 1 m lane | NOT RUN |
| Original restored collision | PASS 9/9 | Unaffected 9/9 during A |
| Complete owned-entity cleanup | FAIL verification: 3 references remain | NOT RUN |

Both objects were requalified in the acceptance runtime before staging. Audit ground samples are flat at Z=12.945; original pivots are Z=13.049618. Both have 9/9 own collision, zero foreign hits, zero of 18 approach rays blocked, unit/upright basis, and the original orientation. A's staging found one exact source and no hide neighbor, then 9/9 original and 0/9 dormant-twin collision. Only A held the native lease.

A's single normal `x8shot` uses unchanged X7.3 defaults, with no forced selector, altered profile, horizon override or artificial explosion. Shot request `74672d1c87f64e75bbd9d4c0594815a7`: real projectile seen, automatic projected impact U=0, selected positions 2/3, commit 3 frames before explosion, nativeParts=2, originalBlocked=0; surrounding roots remain attached/intact with <=0.001 m movement. No frame over 50 ms in the measured shot window. Before/after gameplay images are included. Optional per-strip `x7_probe` instrumentation was off for the normal shot, so that additional matrix was not measured.

Player traversal `acaf918065d74fcdbe91881ca4599484`: crossed=true, passed=true, 1 m lane, crossingU=0.260, outsideFootprint=false, maxRise=0. B audit `cfce6fbbd22e4d7cb4995c8b963f9179` during A's active lease remains original, visible, upright and 9/9, with no approach obstruction.

A restore `6d47cca2de6b4c1c9e41162a8a5e3ba9` restores the visible original to **9/9**, independently verified. However, `x8_cleanup_verified` reports tracked=15, remaining=3, passed=false. Recorded remaining handles/hashes: 269314/-218858073, 270338/-1707997257, 562690/689760839. A stays `RestorePending`; the command correctly returns ERROR. This proves a cleanup-verification failure, not yet whether these are actual owned remnants or stale/reused references. **No second restore attempt, B preparation or B shot followed.** Final status shows A latched and B Registered. One RPG and one preparation in total.

## Final state and remaining work

Stopped the exact owned GTA process. Restored original NVE archive SHA-256 `83e162e5743636e5b86ada7ed497f42c5cb055566be45e66bcc235ba72453ee5` (44,497,920 bytes), original configs/addons and expected temporary-file absences. Both standalone candidates are absent. GTA process count=0; all P2 requests terminal, pending=null, command slots absent, sole P2 owner released. Receipts are included; no original backup or NVE bytes are published.

The laboratory is proven usable through the reversible working loader, and A's destruction/selection/traversal and original collision restoration are measured. **Full X8 acceptance remains blocked by cleanup ownership verification; B was deliberately not fired.** Next: determine the identities/lifetimes of the three captured cleanup references before any further destructive test, while keeping standalone registration/lookup as a separately isolated packaging defect. No X7.3 selection or X8 physics edits were made. Issue #308 remains separate; no X9. PR remains draft/unmerged.
