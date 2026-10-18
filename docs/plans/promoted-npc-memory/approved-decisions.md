# Accepted PS5 promoted-NPC memory decisions

**Approved direction — October 11, 2026.** This is the implementation-facing decision record for the proposed memory project. [The full architecture study](architecture-study-20261011.md) is preserved for analysis and evidence; **where its local-model / memory-budget suggestions differ from this document, this record prevails**. This PR is documentation only; it does not deploy PS5, change the current native owner, or certify GTA acceptance.

## Eight product / architecture choices

| # | Choice | Accepted policy |
| --- | --- | --- |
| 1 | Recall personality | **Natural, in-character spontaneous recall plus accurate on-demand retrieval.** A promoted NPC does not automatically recite everything it has logged. On a direct factual / quote request, retrieval is evidence-first and must reproduce retained details faithfully. Personality changes selection and expression, **not source records**. |
| 2 | Storage | **One P2-owned SQLite file** for profiles, journal, memories, interpretations and queues; transactional migration from existing profile JSON with backup, rollback and editor parity. FTS5 and structured SQL search initially. No independent memory database or daemon. |
| 3 | Curator intelligence | **Use the existing cloud Luna provider by default** for asynchronous humor/notability appraisal, consolidation, personality interpretations and grounded summaries. **No newly hosted local LLM, embedding model, GPU curator, or VRAM reservation is required.** Use deterministic curation and retry queues when Luna is unavailable. Optional alternate providers are future opt-ins, not project dependencies. |
| 4 | Player identity | **Superseded on 2026-10-12 by [D-021](../../research/DECISIONS.md) (one human across avatars; avatar kept as provenance only).** Original text, kept for provenance: **Keep Franklin, Michael and Trevor separate when reliably identifiable.** Preserve observed speaker/protagonist evidence in SubjectRef; unknown identity must remain unknown rather than silently merge incompatible personas. A migration-safe interim unknown/legacy key is acceptable until detection is verified. |
| 5 | Save/load timeline | **Prompt for confirmation** after a suspected save/clock rollback or ambiguous timeline. Suspend automatic timeline-scoped memory writes until the correct timeline is chosen; never silently blend or delete diverging futures. Use C-07 TimelineGuard / C-15 SubjectRef. |
| 6 | Verbatim dialogue archive | **Generous, effectively indefinite archive by default** while the user retains the character, with explicit deletion/export and bounded quotas / pruning policy under user control. Maintain a high-fidelity free-recall window (at least the last 200 player utterances or current + previous session, subject to documented safety caps). Don't expire old archived quotes merely because 60 wall-clock days elapsed. Archived lines need a retrieval cue, not unsolicited play-by-play. |
| 7 | Architecture amendments | **Approve D-018, D-019 and revised D-020 plus PS4/C-04 typed recall contribution.** D-018 permits verbatim dialogue as character game-state, not telemetry. D-019 uses P2-owned SQLite/FTS5; vector data and embedding inference are **optional future optimizations**, not mandatory or GPU-backed. D-020 specifies off-turn **Luna-first** curation (not local-first), evidence-grounded and never an authoritative world-event producer. |
| 8 | Promotion grace | **On**: optionally import up to two minutes of qualified observations and attached conversation from the *same physical NPC being promoted*, only when witness, lifetime and identity proofs succeed. No previous unrelated ped history, no guesswork. |

## Additional confirmed experience requirements

- **Scope:** only promoted NPCs own persistent memories. Ambient NPCs are subjects or evidence sources, not memory owners.
- **Fun first:** humor, bizarre GTA events, inside jokes, embarrassing mistakes, shared adventures, personality-driven beliefs, grudges and relationship callbacks matter. Avoid sterile, purely danger-based notability.
- **Capture everything recently:** journal every qualified, attributed PS2 observation and every accepted player utterance to the promoted character, even if boring. Do not require a notability threshold for recent memory.
- **Verbatim text:** preserve actual committed input text exactly, regardless of profanity, offensive/mature themes or fictional GTA actions. STT transcripts are recorded as transcribed with provenance and uncertainty, not magically guaranteed identical to acoustic speech; correction creates linked provenance.
- **Exact recall boundary:** deterministic retrieval of a known, unambiguous, retained utterance should be **100% byte-accurate** in tests. The NPC's probabilistic Luna response is separately measured; never promise a model output is mathematically perfect. If perception missed something, the NPC must say it did not witness/does not know.
- **Explicit remember/forget:** player-directed memory requests bypass automatic notability/budget competition. Resolve demonstratives using verified recent context or ask. Only say "remembered" after durable write; corrections, forget, inspect, backup and export are supported.
- **Automatic notability is a soft budget:** tune around six interesting episodic memories per active hour, but allow exceptional clusters to exceed it; fold duplicates and repetitive jokes together. Explicit player-requested saves are not crowded out.
- **Capture first, appraise later:** PS2 evidence and dialogue are written independently of Luna, and a missing/slow/rate-limited curator must **never cause source facts to be discarded** or stall normal conversations. A durable queue replays unfinished curation after restart.
- **Low latency, zero curator VRAM:** curation runs in bounded, opt-in-cost cloud batches when scenes/conversations close or on periodic idle checkpoints; never require a resident new local model. CPU SQLite FTS5, entity/time/recency matching first; optional semantic features must be justified by recall measurements.
- **On-demand and fun retrieval are separate:** accurate question answers have priority over spontaneous jokes; recall callbacks obey PS6 Director player-priority, safety and fatigue budgets.
- **No invented observations:** immutable evidence and character-specific interpretations remain separate; do not claim player utterances are GTA-verified world facts.
- **Standalone future:** memory runs in a host-agnostic companion package, not on a GTA game fiber. Do not silently rewrite currently locked D-001 / D-016 native ownership; coordinate host replacement authority in its separate migration.

## Existing architectural authority and document precedence

Retain D-002, D-003, D-004, D-007, D-008, D-011, D-016 and current C-01/C-03/C-04/C-07/C-08/C-15 lifecycle rules. D-018–D-020 are **newly proposed project decisions** in this PR; merging documentation adopts the design but does not imply those contracts or implementations already exist. Changes to a previously LOCKED executor/lifecycle decision require a separate architecture review.

The historic report's suggestions to install a 7–14B local curator, serve local embeddings, mandate vector scoring on the turn path, enforce a hard six-per-hour cap, or delete dialogue after 60 days are **superseded** by this accepted design. The research remains intact so implementers can trace why alternatives were considered.

## Amendments and open owner decisions (2026-10-12)

Recorded by the [Memory K production implementation plan](MEMORY-K-PRODUCTION-IMPLEMENTATION-PLAN-20261012.md) in response to the [independent audit](MEMORY-K-INDEPENDENT-AUDIT-20261012.md). The eight choices above stay normative except where an amendment says otherwise.

| Ref | Status | Record |
| --- | --- | --- |
| [D-021](../../research/DECISIONS.md) | Settled | One human player across avatars. Supersedes choice #4. Avatar is immutable source provenance, never a memory partition key. |
| [D-022](../../research/DECISIONS.md) | Settled | Accepted player line = input exactly as committed at `commitPlayerInput` (study §3.3). Restores the original definition that PR #97 had escalated. |
| [D-023](../../research/DECISIONS.md) | Settled | M3 attribution is the observation-time join of study §3.1; a native source-time ledger is optional corroboration. |
| O-1 | **Open — owner decision** | Choice #3 says Luna curation runs **by default**. The implementation (PR #97 lineage) ships it **off by default behind persisted consent**, so no memory content reaches the cloud curator without an explicit opt-in. Until the owner decides, the conservative default stays and the deterministic M6 path must be complete without Luna; enabling consent must be a single in-product action. |
| O-2 | **Open — owner decision** | D03 corroborates the native owner **before** the model request (G1 ordering), adding on average about one 250 ms native sample period of latency, bounded to one shared budget. The alternative (corroborate after the request) would weaken G1. Default: keep G1. |

