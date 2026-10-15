# I2 local inspector — scoped verification, October 15, 2026

Integration starting head: `2eb5231abc53731a21a0f125fdfb0bd09280519e` (#138).
Tested implementation: `6f62722bfcc7d1df2e5cf75acd67c7063f26ae40`.
Branch: `feature/memory-k-i2-inspector-controls`.
Target: `integration/memory-k-production-20261012`, never `main`.
Subsequent documentation-only publication does not change tested code.

The isolated Git worktree starts directly from the latest #138 head at task
start. I2 does not include or depend on an I1 merge. Shared-seam coordination
was posted in [#138](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/pull/138#issuecomment-6197335524).
See [opening/usage, security, reused interfaces and limitations](../memory-k-i2-inspector.md).

## Final local results

Node **24.19.0** on native Windows and Ubuntu/WSL Linux x86-64.
The Linux runs use a fresh shallow checkout of the exact feature commit on
the Linux filesystem, not Windows Node or a modified test implementation.
The original verification runners save test-file SHA-256s, full TAP logs,
platform/runtime, counts, process exit codes and Git status. Both focused
profiles report `exactCleanHead: true` on both systems.

| Selection | Windows | Linux |
| --- | ---: | ---: |
| New I2 inspector/pause profile | 17 passed; 0 skipped | 17 passed; 0 skipped |
| Existing editor/source/D01/D03/H1/H2/M3 profile | 147 passed; 1 existing skip | 147 passed; 1 existing skip |
| Original E2-selected privacy/replay/retention/curation/WS6 suites | 264 passed; 0 skipped | 264 passed; 0 skipped |
| Existing E2 adversarial privacy/recovery suites | 28 passed; 0 skipped | 28 passed; 0 skipped |
| Original source-pinned offline package builder | passed; 70 expected AST edits | passed; 70 expected AST edits |
| Staged inspector/bootstrap import graph | passed | passed |

There are **zero failed/cancelled tests** in these final local selections.
The one original skip in `h1ConversationHistoryHardening.test.mjs` is
`H1-C pin exact #138 original assembly behavior; compare extracted H1 with original code`.
Its existing condition requires `H1C_ORIGINAL_138_PATH`; no historical comparison
checkout was supplied. It is not counted as a pass or silently removed.
All its other source/privacy assertions ran unchanged.

Both complete copied payloads have identical hashes, not just identical launchers:

```text
builtBundleSha256    eb5b3cd45c4c9b8de51c476e30e956854375e353da664e88a18e1677b7427233
e1SourceTreeSha256   5b91c08be02e592aa71b09fd8abb1a485b5af97fef4f7801d86452c2adee1a1b
releasePayloadSha256 af53966d1ea31284cdd3a4bcf067c26382ab843840cf842cb0e3a58bba16f7cd
```

The staged import check imports `bootstrap`, `inspectorAdministration`,
`inspectorControls` and the canonical shared `inspectorProjection` from the
built distribution. Runtime imports resolve inside the staged payload.

## What the new evidence establishes

- Real original P2 SQLite and loopback editor list promoted NPCs and return
  scoped facts/claims, raw player/NPC conversation, event records, correction
  history, suppression and accurate empty/unavailable states.
- I2 works with `memory.commands`, H1/H2, M6/M7 and M8 off. Inspection does
  not generate a player conversation or invoke M5 conversational coordination.
- Token, Host, Origin, content type, UUID scope and source/timeline guards
  reject unauthorized reads/writes and cross-character/world/timeline targets.
  Source retirement/reconfirmation revokes requests admitted under the old
  authority generation.
- Correcting an eligible factual memory preserves immutable private source
  history, supersedes the old fact and sibling derivatives, returns a
  player-reported overlay, rejects conflicting UUID retries, blocks new M6
  extraction/replay from the old sources, and revokes an existing M7 lease.
  NPC speech and witnessed-event ancestry cannot be revised indirectly.
- Forget uses the original suppression/fingerprint closure and verified
  privacy receipts. Subsequent recall/replay cannot retrieve the forgotten
  bundle. Only the original seven-day full-bundle recovery can restore it.
- Private export contains only selected IDs from the current scoped page.
  Missing/foreign selections fail rather than silently expanding the export.
- Config validation/CAS persists only requested settings; the running effective
  modes stay unchanged until restart. Unsupported/prerequisite changes fail.
  Independently edited saved pause requests are shown pending, not effective.
- Pause revokes already queued P2 reads/writes before SQL, rolls back a
  callback that triggers pause during execution, and preserves privileged
  administration. Its async-context fence is isolated from sibling runtimes.
- The real original bundled turn runner proves: M2 recording stops; learned
  H1/H2/M8 contribution is absent in fresh model requests; a prepared request
  paused before HTTP never sends; an in-flight provider is aborted without
  retry; ordinary fresh dialogue can still finish. Existing H1/H2 behavior
  remains covered by the unchanged independent foreground suites.
- The real authenticated source parser/PS2/M3 production adapter proves event
  and coverage intake stop across pause. Failed notification/disposal reports
  incomplete cleanup instead of claiming full success. P2/privacy remains
  available; pause cannot re-enable in the same process.

## Scope of acceptance and reproducibility

Use the commands in the usage guide, or the new Windows/Linux I2 CI workflow.
The workflow runs on draft PRs and checks the exact PR head. Preserve its
results separately from these local receipts; local success does not assert
that a future GitHub run has completed successfully.

Windows sandbox trials initially encountered the environment's established
P2 hard-link / localhost restrictions. Native Windows test access resolved
those restrictions without weakening P2 atomicity or editor authorization.
Intermediate development failures were fixed before the final clean runs;
they are not presented as acceptance evidence. WSL temporary checkouts are
ephemeral; receipts and package manifests were saved outside them. A follow-up
staged-import check therefore builds and verifies within the same WSL session.

Synthetic browser demonstration exercised the actual editor with fixture NPCs
and retained data. It displayed distinct eligible, superseded and suppressed
records and the private administration controls. No actual player transcript
or installed-game database was read for the screenshots.

No physical GTA test, native production DLL build, deployment, soak, original
S01–S10 closure, or #138 release acceptance is asserted. No auto-merge is enabled.
The user must explicitly restart to resume learned memory. Current native
source/timeline authorization remains necessary for inspection. Correction is
conservative and can withdraw other summaries sharing its old player evidence;
older builds fail closed on the new privileged correction mode. Future M6/M7/M9
runtime wiring must preserve the same pause ports and lifecycle fences.
