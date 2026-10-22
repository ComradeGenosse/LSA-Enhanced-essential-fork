# X7.2c + P2 controller integration

Merges PR #297 (controller, runbook) into the X7 branch head `ee8611be` (X7.2c selective fracture pass). Offline only: nothing installed or launched.

- `WpsBreachLabX7.3.cs`: P2 adapter and X7.2c edits are in disjoint regions and were merged and read through. Driver SHA-256 `b00eccae…` (live-passed X7.2c) becomes `da37a140…` (P2 added, not yet run in game).
- `build_x7.py`: nine-patch `P2_PATCHES` layer; regeneration is byte-for-byte (fixes the #297 regeneration CI failure).
- `x7cmd.py` stays retired; `RESULTS.md` keeps Astra's generated table plus the X7 erratum.
- `AGENTS.md` has a short PC/GTA section; `CLAUDE.md` imports it.
- `smoke_x72c.py`: one trial through the controller with separate command / gameplay / world verdicts.
- Checked offline: 16 controller tests, 16 C# protocol scenarios, X7 regeneration/validators, and a full compile against the real `ScriptHookVDotNet3.dll` (0 errors).

Live smoke: not yet run. Record `verdict.json` here when it is.
