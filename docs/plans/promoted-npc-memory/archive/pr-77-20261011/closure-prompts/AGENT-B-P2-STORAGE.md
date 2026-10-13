You are **Memory Closure Agent B — P2 SQLite writer, replay and privacy**.

Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`.
**Exact source starting point:** draft PR #75, commit `8443a8adec9433626902b46b81bd3e58fc382fb2`, branch `integration/memory-completion-h-review-20261011`. Create your OWN feature branch at exactly that SHA; PR base `integration/memory-completion-h-review-20261011`. Do not branch from main or another agent's work.

Read `docs/plans/promoted-npc-memory/MEMORY-INTEGRATION-ACCEPTANCE.md`, approved decisions, full implementation roadmap, `contracts/memory.v1.json`, applicable PS0–PS4/PS6/native contracts, actual source code and prior completion handoffs. The phased plan and prompts live on the separate planning branch `planning/memory-closure-agents-20261011`; read `docs/plans/promoted-npc-memory/MEMORY-CLOSURE-PHASED-PLAN.md`.

**Mandatory rules:** Preserve one P2-owned SQLite source and one PS4 knowledge frame; source-qualified witnessing only; no guessed identity/protagonist, false no-witness inference or bypass of player/Director priority; Luna only as optional paid cloud off-turn curator; no new local AI/daemon. Never claim GTA acceptance, install, merge to main or make paid network calls. If the real native source cannot prove a fact, leave it unknown and document the blocker.

**Deliverable:** Working implementation in ONLY your owned files, strong offline positive/adversarial regression tests, an exported API/mock-fixture contract for integrator K, and `docs/plans/promoted-npc-memory/closure-handoffs/AGENT-B.md` with exact final SHA, true test commands/results, integration edits K must make and remaining blockers. Push dedicated PR and do not merge.

**Ownership:** `lsa-shared-brain/src/characters/sqliteFoundation.mjs`, `sqliteProfileStore.mjs`, `src/memory/m5SqlitePrivacy.mjs`, your new migration/cursor helpers, and DB tests. Do not touch `integrationPorts.mjs`, Essential runtime/editor, or C/D/E/F/G-owned modules.

Unify durable memory writes under the existing P2 serialized transaction/queue, fixing any mutable second-connection use by M5 (risk of lock/deadlock, inconsistent transaction or bypass). Preserve legacy profile editor CRUD, backup/migrate/reopen/rollback parity. Add bounded, resumable, durable cursor/page APIs for M6 to read all committed dialogue/event evidence, support idempotent replay after crash and avoid the fixed 1,000-row silent cutoff. Expose owner/timeline/scope-fenced M5 `clarification/trash/restore/purge/export` transaction ports while retaining seven-day suppression and irreversible authorized purge. Ensure corrections/tombstones/derived memories/queued curations cannot reappear after forget. Coordinate typed interfaces via fixtures with F/G/H without editing their modules.

Tests: concurrent pending writers, nested transactions, SQLite busy/reopen, expired lease/purge, character removal, cross-protagonist/timeline leaks, 2,000+ rows, write revocation at commit, corruption detection and migration rejection. Document schema `user_version` implications. No new file-based memory database.
