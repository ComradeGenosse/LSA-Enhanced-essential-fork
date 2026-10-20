# ASTRA-002 AGM E0 | GTA V Enhanced lab census

Research only. This is a separate RPH assembly and a command-free helper loaded into Essential's original, pinned AppDomain. It does not modify production LSA, ACT, Director, Nathan, the game master decision D-001, or GTA mission flags. It never tasks an actor that it did not create. No E1, model calls or generated missions.

## Offline build and tests

From repo root, on Windows or in Actions:

~~~powershell
node --test tools/agm-e0/tests/*.test.mjs
dotnet run --project native/agm-e0/policy-tests/PolicyTests.csproj -c Release
node tools/native-sdk/compileAgmE0.mjs
~~~

The last command restores the official RagePluginHook 1.124.0 SDK, verifies its SHA-256 against the existing pinned production script, builds both genuine net481 assemblies and writes binaries and build-evidence.json into native/agm-e0/artifacts. The lab plugin is **never** built against GameStub.cs, the fake test SDK or unpinned game APIs. Compiled is NOT equivalent to GTA tested.

## Install — backed-up laboratory save only

1. Back up the GTA save and exit GTA/RPH.
2. Copy the build artifact LSA.AGM.E0.dll to the GTA V Enhanced Plugins root.
3. Copy LSA.AGM.E0.EssentialProbe.dll into Plugins/LSA.AGM.E0/ (not the Plugins root).
4. Copy LSA.AGM.E0.lab.example.json as Plugins/LSA.AGM.E0.lab.json, then change enabled to true *only on the lab install*. Keep the acknowledgement text exact.
5. For Essential-on tests, start Essential and P2 first, then load the lab plugin from RPH. Check AGME0Status for pinned_ready before yield probes. A mismatched Essential binary is intentionally refused.
6. Record screen video, RPH log, OBS2 logs, exact build versions and manifest hash. No unattended GTA runtime verification.

## F4 console commands

| Command | Purpose |
| --- | --- |
| AGME0Help | All commands |
| AGME0Site terminal / grapeseed / vinewood / delperro | Label location after physically traveling there; **labels are not GPS verification** |
| AGME0Day day / night | Label lighting |
| AGME0Nathan present / absent | Label Nathan's actual presence (does not summon or control) |
| AGME0Condition essential_off / yield_off / yield_on | Negative control; essential_off requires Essential not loaded, yield tests need the pinned bridge |
| AGME0Task walk / drive / flee / guard / chase / follow / combat | Task family used in E0.2/E0.6 |
| AGME0Run e0.1 through e0.8 | Launch one bounded probe |
| AGME01Mode baseline / extended | E0.1 control vs extended 80-trial census; extended is the default |
| AGME0Status | Lease, log, bridge status |
| AGME0Truth pass / fail / unknown | Manually attach E0.5 comparison against retained and timecoded video |
| AGME0Cancel | Emergency cancellation and cleanup |
| AGME0Clean | End probe, delete owned scene entities, inspect cleanup records |

### Probe matrix and evidence targets

| Probe | Implemented activity | Required GTA acceptance |
| --- | --- | --- |
| E0.1 | 80 sequential trials (20 each kind), 4 allowlisted models for ped/vehicle/prop; baseline immediate cleanup, or extended 16 delayed stability trials at 1s and 5s; double post-delete checks at 250/750ms; passive Essential state, ground/visibility/collision metadata, native pool/count snapshots, spawn/delete timing and refusal controls | ≥95% immediate success per kind; independent 1s/5s/cleanup/video confirmation |
| E0.2 | 60-second walk, drive, flee, guard, chase (also follow/combat) against Essential-off, yield-off and yield-on baselines; 4 Hz sampling | N=10 per task per condition; ≥90% task retention with yield |
| E0.3 | Persistent peds at 100, 250, 400, 800 metres; five-minute samples | Streaming, save/reload must preserve desired entities |
| E0.4 | Hostile owned-ped pair, weapons and task control; no Nathan-labelled-present trial allowed | Verify hostility, relationship groups, police, collateral on ambient NPCs and Nathan |
| E0.5 | Driveability, pickup existence/collection, death, flee/combat, position/distance samples at 4 Hz | Sensor error ≤2% based on independent video truth |
| E0.6 | Essential pin/yield control plus NpcState reflex/directed snapshots during tasks | Compare Essential reflex, PerceptionSnapshot, conversation hijack, Luna lines with OBS2 and video |
| E0.7 | Cancellation, durable entity journal, guarded same-process reload sweeping | Zero orphans across cleanup, plugin reload, save reload and crash |
| E0.8 | 12 peds plus 6 vehicles, pool capacities, bounded sampler timing | ≤0.5 ms/frame average measured externally; capacity headroom |

E0.4 relationship-group configuration and E0.5 held-item/physical-interaction sensors are still **unverified**. The bridge does not by itself measure Luna speech or PerceptionSnapshot; those require joining existing logs and video. E0.8's internal callback stopwatch is NOT a substitute for whole-frame profiling. Do not mark the experiment accepted on these source capabilities alone.

## E0.2 + E0.6 decisive test protocol

At Terminal docks, Grapeseed, Vinewood Boulevard and Del Perro, repeat at day/night and Nathan present/absent as safely practical. Select one scene task, run it for 60 seconds with Essential absent, then Essential present/yield_off and Essential present/yield_on. Keep the same player/camera position. Perform 10 independent runs per task and condition. Record trajectories, nav task status where known, actor state, native task receipts, Essential reflex/state samples, OBS2, and actual dialogue. Task dispatched does **not** prove task retained. Identify takeover by GTA, by Essential, or unknown instead of guessing. Run E0.7 cleanup and check orphans before every new test set.

## Diagnostics

The plugin writes JSONL to Plugins/LSA.AGM.E0/logs/ and a durable active-lease.json journal. Each record has UTC, hostRunId, worldEpoch, gameMs, site, condition, model/handle/incarnation, task state and sample timing. Log data is bounded to 16 MiB per run. Use:

~~~powershell
node tools/agm-e0/analyze.mjs "C:\path\to\agm-e0-log.jsonl" "C:\path\to\report.json"
~~~

The offline analyzer refuses fabricated acceptance and flags missing deletes, mixed epochs, incomplete probes and absent video truth. It never promotes tier C to runtime tier A merely because commands returned successfully.

## Safety, cancellation and rollback

Any mission/cutscene/online state cancels the trial. No mission flag, player teleport, player task or promoted NPC write is permitted. Only one lab lease can be active; entity caps are 12 peds, 6 vehicles, 6 props, 4 pickups. Never run E0.4 in a populated location. If a probe has an orphan, **stop further runs**. For same-GTA-process plugin reload, a sweeper uses process identity plus handle, native memory address, model and location; unresolved or ambiguous identities are never deleted by handle alone. Across a restarted GTA process, the journal is not authority for any handle: use a clean restarted lab save and inspect before deleting a stale journal.

To rollback, use AGME0Cancel and AGME0Clean, exit without saving, remove the two DLLs, Plugins/LSA.AGM.E0.lab.json and its folder, restart RPH and restore the original save. Nothing in main or production gameplay is modified.

**Status boundary:** Source checks and Windows compilation are offline only. Exact GTA V Enhanced/RPH/Essential versions, video, and paired owner runs are required before any E0 capability is called accepted. E1 and AI-generated missions are expressly out of scope.


## E0.1 extended census — recommended first lab run

The default \`AGME01Mode extended\` retains **80 total sequential spawn attempts** (20 per kind). The four classes run in rotation. Four trials per class (16 total) receive 1,000 ms and 5,000 ms stability checkpoints; the others form immediate-readback controls. All spawned entities are deleted one at a time, followed by independent 250 ms and 750 ms post-delete checks. The operator should remain within 10 m of the initial spot. E0.1 does not task any actor, does not add NPC state or start E0.2, and avoids concurrent active probes.

In the RPH F4 console, with Essential running and the pinned Essential helper installed:

~~~text
AGME0Status
AGME0Condition yield_off
AGME01Mode extended
AGME0Run e0.1
~~~

The **baseline** alternative is \`AGME01Mode baseline\` followed by \`AGME0Run e0.1\`; it runs the same 80 trials and model rotation without the 5-second holds. The extended test can take several minutes. Use \`AGME0Cancel\` whenever needed. E0.1 samples Essential state **read-only** only for its newly spawned scene peds; Nathan, ACT, Director and ambient peds are never modified. Compare the JSONL timestamps to separately captured OBS2 and voice/Nathan footage to evaluate collateral behavior; the plugin cannot establish dialogue correctness by itself.

The offline \`analyze.mjs\` report now includes \`e01\` with per-kind denominators, diversity, readback fractions, delayed trial counts, missing/duplicate checkpoints, cleanup and post-delete failures, task-write contamination, negative controls, and spawn/delete p50/p95 timings. It fails closed on incomplete traces. Pickup checks are explicitly **weak numeric-handle evidence**, never a proven object incarnation. Counts versus GTA pool capacities are informational, **not a certified free-slot count**. Native timing includes model loading and may yield across frames; it is **not total-frame time**. Off-screen, ground-Z and collision samples can be unavailable and should be corroborated with video. Unrecognized allowlisted models are recorded as genuine failures rather than silently substituted.

Results remain **research evidence**, not validated gameplay. In particular, E0.1 does not prove that Essential will preserve tasked NPCs; E0.2/E0.6 remains the decisive follow-on experiment.
