import json, hashlib
from pathlib import Path
root=Path(r'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced')
repo=Path(__file__).parent/'repo'
out=Path(__file__).parent.parent/'outputs'
rows=json.loads((repo/'docs/agent-operations/2026-10-22/p2smoke-repair/filesystem-restoration.json').read_text())
for r in rows:
 p=root/r['relative']; actual=hashlib.sha256(p.read_bytes()).hexdigest().upper() if p.exists() else None
 r['actual']=actual;r['match']=actual==r['expected']
 assert r['match'],r
for n in ['controller.json','request.txt','command.txt']:
 assert not (root/'WpsBreachLab'/n).exists(),n
for n in ['renodx-dlss.addon64.x72off','renodx-dlss-hotkey.addon64.x72off']:
 assert not (root/n).exists(),n
(out/'baseline.json').write_text(json.dumps(rows,indent=2))
hash=hashlib.sha256((repo/'native/fragment-x7/WpsBreachLabX7.3.cs').read_bytes()).hexdigest()
(out/'handoff.json').write_text(json.dumps(dict(state='STOPPED_BASELINE_VERIFIED_READY_FOR_INSTALL',operator='codex',publisher='codex',candidate='6faf2e8cbef6c27f32b96b811a0f01f1d0f40505',driverSha256=hash,session='x73-diag-one-shot-20261022',authorization='Chris authorizes one controlled diagnostic shot on PR304, rollback and separate draft PR; no second shot or X8',acknowledgedBy='codex',backup=str(Path(__file__).parent/'backup'),baseline='baseline.json',nextAction='Fresh backup, verified stopped-game install, approved runtime, one smoke only'),indent=2))
print('PASS previous files restored; no ownership or queued slots; candidate '+hash)
import shutil
snapshot=Path(__file__).parent/'preinstall-snapshot'
assert not snapshot.exists(), 'Fresh backup required'
snapshot.mkdir()
for i,r in enumerate(rows):
 if r['expected']:
  p=snapshot/(str(i)+'.bak');shutil.copy2(root/r['relative'],p)
  assert hashlib.sha256(p.read_bytes()).hexdigest().upper()==r['expected']
(snapshot/'manifest.json').write_text(json.dumps(rows,indent=2))
print('Fresh independent rollback snapshot verified before installation')
