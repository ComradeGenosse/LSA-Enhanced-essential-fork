"""Focused export/driver contract checks. Does not assert GTA acceptance."""
from pathlib import Path
import xml.etree.ElementTree as E, json, hashlib, struct
p=Path(__file__).parent;a=p/'assets';r=E.parse(a/'lsa_x6_corrugated.yft.xml').getroot()
assert struct.unpack_from('<I',(a/'lsa_x6_corrugated.yft').read_bytes(),4)[0]==171
bones=r.findall('./Drawable/Skeleton/Bones/Item');assert len(bones)==31,len(bones)
lo=r.find('./Drawable/BoundingBoxMin');hi=r.find('./Drawable/BoundingBoxMax')
dims=[float(hi.get(k))-float(lo.get(k)) for k in 'xyz'];assert abs(dims[0]-2.536)<.001 and abs(dims[2]-2.351)<.001 and dims[1]<.15,dims
groups=r.findall('./Physics/LOD1/Groups/Item');assert len(groups)==31,len(groups)
for g in groups[1:]:
 assert float(g.find('Strength').get('value'))==35 and float(g.find('Mass').get('value'))==4.5
s=(p/'WpsBreachLabX6.3.cs').read_text();assert 'const string AssetModel = "lsa_x6_corrugated";' in s
commit=s.split('long X6Commit()')[1].split('void X6Prepare')[0]
assert 'X6SetDormant(false)' in commit and 'CREATE_MODEL_HIDE_EXCLUDING_SCRIPT_OBJECTS' in commit
assert not any(x in commit for x in ['Yield(', 'Row(', 'Request('])
assert 'World.GetNearbyProps(x6HidePos, 8f)' in s
assert 'DetachFragmentPart' not in s.split('void X6Shot(')[1].split('bool X6FindOpening')[0]
result={'gen9_version':171,'bones':len(bones),'dimensions':dims,'one_tick_commit':True,'restore_reacquires_original':True,'driver_sha256':hashlib.sha256((p/'WpsBreachLabX6.3.cs').read_bytes()).hexdigest(),'scope':'offline export/source checks; live fracture and visual match require GTA evidence'}
print(json.dumps(result,indent=2));(p/'evidence/offline-checks.json').write_text(json.dumps(result,indent=2))
