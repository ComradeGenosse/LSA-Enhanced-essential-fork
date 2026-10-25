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
        public string CaptureDeformation(string phase) => deformationLab.Request(phase);
        long nextCsv;
        int lastLoggedVehicle;
        long lastEventAt = -1;
        readonly HashSet<string> eventsAtTimestamp = new HashSet<string>(StringComparer.Ordinal);
        public bool Logging {get;private set;}
        public VehicleHudController(string plugins)
        {
            traceFile = Path.Combine(plugins ?? "", "LSA", "Logs", "vehicle-telemetry.csv");
            deformationLab = new VehicleDeformationLab(plugins);
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
            deformationLab.SetEnabled(false);
            flight.Stop();
        }
        public void Tick(long now,bool paused)
        {
            if ((mode == "off" && !Logging && !deformationLab.Enabled && !flight.Enabled && pendingFlight.Count==0) || samplerDisabled) return;
            if (now < nextSample) return;
            nextSample = now + SampleEveryMs;
            if (paused) { timeline.Clear(); published = null; return; }
            try {
                var player = Game.LocalPlayer.Character;
                var car = player != null && player.IsValid() ? player.CurrentVehicle : null;
                if (car == null || !car.IsValid() || !car.IsCar || car.Driver == null || car.Driver.Handle != player.Handle) {
                    timeline.Clear(); published = null;
                    publishedBody = null; bodyHandle = 0;
                    deformationLab.Tick(null,now);
                    flight.NoVehicle();
                    FlushFlightWhenStationary(true);
                    failures = 0; return;
                }
                if (bodyHandle != unchecked((int)car.Handle.Value)) {
                    bodyHandle = unchecked((int)car.Handle.Value);
                    publishedBody = null;
                    flightModel = "unavailable";
                    try {
                        Vector3 min,max;
                        car.Model.GetDimensions(out min,out max);
                        string name=car.Model.Name ?? "unknown";
                        flightModel = name;
                        publishedBody=VehicleMeshGeometry.Build(name,
                            new DeformationBounds(min.X,min.Y,min.Z,max.X,max.Y,max.Z));
                    } catch (Exception error) {
                        Game.LogTrivial("[VH3B] silhouette_unavailable "+error.GetType().Name);
                    }
                }
                // Optional VH3 sampling: six probe calls per sampler tick.
                // The live HUD does not use this experimental data.
                deformationLab.Tick(car,now);
                // In HUD-off / flight-only mode, ordinary health sampling is
                // still required for the flight recorder. It runs at 5Hz,
                // never adds deformation probes beyond the existing four.
                if(mode=="off" && !Logging && !flight.Enabled) {
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
                    if(shape != null && bodyHandle == view.Reading.Handle)
                        DrawBodyMesh(g,left,top,s,view.Reading,shape);
                    else DrawCar(g,left,top,s,view.Reading);
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
        static void DrawBodyMesh(Rage.Graphics g,float px,float py,float s,
            VehicleReading reading,VehicleBodyMesh mesh)
        {
            // Vehicle model bounds and known archetype silhouette. Deliberately
            // UNDEFORMED until probe/runtime spatial correspondence is validated.
            float cx=px+117*s, front=py+87*s, span=151*s;
            // Preserve each model's measured width:length ratio within the
            // available 2D HUD space instead of stretching every car to 101px.
            float modelWidth=mesh.Bounds.MaxX-mesh.Bounds.MinX;
            float modelLength=mesh.Bounds.MaxY-mesh.Bounds.MinY;
            float width=Math.Max(59f,Math.Min(98f,span*modelWidth/modelLength))*s;
            Text(g,"FRONT / "+mesh.Archetype.ToUpperInvariant(),px+32*s,py+62*s,10*s,
                Color.FromArgb(225,151,210,220));
            StrokePolygon(g,mesh.Outline,cx,front,width,span,s,
                Color.FromArgb(255,78,210,221));
            StrokePolygon(g,mesh.Cabin,cx,front,width,span,s,
                Color.FromArgb(175,155,213,225));
            float frontWheel=front+mesh.FrontWheelY*span, rearWheel=front+mesh.RearWheelY*span;
            Wheel(g,cx-width*.5f-21*s,frontWheel-15*s,s,VehicleHudPresentation.WheelState(reading,0));
            Wheel(g,cx+width*.5f+5*s,frontWheel-15*s,s,VehicleHudPresentation.WheelState(reading,1));
            Wheel(g,cx-width*.5f-21*s,rearWheel-15*s,s,VehicleHudPresentation.WheelState(reading,2));
            Wheel(g,cx+width*.5f+5*s,rearWheel-15*s,s,VehicleHudPresentation.WheelState(reading,3));
        }
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
