# Native context investigation tools

These tools support the [addendum](../character-aware-native-runtime-audit-addendum.md). They are investigation-only and are not imported by production or added to the release build. Evidence files contain program IL/source and synthetic probe results, not dialogue, personas or real integration records. Public SDK/provider DLLs and generated executables are not committed.

## Reproduce static/offline results

Run from the repository root on the audited main baseline. Requirements: .NET SDK 10, Python 3.10+ (standard library including LZMA), Node with the repository's vendored Acorn. No NuGet dependencies are required by `NativeAudit.csproj`. Use a scratch directory outside tracked sources; PowerShell example:

```powershell
$auditScratch = Join-Path $env:TEMP 'LsaNativeContextAudit'
New-Item -ItemType Directory -Force -Path $auditScratch | Out-Null
dotnet build docs/research/native-context-tools/NativeAudit.csproj
dotnet docs/research/native-context-tools/bin/Debug/net10.0/NativeAudit.dll lsa-essential-e1-candidate/upstream/LosSantosAlive.dll "$auditScratch/essential-il.json"
python docs/research/native-context-tools/audit.py "$auditScratch/essential-il.json" docs/research/native-context-evidence
python docs/research/native-context-tools/inventory.py "$auditScratch/essential-il.json" docs/research/native-context-evidence/scope-index.json
```

`NativeAudit` reads PE metadata and bytes without loading the target assembly or resolving its game dependencies. `audit.py` fails on the wrong SHA-256, extraction errors or unknown IL opcodes. It decodes the pinned module string data, preserving exact constants and branch targets. Its interpreter permits only three classifier tokens and their pure string wrappers, has an instruction limit, and rejects unknown calls. The suite comprises 2,827 ASCII cases. Python uppercase/strip adapters serve those samples only; pseudocode specifies .NET invariant uppercase/Trim/whitespace behavior. Do not use this harness as a Unicode compatibility oracle or as proof that a string is a reachable GTA model name.

The decoder is specific to the two pinned assemblies. It recovers the seed/XOR-feedback/LZMA data directly from extracted RVA bytes; it never executes the obfuscated module initializer. Full extracted JSON is scratch data; the committed IL contains selected **complete** bodies and short wrappers. `inventory.py` indexes **all** Essential method bodies independently of that selection. `HandleProbe.cs` is explicitly excluded from the metadata reader's compilation.

Optional provider reproduction requires independently obtained binaries matching the report's hashes. Do not substitute another version under the same evidence claim. The PR bridge input is the already-installed `plugins\LSPDFR\LosSantosAlive.PRBridge.dll` inspected in this investigation. The CDF input is `lib\net48\CommonDataFramework.dll` from the [official NuGet 1.0.0.6 package](https://www.nuget.org/packages/CommonDataFramework/1.0.0.6); it is not the installed game's provider.

```powershell
# Set these to the independently acquired input files.
$auditBridge = 'PATH-TO-PINNED-LosSantosAlive.PRBridge.dll'
$auditCdf = 'PATH-TO-CDF-1.0.0.6-CommonDataFramework.dll'
dotnet docs/research/native-context-tools/bin/Debug/net10.0/NativeAudit.dll $auditBridge "$auditScratch/prbridge-il.json"
dotnet docs/research/native-context-tools/bin/Debug/net10.0/NativeAudit.dll $auditCdf "$auditScratch/cdf-il.json"
python docs/research/native-context-tools/audit.py "$auditScratch/prbridge-il.json" docs/research/native-context-evidence --bridge
python docs/research/native-context-tools/inventory.py "$auditScratch/essential-il.json" docs/research/native-context-evidence/scope-index.json --bridge-il "$auditScratch/prbridge-il.json" --cdf-il "$auditScratch/cdf-il.json"
```

Verify the merged baseline before the new edge probes:

```powershell
Push-Location lsa-essential-e1-candidate
node tools/runTests.mjs
node tools/buildCandidate.mjs
Pop-Location
node docs/research/native-context-tools/openai-edges.mjs docs/research/native-context-evidence/openai-edges.json
node docs/research/native-context-tools/stock-functions.mjs ia hO lO EO Ev _O yO mT sM aM Jv Zi WP Ei qK pd Ed Xn > docs/research/native-context-evidence/stock-boundaries.txt
git apply --cached --check docs/research/native-context-tools/proposed-demographic-guard.patch
```

`stock-functions.mjs` parses the built bundle and prints exact selected function declarations; `--contains TERM...` searches within declarations. On Windows PowerShell 5, redirected text is UTF-16 by default; convert the source excerpt to UTF-8 before committing. No script source is evaluated by this AST reader.

`openai-edges.mjs` uses `stockHarness('openai')` with current production modules. Real paths: actor `ia/hO/EO/Ev`, stock `Zi/WP/Ei/zP/qK/pd/Ed/Xn`, runtime, voice resolver, OpenAIConnection and provider HTTP retry. Doubles: HTTP Responses/TTS, native ACK/playback events, unrelated `BK` prompt text, `GK` Gemini voice choice, diagnostics and `Ur` retired-turn sweeping. No network call is made; an unexpected endpoint fails. Synthetic inputs and responses are not printed as dialogue. The replacement probe waits for prior turns to settle, so the `Ur` double does not characterize replacement of an actively playing turn. The model-response gate orders PR refresh after assignment without pretending to delay an installed PR worker.

Six scenarios assert unknown custom stability with bridge-shaped identity, the accepted private-gender counterexample plus VM-only proposed guard, delayed PR, omitted PR, multi-voice forceNew/retry, and default singleton replacement. JSON contains the exact configuration and observed IDs/voices. Synthetic PedIds `17`/`18` are test labels, not claims about `PoolHandle.ToString()` formatting.

## Observational GTA probe

**Status: compile-tested, not installed or run.** Use only after GTA/RPH is already running normally and the operator has an appropriate naturally occurring lifecycle scenario. The probe creates/deletes no entities, issues no tasks, changes no persistence, and sends no LSA/PR requests. It holds managed references only.

Compile `HandleProbe.cs` separately against the [public RPH SDK package 1.124](https://www.nuget.org/packages/RagePluginHook/1.124.0). This is the compile-time API tested here; compatibility with the Enhanced runtime remains unverified. Use absolute/backslash paths with Framework csc (forward-slash relative source paths can be misparsed):

```powershell
$auditSdk = 'PATH-TO-SDK\lib\net472\RagePluginHook.dll'
$auditSource = (Resolve-Path docs/research/native-context-tools/HandleProbe.cs).Path
$auditOutput = Join-Path $auditScratch 'HandleProbe.dll'
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:library "/out:$auditOutput" "/reference:$auditSdk" $auditSource
```

Manual operator procedure:

1. Place the compiled plugin in a chosen RPH plugin location and manually load `HandleProbe.dll`. Do not replace any game/provider DLL. Load after LSA is ready so its already-loaded assembly and stores can be observed.
2. Stand near a ped whose lifecycle can be followed, then run console command `NativeAuditWatchNearest`. It chooses the nearest valid non-player among at most 16 nearby peds. Confirm the chosen model/position in the CSV; the command does not make it persistent. At most eight references are watched.
3. Use `NativeAuditMark before-travel` / `after-travel`, `before-stream-out` / `after-stream-back`, `before-release` / `after-release`, `recreated-candidate`, `callout-persistent`, or `callout-ended` around **already-authorized normal gameplay events**. Marking does not cause that event. No other free-form reason is accepted. Do not add spawn/delete/teleport/mission commands to this probe.
4. Watch naturally appearing candidates with `NativeAuditWatchNearest`. Same full PedId after an invalid sample produces `handle-seen-after-invalid`; a watched reference becoming valid again produces `exists-after-invalid`. These are candidate observations, not automatic logical-identity or unrelated-reuse verdicts.
5. Run `NativeAuditStop` to flush and stop sampling. CSV is under `native-context-audit-logs` beside the loaded probe DLL. Remove the investigation plugin after the run through normal manual file management.

Allowed CSV columns only: UTC timestamp, fixed event/reason, full `ped.Handle.ToString()` PedId, `ped.Model.Name`, existence/dead status, x/y/z rounded to 25 m, `NpcState` dictionary membership, continuity-memory dictionary membership. No names, birthdays, records, dialogue, persona text, exception messages or arbitrary notes are logged. State checks resolve fields `0x040002b4` and `0x04000435` only if the already-loaded Essential file matches the pinned SHA. They check raw dictionary membership even for an invalid ped, without calling state-creating `GetState` or PR `GetPedData`. Missing/mismatched assemblies and read failures yield `unknown`.

Interpretation requirements:

- Record the run's GTA/RPH/LSA versions/hashes separately in the addendum, without private records. Preserve actual CSV rows with their timestamps; do not fabricate expected sequences.
- Same-looking peds and matching models/positions do not prove an entity or logical persona survived streaming. Keep that conclusion UNKNOWN without independent lifecycle evidence.
- A 500 ms sample interval gives an interval bound between last valid/first invalid/first candidate, not an allocator's exact reuse time. Unobserved brief transitions and handles outside the eight-reference sample remain unknown.
- An invalid old reference later reporting existence may be a reused handle or another runtime behavior; a full paired sequence and naturally observed entity transition are necessary to establish unrelated reuse. No slot/generation-bit assumption is permitted.
- Store membership means a key exists, not that its record belongs to a newly seen NPC, or that a durable identity survived. Coarse position supports correlation only.
- Managed reference retention itself is not a persistence flag, but runtime effects of this probe remain unverified until used. Stop if it errors or perturbs normal gameplay; report the limitation rather than adding invasive instrumentation.

## Separate proposed fix

`proposed-demographic-guard.patch` is an unapplied review artifact described in the [proposal](../native-context-proposed-identity-merge-fix.md). Both `git apply --cached --check` and `git apply --check` passed against production sources. With `--check`, no index or working-file change occurs. The diff preserves the baseline Git blob's CRLF context; the local `.gitattributes` prevents newline conversion and permits whitespace required by unified-diff context. The VM-only wrapper in the edge probe validates the intended OpenAI exclusion predicate; no production feature or release output uses that wrapper.
