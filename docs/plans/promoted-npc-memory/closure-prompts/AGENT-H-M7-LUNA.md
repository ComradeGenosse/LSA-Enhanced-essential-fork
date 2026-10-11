You are **Memory Closure Agent H — M7 consented Luna off-turn curation**.

Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`.
**Exact source starting point:** draft PR #75, commit `8443a8adec9433626902b46b81bd3e58fc382fb2`, branch `integration/memory-completion-h-review-20261011`. Create your OWN feature branch at exactly that SHA; PR base `integration/memory-completion-h-review-20261011`. Do not branch from main or another agent's work.

Read `docs/plans/promoted-npc-memory/MEMORY-INTEGRATION-ACCEPTANCE.md`, approved decisions, full implementation roadmap, `contracts/memory.v1.json`, applicable PS0–PS4/PS6/native contracts, actual source code and prior completion handoffs. The phased plan and prompts live on the separate planning branch `planning/memory-closure-agents-20261011`; read `docs/plans/promoted-npc-memory/MEMORY-CLOSURE-PHASED-PLAN.md`.

**Mandatory rules:** Preserve one P2-owned SQLite source and one PS4 knowledge frame; source-qualified witnessing only; no guessed identity/protagonist, false no-witness inference or bypass of player/Director priority; Luna only as optional paid cloud off-turn curator; no new local AI/daemon. Never claim GTA acceptance, install, merge to main or make paid network calls. If the real native source cannot prove a fact, leave it unknown and document the blocker.

**Deliverable:** Working implementation in ONLY your owned files, strong offline positive/adversarial regression tests, an exported API/mock-fixture contract for integrator K, and `docs/plans/promoted-npc-memory/closure-handoffs/AGENT-H.md` with exact final SHA, true test commands/results, integration edits K must make and remaining blockers. Push dedicated PR and do not merge.

**Ownership:** `lsa-shared-brain/src/memory/idleCurationScheduler.mjs`, `lunaCurator.mjs`, `lsa-essential-e1-candidate/src/memory/lunaCurationBridge.mjs`, new bounded consent config validator and tests. B owns existing SQL/curation migrations; K owns central config/bootstrap; do not edit `curationSqlite.mjs` concurrently—handoff any needed DB change as a contract.

Finish dormant-by-default opt-in M7 scheduler using existing Essential Luna cloud transport only, with **no paid calls in tests**. Implement exact user consent/mode off|shadow|experimental, authenticated native idle and character selection, cancellation on mic activity, session/owner/epoch/timeline changes, durable queue claim/lease/retry/dead-letter + crash recovery, per-day/month durable reservation/settlement/spending caps, Retry-After, provider timeouts, evidence-preserving appraisals and safe opinion/fact separation. Prevent overlapping concurrent batches, unbounded timers and spillover into live turns.

Test mock provider delayed completion after cancellation, stale-lease double claim, reboot with expired reservations, budget exhaustion/reconciliation, failed provider followed by offline deterministic M6 recall, cost uncertainty, and no cloud calls in off/shadow. Specify idle and cost-config source APIs K must connect; do not start a scheduler inside the module on import.
