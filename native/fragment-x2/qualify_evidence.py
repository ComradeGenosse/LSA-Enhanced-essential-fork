"""Report fixed-asset X2 gates from preserved telemetry; missing evidence fails."""
from pathlib import Path
from collections import defaultdict
import json,argparse
ap=argparse.ArgumentParser();ap.add_argument('directory',type=Path);ap.add_argument('--script-sha',default='5be72312804d55e7c0ea9b68c2182fbad7fdf4aead86852623bd1c4ffb78adae');args=ap.parse_args()
pack='180618adbe9e56bdaa9a6220e82a87effc6d624ea2b78926cc348263e60af347'
rows=json.loads((args.directory/'trial-summary.json').read_text())
selected=[t for t in rows if t['start'].get('assetSha256')==pack and t['scriptSha256']==args.script_sha]
blasts=[t for t in selected if t['start'].get('explosive')!='none']
confirmed=[t for t in blasts if t.get('x2_verdict',{}).get('verdict')=='LOCAL_ANCHORED_BREACH_CONFIRMED']
launches=set(t['loadedUtc'] for t in confirmed)
local=[t for t in blasts if t.get('centroidErrorM',999)<=.5]
areas=defaultdict(list)
for t in blasts:
    o=dict(x.split('=',1) for x in (t['command'] or '').split() if '=' in x)
    e=o.get('explosive');scale=float(o.get('scale',1))
    if float(o.get('du',0))==0 and float(o.get('height',1))==1 and scale=={'grenade':.25,'sticky':3,'rocket':10}.get(e):areas[e].append(t['clearAreaM2'])
mean={k:sum(v)/len(v) for k,v in areas.items()}
gates={
 'threeFreshLaunchesWithConfirmedTraversal':len(launches)>=3,
 'twentyCompletedBlastTrials':len(blasts)>=20 and all(t.get('completed') and 'x2_verdict' in t for t in blasts),
 'centroidWithinHalfMetreAtLeast80Percent':len(blasts)>0 and len(local)/len(blasts)>=.8,
 'calibratedCentreChargeAreaIncreases':len(mean)==3 and mean['grenade']<mean['sticky']<mean['rocket'],
 'nativeWallDebrisWithinChunkCount':all(t.get('x2_geometry',{}).get('flaggedDetached',999)<=30 for t in blasts),
 'singleMeasuredScriptRevision':len(set(t['scriptSha256'] for t in selected))==1,
 'expectedNativeFragmentGroups':all(t['start'].get('isFragment') and t['start'].get('groups')==31 for t in selected),
 'confirmedBaselinesSolid':all(t.get('x2_baseline',{}).get('blocked')==120 and t['x2_baseline'].get('sweepClearColumns')==0 and t['x2_baseline'].get('failedRayRequests')==0 for t in confirmed),
 'freshIntactControls':len(set(t['loadedUtc'] for t in selected if t.get('x2_verdict',{}).get('verdict')=='CONTROL_CLOSED'))>=3,
}
report={'packSha256':pack,'scriptSha256':args.script_sha,'status':'QUALIFIED' if all(gates.values()) else 'INCOMPLETE','gates':gates,'blasts':len(blasts),'confirmedTraversals':len(confirmed),'confirmedLaunches':sorted(launches),'centroidPasses':len(local),'centroidTrials':len(blasts),'meanCalibratedCentreClearAreaM2':mean,'allBlastAnchoringVerified':all(t.get('x2_verdict',{}).get('anchored',False) for t in blasts),'note':'No-opening trials fail centroid gate. Charge comparison uses explicit native scales .25/3/10, not vanilla weapon balance. Non-traversable and anchor-unverified blast trials remain in the dataset.'}
(args.directory/'qualification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
