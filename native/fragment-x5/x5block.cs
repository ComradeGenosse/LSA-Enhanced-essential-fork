    // ===================================================================== X5 (ASTRA-001 X5-0.1): just-in-time hot swap
    // The ORIGINAL wall is left completely untouched (visible, colliding, undamaged) while a dormant twin of the frozen X2
    // native-fragment wall waits at the final transform: invisible, collision off (physics kept), damage/breaking disabled,
    // native joint anchor already attached. x5shot tracks the real RPG projectile every frame and, shortly before the predicted
    // impact, swaps in ONE script tick with no yield: twin collision+damage+visibility on, then the original model hidden
    // (CREATE_MODEL_HIDE_EXCLUDING_SCRIPT_OBJECTS, the X4 recipe). The real projectile then fractures the twin natively.
    // x5restore deletes the twin/anchor/verified debris, removes the model hide and checks the original again.
    // Verbs: x5prepare, x5shot, x5walk, x5restore. Reuses X4/X3 spawn, anchor, ownership-verified cleanup and the stable World.Raycast probes.
    string x5State = "None";
    Lab x5Twin, x5Orig; Prop x5Target;
    Vector3 x5HidePos; int x5HideModel; bool x5Hidden, x5Committed, x5Dormant;
    float x5Back = 9f, x5Pu = 1.5f; float x5OpenU;
    bool x5TimeSet; int x5SavedH, x5SavedM, x5SavedS;
    const float X5HideRadius = .15f;

    // Witness rays: 9 fixed rays (3 columns x 3 heights) across the wall thickness. Counts rays that hit lab L's own wall entity.
    int X5Witness(string label, Lab L)
    {
        int blocked = 0, total = 0, other = 0; float uc = (L.U0 + L.U1) / 2f;
        foreach (float du in new float[] { -.7f, 0f, .7f })
            foreach (float dz in new float[] { .4f, 1.0f, 1.6f })
            {
                byte c = Classify(L, uc + du, L.V0 + dz); total++;
                if (c == 1) blocked++; else if (c != 0) other++;
            }
        Row("x5_witness", "label", label, "blocked", blocked, "total", total, "otherHits", other);
        return blocked;
    }

    void X5SetDormant(bool on)
    {
        Prop w = x5Twin.Wall;
        if (on)
        {
            w.IsVisible = false;
            Function.Call(Hash.SET_ENTITY_COLLISION, w.Handle, false, true);
            Function.Call(Hash.SET_DISABLE_FRAG_DAMAGE, w.Handle, true); Function.Call(Hash.SET_DISABLE_BREAKING, w.Handle, true); Function.Call(Hash.SET_ENTITY_CAN_BE_DAMAGED, w.Handle, false);
        }
        else
        {
            Function.Call(Hash.SET_DISABLE_FRAG_DAMAGE, w.Handle, false); Function.Call(Hash.SET_DISABLE_BREAKING, w.Handle, false); Function.Call(Hash.SET_ENTITY_CAN_BE_DAMAGED, w.Handle, true);
            Function.Call(Hash.SET_ENTITY_COLLISION, w.Handle, true, true);
            w.IsVisible = true;
        }
    }

    // The hot commit: no yields, no logging, no model requests. Replacement collision first, then the original goes away.
    long X5Commit()
    {
        long t0 = Stopwatch.GetTimestamp();
        X5SetDormant(false);
        Function.Call(Hash.CREATE_MODEL_HIDE_EXCLUDING_SCRIPT_OBJECTS, x5HidePos.X, x5HidePos.Y, x5HidePos.Z, X5HideRadius, x5HideModel, true);
        x5Hidden = true; x5Committed = true;
        return Stopwatch.GetTimestamp() - t0;
    }

    void X5Prepare(Dictionary<string, string> a)
    {
        if (x5State != "None") throw new Exception("x5restore_first");
        if (x4Active) throw new Exception("x4_active");
        if (S(a, "verified", "") != "1") throw new Exception("target_file_conflict_check_required");
        uint thash = uint.Parse(S(a, "hash", "0"), Inv);
        Vector3 tpos = new Vector3(F(a, "tx", 0f), F(a, "ty", 0f), F(a, "tz", 0f));
        Vector3 start = new Vector3(F(a, "px", tpos.X), F(a, "py", tpos.Y - 8f), F(a, "pz", tpos.Z + 1.5f));
        PrepareSite(); ResetX3(); x4RayShv = true;
        if (!x5TimeSet) { x5SavedH = Function.Call<int>(Hash.GET_CLOCK_HOURS); x5SavedM = Function.Call<int>(Hash.GET_CLOCK_MINUTES); x5SavedS = Function.Call<int>(Hash.GET_CLOCK_SECONDS); x5TimeSet = true; Row("x5_time", "savedH", x5SavedH, "savedM", x5SavedM, "savedS", x5SavedS); }
        Function.Call(Hash.SET_CLOCK_TIME, 12, 0, 0);
        Ped pl = Game.Player.Character; pl.Position = start; WaitCollision(pl);
        for (int f = 0; f < 120; f++) Yield();
        Prop target = null; float bestD = 1.5f;
        foreach (Prop p in World.GetNearbyProps(tpos, 8f))
        {
            if (p == null || !p.Exists() || owned.Contains(p) || (uint)p.Model.Hash != thash) continue;
            float d = p.Position.DistanceTo(tpos); if (d < bestD) { bestD = d; target = p; }
        }
        if (target == null) throw new Exception("placed_target_missing");
        x5Orig = X4OriginalLab(target);
        float width = x5Orig.U1 - x5Orig.U0, height = x5Orig.V1 - x5Orig.V0;
        Row("x5_target", "hash", thash, "x", target.Position.X, "y", target.Position.Y, "z", target.Position.Z, "heading", target.Heading, "width", width, "height", height, "matchDistance", bestD);
        if (Math.Abs(width - 3f) > .8f || Math.Abs(height - 2.5f) > .45f) throw new Exception("target_size_requires_asset_adaptation");
        if (Vector3.Dot(target.UpVector, Vector3.WorldUp) < .985f) throw new Exception("target_not_upright");
        int w0 = X5Witness("original_before", x5Orig);
        if (w0 < 8) throw new Exception("original_collision_not_found");
        x5Target = target; x5HidePos = target.Position; x5HideModel = target.Model.Hash; x5Hidden = false; x5Committed = false;
        x5State = "Preparing";
        try
        {
            Vector3 oc = x5Orig.W(x5Orig.L((x5Orig.T0 + x5Orig.T1) / 2f, (x5Orig.U0 + x5Orig.U1) / 2f, x5Orig.BaseZ));
            float heading = target.Heading;
            Row("x5_stage", "at", "twin_spawn_start");
            x5Dormant = true;
            try { x5Twin = Spawn(AssetModel, "physical", oc, .25f, heading); } finally { x5Dormant = false; }
            if (x5Twin.Thin != x5Orig.Thin) throw new Exception("asset_thin_axis_mismatch");
            Vector3 lm = (x5Twin.Min + x5Twin.Max) / 2f;
            if (Math.Abs(lm.X) + Math.Abs(lm.Y) > .02f) throw new Exception("asset_origin_not_bbox_centre");
            x5Twin.P0 = x5Twin.Wall.Position; x5Twin.Rt = x5Twin.Wall.RightVector; x5Twin.Fw = x5Twin.Wall.ForwardVector; x5Twin.Up = x5Twin.Wall.UpVector;
            float half = Math.Min((x5Orig.U1 - x5Orig.U0) / 2f, (x5Twin.U1 - x5Twin.U0) / 2f), cuMid = (x5Twin.U0 + x5Twin.U1) / 2f;
            x5Twin.U0 = cuMid - half; x5Twin.U1 = cuMid + half; x5Twin.Nu = Math.Max(1, (int)Math.Floor((x5Twin.U1 - x5Twin.U0) / x5Twin.P));
            x5Twin.Index = 0; x5Twin.Anchor = AttachNativeAnchor(x5Twin.Wall); ConfigureWall(x5Twin);
            X5SetDormant(true);
            labHandles.Add(x5Twin.Wall.Handle); labHandles.Add(x5Twin.Anchor.Handle);
            x5Twin.Start = x5Twin.Wall.Position; x5Twin.StartUp = x5Twin.Wall.UpVector; x5Twin.StartRight = x5Twin.Wall.RightVector;
            for (int f = 0; f < 90; f++) { Yield(); if (f == 30) X5SetDormant(true); }
            Row("x5_stage", "at", "twin_dormant", "visible", x5Twin.Wall.IsVisible, "frag", x5Twin.Wall.IsFragmentObject, "wallX", x5Twin.Wall.Position.X, "wallY", x5Twin.Wall.Position.Y, "wallZ", x5Twin.Wall.Position.Z, "heading", x5Twin.Wall.Heading, "attached", x5Twin.Wall.IsAttachedTo(x5Twin.Anchor));
            int wt = X5Witness("twin_dormant", x5Twin);
            int wo = X5Witness("original_armed", x5Orig);
            if (wt != 0) throw new Exception("dormant_twin_collides");
            if (wo < 8) throw new Exception("original_changed_while_armed");
            SnapshotPre(oc, 30f);
            x5Back = F(a, "back", 9f); x5Pu = F(a, "pu", 1.5f);
            PlacePlayerFacing(x5Twin, -x5Back, cuMid + x5Pu);
            pl.Weapons.Give(WeaponHash.RPG, 4, true, true);
            Row("x5_armed", "originalBlocked", wo, "twinBlocked", wt, "assetWidth", x5Twin.Max.X - x5Twin.Min.X, "assetHeight", x5Twin.Max.Z - x5Twin.Min.Z, "playerX", pl.Position.X, "playerY", pl.Position.Y, "playerZ", pl.Position.Z, "pools", PoolsRaw());
            x5State = "Armed";
        }
        catch { X5Restore(); throw; }
        int hold = (int)F(a, "hold", 0f); if (hold > 0) Hold("x5_armed", hold);
    }

    sealed class X5Frame { public int Frame; public long Ms; public double FrameMs; public float T, U, V, Vt, Ttc, Speed; public bool On; public int Proj; }

    void X5Shot(Dictionary<string, string> a)
    {
        if (x5State != "Armed") throw new Exception("x5prepare_required_or_already_active");
        string mode = S(a, "mode", "script");                    // script | weapon | manual | none
        bool predict = S(a, "predict", "1") == "1", fallback = S(a, "fallback", "0") == "1";
        float baseH = F(a, "horizon", 40f), frameK = F(a, "framek", 1.5f), miss = F(a, "miss", 0f);
        float waitS = F(a, "wait", mode == "manual" ? 90f : (mode == "none" ? 10f : 12f));
        string label = S(a, "label", mode);
        Ped pl = Game.Player.Character; Lab T = x5Twin;
        float cuMid = (T.U0 + T.U1) / 2f;
        float tFace = T.Thin == 1 ? T.Min.Y : T.Min.X;
        Vector3 axT = T.Thin == 0 ? T.Rt : T.Fw, axU = T.Thin == 0 ? T.Fw : T.Rt;
        Vector3 centre = T.W(T.L(0f, cuMid, 1.05f));
        Vector3 aim = T.W(T.L(tFace, cuMid + miss, 1.05f));
        uint wh = (uint)WeaponHash.RPG;
        PlacePlayerFacing(T, -x5Back, cuMid + x5Pu);
        pl.Weapons.Give(WeaponHash.RPG, 4, true, true);
        Function.Call(Hash.REQUEST_WEAPON_ASSET, wh, 31, 0);
        long tw = clock.ElapsedMilliseconds; while (!Function.Call<bool>(Hash.HAS_WEAPON_ASSET_LOADED, wh) && clock.ElapsedMilliseconds - tw < 4000) Yield();
        for (int f = 0; f < 30; f++) Yield();
        List<X5Frame> trace = new List<X5Frame>(); List<double> frameMs = new List<double>(); List<int> frameNo = new List<int>();
        Row("x5_shot_begin", "label", label, "mode", mode, "predict", predict, "fallback", fallback, "baseHorizonMs", baseH, "frameK", frameK, "miss", miss, "back", x5Back, "pu", x5Pu, "aimX", aim.X, "aimY", aim.Y, "aimZ", aim.Z);
        // pre-shot frame baseline (no shape tests, nothing else running)
        long lastT = Stopwatch.GetTimestamp();
        for (int f = 0; f < 60; f++) { Yield(); long n = Stopwatch.GetTimestamp(); frameMs.Add((n - lastT) * 1000.0 / Stopwatch.Frequency); frameNo.Add(Game.FrameCount); lastT = n; }
        int baselineN = frameMs.Count;
        int fireFrame = Game.FrameCount; long fireMs = clock.ElapsedMilliseconds;
        if (mode == "script")
        {
            Vector3 from = pl.Position + new Vector3(0, 0, 1.0f) + pl.ForwardVector * .8f;
            Row("x5_charge", "method", "rpg_projectile_SHOOT_SINGLE_BULLET_BETWEEN_COORDS", "fromX", from.X, "fromY", from.Y, "fromZ", from.Z);
            Function.Call(Hash.SHOOT_SINGLE_BULLET_BETWEEN_COORDS, from.X, from.Y, from.Z, aim.X, aim.Y, aim.Z, 100, true, wh, pl.Handle, true, false, 80f);
        }
        else if (mode == "weapon")
        {
            Function.Call(Hash.SET_CURRENT_PED_WEAPON, pl.Handle, wh, true);
            Row("x5_charge", "method", "TASK_SHOOT_AT_COORD_real_weapon_fire");
            Function.Call(Hash.TASK_SHOOT_AT_COORD, pl.Handle, aim.X, aim.Y, aim.Z, 3000, unchecked((int)0x5D60E4E0));
        }
        else if (mode == "manual")
        {
            Function.Call(Hash.SET_CURRENT_PED_WEAPON, pl.Handle, wh, true);
            Row("x5_charge", "method", "manual_player_fire", "waitS", waitS);
        }
        bool committed = false, late = false, fallbackUsed = false, seen = false, gone = false;
        int commitFrame = -1, exFrame = -1, fracFrame = -1, goneFrame = -1, commitProj = 0; long commitMs = 0, commitTicks = 0, exMs = 0, fracMs = 0;
        float commitTtc = float.NaN, commitDt = float.NaN, commitHorizon = float.NaN, commitSpeed = float.NaN; double commitFrameMs = 0;
        Dictionary<int, Vector3> prevPos = new Dictionary<int, Vector3>(); Dictionary<int, long> prevMs = new Dictionary<int, long>();
        List<Lab> labs = new List<Lab> { T };
        long t0 = clock.ElapsedMilliseconds;
        while (clock.ElapsedMilliseconds - t0 < (long)(waitS * 1000f) && !abortRequested)
        {
            Yield();
            long nowT = Stopwatch.GetTimestamp(); double fms = (nowT - lastT) * 1000.0 / Stopwatch.Frequency; lastT = nowT;
            int gf = Game.FrameCount; frameMs.Add(fms); frameNo.Add(gf);
            long nowMs = clock.ElapsedMilliseconds;
            // --- projectile tracking (cheap: one nearby query, a few dot products)
            Projectile best = null; float bestVt = 0f, bu = 0f, bt = 0f, bv = 0f, bttc = float.NaN, bspeed = 0f; bool bon = false;
            Projectile[] ps = null; try { ps = World.GetNearbyProjectiles(centre, 90f); } catch { }
            if (ps != null)
            {
                foreach (Projectile p in ps)
                {
                    if (p == null || !p.Exists()) continue;
                    Vector3 pos = p.Position, vel = p.Velocity; int ph = p.Handle;
                    if (vel.Length() < 5f && prevPos.ContainsKey(ph)) { double dts = (nowMs - prevMs[ph]) / 1000.0; if (dts > 0) vel = (pos - prevPos[ph]) / (float)dts; }
                    prevPos[ph] = pos; prevMs[ph] = nowMs;
                    float u, t, v; LocalUTV(T, pos, out u, out t, out v);
                    float vt = Vector3.Dot(vel, axT), vu = Vector3.Dot(vel, axU), vv = Vector3.Dot(vel, T.Up);
                    float dt = tFace - t;
                    if (vt <= 3f || dt < -.6f) continue;
                    float ttc = Math.Max(0f, dt) / vt;
                    float uc = u + vu * ttc, vc = v + vv * ttc;
                    bool on = uc >= T.U0 - .4f && uc <= T.U1 + .4f && vc >= T.V0 - .4f && vc <= T.V1 + .4f;
                    if (best == null || dt < (tFace - bt)) { best = p; bestVt = vt; bu = u; bt = t; bv = v; bttc = ttc; bspeed = vel.Length(); bon = on; }
                }
            }
            if (best != null)
            {
                seen = true;
                trace.Add(new X5Frame { Frame = gf, Ms = nowMs, FrameMs = fms, T = bt, U = bu, V = bv, Vt = bestVt, Ttc = bttc * 1000f, Speed = bspeed, On = bon, Proj = best.Handle });
                float horizon = baseH + (float)fms * frameK;
                if (!committed && predict && bon && bttc * 1000f <= horizon)
                {
                    commitTicks = X5Commit();
                    committed = true; commitFrame = gf; commitMs = nowMs; commitTtc = bttc * 1000f; commitDt = tFace - bt; commitHorizon = horizon; commitSpeed = bspeed; commitFrameMs = fms; commitProj = best.Handle;
                }
            }
            else if (seen && !gone) { gone = true; goneFrame = gf; }
            // --- impact / explosion near the wall (flag stays true while the explosion is recent; only the first frame is used)
            if (exFrame < 0 && (seen || mode == "manual" || mode == "none") && Function.Call<bool>(Hash.IS_EXPLOSION_IN_SPHERE, -1, centre.X, centre.Y, centre.Z, 6f))
            {
                exFrame = gf; exMs = nowMs;
                if (!committed)
                {
                    late = true;
                    if (fallback || !predict)
                    {
                        // simple reactive fallback: swap now and give the twin the calibrated native rocket blast (X4 recipe). Labelled in the evidence.
                        commitTicks = X5Commit(); committed = true; commitFrame = gf; commitMs = nowMs; fallbackUsed = true; commitProj = 0; commitFrameMs = fms;
                        Vector3 bp = T.W(T.L(tFace - .4f, cuMid, 1f));
                        World.AddExplosion(bp, ExplosionType.Rocket, 10f, 0, pl, true, false);
                    }
                }
            }
            if (exFrame >= 0 && fracFrame < 0 && committed && (gf - exFrame) % 3 == 0)
            {
                if (ScanDebris(labs, T.P0, 30f) > 0 || AliveFlagged(0) > 0) { fracFrame = gf; fracMs = nowMs; }
            }
            if (exFrame >= 0 && gf >= exFrame + 240) break;
            if (seen && gone && exFrame < 0 && gf >= goneFrame + 90) break;           // missed: projectile ended elsewhere
            if (!seen && mode != "manual" && mode != "none" && nowMs - fireMs > 7000) break;
        }
        // settle, then measure
        for (int f = 0; f < 60; f++) Yield();
        ScanDebris(labs, T.P0, 30f);
        int parts = AliveFlagged(0);
        // frame-time statistics (pre-shot baseline vs. the window around the swap and the explosion)
        List<double> basel = frameMs.GetRange(0, baselineN); basel.Sort();
        double bMed = basel.Count > 0 ? basel[basel.Count / 2] : 0, bMax = basel.Count > 0 ? basel[basel.Count - 1] : 0;
        double winMax = 0; int winFrame = -1; int ctr = commitFrame >= 0 ? commitFrame : exFrame;
        for (int i = baselineN; i < frameMs.Count; i++) if (ctr >= 0 && frameNo[i] >= ctr - 8 && frameNo[i] <= ctr + 90 && frameMs[i] > winMax) { winMax = frameMs[i]; winFrame = frameNo[i]; }
        int over50 = 0, over100 = 0; for (int i = baselineN; i < frameMs.Count; i++) { if (frameMs[i] > 50) over50++; if (frameMs[i] > 100) over100++; }
        foreach (X5Frame fr in trace) Row("x5_track", "label", label, "frame", fr.Frame, "ms", fr.Ms - fireMs, "frameMs", fr.FrameMs, "t", fr.T, "u", fr.U, "v", fr.V, "vt", fr.Vt, "speed", fr.Speed, "ttcMs", fr.Ttc, "onCourse", fr.On, "proj", fr.Proj);
        Row("x5_frames", "label", label, "baselineMedianMs", bMed, "baselineMaxMs", bMax, "windowMaxMs", winMax, "windowMaxFrame", winFrame, "over50", over50, "over100", over100, "frames", frameMs.Count - baselineN);
        int wOrig = X5Witness("after_shot_original", x5Orig);
        int wTwin = X5Witness("after_shot_twin", x5Twin);
        bool twinIntactAfterMiss = !committed && parts == 0;
        Row("x5_result", "label", label, "mode", mode, "predict", predict, "committed", committed, "projectileSeen", seen, "late", late, "fallbackUsed", fallbackUsed,
            "fireFrame", fireFrame, "commitFrame", commitFrame, "explosionFrame", exFrame, "fractureSeenFrame", fracFrame,
            "framesCommitToExplosion", (commitFrame >= 0 && exFrame >= 0) ? (object)(exFrame - commitFrame) : null,
            "msCommitToExplosion", (commitFrame >= 0 && exFrame >= 0) ? (object)(exMs - commitMs) : null,
            "ttcAtCommitMs", commitTtc, "distToFaceAtCommitM", commitDt, "horizonMs", commitHorizon, "projSpeed", commitSpeed, "frameMsAtCommit", commitFrameMs,
            "commitCallMs", commitTicks * 1000.0 / Stopwatch.Frequency, "nativeParts", parts, "originalBlocked", wOrig, "twinBlocked", wTwin, "twinIntactAfterMiss", twinIntactAfterMiss, "pools", PoolsRaw());
        x5State = committed ? "Active" : "Armed";
        int hold = (int)F(a, "hold", 0f); if (hold > 0) Hold("x5_after_shot", hold);
    }

    // Find the widest clear lane through the twin's debris-opened wall (player capsule needs about 0.9 m).
    bool X5FindOpening(out float u, out float widthM)
    {
        Lab T = x5Twin; u = (T.U0 + T.U1) / 2f; widthM = 0f; float cuMid = u; int run = 0, bestRun = 0; float bestMid = u; bool any = false;
        List<bool> clear = new List<bool>(); List<float> us = new List<float>();
        float[] hs = new float[] { .5f, .9f, 1.3f, 1.7f }; System.Text.StringBuilder[] mk = new System.Text.StringBuilder[hs.Length];
        for (int k = 0; k < hs.Length; k++) mk[k] = new System.Text.StringBuilder();
        for (float x = T.U0 + .15f; x <= T.U1 - .15f; x += .1f)
        {
            bool ok = true;
            for (int k = 0; k < hs.Length; k++) { byte c = Classify(T, x, T.V0 + hs[k]); mk[k].Append((char)('0' + c)); if (c != 0) ok = false; }
            clear.Add(ok); us.Add(x); Yield();
        }
        for (int k = 0; k < hs.Length; k++) Row("x5_opening_mask", "dz", hs[k], "u0", T.U0 + .15f, "mask", mk[k].ToString());
        int start = 0;
        for (int i = 0; i <= clear.Count; i++)
        {
            if (i < clear.Count && clear[i]) { if (run == 0) start = i; run++; }
            else
            {
                if (run > 0) { float mid = (us[start] + us[start + run - 1]) / 2f; float w = run * .1f; bool better = w >= .9f && (!any || Math.Abs(mid - cuMid) < Math.Abs(bestMid - cuMid)); if (better) { bestRun = run; bestMid = mid; any = true; } }
                run = 0;
            }
        }
        if (any) { u = bestMid; widthM = bestRun * .1f; }
        Row("x5_opening", "found", any, "u", u, "widthM", widthM, "columnsClear", clear.FindAll(delegate (bool b) { return b; }).Count, "columns", clear.Count, "nativeParts", AliveFlagged(0));
        return any;
    }

    void X5Walk(Dictionary<string, string> a)
    {
        if (x5State != "Active" || x5Twin == null) throw new Exception("x5_active_required");
        Lab T = x5Twin;
        ScanDebris(new List<Lab> { T }, T.P0, 30f);
        float openU, openW; bool found = X5FindOpening(out openU, out openW);
        if (a.ContainsKey("u")) { openU = F(a, "u", openU); found = true; openW = F(a, "w", 0f); }
        if (!found && S(a, "force", "0") != "1") { Row("x5_player_result", "isPlayer", true, "crossed", false, "passed", false, "reason", "no_clear_lane_0.9m"); return; }
        Ped player = Game.Player.Character; PlacePlayerFacing(T, -2f, openU);
        float slow = F(a, "slowmo", 0f);
        Vector3 start = player.Position, end = T.W(T.L(2f, openU, T.BaseZ + .05f));
        bool crossed = false, outside = false; float crossingU = float.NaN, prevT = -2, prevU = openU, maxRise = 0;
        RealWait(1500);
        if (slow > 0f) Game.TimeScale = slow;
        Function.Call(Hash.TASK_GO_STRAIGHT_TO_COORD, player.Handle, end.X, end.Y, end.Z, 1f, 20000, player.Heading, .1f);
        long begun = clock.ElapsedMilliseconds;
        while (clock.ElapsedMilliseconds - begun < 25000)
        {
            Yield(); float u, t, v; LocalUTV(T, player.Position, out u, out t, out v);
            maxRise = Math.Max(maxRise, player.Position.Z - start.Z);
            if (prevT < 0 && t >= 0 && float.IsNaN(crossingU)) crossingU = prevU + (u - prevU) * (-prevT) / (t - prevT);
            if (u < T.U0 + .3f || u > T.U1 - .3f) outside = true;
            Row("x5_player_track", "ms", clock.ElapsedMilliseconds - begun, "u", u, "t", t, "v", v);
            if (t > (T.Thin == 1 ? T.Max.Y : T.Max.X) + .8f) { crossed = true; break; }
            prevT = t; prevU = u; Beat();
        }
        Game.TimeScale = 1f;
        Function.Call(Hash.CLEAR_PED_TASKS, player.Handle);
        Vector3 finish = player.Position;
        Row("x5_player_result", "isPlayer", player.Handle == Game.Player.Character.Handle, "startX", start.X, "startY", start.Y, "startZ", start.Z, "endX", finish.X, "endY", finish.Y, "endZ", finish.Z, "ms", clock.ElapsedMilliseconds - begun, "crossed", crossed, "crossingU", crossingU, "laneU", openU, "laneWidthM", openW, "outsideFootprint", outside, "maxRise", maxRise, "passed", crossed && !outside && !float.IsNaN(crossingU) && maxRise < .35f);
        int hold = (int)F(a, "hold", 0f); if (hold > 0) Hold("x5_player_through", hold);
    }

    void X5Cam(Dictionary<string, string> a)
    {
        if (x5Twin == null) throw new Exception("x5prepare_required");
        if (x2Camera != null) { World.RenderingCamera = null; x2Camera.Delete(); x2Camera = null; }
        if (S(a, "off", "0") == "1") return;
        Lab L = x5Twin; float cu = (L.U0 + L.U1) / 2f;
        x2Camera = World.CreateCamera(L.W(L.L(F(a, "t", -6.5f), cu + F(a, "u", 3.2f), L.BaseZ + F(a, "z", 1.7f))), Vector3.Zero, F(a, "fov", 55f));
        x2Camera.PointAt(L.W(L.L(F(a, "lt", 0f), cu + F(a, "lu", .2f), L.BaseZ + F(a, "lz", 1.1f))));
        World.RenderingCamera = x2Camera;
        Row("x5_cam", "t", F(a, "t", -6.5f), "u", F(a, "u", 3.2f), "z", F(a, "z", 1.7f));
    }

    void X5Restore()
    {
        if (x5State == "None" && !x5Hidden && !x5TimeSet) return;
        try { Game.TimeScale = 1f; } catch { }
        try { if (x5TimeSet) { Function.Call(Hash.SET_CLOCK_TIME, x5SavedH, x5SavedM, x5SavedS); x5TimeSet = false; } } catch { }
        try { CleanupAll(); }
        finally
        {
            if (x5Hidden) Function.Call(Hash.REMOVE_MODEL_HIDE, x5HidePos.X, x5HidePos.Y, x5HidePos.Z, X5HideRadius, x5HideModel, false);
            x5Hidden = false; x5Committed = false; x5State = "None"; x5Twin = null;
        }
        for (int f = 0; f < 60; f++) Yield();
        if (x5Orig != null)
        {
            int w = X5Witness("restored_original", x5Orig);
            bool vis = false; try { vis = x5Target != null && x5Target.Exists() && x5Target.IsVisible; } catch { }
            Row("x5_restored", "originalBlocked", w, "originalExists", x5Target != null && x5Target.Exists(), "originalVisibleFlag", vis, "restoredToOriginal", w >= 8, "pools", PoolsRaw());
        }
        RestorePlayer();
    }

