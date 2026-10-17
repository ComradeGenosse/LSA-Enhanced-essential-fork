You are **Memory Closure Agent I — M8 personality, relationships and running jokes**.

Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`.
**Exact source starting point:** draft PR #75, commit `8443a8adec9433626902b46b81bd3e58fc382fb2`, branch `integration/memory-completion-h-review-20261011`. Create your OWN feature branch at exactly that SHA; PR base `integration/memory-completion-h-review-20261011`. Do not branch from main or another agent's work.

Read `docs/plans/promoted-npc-memory/MEMORY-INTEGRATION-ACCEPTANCE.md`, approved decisions, full implementation roadmap, `contracts/memory.v1.json`, applicable PS0–PS4/PS6/native contracts, actual source code and prior completion handoffs. The phased plan and prompts live on the separate planning branch `planning/memory-closure-agents-20261011`; read `docs/plans/promoted-npc-memory/MEMORY-CLOSURE-PHASED-PLAN.md`.

**Mandatory rules:** Preserve one P2-owned SQLite source and one PS4 knowledge frame; source-qualified witnessing only; no guessed identity/protagonist, false no-witness inference or bypass of player/Director priority; Luna only as optional paid cloud off-turn curator; no new local AI/daemon. Never claim GTA acceptance, install, merge to main or make paid network calls. If the real native source cannot prove a fact, leave it unknown and document the blocker.

**Deliverable:** Working implementation in ONLY your owned files, strong offline positive/adversarial regression tests, an exported API/mock-fixture contract for integrator K, and `docs/plans/promoted-npc-memory/closure-handoffs/AGENT-I.md` with exact final SHA, true test commands/results, integration edits K must make and remaining blockers. Push dedicated PR and do not merge.

**Ownership:** new `lsa-shared-brain/src/memory/m8*.mjs` interpretation, relationship/joke evaluator/selector, bounded memory projection, and tests. B owns P2 SQL, E the PS4 renderer, K shared runtime.

Implement missing M8 layer: typed, character-specific subjective interpretations (beliefs, social impressions, affinities, funny moments, embarrassment, evolving running jokes), only from *committed* M2/M3/M5/M6 evidence or grounded optional M7 appraisals. Source evidence and corrections/tombstones remain deterministic and immutable; opinions must be labeled as opinions with confidence/freshness, never rewrite observed facts, quote text, participant identities or user-approved personality canon. Support opt-in bounded humorous callbacks and joke decay/cooldowns; isolation across characters, protagonists and timelines, and no inference of witness awareness.

Tests replay the same verified fountain/crash plus quote corpus for three personalities: different subjective takes, **identical factual events**; unknown fountain/location stays unknown if only user says 'fountain'; deleted source suppresses derived joke instantly; cloud off still deterministic; no character cross-contamination. Publish B/K additive persistence API requirements and E-compatible typed projection contract, not a competing SQLite DB or Luna prompt.
