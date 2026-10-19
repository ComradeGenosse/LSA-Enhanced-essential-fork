# ASTRA-002 — General-purpose AI Game Master for GTA V Enhanced (research dossier)

> **Status: research only, 2026-10-19.** No gameplay was implemented, no production code was changed, no GTA process was run, nothing was merged into `main`. The AI Game Master is abbreviated **AGM** throughout, because "GM0–GM6" already names the F11 Gameplay Menu work in this repository.

| Pin | Value |
| --- | --- |
| Branch | `research/astra-002-ai-game-master-20261019` |
| Based on | `research/next-gen-gameplay-experiences-20261018` @ `09c0df2960e84ceff37ac8a1e79765959b65cc00` |
| Latest `main` audited (read-only, not merged) | `cd6bb4e80a7d6537344ac66b7fd61b58e66f26ca` — its only commit beyond the merge-base `c390840aba02f6e20480421f5a2a9872772890fc` touches none of the files cited here |
| ASTRA-001 | [`../astra-001/`](../astra-001/) unchanged |

## The answer in three sentences

LSA can already *see* most of what a Game Master must verify but cannot yet *make* scene events happen: nothing beyond companion outings composes from today's verified capabilities. The recommended architecture — a **Grounded Experience Algebra** of observable fluents, actor policies and staged rules, validated by deterministic critics and an abstract twin, executed by a narrowly authorised Stage Executor and judged only by world evidence — produced mechanically novel, verifiable, adaptable experiences in offline experiments. Whether it works in GTA hinges first on one platform question: can LSA-owned scene actors keep their tasks next to Essential and GTA's AI (experiment E0.2/E0.6)?

## Reading order

1. [EXECUTIVE-VERDICT.md](EXECUTIVE-VERDICT.md) — the ten decision questions answered.
2. [01-current-lsa-capability-audit.md](01-current-lsa-capability-audit.md) — source-level audit with exact paths, capability matrix mapped to #20/#23/#3/#6/#72, unverified assumptions.
3. [02-external-research-and-evidence.md](02-external-research-and-evidence.md) — 60 sources classed by evidence type and read depth; licences; transfer analysis; design rules.
4. [03-architecture-candidates.md](03-architecture-candidates.md) — architectures A–H with diagrams; recommended F, strongest alternative B; fundamental failure modes.
5. [04-gameplay-generation-execution-contract.md](04-gameplay-generation-execution-contract.md) — lifecycle, ExperienceSpec IR, authority map, objective evidence, stage leasing, adaptation, persistence, consent, budgets; proposed D-024/D-025 and C-16…C-20.
6. [05-falsifiable-experiment-ladder.md](05-falsifiable-experiment-ladder.md) — E0–E8 with hypotheses, acceptance, negative controls and disconfirmation; offline X-1…X-6 results.
7. [06-breakthrough-questions-and-roadmap.md](06-breakthrough-questions-and-roadmap.md) — ranked research questions, BQ-1…BQ-10 answered, roadmap, engineering vs research split, preserved failed hypotheses, owner questions.
8. [offline-experiments/](offline-experiments/README.md) — self-contained Python (stdlib) prototypes and results, with a revision log.

## Evidence labels used across the dossier

* **LSA capability tiers:** A observed in GTA through LSA · B production LSA source on `main` · C native DB / RPH SDK member only · D Essential internal · X unavailable or blocked.
* **External sources:** PUB · PRE · POS · PROD · MOD · OSS · CLAIM, with read depth F / A / S (doc 02 §0).
* **Contract clauses:** [EXISTING] · [PROPOSED] · [UNVERIFIED] · [OWNER] (doc 04).
* **Offline results** are statements about an abstract model with synthetic players; they are never GTA acceptance.
