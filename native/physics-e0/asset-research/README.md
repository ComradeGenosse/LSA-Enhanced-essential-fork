# E0 offline asset research — October 19, 2026

Private assets were read from the local Steam GTA V Enhanced installation, executable version **1.0.1158.16**, Steam build **25261616**. No game launch or installation change was performed. Reference: [PR #285](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/285), source c717ea0c6869ba243280f9b5529bfc924e3c7889. This research does not complete native E0.2/E0.3 acceptance.

## Contents and selection

The final bundle contains **98 asset files**: 17 YBN, 30 YMAP, 27 YTYP, 3 YMF, 5 DAT and 16 XML metadata files. This includes original and update material definitions, the installed Onigiri material and DLC-list overrides, selected DLC mount definitions, base geometry and relevant patch/heist variants. CodeWalker XML exports accompany resource files for analysis without GTA or CodeWalker. XML exports remain private game-derived content.

Selection starts at **dt1_19**, the downtown police-hub exterior block. The base YBN bounds are X 410.44073–489.63107, Y -1034.0488–-965.8064, Z 24.369999–45.89683. These bounds are decoded source values, not a player teleport recommendation. A broader two-block trial was discarded after confirming the second block was unnecessary. The final package uses one block, map-parent closure, exact referenced archetypes, physics dictionaries, and mount metadata. It includes the referenced police-hub interior YBN, whose local geometry requires its YMAP/MLO transforms; exterior candidates do not use that interior coordinate space.

**92/92 referenced archetype hashes resolved**, with no YTYP scan failures or archive scan errors across 5,407 scanned archives. Parent maps and shared YTYP files can describe assets beyond the selected block. Their unrelated drawable/fragment dependencies are deliberately not included. Rendering, every placed prop's collision, and every interior are outside this bundle's scope. This is a bounded research dependency set, not proof of an absolute byte-minimum or a complete playable map.

## Measurements and limits

`candidates.json` contains 30 surface candidates and 10 wall-like box primitives. The selected surfaces span **12 material indices**; 30 samples does not mean 30 different materials. The source exterior geometry offers 22 material indices. Wall candidates span four material indices (concrete, brick, wood hollow medium, metal hollow medium) and approximately 0.05–0.74 m encoded thickness.

`offline-ray-verification.json` records CodeWalker nearest-hit tests of a larger pool: 113/200 surface rays and 69/100 wall pairs matched. Only matching probes enter the final 30/10 selection. Rejected proposals remain in the candidate pool and verification report so overlaps and mismatches are visible. Each selected surface matches its source YBN's nearest hit and material within 1 cm; each selected wall also matches its forward/reverse source-YBN thickness within 1 cm. Thickness is a measured collision primitive dimension, not a certified architectural wall measurement.

All candidates remain **UNVERIFIED in GTA**. Checks operate on one YBN at a time. Other streamed collision, embedded drawable/fragment bounds, IPL activation, patch precedence, source winding, collision margins, adjacent primitives, roof/underground access and mod mount state can change game results. A narrow or tall box can be a beam or prop rather than a wall. No visual wall identification, walk-up accessibility, engine material hash, native ray hit or inside-solid result was invented. Candidate ray offsets are explicit proposed probe design; vertex coordinates and dimensions derive from assets.

Material names use row order in the base `materials.dat`, retaining the source numeric indices and all extracted table variants for comparison. The installed override may change physical properties. Native hashes and joaat matching remain untested. Do not copy these candidates into the lab as accepted ground truth without review and eventual native comparison.

## Formats, provenance and tools

CodeWalker **30_dev48**, Core assembly 1.0.0.0, Gen9=true, SHA-256 `f08e8fb273c8c080d438508685b3b158db6b531a856d03be2514c46bf2e1b03a`, actually read the installed archives and parsed all 17 packaged YBN files independently. This is empirical support for these installed formats; assembly version alone is not a compatibility claim. [Upstream CodeWalker](https://github.com/dexyfex/CodeWalker) provides the API and [box decoding implementation](https://github.com/dexyfex/CodeWalker/blob/master/CodeWalker.Core/GameFiles/Resources/Bounds.cs).

OpenRPF was not found in the game root, Downloads/Apps, or the inspected tools directory. `onigiri.asi` is installed instead; its hash is recorded. OpenRPF is a runtime mod archive loader, not required by this extraction path; see the [Sollumz Enhanced conversion documentation](https://github.com/Sollumz/wiki/blob/main/tutorials/asset-conversion-for-gtav-enhanced.md). Its compatibility with this exact installation was **not tested**, and nothing was installed or replaced. No loose YBN/YMAP/YTYP override was found under Onigiri; DLC archive precedence remains unverified. The manifest excludes mod/Onigiri archives from the base scan and preserves the loose material/DLC-list overrides separately.

`assets/` preserves complete original archive paths as directories. Binary entries are decoded through CodeWalker. Resource outputs use a standard RSC7 header reconstructed from original entry flags and recompressed DEFLATE payloads: they are authentic decoded resources, **not byte-identical copies of compressed archive storage**. The manifest distinguishes portable-file SHA-256, unchanged decoded-payload SHA-256, original stored-entry SHA-256/offset/length for unencrypted resources, and top-level archive SHA-256. The original archive bytes were not rewritten. `package-inventory.json` hashes every other staged file; the external ZIP receipt hashes the ZIP.

Coordinates retain original GTA values, nominal metres, Z up. Exterior YBN vertices require GeometryCenter plus the complete row-vector CompositeTransform chain. YMAP position, rotation, scale, parent and physics-dictionary references remain in the XML. Placed archetypes/MLOs require their placement transforms; do not reapply YMAP transforms to already world-space exterior YBNs. No coordinates were rebased or converted to a geographic reference system.

## Reproduce

Use PowerShell 7.4+/.NET 8+ and Python 3.10+ on Windows. Install the author's Enhanced-compatible CodeWalker separately. The scripts use only its Core library and standard Python libraries, and never write to the game directory. Destination must be a new directory outside the installation. Extraction scans and hashes archives; it may take a minute.

```powershell
.\Extract-E0Assets.ps1 -GameRoot 'C:\path\to\Grand Theft Auto V Enhanced' -CodeWalkerRoot 'C:\path\to\CodeWalker30_dev48' -Destination 'C:\private\e0-assets'
python .\analyze_e0_assets.py 'C:\private\e0-assets'
.\Verify-E0Geometry.ps1 -Staging 'C:\private\e0-assets' -CodeWalkerRoot 'C:\path\to\CodeWalker30_dev48'
python .\package_e0_assets.py 'C:\private\e0-assets' 'C:\private\e0-assets.zip'
```

The analyzer validates all extracted hashes. Packaging independently decompresses every resource and checks its decoded-payload hash and RSC7 flags, then reopens the ZIP, checks CRC and verifies each inventory hash. The geometry verifier independently reloads portable YBNs and filters candidates using CodeWalker's collision routines. Rerunning the analyzer restores the provisional pool; always run the verifier afterward. ZIP bytes and timestamps can differ across reruns; manifests establish payload equivalence.

## Remote readiness and remaining work

The ZIP is ready for private geometry inspection, material-table comparison, variant selection, candidate review and lab sample preparation without GTA. Offline measurements are available now. To complete E0.2/E0.3, identify actual wall/surface semantics and access, resolve the intended live IPL/mod/patch state, review any missing embedded collisions, and run the lab's native material/forward/reverse/inside-solid comparisons against the reviewed references. These steps remain acceptance blockers, not extraction failures. If 30 distinct material types are required, expand beyond this single block using the same evidence rules.

Only these scripts and this documentation belong in the GitHub research branch. Never add assets, XML exports, extracted material tables, private manifests, candidate coordinates, binaries, or ZIPs to public Git. Do not launch GTA merely to extract resources. No changes were made to PR #285, main, the installed lab, or the working mod installation.
