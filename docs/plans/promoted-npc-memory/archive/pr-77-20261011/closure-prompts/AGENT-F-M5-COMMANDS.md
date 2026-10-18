You are **Memory Closure Agent F — M5 explicit commands and scoped UX**.

Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`.
**Exact source starting point:** draft PR #75, commit `8443a8adec9433626902b46b81bd3e58fc382fb2`, branch `integration/memory-completion-h-review-20261011`. Create your OWN feature branch at exactly that SHA; PR base `integration/memory-completion-h-review-20261011`. Do not branch from main or another agent's work.

Read `docs/plans/promoted-npc-memory/MEMORY-INTEGRATION-ACCEPTANCE.md`, approved decisions, full implementation roadmap, `contracts/memory.v1.json`, applicable PS0–PS4/PS6/native contracts, actual source code and prior completion handoffs. The phased plan and prompts live on the separate planning branch `planning/memory-closure-agents-20261011`; read `docs/plans/promoted-npc-memory/MEMORY-CLOSURE-PHASED-PLAN.md`.

**Mandatory rules:** Preserve one P2-owned SQLite source and one PS4 knowledge frame; source-qualified witnessing only; no guessed identity/protagonist, false no-witness inference or bypass of player/Director priority; Luna only as optional paid cloud off-turn curator; no new local AI/daemon. Never claim GTA acceptance, install, merge to main or make paid network calls. If the real native source cannot prove a fact, leave it unknown and document the blocker.

**Deliverable:** Working implementation in ONLY your owned files, strong offline positive/adversarial regression tests, an exported API/mock-fixture contract for integrator K, and `docs/plans/promoted-npc-memory/closure-handoffs/AGENT-F.md` with exact final SHA, true test commands/results, integration edits K must make and remaining blockers. Push dedicated PR and do not merge.

**Ownership:** `lsa-shared-brain/src/memory/explicitCommands.mjs`, a new host-neutral `m5RuntimeCoordinator.mjs`, new scoped privacy/editor facade module and tests. B exclusively owns `m5SqlitePrivacy.mjs`; K owns live editor/runner/glue.

Implement the *working before-Luna* coordinator consuming the exact **durably accepted M2 player line**, stable command IDs and B's serialized P2 command/privacy ports. Handle one/two explicit commands, multi-turn ambiguous clarification with frozen evidence choices, expired/reconnect replies, typed `saved/forgotten/corrected/clarify/failed` acknowledgments from verified SQLite readback only, STT correction overlays and protected scope. Implement authorized inspector/export/trash/restore/purge facade with character/protagonist/timeline boundaries, 7-day recycle window, immediate retrieval suppression, source-linked derived cascade, and no raw private content in telemetry.

Use adapters/mocks if B's APIs are not yet ready; specify their exact shapes, not own alternative database. Include adversarial tests where player says 'remember' casually, choices change mid-turn, deleted source was offered in clarification, payment/user/secret leakage, multiple NPCs, rollback, database exceptions and compound mixed success. Hand K an exact minimal command hook order and editor route contract; no speculative Luna parser can authorize writes.
