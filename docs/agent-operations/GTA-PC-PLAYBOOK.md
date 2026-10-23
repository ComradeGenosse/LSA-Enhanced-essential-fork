# GTA + Windows PC operator playbook

This is the **portable main-branch policy**. The full P2 controller and experiment-specific procedures currently live on **unmerged experimental branches**, not on `main`. Do not assume they exist in every checkout, install a legacy sender to compensate, or equate docs with live permission.

## Read-only preflight: prefer evidence to desktop clicking

| Need | First-choice interface | GUI / mutation threshold |
| --- | --- | --- |
| Current PR/head/source | GitHub/API + local Git status | No GUI needed |
| Build/test outcome | CI and native CLI logs | No GUI needed |
| GTA experiment | **single owned P2 controller** where installed | If P2 unavailable, stop and get approved branch/operator; no legacy files |
| GTA/process stop | Process/launcher state and matching PID | Launcher GUI only if necessary, then verify process absence |
| Afterburner power cap | `tools/operator-preflight/Test-GpuPowerLimit.ps1` (read-only) | Do not apply preset just to check it |
| DLSS render addon isolation (specific tested files) | Stopped-game, reversible rename and hash evidence | Do not use arbitrary keyboard/menu shortcuts |
| Native map/collision/objects | P2 audit and actual world witnesses | Visual screenshot supplemental; don't infer loaded state from packaging alone |
| Raw logs / diagnostics | ID-correlated JSONL, hash-checked ZIP, source-specific analyzer | Don't substitute screenshots for machine-readable terminal outcomes |

### Read-only Afterburner power verification

From Windows PowerShell, on a machine with `nvidia-smi.exe` and the correct saved profile:

```powershell
powershell -NoProfile -File tools/operator-preflight/Test-GpuPowerLimit.ps1 -ProfilePath 'C:\Path\To\MSI Afterburner\Profiles\YOUR_GPU.cfg' -OutFile 'C:\ApprovedEvidence\gpu-power.json'
```

The script uses Profile1 `PowerLimit` and queries current/default power limit through NVIDIA's CLI. Override `-ExpectedPercent 80` only when that expectation is explicitly approved. A PASS means only the **power limit** matches within the declared watt tolerance. It does not establish clocks, fan curves, voltage, Afterburner process state, or all Profile1 settings. Missing file/tool/telemetry is UNKNOWN or MISMATCH, never permission to click around to force a green check.

### DLSS addon isolation (verified only for the Oct 23 X8 setup)

- **First:** check whether the specific experimental addon is even active or relevant. Avoid unnecessary changes.
- If temporary isolation is needed, obtain operator approval; confirm GTA **stopped** and no P2 ownership ambiguity. Snapshot **exact path, presence and SHA-256** of `renodx-dlss.addon64` and `renodx-dlss-hotkey.addon64`; do not confuse the optional files with baseline game data.
- Rename each **existing approved file** to a unique reversible suffix (the successful X8 run used `.x8off`). Journal old and new names, pre-hashes and ownership; never overwrite a target or guess file names. Preserve an original absence as an absence.
- Launch and test through the named operator, without using GTA's F6/graphics menus or Steam minimize clicks to "disable DLSS." A renamed file is evidence of addon isolation at that path, **not** proof of the entire game's upscaler configuration.
- With GTA **stopped**, undo only journaled renames, confirm the original filenames and SHA-256 values (plus any expected absences), and include the receipt in the handoff. A failed rollback is an explicit FAIL even if gameplay succeeded.

Do not apply this to other addons, hook DLLs, NVE, or game archives without a separate safety design. If a product UI must be changed, keep GUI interaction short, traceable and explicitly authorized.

## GTA P2 session contract (only where the runtime exists)

1. Select **one named Windows host operator** and one owner/session. No Claude/Codex/Computer Use peer runs another GTA sender or changes files while that operator owns the live session.
2. Approve exact candidate, actual installed file hash, and fresh loaded identity `(pid, loadedUtc, scriptSha256)`. Check current heartbeat advances; after reload re-approve identity. Game/SHVDN code unchanged during session.
3. Take stopped-game backups, journal reversible writes, install only approved source/assets. Confirm no old pending P2 intent; do not trust process-exit or lock expiry as automatic takeover.
4. Send one action through `tools/gta-controller/controller.py` using the current branch's documented P2 syntax. Never hand-create `command.txt` or `request.txt`, run `x7cmd.py`, send UI keystrokes as experimental commands, or combine controller and desktop writers.
5. Exit DONE says command handler completed, **not** shot/hole/traversal success. For a destructive test, require genuinely sourced map objects, native model/transform/collision baseline, exactly scoped one-shot or test budget, real section witnesses and actual physical traversal. If uncertainty appears, stop.
6. After each destructive trial, verify original **9/9 collision**, verified mod-owned root/debris deletion, lease release and unaffected neighboring scene. Treat unverified newly observed ambient props as **not proven owned**; don't delete them or mark them owned merely because they appear after an explosion.
7. Stop GTA; verify PID/process absence. Restore all files/addons/third-party archives by exact hash and expected absences. Release P2 only after no pending intent, complete evidence and original-state verification.

A **timeout is UNKNOWN**. Reconcile with the *same* owner and session; don't reissue an RPG/restore or use another writer. If a failed restoration leaves the native world ambiguous, record that separately from filesystem rollback, even if restarting GTA returns the map to a normal state.

### Known tool and proof boundaries

- The P2 controller, coordinator and older [GTA-CONTROLLER-RUNBOOK](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/feature/x8-destruction-lab-20261022/docs/agent-operations/GTA-CONTROLLER-RUNBOOK.md) are currently on the **destruction development branch**; look up actual branch/head before borrowing specific commands or scripts.
- An old runbook may mention a failed X7 trial after a later commit passed it. The latest exact runtime evidence wins over dated heading text; do not silently retrofit pass results into the wrong trial.
- The CLI coordinator is a durable *handoff queue*, not a live GTA ownership lock; its Windows/NTFS isolation matters. A desktop/Cowork session is **not** automatically attached to an agent's CLI session.
- Handle reuse, debris ownership, loader readiness and world restoration require native identity evidence; comparing an object name, a successful archive read, or an IPL flag is not enough.
- Proven diagnostic approach in #310: use the **exact failing binary** through a known working loader to distinguish authored data from registration, instead of iterating uncertain DLC flags. The validated NVE-backed path was a bounded test, not an authorization to make a permanent third-party archive dependency.
- For the October 23 acceptance, `native/destruction-lab/evidence/20261023-cleanup-validation/RESULTS.md` on the experimental branch records **both fences**, two genuine RPGs, native fracture, traversal, 9/9 restores, and no remaining verified owned entities. Standalone custom DLC registration remains unresolved. A passing local acceptance is not proof every failure path has been fixed (the distinct original-damage restoration issue remains separate).

For current experience rather than historical assumptions, check the [PR lessons and receipts](PR-LESSONS-20261023.md) and latest PR status.
