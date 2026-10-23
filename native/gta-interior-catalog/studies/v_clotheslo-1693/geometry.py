import json, pathlib, collections, math, os
import numpy as np
R=[json.loads(l) for l in open(os.environ['X9_RAW'])]
def name(p): return p.split('\\')[-1].rsplit('.',1)[0]
from geometry_math import rotation as rot, box_faces
P=np.array([1693.4592,4823.674,40.883717]); Q=rot([0,0,-.6590842,.7520692])
def tolocal(p): return (np.asarray(p)-P)@Q
def world(p):return np.asarray(p)@Q.T+P
placements={x['entity']['name']:x for x in R if x['kind']=='placement' and x['file'].startswith('x64r')}
mlos=[x for x in R if x['kind']=='mlo']; mlo=next(x for x in mlos if x['file'].startswith('x64h'))
ents=collections.defaultdict(list)
for en in mlo['entities']:
 ents[en['entity']['name']].append((en['index'],en['entity']))
placed=collections.defaultdict(list)
for pl in R:
 if pl['kind']=='placement' and pl['file'].startswith('x64r'):
  placed[pl['entity']['name']].append(pl)
tri=[]
for x in R:
 if x['kind']=='mesh':
  n=x.get('item') or name(x['file']); v=np.array(x['points']); ix=np.array(x['indices']).reshape(-1,3)
  transforms=[]
  if n in ents:
   for ei,d in ents[n]:
    q=np.array(d['rot']);q[:3]*=-1
    wv=world((v*np.array([d['scaleXY'],d['scaleXY'],d['scaleZ']]))@rot(q).T+np.array(d['pos']))
    transforms.append((ei,wv))
  elif n in placed:
   for pl in placed[n]:
    d=pl['entity'];q=np.array(pl['orientation'])
    wv=(v*np.array([d['scaleXY'],d['scaleXY'],d['scaleZ']]))@rot(q).T+np.array(d['pos'])
    transforms.append((pl['index'],wv))
  for ei,wv in transforms:
   for i,ids in enumerate(ix):tri.append(dict(kind='mesh',file=x['file'],entityIndex=ei,model=x['model'],geometry=x['geometry'],id=i,points=wv[ids],local=tolocal(wv[ids]),name=n))
 elif x['kind']=='polys':
  for p in x['polygons'] or []:
   if p['type'] not in ['Triangle','Box']:continue
   wv=np.array(p['points']); wv=world(wv) if name(x['file'])=='v_clotheslo' else wv
   faces=[wv]
   if p['type']=='Box':
    faces=box_faces(wv)
   for face in faces:tri.append(dict(kind='collision',file=x['file'],child=x['child'],id=p['id'],primitive=p['type'],material=p['material'],points=face,local=tolocal(face),name=name(x['file'])))
def summary(t):
 a=t['local'];n=np.cross(a[1]-a[0],a[2]-a[0]);area=np.linalg.norm(n)/2;n=n/(2*area) if area else n
 return a.min(0),a.max(0),n,area
