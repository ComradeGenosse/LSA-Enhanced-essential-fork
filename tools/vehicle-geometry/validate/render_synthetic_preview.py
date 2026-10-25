import json, math
from pathlib import Path

def render(data,out):
    ring=data["contour"]["vertices"]; W,H=620,900;m=42; width=data["dimensions"]["width"]; length=data["dimensions"]["length"]; scale=min((W-2*m)/width,(H-2*m)/length)
    def xy(x,y):return W/2+x*width*scale,H/2+(y-.5)*length*scale
    base=[(p["x"],p["y"]) for p in ring]
    # Explicit synthetic front-left displacement field, not measured game damage.
    moved=[]
    for x,y in base:
        d2=((x+.39)/.14)**2+(y/.10)**2; w=math.exp(-d2)
        moved.append((x+.075*w,y+.045*w))
    pts=lambda ps:" ".join(f"{xy(x,y)[0]:.1f},{xy(x,y)[1]:.1f}" for x,y in ps)
    impact=xy(-.40,.035)
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect width="100%" height="100%" fill="#111820"/><text x="310" y="24" fill="white" text-anchor="middle" font-family="sans-serif">Buffalo • estimated regions + synthetic front-left impact</text><polygon points="{pts(base)}" fill="#546b7a" fill-opacity=".18" stroke="#82939e" stroke-dasharray="5 5" stroke-width="2"/><polygon points="{pts(moved)}" fill="#e05952" fill-opacity=".42" stroke="#ff746d" stroke-width="3"/><circle cx="{impact[0]:.1f}" cy="{impact[1]:.1f}" r="11" fill="#ffd166" stroke="#301d00" stroke-width="2"/><text x="{impact[0]+15:.1f}" y="{impact[1]-8:.1f}" fill="#ffd166" font-family="sans-serif">synthetic impact</text><text x="310" y="870" fill="#d7e2e8" text-anchor="middle" font-family="sans-serif">dashed = extracted baseline • red = synthetic deformation only</text></svg>'
    Path(out).write_text(svg,encoding="utf-8")
if __name__=="__main__":
    import sys
    render(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8")),sys.argv[2])
