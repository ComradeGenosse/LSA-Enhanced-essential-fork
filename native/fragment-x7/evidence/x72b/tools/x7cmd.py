import sys, json, time, os
from pathlib import Path
g = Path(os.path.expanduser('~/mnt/Grand Theft Auto V Enhanced/WpsBreachLab'))
text = sys.argv[1]; limit = float(sys.argv[2]) if len(sys.argv) > 2 else 80
def status():
    try: return json.loads((g/'status.json').read_text(encoding='utf-8-sig'))
    except Exception: return None
old = status() or {}
import time
for _i in range(8):
    try:
        (g/'command.txt').write_text(text, encoding='utf-8'); break
    except FileNotFoundError:
        time.sleep(1.5)
else:
    raise SystemExit('command.txt unreachable')
end = time.time() + limit
KINDS = {'x7_armed','x7_restored','x7_result','x7_player_result','x7_frames','error','exception','x7_check','x7_probe_summary'}
while time.time() < end:
    time.sleep(0.5)
    s = status()
    if s and s.get('runId') != old.get('runId') and s.get('state') in ('DONE','ERROR'):
        print(json.dumps({k: s.get(k) for k in ('state','runId','cmd')}))
        p = g/s['runId']/'trials.jsonl'
        for l in p.read_text(encoding='utf-8-sig').splitlines():
            try: r = json.loads(l)
            except Exception: continue
            if r.get('kind') in KINDS: print(l[:1800])
        sys.exit(0)
print('TIMEOUT: command not finished; status =', json.dumps(status())); sys.exit(2)
