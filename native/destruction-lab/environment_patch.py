"""Patch the local survey runtime with explicit P2 lab environment controls.

No modifications to the frozen X7.3 physics, auto selector, or the X8 registry.
Anchor counts are enforced; drift must fail the build.
"""
from pathlib import Path

HERE = Path(__file__).resolve().parent

def apply_environment(source: str) -> str:
    patches = [
        ("dispatch", '            case "labsurvey":',
         '            case "x8labsetup": LabEnvSetup(a); break;\n'
         '            case "x8labstatus": LabEnvStatus(); break;\n'
         '            case "x8labrestore": LabEnvRestore(); break;\n'
         '            case "labsurvey":'),
        ("tick", '    void OnTick()\n    {\n        Beat();',
         '    void OnTick()\n    {\n        LabEnvTick();\n        Beat();'),
        ("abort", '    void OnAborted() { try { X4Restore(); } catch { } try { X7Restore(); } finally { try { CleanupAll(); RestorePlayer(); } catch { } } }',
         '    void OnAborted() { try { X4Restore(); } catch { } try { X7Restore(); } finally { try { CleanupAll(); RestorePlayer(); } catch { } try { LabEnvAbort(); } catch { } } }'),
        ("inclusion", '    // ===================================================================== lab geometry',
         (HERE / "environment" / "LabEnvironment.inc.cs").read_text(encoding="utf-8") +
         '\n    // ===================================================================== lab geometry')
    ]
    for name, old, new in patches:
        if source.count(old) != 1:
            raise RuntimeError("environment patch drift: %s found %d anchors" % (name, source.count(old)))
        source = source.replace(old, new, 1)
    return source
