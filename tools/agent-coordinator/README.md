# Local agent handoffs

Small Python 3.10+ coordinator, independent of GTA. SQLite WAL records tasks and
an ordered event journal; per-task files retain prompts, argv, stdout, stderr,
structured answers and CLI session IDs. No server, GUI relay or idle model calls.
Use native Windows Python. Keep the queue on local NTFS, outside Git and synced folders.

## Setup

Codex is already installed by the desktop app. Resolve its real `codex.exe`
(the `codex.cmd` launcher points at its versioned directory). Claude Code's
official Windows installer is `https://claude.ai/install.ps1`. Installation and
uninstallation remain explicit operator actions. Authenticate with `codex login`
and `claude auth login`; do not copy credentials between products. Existing
Desktop/Cowork conversations are not implicitly attached to CLI sessions.

Create separate Git worktrees for each agent. Initialize once using real paths:

```powershell
$queue = 'C:\path\to\local-queue'
$coordinator = 'C:\path\to\tools\agent-coordinator\coordinator.py'
python $coordinator --queue $queue init --codex C:\path\codex.exe --claude C:\path\claude.exe --codex-workspace C:\path\codex-tree --claude-workspace C:\path\claude-tree
python $coordinator --queue $queue submit claude --workspace C:\path\claude-tree --prompt-file C:\path\task.txt --timeout 180
python $coordinator --queue $queue start
python $coordinator --queue $queue status
python $coordinator --queue $queue status TASK_ID
python $coordinator --queue $queue handoff TASK_ID codex --prompt-file C:\path\next.txt
python $coordinator --queue $queue cancel TASK_ID
python $coordinator --queue $queue stop
```

`work --once` drains queued work and exits; `start` launches a hidden worker.
`stop` cancels the active process tree and exits, preserving queued work. Cancel
each queued task explicitly if desired. A kernel file lock admits one worker.
`start` after `stop` resumes queued work, never terminal tasks. `submit --session
CLI_SESSION_ID` resumes that agent's CLI conversation; don't supply a Desktop ID.
New peer handoffs get fresh sessions; to resume an earlier CLI thread, submit
explicitly with its recorded ID.

Either agent can emit this schema; the worker commits the result and next task
in one transaction:

```json
{"result":"analysis or completed work", "handoff":{"target":"codex","prompt":"exact next task and acceptance criteria"}}
```

Use `"handoff": null` to finish. There is at most one child per task and two
handoffs per root (three CLI calls). Self-delegation and excess hops fail closed.
An agent may also invoke the `submit`/`handoff` CLI from a separately authorized
session; queued agents are instructed to use JSON only. This is cooperative
coordination, not a security boundary against programs running as the same user.
An invalid/excess-budget handoff produces HANDOFF_REJECTED, retaining the CLI
answer and an explicit rejection reason without creating a child.

## Permissions and recovery

Defaults: Codex read-only sandbox; Claude no tools, `dontAsk`, strict MCP config.
Claude still uses normal account auth (no bare mode); no bypass flags. For coding
assignments, explicitly set `codex_sandbox` to `workspace-write` and/or
`claude_tools` to `["Read","Edit","Write"]` in local config after reviewing the
worktree. The same tool names are passed as Claude's allowed tools. Do not add
generic shell access to avoid a product prompt. Keep privileged host actions in
explicit fixed-command operator scripts and their existing approval boundaries.
This initial version delegates designs, code proposals and review without tools;
write access is opt-in and does not grant deployment authorization.

Timeouts/cancellations terminate the child tree using Windows `taskkill /T /F`.
They do not undo edits or external effects. No retry occurs. If the worker/PC
dies, STARTING/RUNNING tasks become UNKNOWN and pause the entire queue. A child
may still be alive: inspect its PID/start time, `runs/TASK_ID`, logs and external
effects before terminating it or continuing. Resolve with:

```powershell
python $coordinator --queue $queue resolve TASK_ID --note 'Inspected process and outputs; exact reconciliation outcome'
python $coordinator --queue $queue start
```

Resolution marks REVIEWED, never success and never replay. Submit a new task only
after determining that repetition is safe. Logs can contain project data; do not
commit raw credentials, queue databases or private transcripts. The worker has a
brief process-launch/receipt gap; recovery deliberately reports UNKNOWN.
Malformed/missing post-launch output or unconfirmed process-tree termination
also becomes UNKNOWN and pauses the queue. A bounded writer thread keeps large
stdin prompts from blocking timeout/cancel checks. A CLI that exits after
spawning detached descendants can still leave them alive; this MVP has no Windows
Job Object containment. Reconcile descendants before resuming UNKNOWN work.

Persistent CLI allowlists are legitimate within those CLIs' policies. Desktop
app sandbox escalation, OS/UAC, browser login and managed policy remain enforced.
No GUI prompt clicking, security-setting changes or global approval disabling.
No automatic startup task/service is installed. Rollback: stop worker, reconcile
active jobs, archive queue, remove the worktree only after preserving edits.

## GTA adapter boundary

For render preflight, first run `Test-GpuPowerLimit.ps1` in this directory.
It reads saved Profile1's PowerLimit and checks live NVIDIA telemetry. PASS/exit 0
means the power cap already matches: no preset click/reapplication is needed.
Mismatch or unknown exits 2 and changes nothing. This checks the power limit,
not all clock/voltage/fan settings; requirements for those need separate evidence.
Use `-ExpectedPercent 80` if checking a fixed cap instead of the saved profile.

Codex owns Windows execution, build, GitHub, deployment and the single GTA session;
Claude owns experiment design, coding assignments and independent review. Read
`docs/agent-operations/GTA-CONTROLLER-RUNBOOK.md` first. Existing controller P2
ownership is authoritative; this queue never deletes or expires its lock/state.
Do not enqueue unattended installation or GTA launch as generic model work.
Only a named operator can adopt a stopped-game handoff, verify rollback hashes,
install an approved candidate, launch offline Story Mode, and authorize the
loaded `(pid, loadedUtc, scriptSha256)` tuple.

Use `tools/gta-controller/smoke_x72c.py` for the one-trial adapter. In current
X7.2c, `X7Walk` already uses `TASK_GO_STRAIGHT_TO_COORD` for the actual player,
bounded to 25 seconds, clears tasks afterward, and measures crossing. `hold=3`
is a post-walk observation hold, not a W-key duration. No input injection is
needed. The exact installed driver and evidence determine success. Keep
command/gameplay/9-of-9 world/filesystem restoration separate. TIMEOUT_UNKNOWN
requires the same controller owner/session's `reconcile`; never resend. Use
Python 3.11+ for the controller's seven-digit .NET timestamps (Python 3.10's
`datetime.fromisoformat` rejects them). This coordinator itself supports 3.10.

For Blender, CodeWalker or other projects, register their worktrees and hand off
bounded tasks in the same format. Heavy asset tools need a project-specific
operator adapter; the queue does not assume GTA paths or executable commands.

## Verify

```powershell
python -m unittest discover -s tools/agent-coordinator -p test_coordinator.py -v
```

An actual Claude → Codex → Claude acceptance requires authenticated CLIs. Submit
the example prompt in `offline-demo.txt` to Claude and run the worker. Inspect all
three durable task records and the final independent answer; fake CLI tests are
not a substitute for this live service integration.
