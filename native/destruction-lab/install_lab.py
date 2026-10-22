"""Stopped-game, hash-fenced map-only install/rollback; run on Windows host."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'tools/gta-controller'))
from controller import atomic

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None

def stopped():
    result = subprocess.run(['powershell', '-NoProfile', '-Command',
        '@(Get-Process GTA5_Enhanced,GTA5,RAGEPluginHook -ErrorAction SilentlyContinue).Count'],
        capture_output=True, text=True, check=True)
    if result.stdout.strip() != '0':
        raise RuntimeError('Stop GTA/RPH before changing map files')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('operation', choices=['install','restore'])
    p.add_argument('--game-root', required=True, type=Path)
    p.add_argument('--backup', required=True, type=Path)
    p.add_argument('--pack', type=Path)
    a=p.parse_args(); stopped()
    game=a.game_root.resolve(); backup=a.backup.resolve(); receipt=backup/'manifest.json'
    state=game/'WpsBreachLab/controller.json'
    if state.exists() and json.loads(state.read_text()).get('pending'):
        raise RuntimeError('Unresolved P2 request blocks installation/restoration')
    if a.operation=='install':
        if backup.exists() or not a.pack: raise RuntimeError('Fresh backup and pack required')
        pack=a.pack.resolve(); m=json.loads((pack/'pack-receipt.json').read_text(encoding='utf-8-sig'))
        if digest(pack/'dlc.rpf').upper()!=m['dlcSha256'].upper(): raise RuntimeError('Pack hash mismatch')
        if m['packedReloadEntities']!=2: raise RuntimeError('Packed reload missing')
        rel='onigiri/common/data/dlclist.xml'; data=(game/rel).read_bytes()
        if b'lsa_destruction_lab' in data or data.count(b'</Paths>')!=1: raise RuntimeError('Unexpected DLC list')
        planned={rel:data.replace(b'</Paths>',b'    <Item>dlcpacks:/lsa_destruction_lab/</Item>\r\n</Paths>'),
                 'onigiri/dlcpacks/lsa_destruction_lab/dlc.rpf':(pack/'dlc.rpf').read_bytes()}
        if (game/'onigiri/dlcpacks/lsa_destruction_lab/dlc.rpf').exists(): raise RuntimeError('Lab already installed')
        backup.mkdir(parents=True); m={'phase':'BACKUP_VERIFIED','rows':[]}
        for i,(rel,data) in enumerate(planned.items()):
            dest=game/rel; before=digest(dest); name=str(i)+'.bak'
            if before:
                shutil.copy2(dest,backup/name)
                assert digest(backup/name)==before
            m['rows'].append(dict(relative=rel,before=before,backup=name,
                installed=hashlib.sha256(data).hexdigest(),state='PLANNED'))
        atomic(receipt,m)
        for row in m['rows']:
            stopped(); dest=game/row['relative']; assert digest(dest)==row['before']
            row['state']='WRITE_INTENT'; atomic(receipt,m)
            dest.parent.mkdir(parents=True,exist_ok=True); dest.write_bytes(planned[row['relative']])
            assert digest(dest)==row['installed']; row['state']='APPLIED'; atomic(receipt,m)
        m['phase']='INSTALLED'; atomic(receipt,m)
    else:
        m=json.loads(receipt.read_text())
        for row in m['rows']:
            assert digest(game/row['relative']) in (row['before'],row['installed'])
            if row['before']: assert digest(backup/row['backup'])==row['before']
        for row in m['rows']:
            stopped(); row['state']='RESTORE_INTENT'; atomic(receipt,m); dest=game/row['relative']
            if row['before']: shutil.copyfile(backup/row['backup'],dest)
            elif dest.exists(): dest.unlink()
            assert digest(dest)==row['before']; row['state']='RESTORED'; atomic(receipt,m)
        m['phase']='RESTORED'; atomic(receipt,m)
    print(json.dumps(m,indent=2))

if __name__=='__main__': main()
