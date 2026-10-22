# Offline validation receipt — PC controller candidate

Base: Astra audit `ddca5fb8f22368a4e7ee177fdef3f68ffb6e17f9`, branch `docs/pc-agent-testing-review`.
Implementation branch: `infra/pc-protocol-offline-20261022`, separate worktree `pc-protocol-offline`.
Validated October 22, 2026 on Windows with Python 3.10 and .NET SDK 10.0.301. No GTA process, desktop, command slot, deployment directory or installed game file was operated on. Test runtime writes were confined to temporary directories. Git transport/PR publication are the only online steps; tests use no network and the C# harness clears package sources.

- `python -m unittest discover -s tools/gta-controller -p test_controller.py -v`: **16 tests pass**. Includes real competing Windows process lock rejection and killed-holder lock release, session takeover rejection, wrong request/correlation/runtime IDs, stale heartbeat/SHA and same-PID reload, stopped frames, runtime error CLI exit 2, timeout/restart without replay, partial response, interrupted publication, changed-runtime abandonment gates, write-ahead rename interruption/undo/hash conflicts, exact evidence collection and durable failed-job exit receipt.
- `python tools/gta-controller/test_runtime_offline.py`: **16 scenarios pass**, build with zero warnings/errors. Extracts actual C# `AcceptRequest`, `IsToken`, `Respond`, `AtomicText`, `OnTick` and `Row`; stubs GTA/dispatch/native dependencies. Covers success, duplicate, exception, abort, five error-row kinds, expiry, reload, SHA/fence mismatch, partial request, interrupted claim and legacy rejection.
- `python tools/gta-controller/evidence_table.py --check`: **all eight structured Phase 2 records match** the corrected source report, including failed and unrecorded walks.
- `git diff --check`: pass.

Remaining: complete SHVDN compilation/native runtime and X7.2c coexistence, gameplay/9-of-9 physical restoration, a real ownership transfer, live timeout/reload rehearsal, Cowork mount locking (unsupported: use one Windows host controller), and filesystem behavior under actual power loss. The rename journal primitives are implemented/tested but not wired into historical installers; those installers must not be used live. See [adoption runbook](../GTA-CONTROLLER-RUNBOOK.md).

Review/adoption handoff: Claude should read the corrected X7.2b report, the adoption runbook, and `AGENTS.proposed.md`; reconcile its latest X7.2c driver changes with the P2 adapter rather than replacing the driver. Current GTA must end before any deployment/runtime adoption. No merge, install, launch or reload was performed.
