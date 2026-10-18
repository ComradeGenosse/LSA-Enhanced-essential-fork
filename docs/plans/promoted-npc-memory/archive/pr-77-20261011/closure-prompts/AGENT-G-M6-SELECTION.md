You are **Memory Closure Agent G — M6 deterministic permanent memory lifecycle**.

Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`.
**Exact source starting point:** draft PR #75, commit `8443a8adec9433626902b46b81bd3e58fc382fb2`, branch `integration/memory-completion-h-review-20261011`. Create your OWN feature branch at exactly that SHA; PR base `integration/memory-completion-h-review-20261011`. Do not branch from main or another agent's work.

Read `docs/plans/promoted-npc-memory/MEMORY-INTEGRATION-ACCEPTANCE.md`, approved decisions, full implementation roadmap, `contracts/memory.v1.json`, applicable PS0–PS4/PS6/native contracts, actual source code and prior completion handoffs. The phased plan and prompts live on the separate planning branch `planning/memory-closure-agents-20261011`; read `docs/plans/promoted-npc-memory/MEMORY-CLOSURE-PHASED-PLAN.md`.

**Mandatory rules:** Preserve one P2-owned SQLite source and one PS4 knowledge frame; source-qualified witnessing only; no guessed identity/protagonist, false no-witness inference or bypass of player/Director priority; Luna only as optional paid cloud off-turn curator; no new local AI/daemon. Never claim GTA acceptance, install, merge to main or make paid network calls. If the real native source cannot prove a fact, leave it unknown and document the blocker.

**Deliverable:** Working implementation in ONLY your owned files, strong offline positive/adversarial regression tests, an exported API/mock-fixture contract for integrator K, and `docs/plans/promoted-npc-memory/closure-handoffs/AGENT-G.md` with exact final SHA, true test commands/results, integration edits K must make and remaining blockers. Push dedicated PR and do not merge.

**Ownership:** `lsa-shared-brain/src/memory/m6Coordinator.mjs`, `selection.mjs`, `consolidation.mjs`, new deterministic cursor consumer and tests. P2 foundation/store (B), bootstrap and `integrationPorts.mjs` (K) are read-only.

Finish a source-qualified deterministic auto-selection coordinator with verified P2 scopes and durable checkpoints on scene-close, idle, restart and resume. Consume committed M2/M3 journal pages via B's cursor API, not only latest 1,000 rows. Crash between candidate read, permanent-memory save, queue enqueue, and cursor advance must never silently lose candidates; use idempotent source hashes, acknowledgments and bounded replay. Score memorable GTA incidents, embarrassment, jokes, relationships and ordinary high-salience moments without inventing entities/outcomes. ~6/hour remains soft, explicit M5 pinned memories never compete. Group scenes and de-duplicate with immutable source IDs; no Luna required.

Tests: 2,500 source rows and restart, crash at every commit boundary, multiple owners/protagonists, forgotten/corrected evidence, false PS2 witness exclusion, exceptionally funny high-volume hour, timeline switch, cloud outage, queue insertion retry. Provide K exact `onSceneClose/onIdle/recover` hooks, scheduling/priority requirements and cursor schema expectations.
