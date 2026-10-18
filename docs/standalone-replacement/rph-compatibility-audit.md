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

**Version boundary:** GitHub CI currently compiles against the official
RPH 1.124 reference DLL. The locally installed RPH is 1.132.1428.17748.
A passing 1.124 scan is NOT proof of 1.132 compatibility.
The supplied RAGEPluginHook.exe is the managed launcher assembly
(RagePluginHookLauncher) and does not expose Rage.Game.get_GameTime.
The installed API DLL, typically SDK/RagePluginHook.dll, is needed
for authoritative 1.132 verification.

## Run locally without launching GTA

Obtain the genuine, matching API DLL for the installed RPH version.
On Windows, from PR #50's existing worktree:

~~~powershell
$reference = 'D:\RPH-SDK-1.132\RagePluginHook.dll' # change to the real local SDK path
dotnet build native/standalone-host/LSA.Standalone.RageHost.csproj -c Release -t:Rebuild "-p:RphReferencePath=$reference"
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }

.\tools\standalone-gta-smoke\Test-RphCompatibility.ps1 `
  -RphReferencePath $reference `
  -HostDll 'native\standalone-host\bin\Release\net481\LSA.Standalone.RageHost.dll' `
  -CoreDll 'native\standalone\bin\Release\net481\LSA.Standalone.Core.dll' `
  -ReportPath 'out\RphCompatibility.installed-1.132.json'
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
4. Run the compatibility scan with the **actual installed RPH 1.132 API DLL**
   on the new payload. If it passes, run Install-Standalone.ps1 with
   -ExistingInstallation (or -IsolatedProfile for a separate copy).
   The new installer creates a fresh tracked manifest; never overwrite
   deployed DLLs by hand.
5. To return to Essential, stop GTA/RPH, run the matching standalone
   Undo-Standalone.ps1 first, and then restore the verified original
   Essential owner DLLs from the off-game backup. Compare original hashes.
   Never allow both owner implementations to run together.

The scripts are offline checks only. No game launch, smoke test,
game mutation, or merge into main is authorized by this work.
