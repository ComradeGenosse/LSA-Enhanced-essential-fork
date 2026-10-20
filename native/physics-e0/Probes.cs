using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using Rage;
using Rage.Native;

namespace LSA.WPS.Lab
{
    // All native operations are invoked on this plugin's single game fiber.
    // No other LSA DLL or persistence service is linked or touched.
    internal sealed class LabRunner
    {
        readonly string root;
        readonly Settings cfg;
        readonly Ledger ledger=new Ledger();
        readonly CleanupBook owned=new CleanupBook();
        readonly Stopwatch clock=Stopwatch.StartNew();
        readonly JavaScriptSerializer json=new JavaScriptSerializer { MaxJsonLength=1048576 };
        readonly List<double> frames=new List<double>();
        readonly List<Sample> surfaceSamples=new List<Sample>();
        readonly List<Sample> wallSamples=new List<Sample>();
        string logDir, logFile, summaryFile, run, active, mode="single";
        bool cancelling, budgetArmed, hidden, changedIpl, originalIpl, changedTime;
        float originalScale=1f;
        int originalWanted=-1;
        long lastTick, began, lastSample, startGame, lastGame;
        int step, frame, objectIndex, sampleIndex, ammoLast=-1, ammoSpent, impacts;
        uint weapon;
        int target, collisionObject, losPedA, losPedB;
        int[] milestones={100,250,500,1000,2000};
        readonly List<object> evidence=new List<object>();
        // Deliberately limited to the four read-only pre-shot probes; never a gameplay automation loop.
        bool autoActive, autoHadBlockers;
        int autoIndex;
        string autoId, autoManifest;
        long autoBegan;
        readonly List<object> autoHistory=new List<object>();
        AutoSampleSite autoSite;
        Rage.Vector3 previousPlayerPos;
        float previousPlayerHeading;
        int previousPlayerHandle;
        bool teleportedPlayer, teleportFrozen, siteReady, teleportWasPerformed, teleportRestoreSucceeded, returningHome;
        long returnStarted;
        string autoTerminalState;
        long positionAttemptSince, positionMoveSince;
        int navSiteAttempt;
        static readonly int[] NavOffsetsX={0,16,-16,0,0,32,-32,32,-32,0,0,48,-48};
        static readonly int[] NavOffsetsY={0,0,0,16,-16,0,0,32,-32,48,-48,0,0};
        string positionStatus="not_requested";
        int destinationCollisionChecks, destinationStableFrames;
        CollisionStability destinationStability=new CollisionStability();
        long destinationLoadedMs;
        bool destinationCollisionVerified, returnCollisionVerified;
        long destinationSettleMs=-1, returnCollisionWaitMs=-1;
        double destinationDistanceM=-1, returnPositionErrorM=-1, returnHeadingErrorDeg=-1;
        int returnCollisionChecks;
        bool navRegionRequested, navmeshLoaded;
        int navQueries, navMisses, navRejected;
        string lastNavigationStatus="not_started";
        int phantomEntityHandle;long deletedAtMs,phantomFirstClearMs=-1;
        Sample confirmationSample;
        long confirmationAt;
        int confirmationOrdinal;
        public LabRunner(string gameRoot,Settings settings)
        {
            root=gameRoot;cfg=settings;cfg.Validate();
            logDir=Path.Combine(root,"Plugins","LSA.WPS.Lab.Results");
            Directory.CreateDirectory(logDir);
            LoadSamples();
        }
        void LoadSamples()
        {
            var path=Path.Combine(root,"Plugins","LSA.WPS.Lab.samples.json");
            if(!File.Exists(path))return;
            if(new FileInfo(path).Length>65536)throw new InvalidOperationException("samples_file_oversize");
            string content=File.ReadAllText(path);
            if(content.TrimStart().StartsWith("["))
            {
                // Legacy arrays are material samples only. Never quietly treat them as walls.
                var legacy=json.Deserialize<Sample[]>(content);
                if(legacy==null||legacy.Length>64)throw new InvalidOperationException("samples_file_invalid");
                foreach(var item in legacy){item.Validate();surfaceSamples.Add(item);}
                return;
            }
            var groups=json.Deserialize<SampleSets>(content);
            if(groups==null)throw new InvalidOperationException("samples_file_invalid");
            groups.Validate();
            surfaceSamples.AddRange(groups.surfaces);
            wallSamples.AddRange(groups.walls);
        }
        static object Vec(Rage.Vector3 p)=>new {x=p.X,y=p.Y,z=p.Z};
        Rage.Vector3 Pos=>new Rage.Vector3(cfg.x,cfg.y,cfg.z);
        Rage.Vector3 Target=>new Rage.Vector3(cfg.targetX,cfg.targetY,cfg.targetZ);
        static Rage.Vector3 V(float x,float y,float z)=>new Rage.Vector3(x,y,z);
        static int Hash(string name)=>unchecked((int)Census.Joaat(name));
        static int N(string name,params NativeArgument[] args)=>NativeFunction.CallByName<int>(name,args);
        static bool B(string name,params NativeArgument[] args)=>NativeFunction.CallByName<bool>(name,args);
        static float F(string name,params NativeArgument[] args)=>NativeFunction.CallByName<float>(name,args);
        static int Ped()=>N("PLAYER_PED_ID");
        long RealMs()=>clock.ElapsedMilliseconds;
        int GameMs()=>N("GET_GAME_TIMER");
        static string Version(string path)
        {
            try{return File.Exists(path)?FileVersionInfo.GetVersionInfo(path).FileVersion:"not_installed";}catch{return "unknown";}
        }
        static string Sha(string path)
        {
            if(!File.Exists(path))return "missing";
            using(var s=File.OpenRead(path))using(var h=SHA256.Create())
                return BitConverter.ToString(h.ComputeHash(s)).Replace("-","").ToLowerInvariant();
        }
        object Metadata()
        {
            string exe=Path.Combine(root,"GTA5_Enhanced.exe"), dll=Path.Combine(root,"Plugins","LSA.WPS.Lab.dll");
            string rph=Path.Combine(root,"RAGEPluginHook.exe");
            return new {gameVersion=Version(exe),gameExe=Path.GetFileName(exe),
                rphVersion=Version(rph),sdkVersion=typeof(Game).Assembly.GetName().Version.ToString(),
                pluginVersion="0.1.0-e0",pluginSha256=Sha(dll),
                scriptHookV=Version(Path.Combine(root,"ScriptHookV.dll")),
                scriptHookVDotNet=Version(Path.Combine(root,"ScriptHookVDotNet.asi")),
                openRpf=Version(Path.Combine(root,"OpenRPF.asi")),
                codeWalker="not_detected_external",
                cfg=cfg};
        }
        void Event(string kind,object details=null)
        {
            if(string.IsNullOrEmpty(logFile))return;
            object row=new {v=1,exp=active,run,build=Version(Path.Combine(root,"GTA5_Enhanced.exe")),
                rph=Version(Path.Combine(root,"RAGEPluginHook.exe")),
                plugin="0.1.0-e0",t_game_ms=SafeGameTime(),t_real_ms=RealMs()-began,
                frame,kind,details};
            string line=json.Serialize(row);
            File.AppendAllText(logFile,"[WPS-LAB] "+line+Environment.NewLine,Encoding.UTF8);
        }
        int SafeGameTime(){try{return GameMs();}catch{return -1;}}
        void Note(string kind,object data=null){evidence.Add(new {kind,data});Event(kind,data);}
        void Console(string text){Game.Console.Print("[WPS-LAB] "+text);Game.LogTrivial("[WPS-LAB] "+text);}
        void SaveSummary(string status,string reason)
        {
            if(string.IsNullOrEmpty(summaryFile))return;
            var report=new {exp=active,run,status,reason,mode,
                environment=Metadata(),frameTimeMs=new {p50=Census.Percentile(frames,.50),
                    p95=Census.Percentile(frames,.95),p99=Census.Percentile(frames,.99),
                    max=frames.Count>0?frames.Max():0},
                samples=frames.Count,events=evidence.ToArray(),statuses=ledger.Snapshot(),
                caveat="Native observations are GTA-only; an offline compiler cannot verify gameplay behavior."};
            File.WriteAllText(summaryFile,json.Serialize(report),Encoding.UTF8);
        }
        void Require(bool yes,string reason)
        {
            if(!yes)throw new InvalidOperationException("BLOCKED:"+reason);
        }
        bool SafeWorld()
        {
            return !B("NETWORK_IS_SESSION_ACTIVE") && !B("IS_CUTSCENE_ACTIVE") &&
                !B("IS_PLAYER_SWITCH_IN_PROGRESS") && !B("GET_MISSION_FLAG") &&
                !Game.IsLoading;
        }
        void RequireSite()
        {
            Require(cfg.HasSite && cfg.HasTarget,"configure_site_and_target");
            Rage.Vector3 p=Game.LocalPlayer.Character.Position;
            Require(Census.Distance(p.X,p.Y,p.Z,cfg.x,cfg.y,cfg.z)>30,
                "test_site_must_be_at_least_30m_from_player");
        }
        public void StartAuto()
        {
            if(autoActive || active!=null || returningHome){Console("Cannot start suite while a probe/suite or return transport is active");return;}
            autoId=Guid.NewGuid().ToString("N");
            autoManifest=Path.Combine(logDir,DateTime.UtcNow.ToString("yyyyMMdd-HHmmss")+"-pre-shot-"+autoId+".suite.json");
            autoHistory.Clear();autoIndex=0;autoActive=true;autoHadBlockers=false;autoBegan=RealMs();
            siteReady=false;positionAttemptSince=0;positionMoveSince=0;navSiteAttempt=0;positionStatus=cfg.autoTeleportForSamples?"pending":"not_requested";
            teleportedPlayer=false;teleportFrozen=false;previousPlayerHandle=0;autoSite=null;
            teleportWasPerformed=false;teleportRestoreSucceeded=false;returningHome=false;
            destinationCollisionChecks=destinationStableFrames=returnCollisionChecks=0;
            destinationStability=new CollisionStability();destinationLoadedMs=0;
            navRegionRequested=navmeshLoaded=false;navQueries=navMisses=navRejected=0;
            lastNavigationStatus="not_started";
            destinationCollisionVerified=returnCollisionVerified=false;
            destinationSettleMs=returnCollisionWaitMs=-1;
            destinationDistanceM=returnPositionErrorM=returnHeadingErrorDeg=-1;
            autoTerminalState="";
            WriteAuto("waiting_for_safe_story_mode");
            Console("Pre-shot suite queued: E0.0-E0.3 ONLY; no shooting or world changes. It waits for safe story-mode free roam. WPSE0Cancel stops it.");
        }
        void WriteAuto(string state)
        {
            if(string.IsNullOrEmpty(autoManifest))return;
            var next=autoIndex<PreShotPlan.Ids.Length?PreShotPlan.Ids[autoIndex]:null;
            var report=new {type="E0_pre_shot_unattended",run=autoId,state,readOnly=true,
                planned=PreShotPlan.Ids,next,active,results=autoHistory.ToArray(),
                autoTeleportEnabled=cfg.autoTeleportForSamples,positionStatus,
                transport=new {teleportWasPerformed,destinationCollisionVerified,
                    destinationCollisionChecks,destinationStableFrames,destinationSettleMs,
                    destinationDistanceM,destinationLoadedMs,returnCollisionVerified,returnCollisionChecks,returnCollisionWaitMs,
                    returnPositionErrorM,returnHeadingErrorDeg,
                    navRegionRequested,navmeshLoaded,navQueries,navMisses,navRejected,lastNavigationStatus},
                restoredOriginalPosition=!teleportWasPerformed||teleportRestoreSucceeded,
                materialReferenceCount=surfaceSamples.Count,wallReferenceCount=wallSamples.Count,
                missingMaterialReference=PreShotPlan.MissingGroundTruth("E0.2",surfaceSamples.Count),
                missingWallReference=PreShotPlan.MissingGroundTruth("E0.3",wallSamples.Count),
                caveat="Missing CodeWalker material/wall ground truth is BLOCKED, not verified. No E0.4 or E0.5-E0.12 is authorized."};
            File.WriteAllText(autoManifest,json.Serialize(report),Encoding.UTF8);
        }
        void StopAuto(string state)
        {
            if(!autoActive)return;
            autoActive=false;autoTerminalState=state;RestoreAutoPosition();
            ReleaseNavigationRegion();
            WriteAuto(returningHome?"returning_home":state);
            Console("Pre-shot suite "+state+(returningHome?" (returning player to original area)":"")+
                ". Manifest: "+Path.GetFileName(autoManifest));
        }
        // Opt-in transport applies only to the pre-shot suite, never to manual experiments.
        // Samples define a search region; their collision points are never used for ped placement.
        bool PrepareAutoPosition()
        {
            if(!cfg.autoTeleportForSamples)return true;
            if(siteReady)return true;
            if(positionAttemptSince==0)positionAttemptSince=RealMs();
            if(RealMs()-positionAttemptSince>30000)
            {
                lastNavigationStatus=positionStatus;
                positionStatus="blocked_safe_navigation_or_collision_timeout";
                StopAuto(positionStatus);return false;
            }
            if(surfaceSamples.Count<30 && wallSamples.Count<10)
            {
                positionStatus="skipped_no_samples";siteReady=true;return true;
            }
            if(autoSite==null)
            {
                try{autoSite=AutoSampleSite.Build(surfaceSamples,wallSamples);}
                catch(ArgumentException e){positionStatus="blocked_"+e.Message;StopAuto(positionStatus);return false;}
            }
            int ped=Ped();
            if(ped<=0||B("IS_PED_IN_ANY_VEHICLE",ped,false)||B("IS_PED_DEAD_OR_DYING",ped,true)||
                B("IS_PED_RAGDOLL",ped))
            {
                positionStatus="blocked_player_not_on_foot_and_stable";
                StopAuto(positionStatus);return false;
            }
            // A nearby ped still needs verified collision; after teleport this MUST
            // execute before any nearby shortcut (old gate-ordering bug).
            Rage.Vector3 current=Game.LocalPlayer.Character.Position;
            if(teleportedPlayer)
                return CheckDestinationReady(ped);
            if(autoSite.IsNearby(current.X,current.Y))
            {
                if(positionMoveSince==0)positionMoveSince=RealMs();
                positionStatus="nearby_waiting_for_collision";
                return CheckDestinationReady(ped);
            }
            if(!teleportedPlayer)
            {
                // Collision requests do not stream distant navigation polygons.
                // Request one bounded region before querying safe pavement. Never
                // teleport to sample geometry or weaken the safe-coordinate gate.
                if(!navRegionRequested)
                {
                    N("ADD_NAVMESH_REQUIRED_REGION",(float)autoSite.x,(float)autoSite.y,100f);
                    navRegionRequested=true;
                    Console("Requested bounded navigation region for private sample site.");
                }
                navmeshLoaded=B("IS_NAVMESH_LOADED_IN_AREA",
                    (float)(autoSite.x-50),(float)(autoSite.y-50),(float)(autoSite.z-32),
                    (float)(autoSite.x+50),(float)(autoSite.y+50),(float)(autoSite.z+32));
                int index=navSiteAttempt++%NavOffsetsX.Length;
                float searchX=(float)autoSite.x+NavOffsetsX[index];
                float searchY=(float)autoSite.y+NavOffsetsY[index];
                N("REQUEST_COLLISION_AT_COORD",searchX,searchY,(float)autoSite.z);
                using(var outPos=new NativePointer(24))
                {
                    // 14 excludes isolated, interior and water navmesh.
                    bool found=B("GET_SAFE_COORD_FOR_PED",searchX,searchY,
                        (float)(autoSite.z+3),true,outPos,14);
                    navQueries++;
                    if(!found){navMisses++;positionStatus="searching_safe_pavement";return false;}
                    Rage.Vector3 safe=outPos.GetValue<Rage.Vector3>();
                    if(!autoSite.AcceptSafeCoord(safe.X,safe.Y,safe.Z))
                    {
                        navRejected++;positionStatus="searching_safe_pavement_inside_bounded_area";return false;
                    }
                    previousPlayerPos=Game.LocalPlayer.Character.Position;
                    previousPlayerHeading=F("GET_ENTITY_HEADING",ped);
                    previousPlayerHandle=ped;teleportedPlayer=true;teleportWasPerformed=true;
                    try
                    {
                        N("FREEZE_ENTITY_POSITION",ped,true);teleportFrozen=true;
                        N("SET_ENTITY_COORDS_NO_OFFSET",ped,safe.X,safe.Y,safe.Z+.75f,false,true,true);
                        N("REQUEST_COLLISION_AT_COORD",safe.X,safe.Y,safe.Z);
                        positionMoveSince=RealMs();destinationStableFrames=0;
                        positionStatus="waiting_for_collision";
                        WriteAuto("teleporting");
                        Console("Relocated to safe pavement near private samples; waiting for collision. Original location will be restored.");
                    }
                    catch
                    {
                        positionStatus="failed_during_teleport";
                        RestoreAutoPosition();throw;
                    }
                }
                return false;
            }
            return CheckDestinationReady(ped);
        }
        void ReleaseNavigationRegion()
        {
            if(!navRegionRequested)return;
            try{N("REMOVE_NAVMESH_REQUIRED_REGIONS");navRegionRequested=false;}
            catch(Exception e){Console("Navigation region release failed: "+e.GetType().Name);}
        }
        bool CheckDestinationReady(int ped)
        {
            if(autoSite==null)return false;
            Rage.Vector3 at=Game.LocalPlayer.Character.Position;
            N("REQUEST_COLLISION_AT_COORD",at.X,at.Y,at.Z);
            bool nearby=autoSite.IsNearby(at.X,at.Y);
            bool loaded=B("HAS_COLLISION_LOADED_AROUND_ENTITY",ped);
            destinationCollisionChecks++;
            destinationDistanceM=Census.Distance(at.X,at.Y,0,autoSite.x,autoSite.y,0);
            bool stable=destinationStability.Poll(nearby,loaded,RealMs());
            destinationStableFrames=destinationStability.Checks;
            destinationLoadedMs=destinationStability.LoadedMs;
            long settledFor=Math.Max(0,RealMs()-positionMoveSince);
            if(!stable)
            {
                positionStatus=loaded?"waiting_for_collision_stability":"waiting_for_destination_collision";
                return false;
            }
            destinationSettleMs=settledFor;
            destinationCollisionVerified=true;
            if(teleportFrozen){N("FREEZE_ENTITY_POSITION",ped,false);teleportFrozen=false;}
            siteReady=true;positionStatus=teleportedPlayer?"destination_collision_verified":"nearby_collision_verified";
            WriteAuto("position_ready");
            Console("Destination collision confirmed after "+settledFor+" ms / "+destinationCollisionChecks+" polls; starting E0.2/E0.3.");
            return true;
        }
        // Returning a player across streamed regions also needs collision before unfreezing.
        void RestoreAutoPosition()
        {
            if(!teleportedPlayer)return;
            try
            {
                if(!B("NETWORK_IS_SESSION_ACTIVE") &&
                    previousPlayerHandle>0 && Ped()==previousPlayerHandle &&
                    B("DOES_ENTITY_EXIST",previousPlayerHandle))
                {
                    int ped=previousPlayerHandle;
                    N("FREEZE_ENTITY_POSITION",ped,true);teleportFrozen=true;
                    N("REQUEST_COLLISION_AT_COORD",previousPlayerPos.X,previousPlayerPos.Y,previousPlayerPos.Z);
                    N("SET_ENTITY_COORDS_NO_OFFSET",ped,previousPlayerPos.X,previousPlayerPos.Y,previousPlayerPos.Z,false,true,true);
                    N("SET_ENTITY_HEADING",ped,previousPlayerHeading);
                    returningHome=true;returnStarted=RealMs();
                    positionStatus+="_return_streaming";
                }
                else positionStatus+="_restoration_blocked_player_identity_or_session";
            }
            catch(Exception e){positionStatus+="_restoration_error_"+e.GetType().Name;}
            finally
            {
                teleportedPlayer=false;
                // Keep frozen until collision actually streams; if restoring was not started,
                // release an owned freeze so the player is not left stuck.
                if(!returningHome)ReleaseTransportFreeze();
            }
        }
        void ReleaseTransportFreeze()
        {
            if(!teleportFrozen)return;
            try
            {
                if(previousPlayerHandle>0 && Ped()==previousPlayerHandle)
                    N("FREEZE_ENTITY_POSITION",previousPlayerHandle,false);
            }
            catch{}
            teleportFrozen=false;
        }
        void TickReturn()
        {
            if(!returningHome)return;
            bool collision=false;
            returnCollisionChecks++;
            try
            {
                if(!B("NETWORK_IS_SESSION_ACTIVE") && Ped()==previousPlayerHandle &&
                    B("DOES_ENTITY_EXIST",previousPlayerHandle))
                {
                    N("REQUEST_COLLISION_AT_COORD",previousPlayerPos.X,previousPlayerPos.Y,previousPlayerPos.Z);
                    var current=Game.LocalPlayer.Character.Position;
                    returnPositionErrorM=Census.Distance(current.X,current.Y,current.Z,
                        previousPlayerPos.X,previousPlayerPos.Y,previousPlayerPos.Z);
                    returnHeadingErrorDeg=DestinationGate.HeadingError(previousPlayerHeading,
                        F("GET_ENTITY_HEADING",previousPlayerHandle));
                    collision=returnPositionErrorM<5 &&
                        B("HAS_COLLISION_LOADED_AROUND_ENTITY",previousPlayerHandle);
                }
            }
            catch{}
            if(collision && RealMs()-returnStarted>=400)
            {
                ReleaseTransportFreeze();returningHome=false;
                teleportRestoreSucceeded=true;returnCollisionVerified=true;
                returnCollisionWaitMs=RealMs()-returnStarted;
                positionStatus+="_original_position_restored";
                WriteAuto(autoTerminalState);Console("Original player position and streamed collision restored.");
            }
            else if(RealMs()-returnStarted>30000)
            {
                ReleaseTransportFreeze();returningHome=false;
                returnCollisionWaitMs=RealMs()-returnStarted;
                positionStatus+="_return_collision_timeout_unverified";
                WriteAuto(autoTerminalState+"_return_collision_not_verified");
                Console("WARNING: original area collision not verified after return; manual check required.");
            }
        }
        bool WorldReady()
        {
            try{if(!SafeWorld())return false;int ped=Ped();return ped>0 && B("DOES_ENTITY_EXIST",ped);}
            catch{return false;}
        }
        void TickAuto()
        {
            if(!autoActive)return;
            if(RealMs()-autoBegan>900000){StopAuto("timed_out_waiting_for_safe_story_mode");return;}
            if(!WorldReady())return;
            if(autoIndex>=PreShotPlan.Ids.Length){StopAuto(autoHadBlockers?"completed_with_blockers":"completed");return;}
            string next=PreShotPlan.Ids[autoIndex];
            if(!PreShotPlan.Allows(next)){StopAuto("unsafe_probe_refused");return;}
            if(autoIndex>=2)
            {
                try{if(!PrepareAutoPosition())return;}
                catch(Exception e){positionStatus="position_error_"+e.GetType().Name;
                    StopAuto("position_error");return;}
            }
            StartInternal(next);
            if(active!=next)StopAuto("start_blocked_"+next);
            else WriteAuto("running");
        }
        public void Start(string id)
        {
            if(autoActive){Console("Pre-shot suite is active; use WPSE0Cancel before manual probes");return;}
            StartInternal(id);
        }
        void StartInternal(string id)
        {
            if(!Census.ValidId(id)){Console("Unknown probe: "+id);return;}
            if(active!=null){Console("Probe already active; cancel first");return;}
            if(!SafeWorld()){Console("BLOCKED: load single-player free-roam, no cutscene/mission/online");return;}
            if(id=="E0.9"&&!budgetArmed){Console("BLOCKED: WPSE0ArmBudget required for each E0.9 run");return;}
            if(id=="E0.9")budgetArmed=false;
            active=id;run=Guid.NewGuid().ToString("N");began=RealMs();startGame=GameMs();step=frame=sampleIndex=0;
            objectIndex=0;cancelling=false;frames.Clear();evidence.Clear();
            confirmationSample=null;confirmationOrdinal=0;confirmationAt=0;
            ammoLast=-1;ammoSpent=0;impacts=0;weapon=0;target=collisionObject=losPedA=losPedB=0;
            lastSample=lastTick=RealMs();lastGame=startGame;
            logFile=Path.Combine(logDir,DateTime.UtcNow.ToString("yyyyMMdd-HHmmss")+"-"+id.Replace(".","_")+"-"+run+".jsonl");
            summaryFile=Path.ChangeExtension(logFile,".summary.json");
            Note("start",new {probe=id,settings=cfg,mode,environment=Metadata(),sampleCount=surfaceSamples.Count+wallSamples.Count,
                inputEvidence="user_configured",surfaceSampleCount=surfaceSamples.Count,wallSampleCount=wallSamples.Count,allowNoop=false});
            Console("Started "+id+" run "+run.Substring(0,8)+" (WPSE0Cancel is emergency stop)");
        }
        public void Status()
        {
            if(autoActive)Console("Pre-shot suite: "+(autoIndex+1)+"/"+PreShotPlan.Ids.Length+
                " "+(active??"waiting for safe story-mode")+"; manifest: "+Path.GetFileName(autoManifest));
            else if(!string.IsNullOrEmpty(autoManifest))Console("Last pre-shot suite: "+Path.GetFileName(autoManifest));
            Console("Active: "+(active??"none")+" "+(active==null?"":"frame "+frame)+"; stored verdicts: "+
                string.Join(", ",ledger.Snapshot().Select(x=>x.Key+"="+x.Value)));
            if(active!=null)Console("Log: "+logFile);
        }
        public void Mode(string value)
        {
            if(active!=null){Console("Mode locked during a run");return;}
            if(!new[]{"single","burst","auto","shotgun","npc"}.Contains(value)){Console("Invalid mode");return;}
            mode=value;Console("E0.4 mode set: "+mode);
        }
        public void ArmBudget(){budgetArmed=true;Console("E0.9 armed for exactly one run; capped at "+cfg.entityLimit);}
        public void SignalCancel(){cancelling=true;}
        public void Cancel(string reason)
        {
            cancelling=true;
            if(active!=null)Finish("NOT_TESTED",reason);
            if(autoActive)StopAuto("cancelled_"+reason);
        }
        public void Reset()
        {
            Cancel("reset");
            foreach(var id in Census.Ids)ledger.Mark(id,"NOT_TESTED");
            budgetArmed=false;Console("Memory reset; on-disk experiment evidence retained.");
        }
        public void Shutdown()
        {
            cancelling=true;
            if(active!=null)Finish("NOT_TESTED","unload");else Cleanup();
            if(autoActive)StopAuto("unloaded");
            if(returningHome)
            {
                // The plugin is unloading, so it cannot keep polling for collision.
                returningHome=false;ReleaseTransportFreeze();
                positionStatus+="_unload_before_return_collision_confirmed";
                WriteAuto(autoTerminalState+"_return_unverified");
            }
        }
        public void Tick()
        {
            if(active==null){TickReturn();TickAuto();return;}
            if(cancelling){Finish("NOT_TESTED","cancel_requested");if(autoActive)StopAuto("cancelled");return;}
            frame++;
            long now=RealMs();
            if(frame>1 && now-lastTick>=0 && now-lastTick<2000) {
                frames.Add(now-lastTick);
                if(frames.Count>12000)frames.RemoveAt(0);
            }
            lastTick=now;
            if(now-began>90000){Finish("FAILED","watchdog_90s");return;}
            if(!SafeWorld()){Finish("BLOCKED","world_gate_changed");if(autoActive)StopAuto("world_gate_changed");return;}
            try {
                bool finished=Dispatch();
                if(finished)Finish("GTA_VERIFIED","observations_captured_review_hypothesis");
                else if(now-lastSample>=10000){Note("heartbeat",new {step,frame,objects=owned.Count});lastSample=now;}
            }catch(InvalidOperationException e)when(e.Message.StartsWith("BLOCKED:"))
            {Finish("BLOCKED",e.Message.Substring(8));}
            catch(Exception e){Note("error",new {type=e.GetType().Name,message=e.Message});Finish("FAILED","native_or_probe_exception");}
        }
        bool Dispatch()
        {
            switch(active) {
                case "E0.0":return Toolchain();
                case "E0.1":return Natives();
                case "E0.2":return Materials();
                case "E0.3":return Thickness();
                case "E0.4":return Shots();
                case "E0.5":return PropRemoval();
                case "E0.6":return Continuation();
                case "E0.7":return ModelHide();
                case "E0.8":return Fragments();
                case "E0.9":return Budget();
                case "E0.10":return Explosions();
                case "E0.11":return Ipl();
                case "E0.12":return TimeScale();
                default:throw new InvalidOperationException("BLOCKED:unknown_probe");
            }
        }
        void Finish(string status,string reason)
        {
            if(active==null)return;
            if(!Cleanup()) {status="FAILED";reason="cleanup_failed_"+reason;}
            ledger.Mark(active,status);
            Note("verdict",new {status,reason,frame,probe=active});
            SaveSummary(status,reason);
            Console(active+" "+status+": "+reason+" log "+Path.GetFileName(logFile));
            bool suiteStep=autoActive && autoIndex<PreShotPlan.Ids.Length && active==PreShotPlan.Ids[autoIndex];
            if(suiteStep){
                autoHistory.Add(new {probe=active,status,reason,log=Path.GetFileName(logFile),summary=Path.GetFileName(summaryFile)});
                if(status!="GTA_VERIFIED")autoHadBlockers=true;
                autoIndex++;
                WriteAuto(autoIndex>=PreShotPlan.Ids.Length?(autoHadBlockers?"completed_with_blockers":"completed"):"running");
            }
            active=null;run=null;logFile=summaryFile=null;
            evidence.Clear();frames.Clear();cancelling=false;
            if(suiteStep && autoIndex>=PreShotPlan.Ids.Length)StopAuto(autoHadBlockers?"completed_with_blockers":"completed");
        }
        bool Cleanup()
        {
            bool ok=true;
            // Restore reversible modifications before deleting local entities.
            if(changedTime){try{N("SET_TIME_SCALE",originalScale);}catch{ok=false;}changedTime=false;}
            if(changedIpl){try{if(originalIpl)N("REQUEST_IPL",cfg.ipl);else N("REMOVE_IPL",cfg.ipl);}
                catch{ok=false;}changedIpl=false;}
            if(hidden){try{N("REMOVE_MODEL_HIDE",cfg.x,cfg.y,cfg.z,cfg.radius,Hash(cfg.mapModel),true);}
                catch{ok=false;}hidden=false;}
            foreach(int h in owned.Drain()){
                try{if(!B("DOES_ENTITY_EXIST",h))continue;int handle=h;using(var p=new NativePointer(8)){p.SetValue<int>(handle);N("SET_ENTITY_AS_MISSION_ENTITY",handle,true,true);N("DELETE_ENTITY",p);}}
                catch{ok=false;}
            }
            if(originalWanted>=0){try{N("SET_PLAYER_WANTED_LEVEL",N("PLAYER_ID"),originalWanted,false);
                N("SET_PLAYER_WANTED_LEVEL_NOW",N("PLAYER_ID"),false);}catch{ok=false;}originalWanted=-1;}
            try{if(!string.IsNullOrEmpty(cfg.propModel))N("SET_MODEL_AS_NO_LONGER_NEEDED",Hash(cfg.propModel));
                if(!string.IsNullOrEmpty(cfg.fragModel))N("SET_MODEL_AS_NO_LONGER_NEEDED",Hash(cfg.fragModel));
                if(!string.IsNullOrEmpty(cfg.pedModel))N("SET_MODEL_AS_NO_LONGER_NEEDED",Hash(cfg.pedModel));}
            catch{ok=false;}
            if(active!=null)Note("cleanup",new {success=ok,ownedRemaining=owned.Count,iplRestored=!changedIpl,timeRestored=!changedTime,hideRestored=!hidden});
            return ok;
        }
        bool Toolchain()
        {
            if(step++>0)return true;
            Note("toolchain",Metadata());
            bool ok=B("DOES_ENTITY_EXIST",Ped());
            Note("no_op_native",new {name="DOES_ENTITY_EXIST",result=ok});
            return true;
        }
        sealed class Ray
        {
            public int state;public bool hit;public Rage.Vector3 where,normal;public int material,entity;
        }
        // options: the native's final argument. 7 is the baseline used by every original E0 sample;
        // GT4 showed bit value 2 hides see-through-class surfaces, so 0 is the side-by-side comparison.
        Ray Trace(Rage.Vector3 a,Rage.Vector3 b,int flags=17,int ignore=0,int options=7)
        {
            int ticket=N("START_EXPENSIVE_SYNCHRONOUS_SHAPE_TEST_LOS_PROBE",
                a.X,a.Y,a.Z,b.X,b.Y,b.Z,flags,ignore,options);
            Require(ticket!=0,"shape_test_no_ticket");
            using(var didHit=new NativePointer(8))
            using(var point=new NativePointer(24))
            using(var normal=new NativePointer(24))
            using(var material=new NativePointer(8))
            using(var entity=new NativePointer(8)) {
                int state=N("GET_SHAPE_TEST_RESULT_INCLUDING_MATERIAL",ticket,didHit,point,normal,material,entity);
                return new Ray{state=state,hit=didHit.GetValue<int>()!=0,
                    where=point.GetValue<Rage.Vector3>(),normal=normal.GetValue<Rage.Vector3>(),
                    material=material.GetValue<int>(),entity=entity.GetValue<int>()};
            }
        }
        object Describe(Ray r)=>new {state=r.state,hit=r.hit,at=Vec(r.where),normal=Vec(r.normal),
            materialHash=unchecked((uint)r.material),entity=r.entity};
        static RayObs Obs(Ray r)=>new RayObs(r.hit,unchecked((uint)r.material),r.entity,r.where.X,r.where.Y,r.where.Z);
        object DescribeOpt(Ray r,int options)=>new {options,state=r.state,hit=r.hit,at=Vec(r.where),normal=Vec(r.normal),
            materialHash=unchecked((uint)r.material),entity=r.entity};
        // Advance-past-hit scan from a toward b (read-only). Returns every surface found, in order, with its raw ray.
        // Layer tables are descriptive only and are never reported as wall thickness.
        List<Ray> ScanRays(Rage.Vector3 a,Rage.Vector3 b,int options,int maxLayers)
        {
            var hits=new List<Ray>();
            double len=Census.Distance(a.X,a.Y,a.Z,b.X,b.Y,b.Z);
            if(len<=LayerAnalysis.AdvanceM)return hits;
            float dx=(float)((b.X-a.X)/len),dy=(float)((b.Y-a.Y)/len),dz=(float)((b.Z-a.Z)/len);
            var from=a;
            for(int i=0;i<Math.Min(maxLayers,LayerAnalysis.MaxLayers);i++)
            {
                Ray r=Trace(from,b,17,0,options);
                if(!r.hit)break;
                hits.Add(r);
                double d=Census.Distance(a.X,a.Y,a.Z,r.where.X,r.where.Y,r.where.Z);
                if(d>=len-LayerAnalysis.AdvanceM)break;
                from=V(r.where.X+dx*(float)LayerAnalysis.AdvanceM,r.where.Y+dy*(float)LayerAnalysis.AdvanceM,
                    r.where.Z+dz*(float)LayerAnalysis.AdvanceM);
            }
            return hits;
        }
        static List<LayerObs> LayersOf(Rage.Vector3 a,List<Ray> hits)=>hits.Select(r=>new LayerObs(
            Census.Distance(a.X,a.Y,a.Z,r.where.X,r.where.Y,r.where.Z),unchecked((uint)r.material),r.entity)).ToList();
        object RowsOf(Rage.Vector3 a,List<Ray> hits)=>hits.Select((r,i)=>(object)new {i,
            distanceM=Census.Distance(a.X,a.Y,a.Z,r.where.X,r.where.Y,r.where.Z),materialHash=unchecked((uint)r.material),
            entity=r.entity,at=Vec(r.where),normal=Vec(r.normal)}).ToList();
        object LayerTable(Rage.Vector3 a,List<Ray> hits)
        {
            var l=LayersOf(a,hits);
            return new {summary=LayerAnalysis.Describe(l),entityChanges=LayerAnalysis.EntityChanges(l),
                materialChanges=LayerAnalysis.MaterialChanges(l),count=l.Count,rows=RowsOf(a,hits)};
        }
        object MaterialLayers(Sample item)=>LayerTable(V(item.ax,item.ay,item.az),
            ScanRays(V(item.ax,item.ay,item.az),V(item.bx,item.by,item.bz),OptionsAnalysis.Alternate,4));
        // Forward+reverse scans of one segment and the entry/exit candidates they imply (game observations only).
        sealed class SegmentScan
        {
            public List<Ray> fwd,rev;public List<LayerObs> fl,rl;public double len;public List<PairCandidate> pairs;
        }
        SegmentScan ScanSegment(Rage.Vector3 a,Rage.Vector3 b,int maxLayers)
        {
            var ss=new SegmentScan{len=Census.Distance(a.X,a.Y,a.Z,b.X,b.Y,b.Z)};
            ss.fwd=ScanRays(a,b,OptionsAnalysis.Alternate,maxLayers);ss.rev=ScanRays(b,a,OptionsAnalysis.Alternate,maxLayers);
            ss.fl=LayersOf(a,ss.fwd);ss.rl=LayersOf(b,ss.rev);ss.pairs=PairSearch.Candidates(ss.fl,ss.rl,ss.len);
            return ss;
        }
        object PairRows(SegmentScan ss)=>ss.pairs.Select(c=>(object)new {forwardLayer=c.Forward,reverseLayer=c.Reverse,
            separationM=c.SeparationM,entity=ss.fl[c.Forward].Entity,materialHash=ss.fl[c.Forward].Material}).ToList();
        // Oblique angle-consistency of a UNIQUE normal-incidence candidate pair s0 (read-only, game observations only):
        // tilted lines through the candidate's entry point must show a same-entity/same-material pair separated by s0/cos(theta).
        object Oblique(SegmentScan normal,out string corroboration)
        {
            var angles=new List<string>();var rows=new List<object>();
            if(PairSearch.Describe(normal.pairs)!="UNIQUE_PAIR"){corroboration=PairSearch.Corroborate(PairSearch.Describe(normal.pairs),angles);return rows;}
            var cand=normal.pairs[0];Ray entry=normal.fwd[cand.Forward];
            foreach(double angle in new[]{20.0,40.0})
            {
                double[] s0,e0;
                try{ObliqueAnalysis.Build(entry.where.X,entry.where.Y,entry.where.Z,entry.normal.X,entry.normal.Y,entry.normal.Z,
                    angle,1.0,cand.SeparationM,1.5,out s0,out e0);}
                catch(ArgumentException){angles.Add("NO_NORMAL");rows.Add(new {angleDeg=angle,result="NO_NORMAL"});continue;}
                var ss=ScanSegment(V((float)s0[0],(float)s0[1],(float)s0[2]),V((float)e0[0],(float)e0[1],(float)e0[2]),6);
                string result=PairSearch.AngleConsistency(ss.pairs,cand.SeparationM,angle);angles.Add(result);
                rows.Add(new {angleDeg=angle,expectedPathM=ObliqueAnalysis.ExpectedPath(cand.SeparationM,angle),result,
                    pairs=PairRows(ss),forwardLayers=LayerAnalysis.Describe(ss.fl),reverseLayers=LayerAnalysis.Describe(ss.rl)});
            }
            corroboration=PairSearch.Corroborate(PairSearch.Describe(normal.pairs),angles);
            return rows;
        }
        // Streamed-collision/settling state at the moment of the observation (unchanged gate, recorded for audit).
        object GateState()=>new {destinationCollisionVerified,destinationCollisionChecks,destinationLoadedMs,
            destinationStableFrames,positionStatus};
        bool Natives()
        {
            if(step++>0)return true;
            // E0.1 is read-only: when site coordinates are missing, a short local ray is
            // sufficient for an API-callability census, but NOT calibrated geometry evidence.
            Rage.Vector3 source=cfg.HasSite?Pos:Game.LocalPlayer.Character.Position;
            if(!cfg.HasSite)source=V(source.X,source.Y,source.Z+1.2f);
            Rage.Vector3 destination=cfg.HasTarget?Target:V(source.X+6f,source.Y,source.Z);
            Note("matrix_ray_context",new {source=Vec(source),destination=Vec(destination),
                calibrated=cfg.HasSite&&cfg.HasTarget,
                caveat="Local fallback ray only checks callability; it is not CodeWalker ground truth."});
            var results=new List<object>();
            Action<string,Func<object>> call=(name,read)=>{
                try{results.Add(new {name,callable=true,result=read(),error=(string)null});}
                catch(Exception e){results.Add(new {name,callable=false,result=(object)null,error=e.GetType().Name+":"+e.Message});}
            };
            call("NETWORK_IS_SESSION_ACTIVE",()=>B("NETWORK_IS_SESSION_ACTIVE"));
            call("IS_PED_SHOOTING",()=>B("IS_PED_SHOOTING",Ped()));
            call("GET_SELECTED_PED_WEAPON",()=>N("GET_SELECTED_PED_WEAPON",Ped()));
            call("IS_IPL_ACTIVE",()=>B("IS_IPL_ACTIVE",string.IsNullOrEmpty(cfg.ipl)?"hei_carrier":cfg.ipl));
            call("IS_EXPLOSION_IN_SPHERE",()=>B("IS_EXPLOSION_IN_SPHERE",0,cfg.x,cfg.y,cfg.z,3f));
            call("GET_OWNER_OF_EXPLOSION_IN_SPHERE",()=>N("GET_OWNER_OF_EXPLOSION_IN_SPHERE",0,cfg.x,cfg.y,cfg.z,3f));
            // Never pass a fabricated/invalid entity handle in unattended tests.
            // This native is exercised only by E0.8 after spawning a verified lab-owned fragment prop.
            call("GET_AMMO_IN_CLIP",()=>ReadAmmo(Ped(),unchecked((uint)N("GET_SELECTED_PED_WEAPON",Ped()))));
            call("GET_PED_LAST_WEAPON_IMPACT_COORD",()=>LastImpact(Ped()).valid);
            call("START_EXPENSIVE_SYNCHRONOUS_SHAPE_TEST_LOS_PROBE+GET_SHAPE_TEST_RESULT_INCLUDING_MATERIAL",()=>Describe(Trace(source,destination)));
            call("RPH Game.TimeScale",()=>Game.TimeScale);
            Note("native_matrix",results);
            // Mutating natives are checked only in their dedicated opt-in probes, never as side effects of E0.1.
            Note("native_matrix_deferred",new {names=new[]{"REQUEST_MODEL","CREATE_OBJECT_NO_OFFSET","DELETE_ENTITY",
                "FREEZE_ENTITY_POSITION","BREAK_OBJECT_FRAGMENT_CHILD","CREATE_MODEL_HIDE",
                "REMOVE_MODEL_HIDE","GET_OBJECT_FRAGMENT_DAMAGE_HEALTH",
                "SHOOT_SINGLE_BULLET_BETWEEN_COORDS_IGNORE_ENTITY_NEW",
                "REQUEST_IPL","REMOVE_IPL","SET_TIME_SCALE","ADD_EXPLOSION"},
                reason="unsafe_without_dedicated_test_context"});
            return true;
        }
        int ReadAmmo(int ped,uint gun)
        {
            using(var count=new NativePointer(8)) {
                bool ok=B("GET_AMMO_IN_CLIP",ped,unchecked((int)gun),count);
                return ok?count.GetValue<int>():-1;
            }
        }
        (bool valid,Rage.Vector3 point) LastImpact(int ped)
        {
            using(var point=new NativePointer(24)) {
                bool ok=B("GET_PED_LAST_WEAPON_IMPACT_COORD",ped,point);
                return (ok,ok?point.GetValue<Rage.Vector3>():V(0,0,0));
            }
        }
        // This is a second independent observation only for a failed baseline,
        // captured >= 500 ms later; it never overwrites the original 30/10 sample verdicts.
        void ScheduleConfirmation(Sample sample,int ordinal)
        {
            confirmationSample=sample;confirmationOrdinal=ordinal;confirmationAt=RealMs()+500;
        }
        bool Materials()
        {
            Require(surfaceSamples.Count>=30,"need_30_codewalker_ground_truth_surfaces");
            if(confirmationSample!=null)
            {
                if(RealMs()<confirmationAt)return false;
                Sample item=confirmationSample;
                Ray second=Trace(V(item.ax,item.ay,item.az),V(item.bx,item.by,item.bz));
                int expected=Hash((item.expectedMaterial??"")+"_"+item.materialIndex);
                Note("material_confirmation",new {sampleIndex=confirmationOrdinal,item.label,
                    delayMs=RealMs()-(confirmationAt-500),shape=Describe(second),
                    indexedHashMatches=second.hit&&second.material==expected,
                    note="Second delayed observation of an earlier baseline mismatch; not another ground-truth sample."});
                confirmationSample=null;
                return sampleIndex>=30;
            }
            if(sampleIndex>=30)return true;
            Sample item0=surfaceSamples[sampleIndex++];
            Ray r=Trace(V(item0.ax,item0.ay,item0.az),V(item0.bx,item0.by,item0.bz));
            int expectedName=Hash(item0.expectedMaterial??"");
            int expectedIndex=Hash((item0.expectedMaterial??"")+"_"+item0.materialIndex);
            bool matches=r.hit&&r.material==expectedIndex;
            Note("material",new {sampleIndex,item0.label,item0.expectedMaterial,
                joaatName=unchecked((uint)expectedName),joaatIndexed=unchecked((uint)expectedIndex),
                shape=Describe(r),nameMatches=r.hit&&expectedName==r.material,indexMatches=matches,
                diagnostic=(!r.hit?"ray_miss":!matches?"material_mismatch":"match")});
            // Side-by-side option 0 observation in the same frame, after the unchanged baseline note.
            Ray alt=Trace(V(item0.ax,item0.ay,item0.az),V(item0.bx,item0.by,item0.bz),17,0,OptionsAnalysis.Alternate);
            Note("material_options",new {sampleIndex,item0.label,item0.expectedMaterial,
                joaatIndexed=unchecked((uint)expectedIndex),
                opt7=DescribeOpt(r,OptionsAnalysis.Baseline),opt0=DescribeOpt(alt,OptionsAnalysis.Alternate),
                classification=OptionsAnalysis.ClassifyMaterial(Obs(r),Obs(alt),unchecked((uint)expectedIndex)),
                baselineIndexMatches=matches,gate=GateState(),
                reverseOpt0=DescribeOpt(Trace(V(item0.bx,item0.by,item0.bz),V(item0.ax,item0.ay,item0.az),17,0,OptionsAnalysis.Alternate),OptionsAnalysis.Alternate),
                layersOpt0=MaterialLayers(item0),
                note="Raw side-by-side observation; classification is computed only from these rays and the expected hash."});
            if(!matches)ScheduleConfirmation(item0,sampleIndex);
            return sampleIndex>=30&&confirmationSample==null;
        }
        bool Thickness()
        {
            Require(wallSamples.Count>=10,"need_10_codewalker_measured_walls");
            if(confirmationSample!=null)
            {
                if(RealMs()<confirmationAt)return false;
                Sample w=confirmationSample;
                Ray a1=Trace(V(w.ax,w.ay,w.az),V(w.bx,w.by,w.bz));
                Ray b1=Trace(V(w.bx,w.by,w.bz),V(w.ax,w.ay,w.az));
                double thickness=a1.hit&&b1.hit?Census.Distance(a1.where.X,a1.where.Y,a1.where.Z,
                    b1.where.X,b1.where.Y,b1.where.Z):-1;
                bool same=a1.hit&&b1.hit&&a1.entity==b1.entity;
                bool within=thickness>=0&&Math.Abs(thickness-w.expectedThicknessM)<=.01;
                Note("wall_confirmation",new {sampleIndex=confirmationOrdinal,w.label,
                    delayMs=RealMs()-(confirmationAt-500),measuredM=thickness,
                    errorM=thickness<0?null:(double?)(thickness-w.expectedThicknessM),
                    sameEntity=same,withinOneCentimeter=within,
                    forward=Describe(a1),reverse=Describe(b1),
                    note="Second delayed observation only; original wall baseline retained."});
                confirmationSample=null;
                return sampleIndex>=10;
            }
            if(sampleIndex>=10)return true;
            Sample w0=wallSamples[sampleIndex++];
            var a=V(w0.ax,w0.ay,w0.az);var b=V(w0.bx,w0.by,w0.bz);
            Ray forward=Trace(a,b),reverse=Trace(b,a),inside=Trace(V((a.X+b.X)/2,(a.Y+b.Y)/2,(a.Z+b.Z)/2),b);
            double measured=forward.hit&&reverse.hit?Census.Distance(forward.where.X,forward.where.Y,forward.where.Z,
                reverse.where.X,reverse.where.Y,reverse.where.Z):-1;
            double error=measured<0?0:measured-w0.expectedThicknessM;
            int expected=Hash((w0.expectedMaterial??"")+"_"+w0.materialIndex);
            bool sameEntity=forward.hit&&reverse.hit&&forward.entity==reverse.entity;
            bool bothExpected=forward.hit&&reverse.hit&&forward.material==expected&&reverse.material==expected;
            bool withinOneCentimeter=measured>=0&&Math.Abs(error)<=.01;
            Note("exit_faces",new {sampleIndex,w0.label,w0.expectedThicknessM,measuredM=measured,
                errorM=measured<0?null:(double?)error,sameEntity,bothExpectedMaterial=bothExpected,
                withinOneCentimeter,insideSolidHit=inside.hit,
                diagnostic=(!sameEntity?"different_entities":!bothExpected?"material_mismatch":
                    !withinOneCentimeter?"thickness_mismatch":"match"),
                forward=Describe(forward),reverse=Describe(reverse),inside=Describe(inside)});
            // Side-by-side option 0 pair plus bounded advance-past-hit layer scans (read-only).
            Ray forward0=Trace(a,b,17,0,OptionsAnalysis.Alternate),reverse0=Trace(b,a,17,0,OptionsAnalysis.Alternate);
            uint expectedU=unchecked((uint)expected);
            string pair7=OptionsAnalysis.PairOutcome(Obs(forward),Obs(reverse),expectedU,w0.expectedThicknessM);
            string pair0=OptionsAnalysis.PairOutcome(Obs(forward0),Obs(reverse0),expectedU,w0.expectedThicknessM);
            bool unchanged=OptionsAnalysis.SameObservation(Obs(forward),Obs(forward0))&&
                OptionsAnalysis.SameObservation(Obs(reverse),Obs(reverse0))&&forward.entity==forward0.entity&&reverse.entity==reverse0.entity;
            var seg=ScanSegment(a,b,LayerAnalysis.MaxLayers);
            string corroboration;var oblique=Oblique(seg,out corroboration);
            var pairDesc=PairSearch.Describe(seg.pairs);
            var chosen=seg.pairs.Count==1?seg.pairs[0]:null;
            double measured0=forward0.hit&&reverse0.hit?Census.Distance(forward0.where.X,forward0.where.Y,forward0.where.Z,
                reverse0.where.X,reverse0.where.Y,reverse0.where.Z):-1;
            Note("wall_options",new {sampleIndex,w0.label,w0.expectedThicknessM,expectedMaterial=w0.expectedMaterial,
                opt7=new {pair=pair7,measuredM=measured,forward=DescribeOpt(forward,OptionsAnalysis.Baseline),reverse=DescribeOpt(reverse,OptionsAnalysis.Baseline)},
                opt0=new {pair=pair0,measuredM=measured0,forward=DescribeOpt(forward0,OptionsAnalysis.Alternate),reverse=DescribeOpt(reverse0,OptionsAnalysis.Alternate)},
                classification=OptionsAnalysis.ClassifyWall(pair7,pair0,unchanged),
                layersForward=LayerTable(a,seg.fwd),layersReverse=LayerTable(b,seg.rev),
                pairSearch=new {summary=pairDesc,candidates=PairRows(seg),
                    uniqueMatchesGroundTruth=chosen!=null&&PairSearch.MatchesExpected(chosen,w0.expectedThicknessM),
                    corroboration,oblique},
                baselineDiagnostic=(!sameEntity?"different_entities":!bothExpected?"material_mismatch":!withinOneCentimeter?"thickness_mismatch":"match"),
                gate=GateState(),
                note="Layer tables are descriptive; a thickness is claimed only for CORROBORATED_THICKNESS (unique same-entity/same-material pair that is angle-consistent). Ground truth is compared afterwards and never used to find the pair."});
            if(!sameEntity||!bothExpected||!withinOneCentimeter)
                ScheduleConfirmation(w0,sampleIndex);
            return sampleIndex>=10&&confirmationSample==null;
        }
        bool Shots()
        {
            int ped=Ped();Require(ped>0,"player_ped_unavailable");
            if(mode=="npc") {
                Require(cfg.permitBullet && cfg.HasSite && cfg.HasTarget,
                    "npc_fire_requires_explicit_permitBullet_and_safe_site");
                RequireSite();
                if(step==0) {
                    if(!ModelReady(cfg.pedModel))return false;
                    target=N("CREATE_PED",4,Hash(cfg.pedModel),cfg.x,cfg.y,cfg.z,0f,false,false);
                    Require(target>0,"lab_shooter_spawn_failed");
                    owned.Own(target);
                    N("SET_BLOCKING_OF_NON_TEMPORARY_EVENTS",target,true);
                    N("GIVE_WEAPON_TO_PED",target,Hash("WEAPON_PISTOL"),60,false,true);
                    N("TASK_SHOOT_AT_COORD",target,cfg.targetX,cfg.targetY,cfg.targetZ,10000,Hash("FIRING_PATTERN_FULL_AUTO"));
                    Note("npc_shooter_started",new {target,shooterSite=Vec(Pos),aimPoint=Vec(Target),
                        provenance="lab_owned_ped_only",durationMs=10000});
                    step=1;return false;
                }
                ped=target;
            }
            int current=N("GET_SELECTED_PED_WEAPON",ped);
            if(weapon==0)weapon=unchecked((uint)current);
            int ammo=ReadAmmo(ped,weapon);
            if(ammoLast>=0 && ammo>=0 && ammo<ammoLast)ammoSpent+=ammoLast-ammo;
            ammoLast=ammo;
            bool fire=B("IS_PED_SHOOTING",ped);
            var impact=LastImpact(ped);
            bool area=cfg.HasTarget && B("HAS_BULLET_IMPACTED_IN_AREA",cfg.targetX,cfg.targetY,cfg.targetZ,10f,mode!="npc",false);
            // Last-impact coordinates may remain latched over several frames.
            if(impact.valid)impacts++;
            if(fire || impact.valid || frame%60==0)
                Note("shot_sample",new {mode,shooter=ped,fire,ammo,ammoSpent,impactValid=impact.valid,
                    impact=impact.valid?Vec(impact.point):null,area,frame,
                    weaponHash=weapon,selectedWeaponHash=unchecked((uint)current),gameTimerMs=N("GET_GAME_TIMER"),
                    cam=(fire||impact.valid)?CameraPose():null,
                    note="Passive observation only. Camera pose, weapon and clocks are for offline correlation; an impact coordinate is not a trajectory."});
            if(RealMs()-began<(mode=="npc"?11000:15000))return false;
            Note("shot_coverage",new {mode,ammoSpent,impactFrameSamples=impacts,
                ratioUpperBound=Census.Coverage(ammoSpent,impacts),
                caveat="Impact coordinate may remain stale. Frame samples are not unique rounds; independent proof is required for individual bullets and pellets."});
            return true;
        }
        // Read-only gameplay camera pose (position + rotation order 2: x=pitch, z=heading). Never fails the probe.
        object CameraPose()
        {
            try
            {
                var c=NativeFunction.CallByName<Rage.Vector3>("GET_GAMEPLAY_CAM_COORD");
                var r=NativeFunction.CallByName<Rage.Vector3>("GET_GAMEPLAY_CAM_ROT",2);
                return new {ok=true,pos=Vec(c),rot=Vec(r)};
            }
            catch(Exception e){return new {ok=false,error=e.GetType().Name};}
        }
        bool ModelReady(string name)
        {
            Require(!string.IsNullOrWhiteSpace(name),"model_unconfigured");
            int hash=Hash(name);
            Require(B("IS_MODEL_IN_CDIMAGE",hash),"model_not_in_cdimage");
            N("REQUEST_MODEL",hash);
            return B("HAS_MODEL_LOADED",hash);
        }
        int Spawn(string model,Rage.Vector3 pos)
        {
            int obj=N("CREATE_OBJECT_NO_OFFSET",Hash(model),pos.X,pos.Y,pos.Z,false,false,false);
            Require(obj>0,"spawn_failed");
            owned.Own(obj);
            return obj;
        }
        bool PropRemoval()
        {
            RequireSite();
            if(step==0) {
                Ray before=Trace(V(cfg.x-4,cfg.y,cfg.z),V(cfg.x+4,cfg.y,cfg.z));
                Note("before_prop",Describe(before));step++;return false;
            }
            if(step==1) {
                Require(PhantomCollision.WithinBudget(PhantomCollision.LabProps,PhantomCollision.LabPeds,cfg.radius),"e05_budget_exceeded");
                if(!ModelReady(cfg.propModel)||!ModelReady(cfg.pedModel))return false;
                collisionObject=Spawn(cfg.propModel,Pos);
                int left=Spawn(cfg.propModel,V(cfg.x,cfg.y+1.5f,cfg.z));
                int right=Spawn(cfg.propModel,V(cfg.x,cfg.y-1.5f,cfg.z));
                N("FREEZE_ENTITY_POSITION",collisionObject,true);
                N("FREEZE_ENTITY_POSITION",left,true);
                N("FREEZE_ENTITY_POSITION",right,true);
                losPedA=N("CREATE_PED",4,Hash(cfg.pedModel),cfg.x-4,cfg.y,cfg.z,0f,false,false);
                Require(losPedA>0,"los_ped_A_spawn_failed");owned.Own(losPedA);
                losPedB=N("CREATE_PED",4,Hash(cfg.pedModel),cfg.x+4,cfg.y,cfg.z,0f,false,false);
                Require(losPedB>0,"los_ped_B_spawn_failed");owned.Own(losPedB);
                N("FREEZE_ENTITY_POSITION",losPedA,true);
                N("FREEZE_ENTITY_POSITION",losPedB,true);
                N("SET_BLOCKING_OF_NON_TEMPORARY_EVENTS",losPedA,true);
                N("SET_BLOCKING_OF_NON_TEMPORARY_EVENTS",losPedB,true);
                Note("prop_wall_spawn",new {center=collisionObject,left,right,
                    labLosPedA=losPedA,labLosPedB=losPedB,
                    provenance="all_entities_lab_owned"});
                step++;return false;
            }
            if(step==2) {
                Ray after=Trace(V(cfg.x-4,cfg.y,cfg.z),V(cfg.x+4,cfg.y,cfg.z));
                bool actorLos=B("HAS_ENTITY_CLEAR_LOS_TO_ENTITY",losPedA,losPedB,17);
                Note("prop_collision",new {ray=Describe(after),actorLos});
                phantomEntityHandle=collisionObject;phantomFirstClearMs=-1;
                DeleteOwned(collisionObject);deletedAtMs=RealMs();
                Note("deleted",new {frame,center=collisionObject});
                step=3;objectIndex=frame;return false;
            }
            int elapsed=frame-objectIndex;
            if(elapsed>=1&&elapsed<=PhantomCollision.MaxFrames) {
                // Every frame after deletion (not only +1/+5/+30) so the first clear frame and its milliseconds are measured.
                Ray r=Trace(V(cfg.x-4,cfg.y,cfg.z),V(cfg.x+4,cfg.y,cfg.z));
                Ray r0=Trace(V(cfg.x-4,cfg.y,cfg.z),V(cfg.x+4,cfg.y,cfg.z),17,0,OptionsAnalysis.Alternate);
                bool actorLos=B("HAS_ENTITY_CLEAR_LOS_TO_ENTITY",losPedA,losPedB,17);
                long sinceDeleteMs=RealMs()-deletedAtMs;
                bool phantom=r.hit&&r.entity==phantomEntityHandle;
                if(phantomFirstClearMs<0&&!r.hit&&!r0.hit)phantomFirstClearMs=sinceDeleteMs;
                Note("collision_after_delete",new {frames=elapsed,ms=RealMs()-began,sinceDeleteMs,
                    ray=Describe(r),rayOpt0=Describe(r0),actorLos,deletedEntitySeen=phantom});
            }
            if(elapsed>=PhantomCollision.MaxFrames)
                Note("phantom_collision_summary",new {firstClearMs=phantomFirstClearMs,framesObserved=Math.Min(elapsed,PhantomCollision.MaxFrames),
                    thresholdMs=PhantomCollision.ThresholdMs,
                    classification=PhantomCollision.Classify(phantomFirstClearMs,Math.Min(elapsed,PhantomCollision.MaxFrames)),
                    note="Shape-test visibility only; says nothing about bullets or actor movement."});
            return elapsed>=PhantomCollision.MaxFrames;
        }
        void DeleteOwned(int handle)
        {
            Require(owned.Owns(handle),"foreign_entity_delete_refused");
            int x=handle;
            using(var p=new NativePointer(8)) {p.SetValue<int>(x);N("DELETE_OBJECT",p);}
            owned.Forget(handle);
        }
        bool Continuation()
        {
            Require(cfg.permitBullet,"permitBullet_not_set");
            RequireSite();
            if(step==0) {
                if(!ModelReady(cfg.pedModel))return false;
                target=N("CREATE_PED",4,Hash(cfg.pedModel),cfg.targetX,cfg.targetY,cfg.targetZ,0f,false,false);
                Require(target>0,"lab_ped_spawn_failed");owned.Own(target);
                N("SET_BLOCKING_OF_NON_TEMPORARY_EVENTS",target,true);
                N("FREEZE_ENTITY_POSITION",target,true);
                originalWanted=N("GET_PLAYER_WANTED_LEVEL",N("PLAYER_ID"));
                Note("ped_target_spawned",new {target,originalWanted,position=Vec(Target)});
                step=1;return false;
            }
            if(step>10)return true;
            int index=(step-1)/2;
            float offset=new[]{.005f,.01f,.02f,.05f,.10f}[index];
            if(step%2==1) {
                float dx=cfg.targetX-cfg.x,dy=cfg.targetY-cfg.y,dz=cfg.targetZ-cfg.z;
                float length=(float)Math.Sqrt(dx*dx+dy*dy+dz*dz);
                Require(length>1 && length<=30,"continuation_range_1_to_30m");
                int owner=Ped(),weaponHash=Hash("WEAPON_PISTOL");
                float startX=cfg.x+(dx/length)*offset,startY=cfg.y+(dy/length)*offset,startZ=cfg.z+(dz/length)*offset;
                int previous=N("GET_ENTITY_HEALTH",target);
                int playerBefore=N("GET_ENTITY_HEALTH",owner);
                // NativeDB 21-argument gen9 form: owner is ignored for collision;
                // lab target is the explicitly designated targetEntity.
                N("CLEAR_ENTITY_LAST_DAMAGE_ENTITY",target);
                N("SHOOT_SINGLE_BULLET_BETWEEN_COORDS_IGNORE_ENTITY_NEW",
                    startX,startY,startZ,cfg.targetX,cfg.targetY,cfg.targetZ,5,false,weaponHash,owner,
                    false,true,-1f,owner,false,false,target,false,0,0,0);
                Note("continuation_fired",new {index,offsetM=offset,previousHealth=previous,
                    playerHealthBefore=playerBefore,ownerPlayerPed=owner,target,bulletCount=1});
                step++;objectIndex=frame;return false;
            }
            if(frame-objectIndex<8)return false;
            int currentHealth=N("GET_ENTITY_HEALTH",target);
            int playerHealth=N("GET_ENTITY_HEALTH",Ped());
            bool nativeAttribution=B("HAS_ENTITY_BEEN_DAMAGED_BY_ENTITY",target,Ped(),true);
            Note("continuation_followup",new {index,offsetM=offset,targetHealth=currentHealth,
                playerHealth,damageAttributedToPlayerNative=nativeAttribution,
                wantedLevel=N("GET_PLAYER_WANTED_LEVEL",N("PLAYER_ID")),
                attributionNote="Native damage flag is supporting evidence, not a DamageTracker or World.PedShot event.",
                duplicationNote="Sequential emission: exactly one native request per offset; observe health delta for multiple hits."});
            step++;
            return step>10;
        }
        bool ModelHide()
        {
            Require(cfg.permitHide,"permitHide_not_set");RequireSite();
            Require(!string.IsNullOrWhiteSpace(cfg.mapModel),"mapModel_required");
            if(step==0) {
                Note("pre_hide",Describe(Trace(Pos,Target)));
                N("CREATE_MODEL_HIDE",cfg.x,cfg.y,cfg.z,cfg.radius,Hash(cfg.mapModel),true);
                hidden=true;step=1;objectIndex=frame;return false;
            }
            if(frame-objectIndex<10)return false;
            Note("while_hidden",new {ray=Describe(Trace(Pos,Target)),model=cfg.mapModel,
                visible="requires_user_observation"});
            N("REMOVE_MODEL_HIDE",cfg.x,cfg.y,cfg.z,cfg.radius,Hash(cfg.mapModel),true);hidden=false;
            Note("restored",Describe(Trace(Pos,Target)));return true;
        }
        bool Fragments()
        {
            RequireSite();Require(!string.IsNullOrWhiteSpace(cfg.fragModel),"fragModel_required");
            if(step==0) {
                if(!ModelReady(cfg.fragModel))return false;
                collisionObject=Spawn(cfg.fragModel,Pos);step=1;return false;
            }
            if(step==1) {
                Note("fragment_pre",new {health=F("GET_OBJECT_FRAGMENT_DAMAGE_HEALTH",collisionObject,true),
                    ray=Describe(Trace(V(cfg.x-3,cfg.y,cfg.z),V(cfg.x+3,cfg.y,cfg.z)))});
                N("BREAK_OBJECT_FRAGMENT_CHILD",collisionObject,cfg.fragChild,true);
                Note("fragment_break",new {child=cfg.fragChild,frame});step=2;objectIndex=frame;return false;
            }
            if(frame-objectIndex<5)return false;
            Note("fragment_post",new {health=F("GET_OBJECT_FRAGMENT_DAMAGE_HEALTH",collisionObject,true),
                ray=Describe(Trace(V(cfg.x-3,cfg.y,cfg.z),V(cfg.x+3,cfg.y,cfg.z))),
                indexMeaning="requires_native_observation"});
            return true;
        }
        bool Budget()
        {
            RequireSite();
            int limit=Census.Limit("E0.9",cfg.entityLimit,true);
            if(step==0){if(!ModelReady(cfg.propModel))return false;step=1;return false;}
            if(frames.Count>=30 && Census.Percentile(frames.Skip(Math.Max(0,frames.Count-30)),.95)>60)
                throw new InvalidOperationException("BLOCKED:frame_budget_watchdog_exceeded_60ms");
            // Max 8 spawns each frame. Exact milestone receipts with p95/p99.
            int count=Math.Min(8,limit-objectIndex);
            for(int i=0;i<count;i++) {
                int k=objectIndex++;
                var p=V(cfg.x+(k%16)*1.5f,cfg.y+(k/16%16)*1.5f,cfg.z+(k/256)*2f);
                int h=Spawn(cfg.propModel,p);N("FREEZE_ENTITY_POSITION",h,true);
            }
            if(milestones.Contains(objectIndex)||objectIndex==limit)
                Note("budget_batch",new {count=objectIndex,p50=Census.Percentile(frames,.50),
                    p95=Census.Percentile(frames,.95),p99=Census.Percentile(frames,.99),
                    max=frames.Count==0?0:frames.Max()});
            if(objectIndex>=limit)return true;
            return false;
        }
        bool Explosions()
        {
            RequireSite();
            if(step==0) {
                if(cfg.permitExplosion) {
                    N("ADD_EXPLOSION",cfg.x,cfg.y,cfg.z,0,0f,false,true,0f,false);
                    Note("inert_explosion_emitted",new {explosionType=0,damageScale=0});
                } else Note("passive_only",new {reason="permitExplosion=false; throw grenade at marked target if desired"});
                step=1;return false;
            }
            bool hit=B("IS_EXPLOSION_IN_SPHERE",0,cfg.x,cfg.y,cfg.z,Math.Max(1,cfg.radius));
            int owner=N("GET_OWNER_OF_EXPLOSION_IN_SPHERE",0,cfg.x,cfg.y,cfg.z,Math.Max(1,cfg.radius));
            if(hit)Note("explosion",new {seenFrame=frame,latencyMs=RealMs()-began,owner});
            return RealMs()-began>=10000;
        }
        bool Ipl()
        {
            Require(cfg.permitIpl,"permitIpl_not_set");RequireSite();
            Require(!string.IsNullOrWhiteSpace(cfg.ipl),"ipl_name_required");
            if(step==0) {
                originalIpl=B("IS_IPL_ACTIVE",cfg.ipl);
                Note("ipl_baseline",new {ipl=cfg.ipl,active=originalIpl,ray=Describe(Trace(Pos,Target))});
                step=1;objectIndex=frame;return false;
            }
            if(frame-objectIndex<10)return false;
            if(step>40)return true;
            bool request=(step%2==0)?originalIpl:!originalIpl;
            if(request)N("REQUEST_IPL",cfg.ipl);else N("REMOVE_IPL",cfg.ipl);
            changedIpl=true;
            Note("ipl_toggle",new {cycle=step/2,request,active=B("IS_IPL_ACTIVE",cfg.ipl),
                ray=Describe(Trace(Pos,Target)),frame});
            objectIndex=frame;step++;return false;
        }
        bool TimeScale()
        {
            Require(cfg.permitTimeScale,"permitTimeScale_not_set");
            if(step==0) {
                originalScale=Game.TimeScale;Require(originalScale>0 && originalScale<=1.5f,"unknown_initial_timescale");
                Note("timescale_baseline",new {originalScale});
                N("SET_TIME_SCALE",.2f);changedTime=true;step=1;objectIndex=frame;lastGame=GameMs();lastSample=RealMs();return false;
            }
            if(step==1 && RealMs()-lastSample>=2000) {
                Note("timescale_measure",new {scale=.2,realMs=RealMs()-lastSample,gameMs=GameMs()-lastGame,
                    observedDebris="requires_manual_visual_validation",
                    continuationSpeed="requires_manual_target_validation"});
                N("SET_TIME_SCALE",originalScale);changedTime=false;step=2;lastGame=GameMs();lastSample=RealMs();return false;
            }
            if(step==2 && RealMs()-lastSample>=1000) {
                Note("timescale_restored",new {value=Game.TimeScale,
                    realMs=RealMs()-lastSample,gameMs=GameMs()-lastGame});return true;
            }
            return false;
        }
    }
}
