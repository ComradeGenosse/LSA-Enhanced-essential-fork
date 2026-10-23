import sys,subprocess,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT/'outputs';GAME=Path(r'C:\Program Files (x86)\Steam\steamapps\common\Grand Theft Auto V Enhanced');LAB=GAME/'WpsBreachLab'
trial,command=sys.argv[1:3]
argv=[sys.executable,str(Path('C:\\Users\\Chris.COMRADE\\Documents\\Codex\\2026-10-22\\take-ownership-of-completing-and-validating\\work\\repo\\tools\\gta-controller\\controller.py')),'--lab',str(LAB),'--owner','codex-lab','--session','lab-story-sp-20261023','--expected',str(OUT/'expected.json'),'send',command,'--experiment','X8','--trial',trial,'--timeout','80']
(OUT/'commands').mkdir(exist_ok=True)
p=subprocess.run(argv,capture_output=True,text=True);(OUT/'commands'/f'{trial}.txt').write_text(p.stdout+p.stderr)
s=json.loads((LAB/'controller.json').read_text());r=s.get('pending') or s.get('last');rid=r['requestId']
manifest=OUT/'request-ids.json';ids=json.loads(manifest.read_text())['requestIds'] if manifest.exists() else []
if rid not in ids:ids.append(rid)
manifest.write_text(json.dumps(dict(requestIds=ids),indent=2))
print(p.stdout+p.stderr)
if (LAB/'responses'/f'{rid}.json').exists():
 r=json.loads((LAB/'responses'/f'{rid}.json').read_text());run=r.get('runId')
 if run:
  rows=[json.loads(v) for v in (LAB/run/'trials.jsonl').read_text(encoding='utf-8-sig').splitlines() if v.strip()]
  (OUT/'commands'/f'{trial}-rows.json').write_text(json.dumps(rows,indent=2))
  for v in rows:
   if v['kind'] in ['x8_audit','x8_identity','x8_lifecycle','x7_armed','x7_target','x7_result','x7_selection','x7_secstate','x7_frames','x7_player_result','x7_restored','x8_original_verified','x8_cleanup_verified','x8_cleanup_remaining','error']:print(json.dumps(v))
sys.exit(p.returncode)


