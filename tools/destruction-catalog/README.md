# Offline destruction catalog experiment

This is the small prototype for the [post-X7 recommendation](../../docs/next-gen-gameplay/astra-001/post-x7/README.md).
Python 3.10+, standard library only. No GTA, Blender, installation or binary export.

From the repository root:

```sh
python -m unittest discover -s tools/destruction-catalog -p 'test_*.py' -v
python tools/destruction-catalog/catalog.py --output /path/to/new/compiled.json
python native/fragment-x7/validate_x7d.py --require-exports
```

Use an existing parent directory for `--output`; omitting it prints JSON to stdout.
The last command verifies the existing binary export/pack receipts; the compiler
itself checks only the source XML/manifest contract. Neither proves new gameplay.

The definition binds the existing five custom j1400 `sec1` fragments to the source
model `prop_fnccorgm_02e`. Physical indices run from negative U to positive U,
with the post in position 0. The compiler reads existing asset widths, checks
two groups/bones, root strength, child tuning, archetypes and model allowlist,
then emits five section origins and nine original-collision witness rays per
instance. Hashes identify the XML/manifest inputs. No new assets are copied.

Placements use explicit authored IDs and a right-handed orthonormal U/T/V basis
matching `Lab.Rt/Fw/Up`; no compass/heading convention is guessed. Source model
origin (raw map pivot used for matching/hide) and replacement bottom-centre (used for spawning)
are separate fields. Scale, shear, mirroring, tilt, duplicate IDs, unknown fields,
nonfinite values and potentially overlapping hide scopes are rejected.

Both included placements are **synthetic geometry fixtures, not Los Santos
coordinates or an approved world catalog**. The second rotates 90 degrees and
uses distinct source/twin origins to exercise an easy-to-miss offset bug. Runtime
admission must still validate current model/transform, nearby unlisted props,
collision ownership, all layers, source/twin witnesses and loaded pack hashes.
The adapter must measure the source-to-twin offset, including any spawn lift;
the compiler does not infer it from a bounding box. Witness rays use the twin's
sheet frame and must be validated against the source at each real placement.
The compiler cannot establish those facts. Its 0.30m conflict check is a
conservative offline guard for the existing 0.15m hide radius, not a guarantee
about undocumented native sphere semantics.

Output is explicitly `OFFLINE_CONTRACT_ONLY_NOT_RUNTIME_INPUT`. There is no
runtime reader, impact selector, damage engine, persistence store or automatic
asset conversion here. Only the current upright five-strip family is supported.
Adding a second asset should extend a small family adapter after its geometry
and collision gates pass, rather than imply that arbitrary meshes already work.
