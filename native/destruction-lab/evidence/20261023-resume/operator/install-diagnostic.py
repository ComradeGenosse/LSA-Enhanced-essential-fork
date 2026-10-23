from pathlib import Path
import sys,json,hashlib,shutil,subprocess
root=Path.cwd();sys.path.insert(0,str(root/'work/repo/tools/gta-controller'));from controller import atomic
mfile=root/'work/backup-resume/manifest.json';m=json.loads(mfile.read_text()); row=next(r for r in m['rows'] if r['relative']=='scripts-x7/WpsBreachLabX7.3.cs');g=Path(r'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced');dest=g/row['relative'];src=root/'work/diagnostic-runtime/WpsBreachLabX7.3.cs'
H=lambda p:hashlib.sha256(p.read_bytes()).hexdigest().upper()
p=subprocess.run(['powershell','-NoProfile','-Command','@(Get-Process GTA5_Enhanced,GTA5,RAGEPluginHook -ErrorAction SilentlyContinue).Count'],capture_output=True,text=True,check=True);assert p.stdout.strip()=='0'
assert H(dest)==row['installed'];old=row['installed'];new=H(src)
row.update(previousInstalled=old,installed=new,state='UPDATE_INTENT');atomic(mfile,m);shutil.copyfile(src,dest);assert H(dest)==new;row['state']='APPLIED';atomic(mfile,m)
atomic(root/'outputs/resume-20261023/diagnostic-install.json',{'before':old,'after':new,'gtaStopped':True,'physicsAndSelectorUnchanged':True})
