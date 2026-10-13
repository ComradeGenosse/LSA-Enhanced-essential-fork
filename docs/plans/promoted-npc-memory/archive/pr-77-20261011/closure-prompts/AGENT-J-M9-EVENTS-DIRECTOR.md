You are **Memory Closure Agent J — M9 GTA events and PS6 Director callbacks**.

Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`.
**Exact source starting point:** draft PR #75, commit `8443a8adec9433626902b46b81bd3e58fc382fb2`, branch `integration/memory-completion-h-review-20261011`. Create your OWN feature branch at exactly that SHA; PR base `integration/memory-completion-h-review-20261011`. Do not branch from main or another agent's work.

Read `docs/plans/promoted-npc-memory/MEMORY-INTEGRATION-ACCEPTANCE.md`, approved decisions, full implementation roadmap, `contracts/memory.v1.json`, applicable PS0–PS4/PS6/native contracts, actual source code and prior completion handoffs. The phased plan and prompts live on the separate planning branch `planning/memory-closure-agents-20261011`; read `docs/plans/promoted-npc-memory/MEMORY-CLOSURE-PHASED-PLAN.md`.

**Mandatory rules:** Preserve one P2-owned SQLite source and one PS4 knowledge frame; source-qualified witnessing only; no guessed identity/protagonist, false no-witness inference or bypass of player/Director priority; Luna only as optional paid cloud off-turn curator; no new local AI/daemon. Never claim GTA acceptance, install, merge to main or make paid network calls. If the real native source cannot prove a fact, leave it unknown and document the blocker.

**Deliverable:** Working implementation in ONLY your owned files, strong offline positive/adversarial regression tests, an exported API/mock-fixture contract for integrator K, and `docs/plans/promoted-npc-memory/closure-handoffs/AGENT-J.md` with exact final SHA, true test commands/results, integration edits K must make and remaining blockers. Push dedicated PR and do not merge.

**Ownership:** `lsa-shared-brain/src/events/m9EventProducers.mjs`, `m9MemoryCues.mjs`, `native/intelligence/m9/**`, `native/intelligence/m9-tests/**`, new PS6 memory-cue admission adapter, tests. A owns other native authority code; K owns global native registration, `sceneDirectorOrchestrator.mjs`, bootstrap and `IntelligenceIntegration.cs`.

Go beyond classifiers: implement pinned-compatible native source producers/adapters wherever supported for collisions/vehicle damage, high-speed significant crashes, rollover, airborne stunts, water mishaps, wanted-level changes, Wasted/Busted terminal outcomes. Events need stable IDs, dedupe/order, bounded capture windows, epoch/lifecycle fences and direct proof when available; missing native proof remains unknown. Send typed candidates into existing PS2 observation qualification and ONLY after M3 witness evidence into memory. Callback cues must use existing PS6 Director original-turn authorization/C-06, per-NPC cooldown >=10min, combat and mic/typed player priority, no speculative NPC awareness and no bypass of stock actions.

Tests with native stubs + JS: collisions without impact proof, unrelated spectator at crash, two NPCs, missing protagonist, restart, repeated wanted changes, interrupted sound, player talking/combat, Director lease refused, cooldown repeated cue. Provide exact minimal native registration/PS2/PS6 wiring recipe for K; do not claim a game-native API is supported without source/build proof.
