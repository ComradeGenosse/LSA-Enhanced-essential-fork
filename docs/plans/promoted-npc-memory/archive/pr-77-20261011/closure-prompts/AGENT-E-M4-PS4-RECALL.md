You are **Memory Closure Agent E — M4 memory recall in sole PS4 frame**.

Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`.
**Exact source starting point:** draft PR #75, commit `8443a8adec9433626902b46b81bd3e58fc382fb2`, branch `integration/memory-completion-h-review-20261011`. Create your OWN feature branch at exactly that SHA; PR base `integration/memory-completion-h-review-20261011`. Do not branch from main or another agent's work.

Read `docs/plans/promoted-npc-memory/MEMORY-INTEGRATION-ACCEPTANCE.md`, approved decisions, full implementation roadmap, `contracts/memory.v1.json`, applicable PS0–PS4/PS6/native contracts, actual source code and prior completion handoffs. The phased plan and prompts live on the separate planning branch `planning/memory-closure-agents-20261011`; read `docs/plans/promoted-npc-memory/MEMORY-CLOSURE-PHASED-PLAN.md`.

**Mandatory rules:** Preserve one P2-owned SQLite source and one PS4 knowledge frame; source-qualified witnessing only; no guessed identity/protagonist, false no-witness inference or bypass of player/Director priority; Luna only as optional paid cloud off-turn curator; no new local AI/daemon. Never claim GTA acceptance, install, merge to main or make paid network calls. If the real native source cannot prove a fact, leave it unknown and document the blocker.

**Deliverable:** Working implementation in ONLY your owned files, strong offline positive/adversarial regression tests, an exported API/mock-fixture contract for integrator K, and `docs/plans/promoted-npc-memory/closure-handoffs/AGENT-E.md` with exact final SHA, true test commands/results, integration edits K must make and remaining blockers. Push dedicated PR and do not merge.

**Ownership:** `lsa-shared-brain/src/memory/ps4RecallContribution.mjs`, `recallEngine.mjs`, `recallSchemaV1.mjs`, and Essential `src/context/knowledgeRenderer.mjs`, `knowledgeSelector.mjs`, `knowledgeDelivery.mjs`, focused tests. No direct edits to runner/glue, source SQLite, or integration ports.

Complete a typed, production-capable M4/C-04 contributor that PS4 admits to its ONE `TurnKnowledgeFrame` with a bounded `RECALLED` lane and appropriate separately identified earlier archived conversation. No extra system messages or live history spoofing. Generate queries from verified accepted turn and deterministic source metadata, not hallucinated intent; preserve exact quote bytes (item bound 3,072 characters), archive/time/entity filtering, correction overlays, deleted derived suppression, unknown/uncertified coverage. Enforce strict `contracts/memory.v1.json`, including byte-exact `RecallBundle.totalBytes`, total frame budget and 40ms target; if late/stale, drop recall without blocking dialogue.

Tests must cover identity/epoch/protagonist change while awaiting SQLite, allocation/pruning before send and retry, no stale recall leakage, >200-turn archives, 3,072-char edge cases, no false fact on missing evidence, same quote from another NPC, and PS6 spontaneous player priority. Publish K exact runner preflight and revalidation interface.
