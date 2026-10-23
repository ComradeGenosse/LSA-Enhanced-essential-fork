# X8 cleanup-ownership validation at 18b19bea (NVE-backed lab)

Runtime: PID 57312, loaded 2026-10-23T15:18:17Z, script SHA-256 27c87b05...5678728 (matches 18b19bea build). Sole P2 controller, owner codex-lab, session lab-cleanup-20261023, fence 451edf80.... Afterburner profile 1 applied; DLSS addons renamed (.x8off), no graphics interaction. Standalone DLC registration is a separate issue and untouched.

| Check | A | B |
|---|---|---|
| Genuine streamed source, pivot/heading | PASS (0 deg) | PASS (90 deg) |
| Original collision before shot | 9/9, foreign 0, approach hits 0 | 9/9, foreign 0, approach hits 0 |
| One real RPG, automatic impact selection | PASS: projected_intersection, sections 1,2 (mask 6), commit 3 frames pre-explosion | PASS: sections 2,3 (mask 12), commit 2 frames pre-explosion |
| Surrounding sections retained | PASS (moved <= 0.002 m) | see rows |
| Frames over 50 ms in window | 0 | 0 |
| Player traversal | PASS, 1 m lane, maxRise 0 | PASS, 1 m lane, maxRise 0 |
| Original restored | 9/9 | 9/9 |
| x8_cleanup_verified | tracked 12, remaining 0, reused 0, passed=true | tracked 12, remaining 0, reused 0, passed=true |
| Ownership release | lease null, state Registered | lease null, state Registered |
| Unaffected during other fence | B audit during A: 9/9 original | A audit during B: 9/9 original (see r2-a-during-b rows) |

Unverified candidates: 4 per restore, reported separately, NOT deleted and NOT counted as owned. No teleport used to manufacture results; positions come from the lab's own x8audit/x8prepare commands. One RPG per fence. No X9.

Note: the B-during-A audit reported owned=10/debris=6 (A's active lease counts near B); B's own original stayed visible, upright, 9/9, foreign 0.

Host: controller was run from a Linux VM using a py3.10 copy of controller.py differing only in fractional-second parsing of status timestamps. GTA stopped via Steam. P2 released (controller.json removed). Restored by hash: ScriptHookVDotNet.ini, dlclist.xml, NVE_props_addon dlc.rpf (83E162E5...); lab DLC, X7.3 script, models list absent; both DLSS addons restored. See filesystem-restoration.json.
