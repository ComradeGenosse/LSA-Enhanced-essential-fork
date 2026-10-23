# X9 — first masonry family (cloud phase 0)

**Status: implemented cloud-only qualification tooling; NO masonry game asset, runtime fracture path, or GTA acceptance.** Built on X8 PR #310 after both A and B fences passed. This branch does not reimplement X8's proven metal-sheet physics, change its projectile/section selector, or enable an incomplete masonry runtime.

## Actual scope

- `candidates.json` contains public-name leads `prop_wallbrick_01`, `prop_wallbrick_02`, `prop_wallbrick_03`; `prop_barier_conc_01a` is a low concrete Jersey-barrier **negative control** that cannot establish full-height walk-through-wall behavior. Public names are **not** proof of actual dimensions, loaded map ownership, current Enhanced compatibility, or isolation of map/YBN/LOD collision.
- `X9Survey.inc.cs` adds **read-only** `x9survey` to a separately generated X8 lab driver via `build_runtime.py`. Requires explicit named coordinates, player already within 35 m, an idle X7/X8 lease and `approved=1`. Never teleports, changes DLSS, spawns, hides, damages or shoots anything. Logs model availability, at-most-16 nearby matching prop rows, nine diagnostic rays across a **user-supplied probe heading** and six ground rays; these rays do **not** establish native object or YBN ownership. A map-owned building with only static collision may never appear in the nearby Prop set. Read collision handle 0 as **unknown world/static collision**, not eligible source.
- `recipe.py` creates a stable, explicitly **NON-DEPLOYABLE** five-section masonry layout from locally attested geometry/collision gates (or a clearly synthetic offline fixture). It does **not** create actual .yft, .ytyp, .ymap, DLC, collision mesh, asset imports, script changes or live registration. Five independent 0..4 roots match the existing X7/X8 physical section-selector indices; two adjacent central sections make a nominal ≥1 m opening. This is a **design constraint**, not a claim that masonry will fracture that way in GTA.
- `proposal.template.json` intentionally has null dimensions, false gates and no evidence; the generator must reject it.
- `test_recipe.py` and `.github/workflows/x9-masonry.yml` test strict candidate/gate admission, geometry, deterministic output, read-only source guards, two generated runtime copies and unchanged X8 baseline.

This scope was chosen because authoring six or eight new root indices while retaining X7's **five physical indices** would silently change the proven impact selector. Use **five** for the first masonry family, with optional extra decorative chip/damage meshes within those assets after real conversion, not a new selector.

## Run cloud/offline tests

```sh
python -m unittest discover -s native/destruction-masonry -p 'test_*.py' -v
python native/destruction-masonry/recipe.py --fixture --output /tmp/x9-synthetic
python native/destruction-masonry/build_runtime.py /tmp/x9-readonly-runtime
git diff --exit-code -- native/fragment-x7/WpsBreachLabX7.3.cs
```

Inspect `/tmp/x9-synthetic/NOT_DEPLOYABLE.txt`: no fixture may be installed. Every real proposal is a locally attested authoring plan, **still not deployable** until source art and GEN9 resources are converted/loaded and original collision is proven removable.

## Conservative decision: what we still do NOT know

A suitable target must be a **genuine independently streamed small freestanding wall** with ≥1.8 m height, 2.7–4.2 m width, 0.15–0.45 m thickness, no shared static YBN/hi@ collision, and room behind it for a player. The public `prop_wallbrick_*` names may represent loose construction props rather than usable world walls. A shortened traffic barrier is not a full-height substitute. Choose the easiest qualifying wall **after** CodeWalker and native evidence; if these names do not qualify, mark them rejected and find a different eligible archetype before creating art. Never fake source availability with an invisible script prop.

Relevant evidence: [public GTA V object list](https://github.com/haarperr/Full-GTA-V-Props-List/blob/master/props%20list.txt), [concrete-barrier model record](https://gtahash.com/ru/objects/MVSk1Tou), X7/X8 source in this repo, [post-X7 asset and collision research in draft PR #302](https://github.com/ComradeGenosse/LSA-Enhanced-essential-fork/blob/347da80c536944c673b34118f32ba10839fd8465/docs/next-gen-gameplay/astra-001/post-x7/README.md). The public list is a discovery aid, not a GTA Enhanced native acceptance.

## Follow-up

See [LOCAL-HANDOFF.md](LOCAL-HANDOFF.md) for the minimal Windows/CodeWalker survey and gates. Once a candidate qualifies, next cloud/local slice should author **real five-root masonry assets**, verify exact native geometry and GEN9 resources, implement a **new explicit family-specific adapter** (never pass a brick model through X8's fence-only hash/`lsa_x7d_secp_j1400`), preserve the original hide/lease/cleanup and X7 automatic impact policy, and only then request **one approved local RPG per qualified site**. Keep standalone lab DLC registration and #308 failure-path restoration separate.

X9 does not claim persistent destruction, multi-hit behavior, buildings, structural collapse, or a city-wide scanner.
