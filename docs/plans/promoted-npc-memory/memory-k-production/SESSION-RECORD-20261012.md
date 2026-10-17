# Memory K orchestration session — complete record (2026-10-12)

Everything this session established, decided, measured, built or was blocked by. Written so a later session, or a person, can resume without re-deriving any of it. Companion documents: the [living plan](../MEMORY-K-PRODUCTION-IMPLEMENTATION-PLAN-20261012.md) (workstream ownership and acceptance), the [checkpoint](CHECKPOINT-20261012.md) (what is finished versus unfinished) and the [independent audit](../MEMORY-K-INDEPENDENT-AUDIT-20261012.md) (the findings themselves).

**Session:** cloud sandbox, Linux, no GTA, no GitHub write access. **Mission:** turn the independent audit into a durable implementation plan in the repository, then execute it with specialist agents. **Outcome:** the plan, the decisions and one P0 repair landed; the implementation wave did not run, because every agent hit the account session limit.

## 1. Commits produced

Branch `integration/memory-k-production-20261012`, based on PR #131 head `f78970a3cd191f2d861dcba90423099e21183378`. **Not pushed** (§7).

| SHA | Commit |
| --- | --- |
| `1b288c1` | `--no-ff` merge of PR #132 head `bcb21f61d83e5f79725b267aa3180c900ab46016` (branch `claude/beautiful-cray-0q8ln4`). The merge tree equals PR #132's tree, `f13aabdaba6615f116134803327045792a6d3a5d`, so the merge introduces no content of its own. |
| `4079609` | `fix(native)`: K-22, the production `net481` compile repair (§4). |
| `877b0f5` | `docs(memory-k)`: the living plan, D-021/D-022/D-023, O-1/O-2, `.gitignore` for native `bin/`/`obj/`. |
| `14f449f` | `docs(memory-k)`: the checkpoint note. |

Seven workstream branches exist at `877b0f5` with no commits of their own: `feature/memory-k-ws1-packaging-ci-20261012`, `ws4a-privacy-m5`, `ws4b-durability-retention`, `ws4c-timeline-f11`, `ws5a-dialogue-write-path`, `ws5b-m3-events-coverage`, `ws5c-native-owner-prepromotion` (each suffixed `-20261012`).

## 2. Baseline, independently measured

Node **v24.21.0** (CI parity), Linux, at `1b288c1`. These numbers match the audit's for `215fc7d`, which confirms the audit's suite measurements.

| Suite | Command | Tests | Pass | Fail |
| --- | --- | --- | --- | --- |
| Shared brain | `node --test lsa-shared-brain/tests/*.test.mjs` | 215 | 211 | 4 |
| e1 top level | `cd lsa-essential-e1-candidate && node tools/runTests.mjs` | 1040 | 1022 | 17 |
| e1 memory | `cd lsa-essential-e1-candidate && node --test tests/memory/*.test.mjs` | 98 | 98 | 0 |
| Memory sim | `node --test tools/memory-sim/tests/*.mjs` | 7 | 7 | 0 |
| Native policy | `dotnet run --project native/intelligence/memory-authority-tests/MemoryAuthorityTests.csproj -c Release` | 23 assertions | PASS | — |
| Native M9 | `dotnet build native/intelligence/m9-tests/M9NativeTests.csproj -c Debug` then `mono …/M9NativeTests.exe` | 46 assertions | PASS | — |

Failing test names (all pre-existing):

- shared brain: `W04 ambiguous command is a durable bounded clarification…`, `W04 privacy trash suppresses immediately…`, `W04 two independent commands are atomic…`, `W06 A06: CAS fails on missing queue, source deletion, hash corruption and unsupported authority`;
- e1: `S01`–`S10` (ten hard-coded red gates), six `W03 A03: …` tests, `M1 editor hides unsupported mode and requires explicit timeline confirmation`.

Both e1 suites rebuild `dist/`; running them concurrently in one worktree corrupts the build. Run them sequentially. Durations: e1 ≈ 106 s, shared brain ≈ 50 s, e1 memory ≈ 14 s, sim < 1 s.

**K-01 reproduced.** `node tools/buildCandidate.mjs` exits 0 with 70 patches. Copying `dist/plugins` into an empty directory outside the repository and importing `e1/bootstrap.mjs` fails:

```
ERR_MODULE_NOT_FOUND Cannot find module '<dir>/plugins/lsa-shared-brain/src/memory/journalSqlite.mjs'
  imported from <dir>/plugins/LosSantosAliveServer/e1/memory/d03OriginalDialogueJoin.mjs
```

Four files under `dist/plugins` still contain `lsa-shared-brain/src`. The first line of `server.bundle.mjs` is `const __LSA_E1_BOOT = await import("./e1/bootstrap.mjs");`, so this is a top-level await rejection: the whole LSA backend fails to start.

## 3. Repository topology (saves re-deriving it)

- `main` is `3ef6c52`. Neither PR #131 nor PR #132 is an ancestor of `main`; nothing from the Memory K line is merged.
- Contained in PR #132's history: PRs #49, #51, #52, #94, #128, #131. **Not** contained: #97, #113, #114, #115, #116, #117, #118, #121, #122, #123, #127, #129, #130.
- PR → branch at head, for the recent Memory K and adjacent work:

| PR | Branch |
| --- | --- |
| #128 | `integration/memory-k-final-source-closure-20261012` |
| #129 | `fix/memory-k-d01-original-backend-acceptance-20261012` |
| #130 | `fix/memory-k-d02-native-owner-integration-20261012` |
| #131 | `integration/memory-k-d01-d02-d03-complete-20261012` |
| #132 | `claude/beautiful-cray-0q8ln4` |
| #118 | `integration/elevenlabs-emotional-acting-consolidated-20261012` (the ElevenLabs line, K-09) |
| #114 | `fix/ea-memory-unified-player-v4-20261012` (the one-human change, documentation only) |

- The ElevenLabs line (#118) and the Memory K line (#132) share merge base `3ef6c52`; **37 non-documentation files are changed by both**. That is the K-09 reconciliation surface.
- 170 remote branches, 21 workflow files (20 of them memory-related), about 54 open memory PRs across six stacked integration layers. The audit's advice stands: stop opening per-sub-feature PRs; use one integration branch built with merge commits.

## 4. New finding K-22 (P0) — the production native plugin did not compile

Not in the audit. Found by compiling `native/promoted-characters/PromotedCharacters.csproj` (the `net481` production plugin). At the PR #131/#132 heads it produced **13 errors**:

- 12 × `CS0104: 'Object' is an ambiguous reference between 'Rage.Object' and 'object'` — ten in `native/promoted-characters/MemoryOwnerAuthority.cs`, two in `native/intelligence/MemoryProtagonistSource.cs`. Both files `using Rage;`, where `Rage.Object` is a game entity type, and both call `Object.ReferenceEquals`/`Object.Equals`.
- 1 × `CS1501: No overload for method 'ToString' takes 1 arguments` at `MemoryOwnerAuthority.cs:64` — `e.Ped.Handle.ToString(CultureInfo.InvariantCulture)`, but `PoolHandle` has no `IFormatProvider` overload.

Fixed at `4079609` with `object.ReferenceEquals`/`object.Equals` and `Handle.ToString()`, which is the pedId formation P1 `SessionIdentityIntegration` already uses, so the two sides agree.

**One error remains and is inherited from `main`**: `native/intelligence/IntelligenceIntegration.cs` radio `NativeFunction.CallByName<string>("GET_PLAYER_RADIO_STATION_NAME")` → `CS0453` against NuGet `ragepluginhook` 1.124.0, whose `CallByName<T>` constrains `T : struct`. Compiling `main` gives exactly this one error, so it is pre-existing and RPH-version dependent; the owner's real RPH reference decides it. It is outside Memory K (blocker B-4).

**Why this matters beyond itself:** no CI job ever compiled this project, so a P0 that would stop any native build sat undetected across every Memory K PR. The plan makes this compile a gate (WS-1).

## 5. Toolchain, reproducible in a fresh sandbox

```bash
# Node 24 (CI parity; the repo's own runtime is Node 24)
curl -sS https://nodejs.org/dist/index.json   # pick the newest v24.x  (used: v24.21.0)
curl -sSL -o node.tar.xz https://nodejs.org/dist/<v>/node-<v>-linux-x64.tar.xz
mkdir -p /opt/node24 && tar -xJf node.tar.xz -C /opt/node24 --strip-components=1

# .NET SDK 8 and 10 (net8.0/net10.0 harnesses; also builds net481 reference-assembly projects)
curl -sSL -o dotnet-install.sh https://dot.net/v1/dotnet-install.sh && chmod +x dotnet-install.sh
./dotnet-install.sh --channel 8.0  --install-dir /opt/dotnet
./dotnet-install.sh --channel 10.0 --install-dir /opt/dotnet

# Mono, to RUN the net481 harness executables on Linux
apt-get install -y mono-runtime

# Compile-only references for the production plugin (NuGet; no GTA files, nothing redistributed)
curl -sSL -o rph.nupkg    https://api.nuget.org/v3-flatcontainer/ragepluginhook/1.124.0/ragepluginhook.1.124.0.nupkg
curl -sSL -o damage.nupkg https://api.nuget.org/v3-flatcontainer/damagetrackerlib/2.0.0/damagetrackerlib.2.0.0.nupkg
```

Package SHA-256: ragepluginhook 1.124.0 `b48e24aa586a73b5f1f3b220ea7eb7576d388a52446a11d69fa29842f8508c36`; damagetrackerlib 2.0.0 `6b1546b8b6ce7129fadd7fe31ec17e2c3c15aa2af0f5bce86ae1e0460951de8f`. Assembly SHA-256: `RagePluginHook.dll` `5d439745604a5fedbf8fa401520d4f296c1b6800d77e2923ba3bf9772182c7e0`; `DamageTrackerLib.dll` `64816a0d1131a6ec241f8951902b08afaee86fb0f73693399edefe2db8776750`. These are **not** the approved-SDK pins that `tools/memory-sim/prepare-approved-native-sdk.ps1` enforces; that script needs `W09_*_SHA256` CI secrets and emits a `blocked` receipt without them.

Production compile check (expect exactly the one inherited radio error):

```bash
export DOTNET_ROOT=/opt/dotnet PATH=/opt/node24/bin:/opt/dotnet:$PATH
dotnet build native/promoted-characters/PromotedCharacters.csproj -c Release \
  -p:AutomaticallyUseReferenceAssemblyPackages=true \
  -p:RphReferencePath=<...>/ragepluginhook/lib/net472/RagePluginHook.dll \
  -p:DamageReferencePath=<...>/damagetrackerlib/lib/DamageTrackerLib.dll -o /tmp/pcbuild
```

`net481` harnesses build with `dotnet build` and run with `mono <bin>/<name>.exe`; `net8.0`/`net10.0` harnesses run with `dotnet run --project`.

## 6. Decisions recorded, and the two left open

Written into `docs/research/DECISIONS.md` (D-021–D-023) and the amendment table in `approved-decisions.md` (all five). Each closes an audit finding that the implementation had silently decided.

- **D-021** — one human player across GTA avatars. Franklin, Michael, Trevor and freemode models are avatars of one human; scope is `worldProfileId + promoted characterId + confirmed timelineId`; the avatar stays immutable **source provenance**, never a partition key. Supersedes approved choice #4, which is now marked superseded with its original text kept. Closes **K-17**.
- **D-022** — an accepted player line is the input exactly as committed at `commitPlayerInput` (study §3.3, §3.6 G1, §5.5). On the OpenAI path the receipt is minted in-runtime by that commit decision, source `essential_openai_runtime_commit_decision`, corroborated by the original turn registry, the actor ledger, P1 currency and D02. Earlier signals (`SendTextPrompt`, mic stop, transport success, provisional transcript) and later ones (model completion) never mint; later interruption does not revoke. Gemini stays denial-only. **Supersedes PR #97 invariant 1**, which had raised the bar above the original plan and blocked M2, "the first major player win". Closes **K-11**.
- **D-023** — M3 attribution is the observation-time join of study §3.1 (observer index, native owner inspection, current owner evidence, matching `hostRunId`/`worldEpoch`, exactly one live profile); mismatch writes nothing and counts `unattributed`. A native source-time witness ledger is optional corroboration, not a prerequisite. This is what unblocks event journaling, which today is blocked on a proof the production native authority never supplies. Closes the decision half of **K-03(d)**.
- **O-1 (open, owner)** — approved choice #3 says Luna curation runs *by default*; the implementation ships it *off by default behind persisted consent*. The conservative default stays until the owner decides, and the deterministic M6 path must work without Luna either way.
- **O-2 (open, owner)** — D03 corroborates the native owner *before* the model request (G1 ordering), costing on average about one 250 ms native sample period. Corroborating after the request would weaken G1. Default: keep G1.

## 7. Why nothing could be pushed, with evidence

Three separate attempts, three refusals:

1. `git push origin integration/…` → `remote: access denied by the git proxy: ComradeGenosse/LSA-Enhanced-essential-fork is not in this session's authorized repository set, so the proxy will not inject a credential for it.` (HTTP 403.)
2. `gh api repos/ComradeGenosse/LSA-Enhanced-essential-fork` → 403, `GitHub access to this repository is not enabled for this session. Use add_repo to request access.` `GH_TOKEN` in the container is the placeholder `proxy-injected`; the real credential lives server-side.
3. GitHub connector (authenticated as ComradeGenosse, reads the repo fine — `list_branches` works) → `create_branch` returns `403 Resource not accessible by integration`, so its access to this repository is read-only.

The Claude GitHub App *is* installed on the ComradeGenosse account and the settings page confirms cloud sessions can work in this repository. That path applies to Claude Code cloud sessions started **with the repository selected**; this Cowork session was not, and the proxy's `add_repo` step is not available from here. Also: the user's computer is linked, but no folders are connected to the session, and the device-side shell has no GitHub credentials of its own.

Consequence for evidence: **GitHub Actions results were never observable this session.** Every suite result here is a local Linux run. Windows CI remains UNTESTED.

## 8. Wave 1: what was launched and what happened

Seven specialist agents launched concurrently at maximum effort, each with its own git worktree and branch, briefed from the audit with explicit non-negotiables (preserve original requirements, no mocks in production paths, byte-exact text, fail closed, no pushes, no `main`, no touching the ElevenLabs or unified-player branches):

| WS | Scope | Transcript |
| --- | --- | --- |
| WS-1 | Packaging (K-01), native build gate (K-22), one `memory-all` CI workflow, consolidate ~20 memory workflows, S01–S10 as honest expected-fail, M1 editor and W06 test repairs | `agent-abd1b1804c5526d41` |
| WS-4a | Privacy and M5 integrity: K-05, K-06, K-07, K-12 and four K-20 items | `agent-a2d1d4eb9bfd70412` |
| WS-4b | Durability and retention: K-10, K-16, migration DDL atomicity | `agent-ac1bc9711e75b92a1` |
| WS-4c | Timeline continuity and in-game F11 confirmation: K-14 | `agent-a16e5eb173f3ac79b` |
| WS-5a | Dialogue write path M2: K-03(c), K-15, W03 repairs, delivery statuses, `reply_to`, K-04 re-verification | `agent-a1a35057d1f4ddb42` |
| WS-5b | Event write path M3 and certified coverage: K-03(d)(e)(f), K-13 | `agent-a8445ebc57c2ea80b` |
| WS-5c | Native owner availability and promotion grace: K-21, AD-8/S08 | `agent-a511ef624ac664814` |

All seven terminated with `rate_limit` (HTTP 429, "session limit") after 9–12 minutes, during investigation. Combined they spent about 2.4 M tokens and 410 tool calls on reading. **Not one wrote or committed a file**; the seven branches are byte-identical to `877b0f5`. Their partial analysis survives only in the transcripts, which are in the ZIP.

**Lesson for the retry:** two or three agents at a time, not seven at maximum effort. Suggested order: WS-1 + WS-5a + WS-4a, then WS-4b + WS-4c + WS-5b + WS-5c, then waves 2–4.

## 9. The plan in one screen

Full detail in the [living plan](../MEMORY-K-PRODUCTION-IMPLEMENTATION-PLAN-20261012.md) §4 (every finding owned), §5 (workstreams), §6 (gates).

```text
Wave 1  WS-1 packaging/CI · WS-4a privacy/M5 · WS-4b durability · WS-4c timeline
        WS-5a dialogue write · WS-5b events/coverage · WS-5c native owner/grace
Wave 2  WS-6a recall into the frame · WS-6b journal CONVERSE + M5 dispatch · WS-10 inspector
Wave 3  WS-7a M6/M7 · WS-7b M8 · WS-7c M9 · WS-8 ElevenLabs reconcile · WS-9 scenarios
Wave 4  WS-R adversarial review → targeted repairs → re-review
```

Gates: offline (`memory-all` green on Node 24 both platforms, packaged-import smoke, positive S01/S07/S09, K-04 timing, all privacy tests) → native (owner's real RPH/DamageTracker/Essential references, hash-pinned) → controlled GTA with explicit authorization (S01, S09, S07 with JSONL and SQLite receipts) → WS-7 and the M10 soak.

## 10. Readiness, unchanged from the audit

| Dimension | Verdict | Why |
| --- | --- | --- |
| Source implementation | **NO-GO** | K-02 (nothing reads), K-03 (NPC lines and events still have no writer) |
| Offline integration | **NO-GO** | 21 failures, privacy defects K-05/K-06, broken M5 compound commands K-07 |
| Native packaging | **NO-GO** | K-01 unfixed; K-22 fixed but no approved-SDK build has run |
| GTA deployment | **NO-GO** | Do not install any Memory K integration build; keep the deployed `main`-based build |
| S01–S10 acceptance | **0 / 10** | Red gates, no GTA receipts |

What PR #132 genuinely added (verified by the audit, re-read here): the in-runtime acceptance issuer, the original-actor ledger and the D02 lease redesign, offline-tested end to end against the real patched bundle. It changes no production verdict on its own, because K-01 stops the package from starting and K-02 means nothing is ever read back.

## 11. Blockers

| ID | Description | Effect |
| --- | --- | --- |
| B-1 | No push credential for this repository in this session (§7) | Work delivered as a git bundle |
| B-2 | GitHub API blocked; CI unobservable | Windows CI evidence UNTESTED |
| B-3 | No GTA access | Every GTA gate UNTESTED |
| B-4 | Radio `CallByName<string>` compile error against NuGet RPH 1.124.0, inherited from `main` | Owner's real RPH decides; outside Memory K |
| B-5 | M10 standalone adapters depend on the standalone P2/PS migration | Offline soak only |
| L-1 | C-01 v2 native path "unavailable with pinned ABI" | Unchanged; D-022 does not depend on it |

## 12. Resuming

1. Restore: `git clone memory-k-checkpoint-20261012.bundle lsa-memk`, or `git fetch <bundle> 'refs/heads/*:refs/heads/*'` in an existing clone.
2. Push `integration/memory-k-production-20261012` (4 commits ahead of what GitHub has; everything else in its history is already on GitHub via #131/#132).
3. Rebuild the toolchain (§5) and re-measure the baseline (§2) before changing anything.
4. Re-run wave 1 from `memk-agent-protocol.md` and `agent-briefs.md`, two or three agents at a time, base `877b0f5`.
5. Keep the living plan's §4 register and §7 progress log current as work lands; a row moves to Done only when the orchestrator re-ran its evidence.
