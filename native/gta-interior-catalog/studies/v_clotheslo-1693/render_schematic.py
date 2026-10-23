"""Authored schematic from derived coordinates; no source mesh rendering."""
from PIL import Image, ImageDraw, ImageFont
import json
from pathlib import Path

root = Path(__file__).parent
e = json.loads((root/'evidence.json').read_text())
im = Image.new('RGB', (1450, 950), '#f6f8fb')
d = ImageDraw.Draw(im)
font_path = 'C:/Windows/Fonts/arial.ttf'
def font(n): return ImageFont.truetype(font_path, n)
def text(p, s, n=20, color='#223047'): d.text(p, s, font=font(n), fill=color)
text((40,25), 'v_clotheslo: real interior, shared collision owners', 34)
text((40,75), 'Read-only archive study | NO-GO for a simple wall swap | schematic, not a traversal proof', 21)
d.rounded_rectangle((30,130,750,900), radius=15, fill='white')
d.rounded_rectangle((775,130,1420,900), radius=15, fill='white')
text((55,150), 'Plan in MLO local XY', 26)
text((55,188), 'Walls/partitions simplified from inspected planes', 17)
def pt(x,y): return (390+x*31, 520-y*31)
def line(points,color,width=3): d.line([pt(*p) for p in points],fill=color,width=width)
d.rectangle((pt(-7.44,6.73),pt(7.37,-6.66)),fill='#edf5fc',outline='#377cb6',width=3)
d.rectangle((pt(1.055,5.851),pt(7.176,3.129)),fill='#d9ece0',outline='#44855c',width=3)
text(pt(1.2,5.3),'Store room',17)
text(pt(-1,-.5),'Shop floor',23)
for p in e['portals']:
    xy=[(v[0],v[1]) for v in p['localCorners']]
    line(xy,'#9b4cc3',5)
    x=sum(v[0] for v in xy)/4;y=sum(v[1] for v in xy)/4
    text((pt(x,y)[0]+5,pt(x,y)[1]-18),str(p['index']),17,'#6b248f')
line([(-7.522,-3),(-7.522,-1.5)],'#d33438',9)
line([(-7.428,-3),(-6.888,-3),(-6.888,-1.5),(-7.428,-1.5)],'#e19b28',4)
text((55,685),'Selected wall',20,'#bd252a')
d.line([(200,700),pt(-7.522,-2.25)], fill='#bd252a',width=2)
text((55,755),'Red: 1.5 m section on the north-facing side',18)
text((55,788),'Purple: portals 0-7; none at the red section',18)
text((55,821),'Amber: display obstruction behind the wall',18)
text((55,854),'Main-floor and store topology shown; entity sets unproven',16)
text((800,150),'Cross-section at local Y = -2.25',25)
text((800,190),'Collision alternatives shown in separate lanes',18)
def xp(x):return 830+(x+7.8)*520
def bar(y,x0,x1,label,color):
    d.rectangle((xp(x0),y,xp(x1),y+28),fill=color)
    text((800,y-31),label,18)
bar(285,-7.522,-7.109,'Normal YBN: child 0, Box 237','#9fbed6')
d.line([(xp(-7.522),365),(xp(-7.522),398)],fill='#bd252a',width=5)
text((800,333),'High-detail YBN: triangles 3008 / 3009',18)
bar(465,-7.450344,-7.430408,'MLO wall: child 1, Box 241','#8bb49e')
bar(555,-7.427653,-6.88843,'Display: child 0, Box 1','#e5b15d')
d.line([(xp(-7.44),635),(xp(-7.44),665)],fill='#454c75',width=4)
text((800,603),'Interior render wall near X = -7.44043',18)
text((800,715),'Wall centre (world):',20)
text((800,750),'1690.241669, 4830.835561, 42.213717',20)
text((800,800),'A hole in the exterior alone leaves interior',18)
text((800,829),'wall collision, display collision and LOD surfaces.',18)
text((40,918),'Source: evidence.json | No game launch or asset modification | Authored diagram; no proprietary mesh arrays',17)
im.save(root/'schematic.png')
