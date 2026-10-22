"""Reproducibly regenerate X7 from X6 without modifying frozen sources."""
from pathlib import Path
import re
from spec import a_variants
folder=Path(__file__).resolve().parent
s=(folder.parent/'fragment-x6'/'WpsBreachLabX6.3.cs').read_text(encoding='utf-8').replace('X6','X7').replace('x6','x7')
PATCHES=[["const string AssetModel = \"lsa_x7_corrugated\";","const string AssetModel = \"lsa_x7a_ctl\";"],["readonly Dictionary<int, int> debrisOwner =","static readonly string[] AllowedModels = new string[] { \"lsa_x7a_ctl\", \"lsa_x7a_sx\", \"lsa_x7a_hx\", \"lsa_x7a_j300\", \"lsa_x7a_j550\", \"lsa_x7a_j1000\", \"lsa_x7a_j1800\", \"lsa_x7a_j3200\", \"lsa_x7a_j5600\", \"lsa_x7a_j10000\", \"lsa_x7a_j1000f\", \"lsa_x7a_j3200f\" };\n    string x7Model = AssetModel;\n    readonly Dictionary<int, int> debrisOwner ="],["if (x7State != \"None\") throw new Exception(\"x7restore_first\");","if (x7State != \"None\") throw new Exception(\"x7restore_first\");\n        string requested=S(a,\"model\",AssetModel);\n        if (Array.IndexOf(AllowedModels,requested)<0) throw new Exception(\"model_not_in_pack_allowlist\");\n        x7Model=requested;"],["x7Twin = Spawn(AssetModel, \"physical\", oc, .25f, heading)","x7Twin = Spawn(x7Model, \"physical\", oc, .25f, heading)"],["bool predict = S(a, \"predict\", \"1\") == \"1\", fallback = S(a, \"fallback\", \"0\") == \"1\";","bool predict = S(a, \"predict\", \"1\") == \"1\", fallback = false;\n        if(S(a,\"fallback\",\"0\")!=\"0\") throw new Exception(\"x7_fallback_forbidden\");"],["float baseH = F(a, \"horizon\", 40f), frameK = F(a, \"framek\", 1.5f), miss = F(a, \"miss\", 0f);","float baseH = F(a, \"horizon\", 40f), frameK = F(a, \"framek\", 1.5f), miss = F(a, \"miss\", 0f);\n        float aimU=F(a,\"aimu\",0f),aimV=F(a,\"aimv\",1.05f);\n        if(Math.Abs(aimU)>1.12f || aimV<.2f || aimV>2.05f) throw new Exception(\"aim_outside_sheet\");"],["Vector3 centre = T.W(T.L(0f, cuMid, 1.05f));","Vector3 centre = T.W(T.L(0f, cuMid+aimU, T.V0+aimV));"],["Vector3 aim = T.W(T.L(tFace, cuMid + miss, 1.05f));","Vector3 aim = T.W(T.L(tFace, cuMid + miss + aimU, T.V0 + aimV));"],["Row(\"x7_shot_begin\", \"label\", label, \"mode\", mode,","Row(\"x7_shot_begin\", \"label\", label, \"model\", x7Model, \"aimU\", aimU, \"aimV\", aimV, \"postSide\", \"negative_u\", \"mode\", mode,"],["                    if (fallback || !predict)\n                    {\n                        // simple reactive fallback: swap now and give the twin the calibrated native rocket blast (X4 recipe). Labelled in the evidence.\n                        commitTicks = X7Commit(); committed = true; commitFrame = gf; commitMs = nowMs; fallbackUsed = true; commitProj = 0; commitFrameMs = fms;\n                        Vector3 bp = T.W(T.L(tFace - .4f, cuMid, 1f));\n                        World.AddExplosion(bp, ExplosionType.Rocket, 10f, 0, pl, true, false);\n                    }","                    // X7 never creates a fallback blast. Misses are recorded as misses."],["Row(\"x7_result\", \"label\", label, \"mode\", mode,","Row(\"x7_result\", \"label\", label, \"model\", x7Model, \"aimU\", aimU, \"aimV\", aimV, \"mode\", mode,"],["        x7State = committed ? \"Active\" : \"Armed\";","        if(committed) X7Mask(label,aimU,aimV);\n        x7State = committed ? \"Active\" : \"Armed\";"],["    bool X7FindOpening(out float u, out float widthM)","    // Read only: dense bidirectional SHVDN raycasts performed after the 60-frame settle.\n    void X7Mask(string label, float aimU, float aimV)\n    {\n        Lab T=x7Twin; float centreU=(T.U0+T.U1)/2f;\n        float pitch=.1f, uStart=T.U0+.06f, vStart=T.V0+.06f;\n        int nu=(int)Math.Floor((T.U1-uStart-.04f)/pitch)+1;\n        int nv=(int)Math.Floor((T.V0+2.131f-vStart-.04f)/pitch)+1; // sheet only; exclude X6's 0.22 m empty top band\n        StringBuilder mask=new StringBuilder(nu*nv);\n        for(int j=0;j<nv;j++)\n        {\n            for(int i=0;i<nu;i++) mask.Append((char)('0'+Classify(T,uStart+i*pitch,vStart+j*pitch)));\n            Yield();\n        }\n        Row(\"x7_mask\",\"label\",label,\"model\",x7Model,\"aimU\",aimU,\"aimV\",aimV,\n            \"u0\",uStart-centreU,\"v0\",vStart-T.V0,\"pitch\",pitch,\"nu\",nu,\"nv\",nv,\n            \"mask\",mask.ToString(),\"postSide\",\"negative_u\");\n    }\n    bool X7FindOpening(out float u, out float widthM)"]]
for old,new in PATCHES:
    assert s.count(old)==1, ('X6 drift',old[:75],s.count(old))
    s=s.replace(old,new)
# Admit only models named by the actually installed X7a/X7b pack.
EXTRA_PATCHES=[["if (Array.IndexOf(AllowedModels,requested)<0) throw new Exception(\"model_not_in_pack_allowlist\");","if (!X7InPackManifest(requested)) throw new Exception(\"model_not_in_pack_allowlist\");"],["    string x7Model = AssetModel;","    string x7Model = AssetModel;\n    // Pack-specific allowlist beside the script; never read during the one-tick commit.\n    bool X7InPackManifest(string model)\n    {\n        string path = Path.Combine(root, \"scripts-x7\", \"x7-models.txt\");\n        if (!File.Exists(path)) return false;\n        foreach (string line in File.ReadAllLines(path))\n            if (string.Equals(line.Trim(), model, StringComparison.Ordinal)) return true;\n        return false;\n    }\n"]]
for old,new in EXTRA_PATCHES:
    assert s.count(old)==1,('pack allowlist drift',old,s.count(old))
    s=s.replace(old,new)
# Independent frame witnesses, after dense sheet mask.
FRAME_PATCH=["        Row(\"x7_mask\",\"label\",label,\"model\",x7Model,\"aimU\",aimU,\"aimV\",aimV,\n            \"u0\",uStart-centreU,\"v0\",vStart-T.V0,\"pitch\",pitch,\"nu\",nu,\"nv\",nv,\n            \"mask\",mask.ToString(),\"postSide\",\"negative_u\");","        Row(\"x7_mask\",\"label\",label,\"model\",x7Model,\"aimU\",aimU,\"aimV\",aimV,\n            \"u0\",uStart-centreU,\"v0\",vStart-T.V0,\"pitch\",pitch,\"nu\",nu,\"nv\",nv,\n            \"mask\",mask.ToString(),\"postSide\",\"negative_u\");\n        // Separate rooted-post and 0.15 m sheet-band witnesses; mask deliberately excludes post.\n        int post=0, top=0, bottom=0, sampleCount=0;\n        foreach(float height in new float[] { .45f, 1.10f, 1.70f })\n            if(Classify(T,T.U0+.025f,T.V0+height)==1) post++;\n        for(float u=T.U0+.10f; u<T.U1-.05f; u+=.1f)\n        {\n            sampleCount++;\n            if(Classify(T,u,T.V0+.075f)==1) bottom++;\n            if(Classify(T,u,T.V0+2.131f-.075f)==1) top++;\n            Yield();\n        }\n        Row(\"x7_frame_bands\",\"label\",label,\"model\",x7Model,\"postBlocked\",post,\n            \"postTotal\",3,\"topBlocked\",top,\"bottomBlocked\",bottom,\"bandTotal\",sampleCount);"]
assert s.count(FRAME_PATCH[0])==1
s=s.replace(*FRAME_PATCH)

# X7 small recovery fix: align off-centre RPGs and avoid a 6m false near-target blast.
# Keep all native fragment physics and frozen X6 assets unchanged.
RECOVERY_PATCHES = [
    ["        PlacePlayerFacing(T, -x7Back, cuMid + x7Pu);", "        // Preserve the proven P0 setup; align off-centre shots with the target by default.\n        // A shot-level pu= override remains available for controlled comparisons.\n        float shotPu = F(a, \"pu\", Math.Abs(aimU) < .05f ? x7Pu : aimU);\n        PlacePlayerFacing(T, -x7Back, cuMid + shotPu);"],
    ["\"back\", x7Back, \"pu\", x7Pu, \"aimX\"", "\"back\", x7Back, \"pu\", shotPu, \"aimX\""],
    ["centre.X, centre.Y, centre.Z, 6f))", "centre.X, centre.Y, centre.Z, 1.5f))"],
    ["float pitch=.1f, uStart=T.U0+.06f, vStart=T.V0+.06f;", "float pitch=.1f, uStart=T.U0+.06f, vStart=T.V0+.16f; // skip lower empty collision edge"],
    ["Classify(T,u,T.V0+.075f)==1", "Classify(T,u,T.V0+.175f)==1"],
]
for old,new in RECOVERY_PATCHES:
    assert s.count(old)==1, ('X7 recovery drift',old,s.count(old))
    s=s.replace(old,new)

# Read-only launch-corridor diagnosis; never arm early to compensate for an obstacle.
CORRIDOR_OLD = "        int baselineN = frameMs.Count;\n        int fireFrame"
CORRIDOR_NEW = """        int baselineN = frameMs.Count;
        Vector3 shotFrom = pl.Position + new Vector3(0, 0, 1.0f) + pl.ForwardVector * .8f;
        RaycastResult corridor = World.Raycast(shotFrom, aim, (IntersectFlags)31, pl);
        Entity obstacle = corridor.HitEntity;
        float remaining = corridor.DidHit ? corridor.HitPosition.DistanceTo(aim) : 0f;
        Row("x7_corridor", "label", label, "pu", shotPu, "back", x7Back,
            "fromX", shotFrom.X, "fromY", shotFrom.Y, "fromZ", shotFrom.Z,
            "aimX", aim.X, "aimY", aim.Y, "aimZ", aim.Z,
            "hit", corridor.DidHit, "remainingM", remaining,
            "entity", obstacle == null ? 0 : obstacle.Handle,
            "model", obstacle == null ? 0 : obstacle.Model.Hash,
            "hitX", corridor.HitPosition.X, "hitY", corridor.HitPosition.Y, "hitZ", corridor.HitPosition.Z);
        if (S(a, "checkonly", "0") == "1") return;
        if (corridor.DidHit && remaining > .75f) throw new Exception("x7_launch_corridor_obstructed");
        int fireFrame"""
assert s.count(CORRIDOR_OLD)==1
s=s.replace(CORRIDOR_OLD,CORRIDOR_NEW)
old="Vector3 from = pl.Position + new Vector3(0, 0, 1.0f) + pl.ForwardVector * .8f;"
shot_start=s.index('    void X7Shot(')
head,shot=s[:shot_start],s[shot_start:]
assert shot.count(old)==1
s=head+shot.replace(old,"Vector3 from = shotFrom;")

assert 'const string Ver = "X7-0.1"' in s
assert 'World.AddExplosion(' not in s.split('void X7Shot(')[1].split('bool X7FindOpening')[0]
names=set(re.findall(r'"(lsa_x7a_[a-z0-9]+)"',s.split('AllowedModels =')[1].split('};')[0]))
assert names==set(v.name for v in a_variants()), names
(folder/'WpsBreachLabX7.3.cs').write_text(s,encoding='utf-8',newline='')
print('X7 driver generated:',len(s),'chars')
