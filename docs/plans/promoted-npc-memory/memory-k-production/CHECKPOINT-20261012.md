# Memory K — emergency checkpoint (2026-10-12, ~22:50 UTC)

Development stopped at the owner's request. Nothing was pushed, because the git proxy refused the repository. Everything below is local, then backed up as a git bundle and a ZIP.

Full detail — toolchain, measurements, topology, decisions, blockers — is in the [complete session record](SESSION-RECORD-20261012.md).

## Finished (committed on `integration/memory-k-production-20261012`)

| Commit | Content |
| --- | --- |
| `1b288c1` | A `--no-ff` merge of PR #132 (`bcb21f6`) onto PR #131 (`f78970a`). |
| `4079609` | **K-22 fix.** The production `net481` `PromotedCharacters.csproj` did not compile because of Memory K native code: 12 × CS0104 (`Object` was ambiguous) and 1 × CS1501. It now compiles in the sandbox against NuGet RPH 1.124.0 and DamageTracker 2.0.0. One radio `CallByName<string>` error remains; it is inherited from `main` and depends on the RPH version. |
| `877b0f5` | The living plan `MEMORY-K-PRODUCTION-IMPLEMENTATION-PLAN-20261012.md` with every audit finding owned. Decision records D-021 (one human across avatars), D-022 (acceptance at `commitPlayerInput`) and D-023 (M3 observation-time attribution). Open owner decisions O-1 (Luna curation default) and O-2 (D03 corroboration ordering). Also `.gitignore` entries for native `bin/` and `obj/`. |
| this commit | This checkpoint note. |

The baseline was re-run on Node 24.21.0 and matches the audit:

| Suite | Passing |
| --- | --- |
| Shared brain | 211 / 215 |
| e1 | 1022 / 1040 |
| e1 memory | 98 / 98 |
| Memory sim | 7 / 7 |

K-01 (the packaged backend fails with `ERR_MODULE_NOT_FOUND`) was reproduced.

## Unfinished

**Wave 1.** Seven agents ran: WS-1, WS-4a, WS-4b, WS-4c, WS-5a, WS-5b and WS-5c. All of them hit the account session limit (HTTP 429) after about 9–12 minutes of read-only investigation. **No agent changed or committed any code.** Their branches `feature/memory-k-ws*-20261012` are identical to `877b0f5`. Their partial analysis survives only in the raw transcripts in the ZIP:

| Workstream | Transcript ID |
| --- | --- |
| WS-1 | `abd1b1804c5526d41` |
| WS-4a | `a2d1d4eb9bfd70412` |
| WS-4b | `ac1bc9711e75b92a1` |
| WS-4c | `a16e5eb173f3ac79b` |
| WS-5a | `a1a35057d1f4ddb42` |
| WS-5b | `a8445ebc57c2ea80b` |
| WS-5c | `a511ef624ac664814` |

**Not started:**

- wave 2: WS-6a, WS-6b and WS-10;
- wave 3: WS-7a, WS-7b, WS-7c, WS-8 and WS-9;
- wave 4: the adversarial review and repairs.

**Readiness is unchanged.** Source, offline integration, native packaging and GTA deployment are all **NO-GO**, and S01–S10 stand at 0/10.

## How to resume

1. **Restore.**

   ```bash
   git clone memory-k-checkpoint-20261012.bundle lsa-memk
   # or, inside an existing clone:
   git fetch <path>/memory-k-checkpoint-20261012.bundle 'refs/heads/*:refs/heads/*'
   ```

2. **Push, once access works.**

   ```bash
   git push origin integration/memory-k-production-20261012
   ```

   The workstream branches carry no extra commits, so pushing them is optional.

3. **Re-run wave 1.** Follow plan §5, using `memk-agent-protocol.md` and `agent-briefs.md` from the ZIP; both use base `877b0f5`. To stay under the session limit, run two or three agents at a time instead of seven at maximum effort. Suggested order:
   - WS-1, WS-5a and WS-4a;
   - then WS-4b, WS-4c, WS-5b and WS-5c;
   - then waves 2–4.

4. **Prepare the sandbox toolchain.**
   - Node 24 from nodejs.org.
   - .NET SDK 8 and 10 via `dotnet-install.sh`.
   - `mono-runtime` (apt) to run the `net481` harnesses.
   - NuGet `ragepluginhook` 1.124.0 and `damagetrackerlib` 2.0.0 as compile-only references. The compile command is in plan §3.
