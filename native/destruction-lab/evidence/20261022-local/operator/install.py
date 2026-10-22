from pathlib import Path
import json,hashlib,shutil,sys,subprocess,os
ROOT=Path(__file__).resolve().parents[1]; GAME=Path(r'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced'); REPO=ROOT/'work/repo'; OUT=ROOT/'outputs'; BACKUP=ROOT/'work/backup'
sys.path.insert(0,str(REPO/'tools/gta-controller'))
from controller import atomic

def H(p):return hashlib.sha256(p.read_bytes()).hexdigest().upper() if p.is_file() else None

def stopped():
 p=subprocess.run(['powershell','-NoProfile','-Command',"@(Get-Process GTA5_Enhanced,GTA5,RAGEPluginHook -ErrorAction SilentlyContinue).Count"],capture_output=True,text=True,check=True)
 assert p.stdout.strip()=='0','GTA must be stopped'

def save(m):atomic(BACKUP/'manifest.json',m)
stopped()
if sys.argv[1]=='install':
 assert not BACKUP.exists(),'Fresh backup required'
 for n in ('controller.json','request.txt','command.txt'): assert not (GAME/'WpsBreachLab'/n).exists(),n
 previous=json.loads((ROOT.parent/'codex-validate-x7-3-repair-draft/outputs/baseline.json').read_text())
 for r in previous: assert H(GAME/r['relative'])==r['expected'],r
 frag=REPO/'native/fragment-x7'
 rec=json.loads((frag/'pack-x7d/pack-receipt.json').read_text(encoding='utf-8-sig'))
 assert H(frag/'pack-x7d/dlc.rpf')==rec['sha256']
 ini=(GAME/'ScriptHookVDotNet.ini').read_bytes();dlc=(GAME/'onigiri/common/data/dlclist.xml').read_bytes()
 assert b'ScriptsLocation="scripts"' in ini
 assert b'lsa_fence_x7d' not in dlc
 models=json.loads((frag/'assets-x7d/models.json').read_text(encoding='utf-8-sig'))['allowlist'];assert models==rec['models']
 planned={
 'ScriptHookVDotNet.ini':ini.replace(b'ScriptsLocation="scripts"',b'ScriptsLocation="scripts-x7"'),
 'onigiri/common/data/dlclist.xml':dlc.replace(b'</Paths>',b'    <Item>dlcpacks:/lsa_fence_x7d/</Item>\r\n</Paths>'),
 'onigiri/dlcpacks/lsa_fence_x7d/dlc.rpf':(frag/'pack-x7d/dlc.rpf').read_bytes(),
 'scripts-x7/WpsBreachLabX7.3.cs':(ROOT/'runtime/WpsBreachLabX7.3.cs').read_bytes(),
 'scripts-x7/x7-models.txt':''.join(v+'\r\n' for v in models).encode()}
 BACKUP.mkdir()
 m=dict(operator='codex-lab',session='lab-survey-20261022',phase='BACKUP',rows=[],renames=[])
 for i,(rel,data) in enumerate(planned.items()):
  dest=GAME/rel;before=H(dest);bak=f'{i}.bak'
  if before:shutil.copy2(dest,BACKUP/bak);assert H(BACKUP/bak)==before
  m['rows'].append(dict(relative=rel,before=before,backup=bak,installed=hashlib.sha256(data).hexdigest().upper(),state='PLANNED'))
 for name in ('renodx-dlss.addon64','renodx-dlss-hotkey.addon64'):
  assert not (GAME/(name+'.x8off')).exists()
  m['renames'].append(dict(source=name,target=name+'.x8off',sha256=H(GAME/name),state='PLANNED'))
 save(m)
 atomic(OUT/'handoff.json',dict(state='STOPPED_BACKUP_VERIFIED',operator='codex-lab',publisher='codex',authorization='User explicitly authorizes X8 installation, survey and qualified map acceptance sessions, maximum one RPG per real fence, restoration and PR310 push; no X9',candidateDriver=H(ROOT/'runtime/WpsBreachLabX7.3.cs'),backup=str(BACKUP),session=m['session'],acknowledgedBy='codex-lab'))
 for row in m['rows']:
  stopped();dest=GAME/row['relative'];assert H(dest)==row['before'];row['state']='WRITE_INTENT';save(m)
  dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(planned[row['relative']]);assert H(dest)==row['installed'];row['state']='APPLIED';save(m)
 for row in m['renames']:
  stopped();assert H(GAME/row['source'])==row['sha256'];row['state']='RENAME_INTENT';save(m)
  (GAME/row['source']).rename(GAME/row['target']);assert H(GAME/row['target'])==row['sha256'];row['state']='APPLIED';save(m)
 m['phase']='INSTALLED';save(m);atomic(OUT/'install-manifest.json',m)
 print('Installed and verified 5 files + 2 addon renames; all intents journaled')
else:
 m=json.loads((BACKUP/'manifest.json').read_text())
 for row in m['rows']:
  assert H(GAME/row['relative']) in (row['installed'],row['before']),row
  if row['before']:assert H(BACKUP/row['backup'])==row['before']
 for row in m['renames']:
  assert (H(GAME/row['target'])==row['sha256'] and not (GAME/row['source']).exists()) or (H(GAME/row['source'])==row['sha256'] and not (GAME/row['target']).exists()),row
 for row in m['rows']:
  stopped();row['state']='RESTORE_INTENT';save(m);dest=GAME/row['relative']
  if row['before']:shutil.copyfile(BACKUP/row['backup'],dest)
  elif dest.exists():dest.unlink()
  assert H(dest)==row['before'];row['state']='RESTORED';save(m)
 for row in m['renames']:
  stopped();row['state']='UNDO_RENAME_INTENT';save(m)
  if (GAME/row['target']).exists():(GAME/row['target']).rename(GAME/row['source'])
  assert H(GAME/row['source'])==row['sha256'];row['state']='RESTORED';save(m)
 m['phase']='RESTORED';save(m)
 atomic(OUT/'filesystem-restoration.json',dict(passed=True,files=[dict(relative=r['relative'],expected=r['before'],actual=H(GAME/r['relative'])) for r in m['rows']],addons=[dict(relative=r['source'],expected=r['sha256'],actual=H(GAME/r['source']),temporaryAbsent=not (GAME/r['target']).exists()) for r in m['renames']]))
 print('PASS all 7 filesystem paths restored by hash/absence')

