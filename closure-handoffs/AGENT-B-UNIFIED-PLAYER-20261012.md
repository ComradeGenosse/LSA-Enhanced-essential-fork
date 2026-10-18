# Agent B — Unified Player Memory Commands & Privacy Handoff

## Branch / parent
- Agent B draft PR: #123, `fix/unified-player-memory-agent-b-commands-privacy-20261012`.
- Parent: PR #115, `fix/unified-player-memory-across-avatars-20261012`, pinned starting commit `073094a8c13d323cb9e1b0f8054aba86b03a09d1`.
- Owned source: `explicitCommands.mjs`, `m5SqlitePrivacy.mjs`, `fixtureMemoryCommandStore.mjs`. Test edits: original explicit command fixture suite and M5 completion runner plus a separate Agent B SQLite suite. No changes to Agent A, Agent C, or integrator's reserved unified-player test.

## Concrete fixes
1. A frozen clarification persisted by Franklin can be resolved by Michael or Trevor. The earlier request remains source evidence with its original protagonist, while the resolving command is bound to the NEW accepted and durably persisted reply line, including its current protagonist. Stale/pre-clarification replies, re-ranked frozen candidates, forged accepted bytes, other NPCs/worlds/timelines and replay with a different accepted reply fail closed.
2. Explicit topic selectors can find older permanent memories. Deictic/recent references keep time limits.
3. Privacy operation hashes use NPC+world+timeline owner identity, not avatar. The old PR #115 hash format is recognized only when the original operation's recorded avatar produces an exact legacy match. Current authorization is checked before and INSIDE P2's serialized transaction.
4. Trash and restore already use human owner-scoped SQL; new idempotent retries work after switching avatars. Purge selects complete trash-operation groups to avoid a LIMIT splitting a bundled deletion, and verifyPurge re-reads physical deletion from the single P2 SQLite reader before privileged UI can report success.
5. OFFLINE ONLY: file fixture shares memory owner keys across avatars but records source avatar on newly stored memory. Do not install fixture in GTA.

## Verification
- `memory-m5-agent-b-cross-avatar.test.mjs`: production P2 SQLite-backed cross-avatar recall/privacy/correction/forget; frozen clarification resolution; denied stale/forged/cross-scope requests; idempotent trash/restore and physical purge.
- The original M5 completion test file imports this suite so the existing Node 22/24 Windows/Linux CI actually executes it.
- Original E1 JSON fixture suite now checks historical Michael provenance is allowed but different timeline is rejected, alongside one-player persistence across a restart.
- First CI (head `0e9e7b47d3cc830aacb7b4ae93bca928f7eb3022`): unified-player SQLite ubuntu job passed; M5 completion had 46/47 passed; the sole failure was the legacy fixture assertion that equated Michael with a different owner. Corrected in follow-up commit `f0dfb9808fe6fc24928d0ce9046512e47d695c69`. Consult exact final PR head CI for full completion; do not treat the earlier mixed result as a pass.

## Integration boundaries / risks
- Native original C-01 acceptance and physical GTA replay remain upstream obligations, not proven here. This patch does not weaken native current-turn authority, session fences, or initial accepted source checks.
- The clarification receipt's `requestedByLineId` is now the RESOLVING accepted reply, not the original unfinished request. The original request ID is included in `evidenceRecordIds`. Integrators must not reintroduce the old-avatar equality test in downstream routers.
- Destructive purge still demands explicit privileged editor authorization. Verify native owner/session freshness end-to-end in final acceptance.
- Full original S01–S10 acceptance and K T4/T5/T6 branch reconciliation remain independent NO-GO work.

## Integration recommendation
Keep PR #123 draft until its exact-head M5 explicit commands, M5 completion, unified-player SQLite, and wider memory workflows pass. Merge this PR into PR #115's branch only after review, then let the final unified-player integrator run reserved integration coverage.
