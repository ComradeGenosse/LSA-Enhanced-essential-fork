# EA9 release packaging, provenance and reversible isolated deployment

Status: tooling only until **Agent F combined HEAD** passes the complete matrix and GTA operator signs receipts. Do not stage from main, EA9 alone or five unrelated working trees. No tool here installs into the active game or contacts ElevenLabs.

## Exact-head offline sequence

From a single clean checkout at the final F integration SHA (not PR merge pseudo-SHA):

~~~bash
HEAD=$(git rev-parse HEAD)
node --version # must be Node 24.x for EA6 native SQLite
node tools/ea9/matrix.mjs --run --require-combined --expected-head "$HEAD" --report ea9-combined.json
cd lsa-essential-e1-candidate && npm test && cd ..
python tools/isolated-offline-tests/run.py "$PWD/lsa-essential-e1-candidate"
~~~

Windows CI additionally runs pinned production RPH/RNUI/DamageTracker DLL compilation and native C-05, ACT, PS, Director, host, lifecycle, input and ABI tests. The separate Node22 matrix runs JSON-only compatibility tests; Node22 does not grant SQLite release readiness. Save exact HEAD, job URLs, node/platform, reports and exit codes; never borrow successes from independent PRs. A missing EA5-EA8 suite yields BLOCKED in the matrix, and --require-combined fails.

## Release stage contract

Agent F assembles a **new temporary release directory** from one clean checkout after the candidate builder has produced its candidate manifest. A representative layout:

~~~text
<release-root>/
  plugins/LosSantosAlive.dll
  plugins/LosSantosAliveServer/server.bundle.mjs
  plugins/LosSantosAliveServer/build-manifest.json
  plugins/LosSantosAliveServer/e1/...
  plugins/lsa-shared-brain/src/characters/...  # if relative imports still resolve here
  plugins/LSA.PromotedCharacters.dll
  plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Bootstrap.dll
  plugins/LSA.PromotedCharacters/LSA.PromotedCharacters.Runtime.dll
  plugins/LSA.PromotedCharacters/LSA.SessionIdentity.dll
~~~

This is a **required import-resolved topology**, not permission to guess shared-brain copies. EA6 imports ../../.. relative to its Essential character modules. The verifier checks each actual static relative import inside the release stage, compares staged Essential source with the **checked-out** source tree, and rejects missing SQLite/EA5 modules. If Agent F relocates a shared dependency, update its imports in the final source and rebuild; do not silently copy a second conflicting implementation. Native runtime C# output is not the stock LosSantosAlive.dll; seal requires both pinned stock Core SHA-256 AND four rebuilt native plugin DLLs.

Create a temporary native-inputs.json containing exactly the observed source output paths from pinned SDK production compilation. For each entry include staged relative path and repo-relative compiled output, e.g.:

~~~json
[
  {
    "staged": "plugins/LSA.PromotedCharacters.dll",
    "compiled": "native/promoted-characters/bin/Release/net481/LSA.PromotedCharacters.dll"
  }
]
~~~

Include Loader, Bootstrap, Runtime and SessionIdentity with their real compiled paths (the example is illustrative; do not invent paths). Both seal and verify require these files to exist and their SHA-256 to agree. Include any required native RPH/Core dependencies already present in the isolated target, verified against pinned assembly requirements.

~~~bash
node tools/ea9/verify-release.mjs seal --release-root "<temp-stage>" --expected-head "$HEAD" --native-inputs "<native-inputs.json>"
node tools/ea9/verify-release.mjs verify --release-root "<temp-stage>" --expected-head "$HEAD" --native-inputs "<native-inputs.json>"
~~~

Sealing requires Node24, clean tracked and untracked source, exactly matching candidate build-manifest bundle hash and source tree, correct pinned stock DLL, complete package module dependency graph, all four compiled native outputs, and no private .env / node_modules. An **exclusive** new EA9 manifest records every staged file hash and the exact source HEAD. Verify refuses deleted/new/modified files, incomplete manifest, stale or mixed native DLLs and incorrect source. Candidate-manifest or source pin revisions are **Agent F-only**.

## Isolated install precondition

Create or select a separate GTA Enhanced test installation outside Program Files and Steam steamapps/common. Use a fresh OS profile or export and hash external app-data files beforehand: the tool snapshots the whole target/plugins tree, but **cannot** automatically protect voice/configuration or SQLite data kept outside that isolated target. These must be copied separately or the test remains BLOCKED. Never point the script at the currently played game. Close GTA, RAGE, companion Node, profile editor and all SQLite writers.

Manually create <isolated-target>/.ea9-isolated-test-install.json with:

~~~json
{
  "ea9IsolatedTest": true,
  "notActiveInstall": true,
  "explicitOperatorApproval": true
}
~~~

The folder must contain its own GTA5_Enhanced.exe. This marker is a conscious operator declaration, not an inferred location. Pick a new unused backup folder outside the isolated target and release stage. Optional state-paths.json is a list of additional **target-relative** files or directories outside plugins (for example data/voice-assignments.json). Out-of-target paths and symlinks are rejected.

~~~bash
node tools/ea9/isolated-deploy.mjs deploy --target "<isolated-target>" --release-root "<temp-stage>" --backup-root "<unused-backup-folder>" --expected-head "$HEAD" --ack-isolated --state-paths "<state-paths.json>"
node tools/ea9/isolated-deploy.mjs verify --target "<isolated-target>" --backup-root "<unused-backup-folder>" --expected-head "$HEAD" --ack-isolated
~~~

The deploy tool verifies stage contents BEFORE any mutation. It copies and SHA-256-verifies the ENTIRE original plugins tree: DLLs, settings, JSON, SQLite databases and WAL/SHM, voice assignments and unrelated mods, plus declared additional state. Then it overlays only manifest-listed release files. It leaves original plugin trees and unrelated files in place during evaluation. Backup errors prevent deployment. On interrupted installation, **run explicit rollback** (do not assume an automatic revert happened):

~~~bash
node tools/ea9/isolated-deploy.mjs rollback --target "<isolated-target>" --backup-root "<unused-backup-folder>" --expected-head "$HEAD" --ack-isolated
~~~

Rollback is allowed only after validating the original backup receipt and its hashes. It restores the complete pretest plugins snapshot (including absence of newly introduced files) and the declared additional state, then checks every original content hash. Hash failure is a hard stop: do not restart GTA until reconciled. Record before/after SHA-256 and external-profile restore proof.

## Evidence and limitations

The release verifier is read-only except for creating a new manifest on seal. The isolated deployment tool makes changes **only** after an explicit marked target and approval flag, and was NOT invoked against any real game by EA9. A test using a temporary dummy isolated target proves algorithmic rollback behavior, **not** that the actual RAGE loader starts or that audio is audible.

The original deployment/prepare-install.mjs and install-e1.ps1 target a preconfigured active Steam path. **Never run them for EA9.** Use the source-bound EA9 tools, then follow GTA-ACCEPTANCE.md and the separate paid A/B procedure.
