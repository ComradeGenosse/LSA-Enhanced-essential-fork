# Cloud investigation: missing single-player map changeset (2026-10-23)

**Latest Windows result:** [SP candidate tested and failed](evidence/20261023-story-map/RESULTS.md). Both genuine sources remain absent after the candidate and one explicit IPL request. A same-installation custom-YMAP control has exact native matches. Zero preparations/shots; original hashes restored; P2 released. This hypothesis is not a confirmed root cause. Original V3 remains the default.

## Specific defect candidate

The observed symptoms are: GTA/Onigiri discovers and opens `lsa_destruction_lab/dlc.rpf`, and CodeWalker validates the nested YMAP/YMF, **but neither authored world fence appears**. The live diagnostic `IS_IPL_ACTIVE=false` is not by itself decisive for an unscripted YMAP. The failure is the absence of actual map entities/collision.

The current `pack_lab.ps1` only links its map archive to a `GROUP_UPDATE_STREAMING` changeset with `filesToEnable` and `genericConditions` using `$level=MO_JIM_L11`. It has **no** `mapChangeSetData` item and **no** `GROUP_MAP_SP` changeset group.

A published standalone GTA single-player DLC conversion template uses:
- a `mapChangeSetData/Item` with `associatedMap=MO_JIM_L11` and `filesToEnable` pointing at the map *archive*;
- a `GROUP_MAP_SP` registration for this changeset (and a `GROUP_MAP` counterpart);
- a separate `GROUP_STARTUP` for ancillary assets.

Source: https://github.com/lucienlmy/5mod-tutorials/blob/master/Beginners-Guide-to-Porting-FiveM-mods-to-SP.md

An independent 2026 map-author comment reports the **same CodeWalker-valid-but-invisible-in-story-mode** symptom from incorrect `genericConditions` and missing `GROUP_MAP_SP`, recommending `mapChangeSetData/associatedMap` and `GROUP_MAP_SP`. This is anecdotal, not proof of the exact level semantics:
https://www.gta5-mods.com/no/maps/legacy-dealership-mlo-gta-5-legacy-dealership-mod-dlc-rpf-installation

A separate public map DLC packer for RageMP has a `mapChangeSetData` changeset under `GROUP_MAP`, again showing mapping registration can be distinct from enabling the archive:
https://github.com/raisen1337/MapDLCMaker/blob/main/index.js

**Key comparison:** Codex's previous explicit-startup attempt added `GROUP_STARTUP` but **did not** add `GROUP_MAP_SP` or `mapChangeSetData`. Therefore the October 23 failed tests do **not** falsify this hypothesis. The installed NVE pack's `GROUP_UPDATE_STREAMING` should not be treated as a same-loader positive control for a brand-new single-player YMAP.

## What was implemented online

An **opt-in** `pack_lab.ps1 -StoryModeMapCandidate` variant appends `LSA_DESTRUCTION_LAB_MAP_SP` with an `associatedMap` mapping and registers that under `GROUP_MAP_SP`. Existing v3 bytes/behavior remain unchanged when the switch is omitted. The receipt labels which variant was built. A source-level regression guard checks the candidate remains opt-in. This does not change YMAP geometry/flags, physics, the selector, P2, or existing test-site data.

## Bounded local discriminator

1. Use the stopped-game, backup-verified, P2-only workflow. Rebuild the *candidate* with `-StoryModeMapCandidate` and check the pack receipt and XML; validate the nested resources with CodeWalker. Distinct output directory, no old pack reuse.
2. After exactly one controlled install/launch, audit both surveyed A/B pivots for genuine streamed map sources, heading, model hash and collisions. An active IPL flag alone is insufficient.
3. **If A/B appear:** stop and record this as map-registration evidence, then complete environmental qualification; proceed to X8 only after all prior gates. Avoid further metadata flag exploration.
4. **If absent:** publish the single failure. Next compare against a known game-visible *custom* YMAP from the same Enhanced/Onigiri installation, with actual streamable archive registration. Do not launch a series of unbounded variants.
5. Restore game files/addons by hash and release P2. At most one RPG per qualified fence; #308 untouched, no X9.

## Confidence and limitations

High confidence: the published templates have a single-player map changeset that our lab lacks. Medium confidence: this difference causes the lab's failure. **Not yet proven**: that this Enhanced build specifically requires `GROUP_MAP_SP`, that `MO_JIM_L11` is rejected by the current level, or that the new candidate will work. Those require a genuine local source-entity audit, not CodeWalker reload.
