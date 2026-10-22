"""Deterministic X8 opt-in adapter over the frozen X7.3 generator output."""
from pathlib import Path

FOLDER = Path(__file__).resolve().parent
PACKAGE = FOLDER.parent / "destruction-props"

def apply_x8(source: str) -> str:
    changes = [
        ("dispatch", '''        switch (verb)
        {
            case "x7prepare":''', '''        if (x8Owner != null && verb.StartsWith("x7", StringComparison.Ordinal))
            throw new Exception("x8_owner_requires_x8_command");
        switch (verb)
        {
            case "x8enable": X8Enable(a); break;
            case "x8register": X8Register(a); break;
            case "x8prepare": X8Prepare(a); break;
            case "x8shot": X8Shot(a); break;
            case "x8restore": X8Restore(a); break;
            case "x8walk": X8OwnedCommand(verb, a); break;
            case "x8cam": X8OwnedCommand(verb, a); break;
            case "x8status": X8Status(); break;
            case "x7prepare":'''),
        ("command admission", '''if (x7State != "None" && !verb.StartsWith("x7") && verb != "abort")''',
         '''if (x7State != "None" && !verb.StartsWith("x7") && !verb.StartsWith("x8") && verb != "abort")'''),
        ("exact candidate", '''        if (target == null) throw new Exception("placed_target_missing");
        x7Orig = X4OriginalLab(target);''',
         '''        if (target == null) throw new Exception("placed_target_missing");
        if (x8Owner != null) X8PreflightCandidate(tpos, thash, target);
        x7Orig = X4OriginalLab(target);'''),
        ("late original identity", '''        for (int i = 0; i < x7ByPos.Length; i++)
        {
            Lab lab = x7ByPos[i];''',
         '''        if (x8Owner != null)
        {
            Astra.X8.Placement site = x8Registry.Get(x8Owner).Site;
            if (!site.Matches(x7Target.Position.X, x7Target.Position.Y, x7Target.Position.Z,
                              x7Target.Heading))
                throw new Exception("x8_original_basis_stale_before_commit");
        }
        for (int i = 0; i < x7ByPos.Length; i++)
        {
            Lab lab = x7ByPos[i];'''),
        ("runtime adapter", '''    // ===================================================================== lab geometry''',
         (PACKAGE / "X8RuntimeAdapter.inc.cs").read_text(encoding="utf-8") +
         '''    // ===================================================================== lab geometry'''),
    ]
    for name, old, new in changes:
        count = source.count(old)
        if count != 1:
            raise RuntimeError(f"X8 generator drift ({name}): expected one anchor, found {count}")
        source = source.replace(old, new, 1)
    catalog = (PACKAGE / "X8Catalog.cs").read_text(encoding="utf-8")
    assert catalog.startswith("using System;\n") and "namespace Astra.X8" in catalog
    # The pure C# source starts with using directives, which must be at file top.
    # Source already imports System and System.Collections.Generic.
    catalog = catalog.replace("using System;\n", "", 1).replace("using System.Collections.Generic;\n", "", 1).lstrip()
    return source.rstrip() + "\n\n" + catalog
