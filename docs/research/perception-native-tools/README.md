# Focused perception/scheduling research proofs

These tools resolve native event availability and compatibility decisions in [the architecture](../perception-salience-scene-director-architecture.md). They are research tools, not a game addon or PS implementation. They never load/invoke the inspected game assemblies, run GTA, contact providers/IPC, install software or write character stores.

`Program.cs` uses .NET PE metadata readers and decodes selected method bodies as data. It checks the exact Essential or damage-library SHA-256 before parsing, exports a narrow public-contract inventory and requested IL, and fails if a requested method is missing. Numerical metadata tokens are supported so the reproduction command contains no invisible obfuscated member names. No NuGet packages are required; a .NET 10 SDK and Node >=20.19 are needed.

`summarize-evidence.mjs` emits compact public signatures and selected IL excerpts. Complete short methods establish the empty/false gunshot methods and direct helper calls. Excerpts of longer obfuscated methods establish call/field references, **not** complete control flow, delivery guarantees or GTA behavior. The full generated JSON retains branch targets/IL hashes for further inspection. The checked-in `evidence.json` is reproducible byte-for-byte.

`verify-source-seams.mjs` imports actual P2 validators and projection. Its eight assertions establish the automatic-memory API/schema gap, current manual selection limit, private-field omission and memory bound without doing a store write. It does not test a proposed scoring algorithm or pretend the PS pipeline exists.

Run from any PowerShell location, supplying the *shipped* damage DLL already available from the installer/runtime and a scratch output directory:

```powershell
./docs/research/perception-native-tools/reproduce.ps1 `
  -DamageDll 'D:/existing-installer-or-game/DamageTrackerLib.dll' `
  -OutputDirectory 'C:/path/to/scratch/perception-proof'
```

Adjust these example paths to real files. The script writes only probe/build artifacts and the supplied scratch directory; it never downloads/deploys either DLL. Essential's checked-in upstream DLL is used automatically. Both binaries must match these research pins:

| Input | SHA-256 |
| --- | --- |
| Essential Hotfix #3 | `9b6de42d4c464901d859dd95e17e100e4fa9ef6074bfbb0cf3a57a76f6ddd653` |
| Shipped DamageTrackerLib | `64816a0d1131a6ec241f8951902b08afaee86fb0f73693399edefe2db8776750` |

Build outputs are ignored locally. The dependency binary and full IL dumps are not committed. The damage signature establishes available payload fields/handler shape; attacker/target fidelity, delivery loss, actual callback domain/fiber and physical results require the architecture's GTA checks. Existing Essential owns the running damage service; the proposed adapter subscribes and must not start/stop another instance.

Research validation on October 3, 2026: existing companion suite **294 passed / 0 failed**, source-seam proof **8 passed**, successful metadata extraction of both pinned binaries, byte-for-byte evidence regeneration, and pin-mismatch rejection before parsing/output. Probe build: zero warnings/errors. No new intelligence feature, runtime game behavior or live API validation is claimed.
