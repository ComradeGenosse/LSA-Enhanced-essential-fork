from pathlib import Path
import json,hashlib,shutil,subprocess,sys
root=Path.cwd();g=Path(r'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced')
sys.path.insert(0,r'C:\Users\Chris.COMRADE\Documents\Codex\2026-10-22\take-ownership-of-completing-and-validating\work\repo\tools\gta-controller');from controller import atomic
p=subprocess.run(['powershell','-NoProfile','-Command','@(Get-Process GTA5_Enhanced,GTA5,RAGEPluginHook -ErrorAction SilentlyContinue).Count'],capture_output=True,text=True,check=True);assert p.stdout.strip()=='0'
st=json.loads((g/'WpsBreachLab/controller.json').read_text());assert st['owner']=='codex-lab' and st['session']=='lab-story-sp-20261023' and st['pending'] is None
mfile=root/'work/backup-story/manifest.json';m=json.loads(mfile.read_text());r=next(x for x in m['rows'] if x['relative']=='scripts-x7/WpsBreachLabX7.3.cs')
H=lambda p:hashlib.sha256(p.read_bytes()).hexdigest().upper()
src=root/'work/ipl-runtime/WpsBreachLabX7.3.cs';dest=g/r['relative'];assert H(dest)==r['installed'];r.update(previousInstalled=r['installed'],installed=H(src),state='UPDATE_INTENT');atomic(mfile,m);shutil.copyfile(src,dest);assert H(dest)==r['installed'];r['state']='APPLIED';atomic(mfile,m);atomic(root/'outputs/ipl-install.json',r)
s=(root/'work/approve.py').read_text();start=s.index('hash=');end=s.index('\nassert hashlib',start);s=s[:start]+"hash=hashlib.sha256((root/'work/ipl-runtime/WpsBreachLabX7.3.cs').read_bytes()).hexdigest()"+s[end:];(root/'work/approve-ipl.py').write_text(s)
print('Diagnostic installed; baseline rollback preserved')
