using System;
using System.IO;
using System.Diagnostics;
using System.Collections.Generic;
using Rage;
using Rage.Native;

namespace LSA.Enhanced.VehicleHud
{
    // Opt-in, per-session, game-fiber-only VH3 research collector. This is a
    // bounded one-shot probe run, not continuous mesh capture or a graphics hook.
    internal sealed class VehicleDeformationLab
    {
        const int ProbeBatch=6, MaxCaptures=20;
        const long MaxTickProbeUs=2500, MaxIndividualProbeUs=8000;
        const long MaxSweepMs=20000, MaxCaptureBytes=96*1024, MaxSessionBytes=2*1024*1024;
        long savedBytes;
        readonly string root;
        bool enabled;
        int saved,vehicleHandle;
        string pending,sessionId,model;
        DeformationCapture active;
        DeformationCapture baselineSnapshot,readyBaseline,readyDamaged;
        // Consumed exclusively on the game fiber after successful file save.
        // No disk reads or native calls are needed to preview a matched pair.
        public bool TryConsumePair(out DeformationCapture baseline,out DeformationCapture damaged)
        {
            baseline=readyBaseline;damaged=readyDamaged;
            readyBaseline=null;readyDamaged=null;
            return baseline!=null && damaged!=null;
        }
        readonly List<string> probeTrace = new List<string>();
        Stopwatch captureClock;
        long maxNativeMicroseconds;
        float maxCaptureSpeed;
        string gameVersion="unavailable",rphVersion="unavailable";
        public bool Enabled => enabled;
        public bool IsBusy => enabled && (active!=null || pending!=null);
        public string Status {get;private set;}="OFF";
        public VehicleDeformationLab(string plugins)
        {
            root=Path.Combine(plugins ?? "", "LSA","Logs","VH3");
        }
        public void SetEnabled(bool on)
        {
            enabled=on;
            pending=null;active=null;vehicleHandle=0;
            sessionId=null;probeTrace.Clear();captureClock=null;
            baselineSnapshot=null;readyBaseline=null;readyDamaged=null;
            Status=on?"READY - capture baseline":"OFF";
        }
        public string Request(string phase)
        {
            if(!enabled)return "VH3 disabled; enable it first";
            if(active!=null||pending!=null)return "VH3 capture already running";
            if(saved>=MaxCaptures)return "VH3 session capture limit reached";
            if(phase!="baseline"&&phase!="damaged")return "Unknown VH3 phase";
            if(phase=="damaged"&&sessionId==null)
                return "Capture a baseline first";
            pending=phase;
            Status="QUEUED "+phase;
            return "VH3 "+phase+" capture queued (48 points)";
        }
        public void Tick(Vehicle car,long nowMs)
        {
            if(!enabled || (pending==null&&active==null))return;
            if(car==null||!car.IsValid()||!car.IsCar) {
                pending=null;active=null;probeTrace.Clear();sessionId=null;vehicleHandle=0;
                baselineSnapshot=null;readyBaseline=null;readyDamaged=null;
                Status="NO DRIVEN CAR - RECAPTURE BASELINE";return;
            }
            int handle=unchecked((int)car.Handle.Value);
            if(active!=null && active.Handle!=handle) {
                active=null;pending=null;sessionId=null;vehicleHandle=0;
                probeTrace.Clear();baselineSnapshot=null;
                readyBaseline=null;readyDamaged=null;
                Status="CANCELLED - VEHICLE CHANGED";return;
            }
            // These 48 calls are diagnostic only: never scan while driving.
            // A rolling car produces ambiguous offsets and needless game load.
            try {
                if(float.IsNaN(car.Speed)||float.IsInfinity(car.Speed)||Math.Abs(car.Speed)>0.5f) {
                    active=null;pending=null;probeTrace.Clear();captureClock=null;
                    Status="CANCELLED - PARK BEFORE CAPTURE";
                    return;
                }
            } catch { active=null;pending=null;Status="CANCELLED - SPEED UNKNOWN";return; }
            if(active!=null && captureClock!=null && captureClock.ElapsedMilliseconds>MaxSweepMs) {
                active=null;pending=null;probeTrace.Clear();captureClock=null;
                enabled=false;Status="DISABLED - SWEEP TIMEOUT";
                Game.LogTrivial("[VH3] disabled sweep_timeout");return;
            }
            if(active==null) {
                try {
                    if(pending=="damaged"&&vehicleHandle!=handle) {
                        pending=null;Status="WRONG CAR - RECAPTURE BASELINE";return;
                    }
                    Vector3 min,max;
                    car.Model.GetDimensions(out min,out max);
                    var bounds=new DeformationBounds(min.X,min.Y,min.Z,max.X,max.Y,max.Z);
                    if(!bounds.Valid) {
                        pending=null;Status="INVALID MODEL BOUNDS";return;
                    }
                    model=car.Model.Name ?? "unknown";
                    string id=pending=="baseline"
                        ?DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff")+"_"+Guid.NewGuid().ToString("N").Substring(0,8)
                        :sessionId;
                    float body=NativeFunction.CallByName<float>("GET_VEHICLE_BODY_HEALTH",handle);
                    active=new DeformationCapture(id,pending,model,handle,
                        DateTime.UtcNow.ToString("o"),bounds,car.EngineHealth,body);
                    pending=null;
                    probeTrace.Clear();
                    captureClock=Stopwatch.StartNew();
                    maxCaptureSpeed=0f;
                    maxNativeMicroseconds=0L;
                    try {gameVersion=Process.GetCurrentProcess().MainModule.FileVersionInfo.FileVersion ?? "unavailable"; }
                    catch {gameVersion="unavailable";}
                    try {rphVersion=typeof(Game).Assembly.GetName().Version.ToString();}
                    catch {rphVersion="unavailable";}
                } catch(Exception e) {
                    active=null;pending=null;
                    Status="SETUP FAILED "+e.GetType().Name;
                    Game.LogTrivial("[VH3] setup_failed "+e.GetType().Name);
                    return;
                }
            }
            long batchStart=Stopwatch.GetTimestamp();
            for(int i=0;i<ProbeBatch&&!active.Complete;i++) {
                var p=active.Next;
                long nativeStart=Stopwatch.GetTimestamp();
                try {
                    var d=NativeFunction.CallByHash<Vector3>(0x4EC6CFBC7B2E9536UL,
                        handle,p.X,p.Y,p.Z);
                    active.Record(d.X,d.Y,d.Z);
                } catch(Exception ex) {
                    active.Record(float.NaN,float.NaN,float.NaN,
                        "native_"+ex.GetType().Name);
                }
                long elapsedTicks=Stopwatch.GetTimestamp()-nativeStart;
                long callUs=elapsedTicks<=0?0:(long)(elapsedTicks*1000000d/Stopwatch.Frequency);
                if(callUs>maxNativeMicroseconds)maxNativeMicroseconds=callUs;
                if(callUs>MaxIndividualProbeUs) {
                    active=null;pending=null;probeTrace.Clear();captureClock=null;
                    enabled=false; Status="DISABLED - EXPENSIVE NATIVE";
                    Game.LogTrivial("[VH3] disabled native_call_us="+callUs);return;
                }
                float speed=float.NaN,wx=float.NaN,wy=float.NaN,wz=float.NaN;
                try {
                    speed=car.Speed;
                    var location=car.Position;
                    wx=location.X;wy=location.Y;wz=location.Z;
                    if(!float.IsNaN(speed)&&!float.IsInfinity(speed))
                        maxCaptureSpeed=Math.Max(maxCaptureSpeed,Math.Abs(speed));
                } catch { /* Missing optional context is never rendered as zero. */ }
                // One forensic row per native call, even if the native itself
                // failed or returned a zero displacement; no probe is lost.
                try {
                    probeTrace.Add(VehicleProbeTrace.Row(active,
                        active.Results[active.Count-1],DateTime.UtcNow.ToString("o"),
                        callUs,captureClock==null?0:captureClock.ElapsedMilliseconds,
                        speed,wx,wy,wz,gameVersion,rphVersion));
                } catch(Exception traceError) {
                    probeTrace.Add(""); // preserve index ordering as a visible gap
                    Game.LogTrivial("[VH3] trace_row_failed "+traceError.GetType().Name);
                }
                // Enforce wall-clock work budget, not just six calls per tick.
                long batchUs=(long)((Stopwatch.GetTimestamp()-batchStart)*1000000d/Stopwatch.Frequency);
                if(batchUs>=MaxTickProbeUs)break;
            }
            if(!active.Complete) {
                Status="CAPTURING "+active.Phase+" "+active.Count+"/"+active.Points.Length;
                return;
            }
            var finished=active;
            active=null;
            try {
                Directory.CreateDirectory(root);
                string safeModel=new string(model.ToCharArray());
                foreach(char ch in Path.GetInvalidFileNameChars())
                    safeModel=safeModel.Replace(ch,'_');
                if(safeModel.Length>32)safeModel=safeModel.Substring(0,32);
                string path=Path.Combine(root,finished.CaptureId+"_"+safeModel+"_"+finished.Phase+".csv");
                // One file per capture; no rotation, auto-delete, mutation of
                // GTA assets, network requests, or arbitrary output filenames.
                if(File.Exists(path))throw new IOException("capture_exists");
                string captureText=finished.Csv();
                string forensicText=VehicleProbeTrace.Header+Environment.NewLine+
                    string.Join(Environment.NewLine,probeTrace.ToArray())+Environment.NewLine;
                long projectedBytes=System.Text.Encoding.UTF8.GetByteCount(captureText)+
                    System.Text.Encoding.UTF8.GetByteCount(forensicText);
                if(projectedBytes>MaxCaptureBytes || savedBytes+projectedBytes>MaxSessionBytes)
                    throw new IOException("session_diagnostic_quota");
                File.WriteAllText(path,captureText);
                savedBytes+=System.Text.Encoding.UTF8.GetByteCount(captureText);
                // A separate forensic audit retains precise probe timings,
                // sample UTC, speed and position without breaking the existing
                // 24-column capture/replay parser or old saved files.
                try {
                    string tracePath=Path.Combine(root,finished.CaptureId+"_"+safeModel+
                        "_"+finished.Phase+".diagnostics.csv");
                    if(File.Exists(tracePath))throw new IOException("trace_exists");
                    File.WriteAllText(tracePath,forensicText);
                    savedBytes+=System.Text.Encoding.UTF8.GetByteCount(forensicText);
                } catch(Exception auditError) {
                    Game.LogTrivial("[VH3] diagnostics_write_failed "+auditError.GetType().Name);
                }
                saved++;
                if(finished.Phase=="baseline") {
                    sessionId=finished.CaptureId;
                    vehicleHandle=finished.Handle;
                    baselineSnapshot=finished;
                    readyBaseline=null;readyDamaged=null;
                } else {
                    if(baselineSnapshot!=null &&
                        baselineSnapshot.CaptureId==finished.CaptureId &&
                        baselineSnapshot.Handle==finished.Handle &&
                        baselineSnapshot.Model==finished.Model) {
                        readyBaseline=baselineSnapshot;
                        readyDamaged=finished;
                    }
                    baselineSnapshot=null;
                    sessionId=null;vehicleHandle=0;
                }
                int zeros=0;
                foreach(var r in finished.Results)
                    if(r.Valid && r.Magnitude<0.00001f)zeros++;
                long totalMs=captureClock==null?0:captureClock.ElapsedMilliseconds;
                bool moving=maxCaptureSpeed>0.5f;
                Status="SAVED "+finished.Phase+" "+finished.ValidCount+"/48 VALID"+
                    (moving?" / MOVING - REVIEW":"")+
                    (zeros==finished.ValidCount?" / ALL ZERO":"");
                Game.LogTrivial("[VH3] saved phase="+finished.Phase+
                    " valid="+finished.ValidCount+"/48 zeros="+zeros+
                    " duration_ms="+totalMs+" max_native_us="+maxNativeMicroseconds+
                    " max_speed_mps="+maxCaptureSpeed.ToString("0.###",
                        System.Globalization.CultureInfo.InvariantCulture)+
                    " moving="+moving+" path="+path);
                probeTrace.Clear();captureClock=null;
            } catch(Exception ex) {
                Status="WRITE FAILED "+ex.GetType().Name;
                Game.LogTrivial("[VH3] capture_write_failed "+ex.GetType().Name);
                // Don't allow damaged phase to pair against an unsaved baseline.
                if(finished.Phase=="baseline") {sessionId=null;vehicleHandle=0;}
            }
        }
    }
}
