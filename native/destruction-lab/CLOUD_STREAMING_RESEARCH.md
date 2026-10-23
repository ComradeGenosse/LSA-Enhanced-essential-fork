# GTA Enhanced custom-YMAP activation: cloud investigation (2026-10-23)

**Scope:** PR #310 after the Windows handoff at `6ae60051`. Research only: no GTA access, packer change, simulated acceptance, shots, new physics, X9, or changes to issue #308.

## Evidence that actually survives the failed local trials

* **Strong positives:** CodeWalker dev48 created and round-tripped the authored YMAP with two correctly placed entities; the nested RPF carries a `RpfResourceFileEntry` v2 YMAP; the `_manifest.ymf` dependency reloads. `IS_DLC_PRESENT("lsa_destruction_lab")` was true. Onigiri mounted its overlay and GTA opened the outer lab DLC RPF (as shown by PID-matched handles). The stock fence archetype was valid, in CD image, and loaded. The LSIA survey measured a solid level surface.
* **Strong negative:** Neither authored fence was found by P2's fresh A/B source audits, closest-object lookup, or collision-height ray. **This is a real map-object failure**, not an X8 fracture or selector failure. No prepares or RPG shots occurred.
* **Limited diagnostic:** `IS_IPL_ACTIVE("lsa_destruction_lab")=false` is **not sufficient to conclude that the unscripted YMAP failed registration**. CodeWalker's `YmapFile.IsScripted` is `(_CMapData.flags & 1) > 0`; our XML uses `flags=0` (automatic/spatial streaming). `IS_IPL_ACTIVE` and `REQUEST_IPL` are principally useful for script-requested IPLs. First calibrate what this native reports for a *known, visible, automatically streamed YMAP*.
* **Weak control:** `IS_IPL_ACTIVE("ap_sm")=true` proves the native query itself works, not that NVE's *specific added custom YMAP* was registered. Identify one actual visible YMAP from a loaded map add-on before treating it as a packing control.
* **Rejected as fixes:** v1, v2, resource-checked v3, literal `$level` + vanilla entity flags, and unconditional startup registration have all failed to yield authored fence objects. Exact package/evidence from the latest resume is retained under `evidence/20261023-resume/`; don't redo these blind alterations.

## External source comparison

1. **YMAP shape:** Independent [fivemad YMAP builder example](https://www.fivemad.com/cs/tools/ymap-builder) uses `CMapData flags=0`, `contentFlags=1`, `CEntityDef flags=1572896`, and `LODTYPES_DEPTH_ORPHANHD`—the same key structure our generator used. This is a *FiveM/source-format* comparator, **not proof of Enhanced/Onigiri mounting**.
2. **What scripted means:** [CodeWalker YmapFile source](https://github.com/dexyfex/CodeWalker/blob/master/CodeWalker.Core/GameFiles/FileTypes/YmapFile.cs) explicitly tests the map's `flags & 1` for `IsScripted`. [CodeWalker-based workflow](https://docs.fivem.net/docs/assets-manual/beginner-series/part-4/) distinguishes generating YMAP/manifest from getting the engine to stream them. Scripted maps use `REQUEST_IPL`/client load, whereas ordinary non-scripted exterior YMAPs are expected to spatially stream.
3. **Platform positive:** The [MapPack_Merge Enhanced 0.1.3](https://www.gta5-mods.com/tools/mappack_merge) author reports successful packaging of 47 maps on a **Steam Enhanced + Onigiri + NVE** installation and distinguishes scripted maps requiring an explicit runtime request. Independent [Enhanced NVE users](https://www.reddit.com/r/Gta5Modding/comments/1sld6if/gta5_enhanced_ymaps/) also report visible YMAPs added to NVE archives. The standalone workflow is feasible, but these statements do **not** validate our particular pack.

## Highest-information next Windows session — one controlled launch

1. Preserve game-stopped/backup/hash/P2 gates. Build the **existing** v3 pack from the current source, not failed candidate variations. Do not copy or overwrite an NVE/Rockstar archive.
2. While GTA is launched and P2 owns it, query **both** real lab pivot locations for exact model hash, transforms, candidate handles, collision and rendering. Repeat near the locations only after ordinary streaming settles. Do not spawn any substitute.
3. In the *same* P2 session, verify the output of `IS_IPL_ACTIVE` against an identified **visible, ordinary non-scripted base-game YMAP**. The control must actually have entities nearby; the default `ap_sm` IPL is not an appropriate equivalent.
4. If A/B still missing, issue **one explicitly approved P2-only diagnostic `REQUEST_IPL("lsa_destruction_lab")`** (not `CREATE_OBJECT`), allow a bounded normal streaming delay, and record before/after: `IS_IPL_ACTIVE`, A+B closest genuine objects, native model/hash/transforms, source-height collision rays. On cleanup, `REMOVE_IPL` only if this session issued a request; never alter other IPLs. If a cleanup change is uncertain, stop, preserve evidence and rely on clean restart/rollback. The proposed diagnostic does not claim to establish physics safety.
5. If request creates genuine YMAP objects, **activation is the differentiator**. For a *personal mod*, one reasonable later change is to set the lab YMAP scripted bit and explicitly request only that lab during P2 qualification, then check real map ownership and full X8 environmental gates. This is still map streaming, **not script-spawned props**, but test it before calling the lab solved.
6. If request is ineffective, concentrate on **registration of the inner YMAP**, not more site selection: independently inspect a real working *custom add-on YMAP* with its archive path, `content.xml` enable target(s), change-set group, setup2 type, YMAP name/hash, scripted flag, `_manifest.ymf`, resource entry data/version, and gameplay presence. Compare the full registration path against the lab. A game-visible positive control using the *same loader* is stronger than an NVE pack merely being open.
7. If the comparison and IPL probe do not differentiate failure, publish that precise negative result and stop; do not cycle generic flag combinations, shotgun restarts or rewrite X7.3/X8.

### Decision matrix

| Diagnostic | Interpretation | Next step |
| --- | --- | --- |
| Lab fences visible *before* request | Auto-streaming works | Qualify both original objects, approaches/ground/collision; only then X8 |
| Fences absent before, visible **after** IPL request | Real map registered; activation behavior suspected | Preserve result; consider explicit P2 lab activation / scripted bit with a controlled follow-up |
| Fences absent after request; known custom YMAP positive control visible | Lab archive/YMAP registration likely wrong | Compare exact working DLC and lab registration/indexing; patch proven divergence |
| Fences absent after request; no custom YMAP positive control established | Loader-vs-map cause unresolved | Establish a working same-loader map first |
| `IS_IPL_ACTIVE` false for visible vanilla YMAP | IPL-active query is not a generic auto-streaming gate | Grade by genuine handles, native collision, map ownership, not this flag |

**Safety:** This is a *read-only-first* streaming investigation; the only optional mutation is a bounded request to load the lab YMAP by name, under P2. No RPG until both genuine authored map fences and all prior environmental gates pass. One prepared fence at a time, maximum one shot per qualified fence; #308 separate. Stop GTA, restore hashes/addons and release P2. Leave #310 draft and unmerged.
