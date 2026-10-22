"""Cloud-only checks: generated live C# uses the tested selector without aim/legacy bypass."""
from pathlib import Path
import sys

folder = Path(__file__).resolve().parent
sys.path.insert(0, str(folder))
from live_selector_patch import apply_live_selector

source = (folder / "WpsBreachLabX7.3.cs").read_text(encoding="utf-8")
pure = (folder / "selection" / "ImpactSectionSelector.cs").read_text(encoding="utf-8")
generator = (folder / "build_x7.py").read_text(encoding="utf-8")
assert "s = apply_live_selector(s)" in generator
assert source.endswith(pure[len("using System;\n\n"):]), "selector must be embedded byte-for-byte"
shot = source.split("void X7Shot(", 1)[1].split("void X7DiagOther(", 1)[0]
assert shot.count("ImpactSectionSelector.TryPredictAndSelect(") == 1
assert "X7Commit(bestSelection)" in shot
assert "selection.TimeToFaceSeconds <= horizonSeconds" in shot
assert "beforeShotHandles.Contains(ph)" in shot
admission = (folder / "selection" / "ProjectileAdmissionPolicy.cs").read_text(encoding="utf-8")
assert "s = apply_live_selector(s)" in generator
assert admission[len("using System;\n\n"):].rstrip() in source
assert "readyCount == 1" in shot
assert "(double)u - cuMid" in shot and "(double)v - T.V0" in shot
assert "sel=2,3" not in shot
assert "x7_live_impact_requires_five_sections_no_preselection" in shot
assert "World.AddExplosion(" not in shot
commit = source.split("long X7Commit(Astra.X7.ImpactSectionSelector.Selection selected)", 1)[1].split("void X7Prepare(", 1)[0]
assert "x7Section" not in commit
for forbidden in ("Yield(", "Row(", "World.AddExplosion(", "Spawn(", "File.", "Model.Request("):
    assert forbidden not in commit, forbidden
for required in ("X7ActivateSelective();", "selected.FirstIndex", "selected.SecondIndex",
                 "CREATE_MODEL_HIDE_EXCLUDING_SCRIPT_OBJECTS", "x7_section_preflight_failed"):
    assert required in commit, required
assert 'case "x7preview": throw' in source
assert 'if (x7Dormant) X7SetDormantOne(p, true);' in source
assert "Array.Clear(x7ByPos" in source
assert "void X7DiagOther(" in source and "void X7Restore()" in source
print("PASS X7.3 live policy guards (not a GTA compilation/gameplay proof)")
