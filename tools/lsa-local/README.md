# Personal LSA tools

OBS3 adds a third, fully offline diagnostic command. Paths are already set in `lsa-tools.json`.

On another checkout, copy `lsa-tools.example.json` to `lsa-tools.json` and set
your repository/build paths once. The local file, packages, logs and backups
are gitignored. `%USERPROFILE%` and `%LOCALAPPDATA%` expand automatically.
EssentialSourcePath must be a dedicated build checkout with the existing
licensed `lsa-essential-e1-candidate/upstream` inputs and cached .NET references;
the script refuses tracked edits and never resets a working branch.

```powershell
# Grab GTA/RPH, Essential and standalone logs, plus OBS2 inventory and
# sanitized source/build evidence. Does not connect to the running game.
.\Collect-Logs.ps1

# Run AFTER collecting. Python 3.9+ standard library; no packages or network.
py -3 .\Analyze-Logs.py .\logs\logs-YYYYMMDD-HHMMSS-xxxxxx.zip

# Writes sibling directory logs-...-analysis\report.md and report.json

# Fetch, build/download, back up and deploy. Does not launch GTA.
.\Deploy-LSA.ps1 -Mode Essential
.\Deploy-LSA.ps1 -Mode Standalone

# Start the configured standalone smoke separately, after deployment.
.\Run-Smoke.ps1
```

Close GTA/RPH and the LSA server before deploying. Use a PowerShell window with
permission to modify the game folder. The commands reuse the existing Essential
build/deployment script and the two tested mode-switch scripts in `existing/`.
Settings, credentials, profiles, databases and unrelated mods stay in place.

Essential defaults to GitHub `main`. Standalone defaults to PR #50 and requires
a successful CI artifact for that exact commit. GitHub authentication comes from
the existing Git credential helper or `GH_TOKEN`/`GITHUB_TOKEN`.

Add `-PrepareOnly` to either deploy command to fetch/build without changing the
game. Standalone packages are kept under `packages/`; `Run-MySmoke.ps1` inside
the selected bundle starts the automated test separately with your saved user
API key, `gpt-6-luna`, `gpt-4o-mini-tts`, and `nova`.

Log ZIPs go under `logs/`. Deployment backups and receipts go under `backups/`.
The existing Essential/standalone parking folder remains the configured
`SwitchBackupPath`. Failed or incomplete copies are reported rather than hidden.

To return without downloading/rebuilding Essential, run the existing switcher:
`existing/Switch-To-Essential.ps1 -GamePath '<game>' -BackupPath '<switch backup>' -PackagePath '<current standalone package>'`.
The smoke command authorizes the automated NPC adoption/audio/lip-sync test;
`-PreflightOnly` validates it without launching. No key is saved in this repo.
Standalone runtime source remains on PR #50; these tools consume its CI package
and do not merge that experimental runtime into main.


## OBS3: How to read a single log ZIP

Run the existing `Collect-Logs.ps1` after an ordinary GTA session; close GTA
first for a more complete snapshot. The archive includes existing RPH and E1
logs, `obs2-inventory-<run>.jsonl`, copy/hash inventory, collection metadata,
and allowlisted build/deployment evidence. It **never** copies the raw
`e1.config.json`, `.env`, character profiles, databases, build manifests
or user keys. Existing raw RPH log collection can still contain sensitive
gameplay data: review ZIPs before sharing them.

Run `py -3 .\Analyze-Logs.py <zip-path>` on Windows, or
`python3 Analyze-Logs.py <zip-path>` on macOS/Linux. Use
`--output <directory>` to choose the destination.

The resulting `report.md` and `report.json` enumerate all capabilities in
the collected OBS2 inventory, including disabled and unexercised ones. Health
states are evidence-based: operational, ready but not exercised, disabled,
blocked, degraded, unknown. They are not global "everything works" guesses.
A manifest proves code/registry enumeration, **not** that a DLL was deployed
or loaded; even a hashed file's presence is not proof that RPH loaded it.
Successful provider output does not prove native action or audible speech.

The analyzer reads ZIP entries directly (no extraction), requires no game
connection, and never fetches an API. It reports missing sources, duplicate
or missing sequence records, telemetry losses, unmatched OBS2 manifest hash,
lack of shutdown evidence, absent terminal receipts and missing correlations.
It does **not** bridge unstructured RPH logs into an E1 run without native
identity evidence. A ZIP without an OBS2 inventory cannot produce a complete
matrix; it reports that coverage gap rather than inventing missing rows.
