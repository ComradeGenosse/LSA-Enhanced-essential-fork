"""Apply uniquely anchored X7 live-selector patches to the frozen X6-derived generator."""
import json
from pathlib import Path

def apply_live_selector(source):
    folder = Path(__file__).resolve().parent
    manifest = json.loads((folder / "live_selector_changes.json").read_text(encoding="utf-8"))
    for change in manifest["patches"]:
        old, new = change["old"], change["new"]
        count = source.count(old)
        if count != 1:
            raise RuntimeError(f"live selector generator drift ({change['label']}): expected 1, got {count}")
        source = source.replace(old, new, 1)
    pure = (folder / "selection" / "ImpactSectionSelector.cs").read_text(encoding="utf-8")
    assert pure.startswith("using System;\n\n")
    return source.rstrip() + "\n\n// Pure selector is generated verbatim from selection/ImpactSectionSelector.cs.\n" + pure[len("using System;\n\n"):]
