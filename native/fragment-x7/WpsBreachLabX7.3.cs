// WpsBreachLabX4.3.cs - ASTRA-001 X3 debris/scalability driver: superset of the frozen X2 driver (X2-0.10, SHA 5be72312...).
// X3 verbs: x3idle, x3perf, x3breach, x3multi, x3player (see native/fragment-x3/README.md). Original header follows.
// WpsBreachLabX4.3.cs - ASTRA-001 X1 "Native fragment breach" lab. ISOLATED EXPERIMENT SCRIPT.
// GTA V Enhanced + ScriptHookVDotNet Enhanced 3.9 (API 3.9.0). Offline Story Mode only.
//
// * P2 requests only: see tools/gta-controller and docs/agent-operations/GTA-CONTROLLER-RUNBOOK.md.
// * Spawns only disposable lab-owned props/peds and deletes them afterwards (also on abort).
// * Touches no LSA / Essential / production state, writes no game assets. Only side effects while a command
//   runs: player teleport to the test site + back, player invincible, wanted level suppressed -> all restored.
// * Evidence: <GTA root>\WpsBreachLab\<runId>\trials.jsonl (+ *.summary.json); heartbeat: WpsBreachLab\status.json.
//
// Commands (key=value, one per line):
//   census                                     spawn each candidate model once, record fragment facts
//   worldcensus radius=250                     list fragment props currently streamed around the player
//   probe    model=NAME variant=frozen         spawn, bone/group map + baseline grid, NO blast (control)
//   detach   model=NAME variant=frozen mode=each|cluster [r=1.3] [max=24]   scripted DetachFragmentPart control
//   blast    model=NAME variant=default|frozen|static explosive=grenade|sticky|rocket|tank|none
//            [dx=0.75] [du=0] [dv=0.45] [hold=0] [walk=1]   explosion trial (T1/T2/T3 measurements)
//   cleanup | abort
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using GTA;
using GTA.Math;
using GTA.Native;

public class WpsBreachLab : Script
{
    const string Ver = "X7-0.1";
    const string PedModelName = "a_m_y_beach_01";
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    // ---- candidate vanilla models (names gathered from memory of the base game; invalid names are skipped) ----
    static readonly string[] Candidates = new string[] {
        "prop_ld_fragwall_01a","prop_ld_fragwall_01b",
        "prop_fnclink_01a","prop_fnclink_01b","prop_fnclink_02a","prop_fnclink_02b","prop_fnclink_02c","prop_fnclink_02d","prop_fnclink_02e","prop_fnclink_02gate1","prop_fnclink_02gate2","prop_fnclink_02gate5","prop_fnclink_02gate6","prop_fnclink_02gate7",
        "prop_fnclink_03a","prop_fnclink_03b","prop_fnclink_03c","prop_fnclink_03d","prop_fnclink_03e","prop_fnclink_03f","prop_fnclink_03g","prop_fnclink_03gate1","prop_fnclink_04a","prop_fnclink_04b","prop_fnclink_04c","prop_fnclink_04d","prop_fnclink_04e","prop_fnclink_04f","prop_fnclink_04g","prop_fnclink_04h","prop_fnclink_05a","prop_fnclink_05b","prop_fnclink_05c","prop_fnclink_06a","prop_fnclink_06b","prop_fnclink_07a","prop_fnclink_07b","prop_fnclink_08a","prop_fnclink_09a","prop_fnclink_09b","prop_fnclink_10a","prop_fnclink_10b","prop_fnclink_10c","prop_fnclink_10d","prop_fnclink_10e",
        "prop_fncwood_01a","prop_fncwood_01b","prop_fncwood_01c","prop_fncwood_02a","prop_fncwood_02b","prop_fncwood_03a","prop_fncwood_03b","prop_fncwood_04a","prop_fncwood_05c","prop_fncwood_06a","prop_fncwood_07a","prop_fncwood_07b","prop_fncwood_08a","prop_fncwood_09a","prop_fncwood_10a","prop_fncwood_11a","prop_fncwood_12a","prop_fncwood_13a","prop_fncwood_14a","prop_fncwood_15a","prop_fncwood_16a","prop_fncwood_16b","prop_fncwood_16c","prop_fncwood_16d","prop_fncwood_16e","prop_fncwood_16f","prop_fncwood_16g","prop_fncwood_17a","prop_fncwood_18a","prop_fncwood_19a",
        "prop_fncres_01a","prop_fncres_01b","prop_fncres_01c","prop_fncres_02a","prop_fncres_02b","prop_fncres_02c","prop_fncres_02d","prop_fncres_03a","prop_fncres_03b","prop_fncres_03c","prop_fncres_04a","prop_fncres_05a","prop_fncres_05b","prop_fncres_05c","prop_fncres_06a","prop_fncres_06b","prop_fncres_06c",
        "prop_fncsec_01a","prop_fncsec_01b","prop_fncsec_01crnr","prop_fncsec_01gate","prop_fncsec_02a","prop_fncsec_02pole","prop_fncsec_03a","prop_fncsec_03b","prop_fncsec_04a",
        "prop_fnccorgm_01a","prop_fnccorgm_01b","prop_fnccorgm_01c","prop_fnccorgm_02a","prop_fnccorgm_02b","prop_fnccorgm_02c","prop_fnccorgm_03a","prop_fnccorgm_04a","prop_fnccorgm_05a","prop_fnccorgm_05b","prop_fnccorgm_06a","prop_fnccorgm_06b",
        "prop_fncpeir_03a","prop_fnclog_01a","prop_fncwood_pole",
        "prop_barrier_work01a","prop_barrier_work01b","prop_barrier_work01c","prop_barrier_work02a","prop_barrier_work03a","prop_barrier_work04a","prop_barrier_work04b","prop_barrier_work05","prop_barrier_work06a","prop_barrier_work06b",
        "prop_barrier_wat_01a","prop_barrier_wat_02a","prop_barrier_wat_03a","prop_barrier_wat_03b","prop_barrier_wat_04a","prop_barrier_wat_04b","prop_barier_conc_01a","prop_barier_conc_01b","prop_barier_conc_01c","prop_barier_conc_02a","prop_barier_conc_02b","prop_barier_conc_02c","prop_barier_conc_03a","prop_barier_conc_04a","prop_barier_conc_04b","prop_barier_conc_04c","prop_barier_conc_05a","prop_barier_conc_05b","prop_barier_conc_05c",
        "prop_mp_barrier_01","prop_mp_barrier_01b","prop_mp_barrier_02","prop_mp_barrier_02b","prop_plas_barier_01a","prop_barrier_wat_05a","prop_cons_plank","prop_conc_sacks_02a","prop_cons_crate","prop_cons_cements01","prop_cons_ply01","prop_cons_ply02","prop_conslift_base","prop_cementbags01",
        "prop_wallbrick_01","prop_wallbrick_02","prop_wallbrick_03","prop_wall_light_08a","prop_ld_container","prop_container_01a","prop_container_ld","prop_container_03a",
        "prop_phonebox_01a","prop_phonebox_01b","prop_phonebox_01c","prop_phonebox_02","prop_phonebox_03","prop_phonebox_04","prop_gazebo_01","prop_gazebo_02","prop_gazebo_03","prop_busstop_01","prop_busstop_02","prop_busstop_04","prop_busstop_05",
        "prop_pallet_01a","prop_pallet_02a","prop_boxpile_01a","prop_boxpile_02b","prop_boxpile_03a","prop_boxpile_04a","prop_boxpile_05a","prop_boxpile_06a","prop_boxpile_06b","prop_boxpile_07a","prop_boxpile_07d","prop_woodpile_01a","prop_woodpile_01b","prop_woodpile_01c","prop_woodpile_02a","prop_woodpile_03a","prop_woodpile_04a",
        "prop_skip_01a","prop_skip_02a","prop_skip_03","prop_skip_04","prop_skip_05a","prop_skip_06a","prop_skip_08a","prop_dumpster_01a","prop_dumpster_02a","prop_dumpster_02b","prop_dumpster_3a","prop_dumpster_4a","prop_dumpster_4b",
        "prop_sign_road_01a","prop_sign_road_03a","prop_streetlight_01","prop_streetlight_01b","prop_streetlight_03","prop_billboard_01","prop_billboard_02","prop_billboard_03","prop_billboard_04","prop_billboard_05",
        "prop_windmill_01","prop_beach_fire","prop_tree_cedar_01","prop_tree_birch_01","prop_palm_huge_01a","prop_palm_med_01a","prop_gate_airport_01","prop_gate_prison_01","prop_facgate_01","prop_facgate_02pole","prop_facgate_03post","prop_facgate_07","prop_facgate_08","prop_gate_tep_01_l","prop_sec_gate_01d",
        "prop_const_fence01a","prop_const_fence01b","prop_const_fence02a","prop_const_fence02b","prop_const_fence03a","prop_const_fence03b","prop_fence_log_01","prop_fence_log_02",
        "prop_bush_lrg_01","prop_bin_01a","prop_bin_02a","prop_bin_03a","prop_bin_04a","prop_bin_05a","prop_bin_07a","prop_bin_08a",
        "prop_rub_buswreck_01","prop_rub_cardpile_01","prop_rub_carwreck_2","prop_ind_barge_01","prop_cs_dumpster_01a","prop_ld_barrier_01","prop_ld_hdd_01","prop_elecbox_10","prop_elecbox_12","prop_elecbox_17",
        "prop_ind_oldcrate","prop_cratepile_01a","prop_cratepile_02a","prop_cratepile_03a","prop_cratepile_05a","prop_cratepile_07a","prop_crate_01a","prop_crate_02a","prop_crate_03a","prop_crate_04a","prop_crate_09a","prop_crate_10a","prop_crate_11a",
        "prop_windowbox_a","prop_windowbox_b","prop_ind_conveyor_01","prop_fnc_hose","prop_cs_sc1_11_gate","prop_sc1_21_g_door_01","prop_sc1_12_door","prop_mp_cant_place_lrg","prop_roofvent_011a"
    };

    readonly string root, lab, scriptSha, shvdnVer;
    readonly DateTime loadedUtc = DateTime.UtcNow;
    readonly Stopwatch clock = Stopwatch.StartNew();
    Camera x2Camera; int failedRays, unknownRayHits;
    readonly List<Entity> owned = new List<Entity>();
    readonly HashSet<int> debris = new HashSet<int>();
    readonly HashSet<int> preProps = new HashSet<int>();
    string runDir, runId, state = "IDLE", step = "", curCmd = "";
    StreamWriter rows;
    long nextBeat; int nextPoll;
    bool busy, abortRequested, commandFailed;
    string requestId, fence, sessionId, experimentId, trialId, commandError;

    // P2 is deliberately line-framed to avoid adding a JSON assembly to SHVDN.
    // Immutable claim files prevent replay across script reloads and controller crashes.
    bool AcceptRequest(string[] wire)
    {
        requestId = null; runId = null; commandError = null; commandFailed = false;
        if (wire.Length != 11 || wire[0] != "X7P2" || !IsToken(wire[1], true)) return false;
        requestId = wire[1]; fence = wire[2]; sessionId = wire[3]; experimentId = wire[4]; trialId = wire[5]; curCmd = wire[10];
        try
        {
            string responses = Path.Combine(lab, "responses"); Directory.CreateDirectory(responses);
            if (File.Exists(Path.Combine(responses, requestId + ".json"))) return false;
            long expiry; int pid;
            if (!IsToken(fence, true) || !IsToken(sessionId, false) || !IsToken(experimentId, false) || !IsToken(trialId, false) ||
                !int.TryParse(wire[6], out pid) || pid != Process.GetCurrentProcess().Id || wire[7] != loadedUtc.ToString("o") ||
                !string.Equals(wire[8], scriptSha, StringComparison.OrdinalIgnoreCase) ||
                !long.TryParse(wire[9], out expiry) || expiry < (long)(DateTime.UtcNow - new DateTime(1970,1,1)).TotalSeconds ||
                expiry > (long)(DateTime.UtcNow - new DateTime(1970,1,1)).TotalSeconds + 3601 ||
                File.ReadAllText(Path.Combine(lab, "controller.fence")).Trim() != fence || string.IsNullOrWhiteSpace(curCmd))
                throw new Exception("request_fence_expiry_or_runtime_mismatch");
            string claims = Path.Combine(lab, "claims"); Directory.CreateDirectory(claims);
            using (FileStream claim = new FileStream(Path.Combine(claims, requestId), FileMode.CreateNew, FileAccess.Write, FileShare.None))
            { byte[] b = Encoding.UTF8.GetBytes(loadedUtc.ToString("o")); claim.Write(b, 0, b.Length); claim.Flush(true); }
            return true;
        }
        catch (Exception ex) { commandError = ex.Message; state = "REJECTED"; Respond(); return false; }
    }
    static bool IsToken(string value, bool hex)
    {
        if (string.IsNullOrEmpty(value) || value.Length > 100 || (hex && value.Length != 32)) return false;
        foreach (char c in value) if (hex ? !((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f')) : !(char.IsLetterOrDigit(c) || c == '_' || c == '-' || c == '.')) return false;
        return true;
    }
    void Respond()
    {
        if (requestId == null) return;
        string dst = Path.Combine(lab, "responses", requestId + ".json");
        AtomicText(dst, Obj("protocol", 2, "requestId", requestId, "fence", fence, "sessionId", sessionId,
            "experimentId", experimentId, "trialId", trialId, "command", curCmd, "state", state, "error", commandError,
            "runId", runId, "pid", Process.GetCurrentProcess().Id, "loadedUtc", loadedUtc.ToString("o"), "scriptSha256", scriptSha));
    }
    static void AtomicText(string dst, string text)
    {
        string tmp = dst + "." + Guid.NewGuid().ToString("N") + ".tmp";
        using (FileStream f = new FileStream(tmp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
        { byte[] b = Encoding.UTF8.GetBytes(text); f.Write(b, 0, b.Length); f.Flush(true); }
        if (File.Exists(dst)) File.Replace(tmp, dst, null); else File.Move(tmp, dst);
    }
    int savedMaxWanted = -1; bool savedInvincible; Vector3 originPos; float originHeading; bool teleported;

    // ===================================================================== lifecycle
    public WpsBreachLab()
    {
        Interval = 200;
        string bd = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
        string scriptsDir = File.Exists(Path.Combine(bd, "WpsBreachLabX7.3.cs")) ? bd : Path.Combine(bd, "scripts");
        root = Path.GetDirectoryName(scriptsDir);
        lab = Path.Combine(root, "WpsBreachLab");
        Directory.CreateDirectory(lab);
        scriptSha = ShaOf(Path.Combine(scriptsDir, "WpsBreachLabX7.3.cs"));
        shvdnVer = typeof(Script).Assembly.GetName().Version.ToString();
        Tick += delegate(object sender, EventArgs e) { OnTick(); };
        Aborted += delegate(object sender, EventArgs e) { OnAborted(); };
        Beat();
    }

    void OnAborted() { try { X4Restore(); } catch { } try { X7Restore(); } finally { try { CleanupAll(); RestorePlayer(); } catch { } } }

    void OnTick()
    {
        Beat();
        if (busy) return;
        string cf = Path.Combine(lab, "request.txt");
        if (!File.Exists(cf)) return;
        string[] lines;
        try { if (new FileInfo(cf).Length > 4096) return; lines = File.ReadAllLines(cf); File.Move(cf, Path.Combine(lab, "request.consumed-" + DateTime.UtcNow.Ticks + ".txt")); }
        catch { return; }
        if (!AcceptRequest(lines)) return;
        lines = new string[] { curCmd };
        busy = true; abortRequested = false;
        try
        {
            runId = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss", Inv) + "-" + Guid.NewGuid().ToString("N").Substring(0, 6);
            runDir = Path.Combine(lab, runId); Directory.CreateDirectory(runDir);
            rows = new StreamWriter(new FileStream(Path.Combine(runDir, "trials.jsonl"), FileMode.Create, FileAccess.Write, FileShare.ReadWrite));
            rows.AutoFlush = true;
            Row("header", "script", "WpsBreachLabX7.3.cs", "version", Ver, "scriptSha256", scriptSha, "shvdnApi", shvdnVer,
                "gameBuild", SafeGameVersion(), "loadedUtc", loadedUtc.ToString("o"), "pid", Process.GetCurrentProcess().Id, "autoLoadScripts", AutoLoadSetting(), "pools", PoolsRaw(), "commands", Arr(lines));
            foreach (string raw in lines)
            {
                string line = raw.Trim();
                if (line.Length == 0 || line.StartsWith("#")) continue;
                if (abortRequested) break;
                curCmd = line; state = "RUNNING"; step = "start";
                Beat(true);
                try { RunCommand(line); }
                catch (Exception ex) { commandFailed = true; commandError = ex.Message; Row("error", "cmd", line, "message", ex.GetType().Name + ": " + ex.Message, "stack", Trim(ex.StackTrace, 600)); }
                finally { if (!x4Active && x7State == "None") CleanupAll(); }
            }
        }
        catch (Exception ex2) { commandFailed = true; commandError = ex2.Message; try { Row("error", "message", ex2.ToString()); } catch { } }
        finally
        {
            try { if (!x4Active && x7State == "None") RestorePlayer(); } catch (Exception ex) { commandFailed = true; commandError = ex.Message; }
            try { if (frameLog != null) { frameLog.Dispose(); frameLog = null; } } catch (Exception ex) { commandFailed = true; commandError = ex.Message; }
            try { if (rows != null) { Row("done", "runId", runId, "commandFailed", commandFailed); rows.Dispose(); rows = null; } } catch (Exception ex) { commandFailed = true; commandError = ex.Message; }
            state = commandFailed || abortRequested ? "ERROR" : "DONE"; if (abortRequested) commandError = "aborted"; step = runId; busy = false; Beat(true); Respond();
        }
    }

    // ===================================================================== command dispatch
    void RunCommand(string line)
    {
        string[] parts = line.Split(new char[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
        string verb = parts[0].ToLowerInvariant();
        Dictionary<string, string> a = new Dictionary<string, string>();
        for (int i = 1; i < parts.Length; i++) { int e = parts[i].IndexOf('='); if (e > 0) a[parts[i].Substring(0, e).ToLowerInvariant()] = parts[i].Substring(e + 1); }
        if (!SafetyOk()) { Row("refused", "reason", "not_story_mode_or_player_unavailable"); return; }
        if (x4Active && verb != "x4fire" && verb != "x4walk" && verb != "x4restore" && verb != "x4cam" && verb != "demo") throw new Exception("restore_active_x4_first");
        if (x7State != "None" && !verb.StartsWith("x7") && !verb.StartsWith("x8") && verb != "abort") throw new Exception("restore_active_x7_first");
        if (x8Owner != null && verb.StartsWith("x7", StringComparison.Ordinal))
            throw new Exception("x8_owner_requires_x8_command");
        switch (verb)
        {
            case "x8enable": X8Enable(a); break;
            case "x8register": X8Register(a); break;
            case "x8prepare": X8Prepare(a); break;
            case "x8shot": X8Shot(a); break;
            case "x8restore": X8Restore(a); break;
            case "x8walk": X8OwnedCommand(verb, a); break;
            case "x8cam": X8OwnedCommand(verb, a); break;
            case "x8status": X8Status(); break;
            case "x8audit": X8Audit(a); break;
            case "x7prepare": X7Prepare(a); break;
            case "x7shot": X7Shot(a); break;
            case "x7walk": X7Walk(a); break;
            case "x7restore": X7Restore(); break;
            case "x7cam": X7Cam(a); break;
            case "x7preview": throw new Exception("x7_preview_forbidden_for_impact_selected_runtime");
            case "x4setup": X4Setup(a); break;
            case "x4fire": X4Fire(a); break;
            case "x4walk": X4Walk(a); break;
            case "x4cam": X4Cam(a); break;
            case "demo": X4Demo(); break;
            case "x4restore": X4Restore(); break;
            case "x4census": X4Census(a); break;
            case "x3idle": X3Idle(a); break;
            case "x3perf": X3Perf(a); break;
            case "x3breach": X3Geom(a, false); break;
            case "x3multi": X3Geom(a, true); break;
            case "x3player": X3Player(a); break;
            case "x3cleanuptest": X3CleanupTest(a); break;
            case "anchored": Anchored(a); break;
            case "census": Census(); break;
            case "worldcensus": WorldCensus(F(a, "radius", 250f)); break;
            case "probe": Trial(S(a, "model", ""), S(a, "variant", "frozen"), "none", a, "probe"); break;
            case "blast": Trial(S(a, "model", ""), S(a, "variant", "frozen"), S(a, "explosive", "grenade"), a, "blast"); break;
            case "line": Line(S(a, "model", ""), S(a, "variant", "static"), (int)F(a, "n", 3f), S(a, "explosive", "grenade"), a); break;
            case "detach": Detach(S(a, "model", ""), S(a, "variant", "frozen"), S(a, "mode", "each"), a); break;
            case "cleanup": break;
            case "abort": abortRequested = true; break;
            default: Row("unknown_command", "verb", verb); break;
        }
    }

    bool SafetyOk()
    {
        try
        {
            if (Function.Call<bool>(Hash.NETWORK_IS_SESSION_STARTED)) return false;
            return Game.Player != null && Game.Player.Character != null && Game.Player.Character.Exists() && !Game.IsLoading;
        }
        catch { return false; }
    }

    // ===================================================================== census
    void Census()
    {
        PrepareSite();
        Vector3 spot = SiteSpot();
        int n = 0;
        foreach (string name in Candidates)
        {
            if (abortRequested) break;
            n++; step = "census " + n + "/" + Candidates.Length + " " + name; Beat();
            Model m = new Model(name);
            bool valid = m.IsValid, inCd = valid && m.IsInCdImage;
            if (!inCd) { Row("census", "model", name, "hash", (uint)Game.GenerateHash(name), "valid", valid, "inCdImage", inCd); continue; }
            bool isFragModel = false; try { isFragModel = m.IsFragment; } catch { }
            Vector3 mn = Vector3.Zero, mx = Vector3.Zero; bool loaded = m.Request(4000);
            if (loaded) { try { m.GetDimensions(out mn, out mx); } catch { } }
            Prop p = null; bool isFragObj = false; int groups = -1; int bones = -1; bool nativeFrag = false; string err = null;
            if (loaded)
            {
                try
                {
                    p = World.CreateProp(m, spot, Vector3.Zero, false, false);
                    if (p != null && p.Exists())
                    {
                        owned.Add(p); p.IsPositionFrozen = true; Yield();
                        isFragObj = p.IsFragmentObject; groups = p.FragmentGroupCount;
                        nativeFrag = Function.Call<bool>(Hash.GET_IS_ENTITY_A_FRAG, p.Handle);
                        try { bones = p.Bones.Count; } catch { }
                    }
                    else err = "create_failed";
                }
                catch (Exception ex) { err = ex.Message; }
            }
            else err = "model_load_timeout";
            Row("census", "model", name, "hash", (uint)Game.GenerateHash(name), "valid", valid, "inCdImage", inCd, "loaded", loaded,
                "modelIsFragment", isFragModel, "isFragmentObject", isFragObj, "nativeIsEntityAFrag", nativeFrag, "fragGroups", groups, "bones", bones,
                "dimX", mx.X - mn.X, "dimY", mx.Y - mn.Y, "dimZ", mx.Z - mn.Z, "err", err);
            if (p != null && p.Exists()) { try { p.Delete(); } catch { } owned.Remove(p); }
            m.MarkAsNoLongerNeeded();
            Yield();
        }
    }

    void WorldCensus(float radius)
    {
        Prop[] props = World.GetNearbyProps(Game.Player.Character.Position, radius);
        Dictionary<int, string> names = new Dictionary<int, string>();
        foreach (string c in Candidates) names[Game.GenerateHash(c)] = c;
        int shown = 0;
        foreach (Prop p in props)
        {
            if (p == null || !p.Exists()) continue;
            bool fo = false; int g = -1; try { fo = p.IsFragmentObject; g = p.FragmentGroupCount; } catch { }
            if (!fo) continue;
            string label; names.TryGetValue(p.Model.Hash, out label);
            Row("worldfrag", "hash", (uint)p.Model.Hash, "label", label, "fragGroups", g, "dist", p.Position.DistanceTo(Game.Player.Character.Position));
            if (++shown >= 200) break;
        }
        Row("worldcensus_done", "propsScanned", props.Length, "fragProps", shown);
    }

    // Read-only placed-object census. No spawning, hiding, explosion or collision mutation.
    void X4Census(Dictionary<string, string> a)
    {
        PrepareSite();
        Ped player = Game.Player.Character;
        Vector3 site = new Vector3(F(a, "x", 900f), F(a, "y", -3000f), F(a, "z", 7f));
        player.Position = site; WaitCollision(player);
        for (int f = 0; f < 120; f++) Yield();
        Dictionary<int, string> names = new Dictionary<int, string>();
        foreach (string c in Candidates) names[Game.GenerateHash(c)] = c;
        Prop[] props = World.GetNearbyProps(player.Position, F(a, "radius", 120f));
        int count = 0;
        foreach (Prop p in props)
        {
            if (p == null || !p.Exists()) continue;
            Vector3 mn, mx; p.Model.GetDimensions(out mn, out mx);
            string name; names.TryGetValue(p.Model.Hash, out name);
            Vector3 size = mx - mn;
            float upDot = Vector3.Dot(p.UpVector, Vector3.WorldUp);
            bool wallShape = upDot > .98f && size.Z > 1.3f && size.Z < 4f && Math.Min(size.X, size.Y) < .8f && Math.Max(size.X, size.Y) > 1.8f && Math.Max(size.X, size.Y) < 8f;
            bool wallName = name != null && (name.Contains("wall") || name.Contains("fnc") || name.Contains("fence") || name.Contains("barier_conc"));
            if (!wallShape && !(wallName && upDot > .98f)) continue;
            Vector3 pos = p.Position;
            Row("x4_candidate", "handle", p.Handle, "model", name, "hash", (uint)p.Model.Hash,
                "x", pos.X, "y", pos.Y, "z", pos.Z, "heading", p.Heading,
                "minX", mn.X, "minY", mn.Y, "minZ", mn.Z, "maxX", mx.X, "maxY", mx.Y, "maxZ", mx.Z,
                "fragment", p.IsFragmentObject, "wallShape", wallShape, "upDot", upDot, "pitch", p.Rotation.X, "roll", p.Rotation.Y);
            count++; Yield();
        }
        Building[] buildings=World.GetNearbyBuildings(player.Position,F(a,"radius",120f));
        Row("x4_building_count","count",buildings.Length);
        int bi=0;
        foreach (Building b in buildings)
        {
            Vector3 mn,mx;b.Model.GetDimensions(out mn,out mx);Vector3 size=mx-mn;
            if(bi++>50)break;
            Vector3 bp=b.Position;
            Row("x4_static_candidate","hash",(uint)b.Model.Hash,"x",bp.X,"y",bp.Y,"z",bp.Z,"heading",b.Rotation.Z,"minX",mn.X,"minY",mn.Y,"minZ",mn.Z,"maxX",mx.X,"maxY",mx.Y,"maxZ",mx.Z);
            Yield();
        }
        Row("x4_census_done", "scanned", props.Length, "candidates", count, "x", site.X, "y", site.Y, "z", site.Z);
    }

    // X4 holds one replacement across bridge commands; no debris management before measurements.
    bool x4Active, x4Hidden, x4Fired;
    float x4Pu, x4Back = 7f;
    Lab x4Wall, x4Original;
    Vector3 x4HidePos; int x4HideModel; const float X4HideRadius = .15f;
    float x4OpeningU; WallBase x4Baseline;
    List<Vector3> x4NeighbourPositions; List<bool> x4NeighbourHits;

    Lab X4OriginalLab(Prop p)
    {
        Vector3 mn, mx; p.Model.GetDimensions(out mn, out mx);
        Lab L = new Lab(); L.Wall=p; L.Min=mn; L.Max=mx; L.Thin=(mx.X-mn.X)<(mx.Y-mn.Y)?0:1;
        L.P0=p.Position; L.Rt=p.RightVector; L.Fw=p.ForwardVector; L.Up=p.UpVector;
        L.T0=(L.Thin==0?mn.X:mn.Y)-.7f; L.T1=(L.Thin==0?mx.X:mx.Y)+.7f;
        L.U0=L.Thin==0?mn.Y:mn.X; L.U1=L.Thin==0?mx.Y:mx.X;
        L.V0=mn.Z; L.V1=mx.Z; L.BaseZ=mn.Z; L.P=.125f;
        L.Nu=(int)Math.Floor((L.U1-L.U0)/L.P); L.Nv=(int)Math.Floor((L.V1-L.V0)/L.P);
        return L;
    }
    bool X4Neighbours(string label, bool baseline)
    {
        Lab L=x4Original; List<Vector3> positions=new List<Vector3>(); List<bool> hits=new List<bool>(); bool same=true; int k=0;
        foreach(float u in new float[]{L.U0-1f,L.U0-.5f,L.U1+.5f,L.U1+1f}) foreach(float z in new float[]{.5f,1f,1.5f})
        {
            Vector3 a=L.W(L.L(L.T0,u,L.BaseZ+z)), b=L.W(L.L(L.T1,u,L.BaseZ+z));
            foreach(bool reverse in new bool[]{false,true})
            {
                Vector3 start=reverse?b:a,end=reverse?a:b;
                int request=Function.Call<int>(Hash.START_EXPENSIVE_SYNCHRONOUS_SHAPE_TEST_LOS_PROBE,start.X,start.Y,start.Z,end.X,end.Y,end.Z,17,0,0);
                using(OutputArgument h=new OutputArgument())using(OutputArgument p=new OutputArgument())using(OutputArgument n=new OutputArgument())using(OutputArgument e=new OutputArgument())
                {
                    int status=Function.Call<int>(Hash.GET_SHAPE_TEST_RESULT,request,h,p,n,e);
                    bool hit=h.GetResult<int>()!=0; Vector3 pos=p.GetResult<Vector3>();
                    if(status!=2)same=false;
                    if(!baseline && (hit!=x4NeighbourHits[k] || (hit && pos.DistanceTo(x4NeighbourPositions[k])>.05f)))same=false;
                    positions.Add(pos);hits.Add(hit);
                    int ne=hit?e.GetResult<int>():0; int net=-1; uint nem=0; try{ if(ne!=0&&Function.Call<bool>(Hash.DOES_ENTITY_EXIST,ne)){net=Function.Call<int>(Hash.GET_ENTITY_TYPE,ne);nem=(uint)Function.Call<int>(Hash.GET_ENTITY_MODEL,ne);} }catch{}
                    Row("x4_neighbour_ray","phase",label,"sample",k,"status",status,"hit",hit,"x",hit?pos.X:0f,"y",hit?pos.Y:0f,"z",hit?pos.Z:0f,"ent",ne,"entType",net,"entModel",nem);
                }
                k++;Yield();
            }
        }
        if(baseline){x4NeighbourPositions=positions;x4NeighbourHits=hits;}
        Row("x4_neighbours","phase",label,"samples",k,"unchanged",same);
        return same;
    }
    // ---- X4-0.3: bookkeeping for the hidden original (runtime-only, fully reversible)
    Prop x4Target; bool x4EntityOff, x4EntVisible; string x4Technique = ""; int x4OrigWall; bool x4TimeSet; int x4SavedH, x4SavedM, x4SavedS;
    void X4Hold(Dictionary<string,string> a, string label)
    {
        int s = (int)F(a, "hold", 0f); if (s > 0) Hold(label, s);
    }
    void RealWait(int ms)
    {
        long t0 = clock.ElapsedMilliseconds;
        while (clock.ElapsedMilliseconds - t0 < ms) { Yield(); Beat(); }
    }
    bool X4HiddenClear(string technique, int f0)
    {
        Grid absent = Probe(x4Original); int cu, tu; float window, u;
        // Inset the swept sphere centres so the sphere stays within the original footprint.
        x4Original.U0 += .35f; x4Original.U1 -= .35f;
        Passable(x4Original, "original_hidden", out cu, out tu, out window, out u);
        x4Original.U0 -= .35f; x4Original.U1 += .35f;
        bool clear = absent.Clear == absent.C.Length && cu == tu && failedRays == f0;
        Row("x4_hidden", "technique", technique, "radius", X4HideRadius, "clear", absent.Clear, "cells", absent.C.Length, "wall", absent.Wall, "other", absent.Other, "sweepClear", cu, "sweepTotal", tu, "failedRays", failedRays - f0, "zeroResidual", clear, "mask", MaskStr(absent));
        return clear;
    }
    void X4Setup(Dictionary<string,string> a)
    {
        if (x4Active) throw new Exception("restore_first");
        // Offline file/mod conflict check (NVE, forest, LA Roads inventories) is recorded in the evidence; it must be asserted explicitly.
        if (S(a, "verified", "") != "1") throw new Exception("target_file_conflict_check_required");
        uint thash = uint.Parse(S(a, "hash", "0"), Inv);
        Vector3 tpos = new Vector3(F(a, "tx", 0f), F(a, "ty", 0f), F(a, "tz", 0f));
        Vector3 start = new Vector3(F(a, "px", tpos.X), F(a, "py", tpos.Y - 8f), F(a, "pz", tpos.Z + 1.5f));
        PrepareSite(); ResetX3();
        if (!x4TimeSet) { x4SavedH = Function.Call<int>(Hash.GET_CLOCK_HOURS); x4SavedM = Function.Call<int>(Hash.GET_CLOCK_MINUTES); x4SavedS = Function.Call<int>(Hash.GET_CLOCK_SECONDS); x4TimeSet = true; Row("x4_time", "savedH", x4SavedH, "savedM", x4SavedM, "savedS", x4SavedS); }
        Function.Call(Hash.SET_CLOCK_TIME, 12, 0, 0);
        int f0 = failedRays;
        Ped pl = Game.Player.Character; pl.Position = start; WaitCollision(pl);
        for (int f = 0; f < 120; f++) Yield();
        Prop target = null; float bestD = 1.5f;
        foreach (Prop p in World.GetNearbyProps(tpos, 8f))
        {
            if (p == null || !p.Exists() || owned.Contains(p) || (uint)p.Model.Hash != thash) continue;
            float d = p.Position.DistanceTo(tpos); if (d < bestD) { bestD = d; target = p; }
        }
        if (target == null) throw new Exception("placed_target_missing");
        x4Original = X4OriginalLab(target);
        float width = x4Original.U1 - x4Original.U0, height = x4Original.V1 - x4Original.V0;
        Row("x4_target", "hash", thash, "x", target.Position.X, "y", target.Position.Y, "z", target.Position.Z, "heading", target.Heading,
            "width", width, "height", height, "thickness", (x4Original.T1 - x4Original.T0) - 1.4f, "matchDistance", bestD, "isFragment", target.IsFragmentObject);
        if (Math.Abs(width - 3f) > .8f || Math.Abs(height - 2.5f) > .45f) throw new Exception("target_size_requires_asset_adaptation");
        float upDot = Vector3.Dot(target.UpVector, Vector3.WorldUp);
        Row("x4_target_tilt", "upDot", upDot, "pitch", target.Rotation.X, "roll", target.Rotation.Y, "yaw", target.Rotation.Z);
        if (upDot < .985f) throw new Exception("target_not_upright");
        Grid original = Probe(x4Original);
        Row("x4_original", "hash", thash, "blocked", original.Wall, "cells", original.C.Length, "other", original.Other, "mask", MaskStr(original));
        if (original.Wall < original.C.Length * .85f) throw new Exception("original_collision_not_found");
        x4OrigWall = original.Wall;
        if (!X4Neighbours("original", true)) throw new Exception("neighbour_baseline_unresolved");
        bool nohide = S(a, "nohide", "0") == "1";
        x4Target = target; x4HidePos = target.Position; x4HideModel = target.Model.Hash; x4Hidden = !nohide; x4Active = true; x4EntityOff = false;
        try
        {
            if (!nohide)
            {
            Function.Call(Hash.CREATE_MODEL_HIDE_EXCLUDING_SCRIPT_OBJECTS, x4HidePos.X, x4HidePos.Y, x4HidePos.Z, X4HideRadius, x4HideModel, true);
            for (int f = 0; f < 60; f++) Yield();
            x4Technique = "CREATE_MODEL_HIDE_EXCLUDING_SCRIPT_OBJECTS";
            bool clear = X4HiddenClear(x4Technique, f0);
            if (!clear || S(a, "entity", "0") == "1")
            {
                // Smallest additional reversible step: switch this one placed object's own visibility and collision off.
                x4EntVisible = target.IsVisible; target.IsVisible = false;
                Function.Call(Hash.SET_ENTITY_COLLISION, target.Handle, false, false); x4EntityOff = true;
                for (int f = 0; f < 60; f++) Yield();
                x4Technique = "MODEL_HIDE+SET_ENTITY_VISIBLE_COLLISION_OFF";
                clear = X4HiddenClear(x4Technique, f0);
            }
            if (!clear) throw new Exception("residual_collision_after_hide");
            if (!X4Neighbours("hidden", false)) throw new Exception("hide_changed_neighbour");
            }
            else Row("x4_nohide_test", "note", "diagnostic: original left in place");
            // Align bounding-box centres (thickness midpoint included), heading and base elevation.
            Vector3 oc = x4Original.W(x4Original.L((x4Original.T0 + x4Original.T1) / 2f, (x4Original.U0 + x4Original.U1) / 2f, x4Original.BaseZ));
            Row("x4_stage", "at", "spawn_start");
            float heading = target.Heading;
            x4Wall = Spawn(AssetModel, "physical", oc, .25f, heading);
            if (x4Wall.Thin != x4Original.Thin) throw new Exception("asset_thin_axis_mismatch");
            Vector3 lm = (x4Wall.Min + x4Wall.Max) / 2f;
            Row("x4_stage", "at", "spawned", "x", x4Wall.Wall.Position.X, "y", x4Wall.Wall.Position.Y, "z", x4Wall.Wall.Position.Z, "frag", x4Wall.Wall.IsFragmentObject, "headingSet", heading, "headingActual", x4Wall.Wall.Heading, "bboxMidX", lm.X, "bboxMidY", lm.Y);
            if (Math.Abs(lm.X) + Math.Abs(lm.Y) > .02f) throw new Exception("asset_origin_not_bbox_centre");
            x4Wall.P0 = x4Wall.Wall.Position; x4Wall.Rt = x4Wall.Wall.RightVector; x4Wall.Fw = x4Wall.Wall.ForwardVector; x4Wall.Up = x4Wall.Wall.UpVector;
            // Measure only the footprint the original occupied (the asset may overhang neighbouring fence ends by a few cm).
            float half = Math.Min((x4Original.U1 - x4Original.U0) / 2f, (x4Wall.U1 - x4Wall.U0) / 2f), cuMid = (x4Wall.U0 + x4Wall.U1) / 2f;
            x4Wall.U0 = cuMid - half; x4Wall.U1 = cuMid + half; x4Wall.Nu = Math.Max(1, (int)Math.Floor((x4Wall.U1 - x4Wall.U0) / x4Wall.P));
            Row("x4_stage", "at", "attach_start");
            x4Wall.Index = 0; x4Wall.Anchor = AttachNativeAnchor(x4Wall.Wall); ConfigureWall(x4Wall);
            Row("x4_stage", "at", "attached");
            labHandles.Add(x4Wall.Wall.Handle); labHandles.Add(x4Wall.Anchor.Handle);
            x4Wall.Start = x4Wall.Wall.Position; x4Wall.StartUp = x4Wall.Wall.UpVector; x4Wall.StartRight = x4Wall.Wall.RightVector;
            for (int f = 0; f < 60; f++) Yield();
            Row("x4_stage", "at", "settled");
            SnapshotPre(oc, 30f); Row("x4_stage", "at", "snapshot_done"); x4Pu = F(a, "pu", 0f); x4Back = F(a, "back", 7f); PlacePlayerFacing(x4Wall, -x4Back, cuMid + x4Pu); Row("x4_stage", "at", "player_placed", "px", Game.Player.Character.Position.X, "py", Game.Player.Character.Position.Y, "pz", Game.Player.Character.Position.Z);
            Row("x4_replacement", "heading", heading, "cx", oc.X, "cy", oc.Y, "cz", oc.Z, "wallX", x4Wall.Wall.Position.X, "wallY", x4Wall.Wall.Position.Y, "wallZ", x4Wall.Wall.Position.Z, "measuredHalfWidth", half, "assetWidth", x4Wall.Max.X - x4Wall.Min.X, "assetHeight", x4Wall.Max.Z - x4Wall.Min.Z);
            x4RayShv = S(a, "ray", "shv") == "shv";
            if (F(a, "noprobe", 0f) > 0f) { for (int f = 0; f < 600; f++) { Yield(); if (f % 60 == 0) Row("x4_stage", "at", "idle", "f", f); } Row("x4_stage", "at", "idle_done"); X4Restore(); return; }
            x4Baseline = MeasureBaseline(x4Wall);
            if (!x4Baseline.Valid) throw new Exception("replacement_baseline_invalid"); X4Neighbours("replacement", false);
            x4Fired = false; Row("x4_setup", "ready", true, "technique", x4Technique, "asset", "frozen_X2_GEN9", "scriptDeletionToOpen", false);
        }
        catch { X4Restore(); throw; }
        X4Hold(a, "x4_intact");
    }
    void X4MeasureOpening(string phase)
    {
        List<Lab> labs = new List<Lab> { x4Wall }; ScanDebris(labs, x4Wall.P0, 30);
        Meas m = MeasureWall(x4Wall, x4Baseline, 0, 1, phase, -1, 1, 1);
        EmitGeom(x4Wall, x4Baseline, m, phase, 0, 1, true, -1, true);
        x4OpeningU = float.IsNaN(m.U) ? m.C.BigU : m.U;
        Row("x4_opening", "phase", phase, "windowM", m.W, "u", m.U, "nativeParts", AliveFlagged(0), "rootMove", m.RootMove, "anchored", m.Anchored);
        X4Neighbours(phase, false);
        if (AliveFlagged(0) == 0) throw new Exception("no_native_fragments");
    }
    void X4Fire(Dictionary<string,string> a)
    {
        if (!x4Active || x4Wall == null || x4Fired) throw new Exception("setup_required_or_already_fired");
        x4Fired = true;
        string mode = S(a, "mode", "rpg");
        Ped pl = Game.Player.Character;
        float cuMid = (x4Wall.U0 + x4Wall.U1) / 2f;
        float tFace = x4Wall.Thin == 1 ? x4Wall.Min.Y : x4Wall.Min.X;
        int lead = (int)F(a, "lead", 0f); if (lead > 0) RealWait(lead * 1000);
        float slow = F(a, "slowmo", 0f);
        if (mode == "rpg")
        {
            PlacePlayerFacing(x4Wall, -x4Back, cuMid + x4Pu);
            uint wh = (uint)WeaponHash.RPG;
            pl.Weapons.Give(WeaponHash.RPG, 3, true, true);
            Function.Call(Hash.REQUEST_WEAPON_ASSET, wh, 31, 0);
            long t0 = clock.ElapsedMilliseconds; while (!Function.Call<bool>(Hash.HAS_WEAPON_ASSET_LOADED, wh) && clock.ElapsedMilliseconds - t0 < 4000) { Yield(); }
            Vector3 from = pl.Position + new Vector3(0, 0, 1.0f) + pl.ForwardVector * .8f;
            Vector3 to = x4Wall.W(x4Wall.L(tFace, cuMid, 1.05f));
            Row("x4_charge", "method", "rpg_projectile_SHOOT_SINGLE_BULLET_BETWEEN_COORDS", "fromX", from.X, "fromY", from.Y, "fromZ", from.Z, "toX", to.X, "toY", to.Y, "toZ", to.Z, "slowmo", slow);
            if (slow > 0f) Game.TimeScale = slow;
            Function.Call(Hash.SHOOT_SINGLE_BULLET_BETWEEN_COORDS, from.X, from.Y, from.Z, to.X, to.Y, to.Z, 100, true, wh, pl.Handle, true, false, 80f);
        }
        else
        {
            Vector3 p = x4Wall.W(x4Wall.L(tFace - .4f, cuMid, 1f));
            Row("x4_charge", "method", "native_AddExplosion", "type", "rocket", "scale", 10, "frontOffset", .4f, "slowmo", slow);
            if (slow > 0f) Game.TimeScale = slow;
            World.AddExplosion(p, ExplosionType.Rocket, 10f, 0, pl, true, false);
        }
        if (slow > 0f) { RealWait((int)F(a, "slowms", 7000f)); Game.TimeScale = 1f; }
        for (int f = 0; f < 240; f++) { Yield(); if (f % 30 == 0) ScanDebris(new List<Lab> { x4Wall }, x4Wall.P0, 30); }
        if (mode == "rpg" && AliveFlagged(0) == 0 && S(a, "fallback", "1") == "1")
        {
            Row("x4_rpg_no_detach", "note", "real RPG projectile detached nothing; falling back to the calibrated native charge");
            Vector3 p = x4Wall.W(x4Wall.L(tFace - .4f, cuMid, 1f));
            Row("x4_charge", "method", "native_AddExplosion", "type", "rocket", "scale", 10, "frontOffset", .4f, "slowmo", 0f);
            World.AddExplosion(p, ExplosionType.Rocket, 10f, 0, pl, true, false);
            for (int f = 0; f < 240; f++) { Yield(); if (f % 30 == 0) ScanDebris(new List<Lab> { x4Wall }, x4Wall.P0, 30); }
        }
        X4Hold(a, "x4_after_blast");
        X4MeasureOpening("after_rocket");
    }
    // evidence camera only (scripted camera, nothing else changes)
    void X4Cam(Dictionary<string,string> a)
    {
        if (!x4Active || x4Wall == null) throw new Exception("setup_required");
        if (x2Camera != null) { World.RenderingCamera = null; x2Camera.Delete(); x2Camera = null; }
        if (S(a, "off", "0") == "1") return;
        Lab L = x4Wall; float cu = (L.U0 + L.U1) / 2f;
        x2Camera = World.CreateCamera(L.W(L.L(F(a, "t", -6f), cu + F(a, "u", 2.5f), L.BaseZ + F(a, "z", 1.7f))), Vector3.Zero, F(a, "fov", 55f));
        x2Camera.PointAt(L.W(L.L(F(a, "lt", 0f), cu + F(a, "lu", 0f), L.BaseZ + F(a, "lz", 1.1f))));
        World.RenderingCamera = x2Camera;
        Row("x4_cam", "t", F(a, "t", -6f), "u", F(a, "u", 2.5f), "z", F(a, "z", 1.7f));
    }
    void X4Walk(Dictionary<string,string> a)
    {
        if (!x4Active || x4Wall == null) throw new Exception("setup_required");
        X4MeasureOpening("pre_player_walk");
        Ped player = Game.Player.Character; PlacePlayerFacing(x4Wall, -2f, x4OpeningU);
        float slow = F(a, "slowmo", 0f);
        Vector3 start = player.Position, end = x4Wall.W(x4Wall.L(2f, x4OpeningU, x4Wall.BaseZ + .05f));
        long begun = clock.ElapsedMilliseconds; bool crossed = false, outside = false; float crossingU = float.NaN, prevT = -2, prevU = x4OpeningU, maxRise = 0;
        RealWait(2000);
        if (slow > 0f) Game.TimeScale = slow;
        Function.Call(Hash.TASK_GO_STRAIGHT_TO_COORD, player.Handle, end.X, end.Y, end.Z, 1f, 20000, player.Heading, .1f);
        begun = clock.ElapsedMilliseconds;
        while (clock.ElapsedMilliseconds - begun < 25000)
        {
            Yield(); float u, t, v; LocalUTV(x4Wall, player.Position, out u, out t, out v);
            maxRise = Math.Max(maxRise, player.Position.Z - start.Z);
            if (prevT < 0 && t >= 0 && float.IsNaN(crossingU)) crossingU = prevU + (u - prevU) * (-prevT) / (t - prevT);
            if (u < x4Wall.U0 + .3f || u > x4Wall.U1 - .3f) outside = true;
            Row("x4_player_track", "ms", clock.ElapsedMilliseconds - begun, "u", u, "t", t, "v", v);
            if (t > (x4Wall.Thin == 1 ? x4Wall.Max.Y : x4Wall.Max.X) + .8f) { crossed = true; break; }
            prevT = t; prevU = u; Beat();
        }
        Game.TimeScale = 1f;
        Function.Call(Hash.CLEAR_PED_TASKS, player.Handle);
        Vector3 finish = player.Position;
        Row("x4_player_result", "isPlayer", player.Handle == Game.Player.Character.Handle, "startX", start.X, "startY", start.Y, "startZ", start.Z, "endX", finish.X, "endY", finish.Y, "endZ", finish.Z, "ms", clock.ElapsedMilliseconds - begun, "crossed", crossed, "crossingU", crossingU, "outsideFootprint", outside, "maxRise", maxRise, "passed", crossed && !outside && !float.IsNaN(crossingU) && maxRise < .35f);
        X4Neighbours("after_player", false);
        X4Hold(a, "x4_player_through");
    }
    void X4Demo()
    {
        if (!x4Active || x4Wall == null) throw new Exception("setup_required");
        PlacePlayerFacing(x4Wall, -7f, (x4Wall.U0 + x4Wall.U1) / 2f);
        Game.Player.Character.Weapons.Give(WeaponHash.RPG, 3, true, true);
        Row("x4_demo", "ready", true, "weapon", "RPG", "manualShot", true);
    }
    void X4Restore()
    {
        if (!x4Hidden && !x4Active) return;
        try { Game.TimeScale = 1f; } catch { }
        try { if (x4TimeSet) { Function.Call(Hash.SET_CLOCK_TIME, x4SavedH, x4SavedM, x4SavedS); x4TimeSet = false; } } catch { }
        try { CleanupAll(); }
        finally
        {
            try { if (x4EntityOff && x4Target != null && x4Target.Exists()) { Function.Call(Hash.SET_ENTITY_COLLISION, x4Target.Handle, true, true); x4Target.IsVisible = x4EntVisible; } } catch { }
            if (x4Hidden) Function.Call(Hash.REMOVE_MODEL_HIDE, x4HidePos.X, x4HidePos.Y, x4HidePos.Z, X4HideRadius, x4HideModel, false);
            x4Hidden = false; x4Active = false; x4EntityOff = false; x4Wall = null; x4Fired = false;
        }
        for (int f = 0; f < 60; f++) Yield();
        if (x4Original != null) { Grid restored = Probe(x4Original); Row("x4_world_restored", "blocked", restored.Wall, "cells", restored.C.Length, "restoredToOriginal", restored.Wall >= x4OrigWall, "originalWall", x4OrigWall, "clear", restored.Clear); X4Neighbours("restored", false); }
        RestorePlayer();
    }

    // ===================================================================== X7 (ASTRA-001 X7-0.1): just-in-time hot swap
    // The ORIGINAL wall is left completely untouched (visible, colliding, undamaged) while a dormant twin of the frozen X2
    // native-fragment wall waits at the final transform: invisible, collision off (physics kept), damage/breaking disabled,
    // native joint anchor already attached. x7shot tracks the real RPG projectile every frame and, shortly before the predicted
    // impact, swaps in ONE script tick with no yield: twin collision+damage+visibility on, then the original model hidden
    // (CREATE_MODEL_HIDE_EXCLUDING_SCRIPT_OBJECTS, the X4 recipe). The real projectile then fractures the twin natively.
    // x7restore deletes the twin/anchor/verified debris, removes the model hide and checks the original again.
    // Verbs: x7prepare, x7shot, x7walk, x7restore. Reuses X4/X3 spawn, anchor, ownership-verified cleanup and the stable World.Raycast probes.
    string x7State = "None";
    Lab x7Twin, x7Orig; Prop x7Target;
    // X7.2b independent sections: x7Twin is the CENTRE section and doubles as the whole-fence measurement frame.
    readonly List<Lab> x7SecLabs = new List<Lab>(); readonly HashSet<int> x7SecHandles = new HashSet<int>();
    bool IsWall(Lab L, int h) { return L.Wall != null && (h == L.Wall.Handle || (L == x7Twin && x7SecHandles.Count > 0 && x7SecHandles.Contains(h))); }
    Vector3 x7HidePos; int x7HideModel; bool x7Hidden, x7Committed, x7Dormant;
    // X7.2c selective fracture: positions (0..4, negative U to positive U) whose native damage/breaking is enabled at commit; null = all (X7.2b behaviour).
    HashSet<int> x7SelPos; readonly Dictionary<int, Vector3> x7SecStart = new Dictionary<int, Vector3>();
    // Independent physical order (negative U -> positive U); debris ownership remains shared index 0.
    readonly Lab[] x7ByPos = new Lab[5];
    static int X7PosOf(int labIdx) { return labIdx == 0 ? 2 : (labIdx <= 2 ? labIdx - 1 : labIdx); }
    void X7ActivateSelective()
    {
        // Every section becomes visible and solid; only the selected pair is allowed to take native damage / break. Flags first, then collision, then visibility.
        for (int i = 0; i < x7ByPos.Length; i++)
        {
            Prop w = x7ByPos[i].Wall; bool sel = x7SelPos.Contains(i);
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
    float x7Back = 9f, x7Pu = 1.5f; float x7OpenU;
    bool x7TimeSet; int x7SavedH, x7SavedM, x7SavedS;
    const float X7HideRadius = .15f;

    // Witness rays: 9 fixed rays (3 columns x 3 heights) across the wall thickness. Counts rays that hit lab L's own wall entity.
    int X7Witness(string label, Lab L)
    {
        int blocked = 0, total = 0, other = 0; float uc = (L.U0 + L.U1) / 2f;
        foreach (float du in new float[] { -.7f, 0f, .7f })
            foreach (float dz in new float[] { .4f, 1.0f, 1.6f })
            {
                byte c = Classify(L, uc + du, L.V0 + dz); total++;
                if (c == 1) blocked++; else if (c != 0) other++;
            }
        Row("x7_witness", "label", label, "blocked", blocked, "total", total, "otherHits", other);
        return blocked;
    }

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
    long X7Commit(Astra.X7.ImpactSectionSelector.Selection selected)
    {
        // Validate before the first mutation. The hot path has no Yield, model load, file read or Row.
        if (x7State != "Armed" || x7Committed || x7SecLabs.Count != 5 ||
            selected.SecondIndex != selected.FirstIndex + 1 || selected.FirstIndex < 0 || selected.SecondIndex > 4)
            throw new Exception("x7_auto_commit_invalid_state");
        if (x7Target == null || !x7Target.Exists() || x7Target.Model.Hash != x7HideModel ||
            x7Target.Position.DistanceTo(x7HidePos) > .05f)
            throw new Exception("x7_original_changed_before_commit");
        if (x8Owner != null)
        {
            Astra.X8.Placement site = x8Registry.Get(x8Owner).Site;
            if (!site.Matches(x7Target.Position.X, x7Target.Position.Y, x7Target.Position.Z,
                              x7Target.Heading))
                throw new Exception("x8_original_basis_stale_before_commit");
        }
        for (int i = 0; i < x7ByPos.Length; i++)
        {
            Lab lab = x7ByPos[i];
            if (lab == null || lab.Wall == null || !lab.Wall.Exists() ||
                lab.Anchor == null || !lab.Anchor.Exists() || !lab.Wall.IsAttachedTo(lab.Anchor))
                throw new Exception("x7_section_preflight_failed:" + i);
        }
        x7SelPos = new HashSet<int> { selected.FirstIndex, selected.SecondIndex };
        long t0 = Stopwatch.GetTimestamp();
        X7ActivateSelective();
        // Record hide intent before the native call so restore can compensate even if it throws.
        x7Hidden = true;
        Function.Call(Hash.CREATE_MODEL_HIDE_EXCLUDING_SCRIPT_OBJECTS, x7HidePos.X, x7HidePos.Y, x7HidePos.Z, X7HideRadius, x7HideModel, true);
        x7Committed = true;
        return Stopwatch.GetTimestamp() - t0;
    }

    void X7Prepare(Dictionary<string, string> a)
    {
        if (x7State != "None") throw new Exception("x7restore_first");
        string requested=S(a,"model",AssetModel);
        if (!X7InPackManifest(requested)) throw new Exception("model_not_in_pack_allowlist");
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
        x7SecLabs.Clear(); x7SecHandles.Clear(); x7SecStart.Clear(); x7SelPos = null;
        Array.Clear(x7ByPos, 0, x7ByPos.Length);
        if (S(a, "sel", "").Length > 0)
        {
            if (!sectional) throw new Exception("sel_requires_sectional_model");
            string[] sp = S(a, "sel", "").Split(','); if (sp.Length != 2) throw new Exception("sel_requires_2_positions");
            int s0 = int.Parse(sp[0].Trim(), Inv), s1 = int.Parse(sp[1].Trim(), Inv);
            if (s0 < 0 || s1 > 4 || s1 != s0 + 1) throw new Exception("sel_must_be_adjacent_lo_hi_0_to_4");
            x7SelPos = new HashSet<int> { s0, s1 };
        }
        if (x4Active) throw new Exception("x4_active");
        if (S(a, "verified", "") != "1") throw new Exception("target_file_conflict_check_required");
        uint thash = uint.Parse(S(a, "hash", "0"), Inv);
        Vector3 tpos = new Vector3(F(a, "tx", 0f), F(a, "ty", 0f), F(a, "tz", 0f));
        Vector3 start = new Vector3(F(a, "px", tpos.X), F(a, "py", tpos.Y - 8f), F(a, "pz", tpos.Z + 1.5f));
        PrepareSite(); ResetX3(); x4RayShv = true;
        if (!x7TimeSet) { x7SavedH = Function.Call<int>(Hash.GET_CLOCK_HOURS); x7SavedM = Function.Call<int>(Hash.GET_CLOCK_MINUTES); x7SavedS = Function.Call<int>(Hash.GET_CLOCK_SECONDS); x7TimeSet = true; Row("x7_time", "savedH", x7SavedH, "savedM", x7SavedM, "savedS", x7SavedS); }
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
        if (x8Owner != null) X8PreflightCandidate(tpos, thash, target);
        x7Orig = X4OriginalLab(target);
        float width = x7Orig.U1 - x7Orig.U0, height = x7Orig.V1 - x7Orig.V0;
        Row("x7_target", "hash", thash, "x", target.Position.X, "y", target.Position.Y, "z", target.Position.Z, "heading", target.Heading, "width", width, "height", height, "matchDistance", bestD);
        if (Math.Abs(width - 2.536f) > .08f || Math.Abs(height - 2.351f) > .08f) throw new Exception("target_size_requires_asset_adaptation");
        if (Vector3.Dot(target.UpVector, Vector3.WorldUp) < .985f) throw new Exception("target_not_upright");
        int w0 = X7Witness("original_before", x7Orig);
        if (w0 != 9) throw new Exception("original_collision_not_found");
        x7Target = target; x7HidePos = target.Position; x7HideModel = target.Model.Hash; x7Hidden = false; x7Committed = false;
        x7State = "Preparing";
        try
        {
            Vector3 oc = x7Orig.W(x7Orig.L((x7Orig.T0 + x7Orig.T1) / 2f, (x7Orig.U0 + x7Orig.U1) / 2f, x7Orig.BaseZ));
            float heading = target.Heading;
            Row("x7_stage", "at", "twin_spawn_start");
            x7Dormant = true;
            try { x7Twin = Spawn(sectional ? X7SecName(2, patK, requested, plainModel) : plainModel, "physical", oc, .25f, heading); } finally { x7Dormant = false; }
            if (x7Twin.Thin != x7Orig.Thin) throw new Exception("asset_thin_axis_mismatch");
            Vector3 lm = (x7Twin.Min + x7Twin.Max) / 2f;
            if (Math.Abs(lm.X) + Math.Abs(lm.Y) > .02f) throw new Exception("asset_origin_not_bbox_centre");
            x7Twin.P0 = x7Twin.Wall.Position; x7Twin.Rt = x7Twin.Wall.RightVector; x7Twin.Fw = x7Twin.Wall.ForwardVector; x7Twin.Up = x7Twin.Wall.UpVector;
            float half = Math.Min((x7Orig.U1 - x7Orig.U0) / 2f, (x7Twin.U1 - x7Twin.U0) / 2f), cuMid = (x7Twin.U0 + x7Twin.U1) / 2f;
            if (sectional)
            {
                // Five independent native fragment props side by side; x7Twin (centre section) keeps the whole-fence frame.
                float secW = x7Twin.U1 - x7Twin.U0; half = Math.Min((x7Orig.U1 - x7Orig.U0) / 2f, 2.5f * secW);
                x7SecLabs.Add(x7Twin); x7SecHandles.Add(x7Twin.Wall.Handle);
                x7Twin.Index = 0; x7Twin.Anchor = AttachNativeAnchor(x7Twin.Wall); ConfigureWall(x7Twin);
                X7SetDormantOne(x7Twin.Wall, true); // no yielding with damage enabled
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
                        X7SetDormantOne(sl.Wall, true);
                        x7SecLabs.Add(sl); x7SecHandles.Add(sl.Wall.Handle); labHandles.Add(sl.Wall.Handle); labHandles.Add(sl.Anchor.Handle);
                        Row("x7_section", "index", si, "model", sl.Name, "handle", sl.Wall.Handle, "x", sl.Wall.Position.X, "y", sl.Wall.Position.Y, "z", sl.Wall.Position.Z, "offsetU", (si - 2) * secW);
                    }
                }
                finally { x7Dormant = false; }
                Row("x7_sections", "count", x7SecLabs.Count, "secW", secW, "model", requested, "plain", plainModel, "pat", patK == null ? "uniform" : string.Join(",", patK), "sel", x7SelPos == null ? "all" : string.Join(",", x7SelPos));
            }
            x7Twin.U0 = cuMid - half; x7Twin.U1 = cuMid + half; x7Twin.Nu = Math.Max(1, (int)Math.Floor((x7Twin.U1 - x7Twin.U0) / x7Twin.P));
            if (!sectional) { x7Twin.Index = 0; x7Twin.Anchor = AttachNativeAnchor(x7Twin.Wall); ConfigureWall(x7Twin); }
            X7SetDormant(true);
            if (!sectional) { labHandles.Add(x7Twin.Wall.Handle); labHandles.Add(x7Twin.Anchor.Handle); }
            if (sectional) for (int si2 = 0; si2 < x7SecLabs.Count; si2++)
            {
                int posIndex = X7PosOf(si2);
                if (x7ByPos[posIndex] != null) throw new Exception("x7_duplicate_physical_position");
                x7ByPos[posIndex] = x7SecLabs[si2];
                x7SecStart[posIndex] = x7SecLabs[si2].Wall.Position;
            }
            x7Twin.Start = x7Twin.Wall.Position; x7Twin.StartUp = x7Twin.Wall.UpVector; x7Twin.StartRight = x7Twin.Wall.RightVector;
            for (int f = 0; f < 90; f++) { Yield(); if (f == 30) X7SetDormant(true); }
            Row("x7_stage", "at", "twin_dormant", "visible", x7Twin.Wall.IsVisible, "frag", x7Twin.Wall.IsFragmentObject, "wallX", x7Twin.Wall.Position.X, "wallY", x7Twin.Wall.Position.Y, "wallZ", x7Twin.Wall.Position.Z, "heading", x7Twin.Wall.Heading, "attached", x7Twin.Wall.IsAttachedTo(x7Twin.Anchor));
            int wt = X7Witness("twin_dormant", x7Twin);
            int wo = X7Witness("original_armed", x7Orig);
            if (wt != 0) throw new Exception("dormant_twin_collides");
            if (wo != 9) throw new Exception("original_changed_while_armed");
            SnapshotPre(oc, 30f);
            x7Back = F(a, "back", 9f); x7Pu = F(a, "pu", 1.5f);
            PlacePlayerFacing(x7Twin, -x7Back, cuMid + x7Pu);
            pl.Weapons.Give(WeaponHash.RPG, 4, true, true);
            Row("x7_armed", "originalBlocked", wo, "twinBlocked", wt, "assetWidth", x7Twin.Max.X - x7Twin.Min.X, "assetHeight", x7Twin.Max.Z - x7Twin.Min.Z, "playerX", pl.Position.X, "playerY", pl.Position.Y, "playerZ", pl.Position.Z, "pools", PoolsRaw());
            x7State = "Armed";
        }
        catch { X7Restore(); throw; }
        int hold = (int)F(a, "hold", 0f); if (hold > 0) Hold("x7_armed", hold);
    }

    sealed class X7Frame { public int Frame; public long Ms; public double FrameMs; public float T, U, V, Vt, Ttc, Speed; public bool On; public int Proj; }


    // Read-only, bounded X7.3 diagnostics. The pure selector remains the sole commit authority.
    static bool X7DiagFinite(double value) { return !double.IsNaN(value) && !double.IsInfinity(value); }
    static string X7DiagRejection(double u, double t, double v, double vu, double vt, double vv, double face)
    {
        if (!X7DiagFinite(u) || !X7DiagFinite(t) || !X7DiagFinite(v) ||
            !X7DiagFinite(vu) || !X7DiagFinite(vt) || !X7DiagFinite(vv) || !X7DiagFinite(face))
            return "nonfinite";
        if (vt <= Astra.X7.ImpactSectionSelector.MinimumNormalSpeed) return "normal_speed";
        double distance = face - t;
        if (distance < 0) return "behind_face";
        double seconds = distance / vt;
        if (!X7DiagFinite(seconds) || seconds > Astra.X7.ImpactSectionSelector.MaximumHorizonSeconds)
            return "beyond_prediction_window";
        double impactU = u + vu * seconds, impactV = v + vv * seconds;
        if (impactU < -Astra.X7.ImpactSectionSelector.Width / 2 ||
            impactU > Astra.X7.ImpactSectionSelector.Width / 2) return "outside_sheet_u";
        if (impactV < 0 || impactV > Astra.X7.ImpactSectionSelector.SheetHeight) return "outside_sheet_v";
        return "unclassified_selector_rejection";
    }
    static void X7DiagRemember(Dictionary<string, int> counts, Dictionary<string, object[]> first,
        Queue<object[]> recent, string reason, int frame, int handle, Vector3 pos, Vector3 vel,
        double u, double t, double v, double vu, double vt, double vv, double ttcMs, double horizonMs)
    {
        int n; counts.TryGetValue(reason, out n); counts[reason] = n + 1;
        object[] sample = new object[] { frame, reason, handle, pos.X, pos.Y, pos.Z,
            vel.X, vel.Y, vel.Z, u, t, v, vu, vt, vv, ttcMs, horizonMs };
        if (!first.ContainsKey(reason)) first[reason] = sample;
        if (recent.Count == 48) recent.Dequeue();
        recent.Enqueue(sample);
    }
    void X7DiagSample(string scope, object[] s)
    {
        Row("x7_diag_sample", "scope", scope, "frame", s[0], "reason", s[1], "projectile", s[2],
            "x", s[3], "y", s[4], "z", s[5], "vx", s[6], "vy", s[7], "vz", s[8],
            "u", s[9], "t", s[10], "v", s[11], "vu", s[12], "vt", s[13], "vv", s[14],
            "ttcMs", s[15], "horizonMs", s[16]);
    }

    void X7Shot(Dictionary<string, string> a)
    {
        if (x7State != "Armed") throw new Exception("x7prepare_required_or_already_active");
        string mode = S(a, "mode", "script");                    // script | weapon | manual | none
        bool predict = S(a, "predict", "1") == "1", fallback = false;
        // The automatic experiment cannot inherit a command-chosen profile or bypass prediction.
        if (x7SecLabs.Count != 5 || x7SelPos != null || !predict)
            throw new Exception("x7_live_impact_requires_five_sections_no_preselection");
        if(S(a,"fallback","0")!="0") throw new Exception("x7_fallback_forbidden");
        float baseH = F(a, "horizon", 40f), frameK = F(a, "framek", 1.5f), miss = F(a, "miss", 0f);
        float aimU=F(a,"aimu",0f),aimV=F(a,"aimv",1.05f);
        if(Math.Abs(aimU)>1.12f || aimV<.2f || aimV>2.05f) throw new Exception("aim_outside_sheet");
        float waitS = F(a, "wait", mode == "manual" ? 90f : (mode == "none" ? 10f : 12f));
        string label = S(a, "label", mode);
        Ped pl = Game.Player.Character; Lab T = x7Twin;
        float cuMid = (T.U0 + T.U1) / 2f;
        float tFace = T.Thin == 1 ? T.Min.Y : T.Min.X;
        Vector3 axT = T.Thin == 0 ? T.Rt : T.Fw, axU = T.Thin == 0 ? T.Fw : T.Rt;
        Vector3 centre = T.W(T.L(0f, cuMid+aimU, T.V0+aimV));
        Vector3 aim = T.W(T.L(tFace, cuMid + miss + aimU, T.V0 + aimV));
        uint wh = (uint)WeaponHash.RPG;
        // Preserve the proven P0 setup; align off-centre shots with the target by default.
        // A shot-level pu= override remains available for controlled comparisons.
        float shotPu = F(a, "pu", Math.Abs(aimU) < .05f ? x7Pu : aimU);
        PlacePlayerFacing(T, -x7Back, cuMid + shotPu);
        pl.Weapons.Give(WeaponHash.RPG, 4, true, true);
        Function.Call(Hash.REQUEST_WEAPON_ASSET, wh, 31, 0);
        long tw = clock.ElapsedMilliseconds; while (!Function.Call<bool>(Hash.HAS_WEAPON_ASSET_LOADED, wh) && clock.ElapsedMilliseconds - tw < 4000) Yield();
        for (int f = 0; f < 30; f++) Yield();
        List<X7Frame> trace = new List<X7Frame>(); List<double> frameMs = new List<double>(); List<int> frameNo = new List<int>();
        Row("x7_shot_begin", "label", label, "model", x7Model, "aimU", aimU, "aimV", aimV, "postSide", "negative_u", "mode", mode, "predict", predict, "fallback", fallback, "baseHorizonMs", baseH, "frameK", frameK, "miss", miss, "back", x7Back, "pu", shotPu, "aimX", aim.X, "aimY", aim.Y, "aimZ", aim.Z);
        // pre-shot frame baseline (no shape tests, nothing else running)
        long lastT = Stopwatch.GetTimestamp();
        for (int f = 0; f < 60; f++) { Yield(); long n = Stopwatch.GetTimestamp(); frameMs.Add((n - lastT) * 1000.0 / Stopwatch.Frequency); frameNo.Add(Game.FrameCount); lastT = n; }
        int baselineN = frameMs.Count;
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
        // One controlled RPG shot. Exclude projectiles that existed before launch;
        // there is no SHVDN owner/weapon proof, so multiple eligible newcomers fail closed.
        HashSet<int> beforeShotHandles = new HashSet<int>();
        Dictionary<int, object[]> baselineDetails = new Dictionary<int, object[]>();
        Projectile[] beforeShot = World.GetNearbyProjectiles(centre, 90f);
        if (beforeShot == null) throw new Exception("x7_projectile_baseline_unavailable");
        foreach (Projectile p0 in beforeShot)
            if (p0 != null && p0.Exists())
            {
                int handle = p0.Handle, modelHash = 0;
                Vector3 pos = p0.Position, vel = p0.Velocity;
                try { modelHash = p0.Model.Hash; } catch { }
                beforeShotHandles.Add(handle);
                baselineDetails[handle] = new object[] { handle, modelHash, pos.X, pos.Y, pos.Z,
                    vel.X, vel.Y, vel.Z };
            }
        int fireFrame = Game.FrameCount; long fireMs = clock.ElapsedMilliseconds;
        if (mode == "script")
        {
            Vector3 from = shotFrom;
            Row("x7_charge", "method", "rpg_projectile_SHOOT_SINGLE_BULLET_BETWEEN_COORDS", "fromX", from.X, "fromY", from.Y, "fromZ", from.Z);
            Function.Call(Hash.SHOOT_SINGLE_BULLET_BETWEEN_COORDS, from.X, from.Y, from.Z, aim.X, aim.Y, aim.Z, 100, true, wh, pl.Handle, true, false, 80f);
        }
        else if (mode == "weapon")
        {
            Function.Call(Hash.SET_CURRENT_PED_WEAPON, pl.Handle, wh, true);
            Row("x7_charge", "method", "TASK_SHOOT_AT_COORD_real_weapon_fire");
            Function.Call(Hash.TASK_SHOOT_AT_COORD, pl.Handle, aim.X, aim.Y, aim.Z, 3000, unchecked((int)0x7D60E4E0));
        }
        else if (mode == "manual")
        {
            Function.Call(Hash.SET_CURRENT_PED_WEAPON, pl.Handle, wh, true);
            Row("x7_charge", "method", "manual_player_fire", "waitS", waitS);
        }
        bool committed = false, late = false, fallbackUsed = false, seen = false, gone = false;
        int commitFrame = -1, exFrame = -1, fracFrame = -1, goneFrame = -1, commitProj = 0; long commitMs = 0, commitTicks = 0, exMs = 0, fracMs = 0;
        float commitTtc = float.NaN, commitDt = float.NaN, commitHorizon = float.NaN, commitSpeed = float.NaN; double commitFrameMs = 0;
        Dictionary<int, Vector3> prevPos = new Dictionary<int, Vector3>(); Dictionary<int, long> prevMs = new Dictionary<int, long>();
        List<Lab> labs = x7SecLabs.Count > 1 ? new List<Lab>(x7SecLabs) : new List<Lab> { T };
        int diagQueries = 0, diagQueryErrors = 0, diagNullResults = 0, diagEmptyResults = 0;
        int diagExcluded = 0, diagInvalid = 0, diagNewObservations = 0;
        int diagExplosionFrame = -1, diagExplosionDelayMs = -1, diagExplosionQueryErrors = 0;
        string diagFirstQueryError = "";
        HashSet<int> diagNewHandles = new HashSet<int>();
        Dictionary<string, int> diagCounts = new Dictionary<string, int>();
        Dictionary<string, object[]> diagFirst = new Dictionary<string, object[]>();
        Queue<object[]> diagRecent = new Queue<object[]>();
        // Baseline identity is NOT proof of pre-existing projectile identity: a pool handle can be reused.
        // Keep the same selector/readyCount; only grant a baseline handle admission after
        // two distinct post-fire samples travel along this exact launch corridor.
        Astra.X7.ProjectileAdmissionPolicy.Point3 launchFrom =
            new Astra.X7.ProjectileAdmissionPolicy.Point3(shotFrom.X, shotFrom.Y, shotFrom.Z);
        Astra.X7.ProjectileAdmissionPolicy.Point3 launchAim =
            new Astra.X7.ProjectileAdmissionPolicy.Point3(aim.X, aim.Y, aim.Z);
        Dictionary<int, Astra.X7.ProjectileAdmissionPolicy.Point3> pendingBaseline =
            new Dictionary<int, Astra.X7.ProjectileAdmissionPolicy.Point3>();
        Dictionary<int, int> pendingBaselineFrame = new Dictionary<int, int>();
        HashSet<int> confirmedBaseline = new HashSet<int>();
        HashSet<int> observedBaseline = new HashSet<int>();
        Dictionary<int, object[]> firstBaseline = new Dictionary<int, object[]>();
        Dictionary<int, object[]> lastBaseline = new Dictionary<int, object[]>();
        Queue<object[]> recentBaseline = new Queue<object[]>();
        int baselinePlausible = 0, baselinePromoted = 0, baselinePromotedObservations = 0;
        // X7.2b read-only fracture-propagation probe (probe=1): per-frame strip raycasts + native debris first-seen/velocity. Never alters physics.
        bool probeOn = S(a, "probe", "0") == "1"; int probeFrames = 0; const int probeMaxFrames = 220; double probeMsMax = 0, probeMsSum = 0;
        List<string[]> probeRows = new List<string[]>(); List<object[]> debRows = new List<object[]>(); HashSet<int> debSeen = new HashSet<int>();
        long t0 = clock.ElapsedMilliseconds;
        while (clock.ElapsedMilliseconds - t0 < (long)(waitS * 1000f) && !abortRequested)
        {
            Yield();
            long nowT = Stopwatch.GetTimestamp(); double fms = (nowT - lastT) * 1000.0 / Stopwatch.Frequency; lastT = nowT;
            int gf = Game.FrameCount; frameMs.Add(fms); frameNo.Add(gf);
            long nowMs = clock.ElapsedMilliseconds;
            // Only genuine, newly observed, forward-moving projectiles whose predicted
            // sheet intersection passes the pure selector are considered. Never use aimU.
            Projectile best = null;
            Astra.X7.ImpactSectionSelector.Selection bestSelection = default(Astra.X7.ImpactSectionSelector.Selection);
            float bestVt = 0f, bu = 0f, bt = 0f, bv = 0f, bttc = float.NaN, bspeed = 0f;
            int readyCount = 0; bool ready = false;
            double horizonSeconds = Math.Min(Astra.X7.ImpactSectionSelector.MaximumHorizonSeconds,
                Math.Max(0.0, (baseH + fms * frameK) / 1000.0));
            Projectile[] ps = null;
            diagQueries++;
            try { ps = World.GetNearbyProjectiles(centre, 90f); }
            catch (Exception ex) { diagQueryErrors++; if (diagFirstQueryError.Length == 0) diagFirstQueryError = ex.GetType().Name; }
            if (ps == null) diagNullResults++;
            else if (ps.Length == 0) diagEmptyResults++;
            if (ps != null)
            {
                foreach (Projectile p in ps)
                {
                    if (p == null || !p.Exists()) { diagInvalid++; continue; }
                    int ph = p.Handle;
                    bool inBaseline = beforeShotHandles.Contains(ph);
                    if (inBaseline)
                    {
                        observedBaseline.Add(ph);
                        Vector3 rawPos = p.Position, rawVel = p.Velocity;
                        // Keep excluded-handle evidence even when no motion qualifies.
                        float du, dt, dv; LocalUTV(T, rawPos, out du, out dt, out dv);
                        float velT = Vector3.Dot(rawVel, axT), velU = Vector3.Dot(rawVel, axU), velV = Vector3.Dot(rawVel, T.Up);
                        double rawTtc = velT > 0 ? (tFace - dt) / velT * 1000.0 : -1;
                        object[] sample = new object[] { gf, "baseline", ph, rawPos.X, rawPos.Y, rawPos.Z,
                            rawVel.X, rawVel.Y, rawVel.Z, (double)du - cuMid, dt, (double)dv - T.V0,
                            velU, velT, velV, rawTtc, horizonSeconds * 1000.0 };
                        if (!firstBaseline.ContainsKey(ph)) firstBaseline[ph] = sample;
                        lastBaseline[ph] = sample;
                        if (recentBaseline.Count == 48) recentBaseline.Dequeue();
                        recentBaseline.Enqueue(sample);
                        var point = new Astra.X7.ProjectileAdmissionPolicy.Point3(rawPos.X, rawPos.Y, rawPos.Z);
                        var velocity = new Astra.X7.ProjectileAdmissionPolicy.Point3(rawVel.X, rawVel.Y, rawVel.Z);
                        double progress;
                        // Only the controlled script shot permits provenance recovery. Manual/weapon/none
                        // keep their original strict baseline exclusion. No selector, physics, or time retune.
                        if (mode != "script" ||
                            !Astra.X7.ProjectileAdmissionPolicy.TryLaunchFlight(
                                launchFrom, launchAim, point, velocity, nowMs - fireMs, out progress))
                        {
                            diagExcluded++;
                            if (!confirmedBaseline.Contains(ph))
                            { pendingBaseline.Remove(ph); pendingBaselineFrame.Remove(ph); }
                            continue;
                        }
                        baselinePlausible++;
                        if (!confirmedBaseline.Contains(ph))
                        {
                            Astra.X7.ProjectileAdmissionPolicy.Point3 first;
                            int firstFrame;
                            if (!pendingBaseline.TryGetValue(ph, out first) ||
                                !pendingBaselineFrame.TryGetValue(ph, out firstFrame))
                            {
                                pendingBaseline[ph] = point; pendingBaselineFrame[ph] = gf;
                                diagExcluded++; continue;
                            }
                            if (!Astra.X7.ProjectileAdmissionPolicy.Corroborates(
                                launchFrom, launchAim, first, point, gf - firstFrame))
                            {
                                if (gf - firstFrame > 8)
                                { pendingBaseline[ph] = point; pendingBaselineFrame[ph] = gf; }
                                diagExcluded++; continue;
                            }
                            confirmedBaseline.Add(ph);
                            baselinePromoted++;
                        }
                        baselinePromotedObservations++;
                    }
                    else { diagNewObservations++; diagNewHandles.Add(ph); }
                    Vector3 pos = p.Position, vel = p.Velocity;
                    if (vel.Length() < 5f && prevPos.ContainsKey(ph))
                    {
                        double dts = (nowMs - prevMs[ph]) / 1000.0;
                        if (dts > 0 && dts <= .1) vel = (pos - prevPos[ph]) / (float)dts;
                    }
                    prevPos[ph] = pos; prevMs[ph] = nowMs;
                    float u, t, v; LocalUTV(T, pos, out u, out t, out v);
                    float vt = Vector3.Dot(vel, axT), vu = Vector3.Dot(vel, axU), vv = Vector3.Dot(vel, T.Up);
                    double localU = (double)u - cuMid, localV = (double)v - T.V0;
                    double ttcDiagnostic = vt > 0 ? (tFace - t) / vt * 1000.0 : -1;
                    if (!X7DiagFinite(ttcDiagnostic)) ttcDiagnostic = -1;
                    Astra.X7.ImpactSectionSelector.Selection selection;
                    if (!Astra.X7.ImpactSectionSelector.TryPredictAndSelect(
                        localU, t, localV,
                        vu, vt, vv, tFace,
                        Astra.X7.ImpactSectionSelector.MaximumHorizonSeconds, out selection))
                    {
                        X7DiagRemember(diagCounts, diagFirst, diagRecent,
                            X7DiagRejection(localU, t, localV, vu, vt, vv, tFace),
                            gf, ph, pos, vel, localU, t, localV, vu, vt, vv,
                            ttcDiagnostic, horizonSeconds * 1000.0);
                        continue;
                    }
                    X7DiagRemember(diagCounts, diagFirst, diagRecent,
                        selection.TimeToFaceSeconds <= horizonSeconds ? "eligible_ready" : "eligible_early",
                        gf, ph, pos, vel, localU, t, localV, vu, vt, vv,
                        selection.TimeToFaceSeconds * 1000.0, horizonSeconds * 1000.0);
                    if (best == null || selection.TimeToFaceSeconds < bestSelection.TimeToFaceSeconds ||
                        (selection.TimeToFaceSeconds == bestSelection.TimeToFaceSeconds && ph < best.Handle))
                    {
                        best = p; bestSelection = selection; bestVt = vt; bu = u; bt = t; bv = v;
                        bttc = (float)selection.TimeToFaceSeconds; bspeed = vel.Length();
                    }
                    if (selection.TimeToFaceSeconds <= horizonSeconds) readyCount++;
                }
            }
            if (best != null)
            {
                gone = false; goneFrame = -1;
                seen = true;
                trace.Add(new X7Frame { Frame = gf, Ms = nowMs, FrameMs = fms, T = bt, U = bu, V = bv, Vt = bestVt, Ttc = bttc * 1000f, Speed = bspeed, On = true, Proj = best.Handle });
                ready = bestSelection.TimeToFaceSeconds <= horizonSeconds && readyCount == 1;
                if (!committed && ready)
                {
                    try { commitTicks = X7Commit(bestSelection); }
                    catch { x7State = "RestorePending"; throw; }
                    committed = true; commitFrame = gf; commitMs = nowMs; commitTtc = bttc * 1000f;
                    commitDt = tFace - bt; commitHorizon = (float)(horizonSeconds * 1000.0);
                    commitSpeed = bspeed; commitFrameMs = fms; commitProj = best.Handle;
                    Row("x7_selection", "label", label, "projectile", commitProj,
                        "impactU", bestSelection.ImpactU, "impactV", bestSelection.ImpactV,
                        "ttcMs", bestSelection.TimeToFaceSeconds * 1000.0,
                        "first", bestSelection.FirstIndex, "second", bestSelection.SecondIndex,
                        "mask", bestSelection.Mask, "readyCount", readyCount, "origin", "projected_intersection");
                }
            }
            else if (seen && !gone) { gone = true; goneFrame = gf; }
            // This observational probe also runs when no candidate passed the selector. It never sets exFrame/late or commits.
            if (!seen && diagExplosionFrame < 0)
            {
                try
                {
                    if (Function.Call<bool>(Hash.IS_EXPLOSION_IN_SPHERE, -1, centre.X, centre.Y, centre.Z, 1.5f))
                    { diagExplosionFrame = gf; diagExplosionDelayMs = (int)(nowMs - fireMs); }
                }
                catch { diagExplosionQueryErrors++; }
            }
            // --- impact / explosion near the wall (flag stays true while the explosion is recent; only the first frame is used)
            if (exFrame < 0 && (seen || mode == "manual" || mode == "none") && Function.Call<bool>(Hash.IS_EXPLOSION_IN_SPHERE, -1, centre.X, centre.Y, centre.Z, 1.5f))
            {
                exFrame = gf; exMs = nowMs;
                if (!committed)
                {
                    late = true;
                    // X7 never creates a fallback blast. Misses are recorded as misses.
                }
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
        foreach (KeyValuePair<int, object[]> baseline in baselineDetails)
        {
            object[] v = baseline.Value;
            Row("x7_baseline_snapshot", "projectile", v[0], "model", v[1],
                "x", v[2], "y", v[3], "z", v[4], "vx", v[5], "vy", v[6], "vz", v[7]);
        }
        Row("x7_baseline_recovery", "distinctBaselineObserved", observedBaseline.Count,
            "baselinePlausibleSamples", baselinePlausible, "baselinePromotedHandles", baselinePromoted,
            "baselinePromotedObservations", baselinePromotedObservations,
            "baselineExcludedObservations", diagExcluded);
        foreach (KeyValuePair<int, object[]> baseline in firstBaseline)
            X7DiagSample("baseline_first", baseline.Value);
        foreach (KeyValuePair<int, object[]> baseline in lastBaseline)
            X7DiagSample("baseline_last", baseline.Value);
        foreach (object[] sample in recentBaseline) X7DiagSample("baseline_recent", sample);
        Row("x7_diag_summary", "baselineHandles", beforeShotHandles.Count, "queryFrames", diagQueries,
            "queryErrors", diagQueryErrors, "firstQueryErrorType", diagFirstQueryError,
            "nullResults", diagNullResults, "emptyResults", diagEmptyResults,
            "invalidCandidates", diagInvalid, "baselineExcluded", diagExcluded,
            "newObservations", diagNewObservations, "distinctNewHandles", diagNewHandles.Count,
            "independentExplosionFrame", diagExplosionFrame, "independentExplosionDelayMs", diagExplosionDelayMs,
            "independentExplosionErrors", diagExplosionQueryErrors, "acceptedSelection", seen);
        foreach (KeyValuePair<string, int> r in diagCounts)
            Row("x7_diag_count", "reason", r.Key, "observations", r.Value);
        foreach (KeyValuePair<string, object[]> r in diagFirst) X7DiagSample("first", r.Value);
        foreach (object[] s in diagRecent) X7DiagSample("recent", s);
        foreach (X7Frame fr in trace) Row("x7_track", "label", label, "frame", fr.Frame, "ms", fr.Ms - fireMs, "frameMs", fr.FrameMs, "t", fr.T, "u", fr.U, "v", fr.V, "vt", fr.Vt, "speed", fr.Speed, "ttcMs", fr.Ttc, "onCourse", fr.On, "proj", fr.Proj);
        if (x7SecLabs.Count > 1) X7SecState(label);
        if (probeOn)
        {
            foreach (string[] pr in probeRows) Row("x7_probe", "label", label, "frame", int.Parse(pr[0], Inv), "dFrame", pr[1], "probeMs", double.Parse(pr[2], Inv), "strips_blocked_debris_other", pr[3]);
            foreach (object[] dr in debRows) Row("x7_debris", "label", label, "frame", dr[0], "dFrame", (int)dr[0] - exFrame, "handle", dr[1], "u", dr[2], "t", dr[3], "v", dr[4], "vu", dr[5], "vt", dr[6], "vv", dr[7], "speed", dr[8], "first", dr[9]);
            Row("x7_probe_summary", "label", label, "frames", probeFrames, "meanProbeMs", probeFrames > 0 ? probeMsSum / probeFrames : 0, "maxProbeMs", probeMsMax, "explosionFrame", exFrame, "commitFrame", commitFrame, "aimU", aimU);
        }
        Row("x7_frames", "label", label, "baselineMedianMs", bMed, "baselineMaxMs", bMax, "windowMaxMs", winMax, "windowMaxFrame", winFrame, "over50", over50, "over100", over100, "frames", frameMs.Count - baselineN);
        int wOrig = X7Witness("after_shot_original", x7Orig);
        int wTwin = X7Witness("after_shot_twin", x7Twin);
        bool twinIntactAfterMiss = !committed && parts == 0;
        Row("x7_result", "label", label, "model", x7Model, "aimU", aimU, "aimV", aimV, "mode", mode, "predict", predict, "committed", committed, "projectileSeen", seen, "late", late, "fallbackUsed", fallbackUsed,
            "fireFrame", fireFrame, "commitFrame", commitFrame, "explosionFrame", exFrame, "fractureSeenFrame", fracFrame,
            "framesCommitToExplosion", (commitFrame >= 0 && exFrame >= 0) ? (object)(exFrame - commitFrame) : null,
            "msCommitToExplosion", (commitFrame >= 0 && exFrame >= 0) ? (object)(exMs - commitMs) : null,
            "ttcAtCommitMs", commitTtc, "distToFaceAtCommitM", commitDt, "horizonMs", commitHorizon, "projSpeed", commitSpeed, "frameMsAtCommit", commitFrameMs,
            "commitCallMs", commitTicks * 1000.0 / Stopwatch.Frequency, "nativeParts", parts, "originalBlocked", wOrig, "twinBlocked", wTwin, "twinIntactAfterMiss", twinIntactAfterMiss, "pools", PoolsRaw());
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

    // Find the widest clear lane through the twin's debris-opened wall (player capsule needs about 0.9 m).
    // Read only: dense bidirectional SHVDN raycasts performed after the 60-frame settle.
    void X7Mask(string label, float aimU, float aimV)
    {
        Lab T=x7Twin; float centreU=(T.U0+T.U1)/2f;
        float pitch=.1f, uStart=T.U0+.06f, vStart=T.V0+.16f; // skip lower empty collision edge
        int nu=(int)Math.Floor((T.U1-uStart-.04f)/pitch)+1;
        int nv=(int)Math.Floor((T.V0+2.131f-vStart-.04f)/pitch)+1; // sheet only; exclude X6's 0.22 m empty top band
        StringBuilder mask=new StringBuilder(nu*nv);
        for(int j=0;j<nv;j++)
        {
            for(int i=0;i<nu;i++) mask.Append((char)('0'+Classify(T,uStart+i*pitch,vStart+j*pitch)));
            Yield();
        }
        Row("x7_mask","label",label,"model",x7Model,"aimU",aimU,"aimV",aimV,
            "u0",uStart-centreU,"v0",vStart-T.V0,"pitch",pitch,"nu",nu,"nv",nv,
            "mask",mask.ToString(),"postSide","negative_u");
        // Separate rooted-post and 0.15 m sheet-band witnesses; mask deliberately excludes post.
        int post=0, top=0, bottom=0, sampleCount=0;
        foreach(float height in new float[] { .45f, 1.10f, 1.70f })
            if(Classify(T,T.U0+.025f,T.V0+height)==1) post++;
        for(float u=T.U0+.10f; u<T.U1-.05f; u+=.1f)
        {
            sampleCount++;
            if(Classify(T,u,T.V0+.175f)==1) bottom++;
            if(Classify(T,u,T.V0+2.131f-.075f)==1) top++;
            Yield();
        }
        Row("x7_frame_bands","label",label,"model",x7Model,"postBlocked",post,
            "postTotal",3,"topBlocked",top,"bottomBlocked",bottom,"bandTotal",sampleCount);
    }
    bool X7FindOpening(out float u, out float widthM)
    {
        Lab T = x7Twin; u = (T.U0 + T.U1) / 2f; widthM = 0f; float cuMid = u; int run = 0, bestRun = 0; float bestMid = u; bool any = false;
        List<bool> clear = new List<bool>(); List<float> us = new List<float>();
        float[] hs = new float[] { .5f, .9f, 1.3f, 1.7f }; System.Text.StringBuilder[] mk = new System.Text.StringBuilder[hs.Length];
        for (int k = 0; k < hs.Length; k++) mk[k] = new System.Text.StringBuilder();
        for (float x = T.U0 + .15f; x <= T.U1 - .15f; x += .1f)
        {
            bool ok = true;
            for (int k = 0; k < hs.Length; k++) { byte c = Classify(T, x, T.V0 + hs[k]); mk[k].Append((char)('0' + c)); if (c != 0) ok = false; }
            clear.Add(ok); us.Add(x); Yield();
        }
        for (int k = 0; k < hs.Length; k++) Row("x7_opening_mask", "dz", hs[k], "u0", T.U0 + .15f, "mask", mk[k].ToString());
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
        Row("x7_opening", "found", any, "u", u, "widthM", widthM, "columnsClear", clear.FindAll(delegate (bool b) { return b; }).Count, "columns", clear.Count, "nativeParts", AliveFlagged(0));
        return any;
    }

    void X7Walk(Dictionary<string, string> a)
    {
        if (x7State != "Active" || x7Twin == null) throw new Exception("x7_active_required");
        Lab T = x7Twin;
        ScanDebris(new List<Lab> { T }, T.P0, 30f);
        float openU, openW; bool found = X7FindOpening(out openU, out openW);
        if (a.ContainsKey("u")) { openU = F(a, "u", openU); found = true; openW = F(a, "w", 0f); }
        if (!found && S(a, "force", "0") != "1") { Row("x7_player_result", "isPlayer", true, "crossed", false, "passed", false, "reason", "no_clear_lane_0.9m"); return; }
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
            Row("x7_player_track", "ms", clock.ElapsedMilliseconds - begun, "u", u, "t", t, "v", v);
            if (t > (T.Thin == 1 ? T.Max.Y : T.Max.X) + .8f) { crossed = true; break; }
            prevT = t; prevU = u; Beat();
        }
        Game.TimeScale = 1f;
        Function.Call(Hash.CLEAR_PED_TASKS, player.Handle);
        Vector3 finish = player.Position;
        Row("x7_player_result", "isPlayer", player.Handle == Game.Player.Character.Handle, "startX", start.X, "startY", start.Y, "startZ", start.Z, "endX", finish.X, "endY", finish.Y, "endZ", finish.Z, "ms", clock.ElapsedMilliseconds - begun, "crossed", crossed, "crossingU", crossingU, "laneU", openU, "laneWidthM", openW, "outsideFootprint", outside, "maxRise", maxRise, "passed", crossed && !outside && !float.IsNaN(crossingU) && maxRise < .35f);
        int hold = (int)F(a, "hold", 0f); if (hold > 0) Hold("x7_player_through", hold);
    }

    void X7Cam(Dictionary<string, string> a)
    {
        if (x7Twin == null) throw new Exception("x7prepare_required");
        if (x2Camera != null) { World.RenderingCamera = null; x2Camera.Delete(); x2Camera = null; }
        if (S(a, "off", "0") == "1") return;
        Lab L = x7Twin; float cu = (L.U0 + L.U1) / 2f;
        x2Camera = World.CreateCamera(L.W(L.L(F(a, "t", -6.5f), cu + F(a, "u", 3.2f), L.BaseZ + F(a, "z", 1.7f))), Vector3.Zero, F(a, "fov", 55f));
        x2Camera.PointAt(L.W(L.L(F(a, "lt", 0f), cu + F(a, "lu", .2f), L.BaseZ + F(a, "lz", 1.1f))));
        World.RenderingCamera = x2Camera;
        Row("x7_cam", "t", F(a, "t", -6.5f), "u", F(a, "u", 3.2f), "z", F(a, "z", 1.7f));
    }

    void X7Restore()
    {
        if (x7State == "None" && !x7Hidden && !x7TimeSet) return;
        try { Game.TimeScale = 1f; } catch { }
        try { if (x7TimeSet) { Function.Call(Hash.SET_CLOCK_TIME, x7SavedH, x7SavedM, x7SavedS); x7TimeSet = false; } } catch { }
        if (x8Owner != null) X8CaptureCleanup();
        try { CleanupAll(); }
        finally
        {
            if (x7Hidden) Function.Call(Hash.REMOVE_MODEL_HIDE, x7HidePos.X, x7HidePos.Y, x7HidePos.Z, X7HideRadius, x7HideModel, false);
            x7Hidden = false; x7Committed = false; x7State = "None"; x7Twin = null; x7SecLabs.Clear(); x7SecHandles.Clear(); x7SelPos = null;
            Array.Clear(x7ByPos, 0, x7ByPos.Length);
        }
        for (int f = 0; f < 60; f++) Yield();
        // Model hide invalidates the original handle. Reacquire before restore witness (X5 limitation).
        Prop restored = null; float nearest = 1.5f;
        foreach (Prop p in World.GetNearbyProps(x7HidePos, 8f))
        {
            if (p == null || !p.Exists() || p.Model.Hash != x7HideModel || owned.Contains(p)) continue;
            float d = p.Position.DistanceTo(x7HidePos); if (d < nearest) { nearest = d; restored = p; }
        }
        if (restored != null) { x7Target = restored; x7Orig = X4OriginalLab(restored); }
        if (x7Orig != null)
        {
            int w = X7Witness("restored_original", x7Orig);
            bool vis = false; try { vis = x7Target != null && x7Target.Exists() && x7Target.IsVisible; } catch { }
            Row("x7_restored", "originalBlocked", w, "originalExists", x7Target != null && x7Target.Exists(), "originalVisibleFlag", vis, "restoredToOriginal", w == 9, "pools", PoolsRaw());
            if (w != 9) { commandFailed = true; commandError = "original_restore_requires_9_of_9"; }
        }
        else { commandFailed = true; commandError = "original_restore_witness_missing"; }
        RestorePlayer();
    }

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

    // ===================================================================== lab geometry
    sealed class Lab
    {
        public Prop Wall; public string Name; public int Thin; public Vector3 Min, Max; public float P = 0.25f;
        public float U0, U1, V0, V1, T0, T1; public int Nu, Nv; public float BaseZ;
        public Vector3 L(float t, float u, float v) { return Thin == 0 ? new Vector3(t, u, v) : new Vector3(u, t, v); }
        public Vector3 P0, Rt, Fw, Up;
        public int Index; public Prop Anchor; public Vector3 Start, StartUp, StartRight;
        public Vector3 W(Vector3 l) { return P0 + Rt * l.X + Fw * l.Y + Up * l.Z; }
        public Vector3 Inv(Vector3 w) { Vector3 d = w - P0; return new Vector3(Vector3.Dot(d, Rt), Vector3.Dot(d, Fw), Vector3.Dot(d, Up)); }
    }
    sealed class Grid { public int Nu, Nv; public byte[] C; public int Wall, Debris, Other, Clear, Foreign; public string OtherKinds; public byte At(int i, int j) { return C[j * Nu + i]; } }
    sealed class Cmp
    {
        public int Closed, OpenedWall, OpenedClear, Residual, FarOpened, BigSize, BigCols, BigRows, BigJ0 = -1;
        public float BigU, BigV, BigW, BigH; public List<int> Cells = new List<int>();
    }

    Lab Spawn(string name, string variant, Vector3 spot, float pitch, float heading = 0f)
    {
        Model m = new Model(name);
        if (!m.IsValid || !m.IsInCdImage) throw new Exception("model_invalid:" + name);
        if (!m.Request(6000)) throw new Exception("model_load_timeout:" + name);
        Lab L = new Lab(); L.Name = name;
        Vector3 mn, mx; m.GetDimensions(out mn, out mx); L.Min = mn; L.Max = mx;
        float dx = mx.X - mn.X, dy = mx.Y - mn.Y;
        L.Thin = dx <= dy ? 0 : 1;
        Vector3 pos = new Vector3(spot.X, spot.Y, spot.Z - mn.Z + 0.02f);
        bool dyn = variant != "static";
        Prop p = World.CreateProp(m, pos, new Vector3(0f, 0f, heading), dyn, false);
        if (p == null || !p.Exists()) throw new Exception("create_failed:" + name);
        owned.Add(p); L.Wall = p;
        if (x7Dormant) X7SetDormantOne(p, true); // fully protect before Spawn's first Yield
        if (variant == "frozen" || variant == "physical") p.IsPositionFrozen = true;
        if (variant == "static") Function.Call(Hash.SET_ENTITY_DYNAMIC, p.Handle, false);
        for (int i = 0; i < 12; i++) Yield();
        L.BaseZ = mn.Z; L.P0 = p.Position; L.Rt = p.RightVector; L.Fw = p.ForwardVector; L.Up = p.UpVector;
        preProps.Clear(); try { foreach (Prop q in World.GetNearbyProps(p.Position, 16f)) if (q != null && q.Exists() && q.Handle != p.Handle) preProps.Add(q.Handle); } catch { }
        float tMin = L.Thin == 0 ? mn.X : mn.Y, tMax = L.Thin == 0 ? mx.X : mx.Y;
        float uMin = L.Thin == 0 ? mn.Y : mn.X, uMax = L.Thin == 0 ? mx.Y : mx.X;
        L.T0 = tMin - 1.5f; L.T1 = tMax + 1.5f;
        float w = uMax - uMin, h = mx.Z - mn.Z;
        float pitchUse = pitch; while ((w / pitchUse) * (h / pitchUse) > 1400f) pitchUse += 0.05f;
        L.P = pitchUse; L.U0 = uMin; L.U1 = uMax; L.V0 = mn.Z; L.V1 = mx.Z;
        L.Nu = Math.Max(1, (int)Math.Floor(w / L.P)); L.Nv = Math.Max(1, (int)Math.Floor(h / L.P));
        return L;
    }

    Grid Probe(Lab L)
    {
        Grid g = new Grid(); g.Nu = L.Nu; g.Nv = L.Nv; g.C = new byte[L.Nu * L.Nv];
        foreignHits = 0; otherKinds.Clear();
        for (int j = 0; j < L.Nv; j++)
        {
            for (int i = 0; i < L.Nu; i++)
            {
                float u = L.U0 + (i + 0.5f) * L.P, v = L.V0 + (j + 0.5f) * L.P;
                if (i == 0 && j == 0) Row("x4_stage", "at", "probe_first_ray", "u", u, "v", v);
                if (x4Active && (i % 6) == 0) Row("x4_prog", "i", i, "j", j);
                byte c = Classify(L, u, v);
                if (i == 0 && j == 0) Row("x4_stage", "at", "probe_first_ray_done", "c", c);
                g.C[j * L.Nu + i] = c; Yield();
                if (c == 0) g.Clear++; else if (c == 1) g.Wall++; else if (c == 2) g.Debris++; else g.Other++;
            }
            if ((j & 3) == 3) Yield();
        }
        g.Foreign = foreignHits; g.OtherKinds = KindsStr();
        return g;
    }

    byte Classify(Lab L, float u, float v)
    {
        Vector3 a = L.W(L.L(L.T0, u, v)), b = L.W(L.L(L.T1, u, v));
        byte c1 = NativeRay(L,a,b), c2 = NativeRay(L,b,a);
        if(c1==1||c2==1)return 1;
        if(c1==2||c2==2)return 2;
        if(c1==3||c2==3)return 3;
        return 0;
    }
    static bool x4RayShv;
    byte NativeRay(Lab L,Vector3 a,Vector3 b)
    {
        if (x4RayShv)
        {
            RaycastResult rr = World.Raycast(a, b, (IntersectFlags)17, null);
            if (!rr.DidHit) return 0;
            Entity he = rr.HitEntity; int e2 = he == null ? 0 : he.Handle;
            if (IsWall(L, e2)) return 1; if (debris.Contains(e2)) return 2; NoteOther(e2, rr.HitPosition); return 3;
        }
        int h=Function.Call<int>(Hash.START_EXPENSIVE_SYNCHRONOUS_SHAPE_TEST_LOS_PROBE,a.X,a.Y,a.Z,b.X,b.Y,b.Z,17,0,0);
        using(OutputArgument hit=new OutputArgument())using(OutputArgument pos=new OutputArgument())using(OutputArgument normal=new OutputArgument())using(OutputArgument entity=new OutputArgument()){
            int status=Function.Call<int>(Hash.GET_SHAPE_TEST_RESULT,h,hit,pos,normal,entity);
            if(status!=2){failedRays++;return 3;}
            if(hit.GetResult<int>()==0)return 0;
            int e=entity.GetResult<int>();if(IsWall(L,e))return 1;if(debris.Contains(e)){int o;if(debrisOwner.TryGetValue(e,out o)&&o!=L.Index)foreignHits++;return 2;}NoteOther(e,pos.GetResult<Vector3>());return 3;
        }
    }
    byte Cls(Lab L, RaycastResult r)
    {
        if (!r.DidHit) return 0;
        Entity e = r.HitEntity; int h = e == null ? 0 : e.Handle;
        if (h != 0 && IsWall(L, h)) return 1;
        if (h != 0 && debris.Contains(h)) return 2;
        return 3;
    }

    Cmp Compare(Lab L, Grid b, Grid n, float blastU, float blastV, float nearR)
    {
        Cmp c = new Cmp(); int nu = b.Nu, nv = b.Nv;
        bool[] open = new bool[nu * nv];
        for (int j = 0; j < nv; j++) for (int i = 0; i < nu; i++)
        {
            byte bb = b.C[j * nu + i], nn = n.C[j * nu + i];
            if (bb != 1) continue; c.Closed++;
            if (nn != 1) c.OpenedWall++;
            if (nn == 0) { c.OpenedClear++; open[j * nu + i] = true; }
            if (nn == 2 || nn == 3) c.Residual++;
            if (nn != 1)
            {
                float u = L.U0 + (i + 0.5f) * L.P, v = L.V0 + (j + 0.5f) * L.P;
                float d = (float)Math.Sqrt((u - blastU) * (u - blastU) + (v - blastV) * (v - blastV));
                if (d > nearR) c.FarOpened++;
            }
        }
        bool[] seen = new bool[nu * nv]; List<int> best = new List<int>();
        for (int s = 0; s < open.Length; s++)
        {
            if (!open[s] || seen[s]) continue;
            List<int> comp = new List<int>(); Stack<int> st = new Stack<int>(); st.Push(s); seen[s] = true;
            while (st.Count > 0)
            {
                int k = st.Pop(); comp.Add(k); int ki = k % nu, kj = k / nu;
                int[] nb = new int[] { ki > 0 ? k - 1 : -1, ki < nu - 1 ? k + 1 : -1, kj > 0 ? k - nu : -1, kj < nv - 1 ? k + nu : -1 };
                foreach (int q in nb) if (q >= 0 && open[q] && !seen[q]) { seen[q] = true; st.Push(q); }
            }
            if (comp.Count > best.Count) best = comp;
        }
        c.BigSize = best.Count; c.Cells = best;
        if (best.Count > 0)
        {
            int i0 = int.MaxValue, i1 = -1, j0 = int.MaxValue, j1 = -1; double su = 0, sv = 0;
            foreach (int k in best) { int ki = k % nu, kj = k / nu; i0 = Math.Min(i0, ki); i1 = Math.Max(i1, ki); j0 = Math.Min(j0, kj); j1 = Math.Max(j1, kj); su += L.U0 + (ki + 0.5f) * L.P; sv += L.V0 + (kj + 0.5f) * L.P; }
            c.BigCols = i1 - i0 + 1; c.BigRows = j1 - j0 + 1; c.BigJ0 = j0; c.BigW = c.BigCols * L.P; c.BigH = c.BigRows * L.P; c.BigU = (float)(su / best.Count); c.BigV = (float)(sv / best.Count);
        }
        return c;
    }

    // asynchronous swept-sphere batch (ShapeTest, 8 in flight, failed requests retried). hit[i]=true means blocked; unresolved counts as blocked.
    bool[] Sweeps(List<Vector3> a, List<Vector3> b, float radius, out int unresolved)
    {
        int n = a.Count; bool[] hit = new bool[n]; int[] tries = new int[n]; unresolved = 0;
        List<int> pending = new List<int>(); for (int i = 0; i < n; i++) pending.Add(i);
        int guard = 0;
        while (pending.Count > 0 && guard++ < 2000)
        {
            int take = Math.Min(8, pending.Count); List<int> cur = pending.GetRange(0, take); pending.RemoveRange(0, take);
            List<ShapeTestHandle> hs = new List<ShapeTestHandle>(); List<int> retry = new List<int>(); bool[] done = new bool[take];
            for (int k = 0; k < take; k++) hs.Add(ShapeTest.StartTestSweptSphere(a[cur[k]], b[cur[k]], radius, (IntersectFlags)17, null, (ShapeTestOptions)0));
            for (int f = 0; f < 30; f++)
            {
                Yield(); bool all = true;
                for (int k = 0; k < take; k++)
                {
                    if (done[k]) continue;
                    if (hs[k].IsRequestFailed) { done[k] = true; retry.Add(cur[k]); continue; }
                    ShapeTestResult r; ShapeTestStatus st = hs[k].GetResult(out r);
                    if (st == ShapeTestStatus.Ready) { done[k] = true; hit[cur[k]] = r.DidHit; }
                    else if (st == ShapeTestStatus.NonExistent) { done[k] = true; retry.Add(cur[k]); }
                    else all = false;
                }
                if (all) break;
            }
            for (int k = 0; k < take; k++) if (!done[k]) retry.Add(cur[k]);
            foreach (int i in retry) { tries[i]++; if (tries[i] < 4) pending.Add(i); else { hit[i] = true; unresolved++; } }
        }
        return hit;
    }

    // horizontal sphere sweeps (r=0.30) at 4 heights; passable lateral window = all heights clear
    void Passable(Lab L, string label, out int clearU, out int totalU, out float longestWindow, out float windowU)
    {
        clearU = 0; totalU = 0; longestWindow = 0f; windowU = float.NaN;
        float[] hs = new float[] { 0.5f, 0.9f, 1.3f, 1.7f };
        int n = Math.Max(1, (int)Math.Floor((L.U1 - L.U0) / 0.25f));
        List<Vector3> A = new List<Vector3>(), B = new List<Vector3>(); List<int> owner = new List<int>();
        for (int i = 0; i < n; i++)
        {
            float u = L.U0 + (i + 0.5f) * 0.25f;
            foreach (float h in hs)
            {
                float v = L.BaseZ + h; if (v > L.V1 + 0.3f) continue;
                A.Add(L.W(L.L(L.T0, u, v))); B.Add(L.W(L.L(L.T1, u, v))); owner.Add(i);
            }
        }
        int unres; bool[] hit = Sweeps(A, B, 0.30f, out unres);
        bool[] ok = new bool[n]; for (int i = 0; i < n; i++) ok[i] = true;
        for (int k = 0; k < hit.Length; k++) if (hit[k]) ok[owner[k]] = false;
        int run = 0, bestRun = 0, bestEnd = -1;
        for (int i = 0; i < n; i++) { totalU++; if (ok[i]) { clearU++; run++; if (run > bestRun) { bestRun = run; bestEnd = i; } } else run = 0; }
        longestWindow = bestRun * 0.25f;
        if (bestRun > 0) windowU = L.U0 + (bestEnd - (bestRun - 1) / 2f + 0.5f) * 0.25f;
        Row("capsule_sweep", "label", label, "radius", 0.30f, "lateralSamples", n, "sweeps", hit.Length, "unresolved", unres, "clearU", clearU, "windowM", longestWindow);
    }

    // ===================================================================== trial (probe / blast)
    // X2 uses X1 probes, debris discovery, transport, and walk lane checks.
    Prop AttachNativeAnchor(Prop wall)
    {
        Model model=new Model("prop_barier_conc_01a");if(!model.Request(5000))throw new Exception("anchor_model_unavailable");
        Prop anchor=World.CreateProp(model,wall.Position,wall.Rotation,true,false);if(anchor==null||!anchor.Exists())throw new Exception("anchor_create_failed");
        owned.Add(anchor);preProps.Add(anchor.Handle);anchor.IsPositionFrozen=true;anchor.IsVisible=false;anchor.IsInvincible=true;
        Function.Call(Hash.SET_ENTITY_COLLISION,anchor.Handle,false,true);
        wall.IsPositionFrozen=false;Function.Call(Hash.SET_ENTITY_DYNAMIC,wall.Handle,true);
        wall.AttachToMatrixPhysically(anchor,Vector3.Zero,Vector3.Zero,Vector3.Zero,1e12f,true,true,false,false);
        Row("native_anchor","model","prop_barier_conc_01a","attached",wall.IsAttachedTo(anchor),"collisionEnabled",false,"frozen",true,"breakForce",1e12f);
        return anchor;
    }
    Vector3[] AnchorFaces(Lab L,out int valid)
    {
        Vector3[] points=new Vector3[20];valid=0;int k=0;
        foreach(float u in new float[]{-1.25f,1.25f})for(int j=0;j<5;j++)for(int direction=0;direction<2;direction++){
            Vector3 a=L.W(L.L(direction==0?-1.5f:1.5f,u,.25f+j*.5f));
            Vector3 b=L.W(L.L(direction==0?1.5f:-1.5f,u,.25f+j*.5f));
            int h=Function.Call<int>(Hash.START_EXPENSIVE_SYNCHRONOUS_SHAPE_TEST_LOS_PROBE,a.X,a.Y,a.Z,b.X,b.Y,b.Z,17,0,0);
            using(OutputArgument hit=new OutputArgument())using(OutputArgument pos=new OutputArgument())using(OutputArgument normal=new OutputArgument())using(OutputArgument entity=new OutputArgument()){
                int status=Function.Call<int>(Hash.GET_SHAPE_TEST_RESULT,h,hit,pos,normal,entity);
                if(status==2&&hit.GetResult<int>()!=0&&entity.GetResult<int>()==L.Wall.Handle){points[k]=pos.GetResult<Vector3>();valid++;}else FaceMiss(L,status,hit.GetResult<int>(),entity.GetResult<int>());
            }
            k++;Yield();
        }
        return points;
    }
    // Actual anchored collision surfaces are the authority; bone API availability is diagnostic only.
    void Anchored(Dictionary<string,string> a)
    {
        PrepareSite();debris.Clear();failedRays=0;unknownRayHits=0;
        string explosive=S(a,"explosive","grenade"),variant=S(a,"variant","physical");
        Lab L=Spawn("lsa_x7_corrugated",variant,SiteSpot(),.25f);Prop wall=L.Wall;
        if(variant=="physical")AttachNativeAnchor(wall);
        PlacePlayerFacing(L,-7,0);
        x2Camera=World.CreateCamera(L.W(L.L(-6,0,2)),Vector3.Zero,50);
        x2Camera.PointAt(L.W(L.L(0,0,1.25f)));World.RenderingCamera=x2Camera;
        Function.Call(Hash.SET_ENTITY_LOD_DIST,wall.Handle,1000);Function.Call(Hash.SET_ENTITY_ALWAYS_PRERENDER,wall.Handle,true);
        Function.Call(Hash.SET_DISABLE_FRAG_DAMAGE,wall.Handle,false);Function.Call(Hash.SET_DISABLE_BREAKING,wall.Handle,false);Function.Call(Hash.SET_ENTITY_CAN_BE_DAMAGED,wall.Handle,true);
        for(int f=0;f<60;f++)Yield();
        Vector3 start=wall.Position,up=wall.UpVector,right=wall.RightVector;int groups=wall.FragmentGroupCount;
        Row("x2_start","isFragment",wall.IsFragmentObject,"groups",groups,"boneCount",wall.Bones.Count,"variant",variant,"explosive",explosive,"scale",F(a,"scale",1),"propCount",World.PropCount,"colliders",World.EntityColliderCount,"assetSha256",ShaOf(Path.Combine(root,"onigiri/dlcpacks/lsa_destruct/dlc.rpf")));
        Grid before=Probe(L);int c0,t0;float w0,u0;Passable(L,"baseline",out c0,out t0,out w0,out u0);
        int valid0;Vector3[] face0=AnchorFaces(L,out valid0);
        Row("x2_baseline","blocked",before.Wall,"cells",before.C.Length,"sweepClearColumns",c0,"sweepColumns",t0,"anchorFaceHits",valid0,"failedRayRequests",failedRays,"mask",Arr(Array.ConvertAll(before.C,x=>x.ToString())));
        Hold("X2 BASELINE",(int)F(a,"hold",0));
        if(before.Wall!=before.C.Length||c0!=0||valid0!=20){Row("x2_verdict","verdict","BASELINE_INVALID");return;}
        float blastU=F(a,"du",0),blastV=F(a,"height",1);
        Vector3 blast=L.W(L.L(-.1f-F(a,"dx",.4f),blastU,blastV));
        int releaseGroup=(int)F(a,"releasegroup",-1);
        Row("x2_pre_detonation","explosive",explosive,"variant",variant,"diagnosticReleaseGroup",releaseGroup);
        if(releaseGroup>=0){
            if(releaseGroup>=groups)throw new Exception("diagnostic_group_out_of_range");
            wall.DetachFragmentPart(releaseGroup);
            Row("x2_native_detach_diagnostic","group",releaseGroup,"acceptanceEligible",false);
        }
        if(explosive!="none")World.AddExplosion(blast,explosive=="rocket"?ExplosionType.Rocket:explosive=="sticky"?ExplosionType.StickyBomb:ExplosionType.Grenade,F(a,"scale",1),0,Game.Player.Character,true,false);
        Row("x2_post_detonation","wallExists",wall.Exists());
        float maxRoot=0,minUp=1,minRight=1;int flagged=0;bool detected=false;
        for(int f=0;f<180;f++){
            Yield();if(!wall.Exists())break;
            maxRoot=Math.Max(maxRoot,wall.Position.DistanceTo(start));minUp=Math.Min(minUp,Vector3.Dot(up,wall.UpVector));minRight=Math.Min(minRight,Vector3.Dot(right,wall.RightVector));
            if(f<12&&Function.Call<bool>(Hash.IS_EXPLOSION_IN_SPHERE,-1,blast.X,blast.Y,blast.Z,5f))detected=true;
            if(f%15==0){RefreshDebris(wall,blast);flagged=Math.Max(flagged,lastFlagged);}
        }
        Grid after=Probe(L);Cmp cmp=Compare(L,before,after,blastU,blastV,1.25f);
        int c,t;float w,u;Passable(L,"debris_present",out c,out t,out w,out u);
        int valid;Vector3[] faces=AnchorFaces(L,out valid);float maxFace=0;
        if(valid==20)for(int k=0;k<20;k++)maxFace=Math.Max(maxFace,faces[k].DistanceTo(face0[k]));else maxFace=-1;
        int outerBlocked=0,outerBaseline=0;
        for(int j=0;j<before.Nv;j++)for(int i=0;i<before.Nu;i++)if(Math.Abs(L.U0+(i+.5f)*L.P)>1.05f&&before.C[j*before.Nu+i]==1){outerBaseline++;if(after.C[j*before.Nu+i]==1)outerBlocked++;}
        bool anchored=wall.Exists()&&valid==20&&maxFace<=.02f&&maxRoot<=.02f&&minUp>=.999f&&minRight>=.999f&&outerBaseline==40&&outerBlocked==40;
        Row("x2_geometry","openedClear",cmp.OpenedClear,"residual",cmp.Residual,"outerBlocked",outerBlocked,"outerBaseline",outerBaseline,"anchorFaceHits",valid,"maxAnchorFaceMoveM",maxFace,"maxRootMoveM",maxRoot,"minUpDot",minUp,"minRightDot",minRight,"anchored",anchored,"flaggedDetached",flagged,"debrisCount",debris.Count,"sweepWindowM",w,"sweepClearColumns",c,"sweepColumns",t,"explosionDetected",detected,"mask",Arr(Array.ConvertAll(after.C,x=>x.ToString())));
        Hold("X2 AFTER BLAST DEBRIS PRESENT",(int)F(a,"hold",0));
        float progress;string walk="skipped";if(explosive!="none"&&!float.IsNaN(u)&&w>=.5f)walk=Walk(L,u,"x2_hole",out progress);
        string control=Walk(L,1.25f,"x2_intact",out progress);bool controlClosed=control=="blocked"||control=="bypassed_edge";
        int finalValid;Vector3[] finalFaces=AnchorFaces(L,out finalValid);float finalFaceMove=0;
        if(finalValid==20)for(int k=0;k<20;k++)finalFaceMove=Math.Max(finalFaceMove,finalFaces[k].DistanceTo(face0[k]));else finalFaceMove=-1;
        float finalRoot=wall.Exists()?wall.Position.DistanceTo(start):-1;
        anchored=anchored&&wall.Exists()&&finalValid==20&&finalFaceMove<=.02f&&finalRoot>=0&&finalRoot<=.02f&&Vector3.Dot(up,wall.UpVector)>=.999f&&Vector3.Dot(right,wall.RightVector)>=.999f;
        Row("x2_final_anchor","anchorFaceHits",finalValid,"maxAnchorFaceMoveM",finalFaceMove,"rootMoveM",finalRoot,"anchored",anchored);
        bool pass=releaseGroup<0&&wall.IsFragmentObject&&groups==31&&anchored&&cmp.OpenedClear>=4&&w>=.6f&&walk=="crossed"&&controlClosed&&flagged>0&&detected;
        string verdict=releaseGroup>=0?"NATIVE_DETACH_DIAGNOSTIC_ONLY":explosive=="none"?(anchored&&cmp.OpenedClear==0&&controlClosed?"CONTROL_CLOSED":"CONTROL_FAILED"):(pass?"LOCAL_ANCHORED_BREACH_CONFIRMED":"NOT_CONFIRMED");
        Row("x2_verdict","verdict",verdict,"walkHole",walk,"walkControl",control,"anchored",anchored,"debrisRetained",true);
    }

    void Trial(string name, string variant, string explosive, Dictionary<string, string> a, string mode)
    {
        if (name.Length == 0) throw new Exception("model= required");
        float dx = F(a, "dx", 0.75f), du = F(a, "du", 0f), dv = F(a, "dv", 0.45f), pitch = F(a, "pitch", 0.25f); int hold = (int)F(a, "hold", 0f); bool walk = F(a, "walk", 1f) > 0.5f;
        string trialId = mode + "-" + name + "-" + variant + "-" + explosive + "-dx" + dx.ToString("0.##", Inv) + "-du" + du.ToString("0.##", Inv);
        PrepareSite(); Vector3 spot = SiteSpot(); debris.Clear();
        step = trialId + " spawn"; Beat();
        Lab L = Spawn(name, variant, spot, pitch);
        Prop wall = L.Wall;
        List<string> boneRows = BoneMap(wall, 64);
        int groups0 = wall.FragmentGroupCount; bool frag0 = wall.IsFragmentObject; int props0 = World.PropCount, col0 = World.EntityColliderCount;
        Row("trial_start", "trial", trialId, "model", name, "variant", variant, "explosive", explosive, "isFragmentObject", frag0, "fragGroups", groups0,
            "thinAxis", L.Thin == 0 ? "x" : "y", "dimU", L.U1 - L.U0, "dimZ", L.V1 - L.V0, "dimT", (L.Thin == 0 ? L.Max.X - L.Min.X : L.Max.Y - L.Min.Y),
            "pitch", L.P, "cells", L.Nu * L.Nv, "propCount", props0, "colliders", col0, "bones", Arr(boneRows));
        float uC = (L.U0 + L.U1) * 0.5f, hgt = L.V1 - L.V0;
        float tFront = (L.Thin == 0 ? L.Min.X : L.Min.Y);
        PlacePlayerFacing(L, tFront - 7f, uC);
        for (int i = 0; i < 20; i++) Yield();
        step = trialId + " baseline"; Beat();
        Grid g0 = Probe(L); int pc0, pt0; float pw0, pu0; Passable(L, "baseline", out pc0, out pt0, out pw0, out pu0);
        float los0 = TriState(LosBetween(L, uC, false));
        Row("measure", "trial", trialId, "label", "baseline", "wall", g0.Wall, "debris", g0.Debris, "other", g0.Other, "clear", g0.Clear, "cells", g0.C.Length,
            "capsuleClearU", pc0, "capsuleTotalU", pt0, "capsuleWindowM", pw0, "losClear", los0, "fragGroups", wall.FragmentGroupCount, "frameMs", Game.LastFrameTime * 1000f);
        if (hold > 0) Hold("BASELINE " + trialId, hold);

        // --- detonate
        float blastU = uC + du, blastV = L.V0 + dv * hgt;
        Vector3 bp = L.W(L.L(tFront - dx, blastU, blastV));
        if (F(a, "enablefrag", 0f) > 0.5f) { try { Function.Call(Hash.SET_DISABLE_FRAG_DAMAGE, wall.Handle, false); } catch (Exception ex) { Row("alt_error", "native", "SET_DISABLE_FRAG_DAMAGE", "message", ex.Message); } }
        try { Row("frag_health", "when", "before", "damageHealth", Function.Call<float>(Hash.GET_OBJECT_FRAGMENT_DAMAGE_HEALTH, wall.Handle, false), "entityHealth", wall.Health); } catch (Exception ex) { Row("alt_error", "native", "GET_OBJECT_FRAGMENT_DAMAGE_HEALTH", "message", ex.Message); }
        bool detected = false; int detectFrame = -1, frame0 = Game.FrameCount; string ownerOk = "n/a";
        if (explosive != "none")
        {
            step = trialId + " detonate"; Beat();
            ExplosionType et = explosive == "sticky" ? ExplosionType.StickyBomb : explosive == "rocket" ? ExplosionType.Rocket : explosive == "tank" ? ExplosionType.TankShell : ExplosionType.Grenade;
            World.AddExplosion(bp, et, F(a, "scale", 1.0f), 0f, Game.Player.Character, true, false);
            for (int f = 0; f < 12; f++)
            {
                Yield();
                if (!detected && Function.Call<bool>(Hash.IS_EXPLOSION_IN_SPHERE, -1, bp.X, bp.Y, bp.Z, 5.0f)) { detected = true; detectFrame = Game.FrameCount - frame0; }
            }
            ownerOk = detected ? "detected" : "not_detected";
        }
        else for (int f = 0; f < 12; f++) Yield();
        Row("detonation", "trial", trialId, "explosive", explosive, "detected", detected, "detectFrames", detectFrame, "dx", dx, "du", du, "dv", dv);

        // --- re-measure at +1, +5, +30, +120 frames (cumulative from detonation)
        int[] marks = new int[] { 1, 5, 30, 120 }; int done = 12; Grid last = g0; Cmp lastCmp = null;
        foreach (int mark in marks)
        {
            while (done < mark + 12) { Yield(); done++; }
            int dc = RefreshDebris(wall, bp);
            Grid gi = Probe(L); last = gi;
            Cmp ci = Compare(L, g0, gi, blastU, blastV, 3.0f); lastCmp = ci;
            bool brk = SafeBroken(wall);
            Row("measure", "trial", trialId, "label", "+" + mark, "wall", gi.Wall, "debris", gi.Debris, "other", gi.Other, "clear", gi.Clear,
                "openedWall", ci.OpenedWall, "openedClear", ci.OpenedClear, "residual", ci.Residual, "farOpened", ci.FarOpened, "bigCells", ci.BigSize, "bigW", ci.BigW, "bigH", ci.BigH,
                "wallExists", wall.Exists(), "rootMoveM", wall.Exists() ? wall.Position.DistanceTo(L.P0) : -1f, "rootUpDot", wall.Exists() ? Vector3.Dot(wall.UpVector, L.Up) : 0f, "fragGroups", wall.Exists() ? wall.FragmentGroupCount : -1, "hasBeenBroken", brk, "detachedProps", dc, "propCount", World.PropCount, "colliders", World.EntityColliderCount, "frameMs", Game.LastFrameTime * 1000f);
        }
        int detachedFinal = RefreshDebris(wall, bp);
        bool brokenFinal = SafeBroken(wall);
        int groupsFinal = wall.Exists() ? wall.FragmentGroupCount : -1;
        if (hold > 0) Hold("SETTLED " + trialId, hold);

        // --- clear debris, then final geometry
        step = trialId + " debris-clear"; Beat();
        int removed = 0;
        foreach (int h in new List<int>(debris)) { try { Entity d = Entity.FromHandle(h); if (d != null && d.Exists()) { d.MarkAsMissionEntity(); d.Delete(); removed++; } } catch { } }
        for (int i = 0; i < 20; i++) Yield();
        Grid gf = Probe(L); Cmp cf = Compare(L, g0, gf, blastU, blastV, 3.0f);
        int pc, pt; float pw, pu; Passable(L, "final", out pc, out pt, out pw, out pu);
        int smallClear = 0, smallTotal = 0;
        {
            List<Vector3> sa = new List<Vector3>(), sb2 = new List<Vector3>();
            foreach (int k in cf.Cells) { int ki = k % gf.Nu, kj = k / gf.Nu; float uu = L.U0 + (ki + 0.5f) * L.P, vv = L.V0 + (kj + 0.5f) * L.P;
                sa.Add(L.W(L.L(L.T0, uu, vv))); sb2.Add(L.W(L.L(L.T1, uu, vv))); if (sa.Count >= 160) break; }
            int un2; bool[] sh = Sweeps(sa, sb2, 0.08f, out un2); smallTotal = sh.Length; foreach (bool x in sh) if (!x) smallClear++;
        }
        float losAfter = TriState(LosBetween(L, !float.IsNaN(pu) ? pu : (cf.BigSize > 0 ? cf.BigU : uC), true));
        Row("measure", "trial", trialId, "label", "final_debris_cleared", "wall", gf.Wall, "debris", gf.Debris, "other", gf.Other, "clear", gf.Clear,
            "openedWall", cf.OpenedWall, "openedClear", cf.OpenedClear, "residual", cf.Residual, "farOpened", cf.FarOpened, "bigCells", cf.BigSize, "bigW", cf.BigW, "bigH", cf.BigH,
            "smallCapsuleClear", smallClear, "smallCapsuleTotal", smallTotal, "capsuleClearU", pc, "capsuleTotalU", pt, "capsuleWindowM", pw, "losClear", losAfter, "debrisRemoved", removed);

        // --- physical movement: ped through the opening, and a control ped at an intact column
        string walkHole = "skipped", walkCtl = "skipped"; float progHole = float.NaN, progCtl = float.NaN;
        bool holeCandidate = (!float.IsNaN(pu) && pw >= 0.5f) || (cf.BigSize >= 4);
        if (walk && explosive != "none" || (walk && mode == "probe"))
        {
            float uHole = !float.IsNaN(pu) ? pu : cf.BigSize > 0 ? cf.BigU : uC;
            if (holeCandidate) walkHole = Walk(L, uHole, "hole", out progHole);
            float uCtl = ControlColumn(L, uHole, pt, g0);
            walkCtl = Walk(L, uCtl, "control", out progCtl);
        }

        // --- verdict
        bool broke = detachedFinal > 0 || brokenFinal || (groupsFinal >= 0 && groupsFinal < groups0) || !wall.Exists();
        bool rayRemoved = cf.OpenedWall >= 2;
        bool passable = pw >= 0.6f;
        bool crossed = walkHole == "crossed", ctlBlocked = walkCtl != "crossed" && walkCtl != "crossed_climbed";
        string verdict;
        if (mode == "probe") verdict = "CONTROL_NO_BLAST";
        else if (explosive == "none") verdict = (cf.OpenedWall == 0 && !broke) ? "CONTROL_STAYED_CLOSED" : "CONTROL_CHANGED";
        else if (!broke && cf.OpenedWall == 0) verdict = "NO_BREAK";
        else if ((rayRemoved && passable && !crossed && walkHole != "skipped") || (crossed && !passable && cf.OpenedWall > 0)) verdict = "PHANTOM";
        else if (rayRemoved && passable && crossed && ctlBlocked && cf.FarOpened == 0 && cf.BigSize >= 4 && cf.OpenedWall < cf.Closed * 0.9f) verdict = "HOLE_CONFIRMED";
        else if (rayRemoved && cf.Closed > 0 && cf.OpenedWall >= cf.Closed * 0.9f && passable) verdict = "PANEL_REMOVED_ENTIRE";
        else if (broke || cf.OpenedWall > 0) verdict = "BROKEN_NO_OPENING";
        else verdict = "UNKNOWN";
        Row("verdict", "trial", trialId, "verdict", verdict, "T1_broke", broke, "T2_rayCollisionRemoved", rayRemoved, "T2_smallCapsuleClear", smallClear + "/" + smallTotal,
            "T3_passableWindowM", pw, "T3_walkHole", walkHole, "T3_walkControl", walkCtl, "progressHole", progHole, "progressControl", progCtl,
            "detachedProps", detachedFinal, "groupsBefore", groups0, "groupsAfter", groupsFinal, "wallExistsAfter", wall.Exists(), "explosionDetected", detected, "ownerCheck", ownerOk);
        File.AppendAllText(Path.Combine(runDir, "summary.jsonl"), Obj("trial", trialId, "model", name, "variant", variant, "explosive", explosive, "dx", dx, "du", du, "dv", dv, "verdict", verdict, "groups", groups0, "detached", detachedFinal, "openedWall", cf.OpenedWall, "bigW", cf.BigW, "bigH", cf.BigH, "passableWindowM", pw, "walkHole", walkHole, "walkControl", walkCtl, "farOpened", cf.FarOpened, "baselineBlockedCells", g0.Wall + "/" + g0.C.Length) + "\n");
    }

    string Walk(Lab L, float u, string label, out float progress)
    {
        float tFront = (L.Thin == 0 ? L.Min.X : L.Min.Y), tBack = (L.Thin == 0 ? L.Max.X : L.Max.Y);
        Vector3 start = L.W(L.L(tFront - 2.2f, u, L.BaseZ + 0.05f));
        Vector3 goal = L.W(L.L(tBack + 2.2f, u, L.BaseZ + 0.05f));
        progress = float.NaN;
        Model m = new Model(PedModelName); if (!m.Request(5000)) return "ped_model_failed";
        Ped ped = World.CreatePed(m, start, 0f); if (ped == null || !ped.Exists()) return "ped_create_failed";
        owned.Add(ped); ped.IsInvincible = true; ped.BlockPermanentEvents = true;
        Function.Call(Hash.SET_PED_STEERS_AROUND_OBJECTS,ped.Handle,false);Function.Call(Hash.SET_PED_STEERS_AROUND_PEDS,ped.Handle,false);Function.Call(Hash.SET_PED_STEERS_AROUND_VEHICLES,ped.Handle,false);
        Vector3 dir = (goal - start); dir.Z = 0f; dir.Normalize(); ped.Heading = (float)(Math.Atan2(-dir.X, dir.Y) * 180.0 / Math.PI);
        for (int i = 0; i < 10; i++) Yield();
        Function.Call(Hash.TASK_GO_STRAIGHT_TO_COORD, ped.Handle, goal.X, goal.Y, goal.Z, 1.0f, 9000, ped.Heading, 0.5f);
        long t0 = clock.ElapsedMilliseconds; bool crossed = false; float maxT = -99f; float zStart = ped.Position.Z, zMax = zStart; float maxLateral = 0f; float crossingU=float.NaN,prevT=tFront-2.2f,prevU=u;
        while (clock.ElapsedMilliseconds - t0 < 9500)
        {
            Yield(); Beat();
            Vector3 lp = L.Inv(ped.Position); float t = L.Thin == 0 ? lp.X : lp.Y; maxT = Math.Max(maxT, t); zMax = Math.Max(zMax, ped.Position.Z);
            float lateral = Math.Abs((L.Thin == 0 ? lp.Y : lp.X) - u); maxLateral = Math.Max(maxLateral, lateral);
            float currentU=L.Thin==0?lp.Y:lp.X;if(float.IsNaN(crossingU)&&prevT<0&&t>=0)crossingU=prevU+(currentU-prevU)*(-prevT)/(t-prevT);prevT=t;prevU=currentU;
            if (t > tBack + 0.6f) { crossed = true; break; }
        }
        progress = maxT - tFront;
        float zGain = zMax - zStart; bool climbed = crossed && zGain > 0.35f;
        Row("walk", "label", label, "u", u, "crossed", crossed, "climbedOver", climbed, "crossingU",crossingU,"outsideWallFootprint",!float.IsNaN(crossingU)&&(crossingU<L.U0||crossingU>L.U1),"maxLateralM", maxLateral, "zGainM", zGain, "progressFromFrontM", progress, "wallThicknessM", tBack - tFront, "wallHeightM", L.V1 - L.V0, "ms", clock.ElapsedMilliseconds - t0);
        try { ped.Delete(); } catch { } owned.Remove(ped);
        return crossed && !float.IsNaN(crossingU) && (crossingU<L.U0||crossingU>L.U1) ? "bypassed_edge" : crossed ? (maxLateral > 0.6f ? "crossed_off_lane" : climbed ? "crossed_climbed" : "crossed") : "blocked";
    }

    float ControlColumn(Lab L, float uHole, int totalU, Grid g0)
    {
        // an intact column of the same wall >= 1.5 m from the hole centre, chosen from baseline-solid columns
        float best = L.U0 + 0.3f; float bestD = -1f;
        for (int i = 0; i < g0.Nu; i++)
        {
            float u = L.U0 + (i + 0.5f) * L.P; int solid = 0; for (int j = 0; j < g0.Nv; j++) if (g0.At(i, j) == 1) solid++;
            if (solid < g0.Nv * 0.8f) continue; float d = Math.Abs(u - uHole);
            if (d >= 1.5f && (bestD < 0 || d < bestD)) { bestD = d; best = u; }
        }
        return best;
    }

    // lab peds on both sides, LOS test (flags 17). peds are deleted straight after.
    bool? LosBetween(Lab L, float u, bool afterBlast)
    {
        try
        {
            float tFront = (L.Thin == 0 ? L.Min.X : L.Min.Y), tBack = (L.Thin == 0 ? L.Max.X : L.Max.Y);
            Model m = new Model(PedModelName); if (!m.Request(4000)) return null;
            Vector3 a = L.W(L.L(tFront - 3f, u, L.BaseZ + 0.05f)), b = L.W(L.L(tBack + 3f, u, L.BaseZ + 0.05f));
            Ped pa = World.CreatePed(m, a, 0f), pb = World.CreatePed(m, b, 0f); if (pa == null || pb == null) return null;
            owned.Add(pa); owned.Add(pb);
            foreach (Ped p in new Ped[] { pa, pb }) { p.IsInvincible = true; p.BlockPermanentEvents = true; p.IsPositionFrozen = true; }
            for (int i = 0; i < 6; i++) Yield();
            bool los = pa.HasClearLineOfSightTo(pb, (IntersectFlags)17);
            try { pa.Delete(); pb.Delete(); } catch { } owned.Remove(pa); owned.Remove(pb);
            return los;
        }
        catch { return null; }
    }

    // ===================================================================== line of N panels: does the blast open a gap while neighbours stay intact?
    void Line(string name, string variant, int n, string explosive, Dictionary<string, string> a)
    {
        if (name.Length == 0) throw new Exception("model= required");
        float dx = F(a, "dx", 0.4f), dv = F(a, "dv", 0.45f), gap = F(a, "gap", 0.05f), pitch = F(a, "pitch", 0.25f); int hold = (int)F(a, "hold", 0f); bool walk = F(a, "walk", 1f) > 0.5f;
        int target = (int)F(a, "target", (n - 1) / 2f); float scale = F(a, "scale", 1f);
        string trialId = "line" + n + "-" + name + "-" + variant + "-" + explosive + "-t" + target;
        PrepareSite(); Vector3 spot = SiteSpot(); debris.Clear();
        Lab probeLab = Spawn(name, variant, spot, pitch); float width = probeLab.U1 - probeLab.U0; int thin = probeLab.Thin;
        try { probeLab.Wall.Delete(); } catch { } owned.Remove(probeLab.Wall); for (int i = 0; i < 6; i++) Yield();
        Vector3 uDir = thin == 0 ? new Vector3(0f, 1f, 0f) : new Vector3(1f, 0f, 0f);
        List<Lab> labs = new List<Lab>(); List<Grid> g0 = new List<Grid>();
        for (int i = 0; i < n; i++)
        {
            Vector3 sp = spot + uDir * ((i - (n - 1) / 2f) * (width + gap));
            Lab Li = Spawn(name, variant, GroundAt(sp), pitch); labs.Add(Li);
        }
        preProps.Clear(); try { foreach (Prop q in World.GetNearbyProps(spot, 30f)) if (q != null && q.Exists()) preProps.Add(q.Handle); } catch { }
        Row("line_start", "trial", trialId, "model", name, "variant", variant, "panels", n, "panelWidthM", width, "targetPanel", target, "explosive", explosive, "fragGroupsEach", labs[0].Wall.FragmentGroupCount);
        Lab mid = labs[Math.Max(0, Math.Min(n - 1, target))]; float tFront = thin == 0 ? mid.Min.X : mid.Min.Y; float uC = (mid.U0 + mid.U1) * 0.5f;
        PlacePlayerFacing(labs[(n - 1) / 2], tFront - 9f, (labs[(n - 1) / 2].U0 + labs[(n - 1) / 2].U1) * 0.5f);
        for (int i = 0; i < 25; i++) Yield();
        for (int i = 0; i < n; i++) { g0.Add(Probe(labs[i])); Row("line_baseline", "panel", i, "blockedCells", g0[i].Wall, "cells", g0[i].C.Length); }
        if (hold > 0) Hold("LINE-BASELINE", hold);
        if (explosive != "none")
        {
            Vector3 bp = mid.W(mid.L(tFront - dx, uC, mid.V0 + dv * (mid.V1 - mid.V0)));
            ExplosionType et = explosive == "sticky" ? ExplosionType.StickyBomb : explosive == "rocket" ? ExplosionType.Rocket : explosive == "tank" ? ExplosionType.TankShell : ExplosionType.Grenade;
            World.AddExplosion(bp, et, scale, 0f, Game.Player.Character, true, false);
            bool det = false; for (int f = 0; f < 150; f++) { Yield(); if (!det && Function.Call<bool>(Hash.IS_EXPLOSION_IN_SPHERE, -1, bp.X, bp.Y, bp.Z, 6.0f)) { det = true; Row("detonation", "trial", trialId, "detected", true, "detectFrames", f + 1); } }
        }
        else for (int f = 0; f < 150; f++) Yield();
        RefreshDebris(labs[0].Wall, spot);
        if (hold > 0) Hold("LINE-AFTER-DEBRIS-PRESENT", hold);
        bool clearDebris = F(a, "cleardebris", 0f) > 0.5f;
        Row("line_debris_policy", "clearedBeforeMeasurements", clearDebris, "detectedDebris", debris.Count);
        if (clearDebris) foreach (int h in new List<int>(debris)) { try { Entity d = Entity.FromHandle(h); if (d != null && d.Exists()) { d.MarkAsMissionEntity(); d.Delete(); } } catch { } }
        for (int i = 0; i < 20; i++) Yield();
        List<float> frac = new List<float>(); List<float> win = new List<float>(); List<float> winU = new List<float>();
        for (int i = 0; i < n; i++)
        {
            Grid gi = Probe(labs[i]); Cmp ci = Compare(labs[i], g0[i], gi, 0f, 0f, 9999f);
            int pc, pt; float pw, pu; Passable(labs[i], "line-panel" + i, out pc, out pt, out pw, out pu);
            float fr = ci.Closed > 0 ? (float)ci.OpenedClear / ci.Closed : 0f; frac.Add(fr); win.Add(pw); winU.Add(pu);
            Row("line_panel", "trial", trialId, "panel", i, "openedFraction", fr, "openedCells", ci.OpenedClear, "rootCollisionRemovedCells", ci.OpenedWall, "residualCells", ci.Residual, "closedBaseline", ci.Closed, "bigW", ci.BigW, "bigH", ci.BigH, "capsuleWindowM", pw, "wallCellsNow", gi.Wall, "rootExists", labs[i].Wall.Exists(), "rootMoveM", labs[i].Wall.Exists() ? labs[i].Wall.Position.DistanceTo(labs[i].P0) : -1f);
        }
        if (hold > 0) Hold("LINE-AFTER-CLEARED", hold);
        string walkHole = "skipped", walkCtl = "skipped"; float ph = float.NaN, pc2 = float.NaN; int holeIdx = -1, ctlIdx = -1;
        for (int i = 0; i < n; i++) { if (holeIdx < 0 && frac[i] >= 0.9f && win[i] >= 0.6f) holeIdx = i; if (ctlIdx < 0 && frac[i] <= 0.1f) ctlIdx = i; }
        if (walk && holeIdx >= 0) walkHole = Walk(labs[holeIdx], !float.IsNaN(winU[holeIdx]) ? winU[holeIdx] : (labs[holeIdx].U0 + labs[holeIdx].U1) * 0.5f, "hole-panel" + holeIdx, out ph);
        if (walk && ctlIdx >= 0) walkCtl = Walk(labs[ctlIdx], (labs[ctlIdx].U0 + labs[ctlIdx].U1) * 0.5f, "control-panel" + ctlIdx, out pc2);
        int brokenPanels = 0, intactPanels = 0; for (int i = 0; i < n; i++) { if (frac[i] >= 0.9f) brokenPanels++; else if (frac[i] <= 0.1f) intactPanels++; }
        bool gapOk = brokenPanels >= 1 && intactPanels >= 1 && walkHole == "crossed" && walkCtl == "blocked";
        string verdict = explosive == "none" ? (brokenPanels == 0 ? "CONTROL_STAYED_CLOSED" : "CONTROL_CHANGED") : gapOk ? "GAP_IN_WALL_CONFIRMED" : (brokenPanels >= 1 && intactPanels == 0) ? "ALL_PANELS_REMOVED" : (brokenPanels >= 1) ? "GAP_PARTIAL_UNVERIFIED_WALK" : "NO_BREAK";
        Row("verdict", "trial", trialId, "verdict", verdict, "brokenPanels", brokenPanels, "intactPanels", intactPanels, "walkHole", walkHole, "walkControl", walkCtl, "holePanel", holeIdx, "controlPanel", ctlIdx, "progressHole", ph, "progressControl", pc2);
        List<string> fr2 = new List<string>(); for (int i = 0; i < n; i++) fr2.Add(frac[i].ToString("0.00", Inv));
        File.AppendAllText(Path.Combine(runDir, "summary.jsonl"), Obj("trial", trialId, "model", name, "variant", variant, "explosive", explosive, "verdict", verdict, "panels", n, "brokenPanels", brokenPanels, "intactPanels", intactPanels, "openedFractions", string.Join(",", fr2.ToArray()), "walkHole", walkHole, "walkControl", walkCtl) + "\n");
    }

    // ===================================================================== scripted detach control
    void Detach(string name, string variant, string mode, Dictionary<string, string> a)
    {
        if (name.Length == 0) throw new Exception("model= required");
        float pitch = F(a, "pitch", 0.5f); int max = (int)F(a, "max", 24f); float r = F(a, "r", 1.3f);
        PrepareSite(); Vector3 spot = SiteSpot(); debris.Clear();
        Lab L = Spawn(name, variant, spot, pitch); Prop wall = L.Wall;
        int groups0 = wall.FragmentGroupCount; List<string> bm = BoneMap(wall, 128);
        Row("detach_start", "model", name, "variant", variant, "mode", mode, "isFragmentObject", wall.IsFragmentObject, "fragGroups", groups0, "bones", Arr(bm));
        PlacePlayerFacing(L, (L.Thin == 0 ? L.Min.X : L.Min.Y) - 7f, (L.U0 + L.U1) * 0.5f);
        Grid g0 = Probe(L);
        Row("measure", "label", "baseline", "wall", g0.Wall, "clear", g0.Clear, "cells", g0.C.Length, "fragGroups", groups0);
        if (mode == "each")
        {
            int stride = Math.Max(1, groups0 / Math.Max(1, max));
            for (int g = 0; g < groups0 && !abortRequested; g += stride)
            {
                step = "detach group " + g + "/" + groups0; Beat();
                if (g > 0) { CleanupAll(); debris.Clear(); L = Spawn(name, variant, spot, pitch); wall = L.Wall; for (int i = 0; i < 20; i++) Yield(); }
                int gBefore = wall.FragmentGroupCount; bool threw = false;
                try { wall.DetachFragmentPart(g); } catch (Exception ex) { threw = true; Row("detach_error", "group", g, "message", ex.Message); }
                for (int i = 0; i < 40; i++) Yield();
                if (RefreshDebris(wall, wall.Position) == 0 && F(a, "alt", 0f) > 0.5f)
                {
                    try { Function.Call(Hash.BREAK_OBJECT_FRAGMENT_CHILD, wall.Handle, g, false); } catch (Exception ex) { Row("alt_error", "native", "BREAK_OBJECT_FRAGMENT_CHILD", "message", ex.Message); }
                    for (int i = 0; i < 20; i++) Yield();
                    if (RefreshDebris(wall, wall.Position) == 0) { try { Function.Call(Hash.DAMAGE_OBJECT_FRAGMENT_CHILD, wall.Handle, g, 100000f); } catch (Exception ex) { Row("alt_error", "native", "DAMAGE_OBJECT_FRAGMENT_CHILD", "message", ex.Message); } for (int i = 0; i < 20; i++) Yield(); }
                }
                int dc = RefreshDebris(wall, wall.Position); Grid gi = Probe(L); Cmp ci = Compare(L, g0, gi, 0f, 0f, 9999f);
                Row("detach_group", "group", g, "threw", threw, "groupsBefore", gBefore, "groupsAfter", wall.Exists() ? wall.FragmentGroupCount : -1, "detachedProps", dc, "wallExists", wall.Exists(),
                    "openedWall", ci.OpenedWall, "openedClear", ci.OpenedClear, "residual", ci.Residual, "bigCells", ci.BigSize, "bigW", ci.BigW, "bigH", ci.BigH, "wallCells", gi.Wall, "baselineWallCells", g0.Wall);
            }
        }
        else // cluster: detach every group whose bone lies within r metres of a point at wall centre / 0.45 height
        {
            float uC = (L.U0 + L.U1) * 0.5f, vC = L.V0 + 0.45f * (L.V1 - L.V0);
            float tc = ((L.Thin == 0 ? L.Min.X : L.Min.Y) + (L.Thin == 0 ? L.Max.X : L.Max.Y)) * 0.5f;
            Vector3 centre = L.W(L.L(tc, uC, vC));
            List<int> picks = GroupsNear(wall, centre, r);
            Row("detach_cluster_plan", "centre", "wall-centre", "radius", r, "groups", Arr(picks));
            if (F(a, "hold", 0f) > 0f) Hold("CLUSTER-BEFORE", (int)F(a, "hold", 0f));
            foreach (int g in picks) { try { wall.DetachFragmentPart(g); } catch (Exception ex) { Row("detach_error", "group", g, "message", ex.Message); } if (F(a, "alt", 0f) > 0.5f) { try { Function.Call(Hash.BREAK_OBJECT_FRAGMENT_CHILD, wall.Handle, g, false); } catch { } } }
            for (int i = 0; i < 90; i++) Yield();
            int dc = RefreshDebris(wall, centre);
            Row("cluster_after_detach", "newProps", lastNewProps, "flaggedDetached", lastFlagged);
            if (F(a, "hold", 0f) > 0f) Hold("CLUSTER-AFTER", (int)F(a, "hold", 0f));
            foreach (int h in new List<int>(debris)) { try { Entity d = Entity.FromHandle(h); if (d != null && d.Exists()) { d.MarkAsMissionEntity(); d.Delete(); } } catch { } }
            for (int i = 0; i < 20; i++) Yield();
            Grid gi = Probe(L); Cmp ci = Compare(L, g0, gi, uC, vC, 9999f);
            int pc, pt; float pw, pu; Passable(L, "cluster", out pc, out pt, out pw, out pu);
            float uh = !float.IsNaN(pu) ? pu : (ci.BigSize > 0 ? ci.BigU : uC); float prog; string wk = ci.BigSize >= 4 ? Walk(L, uh, "cluster-hole", out prog) : "skipped";
            Row("detach_cluster", "detachedProps", dc, "groupsAfter", wall.Exists() ? wall.FragmentGroupCount : -1, "openedWall", ci.OpenedWall, "openedClear", ci.OpenedClear, "bigCells", ci.BigSize, "bigW", ci.BigW, "bigH", ci.BigH,
                "capsuleWindowM", pw, "walk", wk, "baselineWallCells", g0.Wall, "wallCellsAfter", gi.Wall);
        }
    }

    List<int> GroupsNear(Prop wall, Vector3 centre, float r)
    {
        List<int> res = new List<int>(); HashSet<int> seen = new HashSet<int>();
        try { for (int i = 0; i < wall.Bones.Count; i++) { EntityBone b = wall.Bones[i]; int g = b.FragmentGroupIndex; if (g < 0 || seen.Contains(g)) continue; if (b.Position.DistanceTo(centre) <= r) { seen.Add(g); res.Add(g); } } } catch { }
        return res;
    }

    List<string> BoneMap(Prop wall, int cap)
    {
        List<string> o = new List<string>();
        try
        {
            int n = wall.Bones.Count;
            for (int i = 0; i < n && o.Count < cap; i++)
            {
                EntityBone b = wall.Bones[i]; Vector3 lp = wall.GetPositionOffset(b.Position);
                o.Add(Obj("bone", i, "group", b.FragmentGroupIndex, "lx", lp.X, "ly", lp.Y, "lz", lp.Z));
            }
        }
        catch (Exception ex) { o.Add(Obj("boneMapError", ex.Message)); }
        return o;
    }

    // ===================================================================== world / player helpers
    int lastNewProps, lastFlagged;
    // debris = props near the wall that either carry SHVDN's "detached from parent == wall" flag or are simply new since spawn
    int RefreshDebris(Prop wall, Vector3 around)
    {
        int n = 0; lastNewProps = 0; lastFlagged = 0;
        try
        {
            foreach (Prop p in World.GetNearbyProps(around, 16f))
            {
                if (p == null || !p.Exists() || p.Handle == wall.Handle) continue;
                bool fromWall = false;
                try { fromWall = p.HasBeenDetachedFromParentEntity && p.ParentEntityDetachedFrom != null && p.ParentEntityDetachedFrom.Handle == wall.Handle; } catch { }
                bool isNew = !preProps.Contains(p.Handle);
                if (fromWall) lastFlagged++;
                if (isNew) lastNewProps++;
                if (fromWall || isNew) { if (debris.Add(p.Handle)) { Row("debris_prop", "hash", (uint)p.Model.Hash, "flaggedDetached", fromWall, "isFragmentObject", p.IsFragmentObject, "groups", p.FragmentGroupCount, "dist", p.Position.DistanceTo(wall.Exists() ? wall.Position : around)); } }
                if (fromWall || isNew) n++;
            }
        }
        catch { }
        return n;
    }

    bool SafeBroken(Prop wall) { try { return wall.Exists() && Function.Call<bool>(Hash.HAS_OBJECT_BEEN_BROKEN, wall.Handle, 0); } catch { return false; } }

    void PrepareSite()
    {
        Ped pl = Game.Player.Character;
        if (!teleported) { originPos = pl.Position; originHeading = pl.Heading; teleported = true; savedInvincible = Game.Player.IsInvincible; savedMaxWanted = Function.Call<int>(Hash.GET_MAX_WANTED_LEVEL); }
        Game.Player.IsInvincible = true;
        Function.Call(Hash.SET_MAX_WANTED_LEVEL, 0); Game.Player.WantedLevel = 0;
    }

    static readonly float[][] SiteCandidates = new float[][] {
        new float[] { 1717f, 3256f, 41.2f }, new float[] { 2130f, 4790f, 41.1f }, new float[] { -1337f, -2278f, 13.9f },
        new float[] { 1450f, 3150f, 40.5f }, new float[] { 2300f, 3700f, 36f }, new float[] { -1050f, -2950f, 13.95f } };
    Vector3? cachedSite; string siteNote = "";

    // Test spot: site.txt "x y z" if present; else first flat, roofless, empty candidate patch (teleport + collision gate);
    // else 22 m in front of the player's own position. Player is returned to the origin at the end of the batch.
    Vector3 SiteSpot()
    {
        Ped pl = Game.Player.Character;
        if (cachedSite.HasValue) { pl.Position = cachedSite.Value + new Vector3(0f, -12f, 1.5f); WaitCollision(pl); return GroundAt(cachedSite.Value); }
        string sf = Path.Combine(lab, "site.txt");
        if (File.Exists(sf))
        {
            string[] t = File.ReadAllText(sf).Trim().Split(new char[] { ' ', ',', ';' }, StringSplitOptions.RemoveEmptyEntries);
            if (t.Length >= 3) { Vector3 b = new Vector3(float.Parse(t[0], Inv), float.Parse(t[1], Inv), float.Parse(t[2], Inv)); pl.Position = b + new Vector3(0f, -12f, 1.5f); WaitCollision(pl); cachedSite = b; siteNote = "site.txt"; Row("site", "mode", "site.txt"); return GroundAt(b); }
        }
        foreach (float[] c in SiteCandidates)
        {
            if (abortRequested) break;
            Vector3 b = new Vector3(c[0], c[1], c[2]); step = "site probe " + c[0] + "," + c[1]; Beat();
            pl.Position = b + new Vector3(0f, 0f, 1.5f); WaitCollision(pl);
            Vector3 centre = pl.Position; float zmin = 9999f, zmax = -9999f; int bad = 0, n = 0;
            for (int ix = -7; ix <= 7; ix++) for (int iy = -7; iy <= 7; iy++)
            {
                Vector3 q = centre + new Vector3(ix * 2f, iy * 2f, 2.5f);
                RaycastResult r = World.Raycast(q, q - new Vector3(0, 0, 8f), (IntersectFlags)1, null); n++;
                if (!r.DidHit) { bad++; continue; }
                zmin = Math.Min(zmin, r.HitPosition.Z); zmax = Math.Max(zmax, r.HitPosition.Z);
                RaycastResult up = World.Raycast(r.HitPosition + new Vector3(0, 0, 0.3f), r.HitPosition + new Vector3(0, 0, 6f), (IntersectFlags)(1 | 16), null);
                if (up.DidHit) bad++;
                if ((n & 31) == 0) Yield();
            }
            int peds = World.GetNearbyPeds(centre, 30f).Length, vehs = World.GetNearbyVehicles(centre, 40f).Length;
            Row("site_candidate", "x", c[0], "y", c[1], "samples", n, "bad", bad, "zRange", zmax - zmin, "nearbyPeds", peds, "nearbyVehicles", vehs);
            if (bad == 0 && zmax - zmin <= 0.3f && peds <= 1 && vehs == 0) { cachedSite = new Vector3(centre.X, centre.Y, (zmin + zmax) * 0.5f); siteNote = "auto"; Row("site", "mode", "auto-flat-patch"); return GroundAt(cachedSite.Value); }
        }
        Row("site", "mode", "fallback-in-front-of-player-origin");
        pl.Position = originPos; WaitCollision(pl);
        Vector3 spot = originPos + pl.ForwardVector * 22f;
        return GroundAt(spot);
    }

    Vector3 GroundAt(Vector3 spot)
    {
        RaycastResult r = World.Raycast(spot + new Vector3(0, 0, 3f), spot - new Vector3(0, 0, 8f), (IntersectFlags)1, null);
        return r.DidHit ? r.HitPosition : spot;
    }

    void WaitCollision(Ped pl)
    {
        pl.IsPositionFrozen = true; int good = 0; long t0 = clock.ElapsedMilliseconds;
        while (clock.ElapsedMilliseconds - t0 < 20000 && good < 50)
        {
            Function.Call(Hash.REQUEST_COLLISION_AT_COORD, pl.Position.X, pl.Position.Y, pl.Position.Z);
            Yield(); Beat();
            if (Function.Call<bool>(Hash.HAS_COLLISION_LOADED_AROUND_ENTITY, pl.Handle)) good++; else good = 0;
        }
        pl.IsPositionFrozen = false;
    }

    void PlacePlayerFacing(Lab L, float tFront, float u)
    {
        Ped pl = Game.Player.Character;
        Vector3 p = L.W(L.L(tFront, u, L.BaseZ + 0.05f));
        RaycastResult r = World.Raycast(p + new Vector3(0, 0, 3f), p - new Vector3(0, 0, 6f), (IntersectFlags)1, null);
        if (r.DidHit) p = r.HitPosition + new Vector3(0, 0, 0.05f);
        pl.Position = p;
        Vector3 d = L.W(L.L((L.Thin == 0 ? L.Min.X : L.Min.Y), u, L.BaseZ)) - p; d.Z = 0f; d.Normalize();
        pl.Heading = (float)(Math.Atan2(-d.X, d.Y) * 180.0 / Math.PI);
        // X4-0.3: GameplayCamera.RelativeHeading/RelativePitch removed - the SHVDN Enhanced camera setters terminate the game a few frames after a player teleport.
    }

    void RestorePlayer()
    {
        if (!teleported) return;
        teleported = false;
        Ped pl = Game.Player.Character;
        try { pl.IsPositionFrozen = false; if (pl.Position.DistanceTo(originPos) > 1f) { pl.Position = originPos; pl.Heading = originHeading; } } catch { }
        try { Game.Player.IsInvincible = savedInvincible; } catch { }
        try { if (savedMaxWanted >= 0) Function.Call(Hash.SET_MAX_WANTED_LEVEL, savedMaxWanted); } catch { }
    }

    void CleanupAll()
    {
        if(x2Camera!=null){World.RenderingCamera=null;x2Camera.Delete();x2Camera=null;}
        CleanupDebris();
        foreach (Entity e in new List<Entity>(owned)) { try { if (e != null && e.Exists()) e.Delete(); } catch { } }
        owned.Clear();
    }

    void Hold(string label, int secs)
    {
        state = "HOLD"; step = label; Beat(true);
        long t0 = clock.ElapsedMilliseconds;
        while (clock.ElapsedMilliseconds - t0 < secs * 1000L) { Wait(250); Beat(); }
        state = "RUNNING";
    }

    // ===================================================================== X3 additions (superset of the frozen X2 driver)
    // New verbs: x3idle, x3perf, x3breach, x3multi, x3player. All X2 verbs keep their original behaviour.
    // Principles: initial collision/traversal measurements are always taken with native debris untouched; debris
    // management is applied only afterwards, labelled as a separate phase, and only ever deletes/freezes props that
    // carry native "detached from this wall" evidence. Frame times are sampled in windows that contain no shape tests.
    const string AssetModel = "lsa_x7a_ctl";
    static readonly string[] AllowedModels = new string[] { "lsa_x7a_ctl", "lsa_x7a_sx", "lsa_x7a_hx", "lsa_x7a_j300", "lsa_x7a_j550", "lsa_x7a_j1000", "lsa_x7a_j1800", "lsa_x7a_j3200", "lsa_x7a_j5600", "lsa_x7a_j10000", "lsa_x7a_j1000f", "lsa_x7a_j3200f" };
    string x7Model = AssetModel;
    // Pack-specific allowlist beside the script; never read during the one-tick commit.
    bool X7InPackManifest(string model)
    {
        string path = Path.Combine(root, "scripts-x7", "x7-models.txt");
        if (!File.Exists(path)) return false;
        foreach (string line in File.ReadAllLines(path))
            if (string.Equals(line.Trim(), model, StringComparison.Ordinal)) return true;
        return false;
    }

    readonly Dictionary<int, int> debrisOwner = new Dictionary<int, int>();
    readonly HashSet<int> flaggedSet = new HashSet<int>();
    readonly HashSet<int> strayNew = new HashSet<int>();
    readonly HashSet<int> labHandles = new HashSet<int>();
    readonly Dictionary<string, int> otherKinds = new Dictionary<string, int>();
    int foreignHits, otherLogged;
    StreamWriter frameLog; string trialLabel = "";
    long beatMs = 800; double poolFracMax; bool stallSeen;

    sealed class WallBase { public Grid G; public int ClearC, TotalC, FaceValid; public float W, U; public Vector3[] Face0; public bool Valid; }
    sealed class Meas
    {
        public Grid G; public Cmp C; public int ClearC, TotalC, FaceValid, OuterBlocked, OuterBaseline; public float W, U, MaxFace, RootMove, UpDot, RightDot;
        public Vector3[] Faces; public bool Anchored;
    }
    sealed class Region { public bool Valid; public float U0, U1, V0, V1; }
    sealed class FS { public int N; public double Mean, P50, P95, P99, Max, GameMean; public int O33, O50, O100; }
    sealed class Cand { public int H; public Lab L; public float Score, Speed; public bool InRegion; }

    static ExplosionType ExplType(string s) { return s == "rocket" ? ExplosionType.Rocket : s == "sticky" ? ExplosionType.StickyBomb : ExplosionType.Grenade; }
    static string MaskStr(Grid g) { char[] c = new char[g.C.Length]; for (int i = 0; i < c.Length; i++) c[i] = (char)('0' + g.C[i]); return new string(c); }
    static List<int> ParseList(string s)
    {
        List<int> r = new List<int>(); if (s == null || s == "none" || s.Length == 0) return r;
        foreach (string p in s.Split(new char[] { ';', ',' }, StringSplitOptions.RemoveEmptyEntries)) { int v; if (int.TryParse(p, NumberStyles.Integer, Inv, out v)) r.Add(v); }
        return r;
    }
    static double Pct(List<float> sorted, double p)
    {
        int n = sorted.Count; if (n == 0) return 0; int k = (int)Math.Ceiling(p * n) - 1; if (k < 0) k = 0; if (k >= n) k = n - 1; return sorted[k];
    }

    void ResetX3()
    {
        debris.Clear(); debrisOwner.Clear(); flaggedSet.Clear(); strayNew.Clear(); labHandles.Clear(); otherKinds.Clear();
        cleanupDeletedOwned = 0; cleanupSkippedAmbient = 0; foreignHits = 0; otherLogged = 0; failedRays = 0; unknownRayHits = 0; poolFracMax = 0; stallSeen = false;
    }

    // ---- pools -------------------------------------------------------------------------------------------------
    Raw PoolsRaw()
    {
        try
        {
            return new Raw(Obj("props", World.PropCount, "propCap", World.PropCapacity, "colliders", World.EntityColliderCount, "colliderCap", World.EntityColliderCapacity,
                "peds", World.PedCount, "pedCap", World.PedCapacity, "vehicles", World.VehicleCount, "vehicleCap", World.VehicleCapacity,
                "projectiles", World.ProjectileCount, "pickups", World.PickupObjectCount));
        }
        catch (Exception ex) { return new Raw(Obj("error", ex.Message)); }
    }
    double PoolFrac()
    {
        double a = 0;
        try
        {
            if (World.PropCapacity > 0) a = Math.Max(a, (double)World.PropCount / World.PropCapacity);
            if (World.EntityColliderCapacity > 0) a = Math.Max(a, (double)World.EntityColliderCount / World.EntityColliderCapacity);
        }
        catch { }
        return a;
    }
    void PoolRow(string label)
    {
        double f = PoolFrac(); if (f > poolFracMax) poolFracMax = f;
        Row("x3_pools", "trial", trialLabel, "label", label, "pools", PoolsRaw(), "fraction", f);
        if (f > 0.5) { Row("safety_stop", "trial", trialLabel, "reason", "pool_fraction_over_0.5", "fraction", f); abortRequested = true; }
    }

    // ---- frame sampling ------------------------------------------------------------------------------------------
    FS Sample(string label, int frames, Action first) { return SampleCore(label, frames, 0, first, null); }
    FS SampleCore(string label, int maxFrames, long maxMs, Action first, Action<int> perFrame)
    {
        List<float> dt = new List<float>(), gd = new List<float>();
        long saveBeat = beatMs; beatMs = 4000;
        long t0 = clock.ElapsedMilliseconds;
        long last = Stopwatch.GetTimestamp();
        if (first != null) first();
        for (int i = 0; i < maxFrames; i++)
        {
            Yield();
            long now = Stopwatch.GetTimestamp();
            dt.Add((float)((now - last) * 1000.0 / Stopwatch.Frequency)); last = now;
            gd.Add(Game.LastFrameTime * 1000f);
            if (perFrame != null) perFrame(i);
            Beat();
            if (abortRequested) break;
            if (maxMs > 0 && clock.ElapsedMilliseconds - t0 >= maxMs) break;
        }
        beatMs = saveBeat;
        return Summarize(label, dt, gd);
    }
    FS Summarize(string label, List<float> dt, List<float> gd)
    {
        FS s = new FS(); s.N = dt.Count;
        List<float> sorted = new List<float>(dt); sorted.Sort();
        double sum = 0, gsum = 0; foreach (float x in dt) { sum += x; if (x > 33.3f) s.O33++; if (x > 50f) s.O50++; if (x > 100f) s.O100++; }
        foreach (float x in gd) gsum += x;
        if (s.N > 0) { s.Mean = sum / s.N; s.GameMean = gsum / gd.Count; s.P50 = Pct(sorted, .5); s.P95 = Pct(sorted, .95); s.P99 = Pct(sorted, .99); s.Max = sorted[sorted.Count - 1]; }
        Row("perf", "trial", trialLabel, "label", label, "n", s.N, "meanMs", s.Mean, "p50Ms", s.P50, "p95Ms", s.P95, "p99Ms", s.P99, "maxMs", s.Max, "over33", s.O33, "over50", s.O50, "over100", s.O100, "gameMeanMs", s.GameMean);
        if (s.Max > 1000) { stallSeen = true; Row("safety_note", "trial", trialLabel, "reason", "frame_over_1000ms", "label", label, "maxMs", s.Max); }
        try
        {
            if (frameLog == null && runDir != null)
            {
                frameLog = new StreamWriter(new FileStream(Path.Combine(runDir, "frames.csv"), FileMode.Append, FileAccess.Write, FileShare.ReadWrite));
                frameLog.WriteLine("trial,label,idx,dtMs,gameMs");
            }
            if (frameLog != null)
            {
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < dt.Count; i++) sb.Append(trialLabel).Append(',').Append(label).Append(',').Append(i).Append(',').Append(dt[i].ToString("0.000", Inv)).Append(',').Append(gd[i].ToString("0.000", Inv)).Append('\n');
                frameLog.Write(sb.ToString()); frameLog.Flush();
            }
        }
        catch (Exception ex) { Row("frame_log_error", "message", ex.Message); }
        return s;
    }

    // ---- unknown-ray-hit diagnostics (phantom collision) ----------------------------------------------------------
    void NoteOther(int e, Vector3 p)
    {
        string kind;
        try
        {
            if (e == 0) kind = "map_or_zero";
            else if (!Function.Call<bool>(Hash.DOES_ENTITY_EXIST, e)) kind = "missing";
            else
            {
                int type = Function.Call<int>(Hash.GET_ENTITY_TYPE, e); int model = Function.Call<int>(Hash.GET_ENTITY_MODEL, e);
                kind = "t" + type + ":m" + (uint)model + (labHandles.Contains(e) ? ":lab" : "");
            }
        }
        catch { kind = "err"; }
        int c; otherKinds.TryGetValue(kind, out c); otherKinds[kind] = c + 1;
        if (otherLogged++ < 12) Row("ray_other", "trial", trialLabel, "entity", e, "kind", kind, "pos", p);
    }
    string KindsStr()
    {
        List<string> parts = new List<string>(); foreach (KeyValuePair<string, int> kv in otherKinds) parts.Add(kv.Key + "=" + kv.Value);
        return string.Join(";", parts.ToArray());
    }

    // ---- debris attribution -----------------------------------------------------------------------------------------
    int ScanDebris(List<Lab> labs, Vector3 around, float radius)
    {
        int added = 0;
        try
        {
            foreach (Prop p in World.GetNearbyProps(around, radius))
            {
                if (p == null || !p.Exists()) continue;
                int h = p.Handle; if (labHandles.Contains(h)) continue;
                int owner = -1;
                try
                {
                    if (p.HasBeenDetachedFromParentEntity)
                    {
                        Entity par = p.ParentEntityDetachedFrom;
                        if (par != null) { int ph = par.Handle; foreach (Lab L in labs) if (L.Wall.Handle == ph) { owner = L.Index; break; } }
                    }
                }
                catch { }
                if (owner >= 0) { if (flaggedSet.Add(h)) added++; debrisOwner[h] = owner; debris.Add(h); strayNew.Remove(h); }
                else if (!preProps.Contains(h) && !flaggedSet.Contains(h)) { if (strayNew.Add(h)) debris.Add(h); }
            }
        }
        catch (Exception ex) { Row("scan_error", "message", ex.Message); }
        return added;
    }
    static bool Exists(int h) { try { return Function.Call<bool>(Hash.DOES_ENTITY_EXIST, h); } catch { return false; } }
    int AliveFlagged(int owner) { int c = 0; foreach (int h in flaggedSet) { int o; if (debrisOwner.TryGetValue(h, out o) && o == owner && Exists(h)) c++; } return c; }
    int EverFlagged(int owner) { int c = 0; foreach (int h in flaggedSet) { int o; if (debrisOwner.TryGetValue(h, out o) && o == owner) c++; } return c; }
    void LocalUTV(Lab L, Vector3 world, out float u, out float t, out float v)
    {
        Vector3 lp = L.Inv(world); t = L.Thin == 0 ? lp.X : lp.Y; u = L.Thin == 0 ? lp.Y : lp.X; v = lp.Z;
    }
    void DebrisSnapshot(string label, List<Lab> labs, bool perProp)
    {
        int[] alive = new int[labs.Count]; int moving = 0, frozen = 0, total = 0; float maxDist = 0; List<string> props = new List<string>();
        foreach (int h in new List<int>(flaggedSet))
        {
            int o; if (!debrisOwner.TryGetValue(h, out o) || !Exists(h)) continue;
            Entity e = Entity.FromHandle(h); if (e == null || !e.Exists()) continue;
            float sp = 0f; try { sp = Function.Call<float>(Hash.GET_ENTITY_SPEED, h); } catch { }
            bool fz = false; try { fz = e.IsPositionFrozen; } catch { }
            Lab L = labs[o]; float u, t, v; Vector3 pos = e.Position; LocalUTV(L, pos, out u, out t, out v);
            alive[o]++; total++; if (sp > 0.1f) moving++; if (fz) frozen++;
            float d = pos.DistanceTo(L.Start); if (d > maxDist) maxDist = d;
            if (perProp && props.Count < 64) props.Add(Obj("u", u, "t", t, "v", v, "speed", sp, "frozen", fz));
        }
        int strayAlive = 0; foreach (int h in strayNew) if (Exists(h)) strayAlive++;
        Row("x3_debris", "trial", trialLabel, "label", label, "alive", total, "perWall", Arr(new List<int>(alive)), "moving", moving, "frozen", frozen,
            "cumulative", flaggedSet.Count, "strayNew", strayAlive, "maxDistFromWallM", maxDist, "props", Arr(props), "pools", PoolsRaw());
    }

    // ---- layout ------------------------------------------------------------------------------------------------------
    void ConfigureWall(Lab L)
    {
        Prop wall = L.Wall;
        Function.Call(Hash.SET_ENTITY_LOD_DIST, wall.Handle, 1000); Function.Call(Hash.SET_ENTITY_ALWAYS_PRERENDER, wall.Handle, true);
        Function.Call(Hash.SET_DISABLE_FRAG_DAMAGE, wall.Handle, x7Dormant);
        Function.Call(Hash.SET_DISABLE_BREAKING, wall.Handle, x7Dormant);
        Function.Call(Hash.SET_ENTITY_CAN_BE_DAMAGED, wall.Handle, !x7Dormant);
    }
    // gap >= 0: one row, centre spacing = width + gap. gap < 0: grid with `cols` columns, sx column spacing, sz row spacing (rows extend behind the front row).
    List<Lab> SpawnLayout(int n, int cols, float sx, float sz, float gap, Vector3 spot)
    {
        Lab probe = Spawn(AssetModel, "physical", spot, .25f);
        float width = probe.U1 - probe.U0; int thin = probe.Thin;
        try { probe.Wall.Delete(); } catch { }
        owned.Remove(probe.Wall); for (int i = 0; i < 6; i++) Yield();
        Vector3 uDir = thin == 0 ? new Vector3(0f, 1f, 0f) : new Vector3(1f, 0f, 0f);
        Vector3 tDir = thin == 0 ? new Vector3(1f, 0f, 0f) : new Vector3(0f, 1f, 0f);
        if (gap >= 0f) { cols = n; sx = width + gap; sz = 0f; }
        if (cols < 1) cols = 1;
        List<Lab> labs = new List<Lab>();
        for (int i = 0; i < n; i++)
        {
            int c = i % cols, r = i / cols, inRow = Math.Min(cols, n - r * cols);
            Vector3 sp = spot + uDir * ((c - (inRow - 1) / 2f) * sx) + tDir * (r * sz);
            Lab L = Spawn(AssetModel, "physical", GroundAt(sp), .25f); L.Index = i;
            L.Anchor = AttachNativeAnchor(L.Wall); ConfigureWall(L);
            labHandles.Add(L.Wall.Handle); labHandles.Add(L.Anchor.Handle);
            labs.Add(L);
        }
        return labs;
    }
    Vector3 LabCentre(List<Lab> labs) { Vector3 s = Vector3.Zero; foreach (Lab L in labs) s += L.P0; return s / labs.Count; }
    void MakeCamera(List<Lab> labs, int rows)
    {
        Lab L0 = labs[0];
        if (labs.Count == 1) { x2Camera = World.CreateCamera(L0.W(L0.L(-6, 0, 2)), Vector3.Zero, 50); x2Camera.PointAt(L0.W(L0.L(0, 0, 1.25f))); }
        else
        {
            Vector3 centre = LabCentre(labs); Vector3 front = L0.W(L0.L(-1f, 0, 0)) - L0.W(L0.L(0, 0, 0)); front.Z = 0f; front.Normalize();
            x2Camera = World.CreateCamera(centre + front * (18f + 3f * rows) + new Vector3(0f, 0f, 5f + rows), Vector3.Zero, 60);
            x2Camera.PointAt(centre + new Vector3(0f, 0f, 1.25f));
        }
        World.RenderingCamera = x2Camera;
    }
    void SnapshotPre(Vector3 centre, float radius)
    {
        preProps.Clear(); try { foreach (Prop q in World.GetNearbyProps(centre, radius)) if (q != null && q.Exists()) preProps.Add(q.Handle); } catch { }
    }
    // X3-0.3 (PR #290 review, P0): deletion is ownership-verified. A handle is deleted only if it still exists, is a Prop,
    // and is natively detached from one of THIS lab's walls. Anything else - including newly streamed ambient props that
    // merely appeared near the wall - is observation-only and is never deleted.
    int cleanupDeletedOwned, cleanupSkippedAmbient;
    bool IsVerifiedLabDebris(int h)
    {
        try
        {
            if (!Exists(h)) return false;
            Prop p = Entity.FromHandle(h) as Prop; if (p == null) return false;
            if (labHandles.Contains(h)) return false; // wall/anchor are removed through 'owned', never as debris
            if (!p.HasBeenDetachedFromParentEntity) return false;
            Entity par = p.ParentEntityDetachedFrom; if (par == null) return false;
            int ph = par.Handle;
            if (labHandles.Contains(ph)) return true;
            foreach (Entity o in owned) { if (o != null && o.Handle == ph) return true; }
        }
        catch { }
        return false;
    }
    void DeleteVerified(int h) { try { Entity d = Entity.FromHandle(h); if (d != null && d.Exists()) { d.MarkAsMissionEntity(); d.Delete(); } } catch { } }
    void DoDelete(int h)
    {
        if (!IsVerifiedLabDebris(h)) { cleanupSkippedAmbient++; return; }
        DeleteVerified(h); cleanupDeletedOwned++;
    }
    void CleanupDebris()
    {
        foreach (int h in new List<int>(debris))
        {
            if (IsVerifiedLabDebris(h)) { DeleteVerified(h); cleanupDeletedOwned++; }
            else if (Exists(h))
            {
                cleanupSkippedAmbient++;
                if (cleanupSkippedAmbient <= 25) { uint mh = 0; try { mh = (uint)Entity.FromHandle(h).Model.Hash; } catch { } Row("x3_cleanup_skipped", "trial", trialLabel, "handle", h, "model", mh, "reason", "not verified detached from a lab wall"); }
            }
        }
        debris.Clear();
    }

    // ---- per-wall measurement --------------------------------------------------------------------------------------
    WallBase MeasureBaseline(Lab L)
    {
        int f0 = failedRays; WallBase b = new WallBase();
        Row("x4_stage", "at", "baseline_probe_start");
        b.G = Probe(L);
        Row("x4_stage", "at", "baseline_probe_done");
        int c, t; float w, u; Passable(L, "baseline_w" + L.Index, out c, out t, out w, out u);
        Row("x4_stage", "at", "baseline_sweep_done");
        b.ClearC = c; b.TotalC = t; b.W = w; b.U = u;
        int v; b.Face0 = AnchorFaces(L, out v); b.FaceValid = v;
        Row("x4_stage", "at", "baseline_faces_done");
        b.Valid = b.G.Wall == b.G.C.Length && c == 0 && (x4Active ? v >= 10 : v == 20) && failedRays == f0;
        Row("x3_baseline", "trial", trialLabel, "wall", L.Index, "blocked", b.G.Wall, "cells", b.G.C.Length, "sweepClearColumns", c, "sweepColumns", t,
            "anchorFaceHits", v, "failedRayRequests", failedRays - f0, "valid", b.Valid, "mask", MaskStr(b.G));
        return b;
    }
    // burstRoot/minUp/minRight < 0 means "use current pose" (second phase)
    Meas MeasureWall(Lab L, WallBase b, float blastU, float blastV, string phase, float burstRoot, float burstUp, float burstRight)
    {
        Meas m = new Meas();
        m.G = Probe(L); m.C = Compare(L, b.G, m.G, blastU, blastV, 1.25f);
        int c, t; float w, u; Passable(L, phase + "_w" + L.Index, out c, out t, out w, out u);
        m.ClearC = c; m.TotalC = t; m.W = w; m.U = u;
        int fv; m.Faces = AnchorFaces(L, out fv); m.FaceValid = fv;
        m.MaxFace = -1f;
        if (fv == 20) { m.MaxFace = 0f; for (int k = 0; k < 20; k++) m.MaxFace = Math.Max(m.MaxFace, m.Faces[k].DistanceTo(b.Face0[k])); }
        for (int j = 0; j < b.G.Nv; j++) for (int i = 0; i < b.G.Nu; i++)
            if (Math.Abs(L.U0 + (i + .5f) * L.P) > 1.05f && b.G.C[j * b.G.Nu + i] == 1) { m.OuterBaseline++; if (m.G.C[j * b.G.Nu + i] == 1) m.OuterBlocked++; }
        bool exists = L.Wall.Exists();
        m.RootMove = exists ? L.Wall.Position.DistanceTo(L.Start) : -1f;
        m.UpDot = exists ? Vector3.Dot(L.StartUp, L.Wall.UpVector) : 0f; m.RightDot = exists ? Vector3.Dot(L.StartRight, L.Wall.RightVector) : 0f;
        float root = burstRoot >= 0f ? Math.Max(burstRoot, m.RootMove) : m.RootMove;
        float up = burstRoot >= 0f ? Math.Min(burstUp, m.UpDot) : m.UpDot, right = burstRoot >= 0f ? Math.Min(burstRight, m.RightDot) : m.RightDot;
        m.Anchored = exists && fv == 20 && m.MaxFace >= 0f && m.MaxFace <= .02f && root >= 0f && root <= .02f && up >= .999f && right >= .999f && m.OuterBaseline == 40 && m.OuterBlocked == 40;
        return m;
    }
    void EmitGeom(Lab L, WallBase b, Meas m, string phase, float du, float height, bool isTarget, float burstRoot, bool explosionDetected)
    {
        Cmp c = m.C; int rootCells = 0, debrisCells = 0, otherCells = 0, clearCells = 0;
        for (int k = 0; k < b.G.C.Length; k++) if (b.G.C[k] == 1) { byte nn = m.G.C[k]; if (nn == 1) rootCells++; else if (nn == 0) clearCells++; else if (nn == 2) debrisCells++; else otherCells++; }
        Row("x3_geom", "trial", trialLabel, "phase", phase, "wall", L.Index, "target", isTarget, "du", du, "height", height, "explosionDetected", explosionDetected,
            "openedWall", c.OpenedWall, "openedClear", c.OpenedClear, "residual", c.Residual, "rootCells", rootCells, "clearCells", clearCells, "debrisCells", debrisCells, "otherCells", otherCells,
            "bigCells", c.BigSize, "bigW", c.BigW, "bigH", c.BigH, "bigU", c.BigU, "bigV", c.BigV, "bigJ0", c.BigJ0,
            "sweepWindowM", m.W, "sweepWindowU", m.U, "sweepClearColumns", m.ClearC, "sweepColumns", m.TotalC,
            "foreignDebrisCells", m.G.Foreign, "otherKinds", m.G.OtherKinds,
            "anchorFaceHits", m.FaceValid, "maxAnchorFaceMoveM", m.MaxFace, "rootMoveM", m.RootMove, "burstMaxRootMoveM", burstRoot, "minUpDot", m.UpDot, "minRightDot", m.RightDot,
            "outerBlocked", m.OuterBlocked, "outerBaseline", m.OuterBaseline, "anchored", m.Anchored,
            "flaggedDetachedAlive", AliveFlagged(L.Index), "flaggedDetachedEver", EverFlagged(L.Index), "mask", MaskStr(m.G));
    }

    // ---- debris management (applied only after the initial measurements) ----------------------------------------------
    Region RegionFrom(Lab L, WallBase b, Meas m)
    {
        Region r = new Region(); r.U0 = 1e9f; r.U1 = -1e9f; r.V0 = 1e9f; r.V1 = -1e9f; int nu = b.G.Nu;
        for (int k = 0; k < b.G.C.Length; k++)
            if (b.G.C[k] == 1 && m.G.C[k] != 1)
            {
                int i = k % nu, j = k / nu; float u = L.U0 + (i + .5f) * L.P, v = L.V0 + (j + .5f) * L.P;
                r.U0 = Math.Min(r.U0, u - L.P / 2f); r.U1 = Math.Max(r.U1, u + L.P / 2f); r.V0 = Math.Min(r.V0, v - L.P / 2f); r.V1 = Math.Max(r.V1, v + L.P / 2f); r.Valid = true;
            }
        return r;
    }
    List<Cand> MgmtCandidates(List<Lab> labs, Region[] regions, float pad, float half)
    {
        List<Cand> list = new List<Cand>();
        foreach (int h in new List<int>(flaggedSet))
        {
            int o; if (!debrisOwner.TryGetValue(h, out o) || !Exists(h) || !IsVerifiedLabDebris(h)) continue;
            Entity e = Entity.FromHandle(h); if (e == null || !e.Exists()) continue;
            Lab L = labs[o]; Region r = regions[o]; float u, t, v; LocalUTV(L, e.Position, out u, out t, out v);
            Cand c = new Cand(); c.H = h; c.L = L; try { c.Speed = Function.Call<float>(Hash.GET_ENTITY_SPEED, h); } catch { }
            c.InRegion = r != null && r.Valid && u >= r.U0 - pad && u <= r.U1 + pad && v >= r.V0 - pad && v <= r.V1 + pad && Math.Abs(t) <= half;
            if (r != null && r.Valid) { float cu = (r.U0 + r.U1) * .5f, cv = (r.V0 + r.V1) * .5f; c.Score = (float)Math.Sqrt((u - cu) * (u - cu) + (v - cv) * (v - cv) + t * t); } else c.Score = 1000f;
            list.Add(c);
        }
        return list;
    }
    // returns number of props acted on. mode: none|freeze|cull_corridor|cull_all|cull_budget
    int ApplyManagement(string mode, List<Lab> labs, Region[] regions, string phaseLabel)
    {
        float pad = .25f, half = 1.2f;
        List<Cand> cands = MgmtCandidates(labs, regions, pad, half);
        int acted = 0; int total = cands.Count; int inRegion = 0; foreach (Cand c in cands) if (c.InRegion) inRegion++;
        PoolRow("pre_manage_" + mode);
        FS fs;
        if (mode == "cull_budget")
        {
            cands.Sort(delegate(Cand a1, Cand b1) { return a1.Score.CompareTo(b1.Score); });
            int next = 0, perBatch = 2, every = 6; int maxFrames = every * ((cands.Count + perBatch - 1) / perBatch) + 120;
            fs = SampleCore("manage_action", maxFrames, 0, null, delegate(int i)
            {
                if (i % every == 0) for (int k = 0; k < perBatch && next < cands.Count; k++) { DoDelete(cands[next].H); next++; acted++; }
            });
        }
        else
        {
            fs = Sample("manage_action", 120, delegate()
            {
                foreach (Cand c in cands)
                {
                    if (mode == "freeze") { if (c.Speed < 0.1f) { try { Entity e = Entity.FromHandle(c.H); if (e != null && e.Exists()) { e.IsPositionFrozen = true; acted++; } } catch { } } }
                    else if (mode == "cull_all") { DoDelete(c.H); acted++; }
                    else if (mode == "cull_corridor") { if (c.InRegion) { DoDelete(c.H); acted++; } }
                }
            });
        }
        for (int i = 0; i < 30; i++) Yield();
        int alive = 0; foreach (Cand c in cands) if (Exists(c.H)) alive++;
        Row("x3_manage", "trial", trialLabel, "phase", phaseLabel, "mode", mode, "candidates", total, "inCorridor", inRegion, "acted", acted, "candidatesAliveAfter", alive,
            "frames", fs.N, "meanMs", fs.Mean, "p99Ms", fs.P99, "maxFrameMs", fs.Max, "regionsValid", regions.Length > 0 && regions[0] != null && regions[0].Valid);
        PoolRow("post_manage_" + mode);
        return acted;
    }
    void LeakCheck(string label, int props0, int coll0, int peds0)
    {
        CleanupAll(); for (int i = 0; i < 120; i++) Yield();
        Row("x3_leak", "trial", trialLabel, "label", label, "propsBefore", props0, "propsAfter", World.PropCount, "propsDelta", World.PropCount - props0,
            "collidersBefore", coll0, "collidersAfter", World.EntityColliderCount, "collidersDelta", World.EntityColliderCount - coll0,
            "pedsBefore", peds0, "pedsAfter", World.PedCount, "cleanupDeletedOwned", cleanupDeletedOwned, "cleanupSkippedAmbient", cleanupSkippedAmbient, "pools", PoolsRaw());
    }

    // ===================================================================== x3idle: ambient pools and empty-site frame baseline
    void X3Idle(Dictionary<string, string> a)
    {
        trialLabel = S(a, "label", "idle"); int secs = (int)F(a, "seconds", 30f);
        PrepareSite(); ResetX3(); Vector3 spot = SiteSpot(); for (int i = 0; i < 60; i++) Yield();
        Row("x3_start", "trial", trialLabel, "kind", "idle", "seconds", secs, "pools", PoolsRaw());
        Sample("idle_empty", 600, null);
        long t0 = clock.ElapsedMilliseconds; int k = 0;
        while (clock.ElapsedMilliseconds - t0 < secs * 1000L && !abortRequested) { Sample("ambient_" + k, 300, null); PoolRow("ambient_" + k); k++; }
    }

    // ===================================================================== x3perf: N simultaneous walls, frame times and pools only
    void X3Perf(Dictionary<string, string> a)
    {
        trialLabel = S(a, "label", "perf");
        int n = (int)F(a, "n", 1f), cols = (int)F(a, "cols", Math.Min(n, 4)); float sx = F(a, "sx", 7f), sz = F(a, "sz", 9f);
        string explosive = S(a, "explosive", "rocket"); float scale = F(a, "scale", 10f), dx = F(a, "dx", .4f), du = F(a, "du", 0f), height = F(a, "height", 1f);
        int rounds = (int)F(a, "rounds", 1f); float roundgap = F(a, "roundgap", 15f); int lateFrames = (int)(F(a, "latesec", 30f) * 60f); string manage = S(a, "manage", "none");
        PrepareSite(); ResetX3(); Vector3 spot = SiteSpot(); for (int i = 0; i < 60; i++) Yield();
        int props0 = World.PropCount, coll0 = World.EntityColliderCount, peds0 = World.PedCount;
        PoolRow("pre_spawn");
        List<Lab> labs = SpawnLayout(n, cols, sx, sz, -1f, spot);
        int rows = (n + cols - 1) / cols; MakeCamera(labs, rows);
        Lab mid = labs[(n - 1) / 2]; PlacePlayerFacing(mid, (mid.Thin == 0 ? mid.Min.X : mid.Min.Y) - 7f, (mid.U0 + mid.U1) * .5f);
        for (int f = 0; f < 60; f++) Yield();
        foreach (Lab L in labs) { L.Start = L.Wall.Position; L.StartUp = L.Wall.UpVector; L.StartRight = L.Wall.RightVector; }
        Vector3 centre = LabCentre(labs); float extent = Math.Max(cols * sx, rows * sz); float scanR = 30f + extent * .6f;
        SnapshotPre(centre, scanR);
        int groupsOk = 0; foreach (Lab L in labs) if (L.Wall.IsFragmentObject && L.Wall.FragmentGroupCount == 31) groupsOk++;
        PoolRow("post_spawn");
        Vector3[][] face0 = new Vector3[n][]; int faceMin = 20;
        for (int i = 0; i < n; i++) { int v; face0[i] = AnchorFaces(labs[i], out v); faceMin = Math.Min(faceMin, v); }
        Row("x3_perf_start", "trial", trialLabel, "n", n, "cols", cols, "rows", rows, "sx", sx, "sz", sz, "explosive", explosive, "scale", scale, "dx", dx, "du", du, "height", height, "rounds", rounds,
            "wallsSpawned", labs.Count, "wallsWith31Groups", groupsOk, "baselineFaceHitsMin", faceMin, "manage", manage, "assetSha256", ShaOf(Path.Combine(root, "onigiri/dlcpacks/lsa_destruct/dlc.rpf")), "pools", PoolsRaw());
        DebrisSnapshot("pre", labs, false);
        FS idle = Sample("idle", 600, null); PoolRow("after_idle");
        List<Vector3> blasts = new List<Vector3>(); foreach (Lab L in labs) blasts.Add(L.W(L.L(-.1f - dx, du, height)));
        int detected = 0;
        for (int r = 1; r <= rounds && !abortRequested; r++)
        {
            bool[] det = new bool[n];
            FS burst = SampleCore("burst_r" + r, 120, 0, delegate()
            {
                if (explosive != "none") foreach (Vector3 b in blasts) World.AddExplosion(b, ExplType(explosive), scale, 0f, Game.Player.Character, true, false);
            }, delegate(int i)
            {
                if (i < 12) for (int k = 0; k < n; k++) if (!det[k] && Function.Call<bool>(Hash.IS_EXPLOSION_IN_SPHERE, -1, blasts[k].X, blasts[k].Y, blasts[k].Z, 5f)) det[k] = true;
            });
            int d = 0; foreach (bool x in det) if (x) d++; detected = Math.Max(detected, d);
            Row("x3_round", "trial", trialLabel, "round", r, "detectedWalls", d);
            Sample("active_r" + r, 720, null);
            ScanDebris(labs, centre, scanR); DebrisSnapshot("after_active_r" + r, labs, n == 1); PoolRow("after_active_r" + r);
            if (r < rounds)
            {
                int gapFrames = Math.Max(60, (int)(roundgap * 60f) - 840);
                Sample("gap_r" + r, gapFrames, null);
            }
        }
        Sample("late", lateFrames, null);
        ScanDebris(labs, centre, scanR); DebrisSnapshot("after_late", labs, n == 1); PoolRow("after_late");
        int faceBad = 0; float maxFace = 0f, maxRoot = 0f; faceMissNoHit = faceMissOwnDebris = faceMissForeignDebris = faceMissOther = 0; List<int> badWalls = new List<int>(), badHits = new List<int>();
        for (int i = 0; i < n; i++)
        {
            int v; Vector3[] f1 = AnchorFaces(labs[i], out v); if (v != 20) { faceBad++; badWalls.Add(i); badHits.Add(v); } else for (int k = 0; k < 20; k++) maxFace = Math.Max(maxFace, f1[k].DistanceTo(face0[i][k]));
            if (labs[i].Wall.Exists()) maxRoot = Math.Max(maxRoot, labs[i].Wall.Position.DistanceTo(labs[i].Start));
        }
        Row("x3_perf_anchor", "trial", trialLabel, "wallsWithMissingFaceHits", faceBad, "maxFaceMoveM", maxFace, "maxRootMoveM", maxRoot, "badWalls", Arr(badWalls), "badWallHits", Arr(badHits), "missNoHit", faceMissNoHit, "missOwnDebris", faceMissOwnDebris, "missForeignDebris", faceMissForeignDebris, "missOther", faceMissOther);
        if (manage != "none" && !abortRequested)
        {
            Region[] regs = new Region[n];
            for (int i = 0; i < n; i++)
            {   // no grid in perf trials: corridor = 2 m x 2 m box around the intended impact, clamped to the wall
                Region rg = new Region(); rg.Valid = true; rg.U0 = Math.Max(labs[i].U0, du - 1f); rg.U1 = Math.Min(labs[i].U1, du + 1f); rg.V0 = Math.Max(labs[i].V0, height - 1f); rg.V1 = Math.Min(labs[i].V1, height + 1f); regs[i] = rg;
            }
            ApplyManagement(manage, labs, regs, "perf");
            Sample("post_manage", 600, null);
            ScanDebris(labs, centre, scanR); DebrisSnapshot("after_manage", labs, n == 1); PoolRow("after_manage");
        }
        Row("x3_perf_end", "trial", trialLabel, "n", n, "detectedWalls", detected, "idleMeanMs", idle.Mean, "poolFracMax", poolFracMax, "stallSeen", stallSeen, "aborted", abortRequested);
        LeakCheck("after_cleanup", props0, coll0, peds0);
    }

    // ===================================================================== x3breach / x3multi: geometry, three outcomes, optional management phase
    void X3Geom(Dictionary<string, string> a, bool multi)
    {
        trialLabel = S(a, "label", multi ? "multi" : "breach");
        int n = (int)F(a, "n", multi ? 3f : 1f); float gap = F(a, "gap", 3f);
        string explosive = S(a, "explosive", "grenade"); float scale = F(a, "scale", 1f), dx = F(a, "dx", .4f), du = F(a, "du", 0f), height = F(a, "height", 1f);
        List<int> targets = a.ContainsKey("targets") ? ParseList(S(a, "targets", "")) : new List<int>();
        if (!multi) { targets.Clear(); if (explosive != "none") targets.Add(0); }
        bool simul = F(a, "simul", 1f) > .5f; float seqgap = F(a, "seqgap", 6f); bool walk = F(a, "walk", 1f) > .5f; int hold = (int)F(a, "hold", 0f);
        string manage = S(a, "manage", "none"); float manageAt = F(a, "manageat", 30f), until = F(a, "until", 0f);
        PrepareSite(); ResetX3(); Vector3 spot = SiteSpot(); for (int i = 0; i < 60; i++) Yield();
        int props0 = World.PropCount, coll0 = World.EntityColliderCount, peds0 = World.PedCount;
        PoolRow("pre_spawn");
        List<Lab> labs = SpawnLayout(n, n, 0f, 0f, multi ? gap : 0f, spot);
        MakeCamera(labs, 1);
        Lab mid = labs[(n - 1) / 2]; PlacePlayerFacing(mid, (mid.Thin == 0 ? mid.Min.X : mid.Min.Y) - 7f, (mid.U0 + mid.U1) * .5f);
        for (int f = 0; f < 60; f++) Yield();
        foreach (Lab L in labs) { L.Start = L.Wall.Position; L.StartUp = L.Wall.UpVector; L.StartRight = L.Wall.RightVector; }
        Vector3 centre = LabCentre(labs); float scanR = 30f + n * 3.5f; SnapshotPre(centre, scanR);
        Row("x3_start", "trial", trialLabel, "n", n, "gap", multi ? gap : 0f, "explosive", explosive, "scale", scale, "dx", dx, "du", du, "height", height, "targets", Arr(targets),
            "simul", simul, "manage", manage, "manageAt", manageAt, "until", until, "isFragment", labs[0].Wall.IsFragmentObject, "groups", labs[0].Wall.FragmentGroupCount, "boneCount", labs[0].Wall.Bones.Count,
            "assetSha256", ShaOf(Path.Combine(root, "onigiri/dlcpacks/lsa_destruct/dlc.rpf")), "pools", PoolsRaw());
        WallBase[] bases = new WallBase[n]; bool allValid = true;
        for (int i = 0; i < n; i++) { bases[i] = MeasureBaseline(labs[i]); if (!bases[i].Valid) allValid = false; }
        Hold("X3 BASELINE " + trialLabel, hold);
        if (!allValid) { Row("x3_verdict", "trial", trialLabel, "verdict", "BASELINE_INVALID"); LeakCheck("after_cleanup", props0, coll0, peds0); return; }
        // ---- detonation (frozen X2 charge/position semantics), 180-frame burst as in X2 ----
        float[] maxRoot = new float[n], minUp = new float[n], minRight = new float[n]; for (int i = 0; i < n; i++) { minUp[i] = 1f; minRight[i] = 1f; }
        bool[] detected = new bool[n]; List<Vector3> bp = new List<Vector3>(); foreach (Lab L in labs) bp.Add(L.W(L.L(-.1f - dx, du, height)));
        long tBlast = 0;
        Action<int> track = delegate(int f)
        {
            for (int i = 0; i < n; i++)
            {
                Lab L = labs[i]; if (!L.Wall.Exists()) continue;
                maxRoot[i] = Math.Max(maxRoot[i], L.Wall.Position.DistanceTo(L.Start)); minUp[i] = Math.Min(minUp[i], Vector3.Dot(L.StartUp, L.Wall.UpVector)); minRight[i] = Math.Min(minRight[i], Vector3.Dot(L.StartRight, L.Wall.RightVector));
            }
            if (f < 12) foreach (int t in targets) if (t >= 0 && t < n && !detected[t] && Function.Call<bool>(Hash.IS_EXPLOSION_IN_SPHERE, -1, bp[t].X, bp[t].Y, bp[t].Z, 5f)) detected[t] = true;
            if (f % 30 == 0 || f == 179) ScanDebris(labs, centre, scanR);
        };
        Row("x3_pre_detonation", "trial", trialLabel, "targets", Arr(targets));
        if (explosive != "none" && targets.Count > 0)
        {
            if (simul || targets.Count == 1)
            {
                SampleCore("burst", 180, 0, delegate() { foreach (int t in targets) if (t >= 0 && t < n) World.AddExplosion(bp[t], ExplType(explosive), scale, 0f, Game.Player.Character, true, false); tBlast = clock.ElapsedMilliseconds; }, track);
            }
            else
            {
                for (int q = 0; q < targets.Count; q++)
                {
                    int t = targets[q]; int idx = q;
                    SampleCore("burst_seq" + q, q == targets.Count - 1 ? 180 : (int)(seqgap * 60f), 0, delegate() { World.AddExplosion(bp[t], ExplType(explosive), scale, 0f, Game.Player.Character, true, false); if (idx == 0) tBlast = clock.ElapsedMilliseconds; }, track);
                }
            }
        }
        else SampleCore("burst_control", 180, 0, null, track);
        ScanDebris(labs, centre, scanR); PoolRow("after_burst");
        Hold("X3 AFTER BLAST DEBRIS PRESENT " + trialLabel, hold);
        // ---- initial measurement: debris untouched ----
        Meas[] init = new Meas[n]; Region[] regions = new Region[n];
        for (int i = 0; i < n; i++)
        {
            bool isT = targets.Contains(i);
            init[i] = MeasureWall(labs[i], bases[i], du, height, "initial", maxRoot[i], minUp[i], minRight[i]);
            regions[i] = RegionFrom(labs[i], bases[i], init[i]);
            EmitGeom(labs[i], bases[i], init[i], "initial", du, height, isT, maxRoot[i], detected.Length > i && detected[i]);
        }
        DebrisSnapshot("initial", labs, n == 1);
        // ---- actual NPC traversal: holes (>= 4 cleared cells) and, for intact/non-target panels, a centre-column control ----
        for (int i = 0; i < n && !abortRequested; i++)
        {
            string w1 = "skipped"; float prog;
            if (walk && init[i].C.OpenedClear >= 4) w1 = Walk(labs[i], !float.IsNaN(init[i].U) ? init[i].U : init[i].C.BigU, "x3_hole_w" + i + "_initial", out prog);
            else if (walk && !targets.Contains(i) && (!multi || n <= 4)) w1 = Walk(labs[i], 0f, "x3_intact_w" + i + "_initial", out prog);
            Row("x3_walk_result", "trial", trialLabel, "phase", "initial", "wall", i, "result", w1);
        }
        for (int i = 0; i < n; i++)
        {
            int fv; Vector3[] ff = AnchorFaces(labs[i], out fv); float mv = -1f;
            if (fv == 20) { mv = 0f; for (int k = 0; k < 20; k++) mv = Math.Max(mv, ff[k].DistanceTo(bases[i].Face0[k])); }
            Row("x3_final_anchor", "trial", trialLabel, "phase", "initial", "wall", i, "anchorFaceHits", fv, "maxAnchorFaceMoveM", mv, "rootMoveM", labs[i].Wall.Exists() ? labs[i].Wall.Position.DistanceTo(labs[i].Start) : -1f);
        }
        // ---- labelled second phase: observation, then management (or matched no-op control) ----
        if (until > 0f && !abortRequested)
        {
            long tb = tBlast > 0 ? tBlast : clock.ElapsedMilliseconds; int k2 = 0;
            while ((clock.ElapsedMilliseconds - tb) < (long)(manageAt * 1000f) && !abortRequested) { Sample("observe_pre_" + k2, 300, null); ScanDebris(labs, centre, scanR); DebrisSnapshot("observe_pre_" + k2, labs, n == 1); k2++; }
            DebrisSnapshot("before_management", labs, n == 1);
            Row("x3_phase", "trial", trialLabel, "phase", "management", "mode", manage, "secondsSinceBlast", (clock.ElapsedMilliseconds - tb) / 1000.0);
            int acted = manage != "none" ? ApplyManagement(manage, labs, regions, "geom") : 0;
            if (manage == "none") Sample("manage_action", 120, null);
            for (int i = 0; i < 60; i++) Yield();
            ScanDebris(labs, centre, scanR); DebrisSnapshot("after_management", labs, n == 1);
            for (int i = 0; i < n && !abortRequested; i++)
            {
                Meas m2 = MeasureWall(labs[i], bases[i], du, height, "managed", -1f, 1f, 1f);
                EmitGeom(labs[i], bases[i], m2, "managed:" + manage, du, height, targets.Contains(i), -1f, detected.Length > i && detected[i]);
                string w2 = "skipped"; float prog;
                if (walk && m2.C.OpenedClear >= 4) w2 = Walk(labs[i], !float.IsNaN(m2.U) ? m2.U : m2.C.BigU, "x3_hole_w" + i + "_managed", out prog);
                Row("x3_walk_result", "trial", trialLabel, "phase", "managed:" + manage, "wall", i, "result", w2, "acted", acted);
            }
            while ((clock.ElapsedMilliseconds - tb) < (long)(until * 1000f) && !abortRequested) { Sample("observe_post", 300, null); }
            ScanDebris(labs, centre, scanR); DebrisSnapshot("final", labs, n == 1); PoolRow("final");
        }
        Row("x3_verdict", "trial", trialLabel, "verdict", "MEASURED", "targets", Arr(targets), "poolFracMax", poolFracMax);
        LeakCheck("after_cleanup", props0, coll0, peds0);
    }

    // ===================================================================== x3player: a real player walks through (or into) the wall
    void X3Player(Dictionary<string, string> a)
    {
        trialLabel = S(a, "label", "player");
        string explosive = S(a, "explosive", "none"); float scale = F(a, "scale", 10f), dx = F(a, "dx", .4f), du = F(a, "du", 0f), height = F(a, "height", 1f); float timeout = F(a, "timeout", 45f);
        PrepareSite(); ResetX3(); Vector3 spot = SiteSpot(); for (int i = 0; i < 60; i++) Yield();
        int props0 = World.PropCount, coll0 = World.EntityColliderCount, peds0 = World.PedCount;
        List<Lab> labs = SpawnLayout(1, 1, 0f, 0f, -1f, spot); Lab L = labs[0];
        for (int f = 0; f < 60; f++) Yield();
        L.Start = L.Wall.Position; L.StartUp = L.Wall.UpVector; L.StartRight = L.Wall.RightVector;
        Vector3 centre = L.P0; SnapshotPre(centre, 30f);
        PlacePlayerFacing(L, (L.Thin == 0 ? L.Min.X : L.Min.Y) - 7f, 0f);
        WallBase b = MeasureBaseline(L);
        if (!b.Valid) { Row("x3_verdict", "trial", trialLabel, "verdict", "BASELINE_INVALID"); LeakCheck("after_cleanup", props0, coll0, peds0); return; }
        float uAim = 0f;
        if (explosive != "none")
        {
            Vector3 bp = L.W(L.L(-.1f - dx, du, height));
            World.AddExplosion(bp, ExplType(explosive), scale, 0f, Game.Player.Character, true, false);
            for (int f = 0; f < 240; f++) { Yield(); if (f % 40 == 0) ScanDebris(labs, centre, 30f); }
            ScanDebris(labs, centre, 30f);
            Meas m = MeasureWall(L, b, du, height, "player_pre", -1f, 1f, 1f); EmitGeom(L, b, m, "player_pre", du, height, true, -1f, true);
            uAim = !float.IsNaN(m.U) ? m.U : (m.C.BigSize > 0 ? m.C.BigU : 0f);
            Row("x3_player_opening", "trial", trialLabel, "uAim", uAim, "window", m.W, "openedClear", m.C.OpenedClear);
        }
        float tFront = L.Thin == 0 ? L.Min.X : L.Min.Y, tBack = L.Thin == 0 ? L.Max.X : L.Max.Y;
        Ped pl = Game.Player.Character;
        PlacePlayerFacing(L, tFront - 5f, uAim);
        Vector3 start = pl.Position;
        for (int f = 0; f < 60; f++) { Yield(); try { GameplayCamera.RelativeHeading = 0f; GameplayCamera.RelativePitch = -4f; } catch { } }
        state = "AWAIT_PLAYER"; step = "walk forward (hold W)"; Beat(true);
        Row("x3_player_ready", "trial", trialLabel, "uAim", uAim, "startDistanceToPlaneM", 5f, "timeoutSeconds", timeout, "breached", explosive != "none");
        long tReady = clock.ElapsedMilliseconds, tMove = 0; bool moved = false, crossed = false; float maxT = -99f, maxLateral = 0f, crossingU = float.NaN, prevT = -99f, prevU = uAim; long tEnd = 0; int n = 0;
        while (!abortRequested)
        {
            Yield(); Beat();
            float u, t, v; LocalUTV(L, pl.Position, out u, out t, out v);
            if (!moved && pl.Position.DistanceTo(start) > .5f) { moved = true; tMove = clock.ElapsedMilliseconds; }
            maxT = Math.Max(maxT, t); maxLateral = Math.Max(maxLateral, Math.Abs(u - uAim));
            if (prevT > -90f && float.IsNaN(crossingU) && prevT < 0f && t >= 0f) crossingU = prevU + (u - prevU) * (-prevT) / (t - prevT);
            prevT = t; prevU = u;
            if ((n++ % 15) == 0) Row("x3_player_track", "trial", trialLabel, "t", t, "u", u, "v", v, "ms", clock.ElapsedMilliseconds - tReady);
            if (t > tBack + .8f) { crossed = true; tEnd = clock.ElapsedMilliseconds; break; }
            long now = clock.ElapsedMilliseconds;
            if (!moved && now - tReady > 60000) break;
            if (moved && now - tMove > (long)(timeout * 1000f)) break;
        }
        bool outside = !float.IsNaN(crossingU) && (crossingU < L.U0 || crossingU > L.U1);
        Row("x3_player_result", "trial", trialLabel, "moved", moved, "crossed", crossed, "crossingU", crossingU, "outsideWallFootprint", outside, "maxProgressT", maxT, "maxLateralM", maxLateral, "walkMs", tEnd > 0 ? tEnd - tMove : -1L);
        state = "RUNNING"; step = "";
        for (int f = 0; f < 120; f++) Yield();
        LeakCheck("after_cleanup", props0, coll0, peds0);
    }

    // ===================================================================== x3cleanuptest: targeted regression test for the P0 cleanup fix
    // One wall, one grenade. Two unrelated sentinel props are created by the script but are NOT lab-owned: one before the pre-blast
    // snapshot (control) and one after it (exactly the "new ambient prop" case the old cleanup would have deleted).
    void X3CleanupTest(Dictionary<string, string> a)
    {
        trialLabel = S(a, "label", "cleanuptest");
        PrepareSite(); ResetX3(); Vector3 spot = SiteSpot(); for (int i = 0; i < 60; i++) Yield();
        List<Lab> labs = SpawnLayout(1, 1, 0f, 0f, 0f, spot); MakeCamera(labs, 1); Lab L = labs[0];
        PlacePlayerFacing(L, (L.Thin == 0 ? L.Min.X : L.Min.Y) - 7f, (L.U0 + L.U1) * .5f);
        for (int f = 0; f < 60; f++) Yield();
        Model m = new Model("prop_roadcone02a"); bool loaded = m.Request(5000);
        Prop sentinelPre = null, sentinelNew = null;
        if (loaded) sentinelPre = World.CreateProp(m, L.W(L.L(-1.5f, -7f, .2f)), Vector3.Zero, false, true);
        for (int f = 0; f < 30; f++) Yield();
        Vector3 centre = LabCentre(labs); SnapshotPre(centre, 40f); // sentinelPre is now part of the pre-blast world
        if (loaded) sentinelNew = World.CreateProp(m, L.W(L.L(-1.5f, 7f, .2f)), Vector3.Zero, false, true); // appears AFTER the snapshot
        for (int f = 0; f < 30; f++) Yield();
        int hPre = sentinelPre != null ? sentinelPre.Handle : 0, hNew = sentinelNew != null ? sentinelNew.Handle : 0;
        Vector3 bp = L.W(L.L(-.1f - .4f, 0f, 1f));
        SampleCore("burst", 180, 0, delegate() { World.AddExplosion(bp, ExplosionType.Grenade, .25f, 0f, Game.Player.Character, true, false); }, delegate(int f) { if (f % 30 == 0 || f == 179) ScanDebris(labs, centre, 40f); });
        ScanDebris(labs, centre, 40f);
        int flagged = flaggedSet.Count; int flaggedAlive = 0; foreach (int h in flaggedSet) if (Exists(h)) flaggedAlive++;
        bool newInDebris = debris.Contains(hNew), newInStray = strayNew.Contains(hNew), preInDebris = debris.Contains(hPre);
        PoolRow("before_cleanup");
        CleanupAll(); for (int f = 0; f < 120; f++) Yield();
        bool newSurvives = hNew != 0 && Exists(hNew), preSurvives = hPre != 0 && Exists(hPre);
        int flaggedAfter = 0; foreach (int h in flaggedSet) if (Exists(h)) flaggedAfter++;
        bool wallGone = !L.Wall.Exists();
        Row("x3_cleanup_test", "trial", trialLabel, "sentinelModelLoaded", loaded, "flaggedDetached", flagged, "flaggedAliveBefore", flaggedAlive,
            "newAmbientInOldDeleteSet", newInDebris, "newAmbientObservedAsStray", newInStray, "preSentinelInOldDeleteSet", preInDebris,
            "newAmbientSurvivesCleanup", newSurvives, "preSentinelSurvivesCleanup", preSurvives, "flaggedAliveAfter", flaggedAfter, "wallRemoved", wallGone,
            "cleanupDeletedOwned", cleanupDeletedOwned, "cleanupSkippedAmbient", cleanupSkippedAmbient,
            "pass", loaded && flagged >= 1 && newSurvives && preSurvives && flaggedAfter == 0 && wallGone);
        try { if (sentinelPre != null && sentinelPre.Exists()) sentinelPre.Delete(); if (sentinelNew != null && sentinelNew.Exists()) sentinelNew.Delete(); } catch { } // the test's own props
        m.MarkAsNoLongerNeeded();
        Row("x3_verdict", "trial", trialLabel, "verdict", "MEASURED");
    }

    // X3-0.2 diagnostic only: classifies why an anchor-face ray did not return the wall (no measurement semantics changed).
    int faceMissNoHit, faceMissOwnDebris, faceMissForeignDebris, faceMissOther;
    void FaceMiss(Lab L, int status, int hit, int e)
    {
        if (status != 2 || hit == 0) { faceMissNoHit++; return; }
        int o; if (flaggedSet.Contains(e) && debrisOwner.TryGetValue(e, out o)) { if (o == L.Index) faceMissOwnDebris++; else faceMissForeignDebris++; return; }
        faceMissOther++;
    }

    string AutoLoadSetting()
    {
        try
        {
            foreach (string l in File.ReadAllLines(Path.Combine(root, "ScriptHookVDotNet.ini"))) if (l.StartsWith("AutoLoadScripts=")) return l.Trim();
        }
        catch { }
        return "unknown";
    }


    // ===================================================================== evidence plumbing
    void Beat(bool force = false)
    {
        long now = clock.ElapsedMilliseconds;
        if (!force && now < nextBeat) return;
        nextBeat = now + beatMs;
        try
        {
            string dst = Path.Combine(lab, "status.json");
            AtomicText(dst, Obj("protocol", 2, "requestId", requestId, "fence", fence,"script", "WpsBreachLabX7.3.cs", "version", Ver, "scriptSha256", scriptSha, "shvdnApi", shvdnVer, "loadedUtc", loadedUtc.ToString("o"),
                "nowUtc", DateTime.UtcNow.ToString("o"), "pid", Process.GetCurrentProcess().Id, "state", state, "step", step, "cmd", curCmd, "runId", runId, "frame", Game.FrameCount));
        }
        catch { }
    }

    void Row(string kind, params object[] kv)
    {
        if (kind == "error" || kind == "exception" || kind == "refused" || kind == "unknown_command" || kind.EndsWith("_error"))
        { commandFailed = true; commandError = kind; }
        if (rows == null) return;
        List<object> all = new List<object>(); all.Add("t"); all.Add(clock.ElapsedMilliseconds); all.Add("frame"); all.Add(Game.FrameCount); all.Add("kind"); all.Add(kind);
        all.Add("requestId"); all.Add(requestId); all.Add("sessionId"); all.Add(sessionId); all.Add("experimentId"); all.Add(experimentId); all.Add("trialId"); all.Add(trialId); all.AddRange(kv); rows.WriteLine(Obj(all.ToArray()));
    }

    sealed class Raw { public string S; public Raw(string s) { S = s; } }
    static string Q(string s)
    {
        if (s == null) return "null"; StringBuilder sb = new StringBuilder("\"");
        foreach (char c in s) { if (c == '"') sb.Append("\\\""); else if (c == '\\') sb.Append("\\\\"); else if (c == '\n' || c == '\r' || c == '\t') sb.Append(' '); else if (c < 32) sb.Append(' '); else sb.Append(c); }
        return sb.Append('"').ToString();
    }
    static string V(object o)
    {
        if (o == null) return "null"; if (o is Raw) return ((Raw)o).S; if (o is string) return Q((string)o); if (o is bool) return (bool)o ? "true" : "false";
        if (o is float) { float f = (float)o; return (float.IsNaN(f) || float.IsInfinity(f)) ? "null" : f.ToString("0.###", Inv); }
        if (o is double) { double d = (double)o; return (double.IsNaN(d) || double.IsInfinity(d)) ? "null" : d.ToString("0.###", Inv); }
        if (o is Vector3) { Vector3 v = (Vector3)o; return "[" + V(v.X) + "," + V(v.Y) + "," + V(v.Z) + "]"; }
        return Convert.ToString(o, Inv);
    }
    static string Obj(params object[] kv)
    {
        StringBuilder sb = new StringBuilder("{");
        for (int i = 0; i + 1 < kv.Length; i += 2) { if (i > 0) sb.Append(','); sb.Append(Q((string)kv[i])).Append(':').Append(V(kv[i + 1])); }
        return sb.Append('}').ToString();
    }
    static Raw Arr(IEnumerable<string> items)
    {
        StringBuilder sb = new StringBuilder("["); bool first = true;
        foreach (string s in items) { if (!first) sb.Append(','); first = false; sb.Append(s != null && s.StartsWith("{") ? s : Q(s)); }
        return new Raw(sb.Append(']').ToString());
    }
    static Raw Arr(List<int> items) { List<string> s = new List<string>(); foreach (int i in items) s.Add(i.ToString(Inv)); return new Raw("[" + string.Join(",", s.ToArray()) + "]"); }
    static float TriState(bool? b) { return b.HasValue ? (b.Value ? 1f : 0f) : float.NaN; }
    static string Trim(string s, int n) { return s == null ? null : (s.Length > n ? s.Substring(0, n) : s); }
    static string S(Dictionary<string, string> a, string k, string d) { string v; return a.TryGetValue(k, out v) ? v : d; }
    static float F(Dictionary<string, string> a, string k, float d) { string v; float f; return a.TryGetValue(k, out v) && float.TryParse(v, NumberStyles.Float, Inv, out f) ? f : d; }
    static string SafeGameVersion() { try { return Game.FileVersion.ToString(); } catch { return "unknown"; } }
    static string ShaOf(string path)
    {
        try { using (SHA256 h = SHA256.Create()) using (FileStream fs = File.OpenRead(path)) { byte[] b = h.ComputeHash(fs); StringBuilder sb = new StringBuilder(); foreach (byte x in b) sb.Append(x.ToString("x2")); return sb.ToString(); } }
        catch { return "unavailable"; }
    }
}

namespace Astra.X8
{
    // X8/v1: no GTA dependency, no persistence or global discovery. A second catalog
    // entry is NOT a second loaded native twin: host deliberately leases one at a time.
    public enum FencePhase { Registered, Preparing, Armed, Active, RestorePending }

    public sealed class Placement
    {
        public readonly string Id;
        public readonly int Revision, ModelHash;
        public readonly double X, Y, Z, HeadingDegrees, Scale, UpDot;
        public Placement(string id, int revision, int modelHash, double x, double y,
            double z, double headingDegrees, double scale, double upDot)
        {
            Id = id; Revision = revision; ModelHash = modelHash; X = x; Y = y;
            Z = z; HeadingDegrees = headingDegrees; Scale = scale; UpDot = upDot;
        }
        static bool Finite(double n) { return !double.IsNaN(n) && !double.IsInfinity(n); }
        public void Validate()
        {
            if (string.IsNullOrEmpty(Id) || Id.Length > 32) throw new ArgumentException("x8_bad_id");
            foreach (char c in Id)
                if (!(c >= 'A' && c <= 'Z') && !(c >= 'a' && c <= 'z') &&
                    !(c >= '0' && c <= '9') && c != '_' && c != '-')
                    throw new ArgumentException("x8_bad_id");
            if (Revision != 1 || ModelHash != 1185366416)
                throw new ArgumentException("x8_unknown_family_or_revision");
            if (!Finite(X) || !Finite(Y) || !Finite(Z) || !Finite(HeadingDegrees) ||
                !Finite(Scale) || !Finite(UpDot)) throw new ArgumentException("x8_nonfinite");
            if (Scale != 1.0 || UpDot < 0.985 || UpDot > 1.000001)
                throw new ArgumentException("x8_not_upright_unit_scale");
            if (HeadingDegrees < 0 || HeadingDegrees >= 360)
                throw new ArgumentException("x8_bad_heading");
        }
        public double DistanceTo(Placement other)
        {
            double dx = X - other.X, dy = Y - other.Y, dz = Z - other.Z;
            return Math.Sqrt(dx * dx + dy * dy + dz * dz);
        }
        public bool Matches(double x, double y, double z, double heading)
        {
            if (!Finite(x) || !Finite(y) || !Finite(z) || !Finite(heading)) return false;
            double dx = x - X, dy = y - Y, dz = z - Z;
            double d = Math.Abs(((heading - HeadingDegrees + 540) % 360) - 180);
            return dx * dx + dy * dy + dz * dz <= 0.05 * 0.05 && d <= 2.0;
        }
        // Synthetic pure fixture. Runtime native RightVector controls actual section origins.
        public double[] SyntheticSectionOrigin(int physicalIndex, double width)
        {
            if (physicalIndex < 0 || physicalIndex > 4 || !Finite(width) || width <= 0)
                throw new ArgumentException("x8_bad_section");
            double angle = HeadingDegrees * Math.PI / 180;
            double offset = (physicalIndex - 2) * width;
            return new double[] { X + Math.Cos(angle) * offset,
                Y + Math.Sin(angle) * offset, Z };
        }
    }

    public sealed class Slot
    {
        public readonly Placement Site;
        public FencePhase Phase { get; internal set; }
        public int CandidateHandle { get; internal set; }
        public int OwnedRootCount { get; internal set; }
        public int OwnedAnchorCount { get; internal set; }
        public bool HideIntent { get; internal set; }
        public Slot(Placement site) { Site = site; Phase = FencePhase.Registered; }
    }

    public sealed class Registry
    {
        readonly Dictionary<string, Slot> slots = new Dictionary<string, Slot>(StringComparer.Ordinal);
        public string LeaseId { get; private set; }
        public int Count { get { return slots.Count; } }
        public IEnumerable<Slot> Slots { get { return slots.Values; } }
        public Slot Get(string id)
        {
            Slot s;
            if (!slots.TryGetValue(id ?? "", out s)) throw new InvalidOperationException("x8_unknown_placement");
            return s;
        }
        public void Register(Placement site)
        {
            if (site == null) throw new ArgumentNullException("site");
            site.Validate();
            if (slots.ContainsKey(site.Id)) throw new InvalidOperationException("x8_duplicate_id");
            if (slots.Count >= 2) throw new InvalidOperationException("x8_capacity_two");
            foreach (Slot other in slots.Values)
                if (site.DistanceTo(other.Site) < 6.0)
                    throw new InvalidOperationException("x8_placements_too_close");
            slots.Add(site.Id, new Slot(site));
        }
        public Slot Begin(string id)
        {
            Slot s = Get(id);
            if (LeaseId != null || s.Phase != FencePhase.Registered)
                throw new InvalidOperationException("x8_one_live_instance_only");
            LeaseId = id; s.Phase = FencePhase.Preparing; return s;
        }
        void RequireOwner(string id, FencePhase expected)
        {
            if (LeaseId != id || Get(id).Phase != expected)
                throw new InvalidOperationException("x8_wrong_owner_or_phase");
        }
        public void Armed(string id, int candidateHandle, int roots, int anchors)
        {
            RequireOwner(id, FencePhase.Preparing);
            if (candidateHandle <= 0 || roots != 5 || anchors != 5)
                throw new InvalidOperationException("x8_invalid_staged_ownership");
            Slot s = Get(id); s.CandidateHandle = candidateHandle;
            s.OwnedRootCount = roots; s.OwnedAnchorCount = anchors;
            s.Phase = FencePhase.Armed;
        }
        public void Active(string id)
        {
            RequireOwner(id, FencePhase.Armed);
            Get(id).Phase = FencePhase.Active;
        }
        public void Restore(string id, bool hideIntent)
        {
            if (LeaseId != id) throw new InvalidOperationException("x8_wrong_restore_owner");
            Slot s = Get(id); s.Phase = FencePhase.RestorePending;
            s.HideIntent = s.HideIntent || hideIntent;
        }
        public void Restored(string id, bool nineOfNineAndVisible, bool ownedRemoved)
        {
            RequireOwner(id, FencePhase.RestorePending);
            if (!nineOfNineAndVisible || !ownedRemoved)
                throw new InvalidOperationException("x8_restore_unverified");
            Slot s = Get(id); s.Phase = FencePhase.Registered;
            s.CandidateHandle = 0; s.OwnedRootCount = 0; s.OwnedAnchorCount = 0;
            s.HideIntent = false; LeaseId = null;
        }
        // Failed staging may only release its lease if no native ownership/hide remains
        // AND the original world collision was actually verified. Never infer this from files.
        public void FailedPreparation(string id, bool originalVerified, bool noOwnedOrHide)
        {
            RequireOwner(id, FencePhase.Preparing);
            Restore(id, false);
            Restored(id, originalVerified, noOwnedOrHide);
        }
    }
}

// Baseline provenance guard generated verbatim from selection/ProjectileAdmissionPolicy.cs.
namespace Astra.X7
{
    // Pure admission guard for a handle already present in the pre-fire projectile pool.
    // Handle membership alone is not provenance: SHVDN/native pools may recycle identities.
    // The GTA adapter must corroborate TWO post-fire samples before allowing the handle
    // into the unchanged impact selector. This is not a substitute for a weapon/owner ID.
    public static class ProjectileAdmissionPolicy
    {
        public struct Point3
        {
            public readonly double X, Y, Z;
            public Point3(double x, double y, double z) { X = x; Y = y; Z = z; }
            public static Point3 operator -(Point3 a, Point3 b)
            {
                return new Point3(a.X - b.X, a.Y - b.Y, a.Z - b.Z);
            }
        }

        const double MaximumProvenanceAgeMs = 1200.0; // ~2x observed RPG flight; not selector TTC
        const double MaximumCorridorErrorM = 0.65;
        const double MinimumForwardSpeed = 2.5;
        const double MinimumDirectionCosine = 0.70;
        const double MinimumObservedProgressM = 0.018;
        const int MaximumCorroborationFrames = 8;

        static bool Finite(double x)
        {
            return !double.IsNaN(x) && !double.IsInfinity(x);
        }
        static bool Finite(Point3 p) { return Finite(p.X) && Finite(p.Y) && Finite(p.Z); }
        static double Dot(Point3 a, Point3 b) { return a.X * b.X + a.Y * b.Y + a.Z * b.Z; }
        static double Norm(Point3 a) { return Math.Sqrt(Dot(a, a)); }

        // Only launch-path evidence, NEVER aim-derived impact coordinates or section indices.
        public static bool TryLaunchFlight(Point3 source, Point3 target, Point3 position,
            Point3 velocity, double elapsedMs, out double progressM)
        {
            progressM = -1;
            if (!Finite(source) || !Finite(target) || !Finite(position) || !Finite(velocity) ||
                !Finite(elapsedMs) || elapsedMs < 0 || elapsedMs > MaximumProvenanceAgeMs)
                return false;
            Point3 route = target - source;
            double routeLength = Norm(route);
            if (!Finite(routeLength) || routeLength < 1.0 || routeLength > 30.0) return false;
            Point3 axis = new Point3(route.X / routeLength, route.Y / routeLength, route.Z / routeLength);
            Point3 displacement = position - source;
            double along = Dot(displacement, axis);
            if (!Finite(along) || along < -0.5 || along > routeLength + 0.5) return false;
            double sideSq = Dot(displacement, displacement) - along * along;
            if (!Finite(sideSq) || sideSq > MaximumCorridorErrorM * MaximumCorridorErrorM) return false;
            double speed = Norm(velocity), forward = Dot(velocity, axis);
            if (!Finite(speed) || !Finite(forward) || speed < MinimumForwardSpeed ||
                forward < MinimumForwardSpeed || forward / speed < MinimumDirectionCosine) return false;
            progressM = along;
            return true;
        }

        // Two distinct frames prove post-fire motion along the launcher axis, not
        // a single stationary baseline prop or a one-frame velocity artifact.
        public static bool Corroborates(Point3 source, Point3 target, Point3 first,
            Point3 next, int frameDelta)
        {
            if (!Finite(source) || !Finite(target) || !Finite(first) || !Finite(next) ||
                frameDelta < 1 || frameDelta > MaximumCorroborationFrames) return false;
            Point3 route = target - source;
            double length = Norm(route);
            if (!Finite(length) || length < 1.0 || length > 30.0) return false;
            Point3 delta = next - first;
            return Dot(delta, route) / length >= MinimumObservedProgressM;
        }
    }
}

// Pure selector is generated verbatim from selection/ImpactSectionSelector.cs.
namespace Astra.X7
{
    // Pure geometry policy. No GTA handles, native calls, aiming coordinates or mutable lifecycle state.
    public static class ImpactSectionSelector
    {
        // Frozen sec1/walk5 dimensions from ../spec.py. U is sheet-centred; V starts at sheet bottom.
        public const double Width = 2.536;
        public const double SheetHeight = 2.131;
        public const int SectionCount = 5;
        public const double SectionWidth = Width / SectionCount;
        public const double MinimumNormalSpeed = 3.0;
        // Policy guard against remote/stale predictions, not a measured native timing guarantee.
        public const double MaximumHorizonSeconds = 0.250;

        public struct Selection
        {
            public readonly int FirstIndex;
            public readonly int SecondIndex;
            public readonly int Mask;
            public readonly double ImpactU;
            public readonly double ImpactV;
            public readonly double TimeToFaceSeconds;

            internal Selection(int firstIndex, double u, double v, double timeToFaceSeconds)
            {
                FirstIndex = firstIndex;
                SecondIndex = firstIndex + 1;
                Mask = (1 << FirstIndex) | (1 << SecondIndex);
                ImpactU = u;
                ImpactV = v;
                TimeToFaceSeconds = timeToFaceSeconds;
            }
        }

        // Indices are physical negative-U to positive-U positions, never x7SecLabs list offsets.
        // Two adjacent sections give a nominal 1.0144m opening. Collision/traversal still need GTA proof.
        public static bool TrySelect(double impactU, double impactV, out Selection selection)
        {
            return TrySelectAtTime(impactU, impactV, 0.0, out selection);
        }

        static bool TrySelectAtTime(double u, double v, double time, out Selection selection)
        {
            selection = default(Selection);
            if (!Finite(u) || !Finite(v) || u < -Width / 2 || u > Width / 2 ||
                v < 0 || v > SheetHeight) return false;

            // Nearest adjacent-pair midpoint; exact ties go to the lower physical index.
            // Explicit boundaries avoid round-off from subtracting nearly equal midpoint distances.
            int first = u <= -SectionWidth ? 0 : u <= 0 ? 1 : u <= SectionWidth ? 2 : 3;
            selection = new Selection(first, u, v, time);
            return true;
        }

        // Caller projects world position/velocity onto the current wall's U/T/V basis first.
        // T increases toward the target face; only the existing front-side approach is supported.
        // This linear estimate is valid only for a fresh, identified projectile sample. It neither
        // identifies a projectile nor proves the path is unobstructed. Latch the successful result
        // once at commit; never use later samples to resurrect or reconfigure a damaged fence.
        public static bool TryPredictAndSelect(double u, double t, double v,
            double velocityU, double velocityT, double velocityV, double faceT,
            double horizonSeconds, out Selection selection)
        {
            selection = default(Selection);
            if (!Finite(u) || !Finite(t) || !Finite(v) || !Finite(velocityU) ||
                !Finite(velocityT) || !Finite(velocityV) || !Finite(faceT) ||
                !Finite(horizonSeconds) || horizonSeconds <= 0 ||
                horizonSeconds > MaximumHorizonSeconds || velocityT <= MinimumNormalSpeed)
                return false;

            double distance = faceT - t;
            if (!Finite(distance) || distance < 0) return false;
            double time = distance / velocityT;
            if (!Finite(time) || time > horizonSeconds) return false;
            return TrySelectAtTime(u + velocityU * time, v + velocityV * time, time, out selection);
        }

        static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }
}
