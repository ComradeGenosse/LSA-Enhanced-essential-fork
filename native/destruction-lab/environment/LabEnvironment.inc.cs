    // X8 lab environment: opt-in only, Story Mode/P2 only. No X7 fracture edits.
    // Density multipliers are THIS_FRAME: Interval=0 while active; revert to 200 when off.
    bool labEnvActive, labEnvInRadius, labEnvHadRpg, labEnvAmmoChanged, labEnvRpgGiven;
    bool labEnvSavedInvincible;
    int labEnvSavedWanted, labEnvSavedMaxWanted, labEnvPedHandle, labEnvPedModel;
    int labEnvSavedRpgAmmo, labEnvFrame, labEnvErrorCount;
    uint labEnvSavedWeapon, labEnvRpgHash;
    GTA.Weather labEnvSavedWeather;
    TimeSpan labEnvSavedClock;
    Vector3 labEnvCentre;
    float labEnvRadius;
    string labEnvLastError = "none";

    // State snapshots are collected BEFORE any mutation. A false 'approved'
    // token or missing local coordinates must not make any GTA state changes.
    void LabEnvSetup(Dictionary<string, string> a)
    {
        if (labEnvActive) throw new Exception("lab_env_already_enabled");
        if (S(a, "approved", "0") != "1" || S(a, "enable", "0") != "1")
            throw new Exception("lab_env_explicit_approval_required");
        if (x7State != "None" || x4Active || x8Owner != null || x8Registry.LeaseId != null)
            throw new Exception("lab_env_enable_before_staging");
        float x = (float)X8Required(a, "x"), y = (float)X8Required(a, "y"), z = (float)X8Required(a, "z");
        float radius = (float)X8Required(a, "radius");
        if (float.IsNaN(x) || float.IsNaN(y) || float.IsNaN(z) || float.IsNaN(radius) ||
            float.IsInfinity(x) || float.IsInfinity(y) || float.IsInfinity(z) || float.IsInfinity(radius) ||
            Math.Abs(x) >= 10000 || Math.Abs(y) >= 10000 || z <= -100 || z >= 1600 ||
            radius < 20f || radius > 150f)
            throw new Exception("lab_env_invalid_site_or_radius");
        if (S(a, "population", "0") != "0" && S(a, "population", "0") != "1")
            throw new Exception("lab_env_population_must_be_0_or_1");
        if (!SafetyOk()) throw new Exception("lab_env_story_mode_only");
        if (Game.Player.Character == null || !Game.Player.Character.Exists())
            throw new Exception("lab_env_player_unavailable");
        Ped ped = Game.Player.Character;
        // Weather.Unknown cannot be restored honestly. Fail before changing anything.
        GTA.Weather weather = World.Weather;
        if (weather == GTA.Weather.Unknown) throw new Exception("lab_env_weather_snapshot_unknown");
        labEnvPedHandle = ped.Handle;
        labEnvPedModel = ped.Model.Hash;
        labEnvSavedWeather = weather;
        labEnvSavedClock = World.CurrentDayTime;
        labEnvSavedInvincible = Game.Player.IsInvincible;
        labEnvSavedWanted = Game.Player.WantedLevel;
        labEnvSavedMaxWanted = Function.Call<int>(Hash.GET_MAX_WANTED_LEVEL);
        labEnvRpgHash = unchecked((uint)Game.GenerateHash("WEAPON_RPG"));
        labEnvHadRpg = Function.Call<bool>(Hash.HAS_PED_GOT_WEAPON, ped.Handle, labEnvRpgHash, false);
        labEnvSavedRpgAmmo = labEnvHadRpg ? Function.Call<int>(Hash.GET_AMMO_IN_PED_WEAPON, ped.Handle, labEnvRpgHash) : 0;
        labEnvSavedWeapon = Function.Call<uint>(Hash.GET_SELECTED_PED_WEAPON, ped.Handle);
        labEnvCentre = new Vector3(x, y, z);
        labEnvRadius = radius;
        labEnvInRadius = false;
        labEnvFrame = 0;
        labEnvRpgGiven = false;
        labEnvAmmoChanged = false;
        labEnvErrorCount = 0;
        labEnvLastError = "none";
        // Mark active before first mutation, so partial setup can still be undone.
        labEnvActive = true;
        try
        {
            Interval = 0;
            Game.Player.IsInvincible = true;
            Function.Call(Hash.SET_MAX_WANTED_LEVEL, 0);
            Game.Player.WantedLevel = 0;
            Function.Call(Hash.SET_POLICE_IGNORE_PLAYER, Game.Player.Handle, true);
            Function.Call(Hash.SET_DISPATCH_COPS_FOR_PLAYER, Game.Player.Handle, false);
            ped.Health = ped.MaxHealth;
            ped.Armor = Game.Player.MaxArmor;
            if (!labEnvHadRpg)
            {
                Function.Call(Hash.GIVE_WEAPON_TO_PED, ped.Handle, labEnvRpgHash, 10, false, false);
                labEnvRpgGiven = true;
            }
            else if (labEnvSavedRpgAmmo < 10)
            {
                Function.Call(Hash.SET_PED_AMMO, ped.Handle, labEnvRpgHash, 10);
                labEnvAmmoChanged = true;
            }
            World.Weather = GTA.Weather.Clear;
            World.CurrentDayTime = new TimeSpan(12, 0, 0);
            Row("lab_env_enabled", "centreX", x, "centreY", y, "centreZ", z, "radius", radius,
                "populationSuppression", S(a, "population", "0") == "1",
                "originalWanted", labEnvSavedWanted, "originalMaxWanted", labEnvSavedMaxWanted,
                "originalInvincible", labEnvSavedInvincible, "originalWeather", labEnvSavedWeather.ToString(),
                "savedRpg", labEnvHadRpg, "originalRpgAmmo", labEnvSavedRpgAmmo,
                "knownLimit", "dispatch_and_ignore_police_have_no_previous_state_getter");
            labEnvSuppressPopulation = S(a, "population", "0") == "1";
        }
        catch
        {
            LabEnvShutdown(); // best effort restore even when initial setup partially applied
            throw;
        }
    }
    bool labEnvSuppressPopulation;

    // Called by every SHVDN tick, INCLUDING when P2 is busy with a shot.
    // Traffic/ped multipliers apply to the whole game for the current frame,
    // but are submitted only while the player is INSIDE the audited lab radius.
    // No deleting ambient world entities, disabling explosions or freezing physics.
    void LabEnvTick()
    {
        if (!labEnvActive) return;
        try
        {
            if (!SafetyOk() || Game.Player.Character.Handle != labEnvPedHandle ||
                Game.Player.Character.Model.Hash != labEnvPedModel)
                throw new Exception("lab_env_player_identity_or_story_mode_changed");
            Ped ped = Game.Player.Character;
            labEnvInRadius = ped.Position.DistanceTo(labEnvCentre) <= labEnvRadius;
            if (labEnvInRadius && labEnvSuppressPopulation)
            {
                Function.Call(Hash.SET_VEHICLE_DENSITY_MULTIPLIER_THIS_FRAME, 0f);
                Function.Call(Hash.SET_RANDOM_VEHICLE_DENSITY_MULTIPLIER_THIS_FRAME, 0f);
                Function.Call(Hash.SET_PARKED_VEHICLE_DENSITY_MULTIPLIER_THIS_FRAME, 0f);
                Function.Call(Hash.SET_PED_DENSITY_MULTIPLIER_THIS_FRAME, 0f);
                Function.Call(Hash.SET_SCENARIO_PED_DENSITY_MULTIPLIER_THIS_FRAME, 0f, 0f);
            }
            if (Game.Player.WantedLevel != 0) Game.Player.WantedLevel = 0;
            if ((++labEnvFrame % 60) == 0)
            {
                Function.Call(Hash.SET_POLICE_IGNORE_PLAYER, Game.Player.Handle, true);
                Function.Call(Hash.SET_DISPATCH_COPS_FOR_PLAYER, Game.Player.Handle, false);
                World.Weather = GTA.Weather.Clear;
                World.CurrentDayTime = new TimeSpan(12, 0, 0);
            }
        }
        catch (Exception ex)
        {
            labEnvLastError = ex.GetType().Name + ": " + ex.Message;
            labEnvErrorCount++;
            // No continuing to apply partial effects after player swap/online.
            LabEnvShutdown();
        }
    }

    void LabEnvStatus()
    {
        Row("lab_env_status", "enabled", labEnvActive, "insideRadius", labEnvInRadius,
            "populationSuppression", labEnvSuppressPopulation, "radius", labEnvRadius,
            "pedHandle", labEnvPedHandle, "errors", labEnvErrorCount, "lastError", labEnvLastError,
            "frameEveryTick", labEnvActive && Interval == 0,
            "knownLimit", "write_only_police_flags_return_to_normal_defaults_not_exact_snapshot");
    }

    // Individual steps are independently attempted: failure to restore one
    // field never suppresses the others. No X8 lease is released here.
    void LabEnvShutdown()
    {
        if (!labEnvActive) return;
        labEnvActive = false;
        labEnvInRadius = false;
        labEnvSuppressPopulation = false;
        Interval = 200;
        bool samePed = false;
        try { samePed = !Function.Call<bool>(Hash.NETWORK_IS_SESSION_STARTED) &&
            Game.Player != null && Game.Player.Character != null && Game.Player.Character.Exists() &&
            Game.Player.Character.Handle == labEnvPedHandle &&
            Game.Player.Character.Model.Hash == labEnvPedModel; } catch { }
        Action<Action> restore = action => { try { action(); } catch (Exception ex) {
            labEnvErrorCount++; labEnvLastError = "restore:" + ex.Message;
        } };
        // Time/weather and max wanted are global Story Mode state snapshots.
        // Do not write game state after a transition into Online.
        bool offline = false;
        try { offline = !Function.Call<bool>(Hash.NETWORK_IS_SESSION_STARTED); } catch { }
        if (!offline) { labEnvErrorCount++; labEnvLastError = "restore_blocked_online_state"; return; }
        restore(() => { World.Weather = labEnvSavedWeather; });
        restore(() => { World.CurrentDayTime = labEnvSavedClock; });
        restore(() => { Function.Call(Hash.SET_MAX_WANTED_LEVEL, labEnvSavedMaxWanted); });
        if (samePed)
        {
            restore(() => { Game.Player.IsInvincible = labEnvSavedInvincible; });
            restore(() => { Game.Player.WantedLevel = labEnvSavedWanted; });
            // These two flags have no trustworthy prior-state getter:
            // restore conventional Story Mode defaults, disclose uncertainty.
            restore(() => { Function.Call(Hash.SET_POLICE_IGNORE_PLAYER, Game.Player.Handle, false); });
            restore(() => { Function.Call(Hash.SET_DISPATCH_COPS_FOR_PLAYER, Game.Player.Handle, true); });
            if (labEnvRpgGiven)
                restore(() => { Function.Call(Hash.REMOVE_WEAPON_FROM_PED, labEnvPedHandle, labEnvRpgHash); });
            else if (labEnvAmmoChanged)
                restore(() => { Function.Call(Hash.SET_PED_AMMO, labEnvPedHandle, labEnvRpgHash, labEnvSavedRpgAmmo); });
            restore(() => { Function.Call(Hash.SET_CURRENT_PED_WEAPON, labEnvPedHandle, labEnvSavedWeapon, true); });
        }
        else
        {
            labEnvErrorCount++;
            labEnvLastError = "ped_identity_changed_cannot_restore_ped_flags_or_weapon";
        }
        // Healing/armor refill is deliberately not reverted: restoring pre-lab
        // health after testing could kill the player.
    }

    void LabEnvRestore()
    {
        if (x8Owner != null || x8Registry.LeaseId != null || x7State != "None" || x4Active)
            throw new Exception("lab_env_restore_native_context_first");
        bool wasEnabled = labEnvActive;
        LabEnvShutdown();
        Row("lab_env_restored", "wasEnabled", wasEnabled, "errorCount", labEnvErrorCount,
            "lastError", labEnvLastError, "writeOnlyPoliceFlagsRestoredToDefaults", true,
            "healthAndArmorNotReverted", true);
        if (labEnvErrorCount != 0) throw new Exception("lab_env_restoration_partial_review_required");
    }

    void LabEnvAbort() { LabEnvShutdown(); }
