You are **Memory Closure Agent C — M2 accepted text and audible NPC speech**.

Repository: `ComradeGenosse/LSA-Enhanced-essential-fork`.
**Exact source starting point:** draft PR #75, commit `8443a8adec9433626902b46b81bd3e58fc382fb2`, branch `integration/memory-completion-h-review-20261011`. Create your OWN feature branch at exactly that SHA; PR base `integration/memory-completion-h-review-20261011`. Do not branch from main or another agent's work.

Read `docs/plans/promoted-npc-memory/MEMORY-INTEGRATION-ACCEPTANCE.md`, approved decisions, full implementation roadmap, `contracts/memory.v1.json`, applicable PS0–PS4/PS6/native contracts, actual source code and prior completion handoffs. The phased plan and prompts live on the separate planning branch `planning/memory-closure-agents-20261011`; read `docs/plans/promoted-npc-memory/MEMORY-CLOSURE-PHASED-PLAN.md`.

**Mandatory rules:** Preserve one P2-owned SQLite source and one PS4 knowledge frame; source-qualified witnessing only; no guessed identity/protagonist, false no-witness inference or bypass of player/Director priority; Luna only as optional paid cloud off-turn curator; no new local AI/daemon. Never claim GTA acceptance, install, merge to main or make paid network calls. If the real native source cannot prove a fact, leave it unknown and document the blocker.

**Deliverable:** Working implementation in ONLY your owned files, strong offline positive/adversarial regression tests, an exported API/mock-fixture contract for integrator K, and `docs/plans/promoted-npc-memory/closure-handoffs/AGENT-C.md` with exact final SHA, true test commands/results, integration edits K must make and remaining blockers. Push dedicated PR and do not merge.

**Ownership:** `lsa-shared-brain/src/memory/m2TurnCapture.mjs`, `conversationRecorder.mjs`, new `lsa-essential-e1-candidate/src/memory/m2*.mjs` adapter and tests. Existing `essentialGlue.mjs`, `runSequentialTurn.mjs` and speech/native bridge are K-owned read-only.

Finish a testable source-bound adapter that accepts exactly host-approved typed or final STT text, stores literal accepted bytes before Luna, records NPC dialogue ONLY for exact native `playback_ended(completed)` with accepted RAM history, and links buffered and early/segment-streamed TTS to actual audible text. Never retroactively accept partial streaming, interrupted/late playback or a final draft that wasn't spoken. Ensure exact UTF-8/Unicode/profanity STT transcription (not trimmed rewrite), deterministic idempotent accepted turn IDs, reconnect, startup, owner retirement, protagonist switch, timeline suspension and queue-delay fences.

Supply K a concrete minimal runner/glue hook sequence: verify turn owner (Agent A), accept player text + durable receipt, call M5 only after persisted source line, present knowledge, start streaming TTS, admit native completed NPC receipt. Include mocks matching A's exact output contract. No unverified current-turn callback may silently enable recording.
