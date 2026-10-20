"""Reject malformed MVP authoring before deployment; uses only original exported XML."""
from pathlib import Path
import json,struct,xml.etree.ElementTree as E
p=Path(__file__).resolve().parent/'assets'
f=E.parse(p/'lsa_x2_concrete.yft.xml').getroot();y=E.parse(p/'lsa_x2.ytyp.xml').getroot()
assert int(f.find('UnknownC4').get('value')) & 64 == 0, 'Prop must not use vehicle physics-child drawables'
groups=f.findall('./Physics/LOD1/Groups/Item');children=f.findall('./Physics/LOD1/Children/Item');bounds=f.findall('./Physics/LOD1/Archetype/Bounds/Children/Item')
assert len(groups)==len(children)==len(bounds)==31,(len(groups),len(children),len(bounds))
positions=[]
for b in bounds[1:]:
 lo=[float(b.find('BoxMin').get(a)) for a in 'xyz'];hi=[float(b.find('BoxMax').get(a)) for a in 'xyz']
 assert all(abs(a+c)<1e-6 for a,c in zip(lo,hi)), 'Box geometry must be centered on its transform'
 matrix=list(map(float,b.findtext('CompositeTransform').split()));positions.append(tuple(matrix[12:15]))
assert len(set(positions))==30,'Overlapping collider transforms'
assert sorted(set(round(v[0],3) for v in positions))==[-1.25,-.75,-.25,.25,.75,1.25]
assert sorted(set(round(v[2],3) for v in positions))==[.25,.75,1.25,1.75,2.25]
arch=y.find('./archetypes/Item');flags=int(arch.find('flags').get('value'))
assert flags&131072 and not flags&32,'Dynamic required; Static forbidden'
assert not arch.findtext('physicsDictionary'),'Fragment contains embedded collision'
magic,version,*_=struct.unpack('<4I',(p/'lsa_x2_concrete.yft').read_bytes()[:16]);assert magic==0x37435352 and version==171,(magic,version)
assert f.find('./Drawable/ShaderGroup/TextureDictionary') is not None,'Embedded texture required'
report={'groups':len(groups),'children':len(children),'distinctChunkColliderTransforms':len(set(positions)),'nativeYftVersion':version,'archetypeFlags':flags,'status':'OFFLINE_ASSET_CHECK_PASS','inGameDestruction':'UNPROVEN'}
print(json.dumps(report,indent=2));(p/'validation.json').write_text(json.dumps(report,indent=2))

