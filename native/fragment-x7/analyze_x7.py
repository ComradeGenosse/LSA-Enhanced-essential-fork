"""Analyze REAL X7 game JSONL; no simulated gameplay and no inferred T*.

Kind rows: x7_result / x7_mask / x7_player_result / x7_frames / x7_restored.
Masks use 0=clear, 1=twin, 2=native debris, 3=other. No input means no acceptance.
"""
import argparse, json, math
from pathlib import Path
from collections import deque
from spec import LEVELS, POINTS, W, SHEET_H, cells

def classify(detached,area,blocked,centroid_error):
    if detached >= 25 or blocked < .25: return "WHOLE"
    if 4 <= detached <= 14 and .6 <= area <= 2.8 and blocked >= .4 and centroid_error <= .45:
        return "LOCAL"
    if 1 <= detached <= 3 or .2 <= area <= .6: return "SMALL"
    if detached == 0 and area < .2: return "NONE"
    return "PARTIAL"

def largest_component(mask,nu,nv):
    seen=set();best=0
    for j in range(nv):
        for i in range(nu):
            idx=j*nu+i
            if idx in seen or mask[idx]=="1": continue
            q=deque([idx]);seen.add(idx);count=0
            while q:
                v=q.popleft();count+=1;x=v%nu;y=v//nu
                for xx,yy in ((x-1,y),(x+1,y),(x,y-1),(x,y+1)):
                    w=yy*nu+xx
                    if 0<=xx<nu and 0<=yy<nv and w not in seen and mask[w]!="1":
                        seen.add(w);q.append(w)
            best=max(best,count)
    return best

def decode(result,row):
    nu,nv=int(row["nu"]),int(row["nv"])
    mask=row["mask"]
    assert nu>0 and nv>0 and len(mask)==nu*nv and set(mask)<=set("0123"),"invalid collision mask"
    pitch=float(row["pitch"])
    assert .095<=pitch<=.105
    u0,v0=float(row["u0"]),float(row["v0"])
    indices=[i for i,c in enumerate(mask) if c!="1"]
    twin=sum(c=="1" for c in mask)
    debris=sum(c=="2" for c in mask)
    other=sum(c=="3" for c in mask)
    total=len(mask);area=len(indices)*pitch*pitch
    blocked=twin/total
    pts=[(u0+(i%nu)*pitch,v0+(i//nu)*pitch) for i in indices]
    centroid=([sum(x for x,y in pts)/len(pts),sum(y for x,y in pts)/len(pts)]
              if pts else None)
    aimU=float(result["aimU"]);aimV=float(result["aimV"])
    error=math.dist(centroid,(aimU,aimV)) if centroid else float("inf")
    layout="torn36" if result["model"].startswith("lsa_x7b") else "grid6x5"
    part=[]
    for x0,x1,z0,z1 in cells(layout):
        ids=[j*nu+i for j in range(nv) for i in range(nu)
             if x0<=u0+i*pitch<x1 and z0<=v0+j*pitch<z1]
        native=sum(mask[k]=="1" for k in ids)
        part.append({"covered":len(ids),"blocked":native,
                     "state":"attached_like" if ids and native/len(ids)>=.5 else "missing_like"})
    return {"label":result["label"],"model":result["model"],"aimU":aimU,"aimV":aimV,
            "nativeParts":int(result.get("nativeParts",0)),"removedAreaM2":round(area,4),
            "blockedFraction":round(blocked,4),"debrisFraction":round(debris/total,4),
            "otherHitFraction":round(other/total,4),"centroid":centroid,
            "centroidErrorM":round(error,4) if math.isfinite(error) else None,
            "largestRemovedComponentM2":round(largest_component(mask,nu,nv)*pitch*pitch,4),
            "pieceStates":part,"class":classify(int(result.get("nativeParts",0)),area,blocked,error),
            "mask":mask,"nu":nu,"nv":nv,"pitch":pitch,"u0":u0,"v0":v0,
            "commitEarlyFrames":result.get("framesCommitToExplosion"),
            "fallbackUsed":result.get("fallbackUsed",False),"commitMs":result.get("commitCallMs"),
            "late":result.get("late",False),"committed":result.get("committed",False)}

def iou(a,b):
    if (a["nu"],a["nv"],a["pitch"],a["u0"],a["v0"])!=(b["nu"],b["nv"],b["pitch"],b["u0"],b["v0"]): return None
    sa={i for i,c in enumerate(a["mask"]) if c!="1"}
    sb={i for i,c in enumerate(b["mask"]) if c!="1"}
    return round(len(sa&sb)/len(sa|sb),4) if sa|sb else 1.0

def load(paths):
    shots=[]
    for path in paths:
        rows=[json.loads(line) for line in Path(path).read_text(encoding="utf-8-sig").splitlines() if line.strip()]
        results=[(i,row) for i,row in enumerate(rows) if row.get("kind")=="x7_result"]
        for k,(i,rr) in enumerate(results):
            tail=results[k+1][0] if k+1<len(results) else len(rows)
            subset=rows[i:tail]
            masks=[row for row in subset if row.get("kind")=="x7_mask" and row.get("label")==rr.get("label")]
            if not masks:
                shots.append({"label":rr.get("label"),"model":rr.get("model"),"error":"missing_x7_mask","source":str(path)})
                continue
            value=decode(rr,masks[-1]);value["source"]=str(path)
            frame=next((v for v in subset if v.get("kind")=="x7_frames"),{})
            value["windowMaxMs"]=frame.get("windowMaxMs")
            walk=next((v for v in subset if v.get("kind")=="x7_player_result"),{})
            value["walk"]={"crossed":walk.get("crossed"),"outsideFootprint":walk.get("outsideFootprint"),
                           "maxRise":walk.get("maxRise")} if walk else None
            shots.append(value)
    return shots

def choose(shots):
    ctl=next((x for x in shots if x.get("model")=="lsa_x7a_ctl"),None)
    if not ctl or ctl.get("class")!="WHOLE":
        return {"selected_tstar":None,"state":"STOP_CONTROL","reason":"X6 control not WHOLE"}
    center={int(x["model"].split("_j")[1]):x for x in shots
            if x.get("model","").startswith("lsa_x7a_j") and
               x["model"].split("_j")[1].isdigit() and abs(x.get("aimU",9))<.05 and
               abs(x.get("aimV",9)-1.05)<.05 and x.get("class")}
    for a,b in zip(LEVELS,LEVELS[1:]):
        if a in center and b in center:
            counts=(center[a]["nativeParts"],center[b]["nativeParts"])
            if (counts[0]>=15 and counts[1]<=3) or (counts[1]>=15 and counts[0]<=3):
                return {"selected_tstar":None,"state":"CLIFF","between":[a,b],"counts":counts,"fallback":"F1"}
    local=[(k,v) for k,v in center.items() if v.get("class")=="LOCAL"]
    if not local:
        return {"selected_tstar":None,"state":"NO_LOCAL_YET","next":"Step ladder toward LOCAL, max four shots"}
    # If consecutive LOCAL levels exist, bigger removed region wins, per frozen plan.
    pick=max(local,key=lambda pair:(pair[1]["removedAreaM2"],-pair[0]))
    return {"selected_tstar":pick[0],"state":"CANDIDATE_ONLY","note":"Not accepted until position/traversal/safety gate passes"}

def gate_a(shots,decision):
    k=decision.get("selected_tstar")
    if k is None: return {"pass":False,"reasons":["No observed T*"]}
    def find(u,v):
        return next((x for x in shots if x.get("model")==f"lsa_x7a_j{k}" and
                    abs(x.get("aimU",9)-u)<.05 and abs(x.get("aimV",9)-v)<.05),None)
    rows={p:find(*POINTS[p]) for p in ("P0","P1","P2","P3")}
    reasons=[]
    for point in ("P0","P2","P3"):
        if not rows[point] or rows[point].get("class")!="LOCAL": reasons.append(point+" not LOCAL")
    if rows["P1"] is None: reasons.append("P1 walk missing")
    else:
        w=rows["P1"].get("walk")
        if not w or not w.get("crossed") or w.get("outsideFootprint") or w.get("maxRise") is None or w["maxRise"]>.45:
            reasons.append("P1 walk not verified")
    for i,a in enumerate(("P0","P2","P3")):
        for b in ("P0","P2","P3")[i+1:]:
            if rows[a] and rows[b]:
                v=iou(rows[a],rows[b])
                if v is None or v>.5: reasons.append(a+"/"+b+" IoU gate failed")
    for p,v in rows.items():
        if not v: continue
        if v.get("fallbackUsed") or not v.get("committed") or (v.get("commitEarlyFrames") or 0)<1:
            reasons.append(p+" native/predictive gate failed")
        if v.get("commitMs") is None or v["commitMs"]>.2 or v.get("windowMaxMs") is None or v["windowMaxMs"]>50:
            reasons.append(p+" performance gate unverified/failed")
    # Restore witness must be examined in the collected log.
    return {"pass":not reasons,"reasons":reasons,"selected_tstar":k}

def report(shots):
    decision=choose(shots);gate=gate_a(shots,decision)
    comparisons=[]
    for i,a in enumerate(shots):
        for b in shots[i+1:]:
            if a.get("model")==b.get("model") and a.get("mask") and b.get("mask"):
                comparisons.append({"a":a["label"],"b":b["label"],"IoU":iou(a,b)})
    return {"schema":1,"source_type":"runtime_X7_JSONL_only","shots":shots,
            "decision":decision,"session_a_gate":gate,"pairwise":comparisons}

def main():
    ap=argparse.ArgumentParser();ap.add_argument("jsonl",nargs="+");ap.add_argument("--output",required=True)
    ns=ap.parse_args();output=Path(ns.output);output.mkdir(parents=True,exist_ok=True)
    data=report(load(ns.jsonl))
    (output/"summary.json").write_text(json.dumps(data,indent=2)+"\n",encoding="utf-8")
    lines=["# X7 evidence (unmodified gameplay logs)", "", "Decision: "+data["decision"]["state"],
           "T*: "+str(data["decision"]["selected_tstar"]),
           "Session A gate: "+str(data["session_a_gate"]["pass"]),"",
           "| Shot | Variant | detached | area m² | blocked | centroid error | class |",
           "|---|---|---:|---:|---:|---:|---|"]
    for v in data["shots"]:
        lines.append(f"| {v.get('label')} | {v.get('model')} | {v.get('nativeParts','—')} | {v.get('removedAreaM2','—')} | {v.get('blockedFraction','—')} | {v.get('centroidErrorM','—')} | {v.get('class','MISSING')} |")
        if v.get("mask"):
            lines.extend(["",f"## {v['label']} collision mask (0=clear, 1=twin, 2=debris, 3=other)","", "```text"])
            for j in range(v["nv"]-1,-1,-1):
                lines.append(v["mask"][j*v["nu"]:(j+1)*v["nu"]])
            lines.append("```")
    lines.extend(["","Gate failures: "+("; ".join(data["session_a_gate"]["reasons"]) or "none")])
    (output/"summary.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
    print(json.dumps({"shots":len(data["shots"]),"decision":data["decision"],
                      "session_a_gate":data["session_a_gate"]},indent=2))
if __name__=="__main__":main()
