from pathlib import Path
import json,hashlib,shutil,subprocess,sys
root=Path(__file__).resolve().parents[2];g=Path(r'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced');out=root/'outputs/nve-discriminator';back=root/'work/backup-nve-archive';dest=g/'onigiri/dlcpacks/NVE_props_addon/dlc.rpf';candidate=root/'work/nve-discriminator/candidate-verified/dlc.rpf'
sys.path.insert(0,r'C:\Users\Chris.COMRADE\Documents\Codex\2026-10-22\take-ownership-of-completing-and-validating\work\repo\tools\gta-controller');from controller import atomic
H=lambda p:hashlib.sha256(p.read_bytes()).hexdigest().upper()
def stopped():
 p=subprocess.run(['powershell','-NoProfile','-Command','@(Get-Process GTA5_Enhanced,GTA5,RAGEPluginHook -ErrorAction SilentlyContinue).Count'],capture_output=True,text=True,check=True);assert p.stdout.strip()=='0'
stopped();state=g/'WpsBreachLab/controller.json'
if state.exists():
 s=json.loads(state.read_text());assert s['owner']=='codex-lab' and s['session']=='lab-nve-20261023' and s['pending'] is None
if sys.argv[1] in ['install','reinstall']:
 assert (not back.exists()) if sys.argv[1]=='install' else (back/'dlc.rpf').is_file();assert not(g/'onigiri/dlcpacks/lsa_destruction_lab/dlc.rpf').exists();assert b'lsa_destruction_lab' not in (g/'onigiri/common/data/dlclist.xml').read_bytes()
 v=json.loads((out/'injection-validation.json').read_text(encoding='utf-8-sig'));assert H(dest)==v['originalNveSha256'];assert H(candidate)==v['candidateNveSha256']
 if sys.argv[1]=='install':
  back.mkdir();shutil.copy2(dest,back/'dlc.rpf')
 assert H(back/'dlc.rpf')==H(dest)
 m={'phase':'BACKUP_VERIFIED','original':H(dest),'candidate':H(candidate),'relative':'onigiri/dlcpacks/NVE_props_addon/dlc.rpf','backup':str(back/'dlc.rpf'),'originalLength':dest.stat().st_size};atomic(back/'manifest.json',m)
 stopped();assert H(dest)==m['original'];m['phase']='WRITE_INTENT';atomic(back/'manifest.json',m);shutil.copyfile(candidate,dest);assert H(dest)==m['candidate'];m['phase']='INSTALLED';atomic(back/'manifest.json',m);atomic(out/'nve-install.json',m)
else:
 m=json.loads((back/'manifest.json').read_text());assert H(dest) in [m['original'],m['candidate']];assert H(back/'dlc.rpf')==m['original'];m['phase']='RESTORE_INTENT';atomic(back/'manifest.json',m);stopped();shutil.copyfile(back/'dlc.rpf',dest);assert H(dest)==m['original'];m['phase']='RESTORED';atomic(back/'manifest.json',m);atomic(out/'nve-restoration.json',{'passed':True,'expected':m['original'],'actual':H(dest),'length':dest.stat().st_size})
print(m['phase'])
