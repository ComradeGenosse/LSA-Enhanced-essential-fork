# Action-native research tools

Research-only extractors for the 2026-10-03 Essential action-execution / physical-completion audit.

They **never load, reflect over, or execute** `LosSantosAlive.dll`, Policing Redefined, or any RAGE/GTA assembly. The C# reader treats the DLL as bytes (`PEReader` + `System.Reflection.Metadata`). The Python decoders read that JSON.

Do not point these tools at a live `plugins` copy unless you first hash-compare it to the pinned upstream bytes.

## Pins this investigation used

| Artifact | SHA-256 |
| --- | --- |
| `lsa-essential-e1-candidate/upstream/LosSantosAlive.dll` | `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653` |
| `lsa-essential-e1-candidate/upstream/server.bundle.mjs` | `5d81de4217bd103316a1083e482ded1bddc791314abf671d686036175c0475f2` |
| `lsa-essential-e1-candidate/docs/native-metadata.json` | `18edd2b47ffde748388b07a4a2d023793e183b882fe638acb5276440d45a2d23` |

`ActionNativeAudit` refuses to emit JSON if the input hash does not match the pin in `Program.cs`.

## Reproduce the PE/IL extract

Requires .NET SDK 10. Write output **outside** the repo (the prior session used `.../action-audit-scratch/`). Large: ~66 MiB for Essential.

```powershell
$scratch = "C:\Users\Chris.COMRADE\Documents\Codex\2026-10-03\set-a-x20\work\action-audit-scratch"
$proj = "docs/research/action-native-tools/ActionNativeAudit.csproj"
$dll = "lsa-essential-e1-candidate/upstream/LosSantosAlive.dll"
dotnet run --project $proj -c Release -- essential $dll "$scratch\essential-il.json"
```

Optional PR-bridge extract uses the `prbridge` pin in `Program.cs`.

This is a research metadata compile, not `buildCandidate` / `buildCharactersAddon`.

## Decode and walk IL

From a working directory that can import this folder:

```text
ilcore.py          Module loader, string-table decode (seed 1907038128 / init 0x600000c)
cff.py             Control-flow unflattening
registrations.py   NpcActionRegistry.Register recovery
handlers.py        Handler boolean classification
commands.py        NpcActions shared-executor (m0x60002e4) recovery
```

The string decoder is the same XOR-feedback + LZMA procedure proven on `research/remaining-native-context-audit`. If a name is still obfuscated, keep the method token.

## What not to do

- Do not `Assembly.Load` the game DLL.
- Do not execute extracted IL.
- Do not change production runtime behavior from these tools.
- Do not treat `OnNpcActionExecuted(..., true)` or `TryExecute == true` as physical completion. See the parent audit.
