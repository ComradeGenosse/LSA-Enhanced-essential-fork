# Activity-native research tools

Research-only reproduction of the static evidence N1–N21 in [lsa-activities-goal-execution-architecture.md](../lsa-activities-goal-execution-architecture.md) §2.2. The results are recorded in [activity-native-evidence.json](../activity-native-evidence.json).

These tools **never load, reflect over or execute** `LosSantosAlive.dll` or any RAGE/GTA assembly. They read the JSON that the action audit's byte-level extractor emits.

## Dependencies (reused, not copied)

`activity_probe.py` extends the action audit's decoders and needs them on its import path. They live on branch `research/essential-action-completion-audit-20261003` (`8e823310a41cac6529c5441a3286938f102229e7`) under `docs/research/action-native-tools/`:

| File | Used for |
| --- | --- |
| `ActionNativeAudit.csproj`, `Program.cs` | PE/CLR metadata + IL extract of the pinned DLL (.NET SDK 10) |
| `ilcore.py` | Module loader, obfuscated string-table decoder, cross references |
| `cff.py` | Control-flow unflattening (only for manual inspection) |
| `registrations.py`, `commands.py` | Shared-executor command/vehicle-policy recovery (N9) |

## Pins

| Artifact | SHA-256 |
| --- | --- |
| `lsa-essential-e1-candidate/upstream/LosSantosAlive.dll` | `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653` |
| `lsa-essential-e1-candidate/upstream/server.bundle.mjs` | `5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2` |

`ilcore.Module` refuses an extract whose recorded hash differs from the pin.

## Reproduce

1. Check out the audit tools next to this repository (or into a scratch folder outside it):

   ```text
   git worktree add ../action-audit research/essential-action-completion-audit-20261003
   ```

2. Produce the IL extract **outside** the repository (about 66 MiB):

   ```text
   dotnet run --project ../action-audit/docs/research/action-native-tools/ActionNativeAudit.csproj -c Release -- essential lsa-essential-e1-candidate/upstream/LosSantosAlive.dll <scratch>/essential-il.json
   ```

   The extract used for this investigation had 651 types and 5,588 methods.

3. Run the probe with the audit tools on the import path:

   ```text
   python docs/research/activity-native-tools/activity_probe.py <scratch>/essential-il.json --tools ../action-audit/docs/research/action-native-tools --out <scratch>/activity-probe-out.json
   ```

   The output's `findings` object is what `activity-native-evidence.json` stores under `probeOutput` (keys `N1` … `N21`; N10 and N18 share `N10_N18`). It runs in a few seconds.

## What each finding queries

| ID | Query |
| --- | --- |
| N1, N2, N3 | Field cross-references (`ldfld`/`stfld`) for the activity-queue and destination fields; callers of `DestinationResolver.TryResolve` |
| N4 | Methods whose decoded strings name each navigation TASK native |
| N5 | `NpcActionRegistry.TryExecute` call sites of `NotifyNpcActionExecuted` and the field loaded just before each |
| N6, N7 | Bridge routing and queue-processor strings and callees; duplicate and target-relative sets |
| N8 | Shared-executor section strings (`00.GetPreparedState` … `08.AfterRefreshControlledBrain`) and callees |
| N9 | For every public `NpcActions` wrapper: deferred-executor command and vehicle policy (`commands.py`), or a direct immediate-executor call |
| N10, N18 | `UseScenario*` public overloads, implementation strings and callees, the partial mode clear and the fields each clear helper writes |
| N11 | `ResumeActivityBehavior` public members, fields and decoded strings (phases, natives, scenario map) |
| N12 | Approach acceptance strings and `BuildApproachResult` |
| N13 | Far-release constant (distance² = 10,000), control-intent field reads, dead-release callers |
| N14, N20, N21 | Public members, properties and fields of the continuity, location, registry and handler types |
| N15 | Decoded string counts per location registry |
| N16 | Item names reachable from `NpcItemStore.RegisterDefaults` |
| N17, N19 | `ApplyActionStateModifiers` (`isinst` site, integration list, callers) and `NotifyPedControlChanged` callers |

## What not to do

- Do not `Assembly.Load` the game DLL or execute extracted IL.
- Do not point the extractor at a live `plugins` copy without hash-comparing it to the pin.
- Do not read a static finding as GTA behavior. The runtime questions are listed in §3 of the architecture document and probed in §19.
