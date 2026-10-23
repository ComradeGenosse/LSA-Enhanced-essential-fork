"""Add only a P2 site survey to the generated X8 driver; physics stays unchanged."""
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
base = HERE.parent / 'fragment-x7'
subprocess.run([sys.executable, str(base / 'build_x7.py')], check=True)
source = (base / 'WpsBreachLabX7.3.cs').read_text(encoding='utf-8')
anchor = '            case "x8enable":'
assert source.count(anchor) == 1
source = source.replace(anchor, '            case "labsurvey": LabSurvey(a); break;\n            case "labstream": LabStream(a); break;\n            case "labipl": LabIpl(a); break;\n' + anchor)
anchor = '    // ===================================================================== lab geometry'
assert source.count(anchor) == 1
source = source.replace(anchor, (HERE / 'Survey.inc.cs').read_text() + '\n' + anchor)
dest = Path(sys.argv[1])
dest.mkdir(parents=True, exist_ok=True)
(dest / 'WpsBreachLabX7.3.cs').write_bytes(source.encode('utf-8'))
print(dest / 'WpsBreachLabX7.3.cs')
