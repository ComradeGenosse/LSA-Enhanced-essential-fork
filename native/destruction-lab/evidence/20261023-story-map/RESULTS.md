# October 23 SP map candidate — FAIL, X8 not run

Started at PR #310 head `6e676446`. Built with installed CodeWalker dev48 using `-StoryModeMapCandidate` and the previously surveyed source at A=(-1255,-3350,13.049618), B=(-1225,-3350,13.049618), yaw 0/90. The new SP registration candidate did **not** resolve map loading. No evidence-backed root correction was established.

| Acceptance | Result |
|---|---|
| XML / binary YMAP / archive and resource entry validation | PASS offline |
| Custom lab map loading | FAIL — neither genuine source appears |
| Genuine map object A / B | FAIL / FAIL |
| Location, orientation, original collision, approach clearance and ground qualification | NOT QUALIFIED — sources missing |
| Native RPG fracture A / B | NOT RUN / NOT RUN |
| Correct selected sections and retained surrounding sections | NOT RUN |
| Physical player traversal A / B | NOT RUN / NOT RUN |
| Independent restoration, original collision 9/9 and owned-entity cleanup | NOT RUN — zero preparations |
| Original files, addons, GTA shutdown and P2 release | PASS |

**Zero RPG shots; zero preparations; no spawned substitutes.** X7.3 selection, X8 staging/physics and issue #308 are unchanged; no X9. PR remains draft/unmerged.

## Candidate validation and actual loading

The pack receipt and exact authored package are in `pack/`. SHA-256 of `dlc.rpf`: `b2f4a362f14e410c7f3e12a9646e2de18842c7c0ab2cac88b85c810686a4aa71`. Source XML SHA-256: `d1914feb6980a261f409d363371bcab7eed1a1f42235765d91ebcc4ba4fb98e4`. Both direct and nested CodeWalker reloads contain exactly two correct entities. The YMAP is an RPF resource entry version 2, system size 8192 / graphics size 0; the binary dependency manifest resolves lab -> v_fences. XML contains `mapChangeSetData`, the actual inner archive path and `GROUP_MAP_SP`. Eleven lab tests passed. These offline passes do not establish GTA streaming.

First runtime PID 49792, loaded UTC `2026-10-23T13:56:11.9911349Z`, source/installed/loaded hash `ac8965587884aca973ca4462bc28255e971f84947eac5bf35c364d1d15821ab3`. Explicit player-streamed audits A `24919e17e80a48868314f7cd5aafd7ca` and B `898ff0620acf48348163e5299bb86ce8` fail with `x8_audit_source_ambiguous_or_missing`. The two earlier audit calls omitted `stream=1`; their failures are preserved but are not the streaming verdict. A separate `labstream` moves the player near A, waits for collision and normal frames, then records closest handle=0 and a missing source-height collision ray. DLC presence=true is insufficient.

## Working custom-YMAP control

`NVE_props_addon/dlc.rpf/x64/city_props.rpf/rocks.ymap` is the concrete same-installation control, rather than the earlier ap_sm IPL flag. CodeWalker reads eight authored entities, map flags=0, contentFlags=1, resource version 2, same 8192/0 resource page sizes, same orphan-HD/required LOD semantics and ordinary RPF_FILE/GROUP_UPDATE_STREAMING registration. Its manifest declares its archetype dependency.

P2 survey `7649225e970a40fe8fca36f7e6d5d5a4` finds native model hash 2580877897 at **both exact authored positions**, within rounding: (1604.46838,1016.63953,78.16719) and (1606.52039,1019.31573,78.3482742). No script creates these props. `working-control.json` and raw P2 survey retain the correlation without redistributing NVE assets. Forest, smoke and lantern probes did not establish exact native matches; their records are not claimed as positive controls. The comparison establishes working custom map streaming on this installation, but did not isolate a specific lab defect. A separate archive and same model flags/resource version alone do not prove equivalent registration.

## One explicit IPL discriminator

Added only optional P2 `labipl action=request|remove approved=1` to the lab wrapper, refusing a live native lease and fixed to `lsa_destruction_lab`. It never spawns objects or changes destruction/selection. The regenerated wrapper compiled against installed SHVDN, with warnings only. No hot redeployment: stopped PID 49792 with no pending request, hash-journaled the diagnostic update, and made one further launch using the **unchanged** SP candidate package.

Second runtime PID 44456, loaded UTC `2026-10-23T14:06:57.7310246Z`, source/installed/loaded hash `3be67a10df11f75d02c95d1b01ecdc8ae5a7b7183b0829621140aac5e371e1a2`. Request `616cb094fea74960acab5d6d49f01b75` returns IPL active=false before and after `REQUEST_IPL`. Post-request A `d67eea47618e46d6b687c8a9f5ce0f6f` and B `1cb48177c4c341429a187e2585275482` each return closest source handle=0 and a missing probe ray. B's diagnostic ray uses the fixed A-oriented probe, so **B absence is graded by closest-source lookup and its earlier correctly oriented X8 audit**, not by that ray alone. Screenshots show actual LSIA gameplay during the respective held diagnostics; native records are the source oracle. IPL status alone remains non-decisive for an unscripted YMAP.

Issued one matching P2 `REMOVE_IPL` (`c26b23c809ed446eafa892026ba9c2d8`) before shutdown. Before/after=false; no other IPL requested or removed. The direct request did not rescue the map, so it is **not a fix**. The working-map comparison and request did not differentiate a grounded correction; no further metadata/flag combinations or speculative restarts were attempted, following the existing cloud decision tree. Root cause remains unresolved.

## Restoration, ownership and limits

All 18 P2 requests have terminal correlated receipts; `p2/manifest.json` inventories the raw requests, responses and run records by SHA-256. All commands used the sole Windows P2 controller, owner `codex-lab`, session `lab-story-sp-20261023`, same fence across explicitly verified runtimes. Diagnostic screenshots use read-only computer-use capture; no desktop game input.

Stopped exact owned PID 44456. Host GTA/GTA5/RPH process count=0. Restored map first, then driver/config baseline and both DLSS addons. Original DLC list/SHVDN configuration hashes match; original script, X7 pack/allowlist and lab pack absences match; addon bytes and temporary-name absences match. Backups remain private. Filesystem receipts and final handoff are included; command slots absent, pending=null, P2 ownership released.

No native source was admitted, hidden, fractured or restored, so this is **not** an X8 physics failure or proof of 9/9 post-shot restoration. Further work requires a specific evidenced difference or controlled loader discriminator; do not re-run the already failed SP/startup/flag variants or call inactive IPL alone the cause.
