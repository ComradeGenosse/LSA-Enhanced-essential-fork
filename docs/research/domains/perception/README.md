# Perception / Salience / Scene Director Research

**Canonical decisions:** D-004, D-005, D-007, D-008, D-013.  
**Forward contracts:** C-01, C-02, C-03, C-04, C-11, C-12, C-13, C-14.

Read:

1. [../../CURRENT.md](../../CURRENT.md)
2. [../../system-convergence-architecture.md](../../system-convergence-architecture.md)
3. [../../../PS0-PS1-perception-status.md](../../../PS0-PS1-perception-status.md), [../../../PS2-implementation-checklist.md](../../../PS2-implementation-checklist.md), [../../../PS3-deterministic-salience-status.md](../../../PS3-deterministic-salience-status.md)
4. [../../system-contract-register.md](../../system-contract-register.md)

The long PS/Director architecture from the October 4 research branch is preserved at [archive/perception](../../archive/perception/perception-salience-scene-director-architecture-20261004.md) and is historical evidence only.

Current interpretation: facts → episodes → observer observations → PS3 salience → one PS4 knowledge assembler. Director proposes; ACT/Essential execute physical behavior.

For the current-main code trace, verified GitHub updates and exact remaining PS4 implementation, read [PS4 dialogue knowledge update — October 8, 2026](../../PS4-dialogue-knowledge-update-20261008.md). It reconciles the existing corpus against `main@7e54b17`, including the merged ACT0–ACT2 stack and the unmerged radio R5/v2 projection slice.

The [PS4 code-level implementation plan](../../PS4-code-level-implementation-plan-20261008.md) expands that update with exact integration points, C-02/C-04/C-13/C-14 phases, tests, rollout gates and GTA acceptance. It reuses the current architecture and does not implement production code.

The [unified intelligence master plan](../../UNIFIED-LSA-INTELLIGENCE-IMPLEMENTATION-PLAN-20261008.md#6-mvp-file-level-and-api-level-specification) reconciles this domain with all C-01–C-15 contracts and supplies exact integration phases/tests/gates. Baseline PS4 does not wait for optional enrichment; original research/provenance and the detailed PS4 plan remain preserved.
