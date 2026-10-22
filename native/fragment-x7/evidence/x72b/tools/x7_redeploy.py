import sys, json, shutil, hashlib
from pathlib import Path
# usage: x7_redeploy.py GAME FRAG BACKUP  -- hot-copy edited driver and refresh the manifest hash so restore stays strict
game, frag, bk = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
src = frag / 'WpsBreachLabX7.3.cs'; dst = game / 'scripts-x7/WpsBreachLabX7.3.cs'
shutil.copyfile(src, dst)
h = hashlib.sha256(dst.read_bytes()).hexdigest().upper()
m = json.loads((bk / 'manifest.json').read_text())
for r in m['rows']:
    if r['relative'] == 'scripts-x7/WpsBreachLabX7.3.cs': r['installed'] = h
(bk / 'manifest.json').write_text(json.dumps(m, indent=2)); print('redeployed', h[:16])
