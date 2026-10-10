# PR 23 local deployment checkpoint — October 10, 2026

The user authorized local installation of PR #23 at documentation HEAD `0b50651706f7ad2b6f1e69c638900e3efdc1871c`, containing validated implementation `12a6dd55ff5c4fbd869a55d1a1c4711ed284d575`. This record supplements the implementation ledger; it does not claim GTA runtime acceptance or milestone completion.

## Production build correction

The real pinned-reference `net481` Release build failed with CS0246 because `PromotedCharacters.csproj`, which disables default compile items, omitted the existing `DirectorOriginalTurnBindingCodec.cs`. Add that source file to the production compile list. The Director and integration test projects already included it, explaining why their offline builds did not expose the production packaging defect. This correction changes the build list only; it does not activate speech or alter admission policy.

After the correction, the native Release builder succeeded against the hash-pinned RPH SDK, original Essential DLL, DamageTracker and RNUI references. The companion builder verified the matching native source/payload and produced all 70 expected AST patches. Local Windows verification passed:

- 734 isolated Node tests across 71 files, zero failed files, using the installed Node v24.16.0.
- 267 native ACT assertions, 314 native Director assertions and 151 production integration assertions.
- 95 installed JavaScript module/launcher syntax checks and existing configuration parsing.

The first sandboxed Node attempt was blocked by local loopback permissions and a not-yet-built Windows pipe helper. After compiling the helper, the isolated suite passed with local fixture permissions. No provider API calls were made.

## Installed state

A private predeployment backup contains 1,338 files with matching source/backup SHA-256 hashes. Installation replaced/added 104 companion/native payload files; every installed file matched staging. All pre-existing files outside the deployment set were verified unchanged, including credentials, character/identity stores, controls, Essential Core, runtimes and unrelated plugins. No game was launched. Backup, credentials, machine-specific receipts and build outputs remain local.

Existing P2/UX settings remain enabled, ACT remains `on` with the existing probe configuration, and perception remains `shadow`. After deployment, the user separately authorized these knowledge settings:

```json
"dialogueKnowledge": {
  "mode": "active",
  "activityFacts": "active",
  "dialogueReceipts": "active"
}
```

The companion and native `activities.dialogueReceipts` switches were also set to literal `true`, with both original configs backed up. These are requested configuration states, **not evidence that the capabilities are runtime-active or GTA-accepted**. Existing exact-payload validation and runtime support gates were not bypassed or fabricated.

## Spontaneous speech still unavailable in production startup

The user requested spontaneous speech and compatible new features. Source inspection found:

- `IntelligenceIntegration` constructs `DirectorAdmission` with `enabled=false` and `DirectorSchedulerIntake.Production(director,false)`.
- Production `bootstrap.mjs` does not instantiate `SceneDirectorSpeech`; the coordinator requires supplied admission, native request and dispatch authorities. No production source caller instantiates it or drives its candidate attempts.
- The existing transport and stock-turn binding components therefore do not establish an enabled end-to-end autonomous production path by themselves. Adding a config field or flipping the two native Booleans alone is insufficient.

No spontaneous speech activation or source integration change was made. The next implementation work needs to wire a bounded production coordinator and explicit activation controls through the existing PS3/native/Essential authority path, preserve all admission/playback/player-priority contracts, and validate the production build and real GTA behavior. The user expressed a preference to enable safe, compatible features, but this record supplies no positive physical acceptance receipt.

PR #23 remains unmerged. Baseline PS4 acceptance and external GTA gates remain governed by the active milestone and implementation ledger.
