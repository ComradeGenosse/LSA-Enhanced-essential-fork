"""Correct aggregate rigid-bone bounds after Sollumz export; never alter chunk geometry."""
from pathlib import Path
import math,xml.etree.ElementTree as E

def finalize(folder):
    folder=Path(folder)
    yp=E.parse(folder/'lsa_x6.ytyp.xml').getroot().find('./archetypes/Item')
    lo=[float(yp.find('bbMin').get(a)) for a in 'xyz']
    hi=[float(yp.find('bbMax').get(a)) for a in 'xyz']
    center=[(a+b)/2 for a,b in zip(lo,hi)]
    radius=math.sqrt(sum(((b-a)/2)**2 for a,b in zip(lo,hi)))
    p=folder/'lsa_x6_corrugated.yft.xml';tree=E.parse(p);root=tree.getroot()
    for node in [root,root.find('Drawable')]:
        for axis,value in zip('xyz',center):node.find('BoundingSphereCenter').set(axis,str(value))
        node.find('BoundingSphereRadius').set('value',str(radius))
    for tag,values in [('BoundingBoxMin',lo),('BoundingBoxMax',hi)]:
        for axis,value in zip('xyz',values):root.find('Drawable/'+tag).set(axis,str(value))
    tree.write(p,encoding='UTF-8',xml_declaration=True)
    print('Aggregate bounds finalized:',lo,hi,radius)

if __name__=='__main__':finalize(Path(__file__).resolve().parent/'assets')
