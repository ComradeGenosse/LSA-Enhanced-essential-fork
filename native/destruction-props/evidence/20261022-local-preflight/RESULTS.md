# X8 local preflight — stopped on unresolved approach collision

**Overall: FAIL / acceptance not completed. Zero RPG shots, one GTA session.**
Source base: `759cd1ce7b1620d256c324c77fa4584a77ebda22` (PR #309, stacked on #307).
Candidate/installed/loaded driver SHA256:
`2af1f426ab3aec7dd29d5dd221fda23e225c82332c0c563a06e36830eda6bf27`.
Named sole P2 operator: `codex-x8`; session `x8-two-fences-20261022`;
PID `53504`, loaded `2026-10-22T21:13:02.9849283Z`.

| Acceptance | Fence A | Fence B |
| --- | --- | --- |
| Map pivot | 1065.75757, -1773.71619, 34.8510056 | 1017.70313, -2105.20483, 30.11713 |
| Native yaw | 110.189 degrees | 255.066 degrees |
| Model / dimensions | 1185366416 / 2.536 x 2.351 m | Same |
| Basis / source identity | Unit, upright, one source at pivot | Unit, upright, one source at pivot |
| Visible original collision | **9/9**, all rays hit source handle 145410 | **9/9**, all rays hit source handle 111106 |
| Approach rays | **FAIL: 3/18 hits** | 0/18 hits |
| Prepare / dormant twin 0/9 | NOT RUN | NOT RUN |
| Real RPG / fractured sections | 0 shots / none | 0 shots / none |
| Player traversal | NOT RUN | NOT RUN |
| Post-fracture restore 9/9 | NOT RUN | NOT RUN |
| Owned roots / anchors / debris | 0 / 0 / 0, never staged | 0 / 0 / 0, never staged |
| Fence acceptance | **FAIL — preflight collision stop** | **FAIL — lifecycle not run after A stop** |

A's unexpected hits were at positive local T, U offset -0.7 m, at heights
0.5, 1.0 and 1.6 m. Each ray reported collision with **entity handle 0**.
The original nine witnesses all belonged to the intended fence; the separate
approach obstruction has **unresolved ownership**. Do not assign it to a YBN,
LOD or neighboring object without further evidence. The operator stopped before
preparation or either shot, as requested. No retry, selector override, explosion,
restoration workaround, or second session occurred.

B's clear approach rays are limited preflight evidence, not proof of walkability.
Ground samples rise from Z=29.795 at T=-2 to Z=30.386 at T=2 (0.591 m);
physical traversal and the existing 0.35 m maximum-rise acceptance remain untested.
B was audited first, then A. No native lifecycle began at A, so B was never
subject to an A lifecycle; independence through destruction remains unvalidated.

## Implementation and offline validation

Fixed a concrete cleanup-verification defect: `CleanupAll()` empties ownership
collections even when native deletion fails. X8 now captures entity references
before inherited cleanup and checks actual `Exists()` results before releasing
the native lease. Surviving or uncertain entities cannot count as clean. A focused
C# execution test extracts the actual methods and exercises surviving roots,
surviving debris, an unknown native state, and verified deletion. It passes.
This fix has **no live deletion-path acceptance** from this stopped preflight.

Added `x8audit` over one registered placement: source-owned rays, neighboring prop
metadata, native basis lengths, approach rays and ground samples. Optional player
streaming is forbidden while a native lease exists. It never stages a replacement,
hides a source, fires, or chooses a section. This is an operator audit, not an
automatic capsule/walkability certification or a production map scanner.

Regeneration is byte-identical and matches the installed/loaded candidate.
The complete driver compiled against installed SHVDN 3.9.0.0; only inherited
obsolete/unused-member warnings. The live SHVDN log also confirms compilation.
X8 38 pure checks, X7.3 18 tests / 120,238 assertions, cleanup regression,
source guards, 16 inherited offline tests, and 10 X7.3 + 6 X7.2c P2 oracles pass.
The existing exported six-model j1400/j1800/j2400 pack validates by hash; pack SHA256
`22DF444C4DE5BD2C73D1AFD65C999AEE1DB15F1D00BA27193E8E06DC09CD8AA0`.
No art, physical section selector, strength profile or projectile policy changed.

## Map and asset evidence

A read-only CodeWalker audit decoded 21,331 installed map resources and found
523 records of the source family, including archive variants of the same placements.
A and B are unit-scale, parentless `LODTYPES_DEPTH_ORPHANHD` entities in
`id1_24_strm_0.ymap` and `id1_10_strm_1.ymap`. The native runtime confirmed their
coordinates, yaw, dimensions, visibility and owned collision. Archive duplicates
are recorded as variants, not counted as simultaneous runtime objects.
A's NVE lights map variant preserves this placement; B has no matching Onigiri
map override in the audited inventory. Nearby entities and resource hashes are
in `site-assets.json`; exact source records and variants are in `sites-map.json`.
The original YFT comes from `x64i.rpf/.../v_fences.rpf`; no replacement YFT was found.
Extracted game assets and the full map index remain local and are not published.
An initial wrong CodeWalker load overload failed; the corrected full scan had zero
errors. Neither scan was gameplay evidence.

## Cleanup, performance and remaining limits

Final P2 status: both slots `Registered`, null lease, X7 `None`, no hide intent,
zero roots/anchors. Audit receipts show zero owned objects and experiment debris.
Both originals stayed visible and had 9/9 at their respective read-only audits;
there was no replacement or damage to restore. **Do not label this as a passed
post-fracture restoration test.**

Alt-F4 and quit confirmation stalled on black. The exact verified game PID was
force-stopped; process absence was rechecked before rollback. All seven filesystem
paths restored: four original hashes and three expected absences, including both
DLSS addons. P2 ownership released, no queued request/legacy command remains.
The installer recorded per-operation intent and hash-verified backups; rollback
receipts and the handoff are included. No game process remains.

GPU power cap matched saved 80% (460/575 W). Audit prop pools were 329/2300 and
460/2300, collider count 1/228. Shot, hot-commit, fracture and traversal performance
were **not measured**. No performance acceptance can be inferred from these audits.

Remaining: resolve A's approach collision identity or qualify a different real site
in a separately authorized session; B needs grade/traversal qualification. Then the
entire sequential two-fence prepare/shot/fracture/walk/restore/independence acceptance
is still required. Maximum one native lease remains unchanged. #308 is separate,
untouched and untested here. PR #309 stays draft and unmerged. No X9.

`FINAL.json` is the structured verdict. `live-evidence/manifest.json` binds all six
P2 requests, including A's ERROR receipt, to exact runtime identity and SHA256
inventories. `publication-manifest.json` inventories the published receipt files.
