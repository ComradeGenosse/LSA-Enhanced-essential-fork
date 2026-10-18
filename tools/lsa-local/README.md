# Personal LSA tools

Two commands. Paths are already set in `lsa-tools.json`.

On another checkout, copy `lsa-tools.example.json` to `lsa-tools.json` and set
your repository/build paths once. The local file, packages, logs and backups
are gitignored. `%USERPROFILE%` and `%LOCALAPPDATA%` expand automatically.
EssentialSourcePath must be a dedicated build checkout with the existing
licensed `lsa-essential-e1-candidate/upstream` inputs and cached .NET references;
the script refuses tracked edits and never resets a working branch.

```powershell
# Grab GTA/RPH, Essential and standalone logs. No analysis.
.\Collect-Logs.ps1

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
