# Agent operating standard — all LSA work

**Applies to:** Codex, Claude, other coding agents, remote GitHub sessions, and local PC operators. Source of truth is this checked-out branch's instructions plus **fresh state**, not a prior chat/PR summary. This is an operating policy, **not an authorization** to deploy, launch GTA or assume another agent's session.

## Startup / handoff contract

1. Record repository, branch, commit SHA, working tree cleanliness, target PR/base, and whether the branch contains the required tools. If following an old handoff, fetch latest PR head/comments and compare. Reconcile any local unpushed work before remote edits.
2. Read root `AGENTS.md` (Claude also `CLAUDE.md`); current `docs/ROADMAP.md`, `docs/research/CURRENT.md` and relevant phase document. For PC/GTA tasks read `GTA-PC-PLAYBOOK.md` and the **latest acknowledged operator handoff**. Older evidence never overrides current source.
3. Define **one exact next bounded objective**, allowed writes/actions, an owner, stop conditions, proof required, and rollback. Ask for approval when required; do not broaden a one-shot experiment into multiple attempts.
4. Choose the least invasive supported mechanism: repository/terminal/API or native controller command before graphical automation. A GUI may be necessary to launch software or inspect a truly visual result; keep it bounded. Never click through permissions, confirmation dialogs, graphics settings or desktop UI just because they happen to be visible.
5. At task end leave a durable handoff (`branch/head, changed paths, build/installed/loaded identity, request/run IDs, raw evidence, outcomes, unresolved UNKNOWNs, process and restore state, next authorized action`). No claim of future/background execution.

## One-writer / live PC boundary

- Parallel agents may research or work on **separate branches/worktrees**. Exactly **one explicitly named operator** owns Windows/GTA installs, commands, GUI input, shutdown and restoration at a time. One explicitly named integration publisher avoids conflicting writes.
- When P2 exists on the current experiment branch, `tools/gta-controller/controller.py` is the **only GTA command path**. Do not use legacy `x7cmd.py`, direct `command.txt` / `request.txt`, independent senders, or multiple controllers. A generic AI queue does **not** grant P2 ownership.
- Do not run the Windows P2 controller through a Linux mount unless that exact locking path has been independently qualified. A Linux-side handoff is not permission to operate another agent's game.
- After a timeout/ambiguous response, mark **UNKNOWN**, use same-owner/session `reconcile` and preserve original intent. Never blindly retry a side effect, clear a lock, or invent a success.
- Stop GTA before **any** game/addon/scripts/archives mutation; take fresh full hash/absence backups, journal expected state, verify writes and verify exact restoration **after GTA stops**. No permanent overwrite of third-party archives without explicit, verified, reversible authorization. Do not redistribute third-party archive contents.

## Four different forms of proof

| Layer | Required evidence | What it does **not** prove |
| --- | --- | --- |
| Source/CI | Deterministic build, unit tests, lint, generated-source parity | Actual GTA runtime behavior |
| Command | Correlated request/response with terminal state, no exception | That a physical action occurred |
| Gameplay/world | Genuine entity, native collision/section witnesses, traversal/performance, exact outcome | Clean installed file restore |
| Host/filesystem | Correct game process stopped, ownership released, original hashes/absences restored | Gameplay accepted earlier |

Bind the trial to `(pid, loadedUtc, scriptSha256)` and independently approved installed candidate hash, not just a freshly copied heartbeat. Store request/session/experiment/trial IDs, include **failed** runs, and reject mixed runtime identities. For LSA observability use the existing sanitized logs/one-ZIP analyzer where available; missing optional data is a coverage warning, not invented failure/success.

**Fail closed on ownership uncertainty, source ambiguity or 9/9 restoration failure.** Preserve the world's state separately from file-rollback results. Tracking a handle is not proof that the corresponding entity belongs to this mod (PR #310); deleting an unowned ambient object to turn a test green is forbidden.

## Render/tool preference (not a shortcut around authorization)

- To verify MSI Afterburner's GPU **power limit**, run the read-only `tools/operator-preflight/Test-GpuPowerLimit.ps1` with an appropriate saved Profile1 or explicit expected percent. Exit 0 is power-only proof. Do not routinely click/reapply a profile that's already correct; do not treat a canceled click or observed wattage as evidence the **whole** preset was applied.
- For the specific tested GTA Enhanced DLSS add-ons (`renodx-dlss.addon64`, `renodx-dlss-hotkey.addon64`), the October 23 successful X8 session disabled them by **temporary, journaled rename with GTA stopped**, then verified exact original hashes/paths after the test. This is a *tested local technique*, **not a generic license to rename arbitrary addons or change the user's default configuration**. See the PC playbook.
- Do not use F6, Steam minimization, GTA graphics-menu browsing, or scripted UI clicking as a substitute for checking whether the named setting is already correct or the add-on can be reversibly isolated. If GUI input is actually needed, name the reason and expected effect.

## Scope, correctness and cost

- Use simple/offline source tests before expensive Windows/GTA sessions. When debugging, compare a **known-good control** against the exact failing input, changing one variable at a time (PR #310). Don't iterate speculative XML flags and keep firing RPGs without a discriminator.
- Prefer reversible changes, bounded trials and a tight real-play acceptance oracle over perfect instrumentation. Don't manipulate a selector just to make a walkthrough pass or confuse environmental obstruction with fracture selection (PR #301).
- Preserve immutable failed evidence; record hypothesis vs verified root cause. If a fix passes offline CI but GTA has not tested it, label it **not GTA-validated**.
- Use the least costly model/effort that suits the task where configurable; spending approvals and access are separate user decisions. Model selection does not give an agent control over another terminal or checkout.

## Keeping this policy in circulation

- New branches based on `main` **after these instructions are merged** inherit them. Existing branches and stacked PRs **do not update automatically**. Rebase/merge safely or copy the policy files into an isolated branch after checking diffs; avoid rewriting active worktrees and published evidence.
- Root `AGENTS.md` and `CLAUDE.md` are entry points. The GitHub PR template reminds authors to report proof, ownership and rollback. CI checks the *presence/consistency* of policy files, but **cannot certify that an agent read or obeyed them**.
- Every new handoff should say: “Read the current AGENTS.md and agent-operating-standard before doing PC work; use the latest PR head, not an old summary.” For agents not honoring repository instruction files automatically, include that sentence explicitly in the prompt.
- When new evidence shows a better technique, update this canonical standard or PC playbook via a small PR against `main`. Don't leave the only description in a failed PR comment or an unmerged experiment.

See [PR audit and underlying receipts](PR-LESSONS-20261023.md) for why these rules exist.
