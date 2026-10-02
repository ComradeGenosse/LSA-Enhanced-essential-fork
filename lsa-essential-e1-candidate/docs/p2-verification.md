# P2 offline verification

October 2, 2026. Base: `main` at `2849df113a8326ee19ce1649caf67d87fd062539`, containing merged P1 PR #5. The remote base was refreshed before publication. **No P2 deployment, provider API call, or physical GTA test was performed.**

## Results

| Check | Result | Boundary |
| --- | --- | --- |
| Full Node regression, `node tools/runTests.mjs` | **294 passed; 0 failed, cancelled, skipped or todo** | Original 242 P0/P1/E1–E6 cases plus 52 P2 cases; external providers are test doubles |
| Candidate build, `node tools/buildCandidate.mjs` | Passed; **48 source-pinned patches** | Mandatory native/playback pins and existing tuple routing retained; separately pinned optional P1/P2 contracts available |
| Optional P2 package build | Passed; **0 warnings / 0 errors** | Real pinned Essential/RPH references, `net481`; packages both authored-owner addons and disabled example config only |
| P2 production native safety/admission/variation policy | **26 assertions passed** | Compiles actual production policy with .NET 10; no game assemblies loaded |
| P2 production Windows control pipe | **10 assertions passed** | Actual `net481` serializer, parser, current-user ACL pipe, request/response correlation, unsupported-operation refusal and nested `IList` appearance shape; unique offline pipe |
| Existing P1 production ownership core | **16 assertions passed** | No game assemblies loaded |
| Existing P1 production Windows factual pipe | **9 assertions passed** | Factual owner channel remains separate from P2 player controls; no game assemblies loaded |
| Actual local editor browser check | Passed | Offline native-owner fixture: promote, rename/personality/traits/relationship edits, create/select/edit a memory, dismiss and summon; same CharacterId, voice and edited values visibly returned |

The full suite passed repeatedly after implementation and final hardening. Both Windows pipe test projects compile with zero warnings/errors. Local sandbox restrictions require allowing the test process to connect to its offline pipe; this is not permission to connect to GTA or deploy an addon.

## Coverage

P2 tests exercise encounter-local stable names across native session replacement, active full-name uniqueness and first-name preference, persistent name/nickname exclusions, bounded RAM-only profiles, explicit naming guidance, and no automatic durable promotion. They cover promotion idempotence, equal models/names remaining distinct, current voice capture, exact selected-target changes, contradictory proof, profile-commit rollback, P1 schema isolation and separate store paths.

Durable coverage includes strict field/size/revision validation, serialized conflicting edits, profile and memory restart/CRUD, exact destructive confirmation, corrupt/unsupported primary preservation, missing-primary backup recovery, failed disk replacement without publication, and bounded immutable Unicode model projections. Actor/listener transport proof, ownership, editor secrets and private notes are excluded from narration and telemetry. Optional projection failure still strips private proof and completes ordinary dialogue.

The actual source-pinned stock controller runs a promote/edit/dismiss/recreate scenario with fresh native ped/session, unchanged permanent CharacterId/voice, empty returning history, and rejection of old PCM, action transcripts and playback completion. Separate tests verify player commands capture an exact current owner token, never silently promote, and reject replacement incarnations. Disabled P2 and stock Gemini preserve their original behavior; unsupported P2 metadata disables management while ambient grounding and supported P1 remain usable.

The loopback editor tests use real HTTP and validate its browser script, profile/memory/control APIs, exact Host/Origin/token checks, malformed Unicode tokens, non-JSON/oversized-body refusal, protected fields and bounded errors. Browser QA separately verifies real form submission and rendered results. Native policy tests cover unavailable/dead/player/scripted/foreign/directed targets, exact incarnation tokens, bounded expiry, request replay, epoch/world mismatch and unavailable model variation slots.

## Reproduce

From `lsa-essential-e1-candidate`:

```powershell
node tools/runTests.mjs
node tools/buildCandidate.mjs
$env:LSA_IDENTITY_RPH_REFERENCE = '<pinned compile-only SDK>\RagePluginHook.dll'
$env:LSA_IDENTITY_FRAMEWORK_ROOT = '<root containing .NETFramework\v4.8.1>'
node tools/buildCharactersAddon.mjs
```

`LSA_BUILD_DOTNET` can explicitly name the .NET executable when it is not on PATH. The full Node runner imports test files in-process, so it does not require Node's subprocess test isolation. No provider credentials are required.

From repository root, with the framework reference root set:

```powershell
dotnet run --project native/promoted-characters/tests/OfflineTests.csproj --verbosity quiet
dotnet build native/promoted-characters/facts-tests/ControlChannelTests.csproj "-p:TargetFrameworkRootPath=$env:LSA_IDENTITY_FRAMEWORK_ROOT"
& native/promoted-characters/facts-tests/bin/Debug/net481/ControlChannelTests.exe
dotnet run --project native/session-identity/tests/OfflineTests.csproj --verbosity quiet
dotnet build native/session-identity/facts-tests/OwnerFactsTests.csproj "-p:TargetFrameworkRootPath=$env:LSA_IDENTITY_FRAMEWORK_ROOT"
& native/session-identity/facts-tests/bin/Debug/net481/OwnerFactsTests.exe
git -c core.whitespace=cr-at-eol diff --check
```

The Windows named-pipe executables require Windows/.NET Framework. The policy/core tests use .NET 10. The repository preserves verbatim CRLF metadata/source (`* -text`); the diff check permits CR at end of line while still rejecting trailing spaces and blank EOF lines.

## Final local build receipts

| Artifact | SHA-256 |
| --- | --- |
| Pinned Essential DLL, unchanged | `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653` |
| Pinned stock bundle, unchanged | `5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2` |
| Mandatory native/playback metadata, unchanged | `18edd2b47ffde748388b07a4a2d023793e183b882fe638acb5276440d45a2d23` |
| Optional P1 metadata, unchanged | `8eac8860c81feacbb5eab557f5769cac1f76a36f061e1eb3640da7096f08cb63` |
| Optional P2 metadata | `9ce200bf1a900d996a6f8471a40be1f439d97aa8f86289e334e51e22d627b2e4` |
| Pinned compile-only RPH SDK | `5d439745604a5fedbf8fa401520d4f296c1b6800d77e2923ba3bf9772182c7e0` |
| Patched launcher | `7b4d461fe14976cd454be4babc0d84c1b350d4753ff378e681e819a02a934cde` |
| Staged companion source tree | `c96874297d533d29f13ef775de98e0b6df7b813eaa704ddba69d956676a52865` |
| Companion payload before manifest | `d0adab431ab8dcf6950ef016a054a167e54f50bac3768cb80874e7884e88427a` |
| Locally built `LSA.PromotedCharacters.dll` | `d0cd7d01bc9ef31775c29d9f362207b2fb722cde007f74af48256416d61fcda4` |
| Locally rebuilt unchanged P1 addon | `fbf5a016b7cecd2890b6ed15d1d0a7d8569c571d65c6f004140e58ac2c3e7cd7` |

Build manifests state `realApiCalls: false`, `gtaRuntimeTest: false` or `deploymentPerformed: false` as appropriate. Native outputs are compile-only local receipts, not universal binary release hashes. Generated payloads, binaries, test stores and private runtime configs are ignored and are not committed.

## Physical acceptance remains open

All [P2 GTA checklist](../../docs/P2-promoted-characters-status.md#verification-and-physical-gta-checklist) boxes remain unchecked. Console/fiber integration, native dispatch, exact physical ped lifetimes, clothing fidelity, safe ground/obstacles, follow/wait/vehicle/self-preservation, genuine mission/cutscene/plugin ownership, and actual playback under interruption require controlled GTA validation. Existing P0/P1/E6 physical gates remain independent.

Unsupported face/head blend/tattoos/customization/inventory and universal per-addon script ownership are not claimed. PERCEPTION, automatic SALIENCE/memory extraction and SCENE_DIRECTOR remain later phases.
