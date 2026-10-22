import json,hashlib,collections
from pathlib import Path
out=Path('outputs'); repo=Path('work/repo');root=out/'live/evidence'
def rows(p):return [json.loads(x) for x in p.read_text(encoding='utf-8-sig').splitlines() if x.strip()]
def first(rs,k):return next((r for r in rs if r.get('kind')==k),None)
m=json.loads((root/'manifest.json').read_text());assert all(hashlib.sha256((root/r['path']).read_bytes()).hexdigest()==r['sha256'] for r in m['files'])
s=rows(root/'20261022-195402-37b2c6/trials.jsonl'); restore=rows(root/'20261022-195412-7439af/trials.jsonl')
p=rows(repo/'docs/agent-operations/2026-10-22/p2smoke-repair/live/evidence/20261022-175645-5efa53/trials.jsonl')
diag=first(s,'x7_diag_summary');samples=[r for r in s if r['kind']=='x7_diag_sample'];oldtrack=[r for r in p if r['kind']=='x7_track'];newfirst=[r for r in samples if r['scope']=='first']
summary={'candidate':'6faf2e8cbef6c27f32b96b811a0f01f1d0f40505','driverSha256':json.loads((out/'expected.json').read_text())['scriptSha256'],'verdict':'FAIL','readyToCloseX73':False,'shots':1,'runtime':json.loads((out/'expected.json').read_text()),'diagnostics':diag,'rejections':{r['reason']:r['observations'] for r in s if r['kind']=='x7_diag_count'},'firstSamples':newfirst,'result':first(s,'x7_result'),'restoration':first(restore,'x7_restored'),'witness':first(restore,'x7_witness'),'comparison':{'identicalShotGeometry':all(first(s,'x7_corridor')[k]==first(p,'x7_corridor')[k] for k in ['fromX','fromY','fromZ','aimX','aimY','aimZ','hit']),'x72cAcceptedSamples':len(oldtrack),'x72cFirstTrack':oldtrack[0],'x72cLastTrack':oldtrack[-1],'x72cResult':first(p,'x7_result'),'x73AcceptedSamples':sum(r['kind']=='x7_track' for r in s)},'evidenceFilesHashVerified':len(m['files']),'filesystemRestoration':'PASS_4_HASHES_3_ABSENT','controllerReleased':True,'gtaStopped':True}
for r in newfirst:
 seconds=r['ttcMs']/1000 if r['ttcMs']>=0 else None
 r['derivedImpactU']=r['u']+r['vu']*seconds if seconds is not None else None
 r['derivedImpactV']=r['v']+r['vv']*seconds if seconds is not None else None
summary['newCandidateFirstFrameAfterExplosion']=min(r['frame'] for r in samples)-diag['independentExplosionFrame']
(out/'FINAL.json').write_text(json.dumps(summary,indent=2))
h=json.loads((out/'handoff.json').read_text());h.update(controllerReleased=True,nextAction='Offline report only; no second shot, merge or X8');(out/'handoff.json').write_text(json.dumps(h,indent=2))
print(json.dumps({k:v for k,v in summary.items() if k not in ['result','runtime','firstSamples','comparison']},indent=2))
print('PRIOR RESULT',summary['comparison']['x72cResult'])
print('FIRST',oldtrack[0]);print('LAST',oldtrack[-1]);print('NEW FIRST',newfirst)
