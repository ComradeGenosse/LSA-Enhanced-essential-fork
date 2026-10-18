# Standalone PR #50: offline RPH compatibility gate

This check is a prerequisite for a GTA test, **not** proof that GTA behavior works.

## What is checked

The packager rebuilds the host using the official RPH reference, then scans the
exact copied standalone host and Core DLLs. It verifies CLR type and member
imports, overloads, generic arity, parameter/return types, static/instance
signatures, visibility, inherited members, and external assembly dependency
names. The JSON report identifies the reference path, assembly identity,
SHA256, scanned DLL paths, and all findings. Unresolved static imports
fail the package job.

**Version boundary (verified October 18, 2026):** The user-supplied official
Discord ZIP `RAGEPluginHook_1_131_1424_17745.zip` contains
`SDK/RagePluginHookSDK.dll` (219,648 bytes). Its SHA256 is
`5D439745604A5FEDBF8FA401520D4F296C1B6800D77E2923BA3BF9772182C7E0`,
**byte-for-byte identical** to the official RPH NuGet 1.124 reference used by
the passing CI scanner. The official ZIP's README instructs developers to
reference `SDK/RagePluginHookSDK.dll`; the name of the SDK file changed, but
its binary contents did not. Both filenames are accepted by the offline
compatibility script **and by the host project's MSBuild reference gate**.
The gate selects the reference by the actual CLR assembly identity
`RagePluginHook`, then verifies its resolved absolute path equals
`RphReferencePath`; it does not assume the physical filename is
`RagePluginHook.dll`. This matters because the fake unit-test SDK also
has CLR identity `RagePluginHook`, and a previous build mistakenly
selected that fake binary rather than the requested official one.
Do not add the RPH SDK to this repository or release artifacts:
the distribution README restricts redistribution.

The user's installed loader reports RPH 1.132.1428.17748 (GTA V Enhanced).
The uploaded 1.131 ZIP is marked for GTA V **Legacy**. We therefore have
conclusive RPH 1.131 SDK *static-API* evidence, not a guarantee of runtime
1.132 Enhanced behavior. The supplied `RAGEPluginHook.exe` is the launcher,
not the SDK assembly. If an official 1.132 SDK becomes available, rerun the
same scan, but do not treat absence of such a file as evidence that 1.131's
reference is incompatible.

## Run locally without launching GTA

Use the **official 1.131 SDK** extracted from the user's ZIP as the currently
verified API baseline, or substitute a genuine 1.132 SDK if available.
The 1.131 SDK is byte-identical to the already scanned official NuGet 1.124
assembly. On Windows, from PR #50's existing worktree:

~~~powershell
$reference = 'D:\RPH-1.131\SDK\RagePluginHookSDK.dll' # use your extracted official ZIP path
dotnet build native/standalone-host/LSA.Standalone.RageHost.csproj -c Release -t:Rebuild "-p:RphReferencePath=$reference"
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }

.\tools\standalone-gta-smoke\Test-RphCompatibility.ps1 `
  -RphReferencePath $reference `
  -HostDll 'native\standalone-host\bin\Release\net481\LSA.Standalone.RageHost.dll' `
  -CoreDll 'native\standalone\bin\Release\net481\LSA.Standalone.Core.dll' `
  -ReportPath 'out\RphCompatibility.official-1.131.json'
~~~

Repeat the check on the exact extracted package's payload DLLs, supplying
-ExpectedHostDll with the newly built host's path. The tool fails if
the packaged host differs by SHA256. The SDK DLL must not be redistributed.

The report is a metadata compatibility result for the SDK scanned.
It cannot verify GTA-native names/hashes dispatched dynamically through
NativeFunction.CallByName or CallByHash; managed reflection, unmanaged APIs,
game state, fibers, ped identities, decorators, audio or visible lip sync
remain runtime gates. Never translate a green static report into a GTA pass.

## Safe update of an existing smoke installation

1. Close GTA, RPH and the standalone Node process. Preserve the verified,
   off-game backup of original Essential binaries, settings, .env,
   profiles, SQLite, your existing local switcher scripts, their tracked
   hashes, the original smoke ZIP, and the previous rollback manifest.
   Some locally customized scripts may not exist on GitHub.
2. Use the old package's Undo-Standalone.ps1 with -GamePath to remove
   the prior manifest-owned standalone DLLs and marker. It validates
   their hashes before removal. If rollback refuses, **STOP** and
   investigate; never bypass hash checks or erase the manifest.
3. Extract the new CI package to a **new off-game directory**; verify
   SHA256SUMS.txt and BUILD_SHA.txt. Diff local switcher copies; do not
   overwrite, reformat, or discard customized local scripts/hashes.
4. Run the compatibility scan against the provided official **1.131 SDK**
   (or the genuine 1.132 SDK if one is obtained) on the new payload.
   Record precisely which reference was used. If it passes and separate GTA
   testing is authorized, run Install-Standalone.ps1 with
   -ExistingInstallation (or -IsolatedProfile for a separate copy).
   The new installer creates a fresh tracked manifest; never overwrite
   deployed DLLs by hand.
5. To return to Essential, stop GTA/RPH, run the matching standalone
   Undo-Standalone.ps1 first, and then restore the verified original
   Essential owner DLLs from the off-game backup. Compare original hashes.
   Never allow both owner implementations to run together.

A passing scan against the official 1.131 SDK and the matching packaged
binary does not prove successful RPH 1.132 Enhanced execution, GTA native
hash behavior, audio or lip-sync; retain the real-GTA acceptance gate.
The scripts are offline checks only. No game launch, smoke test,
game mutation, or merge into main is authorized by this work.
