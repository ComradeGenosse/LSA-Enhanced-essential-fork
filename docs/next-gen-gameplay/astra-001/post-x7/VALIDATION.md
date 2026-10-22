# Research/prototype verification

Date: 2026-10-22. Baseline: #300 head
`39eb1601e17b770a616cb93c2bda0e337fa305f8`, branch
`fix/x72c-controller-smoke-20261022`. Research branch:
`research/post-x7-reusable-destruction-20261022`.

## Local offline results

| Check | Result / scope |
| --- | --- |
| `python -m unittest discover -s tools/destruction-catalog -p 'test_*.py' -v` | **11 tests pass**. Real custom XML/manifest binding; transformed section positions and nine rays; independent raw-source/twin origins; arbitrary yaw distance invariants; deterministic placement ordering; authored IDs; invalid models/recipes/revisions, scope conflicts, unsupported transforms/nonfinite/huge numbers; XML drift and duplicate JSON rejection; CLI round trip |
| `python tools/destruction-catalog/catalog.py --output ../catalog-compiled.json` | **Pass**. Synthetic fixtures compile; output explicitly marked offline-only. Output is a scratch artifact outside the repository |
| `python -m unittest discover -s native/fragment-x7 -p 'test_*.py' -v` | **12 inherited tests pass** on the unchanged #300 baseline. Does not test #301 |
| `python native/fragment-x7/validate_x7.py` | **Pass**. Unchanged driver SHA256 `da37a140305ae6d3c0b2b8918aef423aa379926eb05e1ceb9e2840df8746642c`; no scripted shot detach/blast assertion retained |
| `python native/fragment-x7/validate_x7d.py --require-exports` | **Pass**. Existing six GEN9 models, bones/bounds/native tuning and checked binary/pack receipt hashes; no new exports or new gameplay claim |
| `python native/fragment-x7/build_fence_x7.py --dry-run --layout sec1` | **Pass**. Existing six recipe sources compile; deterministic authoring fingerprints emitted without Blender |
| `python native/fragment-x7/build_x7.py`, then `git diff --exit-code -- native/fragment-x7/WpsBreachLabX7.3.cs` | **Pass**. Private #300 checkout regenerates byte-identically; no runtime/generator change in the PR |

The new `.github/workflows/destruction-catalog.yml` runs prototype tests,
compilation and existing export-receipt verification on Linux/Python3.10.
Remote CI result belongs to the published PR check run, not this static receipt.
No new C# code, SHVDN build or game-dependent test is introduced here.

## Review and isolation

Independent read-only reviews covered project evidence, upstream source,
architecture and prototype correctness. Review corrections include rejecting
shifted XML origins, unproven source models/threshold recipes and enormous
integer inputs, plus distinguishing visible material mismatch from silhouette
matching and requiring independent section roots for future protection.

Changes are additions only under:

- `docs/next-gen-gameplay/astra-001/post-x7/`
- `tools/destruction-catalog/`
- `.github/workflows/destruction-catalog.yml`

#301's changed-file list was inspected again before publication, including its
later `X73-CLOUD-CODEX-HANDOFF.md` addition. There is no changed-file overlap.
No active driver, generator, selector, assets, controller, installer, roadmap or
other agent's checkout was changed. All source inspection used a private clone
pinned to #300; parallel investigators were read-only.

GTA was not launched. No installation, deployment, Windows configuration change,
toolchain installation/upgrade or Rockstar asset extraction/redistribution was
performed. Existing gameplay images and structured evidence were reviewed;
those historical results retain their original candidate/weapon/site limits.

## Remaining validation

X8 runtime integration is future work. Two real placement records, two-instance
native behavior, model-hide neighbor scope, automatic-selection acceptance,
runtime resource budgets, serial impacts, streaming, persistence and building
collision remain unverified here. [HANDOFF.md](HANDOFF.md) separates the cloud
implementation from the small later local GTA acceptance. This research PR
remains draft and makes no request to merge its stacked dependencies.
