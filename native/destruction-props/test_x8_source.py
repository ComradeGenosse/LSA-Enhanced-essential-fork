"""X8 cloud-only integration contract. Gameplay/native collision require P2 acceptance."""
from pathlib import Path
root = Path(__file__).resolve().parents[1]
x7 = root / "fragment-x7"
package = root / "destruction-props"
source = (x7 / "WpsBreachLabX7.3.cs").read_text(encoding="utf-8")
generator = (x7 / "build_x7.py").read_text(encoding="utf-8")
bridge = (package / "X8RuntimeAdapter.inc.cs").read_text(encoding="utf-8")
catalog = (package / "X8Catalog.cs").read_text(encoding="utf-8")
selector = (x7 / "selection" / "ImpactSectionSelector.cs").read_text(encoding="utf-8")
assert "s = apply_x8(s)" in generator and "s = apply_live_selector(s)" in generator
assert generator.index("s = apply_live_selector(s)") < generator.index("s = apply_x8(s)")
assert source.count(bridge) == 1, "generated adapter must match source byte-for-byte"
catalog_body = catalog.replace("using System;\n", "", 1).replace("using System.Collections.Generic;\n", "", 1).lstrip()
assert source.count(catalog_body) == 1, "pure X8 lifecycle must be embedded verbatim"
assert source.endswith(selector[len("using System;\n\n"):]), "X7 impact selector remains last and unchanged"
assert 'bool x8Enabled = false;' in source
assert 'case "x8prepare": X8Prepare(a);' in source
assert 'case "x8shot": X8Shot(a);' in source
assert 'case "x8restore": X8Restore(a);' in source
assert 'case "x8status": X8Status();' in source
assert 'if (x8Owner != null) X8PreflightCandidate(tpos, thash, target);' in source
assert '"x8_original_basis_stale_before_commit"' in source
assert '"x8_ambiguous_source_or_hide_scope"' in source
assert 'x8Registry.FailedPreparation(id, original, clean)' in source
assert 'x8Registry.Restored(id, true, true);' in source
assert '"x8_original_or_owned_not_restored_issue_308"' in source
assert 'X7Shot(a); // X7.3 exact projectile provenance' in bridge
assert 'X7Prepare(args); // proven native staging' in bridge
assert 'X7Restore();' in bridge
assert source.count('ImpactSectionSelector.TryPredictAndSelect(') == 1
assert source.count('long X7Commit(Astra.X7.ImpactSectionSelector.Selection selected)') == 1
assert 'World.AddExplosion(' not in source.split('void X7Shot(', 1)[1].split('void X7DiagOther(', 1)[0]
assert 'CREATE_MODEL_HIDE_EXCLUDING_SCRIPT_OBJECTS' in source
print("PASS X8 generator/opt-in/identity/restore integration guards (not GTA)")
