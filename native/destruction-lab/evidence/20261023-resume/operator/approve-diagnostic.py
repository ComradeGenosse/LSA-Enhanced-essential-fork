import json,hashlib,datetime,subprocess
from pathlib import Path
root=Path(__file__).resolve().parents[1];g=Path(r'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced');out=root/'outputs/resume-20261023'
hash=hashlib.sha256((root/'work/diagnostic-runtime/WpsBreachLabX7.3.cs').read_bytes()).hexdigest()
assert hashlib.sha256((g/'scripts-x7/WpsBreachLabX7.3.cs').read_bytes()).hexdigest()==hash
b=json.loads((g/'WpsBreachLab/status.json').read_text(encoding='utf-8-sig'))
assert b['protocol']==2 and b['scriptSha256']==hash
assert (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(b['nowUtc'].replace('Z','+00:00'))).total_seconds()<5
p=subprocess.run(['powershell','-NoProfile','-Command','(Get-Process GTA5_Enhanced).Id'],capture_output=True,text=True,check=True);assert str(b['pid'])==p.stdout.strip()
assert datetime.datetime.fromisoformat(b['loadedUtc'].replace('Z','+00:00'))>datetime.datetime.fromisoformat((out/'launch-utc.txt').read_text(encoding='utf-8-sig').strip())
(out/'loaded-heartbeat.json').write_text(json.dumps(b,indent=2));e={k:b[k] for k in ['pid','loadedUtc','scriptSha256']};(out/'expected.json').write_text(json.dumps(e,indent=2));print(json.dumps(e))



