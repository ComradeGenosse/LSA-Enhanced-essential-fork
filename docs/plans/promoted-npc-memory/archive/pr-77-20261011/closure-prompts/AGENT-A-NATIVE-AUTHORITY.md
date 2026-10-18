You are **Memory Closure Agent A — Verified native memory authority**.

Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`.
**Exact source starting point:** draft PR #75, commit `8443a8adec9433626902b46b81bd3e58fc382fb2`, branch `integration/memory-completion-h-review-20261011`. Create your OWN feature branch at exactly that SHA; PR base `integration/memory-completion-h-review-20261011`. Do not branch from main or another agent's work.

Read `docs/plans/promoted-npc-memory/MEMORY-INTEGRATION-ACCEPTANCE.md`, approved decisions, full implementation roadmap, `contracts/memory.v1.json`, applicable PS0–PS4/PS6/native contracts, actual source code and prior completion handoffs. The phased plan and prompts live on the separate planning branch `planning/memory-closure-agents-20261011`; read `docs/plans/promoted-npc-memory/MEMORY-CLOSURE-PHASED-PLAN.md`.

**Mandatory rules:** Preserve one P2-owned SQLite source and one PS4 knowledge frame; source-qualified witnessing only; no guessed identity/protagonist, false no-witness inference or bypass of player/Director priority; Luna only as optional paid cloud off-turn curator; no new local AI/daemon. Never claim GTA acceptance, install, merge to main or make paid network calls. If the real native source cannot prove a fact, leave it unknown and document the blocker.

**Deliverable:** Working implementation in ONLY your owned files, strong offline positive/adversarial regression tests, an exported API/mock-fixture contract for integrator K, and `docs/plans/promoted-npc-memory/closure-handoffs/AGENT-A.md` with exact final SHA, true test commands/results, integration edits K must make and remaining blockers. Push dedicated PR and do not merge.

**Ownership:** new native owner/host proof components under `native/promoted-characters/` and `native/intelligence/` excluding `m9/`; a new Essential `src/memory/nativeMemoryAuthority.mjs` and dedicated native/JS tests. K owns existing global native registration, `IntelligenceIntegration.cs`, `IntelligenceChannel.cs`, `HostContext.cs`, `bootstrap.mjs`.

Implement a *real*, pinned-native-compatible proof source for `memoryNativeAuthority.verifyCurrentTurn`, `resolveNativeOwner`, `resolveParticipants`, and native coverage/prepromotion only when receipts truly exist. Check CharacterId, ownerAlias, current owner/observer index, run+epoch, incarnation, encounter, ped lifecycle, turn generation/sessionNonce and protagonist C-01 source; publish exact synchronous immutable result types (or a fail-closed cached ledger backed by authenticated native updates). `nativeVerified:true` must be emitted ONLY after verification; a JS mock or caller flag must never grant authority. Keep compatibility and native channel thin; no extra native autonomous memory engine.

Regression tests: ped handle reuse, stale world epoch, reconnect, owner retirement, two characters same scene, protagonist switch, save rollback, forged/late observer receipt, no-cert negative, prepromotion promotion grace. Do not invent game API signals; list unsupported outcomes explicitly. Provide K exact minimal global-registration patch. This is the gating substrate for C and D.
