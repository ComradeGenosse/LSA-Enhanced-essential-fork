# AGENTS.md addition (historical proposal)

**Adopted** in root `AGENTS.md` by the X7/P2 integration PR (a shorter, current version). The root `AGENTS.md` is authoritative; the text below is retained as the original proposal.

## PC collaboration and GTA ownership

Read `docs/agent-operations/GTA-CONTROLLER-RUNBOOK.md` and the latest acknowledged handoff before GTA-related work. Use separate branches/worktrees for offline coding. Do not modify another operator's active checkout, command slots, deployment directories, installed assets or desktop session.

One named live operator owns GTA input/deploy/restore; one named publisher owns integration. Use the Windows host P2 controller after coordinated stopped-game adoption. Never use legacy raw-command writers in a P2 session. Ownership expiry or process death does not authorize takeover. Preserve and reconcile unresolved requests/jobs; never retry a timed-out side effect automatically.

Bind every trial to candidate and loaded runtime identity, session/experiment/trial/request IDs and exact evidence manifests. Keep command completion, physical acceptance, world restoration and filesystem restoration as separate verdicts. Generate evidence tables from structured records and preserve failed/missing cases. Review loaded identity after every script reload, including reloads under the same game PID.

Do not install/reload/deploy while another operator owns a live game session. End that session and acknowledge a written handoff before adopting new runtime/controller code. Require a stopped-game gate and write-ahead, hash-fenced rollback for installation mutations. No automatic merge, deployment, launch or desktop takeover.
