# LSA Enhanced Essential Fork

The E1.1 hardened + Observability companion for Los Santos Alive Essential Hotfix #3, extended with the offline E2/E3 provider, voice, and retry implementation, plus tests, reproducible build inputs, documentation, and deployment tooling.

## Project layout

- [lsa-essential-e1-candidate/](lsa-essential-e1-candidate/README.md): current companion source, tests, build tools, native metadata, and pinned stock reference inputs.
- [docs/plans/](docs/plans/): original mission and native analysis, E2/E3 goals, original plan, revised plan, and review.
- [deployment/](deployment/README.md): explicit installation/verification utilities and installer references. Nothing deploys as part of build or tests.
- [docs/ROADMAP.md](docs/ROADMAP.md): current project roadmap from E1/E1.1 through streaming, durable NPC identity, perception, autonomy, and E7 acceptance.

## Build and test

Use Node 20.19+; this import is verified with the installed workspace Node runtime.

~~~powershell
cd lsa-essential-e1-candidate
node tools/runTests.mjs
node tools/buildCandidate.mjs
~~~

The test harness disables provider network access. The build verifies pinned stock/native hashes and writes only under the candidate's ignored dist directory. It does not launch GTA, install into GTA, or call OpenAI. Vendored Acorn is included; these commands do not require npm install.

## Credentials

Credentials remain local. Copy lsa-essential-e1-candidate/.env.example to .env inside that directory and fill it locally when live API testing is explicitly requested. Public defaults are in e1.config.example.json. A GitHub login is separate from an OpenAI API key.

Git ignores private environment/configuration files, runtime logs, generated audio/build outputs, local SDK caches, deployment stages, and rollback backups. The preserved upstream DLL and stock server bundle are pinned offline build inputs, not locally generated outputs; see their [provenance](lsa-essential-e1-candidate/upstream/README.md). Existing upstream/vendor notices remain intact; this import does not assert new licensing over those inputs.

## Current status

E1.1, observability, and the offline E2/E3 implementation are present in this repository. See the [E2/E3 implementation status](docs/E2-E3-implementation-status.md) for architecture and validation. Live API and GTA checks remain separate release gates. See [import provenance](docs/REPOSITORY-IMPORT.md) for the original repository verification.

The prior chat records the hardened E1.1 installation, then a later observability candidate that was not deployed. This import changes neither installation. Live API/GTA checks require their separate explicit opt-in; no such checks are performed by repository setup.

## Plans

The source-grounded [E2/E3 implementation plan](docs/plans/E2-E3-implementation-plan.md), [goals](docs/plans/E2-E3-goals.md), [review](docs/plans/E2-E3-plan-review.md), and [declarative plan](docs/plans/E2-E3-revised-plan.mjs) remain as design records. The full candidate source was imported into this repository before implementation.
