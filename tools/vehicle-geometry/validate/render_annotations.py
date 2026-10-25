import json, math
from pathlib import Path

def render(data,out,mode):
    W,H=700,930;m=42;scale=min((W-2*m)/data["dimensions"]["width"],(H-2*m)/data["dimensions"]["length"]);xy=lambda x,y:(W/2+x*data["dimensions"]["width"]*scale,H/2+(y-.5)*data["dimensions"]["length"]*scale)
    ring=data["contour"]["vertices"]; base=[(p["x"],p["y"]) for p in ring]
    poly=lambda ps:" ".join(f"{xy(x,y)[0]:.1f},{xy(x,y)[1]:.1f}" for x,y in ps)
    label="Body annotation — source has no semantic panel IDs" if mode=="panels" else "Estimated VH3 influence regions — 48 sample locations"
    svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect width="100%" height="100%" fill="#111820"/><text x="350" y="24" fill="white" text-anchor="middle" font-family="sans-serif">{label}</text><polygon points="{poly(base)}" fill="#566c79" stroke="#e5eef2" stroke-width="3"/>']
    for r in data["windowRegions"]["rings"]:svg.append(f'<polygon points="{poly([(p["x"],p["y"]) for p in r])}" fill="#34b5e8" fill-opacity=".42" stroke="#83dfff" stroke-width="2"/>')
    colors={"front":"#ff6b5e","rear":"#f4a261","left":"#c77dff","right":"#4ea8de","roof":"#55d187"}
    if mode=="regions":
        for q in data["deformationMapping"]["probes"]:
            p=(q["hudXNormalized"],q["yNormalized"]);x,y=xy(*p);svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4" fill="{colors[q["region"]]}" stroke="#101010" stroke-width="1"/>')
    else:
        for key,v in data["wheels"].items():
            x,y=xy(v["hudNormalized"]["x"],v["hudNormalized"]["y"])
            svg.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="11" fill="#ffb347" stroke="#2c1b00" stroke-width="2"/><text x="{x+14:.1f}" y="{y+4:.1f}" fill="white" font-family="sans-serif" font-size="14">{key.upper()}</text>')
        svg.append(f'<text x="350" y="880" fill="#d8e2e8" text-anchor="middle" font-family="sans-serif">Cyan = glass-material projection • orange = named wheel centers</text>')
        svg.append(f'<text x="350" y="902" fill="#ffc17f" text-anchor="middle" font-family="sans-serif">Hood/trunk/door boundaries were not identifiable in source mesh names</text>')
    if mode=="regions":
        y=880
        for k,v in colors.items():svg.append(f'<circle cx="100" cy="{y}" r="6" fill="{v}"/><text x="112" y="{y+5}" fill="white" font-family="sans-serif" font-size="13">{k}</text>');
        svg.append(f'<text x="350" y="908" fill="#c8d3da" text-anchor="middle" font-family="sans-serif">Roof probes collapse onto plan view; points are estimated sample anchors</text>')
    svg.append('</svg>');Path(out).write_text(''.join(svg),encoding='utf-8')
if __name__=='__main__':
    import sys
    d=json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    render(d,sys.argv[2],'panels');render(d,sys.argv[3],'regions')
