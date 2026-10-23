# Agent guidance for this repository

## Mandatory agent startup (including context resets)

**First establish the actual checkout/branch and latest remote HEAD.** Never infer that a PR comment, older handoff, archived plan, or a previous assistant message describes current source or deployment.

For every new agent session or after context compaction, **read [docs/agent-operations/OPERATING-STANDARD.md](docs/agent-operations/OPERATING-STANDARD.md)** before working. If doing GTA/PC testing, deployment, diagnostics, or graphics configuration, also read [docs/agent-operations/GTA-PC-PLAYBOOK.md](docs/agent-operations/GTA-PC-PLAYBOOK.md). Before declaring a milestone done, check the precise trial's raw evidence and [docs/agent-operations/PR-LESSONS-20261023.md](docs/agent-operations/PR-LESSONS-20261023.md). Read only the relevant phase-specific material afterward.

**Default workflow:** use supported command/API/native interfaces and read-only inspections first; minimize GUI automation. Do not click around menus when the configured setting can be verified, when a safe CLI/native command is available, or when a file-backed addon can be temporarily disabled reversibly with an explicit stop/backup gate. GUI is allowed when genuinely necessary and authorized; do not try to bypass application or OS permission prompts.

**One GTA operator and one command authority.** On a branch with the P2 controller, use only its fenced `controller.py` protocol for experiment commands; no legacy command writers or second agent/desktop input during the lease. If the current checkout lacks P2, do not improvise an alternate live experiment. Require approved runtime identity, clean shutdown, hash-backed restore, and separate command/gameplay/world/filesystem verdicts. A timeout is UNKNOWN, never permission to resend. Current GTA state and explicit authorization outrank documents.

**Read-only render preflight**: [tools/operator-preflight/Test-GpuPowerLimit.ps1](tools/operator-preflight/Test-GpuPowerLimit.ps1) checks only the configured power cap against NVIDIA telemetry; it never clicks, launches, or reapplies Afterburner. It does **not** establish fan, clock, voltage or complete preset state. Do not claim anything beyond observed fields. Follow the playbook for DLSS addon handling.

**PR hygiene:** record base/head SHA, dependency chain, verified tests vs GTA outcomes, pending limitations, rollback and next safe action. Do not claim work merged because a stacked PR passed. Keep the active PR description and status fresh, and avoid shipping raw gameplay/chat/credential data.

## Architecture and historical status

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
