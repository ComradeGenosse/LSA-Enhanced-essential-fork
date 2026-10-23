# Agent guidance for this repository

## Mandatory startup on this experimental branch

Before working (including after context compaction), check the current checkout, remote PR head, branch dependencies and approved operator handoff. Read [docs/agent-operations/OPERATING-STANDARD.md](docs/agent-operations/OPERATING-STANDARD.md); before PC/GTA work also read [docs/agent-operations/GTA-PC-PLAYBOOK.md](docs/agent-operations/GTA-PC-PLAYBOOK.md) **and** the existing detailed `docs/agent-operations/GTA-CONTROLLER-RUNBOOK.md`. For recurring lessons and stale-PR traps see `docs/agent-operations/PR-LESSONS-20261023.md`.

Prefer read-only terminal/API/native commands over unnecessary GUI clicking; check GPU power limit without reapplying an Afterburner preset; use only approved, hash-restored DLSS addon renames when necessary. Neither these instructions nor a handoff grant new permission to deploy or use the live game. Existing P2 ownership/single-operator restrictions **remain authoritative**. The experimental branch already contains P2; do not replace it with legacy command files. Verify command/gameplay/world/filesystem outcomes separately.

## Local CLI collaboration

Read `tools/agent-coordinator/README.md` for the persistent Windows queue and
JSON handoffs. In the documented CLI-queue prototype, Codex owned host execution/build/deployment/GitHub/GTA and Claude owned design/review; the current named-operator handoff assigns roles for each real session. Use separate
registered worktrees. Queue ownership never overrides the GTA P2 controller.
Bound handoff chains to two hops; preserve UNKNOWN outcomes for reconciliation.
Never attach a CLI to an assumed Desktop/Cowork conversation or bypass approvals.

For any question or change involving current architecture, implementation state, merge state, deployment state, or next work:

1. Read `docs/ROADMAP.md`.
2. Read `docs/research/CURRENT.md`.
3. Use `docs/research/DECISIONS.md` and `docs/research/system-contract-register.md` for architectural authority.
4. Use the relevant current phase/status document for acceptance details.

## Historical research

**Do not use `docs/research/archive/` as current implementation guidance or as the source of truth for branch/deployment state.**

Archived material is provenance only and may contain fixed bugs, superseded plans, old SHAs, old test totals, or ownership models that were deliberately changed.

If an active document and archived research disagree, the active document wins unless new evidence explicitly reopens the decision.

Do not infer that a researched or planned feature is implemented, merged, deployed, enabled, or GTA-validated.

## PC collaboration and GTA experiments

Before any GTA, PC-testing or controller work (including after context compaction or in a new session), read `docs/agent-operations/GTA-CONTROLLER-RUNBOOK.md` and the latest acknowledged handoff (template: `docs/agent-operations/2026-10-22/agent-test-handoff.template.json`). Re-check live facts; a handoff file is a pointer, not authority.

- **One command path.** GTA experiments are commanded only through `tools/gta-controller/controller.py` (P2 protocol), run by the single named Windows/GTA operator. Never write `command.txt`/`request.txt`, use the retired `x7cmd.py` or legacy senders, hot-redeploy, or run historical installers against a P2 session. Do not mix old and new protocols.
- **Ownership.** One named live operator owns GTA input, deployment, shutdown and restoration; one named publisher owns integration. Each parallel agent uses its own branch and worktree and never touches another agent's checkout, command slots, deployment directories or desktop session. Lock expiry or process death is not permission to take over.
- **Timeouts and retries.** A timeout is UNKNOWN: reconcile with the same owner/session; never resend, abort or restore through a second writer.
- **Verdicts.** Keep command completion, gameplay acceptance, world restoration (exactly 9/9 witnesses) and filesystem restoration (hash check after GTA stops) separate; command success is never gameplay success. Bind every trial to candidate and loaded runtime identity plus session/experiment/trial/request IDs; generate evidence tables from structured records and keep failed cases.
- **Stopped-game gate.** Install, reload or roll back only with GTA stopped, a written handoff and hash-verified rollback. No automatic merge, deployment, launch or desktop takeover.
- **Cowork limits.** Cowork can read/edit files and prepare requests but cannot type into terminals (click-only) and has a Linux shell, so it cannot run the Windows controller itself. Do not work around approval prompts or product restrictions; hand the exact command to the named operator.
