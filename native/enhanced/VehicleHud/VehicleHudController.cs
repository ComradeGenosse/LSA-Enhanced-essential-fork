using System;
using System.Drawing;
using System.IO;
using System.Collections.Generic;
using System.Text;
using System.Diagnostics;
using Rage;
using Rage.Native;

namespace LSA.Enhanced.VehicleHud
{
    // Game reads stay on the loader fiber. FrameRender receives only published,
    // immutable-by-convention snapshots and never queries or mutates an entity.
    internal sealed class VehicleHudController
    {
        const int SampleEveryMs = 200, CsvSampleMs = 1000;
        const long CsvSizeLimit = 10L * 1024 * 1024; // bounded log, never auto-delete
        readonly string traceFile;
        readonly VehicleDeformationLab deformationLab;
        readonly VehicleGeometryLibrary geometryLibrary;
        readonly string spriteDirectory;
        readonly Dictionary<string,Rage.Texture> spriteCache=
            new Dictionary<string,Rage.Texture>(StringComparer.OrdinalIgnoreCase);
        Rage.Texture activeSprite;
        public string SpriteStatus {get;private set;}="No vehicle selected";
        public string ModelGeometryStatus => geometryLibrary.Status;
        readonly VehicleLiveDeformationSampler liveDeformation =
            new VehicleLiveDeformationSampler();
        public bool LiveDeformationEnabled => liveDeformation.Enabled;
        public string LiveDeformationStatus => liveDeformation.Status;
        public void SetLiveDeformationEnabled(bool value) => liveDeformation.SetEnabled(value);
        volatile VehicleBodyMesh completedCaptureMesh;
        int completedCaptureHandle;
        volatile bool showCaptureMesh;
        public bool CaptureMeshPreviewEnabled => showCaptureMesh;
        public void SetCaptureMeshPreview(bool enable) => showCaptureMesh=enable;
        public string CaptureMeshPreviewStatus =>
            completedCaptureMesh!=null ? "PAIRED - "+completedCaptureMesh.Model+
                (completedCaptureMesh.ExperimentalDeformation ? " / DEFORMED" : " / NO QUALIFYING CHANGE") :
                "NO COMPLETED VH3 PAIR";
        readonly VehicleCrashFlightRecorder flight = new VehicleCrashFlightRecorder();
        readonly string flightDirectory;
        int flightFiles;
        long flightBytes;
        int slowHealthSamples;
        readonly Queue<string> pendingFlight = new Queue<string>();
        string flightModel = "unavailable";
        public bool CrashRecording => flight.Enabled;
        public string CrashRecordingStatus => flight.Status;
        public void SetCrashRecording(bool enabled) => flight.SetEnabled(enabled);
        public bool DeformationEnabled => deformationLab.Enabled;
        public string DeformationStatus => deformationLab.Status;
        public void SetDeformationEnabled(bool enabled) => deformationLab.SetEnabled(enabled);
        public string CaptureDeformation(string phase)
        {
            string message=deformationLab.Request(phase);
            if(phase=="baseline" && message.StartsWith("VH3 baseline",StringComparison.Ordinal)) {
                // A new experiment invalidates prior matched capture geometry.
                completedCaptureMesh=null;completedCaptureHandle=0;
            }
            return message;
        }
        long nextCsv;
        int lastLoggedVehicle;
        long lastEventAt = -1;
        readonly HashSet<string> eventsAtTimestamp = new HashSet<string>(StringComparer.Ordinal);
        public bool Logging {get;private set;}
        public VehicleHudController(string plugins)
        {
            traceFile = Path.Combine(plugins ?? "", "LSA", "Logs", "vehicle-telemetry.csv");
            deformationLab = new VehicleDeformationLab(plugins);
            geometryLibrary = new VehicleGeometryLibrary(plugins);
            spriteDirectory=Path.Combine(plugins??"","LSA","VehicleGeometry");
            flightDirectory = Path.Combine(plugins ?? "", "LSA", "Logs", "VH3");
        }
        public void SetLogging(bool enabled)
        {
            Logging = enabled;
            nextCsv = 0; lastLoggedVehicle = 0; lastEventAt = -1;
            eventsAtTimestamp.Clear();
        }
        readonly VehicleDamageTimeline timeline = new VehicleDamageTimeline();
        volatile VehicleView published;
        volatile VehicleBodyMesh publishedBody;
        int bodyHandle;
        volatile string mode = "full";
        long nextSample;
        int failures, drawFailures;
        bool hooked, samplerDisabled, drawDisabled;
        public string Mode => mode;
        public VehicleView Current => published;
        public void Configure(string value) { SetMode(value); }
        public void SetMode(string value)
        {
            if (value != "off" && value != "minimal" && value != "full") return;
            mode = value;
            if (value == "off") { timeline.Clear(); published = null; }
            nextSample = 0;
        }
        public void Hook()
        {
            if (hooked) return;
            Game.FrameRender += Paint;
            hooked = true;
        }
        public void Unhook()
        {
            if (!hooked) return;
            Game.FrameRender -= Paint;
            hooked = false;
            timeline.Clear(); published = null; publishedBody = null;
            activeSprite=null;SpriteStatus="No vehicle selected";
            completedCaptureMesh=null;completedCaptureHandle=0;showCaptureMesh=false;
            deformationLab.SetEnabled(false);
            liveDeformation.SetEnabled(false);
            flight.Stop();
        }
        public void Tick(long now,bool paused)
        {
            if ((mode == "off" && !Logging && !deformationLab.Enabled &&
                !liveDeformation.Enabled && !flight.Enabled && pendingFlight.Count==0) || samplerDisabled) return;
            if (now < nextSample) return;
            nextSample = now + SampleEveryMs;
            if (paused) { timeline.Clear(); published = null; return; }
            try {
                var player = Game.LocalPlayer.Character;
                var car = player != null && player.IsValid() ? player.CurrentVehicle : null;
                if (car == null || !car.IsValid() || !car.IsCar || car.Driver == null || car.Driver.Handle != player.Handle) {
                    timeline.Clear(); published = null;
                    publishedBody = null; bodyHandle = 0;
                    activeSprite=null;SpriteStatus="No vehicle selected";
                    completedCaptureMesh=null;completedCaptureHandle=0;
                    deformationLab.Tick(null,now);
                    liveDeformation.VehicleLost();
                    flight.NoVehicle();
                    FlushFlightWhenStationary(true);
                    failures = 0; return;
                }
                if (bodyHandle != unchecked((int)car.Handle.Value)) {
                    bodyHandle = unchecked((int)car.Handle.Value);
                    publishedBody = null;
                    activeSprite=null;SpriteStatus="No vehicle sprite";
                    completedCaptureMesh=null;completedCaptureHandle=0;
                    flightModel = "unavailable";
                    try {
                        Vector3 min,max;
                        car.Model.GetDimensions(out min,out max);
                        string name=car.Model.Name ?? "unknown";
                        flightModel = name;
                        publishedBody=geometryLibrary.LoadOrFallback(name,
                            new DeformationBounds(min.X,min.Y,min.Z,max.X,max.Y,max.Z));
                        Game.LogTrivial("[VH6] geometry "+geometryLibrary.Status);
                        LoadSpriteForVehicle(name,publishedBody);
                    } catch (Exception error) {
                        Game.LogTrivial("[VH3B] silhouette_unavailable "+error.GetType().Name);
                    }
                }
                // Optional VH3 sampling: six probe calls per sampler tick.
                // The live HUD does not use this experimental data.
                deformationLab.Tick(car,now);
                // An experimental live scan never competes with a manual
                // 48-point VH3 capture on the same 5Hz game fiber.
                liveDeformation.Tick(car,publishedBody,deformationLab.IsBusy,now);
                DeformationCapture before,after;
                if(deformationLab.TryConsumePair(out before,out after)) {
                    // This is a ONE-SHOT paired snapshot review, not live
                    // frame-by-frame deformation. Every vertex is computed
                    // on the game fiber; FrameRender only reads the snapshot.
                    var source=publishedBody;
                    if(source!=null && source.Model==before.Model &&
                        before.Handle==bodyHandle) {
                        try {
                            var candidate=VehicleMeshGeometry.Deform(source,before,after);
                            completedCaptureMesh=candidate;
                            completedCaptureHandle=bodyHandle;
                            Game.LogTrivial("[VH3C] paired_mesh="+
                                (candidate.ExperimentalDeformation?"deformed":"unchanged")+
                                " model="+source.Model);
                        } catch(Exception error) {
                            completedCaptureMesh=null;completedCaptureHandle=0;
                            Game.LogTrivial("[VH3C] mesh_reconstruction_failed "+error.GetType().Name);
                        }
                    }
                }
                // In HUD-off / flight-only mode, ordinary health sampling is
                // still required for the flight recorder. It runs at 5Hz,
                // never adds deformation probes beyond the existing four.
                if(mode=="off" && !Logging && !flight.Enabled && !liveDeformation.Enabled) {
                    FlushFlightWhenStationary(car.Speed<=0.5f);
                    published=null;failures=0;return;
                }
                long healthStart=(flight.Enabled || Logging)?Stopwatch.GetTimestamp():0L;
                var v = Read(car);
                if(healthStart!=0) {
                    long healthUs=(long)((Stopwatch.GetTimestamp()-healthStart)*1000000d/Stopwatch.Frequency);
                    slowHealthSamples=healthUs>8000?slowHealthSamples+1:0;
                    if(slowHealthSamples>=3) {
                        flight.Stop(); Logging=false;
                        Game.LogTrivial("[VH4] optional_recorders_disabled health_sample_us="+healthUs);
                        slowHealthSamples=0;
                    }
                }
                timeline.Update(v,now);
                published = timeline.Current;
                if (flight.Enabled) {
                    string incident=flight.Observe(published,flightModel,now,DateTime.UtcNow.ToString("o"));
                    if (incident != null) {
                        // Keep a hard upper bound on pending writes. No I/O
                        // on a live impact or while the car is moving.
                        if (pendingFlight.Count<2) pendingFlight.Enqueue(incident);
                        else Game.LogTrivial("[VH4] incident_dropped pending_queue_full");
                    }
                    FlushFlightWhenStationary(car.Speed<=0.5f);
                }
                if (Logging) Trace(car,published,now);
                failures = 0;
            } catch (Exception error) {
                timeline.Clear(); published = null;
                if (++failures == 1) Game.LogTrivial("[VH1] sample_failed " + error.GetType().Name);
                if (failures >= 5) { samplerDisabled = true; Game.LogTrivial("[VH1] sampler_disabled; other LSA features unaffected"); }
            }
        }
        void FlushFlightWhenStationary(bool stationary)
        {
            if(!stationary || pendingFlight.Count==0)return;
            PersistCrashIncident(pendingFlight.Dequeue());
        }
        // Save at most 10 small opt-in crash incidents in the session.
        // Never write while driving; hold at most two completed records.
        // File failures disable only the flight recorder, not gameplay/HUD.
        void PersistCrashIncident(string csv)
        {
            try {
                if(csv.Length>120*1024 || flightFiles>=10 || flightBytes+csv.Length>1200*1024) {
                    flight.Stop();Game.LogTrivial("[VH4] flight_disabled quota");return;
                }
                Directory.CreateDirectory(flightDirectory);
                string file="flight-"+DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff")+"-"+
                    (++flightFiles).ToString(System.Globalization.CultureInfo.InvariantCulture)+".csv";
                string path=Path.Combine(flightDirectory,file);
                if(File.Exists(path))throw new IOException("collision");
                long ioStart=Stopwatch.GetTimestamp();
                File.WriteAllText(path,csv);
                long ioUs=(long)((Stopwatch.GetTimestamp()-ioStart)*1000000d/Stopwatch.Frequency);
                flightBytes+=System.Text.Encoding.UTF8.GetByteCount(csv);
                Game.LogTrivial("[VH4] incident_saved file="+path+" bytes="+csv.Length+
                    " write_us="+ioUs);
                if(ioUs>15000) {
                    flight.Stop();
                    Game.LogTrivial("[VH4] flight_disabled disk_slow");
                }
            } catch(Exception error) {
                flight.Stop();
                Game.LogTrivial("[VH4] flight_disabled "+error.GetType().Name);
            }
        }
        // Only the game fiber performs file I/O; samples are rate limited,
        // events are written once, and failures cannot break the HUD or LSA.
        void Trace(Vehicle car,VehicleView view,long now)
        {
            if (view?.Reading == null) return;
            try {
                bool snapshot = now >= nextCsv;
                if (lastLoggedVehicle != view.Reading.Handle) {
                    lastLoggedVehicle = view.Reading.Handle;
                    lastEventAt = -1; eventsAtTimestamp.Clear(); snapshot = true;
                }
                var output = new StringBuilder();
                string stamp = DateTime.UtcNow.ToString("o");
                string model;
                try { model = car.Model.Name; } catch { model = "unavailable"; }
                if (snapshot) {
                    nextCsv = now + CsvSampleMs;
                    output.AppendLine(VehicleTelemetryCsv.Row(stamp,"sample",model,view));
                }
                foreach (var evt in view.Events) {
                    if (evt.AtMs < lastEventAt) continue;
                    if (evt.AtMs == lastEventAt && eventsAtTimestamp.Contains(evt.Text)) continue;
                    if (evt.AtMs > lastEventAt) { lastEventAt = evt.AtMs; eventsAtTimestamp.Clear(); }
                    eventsAtTimestamp.Add(evt.Text);
                    output.AppendLine(VehicleTelemetryCsv.Row(stamp,"event",model,view,evt.Text));
                }
                if (output.Length == 0) return;
                var dir = Path.GetDirectoryName(traceFile);
                Directory.CreateDirectory(dir);
                var info = new FileInfo(traceFile);
                if (info.Exists && info.Length >= CsvSizeLimit) {
                    Logging = false; Game.LogTrivial("[VH2] telemetry_csv_limit_reached"); return;
                }
                bool header = !info.Exists || info.Length == 0;
                File.AppendAllText(traceFile,(header ? VehicleTelemetryCsv.Header + Environment.NewLine : "") + output);
            } catch (Exception error) {
                Logging = false;
                Game.LogTrivial("[VH2] telemetry_csv_disabled reason=" + error.GetType().Name);
            }
        }
        static VehicleReading Read(Vehicle car)
        {
            var v = new VehicleReading {
                Handle = unchecked((int)car.Handle.Value),
                Engine = car.EngineHealth, Body = NativeFunction.CallByName<float>("GET_VEHICLE_BODY_HEALTH",unchecked((int)car.Handle.Value)), Tank = car.FuelTankHealth,
                SpeedMps = car.Speed, SteeringDegrees = car.SteeringAngle, OnAllWheels = car.IsOnAllWheels
            };
            var velocity = car.Velocity;
            var forward = car.ForwardVector;
            var right = car.RightVector;
            float along = velocity.X * forward.X + velocity.Y * forward.Y;
            v.MovingForward = along > 12f;
            v.LateralSpeedMps = velocity.X * right.X + velocity.Y * right.Y;
            // Native tire IDs on standard four-wheel cars: LF=0 RF=1 LR=4 RR=5.
            // A wheel detached by an external mod does NOT necessarily report as
            // a burst tire, so we intentionally call this tire status, not wheel health.
            int[] ids = {0,1,4,5};
            for (int i = 0; i < ids.Length; i++) {
                try {
                    bool burst = NativeFunction.CallByName<bool>("IS_VEHICLE_TYRE_BURST",unchecked((int)car.Handle.Value),ids[i],false) ||
                                 NativeFunction.CallByName<bool>("IS_VEHICLE_TYRE_BURST",unchecked((int)car.Handle.Value),ids[i],true);
                    v.KnownTires |= 1 << i;
                    if (burst) v.BurstTires |= 1 << i;
                } catch { /* No invented status for unsupported wheel/native. */ }
            }
            // RPH getters are declared by the pinned SDK, but still require
            // validation on this exact Enhanced runtime. Wheels[] indexes are
            // deliberately shown as slots, not trusted physical corners.
            for (int i = 0; i < 4; i++) {
                try {
                    float health = car.Wheels[i].Health;
                    if (Plausible(health)) { v.WheelHealth[i] = health; v.KnownWheelHealth |= 1 << i; }
                } catch { /* Unsupported wheel slot: remain unknown. */ }
                try {
                    float health = car.Wheels[i].TireHealth;
                    if (Plausible(health)) { v.TireHealth[i] = health; v.KnownTireHealth |= 1 << i; }
                } catch { /* Not equivalent to puncture status. */ }
            }
            // Offset probes are VEHICLE-local sample points, NOT crash-zone
            // identities. No in-game mapping/calibration is claimed.
            float[] px = {-0.7f,0.7f,-0.7f,0.7f};
            float[] py = {1.0f,1.0f,-1.0f,-1.0f};
            for (int i = 0; i < 4; i++) {
                try {
                    var deformation = NativeFunction.CallByHash<Vector3>(0x4EC6CFBC7B2E9536UL,
                        unchecked((int)car.Handle.Value),px[i],py[i],0.45f);
                    float length = (float)Math.Sqrt(deformation.X*deformation.X +
                        deformation.Y*deformation.Y + deformation.Z*deformation.Z);
                    if (length >= 0f && length <= 5f && !float.IsNaN(length)) {
                        v.Deformation[i] = length; v.KnownDeformation |= 1 << i;
                    }
                } catch { /* Deformation probe unsupported: unavailable. */ }
            }
            return v;
        }
        static bool Plausible(float value) => !float.IsNaN(value) && !float.IsInfinity(value) &&
            value >= 0f && value <= 5000f;
        // Presentation is intentionally separate from the read-only 5Hz sampler.
        // Raw wheel health and deformation never appear on this driver-facing UI.
        void Paint(object sender,GraphicsEventArgs args)
        {
            if (mode == "off" || drawDisabled || args?.Graphics == null) return;
            // Pause menu (including the full-screen map) and RPH console must
            // never have a diagnostics panel drawn on top of them.
            try { if (Game.IsPaused || Game.Console.IsOpen) return; }
            catch { return; }
            var view = published;
            if (view?.Reading == null) return;
            try {
                var screen = Game.Resolution;
                if (screen.Width < 640 || screen.Height < 400) return;
                float s = Math.Max(0.8f,Math.Min(1.85f,screen.Height / 1080f));
                bool expanded = mode == "full";
                float width = 442f*s, height = (expanded ? 324f : 112f)*s;
                float left = screen.Width-width-26f*s;
                float top = screen.Height-height-119f*s;
                var g = args.Graphics;
                var presentation = VehicleHudPresentation.Build(view,view.SampleAtMs);
                if (presentation == null) return;
                var severity = SeverityColor(presentation.Severity);

                Fill(g,left,top,width,height,Color.FromArgb(213,9,18,27));
                Fill(g,left,top,width,3*s,Color.FromArgb(245,57,184,204));
                Fill(g,left,top+3*s,4*s,height-3*s,severity);
                Text(g,"VEHICLE CONDITION",left+22*s,top+15*s,19*s,Color.White);
                Text(g,presentation.Status,left+264*s,top+18*s,12*s,severity);
                Fill(g,left+18*s,top+49*s,width-36*s,1*s,Color.FromArgb(95,94,120,133));

                if (!expanded) {
                    Stat(g,"ENGINE",view.Reading.Engine,left+24*s,top+61*s,116*s,s);
                    Stat(g,"BODY",view.Reading.Body,left+169*s,top+61*s,116*s,s);
                    Stat(g,"TANK",view.Reading.Tank,left+312*s,top+61*s,107*s,s);
                    // A genuine puncture is an actionable alert; the minimized
                    // state otherwise stays compact and quiet.
                    if (presentation.Severity == 2 && presentation.Status == "TIRE PUNCTURE")
                        Text(g,"!",left+423*s,top+15*s,15*s,severity);
                } else {
                    var shape = publishedBody;
                    bool capturedPreview=showCaptureMesh && completedCaptureMesh!=null &&
                        completedCaptureHandle==view.Reading.Handle;
                    bool livePreview=!capturedPreview && liveDeformation.Enabled &&
                        liveDeformation.Handle==view.Reading.Handle &&
                        liveDeformation.Current!=null;
                    if(capturedPreview)shape=completedCaptureMesh;
                    else if(livePreview)shape=liveDeformation.Current;
                    if(shape != null && bodyHandle == view.Reading.Handle) {
                        DrawBodyMesh(g,left,top,s,view.Reading,shape,
                            activeSprite, publishedBody);
                        if(capturedPreview || livePreview)
                            Text(g,capturedPreview?"VH3 CAPTURE REPLAY":"VH5 LIVE EXPERIMENT",
                                left+35*s,top+239*s,9*s,
                                Color.FromArgb(255,244,187,101));
                    } else DrawCar(g,left,top,s,view.Reading);
                    Stat(g,"ENGINE",view.Reading.Engine,left+232*s,top+76*s,176*s,s);
                    Stat(g,"BODY",view.Reading.Body,left+232*s,top+133*s,176*s,s);
                    Stat(g,"FUEL TANK",view.Reading.Tank,left+232*s,top+190*s,176*s,s);
                    Fill(g,left+18*s,top+249*s,width-36*s,1*s,Color.FromArgb(95,94,120,133));
                    Text(g,"LATEST DAMAGE",left+23*s,top+260*s,12*s,Color.FromArgb(255,139,180,190));
                    if (presentation.Alerts.Length == 0) {
                        Text(g,"No recent alerts",left+23*s,top+287*s,16*s,Color.FromArgb(200,170,195,204));
                    } else {
                        for (int i=0;i<presentation.Alerts.Length;i++) {
                            var alert=presentation.Alerts[i];
                            Fill(g,left+22*s,top+(284+i*19)*s,5*s,12*s,SeverityColor(alert.Severity));
                            Text(g,alert.Text,left+35*s,top+(281+i*19)*s,15*s,Color.White);
                        }
                    }
                }
                drawFailures=0;
            } catch(Exception error) {
                if (++drawFailures >= 3) {
                    drawDisabled=true; Game.LogTrivial("[VH1] draw_disabled " + error.GetType().Name);
                }
            }
        }
        // Load a private user-generated PNG only once per selected model.
        // Absolutely no file access or texture creation during FrameRender.
        void LoadSpriteForVehicle(string model,VehicleBodyMesh mesh)
        {
            activeSprite=null;
            if(mesh==null || !mesh.ExtractedGeometry) {
                SpriteStatus="Outline only (no validated local geometry)";
                return;
            }
            if(spriteCache.TryGetValue(model,out var cached)) {
                activeSprite=cached;SpriteStatus="LOCAL 3D SOURCE RENDER";
                return;
            }
            if(spriteCache.Count>=8) {
                SpriteStatus="Sprite budget reached (8 models)";
                return;
            }
            try {
                if(string.IsNullOrWhiteSpace(model)||model.Length>32 ||
                    !System.Linq.Enumerable.All(model,c=>char.IsLetterOrDigit(c)||c=='_'))
                    return;
                string path=Path.Combine(spriteDirectory,
                    model.ToLowerInvariant()+"-shaded.png");
                if(!File.Exists(path)) {
                    SpriteStatus="Outline only (PNG missing)";
                    return;
                }
                var f=new FileInfo(path);
                if(f.Length>4*1024*1024 || f.Length<32) {
                    SpriteStatus="Outline only (invalid PNG size)";return;
                }
                // Reject wrong file formats, suspicious sizes, and huge textures.
                byte[] header=new byte[24];
                using(var stream=File.OpenRead(path)) {
                    if(stream.Read(header,0,24)!=24)throw new InvalidDataException();
                }
                byte[] png={137,80,78,71,13,10,26,10};
                for(int i=0;i<8;i++)if(header[i]!=png[i])
                    throw new InvalidDataException("PNG signature");
                int width=(header[16]<<24)|(header[17]<<16)|(header[18]<<8)|header[19];
                int height=(header[20]<<24)|(header[21]<<16)|(header[22]<<8)|header[23];
                if(width<128 || height<256 || width>2048 || height>2048)
                    throw new InvalidDataException("PNG dimensions");
                // Texture API is part of RagePluginHook. If unsupported on
                // the user's install, fail closed to the existing outline.
                var loaded=Game.CreateTextureFromFile(path);
                if(loaded==null)throw new InvalidDataException("null texture");
                spriteCache[model]=loaded;activeSprite=loaded;
                SpriteStatus="LOCAL 3D SOURCE RENDER";
                Game.LogTrivial("[VH7] source_sprite_loaded model="+model+
                    " width="+width+" height="+height);
            } catch(Exception error) {
                SpriteStatus="Outline only (sprite load failed)";
                Game.LogTrivial("[VH7] source_sprite_failed "+error.GetType().Name);
            }
        }
        static void DrawBodyMesh(Rage.Graphics g,float px,float py,float s,
            VehicleReading reading,VehicleBodyMesh mesh,
            Rage.Texture sourceSprite,VehicleBodyMesh original)
        {
            // Source is either a local user-provided extracted VH6 contour
            // or the existing procedural silhouette. Never read geometry in Paint.
            float cx=px+117*s, front=py+87*s, span=151*s;
            // Preserve each model's measured width:length ratio within the
            // available 2D HUD space instead of stretching every car to 101px.
            float width=Math.Max(59f*s,Math.Min(98f*s,span*mesh.DisplayAspect));
            bool textured=sourceSprite!=null && mesh.ExtractedGeometry;
            Text(g,textured?"FRONT / 3D-MESH RENDER":
                mesh.ExtractedGeometry?"FRONT / MESH-DERIVED":
                "FRONT / "+mesh.Archetype.ToUpperInvariant(),
                px+32*s,py+62*s,10*s,Color.FromArgb(225,151,210,220));
            if(textured) {
                // VH7's 6x12 UV-tile displacement produced global shrinkage,
                // gaps and misaligned regions in the real Buffalo replay.
                // Fail visually safe: keep the recognizable clean-car image
                // until a continuous topology-preserving renderer is proven.
                g.DrawTexture(sourceSprite,
                    new RectangleF(cx-width*.5f,front,width,span));
                // Measured changed exterior outline stays visible as a
                // subtle signal on top of the detailed original render.
                if(mesh.ExperimentalDeformation)
                    StrokePolygon(g,mesh.Outline,cx,front,width,span,s,
                        Color.FromArgb(220,243,173,89));
            } else StrokePolygon(g,mesh.Outline,cx,front,width,span,s,
                Color.FromArgb(255,78,210,221));
            if(!textured && mesh.ExtractedGeometry && mesh.GlassRings.Length>0) {
                // Actual glass-material projections (not guessed cabin).
                // Limit ring count and vertex work at the local-data parser.
                foreach(var ring in mesh.GlassRings)
                    StrokePolygon(g,ring,cx,front,width,span,s,
                        Color.FromArgb(180,155,213,225));
            } else if(!textured)StrokePolygon(g,mesh.Cabin,cx,front,width,span,s,
                Color.FromArgb(175,155,213,225));
            if(mesh.ExtractedGeometry && mesh.WheelCenters.Length==4) {
                for(int i=0;i<4;i++) {
                    var p=mesh.WheelCenters[i];
                    Wheel(g,cx+p.X*width-8*s,front+p.Y*span-17*s,s,
                        VehicleHudPresentation.WheelState(reading,i));
                }
            } else {
                float frontWheel=front+mesh.FrontWheelY*span, rearWheel=front+mesh.RearWheelY*span;
                Wheel(g,cx-width*.5f-21*s,frontWheel-15*s,s,VehicleHudPresentation.WheelState(reading,0));
                Wheel(g,cx+width*.5f+5*s,frontWheel-15*s,s,VehicleHudPresentation.WheelState(reading,1));
                Wheel(g,cx-width*.5f-21*s,rearWheel-15*s,s,VehicleHudPresentation.WheelState(reading,2));
                Wheel(g,cx+width*.5f+5*s,rearWheel-15*s,s,VehicleHudPresentation.WheelState(reading,3));
            }
        }
        // VH8: Experimental tiled image warping intentionally disabled.
        // Localized measured damage remains visible on the 2D outline.
        static void StrokePolygon(Rage.Graphics g,BodyVertex[] vertices,
            float cx,float top,float width,float length,float scale,Color color)
        {
            if(vertices==null||vertices.Length<3)return;
            for(int i=0;i<vertices.Length;i++) {
                var a=vertices[i]; var b=vertices[(i+1)%vertices.Length];
                float x0=cx+a.X*width,y0=top+a.Y*length;
                float x1=cx+b.X*width,y1=top+b.Y*length;
                // Only known Rage.Graphics primitives; no dependence on
                // undocumented polyline/triangle or DX12 hooking APIs.
                int steps=Math.Max(1,(int)Math.Ceiling(
                    Math.Sqrt((x1-x0)*(x1-x0)+(y1-y0)*(y1-y0))/(4.0*scale)));
                for(int j=0;j<=steps;j++) {
                    float t=(float)j/steps;
                    Fill(g,x0+(x1-x0)*t-1.35f*scale,y0+(y1-y0)*t-1.35f*scale,
                        2.7f*scale,2.7f*scale,color);
                }
            }
        }
        static void DrawCar(Rage.Graphics g,float px,float py,float s,VehicleReading reading)
        {
            // A stronger top-down silhouette: distinct hood, glass cabin, trunk,
            // chassis centerline and four unambiguous wheel corners. The four
            // wheel colors reflect *only* GTA puncture readings, not unverified
            // RPH wheel health slot ordering.
            float x=px+57*s, y=py+83*s;
            Text(g,"FRONT",px+96*s,py+62*s,10*s,Color.FromArgb(220,140,191,202));
            Fill(g,x+17*s,y,82*s,162*s,Color.FromArgb(93,33,82,96));
            Outline(g,x+17*s,y,82*s,162*s,s,Color.FromArgb(255,82,199,216));
            // Rounded-looking shoulder shoulders using stepped fill.
            Fill(g,x+24*s,y-5*s,68*s,6*s,Color.FromArgb(255,35,90,103));
            Fill(g,x+12*s,y+24*s,6*s,29*s,Color.FromArgb(180,71,143,160));
            Fill(g,x+99*s,y+24*s,6*s,29*s,Color.FromArgb(180,71,143,160));
            Fill(g,x+29*s,y+22*s,58*s,20*s,Color.FromArgb(90,97,157,172));
            Fill(g,x+27*s,y+51*s,62*s,66*s,Color.FromArgb(70,56,112,129));
            Outline(g,x+27*s,y+51*s,62*s,66*s,s,Color.FromArgb(185,92,181,197));
            Fill(g,x+34*s,y+54*s,48*s,22*s,Color.FromArgb(100,103,188,204));
            Fill(g,x+34*s,y+86*s,48*s,28*s,Color.FromArgb(65,103,188,204));
            Fill(g,x+29*s,y+127*s,58*s,20*s,Color.FromArgb(90,97,157,172));
            Fill(g,x+54*s,y+22*s,1.5f*s,125*s,Color.FromArgb(105,82,199,216));
            Fill(g,x+22*s,y+3*s,25*s,4*s,Color.FromArgb(160,238,235,220));
            Fill(g,x+69*s,y+3*s,25*s,4*s,Color.FromArgb(160,238,235,220));
            Fill(g,x+23*s,y+156*s,24*s,4*s,Color.FromArgb(170,217,66,71));
            Fill(g,x+69*s,y+156*s,24*s,4*s,Color.FromArgb(170,217,66,71));
            // Four standard GTA native burst indices: LF 0, RF 1, LR 4, RR 5.
            Wheel(g,x+1*s,y+26*s,s,VehicleHudPresentation.WheelState(reading,0));
            Wheel(g,x+100*s,y+26*s,s,VehicleHudPresentation.WheelState(reading,1));
            Wheel(g,x+1*s,y+116*s,s,VehicleHudPresentation.WheelState(reading,2));
            Wheel(g,x+100*s,y+116*s,s,VehicleHudPresentation.WheelState(reading,3));
            Text(g,"L",x-13*s,y+80*s,10*s,Color.FromArgb(190,165,191,201));
            Text(g,"R",x+120*s,y+80*s,10*s,Color.FromArgb(190,165,191,201));
        }
        static void Wheel(Rage.Graphics g,float x,float y,float s,int state)
        {
            Color fill = state == 2 ? Color.FromArgb(241,234,78,77) :
                state == 1 ? Color.FromArgb(210,48,173,190) : Color.FromArgb(105,120,130,137);
            Fill(g,x,y,16*s,35*s,fill);
            Fill(g,x+4*s,y+4*s,8*s,27*s,Color.FromArgb(165,9,18,27));
            if (state == 2) Fill(g,x+2*s,y+15*s,12*s,5*s,Color.White);
        }
        static void Stat(Rage.Graphics g,string name,float raw,float x,float y,float width,float s)
        {
            int percent=VehicleHudPresentation.HealthPercent(raw);
            Color tint=percent<0 ? Color.Gray : percent<=25 ? Color.FromArgb(245,88,73) :
                percent<=65 ? Color.FromArgb(241,190,76) : Color.FromArgb(91,217,202);
            Text(g,name,x,y,14*s,Color.FromArgb(240,196,215,223));
            Text(g,percent<0 ? "N/A" : percent+"%",x+width-63*s,y-3*s,21*s,tint);
            Fill(g,x,y+29*s,width,7*s,Color.FromArgb(90,95,117,130));
            if (percent>=0 && percent>0) Fill(g,x,y+29*s,width*percent/100f,7*s,tint);
        }
        static Color SeverityColor(int severity) => severity>=2 ? Color.FromArgb(247,95,82) :
            severity==1 ? Color.FromArgb(255,199,101) : Color.FromArgb(99,206,205);
        static void Text(Rage.Graphics g,string text,float x,float y,float size,Color color) =>
            g.DrawText(text,"Arial",size,new PointF(x,y),color);
        static void Fill(Rage.Graphics g,float x,float y,float w,float h,Color color) =>
            g.DrawRectangle(new RectangleF(x,y,w,h),color);
        static void Outline(Rage.Graphics g,float x,float y,float w,float h,float s,Color color)
        {
            Fill(g,x,y,w,1.7f*s,color);
            Fill(g,x,y+h-1.7f*s,w,1.7f*s,color);
            Fill(g,x,y,1.7f*s,h,color);
            Fill(g,x+w-1.7f*s,y,1.7f*s,h,color);
        }
    }
}
