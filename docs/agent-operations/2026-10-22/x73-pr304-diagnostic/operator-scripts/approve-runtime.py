import json,hashlib,datetime
from pathlib import Path
root=Path(r'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced')
out=Path(__file__).parent.parent/'outputs'
candidate=Path(__file__).parent/'repo/native/fragment-x7/WpsBreachLabX7.3.cs'
hash=hashlib.sha256(candidate.read_bytes()).hexdigest()
assert hashlib.sha256((root/'scripts-x7/WpsBreachLabX7.3.cs').read_bytes()).hexdigest()==hash
b=json.loads((root/'WpsBreachLab/status.json').read_text(encoding='utf-8-sig'))
assert b['protocol']==2 and b['scriptSha256']==hash, 'Runtime hash not current candidate'
assert (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(b['nowUtc'].replace('Z','+00:00'))).total_seconds()<5, 'Stale heartbeat'
(out/'loaded-heartbeat.json').write_text(json.dumps(b,indent=2))
e={k:b[k] for k in ['pid','loadedUtc','scriptSha256']}
(out/'expected.json').write_text(json.dumps(e,indent=2))
print(json.dumps(e))
