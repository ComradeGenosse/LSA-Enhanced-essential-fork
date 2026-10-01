# LSA Enhanced Essential Fork

The current E1.1 hardened + Observability companion for Los Santos Alive Essential Hotfix #3, plus its tests, reproducible build inputs, project documentation, deployment tooling, and E2/E3 roadmap.

## Project layout

- [lsa-essential-e1-candidate/](lsa-essential-e1-candidate/README.md): current companion source, tests, build tools, native metadata, and pinned stock reference inputs.
- [docs/plans/](docs/plans/): original mission and native analysis, E2/E3 goals, original plan, revised plan, and review.
- [deployment/](deployment/README.md): explicit installation/verification utilities and installer references. Nothing deploys as part of build or tests.

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

E1.1 and observability are implemented in this candidate. E2/E3 is a reviewed roadmap and has not been implemented by this repository import. See [import provenance](docs/REPOSITORY-IMPORT.md) for fresh verification results.

The prior chat records the hardened E1.1 installation, then a later observability candidate that was not deployed. This import changes neither installation. Live API/GTA checks require their separate explicit opt-in; no such checks are performed by repository setup.

## Plans

Start with the source-grounded [E2/E3 implementation plan](docs/plans/E2-E3-implementation-plan.md), which supersedes the earlier implementation instructions. Keep the [E2/E3 goals](docs/plans/E2-E3-goals.md), [review](docs/plans/E2-E3-plan-review.md), and [declarative plan](docs/plans/E2-E3-revised-plan.mjs) as supporting references. The earlier review's source-availability limitation describes that earlier review; the complete source was subsequently located using the previous chat and imported here. Inspect the actual source interfaces before implementing E2/E3.
