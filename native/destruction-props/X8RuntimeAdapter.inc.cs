    // X8 sequential adapter: two stable approved placements, one live X7 lease.
    // The second placement remains original while the first owns native props.
    // Opt-in is volatile and false on every script reload; never auto-discover city props.
    readonly Astra.X8.Registry x8Registry = new Astra.X8.Registry();
    bool x8Enabled = false;
    string x8Owner;

    static double X8Required(Dictionary<string, string> a, string key)
    {
        string value;
        if (!a.TryGetValue(key, out value)) throw new Exception("x8_required_" + key);
        return double.Parse(value, NumberStyles.Float, Inv);
    }

    void X8Enable(Dictionary<string, string> a)
    {
        if (x7State != "None" || x4Active || x8Registry.LeaseId != null)
            throw new Exception("x8_legacy_session_active");
        if (S(a, "approved", "0") != "1" || S(a, "enable", "0") != "1")
            throw new Exception("x8_operator_opt_in_required");
        x8Enabled = true;
        Row("x8_enabled", "enabled", true, "concurrentNativeContexts", 1, "placementsMax", 2,
            "realPlacementsEmbedded", false, "validation", "not_gameplay_accepted");
    }
    void X8RequireEnabled()
    {
        if (!x8Enabled) throw new Exception("x8_default_off");
    }
    void X8Register(Dictionary<string, string> a)
    {
        X8RequireEnabled();
        if (x7State != "None") throw new Exception("x8_restore_first");
        if (S(a, "verified", "0") != "1") throw new Exception("x8_candidate_audit_required");
        uint hash = checked((uint)X8Required(a, "hash"));
        Astra.X8.Placement p = new Astra.X8.Placement(
            S(a, "id", ""), checked((int)X8Required(a, "rev")), checked((int)hash),
            X8Required(a, "tx"), X8Required(a, "ty"), X8Required(a, "tz"),
            X8Required(a, "heading"), X8Required(a, "scale"), X8Required(a, "updot"));
        x8Registry.Register(p);
        Row("x8_registered", "id", p.Id, "revision", p.Revision, "hash", p.ModelHash,
            "pivotX", p.X, "pivotY", p.Y, "pivotZ", p.Z, "heading", p.HeadingDegrees,
            "registered", x8Registry.Count, "syntheticCoordinatesNotIncluded", true);
    }

    // Only compare native entities at an explicitly authored pivot. Reject ambiguity
    // before spawning; never choose nearest of multiple viable model matches.
    void X8PreflightCandidate(Vector3 pivot, uint hash, Prop selected)
    {
        if (x8Owner == null) return; // leave frozen X7.3 path unchanged
        Astra.X8.Placement site = x8Registry.Get(x8Owner).Site;
        if ((uint)site.ModelHash != hash || selected == null || !selected.Exists() ||
            (uint)selected.Model.Hash != hash ||
            !site.Matches(selected.Position.X, selected.Position.Y, selected.Position.Z, selected.Heading) ||
            Vector3.Dot(selected.UpVector, Vector3.WorldUp) < .985f)
            throw new Exception("x8_candidate_identity_mismatch");
        int matching = 0, hideNeighbors = 0;
        foreach (Prop p in World.GetNearbyProps(pivot, 8f))
        {
            if (p == null || !p.Exists() || owned.Contains(p) || (uint)p.Model.Hash != hash) continue;
            float d = p.Position.DistanceTo(pivot);
            if (d <= .10f) matching++;
            if (d <= .35f && p.Handle != selected.Handle) hideNeighbors++;
        }
        if (matching != 1 || hideNeighbors != 0)
            throw new Exception("x8_ambiguous_source_or_hide_scope");
        Row("x8_identity", "id", x8Owner, "candidateHandle", selected.Handle,
            "modelHash", hash, "x", pivot.X, "y", pivot.Y, "z", pivot.Z,
            "heading", selected.Heading, "matches", matching, "hideNeighbors", hideNeighbors);
    }

    // Never trust pre-hide handles on restore: X7.3 demonstrated they can become stale.
    // A missing/partially damaged original is an explicit pending state (#308), not 9/9.
    bool X8VerifyOriginal(string id)
    {
        Astra.X8.Placement site = x8Registry.Get(id).Site;
        Vector3 pos = new Vector3((float)site.X, (float)site.Y, (float)site.Z);
        Prop found = null; int candidates = 0;
        foreach (Prop p in World.GetNearbyProps(pos, 8f))
        {
            if (p == null || !p.Exists() || owned.Contains(p) || p.Model.Hash != site.ModelHash) continue;
            if (p.Position.DistanceTo(pos) > .10f) continue;
            candidates++;
            if (site.Matches(p.Position.X, p.Position.Y, p.Position.Z, p.Heading) &&
                Vector3.Dot(p.UpVector, Vector3.WorldUp) >= .985f) found = p;
        }
        bool visible = false; int blocked = -1;
        if (candidates == 1 && found != null && found.Exists())
        {
            try { visible = found.IsVisible; blocked = X7Witness("x8_restore_" + id, X4OriginalLab(found)); }
            catch (Exception e) { Row("x8_verify_error", "id", id, "error", e.Message); }
        }
        Row("x8_original_verified", "id", id, "candidates", candidates, "visible", visible,
            "blocked", blocked, "required", 9, "passed", visible && blocked == 9);
        return candidates == 1 && visible && blocked == 9;
    }

    void X8Receipt(string id, string operation)
    {
        Astra.X8.Slot s = x8Registry.Get(id);
        Row("x8_lifecycle", "id", id, "operation", operation, "revision", s.Site.Revision,
            "state", s.Phase.ToString(), "lease", x8Registry.LeaseId, "sourceHash", s.Site.ModelHash,
            "heading", s.Site.HeadingDegrees, "rootsExpected", s.OwnedRootCount,
            "anchorsExpected", s.OwnedAnchorCount, "hideIntent", s.HideIntent,
            "x7State", x7State, "x7Hidden", x7Hidden, "x7Committed", x7Committed);
    }

    void X8Prepare(Dictionary<string, string> a)
    {
        X8RequireEnabled();
        if (x7State != "None" || x4Active || x8Owner != null)
            throw new Exception("x8_existing_native_owner");
        string id = S(a, "id", "");
        if (S(a, "verified", "0") != "1") throw new Exception("x8_candidate_audit_required");
        // Never invent a player start from the source pivot; local operator
        // must approve a real, clear firing position for each placement.
        X8Required(a, "px"); X8Required(a, "py"); X8Required(a, "pz");
        if (PoolFrac() > .50) throw new Exception("x8_pool_pressure_refusal");
        Astra.X8.Slot slot = x8Registry.Begin(id);
        x8Owner = id;
        Dictionary<string, string> args = new Dictionary<string, string>(a);
        args.Remove("sel"); args.Remove("pat"); // no command-selected damage or profile
        args["model"] = "lsa_x7d_secp_j1400";
        args["hash"] = slot.Site.ModelHash.ToString(Inv);
        args["tx"] = slot.Site.X.ToString("R", Inv);
        args["ty"] = slot.Site.Y.ToString("R", Inv);
        args["tz"] = slot.Site.Z.ToString("R", Inv);
        args["verified"] = "1";
        X8Receipt(id, "preparing");
        try
        {
            X7Prepare(args); // proven native staging / 9-of-9 witnesses / no hot-path changes
            if (x7State != "Armed" || x7Target == null || !x7Target.Exists() ||
                x7SecLabs.Count != 5 || x7SecHandles.Count != 5)
                throw new Exception("x8_staging_incomplete");
            foreach (Lab sl in x7SecLabs)
                if (sl.Wall == null || !sl.Wall.Exists() ||
                    sl.Anchor == null || !sl.Anchor.Exists() ||
                    !sl.Wall.IsAttachedTo(sl.Anchor))
                    throw new Exception("x8_stage_anchor_missing");
            x8Registry.Armed(id, x7Target.Handle, 5, 5);
            X8Receipt(id, "armed");
        }
        catch
        {
            // X7Prepare already invokes X7Restore on its own post-stage exceptions.
            // If any staged state remains, restore with the same owner before release.
            try { if (x7State != "None" || x7Hidden || x7TimeSet) X7Restore(); } catch { }
            bool clean = x7State == "None" && !x7Hidden && x7SecLabs.Count == 0 &&
                owned.Count == 0 && debris.Count == 0 && X8CleanupAbsent();
            bool original = X8VerifyOriginal(id);
            try { x8Registry.FailedPreparation(id, original, clean); }
            catch { commandFailed = true; commandError = "x8_prepare_restore_pending"; }
            X8Receipt(id, "prepare_failed");
            if (x8Registry.LeaseId == null) x8Owner = null;
            throw;
        }
    }

    void X8Shot(Dictionary<string, string> a)
    {
        X8RequireEnabled();
        string id = S(a, "id", "");
        if (x8Owner != id || x8Registry.Get(id).Phase != Astra.X8.FencePhase.Armed)
            throw new Exception("x8_shot_not_armed_or_wrong_owner");
        // No second shot while committed/Active; do not resummon or rearm native debris.
        // Recheck authored source identity and hide-scope ambiguity before
        // entering the X7.3 projectile acquisition/shot loop.
        Astra.X8.Placement site = x8Registry.Get(id).Site;
        X8PreflightCandidate(new Vector3((float)site.X, (float)site.Y, (float)site.Z),
            (uint)site.ModelHash, x7Target);
        X8Receipt(id, "shot_begin");
        try
        {
            X7Shot(a); // X7.3 exact projectile provenance and impact selection
            if (x7State == "Active") x8Registry.Active(id);
            else
            {
                // One controlled shot attempt per prepared placement. A miss or
                // uncommitted explosion cannot be retried without restoring first,
                // particularly while the #308 original-damage path is unresolved.
                x8Registry.Restore(id, x7Hidden);
                commandFailed = true; commandError = "x8_no_qualified_commit_restore_required";
            }
            X8Receipt(id, "shot_end");
        }
        catch
        {
            x8Registry.Restore(id, x7Hidden);
            X8Receipt(id, "shot_exception_restore_pending");
            throw;
        }
    }

    void X8Restore(Dictionary<string, string> a)
    {
        X8RequireEnabled();
        string id = S(a, "id", "");
        if (x8Owner != id || x8Registry.LeaseId != id)
            throw new Exception("x8_restore_wrong_owner");
        x8Registry.Restore(id, x7Hidden);
        X8Receipt(id, "restore_start");
        try
        {
            if (x7State != "None" || x7Hidden || x7TimeSet) X7Restore();
            bool original = X8VerifyOriginal(id);
            bool ownedRemoved = x7State == "None" && !x7Hidden && x7SecLabs.Count == 0 &&
                owned.Count == 0 && debris.Count == 0 && X8CleanupAbsent();
            if (!original || !ownedRemoved)
            {
                X8Receipt(id, "restore_unverified");
                throw new Exception("x8_original_or_owned_not_restored_issue_308");
            }
            x8Registry.Restored(id, true, true);
            x8Owner = null;
            X8Receipt(id, "restored");
        }
        catch
        {
            commandFailed = true; commandError = "x8_restore_pending";
            throw; // retain lease; do not begin B on partial failure
        }
    }
    void X8OwnedCommand(string verb, Dictionary<string, string> a)
    {
        X8RequireEnabled();
        string id = S(a, "id", "");
        if (x8Owner != id || x8Registry.LeaseId != id)
            throw new Exception("x8_wrong_owner");
        Astra.X8.FencePhase phase = x8Registry.Get(id).Phase;
        if (phase != Astra.X8.FencePhase.Active && phase != Astra.X8.FencePhase.Armed)
            throw new Exception("x8_not_armed_or_active");
        if (verb == "x8walk") X7Walk(a);
        else if (verb == "x8cam") X7Cam(a);
        else throw new Exception("x8_unknown_owned_command");
        X8Receipt(id, verb);
    }
    // X8 only owns explicitly spawned entities and positively identified native
    // fragments. X3's 'debris' set also contains newly observed ambient props:
    // those are intentionally NOT deleted by CleanupDebris(), so mere existence
    // must not fail the X8 ownership gate.
    readonly List<Entity> x8CleanupEntities = new List<Entity>();
    readonly Dictionary<int, int> x8CleanupModels = new Dictionary<int, int>();
    int x8CleanupUnverified;
    void X8TrackCleanup(Entity e, string provenance)
    {
        if (e == null) return;
        int h = e.Handle;
        if (x8CleanupModels.ContainsKey(h)) return;
        int model = e.Model.Hash;
        x8CleanupEntities.Add(e);
        x8CleanupModels.Add(h, model);
        Row("x8_cleanup_tracked", "handle", h, "hash", model, "provenance", provenance);
    }
    void X8CaptureCleanup()
    {
        x8CleanupUnverified = 0;
        foreach (Entity e in owned) X8TrackCleanup(e, "spawned_by_lab");
        foreach (int h in debris)
        {
            // flaggedSet/debrisOwner records the actual observed native parent
            // before its attachment evidence can disappear. A live attachment
            // check is a second way to establish ownership. Never delete based
            // only on proximity or "appeared after the explosion".
            bool labFragment = (flaggedSet.Contains(h) && debrisOwner.ContainsKey(h)) ||
                IsVerifiedLabDebris(h);
            if (labFragment) X8TrackCleanup(Entity.FromHandle(h), "verified_native_debris");
            else
            {
                x8CleanupUnverified++;
                Row("x8_cleanup_unverified", "handle", h,
                    "reason", "no_positive_lab_ownership_evidence");
            }
        }
    }
    bool X8CleanupAbsent()
    {
        int remaining = 0, reused = 0;
        foreach (Entity e in x8CleanupEntities)
        {
            // Existence by handle alone can describe a *different* entity after
            // GTA recycles that handle. Compare immutable model identity captured
            // before deletion; same-model reuse remains conservatively blocked.
            if (!e.Exists()) continue;
            int h = e.Handle, now = e.Model.Hash, original = x8CleanupModels[h];
            if (now != original)
            {
                reused++;
                Row("x8_cleanup_reused_handle", "handle", h,
                    "trackedHash", original, "currentHash", now);
            }
            else
            {
                remaining++;
                Row("x8_cleanup_remaining", "handle", h, "hash", now);
            }
        }
        Row("x8_cleanup_verified", "tracked", x8CleanupEntities.Count,
            "remaining", remaining, "reused", reused,
            "unverifiedCandidates", x8CleanupUnverified, "passed", remaining == 0);
        if (remaining == 0) { x8CleanupEntities.Clear(); x8CleanupModels.Clear(); }
        return remaining == 0;
    }

    // Bounded read-only audit of one registered placement; no discovery, staging or damage.
    // Optional streaming moves only the player and is forbidden while a native lease exists.
    void X8Audit(Dictionary<string, string> a)
    {
        X8RequireEnabled();
        string id = S(a, "id", "");
        Astra.X8.Placement site = x8Registry.Get(id).Site;
        if (S(a, "stream", "0") == "1")
        {
            if (x8Registry.LeaseId != null) throw new Exception("x8_audit_stream_while_leased");
            PrepareSite();
            Game.Player.Character.Position = new Vector3((float)X8Required(a, "px"),
                (float)X8Required(a, "py"), (float)X8Required(a, "pz"));
            WaitCollision(Game.Player.Character);
            for (int f = 0; f < 120; f++) Yield();
        }
        Vector3 pivot = new Vector3((float)site.X, (float)site.Y, (float)site.Z);
        Prop target = null; int count = 0;
        foreach (Prop p in World.GetNearbyProps(pivot, 12f))
        {
            if (p == null || !p.Exists() || owned.Contains(p)) continue;
            Vector3 v = p.Position;
            Row("x8_audit_neighbor", "id", id, "handle", p.Handle, "hash", p.Model.Hash,
                "x", v.X, "y", v.Y, "z", v.Z, "heading", p.Heading, "visible", p.IsVisible);
            if (p.Model.Hash == site.ModelHash && v.DistanceTo(pivot) <= .10f) { target = p; count++; }
        }
        if (count != 1 || target == null || !site.Matches(target.Position.X,target.Position.Y,target.Position.Z,target.Heading))
            throw new Exception("x8_audit_source_ambiguous_or_missing");
        Lab L = X4OriginalLab(target);
        float rt = target.RightVector.Length(), fw = target.ForwardVector.Length(), up = target.UpVector.Length();
        bool unit = Math.Abs(rt-1f) < .001f && Math.Abs(fw-1f) < .001f && Math.Abs(up-1f) < .001f;
        int own = 0, foreign = 0;
        float cu = (L.U0 + L.U1) / 2f;
        foreach (float du in new float[]{-.7f,0f,.7f}) foreach(float dz in new float[]{.4f,1f,1.6f})
        {
            Vector3 a0=L.W(L.L(L.T0,cu+du,L.V0+dz)), b=L.W(L.L(L.T1,cu+du,L.V0+dz));
            RaycastResult ray=World.Raycast(a0,b,(IntersectFlags)17,null);
            int h=ray.HitEntity==null?0:ray.HitEntity.Handle;
            if(ray.DidHit && h==target.Handle) own++;
            else if(ray.DidHit) foreign++;
            Row("x8_audit_witness", "id",id,"du",du,"dz",dz,"hit",ray.DidHit,"handle",h,
                "hash",ray.HitEntity==null?0:ray.HitEntity.Model.Hash,"source",h==target.Handle);
        }
        int approachHits=0;
        foreach(float du in new float[]{-.7f,0f,.7f}) foreach(float dz in new float[]{.5f,1f,1.6f})
        foreach(int side in new int[]{-1,1})
        {
            Vector3 a0=L.W(L.L(side*2f,cu+du,L.V0+dz)), b=L.W(L.L(side*.8f,cu+du,L.V0+dz));
            RaycastResult ray=World.Raycast(a0,b,(IntersectFlags)17,null);
            if(ray.DidHit) approachHits++;
            Row("x8_audit_approach", "id",id,"side",side,"du",du,"dz",dz,"hit",ray.DidHit,
                "handle",ray.HitEntity==null?0:ray.HitEntity.Handle);
        }
        foreach(float t in new float[]{-4f,-2f,-.8f,.8f,2f})
        {
            Vector3 v=L.W(L.L(t,cu,L.V0));
            RaycastResult r=World.Raycast(v+Vector3.WorldUp*2f,v-Vector3.WorldUp*2f,(IntersectFlags)1,null);
            Row("x8_audit_ground", "id",id,"localT",t,"hit",r.DidHit,
                "x",r.HitPosition.X,"y",r.HitPosition.Y,"z",r.HitPosition.Z);
        }
        Row("x8_audit", "id",id,"x",target.Position.X,"y",target.Position.Y,"z",target.Position.Z,
            "heading",target.Heading,"updot",Vector3.Dot(target.UpVector,Vector3.WorldUp),
            "unit",unit,"width",L.U1-L.U0,"height",L.V1-L.V0,"visible",target.IsVisible,
            "originalBlocked",own,"foreign",foreign,"approachHits",approachHits,
            "owned",owned.Count,"debris",debris.Count,"pools",PoolsRaw());
        if(!unit || own!=9 || foreign!=0 || !target.IsVisible || approachHits!=0)
            throw new Exception("x8_audit_collision_or_basis_refused");
    }
    void X8Status()
    {
        X8RequireEnabled();
        Row("x8_status", "count", x8Registry.Count, "lease", x8Registry.LeaseId,
            "simultaneousNativeLimit", 1, "defaultOff", false);
        foreach (Astra.X8.Slot slot in x8Registry.Slots) X8Receipt(slot.Site.Id, "status");
    }

