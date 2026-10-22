import sys, os, json, hashlib, shutil
from pathlib import Path
# usage: x7_install.py install|restore GAME_ROOT PACK_DIR(fragment-x7) BACKUP_ROOT
mode, game, frag, bk = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])
variant = os.environ.get('X7_VARIANT', 'x7c'); dlc = 'lsa_fence_' + variant
def H(p):
    p = Path(p)
    return hashlib.sha256(p.read_bytes()).hexdigest().upper() if p.exists() else None
paths = ['ScriptHookVDotNet.ini', 'onigiri/common/data/dlclist.xml',
         f'onigiri/dlcpacks/{dlc}/dlc.rpf', 'scripts-x7/WpsBreachLabX7.3.cs', 'scripts-x7/x7-models.txt']
manifest = bk / 'manifest.json'
if mode == 'install':
    if manifest.exists(): sys.exit('existing backup manifest: restore first')
    rec = json.loads((frag / os.environ.get('X7_PACK_DIR', 'pack') / 'pack-receipt.json').read_text(encoding='utf-8-sig'))
    assert rec['pack'] == dlc
    binp = frag / os.environ.get('X7_PACK_DIR', 'pack') / 'dlc.rpf'
    assert H(binp) == rec['sha256'].upper(), 'pack hash mismatch'
    models = json.loads((frag / os.environ.get('X7_ASSETS_DIR', 'assets') / 'models.json').read_text(encoding='utf-8-sig'))['allowlist']
    assert models == rec['models'], 'model list mismatch'
    ini = (game / paths[0]).read_bytes(); lst = (game / paths[1]).read_bytes()
    assert b'ScriptsLocation="scripts"' in ini and b'</Paths>' in lst
    bk.mkdir(parents=True, exist_ok=True)
    rows = []
    for n, rel in enumerate(paths):
        d = game / rel; b = H(d)
        if b: shutil.copy2(d, bk / f'{n}.bak')
        rows.append({'relative': rel, 'before': b, 'backup': f'{n}.bak', 'installed': None})
    manifest.write_text(json.dumps({'variant': variant, 'rows': rows, 'phase': 'backed_up'}, indent=2))
    for rel in paths[2:]: (game / rel).parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(binp, game / paths[2])
    shutil.copyfile(frag / 'WpsBreachLabX7.3.cs', game / paths[3])
    (game / paths[4]).write_bytes(''.join(m + '\r\n' for m in models).encode())
    (game / paths[0]).write_bytes(ini.replace(b'ScriptsLocation="scripts"', b'ScriptsLocation="scripts-x7"'))
    item = f'dlcpacks:/{dlc}/'.encode()
    if item not in lst:
        lst = lst.replace(b'</Paths>', b'    <Item>' + item + b'</Item>\r\n</Paths>')
    (game / paths[1]).write_bytes(lst)
    for r in rows: r['installed'] = H(game / r['relative'])
    renames = []
    if '--disable-dlss-addons' in sys.argv:
        for name in ('renodx-dlss.addon64', 'renodx-dlss-hotkey.addon64'):
            s = game / name; d = game / (name + '.x72off')
            if s.exists() and not d.exists():
                h = H(s); os.rename(s, d); assert H(d) == h
                renames.append({'from': name, 'to': name + '.x72off', 'sha256': h})
    manifest.write_text(json.dumps({'variant': variant, 'rows': rows, 'renames': renames, 'phase': 'installed'}, indent=2))
    print(json.dumps({'rows': rows, 'renames': renames}, indent=1))
else:
    st = json.loads(manifest.read_text()); rows = st['rows']
    for rn in st.get('renames', []):
        s = game / rn['to']; d = game / rn['from']
        if s.exists() and not d.exists(): os.rename(s, d)
        assert H(d) == rn['sha256'], 'addon restore hash mismatch ' + rn['from']
    for r in rows:
        h = H(game / r['relative'])
        if h != r['installed'] and h != r['before'] and r['installed'] is not None:
            sys.exit('unexpected post-install change: ' + r['relative'])
    for r in rows:
        d = game / r['relative']
        if r['before']: shutil.copyfile(bk / r['backup'], d)
        elif d.exists(): os.remove(d)
        assert H(d) == r['before'], 'restore mismatch ' + r['relative']
    for f in ['scripts-x7', f'onigiri/dlcpacks/{dlc}']:
        t = game / f
        if t.exists() and not any(t.iterdir()): os.rmdir(t)
    out = [{'relative': r['relative'], 'before': r['before'], 'after': H(game / r['relative']), 'restored': True} for r in rows]
    out += [{'relative': rn['from'], 'before': rn['sha256'], 'after': H(game / rn['from']), 'restored': True} for rn in st.get('renames', [])]
    (bk / 'restored.json').write_text(json.dumps(out, indent=2)); print(json.dumps(out, indent=1))
