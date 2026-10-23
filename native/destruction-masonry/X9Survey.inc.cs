    // X9 READ-ONLY qualification survey. No script props, teleport, model request,
    // hide, damage, or admission to X7/X8. A fixed world-space probe frame
    // cannot prove actual wall ownership, so its results are diagnostic only.
    void X9Survey(Dictionary<string, string> a)
    {
        if (x7State != "None" || x4Active || x8Registry.LeaseId != null)
            throw new Exception("x9_survey_requires_no_native_lease");
        if (S(a, "approved", "0") != "1")
            throw new Exception("x9_explicit_read_only_survey_approval");
        foreach (string key in new string[] { "x", "y", "z", "heading" })
            if (!a.ContainsKey(key)) throw new Exception("x9_missing_" + key);
        float x = F(a, "x", 0), y = F(a, "y", 0),
            z = F(a, "z", 0), heading = F(a, "heading", 0);
        if (float.IsNaN(x) || float.IsNaN(y) || float.IsNaN(z) || float.IsNaN(heading) ||
            float.IsInfinity(x) || float.IsInfinity(y) || float.IsInfinity(z) ||
            float.IsInfinity(heading) || heading < 0 || heading >= 360 ||
            Math.Abs(x) > 10000 || Math.Abs(y) > 10000 || z < -100 || z > 1600)
            throw new Exception("x9_invalid_survey_coordinates");
        Ped player = Game.Player.Character;
        if (player == null || !player.Exists())
            throw new Exception("x9_player_unavailable");
        Vector3 pivot = new Vector3(x, y, z);
        float playerDistance = player.Position.DistanceTo(pivot);
        if (playerDistance > 35f)
            throw new Exception("x9_survey_outside_loaded_player_area");
        // Brick candidates are PUBLIC NAME LEADS, not approved Enhanced source.
        // Concrete Jersey barrier is a negative-control asset, not a 2m wall.
        string[] models = {
            "prop_wallbrick_01", "prop_wallbrick_02", "prop_wallbrick_03",
            "prop_barier_conc_01a"
        };
        HashSet<int> candidateHashes = new HashSet<int>();
        foreach (string name in models)
        {
            Model model = new Model(name);
            candidateHashes.Add(Game.GenerateHash(name));
            Row("x9_model", "name", name, "hash", Game.GenerateHash(name),
                "valid", model.IsValid, "inCdImage", model.IsInCdImage,
                "loaded", model.IsLoaded,
                "status", "MODEL_METADATA_NOT_WORLD_APPROVAL");
        }
        int nearbyProps = 0, candidates = 0, reported = 0;
        foreach (Prop p in World.GetNearbyProps(pivot, 15f))
        {
            if (p == null || !p.Exists()) continue;
            nearbyProps++;
            if (!candidateHashes.Contains(p.Model.Hash)) continue;
            candidates++;
            if (reported++ >= 16) continue; // bounded telemetry; not selection
            Vector3 v = p.Position;
            Row("x9_candidate_prop", "hash", p.Model.Hash, "handle", p.Handle,
                "x", v.X, "y", v.Y, "z", v.Z, "heading", p.Heading,
                "upDot", Vector3.Dot(p.UpVector, Vector3.WorldUp),
                "visible", p.IsVisible, "distance", v.DistanceTo(pivot),
                "classification", "OBSERVED_NOT_APPROVED");
        }
        // Explicit test heading is a PROBE AXIS, not a qualified model basis.
        // Return hit handle 0 rather than mistaking map-owned YBN for a Prop.
        float theta = (float)(heading * Math.PI / 180.0);
        Vector3 tangent = new Vector3((float)Math.Cos(theta), (float)Math.Sin(theta), 0);
        Vector3 normal = new Vector3(-tangent.Y, tangent.X, 0);
        int blocked = 0, unownedOrStatic = 0;
        foreach (float du in new float[] { -.5f, 0f, .5f })
        foreach (float dz in new float[] { .4f, 1f, 1.6f })
        {
            Vector3 mid = pivot + tangent * du + Vector3.WorldUp * dz;
            RaycastResult ray = World.Raycast(mid - normal * 2f,
                mid + normal * 2f, (IntersectFlags)17, null);
            int handle = ray.HitEntity == null ? 0 : ray.HitEntity.Handle;
            int hash = ray.HitEntity == null ? 0 : ray.HitEntity.Model.Hash;
            if (ray.DidHit) blocked++;
            if (ray.DidHit && handle == 0) unownedOrStatic++;
            Row("x9_probe_ray", "u", du, "v", dz, "didHit", ray.DidHit,
                "handle", handle, "hash", hash,
                "hitX", ray.HitPosition.X, "hitY", ray.HitPosition.Y,
                "hitZ", ray.HitPosition.Z,
                "classification", "UNOWNED_DIAGNOSTIC_PROBE");
        }
        foreach (float du in new float[] { -1.5f, 0f, 1.5f })
        foreach (float dt in new float[] { -2.0f, 2.0f })
        {
            Vector3 mid = pivot + tangent * du + normal * dt;
            RaycastResult ground = World.Raycast(mid + Vector3.WorldUp * 3f,
                mid - Vector3.WorldUp * 3f, (IntersectFlags)1, null);
            Row("x9_probe_ground", "u", du, "t", dt, "hit", ground.DidHit,
                "z", ground.HitPosition.Z,
                "handle", ground.HitEntity == null ? 0 : ground.HitEntity.Handle);
        }
        Row("x9_survey_summary", "x", x, "y", y, "z", z, "heading", heading,
            "playerDistance", playerDistance, "nearbyProps", nearbyProps,
            "candidateProps", candidates, "candidateRows", Math.Min(reported, 16),
            "diagnosticHits", blocked, "zeroHandleHits", unownedOrStatic,
            "playerTeleported", false, "scriptPropsCreated", 0,
            "collisionOwnerQualified", false, "candidateSelected", false,
            "classification", "READ_ONLY_UNQUALIFIED");
    }
