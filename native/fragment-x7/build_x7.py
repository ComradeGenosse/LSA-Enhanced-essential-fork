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

# Preserve the checked-in X7.2b independent-section experiment and read-only probes.
# These are explicit, unique substitutions against the generated X7 baseline above.
# A frozen-source or patch drift aborts before the output file is written.
SECTION_PATCHES = [
    (
        'section identity and collision handles',
        r"""    string x7State = "None";
    Lab x7Twin, x7Orig; Prop x7Target;
    Vector3 x7HidePos; int x7HideModel; bool x7Hidden, x7Committed, x7Dormant;
    float x7Back = 9f, x7Pu = 1.5f; float x7OpenU;
""",
        r"""    string x7State = "None";
    Lab x7Twin, x7Orig; Prop x7Target;
    // X7.2b independent sections: x7Twin is the CENTRE section and doubles as the whole-fence measurement frame.
    readonly List<Lab> x7SecLabs = new List<Lab>(); readonly HashSet<int> x7SecHandles = new HashSet<int>();
    bool IsWall(Lab L, int h) { return L.Wall != null && (h == L.Wall.Handle || (L == x7Twin && x7SecHandles.Count > 0 && x7SecHandles.Contains(h))); }
    Vector3 x7HidePos; int x7HideModel; bool x7Hidden, x7Committed, x7Dormant;
    float x7Back = 9f, x7Pu = 1.5f; float x7OpenU;
""",
    ),
    (
        'section model and dormant helper',
        r"""    }

    void X7SetDormant(bool on)
    {
        Prop w = x7Twin.Wall;
        if (on)
        {
""",
        r"""    }

    // Section model for position i: position 0 carries the end post (secp); a pattern swaps only the strength tag.
    static string X7SecName(int i, string[] patK, string requested, string plainModel)
    {
        if (patK == null) return i == 0 ? requested : plainModel;
        return (i == 0 ? "lsa_x7d_secp_j" : "lsa_x7d_sec_j") + patK[i].Trim();
    }
    void X7SetDormant(bool on)
    {
        if (x7SecLabs.Count > 1) { foreach (Lab sl in x7SecLabs) X7SetDormantOne(sl.Wall, on); return; }
        X7SetDormantOne(x7Twin.Wall, on);
    }
    void X7SetDormantOne(Prop w, bool on)
    {
        if (on)
        {
""",
    ),
    (
        'section model allowlist and optional strength profile',
        r"""        if (!X7InPackManifest(requested)) throw new Exception("model_not_in_pack_allowlist");
        x7Model=requested;
        if (x4Active) throw new Exception("x4_active");
        if (S(a, "verified", "") != "1") throw new Exception("target_file_conflict_check_required");
""",
        r"""        if (!X7InPackManifest(requested)) throw new Exception("model_not_in_pack_allowlist");
        x7Model=requested;
        const string SecPost = "lsa_x7d_secp_"; bool sectional = requested.StartsWith(SecPost, StringComparison.Ordinal);
        string plainModel = sectional ? "lsa_x7d_sec_" + requested.Substring(SecPost.Length) : requested;
        if (sectional && !X7InPackManifest(plainModel)) throw new Exception("section_model_not_in_pack_allowlist");
        // Optional per-position strength profile (diagnostic): pat=K0,K1,K2,K3,K4 (negative-U to positive-U), e.g. pat=1400,1800,1800,1800,1400.
        string[] patK = null;
        if (sectional && S(a, "pat", "").Length > 0)
        {
            patK = S(a, "pat", "").Split(',');
            if (patK.Length != 5) throw new Exception("pat_requires_5_values");
            for (int pi = 0; pi < 5; pi++) if (!X7InPackManifest(X7SecName(pi, patK, requested, plainModel))) throw new Exception("pat_model_not_in_pack_allowlist:" + patK[pi]);
        }
        x7SecLabs.Clear(); x7SecHandles.Clear();
        if (x4Active) throw new Exception("x4_active");
        if (S(a, "verified", "") != "1") throw new Exception("target_file_conflict_check_required");
""",
    ),
    (
        'central section spawn',
        r"""            Row("x7_stage", "at", "twin_spawn_start");
            x7Dormant = true;
            try { x7Twin = Spawn(x7Model, "physical", oc, .25f, heading); } finally { x7Dormant = false; }
            if (x7Twin.Thin != x7Orig.Thin) throw new Exception("asset_thin_axis_mismatch");
            Vector3 lm = (x7Twin.Min + x7Twin.Max) / 2f;
""",
        r"""            Row("x7_stage", "at", "twin_spawn_start");
            x7Dormant = true;
            try { x7Twin = Spawn(sectional ? X7SecName(2, patK, requested, plainModel) : plainModel, "physical", oc, .25f, heading); } finally { x7Dormant = false; }
            if (x7Twin.Thin != x7Orig.Thin) throw new Exception("asset_thin_axis_mismatch");
            Vector3 lm = (x7Twin.Min + x7Twin.Max) / 2f;
""",
    ),
    (
        'five independently anchored sections',
        r"""            x7Twin.P0 = x7Twin.Wall.Position; x7Twin.Rt = x7Twin.Wall.RightVector; x7Twin.Fw = x7Twin.Wall.ForwardVector; x7Twin.Up = x7Twin.Wall.UpVector;
            float half = Math.Min((x7Orig.U1 - x7Orig.U0) / 2f, (x7Twin.U1 - x7Twin.U0) / 2f), cuMid = (x7Twin.U0 + x7Twin.U1) / 2f;
            x7Twin.U0 = cuMid - half; x7Twin.U1 = cuMid + half; x7Twin.Nu = Math.Max(1, (int)Math.Floor((x7Twin.U1 - x7Twin.U0) / x7Twin.P));
            x7Twin.Index = 0; x7Twin.Anchor = AttachNativeAnchor(x7Twin.Wall); ConfigureWall(x7Twin);
            X7SetDormant(true);
            labHandles.Add(x7Twin.Wall.Handle); labHandles.Add(x7Twin.Anchor.Handle);
            x7Twin.Start = x7Twin.Wall.Position; x7Twin.StartUp = x7Twin.Wall.UpVector; x7Twin.StartRight = x7Twin.Wall.RightVector;
            for (int f = 0; f < 90; f++) { Yield(); if (f == 30) X7SetDormant(true); }
""",
        r"""            x7Twin.P0 = x7Twin.Wall.Position; x7Twin.Rt = x7Twin.Wall.RightVector; x7Twin.Fw = x7Twin.Wall.ForwardVector; x7Twin.Up = x7Twin.Wall.UpVector;
            float half = Math.Min((x7Orig.U1 - x7Orig.U0) / 2f, (x7Twin.U1 - x7Twin.U0) / 2f), cuMid = (x7Twin.U0 + x7Twin.U1) / 2f;
            if (sectional)
            {
                // Five independent native fragment props side by side; x7Twin (centre section) keeps the whole-fence frame.
                float secW = x7Twin.U1 - x7Twin.U0; half = Math.Min((x7Orig.U1 - x7Orig.U0) / 2f, 2.5f * secW);
                x7SecLabs.Add(x7Twin); x7SecHandles.Add(x7Twin.Wall.Handle);
                x7Twin.Index = 0; x7Twin.Anchor = AttachNativeAnchor(x7Twin.Wall); ConfigureWall(x7Twin);
                labHandles.Add(x7Twin.Wall.Handle); labHandles.Add(x7Twin.Anchor.Handle);
                Vector3 secRt = x7Twin.Rt;
                x7Dormant = true;
                try
                {
                    for (int si = 0; si < 5; si++)
                    {
                        if (si == 2) continue;
                        Lab sl = Spawn(X7SecName(si, patK, requested, plainModel), "physical", oc + secRt * ((si - 2) * secW), .25f, heading);
                        sl.Index = 0; sl.Anchor = AttachNativeAnchor(sl.Wall); ConfigureWall(sl);
                        x7SecLabs.Add(sl); x7SecHandles.Add(sl.Wall.Handle); labHandles.Add(sl.Wall.Handle); labHandles.Add(sl.Anchor.Handle);
                        Row("x7_section", "index", si, "model", sl.Name, "handle", sl.Wall.Handle, "x", sl.Wall.Position.X, "y", sl.Wall.Position.Y, "z", sl.Wall.Position.Z, "offsetU", (si - 2) * secW);
                    }
                }
                finally { x7Dormant = false; }
                Row("x7_sections", "count", x7SecLabs.Count, "secW", secW, "model", requested, "plain", plainModel, "pat", patK == null ? "uniform" : string.Join(",", patK));
            }
            x7Twin.U0 = cuMid - half; x7Twin.U1 = cuMid + half; x7Twin.Nu = Math.Max(1, (int)Math.Floor((x7Twin.U1 - x7Twin.U0) / x7Twin.P));
            if (!sectional) { x7Twin.Index = 0; x7Twin.Anchor = AttachNativeAnchor(x7Twin.Wall); ConfigureWall(x7Twin); }
            X7SetDormant(true);
            if (!sectional) { labHandles.Add(x7Twin.Wall.Handle); labHandles.Add(x7Twin.Anchor.Handle); }
            x7Twin.Start = x7Twin.Wall.Position; x7Twin.StartUp = x7Twin.Wall.UpVector; x7Twin.StartRight = x7Twin.Wall.RightVector;
            for (int f = 0; f < 90; f++) { Yield(); if (f == 30) X7SetDormant(true); }
""",
    ),
    (
        'section-aware debris scan and probe buffers',
        r"""        float commitTtc = float.NaN, commitDt = float.NaN, commitHorizon = float.NaN, commitSpeed = float.NaN; double commitFrameMs = 0;
        Dictionary<int, Vector3> prevPos = new Dictionary<int, Vector3>(); Dictionary<int, long> prevMs = new Dictionary<int, long>();
        List<Lab> labs = new List<Lab> { T };
        long t0 = clock.ElapsedMilliseconds;
        while (clock.ElapsedMilliseconds - t0 < (long)(waitS * 1000f) && !abortRequested)
""",
        r"""        float commitTtc = float.NaN, commitDt = float.NaN, commitHorizon = float.NaN, commitSpeed = float.NaN; double commitFrameMs = 0;
        Dictionary<int, Vector3> prevPos = new Dictionary<int, Vector3>(); Dictionary<int, long> prevMs = new Dictionary<int, long>();
        List<Lab> labs = x7SecLabs.Count > 1 ? new List<Lab>(x7SecLabs) : new List<Lab> { T };
        // X7.2b read-only fracture-propagation probe (probe=1): per-frame strip raycasts + native debris first-seen/velocity. Never alters physics.
        bool probeOn = S(a, "probe", "0") == "1"; int probeFrames = 0; const int probeMaxFrames = 220; double probeMsMax = 0, probeMsSum = 0;
        List<string[]> probeRows = new List<string[]>(); List<object[]> debRows = new List<object[]>(); HashSet<int> debSeen = new HashSet<int>();
        long t0 = clock.ElapsedMilliseconds;
        while (clock.ElapsedMilliseconds - t0 < (long)(waitS * 1000f) && !abortRequested)
""",
    ),
    (
        'read-only fracture propagation probe',
        r"""                }
            }
            if (exFrame >= 0 && fracFrame < 0 && committed && (gf - exFrame) % 3 == 0)
            {
                if (ScanDebris(labs, T.P0, 30f) > 0 || AliveFlagged(0) > 0) { fracFrame = gf; fracMs = nowMs; }
""",
        r"""                }
            }
            if (probeOn && committed && commitFrame >= 0 && probeFrames < probeMaxFrames && (exFrame < 0 || nowMs - exMs <= 320))
        {
            long pp0 = Stopwatch.GetTimestamp();
            StringBuilder code = new StringBuilder(16);
            for (int sIdx = 0; sIdx < 5; sIdx++)
            {
                float su = cuMid + (sIdx - 2) * 0.507f; int blockedN = 0, debN = 0, othN = 0;
                foreach (float sv in new float[] { .4f, 1.0f, 1.6f })
                { byte cc = Classify(T, su, T.V0 + sv); if (cc == 1) blockedN++; else if (cc == 2) debN++; else if (cc == 3) othN++; }
                code.Append((char)('0' + blockedN)); code.Append((char)('0' + debN)); code.Append((char)('0' + othN)); if (sIdx < 4) code.Append(' ');
            }
            if (exFrame >= 0)
            {
                ScanDebris(labs, T.P0, 4f);
                foreach (int dh in flaggedSet)
                {
                    int dOwner; if (!debrisOwner.TryGetValue(dh, out dOwner) || dOwner != 0 || !Exists(dh)) continue;
                    Entity dp = Entity.FromHandle(dh); if (dp == null) continue; Vector3 dpos = dp.Position, dvel = dp.Velocity; float du2, dt2, dv2; LocalUTV(T, dpos, out du2, out dt2, out dv2);
                    bool first = debSeen.Add(dh);
                    debRows.Add(new object[] { gf, dh, du2, dt2, dv2, Vector3.Dot(dvel, axU), Vector3.Dot(dvel, axT), Vector3.Dot(dvel, T.Up), dvel.Length(), first });
                }
            }
            double pms = (Stopwatch.GetTimestamp() - pp0) * 1000.0 / Stopwatch.Frequency; probeMsSum += pms; if (pms > probeMsMax) probeMsMax = pms;
            probeRows.Add(new string[] { gf.ToString(Inv), (exFrame >= 0 ? (gf - exFrame).ToString(Inv) : "pre"), pms.ToString("F3", Inv), code.ToString() });
            probeFrames++;
        }
        if (exFrame >= 0 && fracFrame < 0 && committed && (gf - exFrame) % 3 == 0)
            {
                if (ScanDebris(labs, T.P0, 30f) > 0 || AliveFlagged(0) > 0) { fracFrame = gf; fracMs = nowMs; }
""",
    ),
    (
        'deferred probe logging',
        r"""        int over50 = 0, over100 = 0; for (int i = baselineN; i < frameMs.Count; i++) { if (frameMs[i] > 50) over50++; if (frameMs[i] > 100) over100++; }
        foreach (X7Frame fr in trace) Row("x7_track", "label", label, "frame", fr.Frame, "ms", fr.Ms - fireMs, "frameMs", fr.FrameMs, "t", fr.T, "u", fr.U, "v", fr.V, "vt", fr.Vt, "speed", fr.Speed, "ttcMs", fr.Ttc, "onCourse", fr.On, "proj", fr.Proj);
        Row("x7_frames", "label", label, "baselineMedianMs", bMed, "baselineMaxMs", bMax, "windowMaxMs", winMax, "windowMaxFrame", winFrame, "over50", over50, "over100", over100, "frames", frameMs.Count - baselineN);
        int wOrig = X7Witness("after_shot_original", x7Orig);
""",
        r"""        int over50 = 0, over100 = 0; for (int i = baselineN; i < frameMs.Count; i++) { if (frameMs[i] > 50) over50++; if (frameMs[i] > 100) over100++; }
        foreach (X7Frame fr in trace) Row("x7_track", "label", label, "frame", fr.Frame, "ms", fr.Ms - fireMs, "frameMs", fr.FrameMs, "t", fr.T, "u", fr.U, "v", fr.V, "vt", fr.Vt, "speed", fr.Speed, "ttcMs", fr.Ttc, "onCourse", fr.On, "proj", fr.Proj);
        if (probeOn)
        {
            foreach (string[] pr in probeRows) Row("x7_probe", "label", label, "frame", int.Parse(pr[0], Inv), "dFrame", pr[1], "probeMs", double.Parse(pr[2], Inv), "strips_blocked_debris_other", pr[3]);
            foreach (object[] dr in debRows) Row("x7_debris", "label", label, "frame", dr[0], "dFrame", (int)dr[0] - exFrame, "handle", dr[1], "u", dr[2], "t", dr[3], "v", dr[4], "vu", dr[5], "vt", dr[6], "vv", dr[7], "speed", dr[8], "first", dr[9]);
            Row("x7_probe_summary", "label", label, "frames", probeFrames, "meanProbeMs", probeFrames > 0 ? probeMsSum / probeFrames : 0, "maxProbeMs", probeMsMax, "explosionFrame", exFrame, "commitFrame", commitFrame, "aimU", aimU);
        }
        Row("x7_frames", "label", label, "baselineMedianMs", bMed, "baselineMaxMs", bMax, "windowMaxMs", winMax, "windowMaxFrame", winFrame, "over50", over50, "over100", over100, "frames", frameMs.Count - baselineN);
        int wOrig = X7Witness("after_shot_original", x7Orig);
""",
    ),
    (
        'unknown collision diagnostic',
        r"""            "commitCallMs", commitTicks * 1000.0 / Stopwatch.Frequency, "nativeParts", parts, "originalBlocked", wOrig, "twinBlocked", wTwin, "twinIntactAfterMiss", twinIntactAfterMiss, "pools", PoolsRaw());
        if(committed) X7Mask(label,aimU,aimV);
        x7State = committed ? "Active" : "Armed";
        int hold = (int)F(a, "hold", 0f); if (hold > 0) Hold("x7_after_shot", hold);
    }

""",
        r"""            "commitCallMs", commitTicks * 1000.0 / Stopwatch.Frequency, "nativeParts", parts, "originalBlocked", wOrig, "twinBlocked", wTwin, "twinIntactAfterMiss", twinIntactAfterMiss, "pools", PoolsRaw());
        if(committed) X7Mask(label,aimU,aimV);
        if (probeOn && committed) X7DiagOther(label);
        x7State = committed ? "Active" : "Armed";
        int hold = (int)F(a, "hold", 0f); if (hold > 0) Hold("x7_after_shot", hold);
    }

    // X7.2b read-only diagnostic: identify entities that block the opening but are neither a section wall nor registered debris.
    void X7DiagOther(string label)
    {
        Lab L = x7Twin; int logged = 0; float cu = (L.U0 + L.U1) / 2f;
        for (float u = L.U0 + .06f; u < L.U1 && logged < 10; u += .1f)
            foreach (float dv in new float[] { .4f, 1.0f, 1.6f })
            {
                Vector3 pa = L.W(L.L(L.T0, u, L.V0 + dv)), pb = L.W(L.L(L.T1, u, L.V0 + dv));
                for (int dir = 0; dir < 2 && logged < 10; dir++)
                {
                    RaycastResult rr = dir == 0 ? World.Raycast(pa, pb, (IntersectFlags)17, null) : World.Raycast(pb, pa, (IntersectFlags)17, null);
                    if (!rr.DidHit) continue;
                    Entity he = rr.HitEntity; int h = he == null ? 0 : he.Handle;
                    if (IsWall(L, h) || debris.Contains(h)) continue;
                    int type = -1, mh = 0; try { if (he != null) { type = Function.Call<int>(Hash.GET_ENTITY_TYPE, h); mh = he.Model.Hash; } } catch { }
                    Row("x7_other_hit", "label", label, "u", u - cu, "dv", dv, "dir", dir, "handle", h, "type", type, "model", (uint)mh, "isLabHandle", labHandles.Contains(h), "isStray", strayNew.Contains(h), "hx", rr.HitPosition.X, "hy", rr.HitPosition.Y, "hz", rr.HitPosition.Z);
                    logged++;
                }
            }
        Row("x7_other_hit_summary", "label", label, "logged", logged);
    }

""",
    ),
    (
        'section restore reset',
        r"""        {
            if (x7Hidden) Function.Call(Hash.REMOVE_MODEL_HIDE, x7HidePos.X, x7HidePos.Y, x7HidePos.Z, X7HideRadius, x7HideModel, false);
            x7Hidden = false; x7Committed = false; x7State = "None"; x7Twin = null;
        }
        for (int f = 0; f < 60; f++) Yield();
""",
        r"""        {
            if (x7Hidden) Function.Call(Hash.REMOVE_MODEL_HIDE, x7HidePos.X, x7HidePos.Y, x7HidePos.Z, X7HideRadius, x7HideModel, false);
            x7Hidden = false; x7Committed = false; x7State = "None"; x7Twin = null; x7SecLabs.Clear(); x7SecHandles.Clear();
        }
        for (int f = 0; f < 60; f++) Yield();
""",
    ),
    (
        'SHVDN section collision classification',
        r"""            if (!rr.DidHit) return 0;
            Entity he = rr.HitEntity; int e2 = he == null ? 0 : he.Handle;
            if (e2 == L.Wall.Handle) return 1; if (debris.Contains(e2)) return 2; NoteOther(e2, rr.HitPosition); return 3;
        }
        int h=Function.Call<int>(Hash.START_EXPENSIVE_SYNCHRONOUS_SHAPE_TEST_LOS_PROBE,a.X,a.Y,a.Z,b.X,b.Y,b.Z,17,0,0);
""",
        r"""            if (!rr.DidHit) return 0;
            Entity he = rr.HitEntity; int e2 = he == null ? 0 : he.Handle;
            if (IsWall(L, e2)) return 1; if (debris.Contains(e2)) return 2; NoteOther(e2, rr.HitPosition); return 3;
        }
        int h=Function.Call<int>(Hash.START_EXPENSIVE_SYNCHRONOUS_SHAPE_TEST_LOS_PROBE,a.X,a.Y,a.Z,b.X,b.Y,b.Z,17,0,0);
""",
    ),
    (
        'native section collision classification',
        r"""            if(status!=2){failedRays++;return 3;}
            if(hit.GetResult<int>()==0)return 0;
            int e=entity.GetResult<int>();if(e==L.Wall.Handle)return 1;if(debris.Contains(e)){int o;if(debrisOwner.TryGetValue(e,out o)&&o!=L.Index)foreignHits++;return 2;}NoteOther(e,pos.GetResult<Vector3>());return 3;
        }
    }
""",
        r"""            if(status!=2){failedRays++;return 3;}
            if(hit.GetResult<int>()==0)return 0;
            int e=entity.GetResult<int>();if(IsWall(L,e))return 1;if(debris.Contains(e)){int o;if(debrisOwner.TryGetValue(e,out o)&&o!=L.Index)foreignHits++;return 2;}NoteOther(e,pos.GetResult<Vector3>());return 3;
        }
    }
""",
    ),
    (
        'shared section collision classification',
        r"""        if (!r.DidHit) return 0;
        Entity e = r.HitEntity; int h = e == null ? 0 : e.Handle;
        if (h != 0 && L.Wall != null && h == L.Wall.Handle) return 1;
        if (h != 0 && debris.Contains(h)) return 2;
        return 3;
""",
        r"""        if (!r.DidHit) return 0;
        Entity e = r.HitEntity; int h = e == null ? 0 : e.Handle;
        if (h != 0 && IsWall(L, h)) return 1;
        if (h != 0 && debris.Contains(h)) return 2;
        return 3;
""",
    ),
]
for label, old, new in SECTION_PATCHES:
    count = s.count(old)
    if count != 1:
        raise RuntimeError(f'X7.2b generation drift ({label}): expected one match, got {count}')
    s = s.replace(old, new, 1)

# X7.2c selective-fracture experiment (gameplay-tested, see evidence/x72c): all five sections stay visible and
# solid after the swap; native damage/breaking is enabled only on two adjacent selected sections (sel=a,b).
X72C_PATCHES = [
    (
        'selective fracture fields and helpers',
        "    Vector3 x7HidePos; int x7HideModel; bool x7Hidden, x7Committed, x7Dormant;\n",
        """    Vector3 x7HidePos; int x7HideModel; bool x7Hidden, x7Committed, x7Dormant;
    // X7.2c selective fracture: positions (0..4, negative U to positive U) whose native damage/breaking is enabled at commit; null = all (X7.2b behaviour).
    HashSet<int> x7SelPos; readonly Dictionary<int, Vector3> x7SecStart = new Dictionary<int, Vector3>();
    static int X7PosOf(int labIdx) { return labIdx == 0 ? 2 : (labIdx <= 2 ? labIdx - 1 : labIdx); }
    void X7ActivateSelective()
    {
        // Every section becomes visible and solid; only the selected pair is allowed to take native damage / break. Flags first, then collision, then visibility.
        for (int i = 0; i < x7SecLabs.Count; i++)
        {
            Prop w = x7SecLabs[i].Wall; bool sel = x7SelPos.Contains(X7PosOf(i));
            Function.Call(Hash.SET_DISABLE_FRAG_DAMAGE, w.Handle, !sel); Function.Call(Hash.SET_DISABLE_BREAKING, w.Handle, !sel); Function.Call(Hash.SET_ENTITY_CAN_BE_DAMAGED, w.Handle, sel);
            Function.Call(Hash.SET_ENTITY_COLLISION, w.Handle, true, true);
            w.IsVisible = true;
        }
    }
    void X7SecState(string label)
    {
        for (int i = 0; i < x7SecLabs.Count; i++)
        {
            Lab sl = x7SecLabs[i]; Prop w = sl.Wall; int pos = X7PosOf(i); bool ex = w != null && w.Exists(); Vector3 st; x7SecStart.TryGetValue(pos, out st);
            Row("x7_secstate", "label", label, "pos", pos, "selected", x7SelPos != null && x7SelPos.Contains(pos), "exists", ex, "visible", ex && w.IsVisible, "frag", ex && w.IsFragmentObject,
                "attached", ex && sl.Anchor != null && w.IsAttachedTo(sl.Anchor), "moved", ex ? (w.Position - st).Length() : -1f, "rootAlive", sl.Anchor != null && sl.Anchor.Exists());
        }
    }
""",
    ),
    (
        'selective commit',
        "        X7SetDormant(false);\n        Function.Call(Hash.CREATE_MODEL_HIDE_EXCLUDING",
        "        if (x7SelPos != null) X7ActivateSelective(); else X7SetDormant(false);\n        Function.Call(Hash.CREATE_MODEL_HIDE_EXCLUDING",
    ),
    (
        'sel= parsing',
        "        x7SecLabs.Clear(); x7SecHandles.Clear();\n",
        """        x7SecLabs.Clear(); x7SecHandles.Clear(); x7SecStart.Clear(); x7SelPos = null;
        if (S(a, "sel", "").Length > 0)
        {
            if (!sectional) throw new Exception("sel_requires_sectional_model");
            string[] sp = S(a, "sel", "").Split(','); if (sp.Length != 2) throw new Exception("sel_requires_2_positions");
            int s0 = int.Parse(sp[0].Trim(), Inv), s1 = int.Parse(sp[1].Trim(), Inv);
            if (s0 < 0 || s1 > 4 || s1 != s0 + 1) throw new Exception("sel_must_be_adjacent_lo_hi_0_to_4");
            x7SelPos = new HashSet<int> { s0, s1 };
        }
""",
    ),
    (
        'sections row reports sel',
        '"pat", patK == null ? "uniform" : string.Join(",", patK));',
        '"pat", patK == null ? "uniform" : string.Join(",", patK), "sel", x7SelPos == null ? "all" : string.Join(",", x7SelPos));',
    ),
    (
        'record section start positions',
        "            x7Twin.Start = x7Twin.Wall.Position; x7Twin.StartUp",
        "            if (sectional) for (int si2 = 0; si2 < x7SecLabs.Count; si2++) x7SecStart[X7PosOf(si2)] = x7SecLabs[si2].Wall.Position;\n            x7Twin.Start = x7Twin.Wall.Position; x7Twin.StartUp",
    ),
    (
        'section state row after shot',
        "        if (probeOn)\n        {\n            foreach (string[] pr in probeRows)",
        "        if (x7SecLabs.Count > 1) X7SecState(label);\n        if (probeOn)\n        {\n            foreach (string[] pr in probeRows)",
    ),
    (
        'restore clears selection',
        "x7Twin = null; x7SecLabs.Clear(); x7SecHandles.Clear();\n        }",
        "x7Twin = null; x7SecLabs.Clear(); x7SecHandles.Clear(); x7SelPos = null;\n        }",
    ),
]
for label, old, new in X72C_PATCHES:
    count = s.count(old)
    if count != 1:
        raise RuntimeError(f'X7.2c generation drift ({label}): expected one match, got {count}')
    s = s.replace(old, new, 1)

assert 'const string Ver = "X7-0.1"' in s
assert 'World.AddExplosion(' not in s.split('void X7Shot(')[1].split('bool X7FindOpening')[0]
names=set(re.findall(r'"(lsa_x7a_[a-z0-9]+)"',s.split('AllowedModels =')[1].split('};')[0]))
assert names==set(v.name for v in a_variants()), names
(folder/'WpsBreachLabX7.3.cs').write_text(s,encoding='utf-8',newline='')
print('X7 driver generated:',len(s),'chars')
