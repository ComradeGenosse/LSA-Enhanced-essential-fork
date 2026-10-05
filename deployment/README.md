# Explicit deployment tools

These scripts are preserved from the current project. Repository setup, build, and tests do not execute them.

- prepare-install.mjs builds an installation stage from a separately obtained stock Hotfix #3 package, the candidate dist payload, and local credentials. It writes a private .env into that stage.
- install-e1.ps1 installs the prepared stage and creates a rollback backup.
- verify-installed.mjs checks the existing installation.
- installer-reference/ retains the installer JavaScript reference files.
- `DEPLOYMENT.md` is historical machine-specific deployment documentation and should not be used by itself to identify the current runtime. Later PS3/UX4 deployment and GTA evidence is recorded in `../docs/PS3-deterministic-salience-status.md` and `../docs/ux4-ps3-run-analysis-20261005.md`; always verify exact payload hashes before claiming the installed game matches current `main`.

Before an explicitly requested deployment, place the matching stock payload under deployment/stock-hotfix3/, build the candidate, inspect the scripts' machine-specific GTA paths, and verify current installation/credentials. Node/ffmpeg runtimes and bulk stock installation packages are local prerequisites, not repository sources. Stages, credentials, install plans/receipts, and backups are ignored.
