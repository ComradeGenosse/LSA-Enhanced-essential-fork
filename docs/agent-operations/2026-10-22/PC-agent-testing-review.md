# Codex, Claude and GTA testing review

Reviewed October 22, 2026 on COMRADE. This is an audit and implementation plan; it does not claim a new in-game test or change either agent's configuration.

**The largest gains are in coordination, reliable command results and evidence checking.** Both agents have working pieces worth keeping. A small shared host controller and runbook should remove much of the manual relaying and repeated desktop troubleshooting.

Companion files: [shared operating runbook](SHARED-TEST-RUNBOOK.md), [example handoff record](agent-test-handoff.template.json), and [generated X7.2b evidence comparison](x72b-evidence-check.csv).

## What I inspected

- Relevant Codex and ChatGPT chats, including **Test LSA X7.1 native destruction**, **Build and validate X7 in GTA V**, **AI handoff effectiveness**, **Evidence review localized destruction**, and **Commit and push X7.2 evidence**. I asked the last chat directly for its current blockers and received a reply.
- Claude's local application/tool logs and a relevant prior GTA plugin investigation report. Its current workflow uses a Linux Cowork VM with Windows-mounted files; Codex builds directly on Windows.
- Current X7 source, Python and PowerShell control/deployment scripts, the older GT4 bridge, X7.2b summaries and selected underlying JSONL records.
- Read-only hardware, process and GPU telemetry, plus the current files covered by the latest rollback receipt.

Access limits: Codex's local `memories` directory was empty. Claude's full current conversation/server memory was not available as readable local files. Some ChatGPT assistant replies appeared only as unresolved content references, so those were not reviewed. Opening Claude for UI inspection timed out waiting for app access; no composer message was submitted. These limits do not prevent auditing the scripts, errors and evidence that were available.

## Current state and strengths

The working checkout was clean at `a613f8e2987fba85e63c4444b61b8d037dc2b56c`, branch `experiment/astra-001-x7-localized-fracture`. Codex reported this as its latest pushed commit for draft PR #296. Its reply did not recheck GitHub; I independently checked local HEAD and status.

X7.2b has **already tested** independent section props and prepared strength profiles. Its X7d pack receipt has SHA256 `22DF444C4DE5BD2C73D1AFD65C999AEE1DB15F1D00BA27193E8E06DC09CD8AA0`. Treating sec1 as merely awaiting its first game test would be stale guidance.

Useful pieces already exist:

- Blender/Sollumz export, CodeWalker reload and strict binary/pack validation.
- Native game-command files that bypass unreliable keyboard injection.
- Projectile timing, collision masks and real player traversal checks.
- Byte/hash-based deployment rollback and separate admission of failed or incomplete gameplay goals.
- A GT4 bridge with UUID requests, expiry, atomic publication, heartbeat freshness and loaded-build checks. Its runtime is RPH; reuse its protocol ideas with an SHVDN adapter rather than sending X7 commands to it unchanged.

The PC snapshot showed an i9-14900K, 64 GB RAM and RTX 5090 with about 32 GB VRAM. About 42.7 GiB system RAM was free. Afterburner was running; NVIDIA reported **460 W cap / 575 W default**. This supports the intended 80% cap but does not independently prove every setting of preset 1. GPU utilization was 4% in an idle sample; it is not a gameplay benchmark. GTA, Blender and CodeWalker were absent at the later process check.

I also compared all seven paths in the X7.2b phase-2 rollback receipt with the live game directory. Original configuration/add-on hashes and expected absence of temporary X7d files all matched. This is scoped verification, not a whole-installation audit.

## Highest-priority findings

| Priority | Finding | Concrete consequence | Smallest useful change |
|---|---|---|---|
| P0 | Current `x7cmd.py` accepts any changed run ID with DONE/ERROR and then exits 0, even after printing runtime errors. The C# runtime writes DONE after caught exceptions. | A failed command, or another controller's command, can look successful. | Add echoed request IDs and explicit success/error status; return nonzero on runtime error or unresolved timeout. |
| P0 | Both agents can write the same command slot, checkout and deployment paths. | Requests can overwrite each other; installed files or staged changes can lose clear ownership. Historical notes document DLL replacements during another investigation and stale Git locks. | One host controller owns GTA/deploy/input; one integration owner publishes; coding agents use separate worktrees. |
| P0 | The X7.2b report assigns a passing walk to the wrong center strength profile and understates timing ranges. | The next agent could reproduce the wrong case or draw the wrong conclusion. | Generate tables/ranges from exact per-trial records and retain failed variants. Correct the report before using it as handoff truth. |
| P1 | Current sender checks neither heartbeat age nor expected loaded source identity. Redeploy updates disk/manifest without loaded-SHA acknowledgement. | The source on disk can differ from the code being tested. | Validate `(game PID, runtime loadedUtc, loaded source SHA)` plus advancing frame and fresh heartbeat before each trial. |
| P1 | Python installer supports X7d and DLSS renames, but lacks the older PowerShell installer's game-stopped guard. Rename recovery metadata is saved after mutation. | An accidental live install or interruption can make recovery ambiguous. | Preserve the stopped-process gate; durably journal each intended mutation before applying it, then record completion. |
| P1 | Runtime prepare/restore accepts 8/9 witnesses, while acceptance analysis requires 9/9. | A live receipt can describe an incomplete baseline as restored. | Require exactly 9/9 before another shot and align the runtime receipt with the analyzer. |
| P1 | Evidence association relies partly on chronology. | Reloads or interleaved commands can attach a walk/restore to the wrong shot. | Explicit experiment, session, trial and request IDs; collect only manifest-listed runs. |

Current code anchors: [sender, lines 22–29][sender]; [runtime command handling][runtime]; [Python installer][installer]; [hot redeploy][redeploy]; [restore condition][restore]. The older PowerShell sender has similar result problems, so promoting that wrapper unchanged would not solve them.

### Evidence correction that can be made immediately

The X7.2b report's center row names pattern `1800,1400,1400,1800,1800` and claims passage at U=0.278. The structured evidence instead records:

| Case | Pattern, negative U to positive U | Recorded result |
|---|---|---|
| center, `20261022-140021-cbfb17` | `1800,1400,1400,1800,1800` | Two fragments detached; walk failed: `no_clear_lane_0.9m`. |
| same center pattern repeat, `20261022-140210-3180da` | `1800,1400,1400,1800,1800` | Same mask; no walk result recorded. |
| center v2, `20261022-140241-bea513` | **`1800,1800,1400,1400,1800`** | Player crossed at U=0.278; 1.0 m lane. |

Underlying walk logs also record the failed center walk and the successful v2 walk separately. Across all eight phase-2 records, commit cost is **0.074–0.177 ms** and near-event window maximum is **9.482–12.051 ms**. These values do not indicate a stated gate failure; the written ranges need correction. The accompanying CSV preserves every case and run ID.

## How they should work together

Use a shared tracked runbook and a small handoff record. Private product memories can remind each agent where to look, but the current state should live in shared files.

| Responsibility | Proposed owner | Boundary |
|---|---|---|
| Windows builds, host controller and integration/push | Codex | Use installed Windows tools, exact exit codes, protected-output hashes and scoped staging. |
| Physics experiment design and independent evidence review | Claude | Supply a bounded hypothesis and acceptance criteria; check the resulting logs/table. |
| Live GTA session, deploy/restore and desktop input | One named operator per session | May be either agent initially. Ownership transfers only after a written handoff and fresh checks. |
| Offline coding and analysis | Both, in separate worktrees | Exchange commits and immutable packs; avoid concurrent changes to the integration checkout. |

The eventual flow is: candidate commit/pack → one Windows controller → GTA → exact run bundle → independent review → one publisher. Start with a file record and the existing bridge; a new large orchestration service is unnecessary.

The host controller should hold an OS-level exclusive lock and record owner, fencing token, PID/start time and session. A timestamp/lease file alone is insufficient protection. Expiry should prompt reconciliation, not automatic takeover while an old operator may still be alive. On timeout, inspect the existing request before retrying it.

The handoff should state branch/HEAD, dirty files, protected output directories, candidate hashes, loaded runtime identity, current test owner, last trial, rollback state and the exact next authorized action. An example accompanies this report; it is not an active lease.

## Make the PC and tools easier to use

1. **Keep control out of foreground keystrokes where possible.** Codex histories contain 11 failed UI calls in the X7.1 chat, often `failed to activate captured window`. Claude logs contain 15 invalid-key errors on October 20–22, mostly Insert aliases, and eight failed `open_application` attempts with the Steam URI. Record supported methods separately for each tool; the two products do not share a key-name API. Use the game bridge for plugin commands.
2. **Keep one tested launcher.** Launch through the working Steam/launcher route, then verify the actual runtime. Directly launching the GTA EXE previously produced `ERR_NO_LAUNCHER`; passing a Steam URI to Claude's `open_application` also repeatedly failed. The inherited X2 launcher hardcodes the wrong script location for X7 and needs parameters before reuse.
3. **Make render preflight repeatable.** Check Afterburner/preset evidence before Blender or GTA, preserving Chris's existing requirement. Verify the observed cap separately. Keep the working reversible DLSS add-on method, add crash-safe journaling, and verify the current launch's no-load state. An old log entry or a blind F6 toggle is insufficient.
4. **Use capacity on independent work.** Run offline tests, source review and evidence analysis in parallel. Schedule expensive asset exports and benchmark capture so they do not change comparison conditions. Record native frame timing and render configuration per trial; earlier comparisons varied around 39 versus 120 FPS and sometimes changed character.
5. **Turn long operations into start/status/collect jobs.** Claude logs show three 120-second Bash timeouts. Persist job identity, exit status and output receipts; reconcile a timed-out job before starting another copy.
6. **Use proven service tools.** The build chat reports that GitHub connectors worked when `gh` was unavailable. Its installed Blender build worked through an approved host launch when a sandboxed launch silently exited. Document those narrow working paths and verify outputs; do not repeatedly rediscover them or broaden all permissions.

OpenAI's current guidance also supports using direct plugins where they cover an operation and reserving computer/browser interaction for interface-dependent work: [official computer and browser guidance](https://developers.openai.com/training/walkthroughs/using-your-computer-and-browser). Its [remote engineering guide](https://developers.openai.com/blog/mastering-codex-remote-for-engineering) describes explicit project/worktree boundaries and reviewable host-side work.

## Implementation order and completion checks

**First: correct the handoff evidence.** Generate the X7.2b table from structured records, separate center and center-v2, retain failures and fix ranges. The accompanying CSV is an independent comparison aid; the source report was not edited by this review.

**Second: harden the existing controller.** Promote the evidence-local scripts into maintained tools; parameterize GameRoot for Windows and Cowork mounts. Add request IDs, result errors, exclusive ownership, loaded-build checks, write-ahead recovery and exact-run collection. Reuse the GT4 protocol pattern with the correct runtime adapter. Keep physics changes in a separate commit.

Meaningful offline checks: stale heartbeat, wrong loaded SHA, wrong request completion, runtime exception, duplicate request, competing writer, partial JSON, client timeout with a still-running request, interrupted add-on rename and script reload under the same game PID. Each must fail or recover explicitly without a second unintended action.

**Third: rehearse the workflow once.** One operator claims ownership, verifies preset/render state, installs, launches to a fresh runtime, performs one known baseline trial, collects its exact records and restores. Verify all original witnesses and original files. A process existing or a controller exit code alone is not completion.

**Fourth: test the remaining gameplay claim.** X7.2b demonstrates native fracture and some walkable openings using profiles chosen at prepare time from the known aim. It does **not** yet demonstrate automatic profile selection from an arbitrary incoming impact.

After implementing that selection, the smallest useful end-to-end test lets the predictor choose the profile from observed projectile data; the caller must not supply the desired weak-strip pattern. Log predicted U, chosen profile, actual impact U, detachment, physical passage and restoration. Use a site with clear traversal space on both sides; the negative-U case currently lacks a demonstrated lane. Start with center and ±0.65, then repeat successful cases under matched conditions and across a fresh launch before claiming repeatability.

The tests support that shared parent hierarchy is not necessary for broad damage and that the tested strength patterns influence which sections fail. They do not directly measure uniform blast force or exclude debris coupling. Frame-by-frame detachment timing is diagnostic evidence, not causal proof.

The operating runbook and handoff template contain the proposed shared contract. No live controller, ongoing coordinator, automation, configuration change, commit or game test was created as part of this review.

[sender]: <../../../native/fragment-x7/evidence/x72b/tools/x7cmd.py#L22>
[runtime]: <../../../native/fragment-x7/WpsBreachLabX7.3.cs#L119>
[installer]: <../../../native/fragment-x7/evidence/x72b/tools/x7_install.py#L1>
[redeploy]: <../../../native/fragment-x7/evidence/x72b/tools/x7_redeploy.py#L5>
[restore]: <../../../native/fragment-x7/WpsBreachLabX7.3.cs#L1077>
