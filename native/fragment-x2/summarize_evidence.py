"""Summarize X2 telemetry without promoting diagnostic or incomplete runs."""
from pathlib import Path
import json,math,argparse
ap=argparse.ArgumentParser();ap.add_argument('directory',type=Path);args=ap.parse_args()
trials=[]
for p in sorted(args.directory.glob('*.jsonl')):
    data=[json.loads(s) for s in p.read_text(encoding='utf-8-sig').splitlines() if s.strip()]
    header=next((r for r in data if r.get('kind')=='header'),{})
    commands=header.get('commands',[]);idx=-1;current=None
    for r in data:
        if r.get('kind')=='x2_start':
            idx+=1;current={'run':p.stem,'loadedUtc':header.get('loadedUtc'),'scriptSha256':header.get('scriptSha256'),'command':commands[idx] if idx<len(commands) else None,'start':r};trials.append(current)
        elif current is not None and r.get('kind') in ('x2_baseline','x2_geometry','x2_final_anchor','x2_verdict','error'):
            current[r['kind']]=r
    for t in [t for t in trials if t['run']==p.stem]:
        g=t.get('x2_geometry',{});mask=g.get('mask',[])
        coords=[(-1.5+(i%12+.5)*.25,(i//12+.5)*.25) for i,c in enumerate(mask) if str(c)=='0']
        t['clearAreaM2']=len(coords)*.0625
        if coords:
            t['clearCentroidUV']=[sum(c[k] for c in coords)/len(coords) for k in (0,1)]
            options=dict(x.split('=',1) for x in (t['command'] or '').split() if '=' in x)
            du=float(options.get('du',0));height=float(options.get('height',1))
            t['centroidErrorM']=math.hypot(t['clearCentroidUV'][0]-du,t['clearCentroidUV'][1]-height)
        t['completed']=any(r.get('kind')=='done' for r in data)
output=args.directory/'trial-summary.json';output.write_text(json.dumps(trials,indent=2)+'\n')
for t in trials:
    if t['run'].startswith('20261021'):
        print(t['run'],t['command'],t.get('x2_verdict',{}).get('verdict','ERROR' if 'error' in t else 'INCOMPLETE'),'clear',t['clearAreaM2'],'centroidError',t.get('centroidErrorM'))
