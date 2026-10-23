# October 23 Windows resume — BLOCKED at IPL activation

Started from PR #310 head `311759f165e1e1f8049eec3a749efa967ed2c687`, including the cloud resource-entry validator. PR remains draft and unmerged. Laboratory qualification and X8 acceptance were **not completed**.

| Acceptance | Result |
|---|---|
| Custom map loading | FAIL — lab IPL inactive |
| Both real YMAP map objects | FAIL — neither source found in the fresh v3 audits |
| Native RPG fracture A / B | NOT RUN / NOT RUN |
| Correct selected sections | NOT RUN |
| Physical traversal | NOT RUN |
| Independent native restoration and cleanup | NOT RUN — no preparations |
| Original filesystem and addons restored | PASS |
| P2 ownership released, no queued commands | PASS |

Nine exact P2 requests are collected, with raw responses, runtime identities and SHA256 inventories. **Zero preparations and zero RPG shots.** No script-spawned substitute, forced selector, artificial explosion, IPL request, native physics edit, or X9 work. #308 remains separate and untested.

## What is now established

1. The installed CodeWalker dev48 rebuilt the surveyed v3-equivalent package successfully. Its nested YMAP is a `RpfResourceFileEntry`, version 2, and passes direct/nested entity reload plus YMF dependency checks. DLC hash remains `9010cc5f599d2168992d7ff5d5401d0fa9d94cac9f1b51c6c6866876888d0927`: the cloud validation commits did not change the package bytes. Ten lab tests passed at the resumed head.
2. A fresh advancing runtime loaded on GTA Enhanced 2.0.1158.16 / SHVDN 3.9.0. Source, installed and loaded hash initially matched `5ad91373ad99fbd6b1d0b7757951c1e05a7ae20c50ea03729818145248815803`. Fresh v3 A/B audits returned terminal ERROR `x8_audit_source_ambiguous_or_missing`. This is the first actual complete v3 audit; prior October 22 v3 was unqualified, not previously proven failed.
3. Found the actual Onigiri log at `%APPDATA%/REKT/onigiri/onigiri.log`. It confirms the expected game `onigiri` root mount and OPEN pack processing. It does **not** identify individual inner archive mounts. A read-only OS handle inspection of exact owned PID 66332 confirmed the lab DLC file open, alongside NVE and X7 archives. Open file presence alone is not proof of inner archive registration.
4. Existing P2 `x4census` at the site found no matching source props or buildings. Added optional read-only `labstream`, through the same P2 dispatcher, to isolate the missing stage. Native results: `IS_DLC_PRESENT(lsa_destruction_lab)=true`; `IS_IPL_ACTIVE(lsa_destruction_lab)=false`; NVE reference `ap_sm` is active; stock fence model is valid, in CD image and loaded; X7 section model is valid/in CD image. Direct closest-object lookup and the authored source-height ray both found no fence.

**Confirmed blocker: a present DLC with an inactive lab IPL and no source objects.** This narrows the issue beyond outer Onigiri mounting, but does not establish why the YMAP is not activated/registered. No claim that native destruction failed: it was never attempted.

## Bounded diagnosis and rejected changes

The optional diagnostic wrapper compiled against the installed SHVDN DLL and loaded with hash `ac8965587884aca973ca4462bc28255e971f84947eac5bf35c364d1d15821ab3`. It issues no model/IPL requests and creates no objects. It temporarily streams the player and restores the player through inherited cleanup. The X7.3 selector, X8 runtime and physics remain unchanged.

Compared actual installed NVE mount XML and the validated vanilla placement in `x64j.rpf/levels/gta5/_citye/indust_01/indust_01_metadata.rpf/id1_24_strm_0.ymap`. The latter's upright `prop_fnccorgm_02e` uses flags 1572864, whereas the generated lab used 1572896 (adds Static Entity). CodeWalker's flag labels identify bit 32 as Static Entity: https://github.com/dexyfex/CodeWalker/blob/master/CodeWalker/Project/Panels/EditYmapEntityPanel.Designer.cs . Vanilla CMapData block version is 0, matching the lab; offline CodeWalker `CalcFlags()` made no change to lab map/content flags 0/1.

Tested two focused package candidates, each with stopped-game restore/install and complete CodeWalker validation:

| Candidate | DLC hash | Native result |
|---|---|---|
| Literal `$level` condition instead of `&#36;level`, plus vanilla entity flags | `3c241d1ce55aa7a97f704c6c07283884ded77f56de1f5f791956d2849dd6b2f3` | DLC present; lab IPL inactive; closest handle 0; source ray misses |
| Additional unconditional startup archive enable, using proven X7 startup mechanism | `2625d7113c193780b858cce542d438c4e48a1828219e9d27be2f8f6b0c3255e0` | Same failure |

Neither experiment established a streaming fix. **Unproven packer/generator/test changes were reverted from the main implementation to the resumed head.** Exact candidate packages, source and generated XML remain under `packs/`, `candidate-source/` and `candidate-generated/` for diagnosis. The only retained implementation change is the small optional P2 read-only streaming diagnostic. Eleven tests passed during the first candidate experiment; its extra candidate-specific assertion was reverted with that experiment, leaving the existing ten-test suite unchanged.

No level name, game setting, Onigiri configuration, NVE/Rockstar archive, selector or native physics was retuned. The surveyed LSIA pivots remain A=(-1255,-3350,13.049618), B=(-1225,-3350,13.049618), intended yaw 0/90 and separation 30m. Previous ground survey remains provenance; full environment qualification was not asserted without sources.

## Launches and restoration

One Steam launch request during old-session shutdown was discarded. Host/Steam logs confirmed no new game process and all old launcher/game processes ended before one reconciled launch request. This was not attributed to package crash. All P2 requests had terminal receipts; no timeout was replayed.

Resource Monitor was briefly opened for read-only diagnostics, but elevated-window access was limited; it was closed. No app input was used to command GTA; only the P2 controller performed experiments. OS file-handle inspection did not inject code or mutate the game. Operator scripts are session-specific evidence, not a new service or installed infrastructure.

After the final read-only failure, stopped exact PID 29600 and independently verified no GTA/GTA5/RPH process. Restored the separate map first, then original SHVDN configuration/DLC list, X7 script/pack/allowlist absences and both DLSS addons. Every original hash/absence matches. `rollback/`, `map-filesystem-restoration.json` and `filesystem-restoration.json` preserve receipts; no original backup bytes are published.

Same P2 owner `codex-lab`, session `lab-acceptance-20261023`, retained across explicitly approved runtime identities. Pending=null. Collected nine request IDs, wrote the restored-state handoff, and released ownership. `controller.json`, `request.txt`, `command.txt` absent. GTA stopped; normal P2 lock/fence/history artifacts remain.

## Remaining work

Determine why the inner lab YMAP does not become an active IPL despite the DLC being present and the stock model available. Outer-file presence and CodeWalker reload are insufficient to certify engine streaming registration. Preserve this distinction; do not relabel failed candidates as fixes or start RPG testing. A later evidence-backed correction must pass both genuine source-object audits and complete environmental qualification before the maximum one RPG per fence.
