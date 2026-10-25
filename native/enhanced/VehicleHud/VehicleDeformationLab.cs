using System;
using System.IO;
using Rage;
using Rage.Native;

namespace LSA.Enhanced.VehicleHud
{
    // Opt-in, per-session, game-fiber-only VH3 research collector. This is a
    // bounded one-shot probe run, not continuous mesh capture or a graphics hook.
    internal sealed class VehicleDeformationLab
    {
        const int ProbeBatch=6, MaxCaptures=20;
        readonly string root;
        bool enabled;
        int saved,vehicleHandle;
        string pending,sessionId,model;
        DeformationCapture active;
        public bool Enabled => enabled;
        public string Status {get;private set;}="OFF";
        public VehicleDeformationLab(string plugins)
        {
            root=Path.Combine(plugins ?? "", "LSA","Logs","VH3");
        }
        public void SetEnabled(bool on)
        {
            enabled=on;
            pending=null;active=null;vehicleHandle=0;
            sessionId=null;
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
                pending=null;active=null; Status="NO DRIVEN CAR";return;
            }
            int handle=unchecked((int)car.Handle.Value);
            if(active!=null && active.Handle!=handle) {
                active=null;pending=null;sessionId=null;vehicleHandle=0;
                Status="CANCELLED - VEHICLE CHANGED";return;
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
                } catch(Exception e) {
                    active=null;pending=null;
                    Status="SETUP FAILED "+e.GetType().Name;
                    Game.LogTrivial("[VH3] setup_failed "+e.GetType().Name);
                    return;
                }
            }
            for(int i=0;i<ProbeBatch&&!active.Complete;i++) {
                var p=active.Next;
                try {
                    var d=NativeFunction.CallByHash<Vector3>(0x4EC6CFBC7B2E9536UL,
                        handle,p.X,p.Y,p.Z);
                    active.Record(d.X,d.Y,d.Z);
                } catch(Exception ex) {
                    active.Record(float.NaN,float.NaN,float.NaN,
                        "native_"+ex.GetType().Name);
                }
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
                File.WriteAllText(path,finished.Csv());
                saved++;
                if(finished.Phase=="baseline") {
                    sessionId=finished.CaptureId;
                    vehicleHandle=finished.Handle;
                } else {
                    sessionId=null;vehicleHandle=0;
                }
                Status="SAVED "+finished.Phase+" "+finished.ValidCount+"/48 VALID";
                Game.LogTrivial("[VH3] saved phase="+finished.Phase+
                    " valid="+finished.ValidCount+"/48 path="+path);
            } catch(Exception ex) {
                Status="WRITE FAILED "+ex.GetType().Name;
                Game.LogTrivial("[VH3] capture_write_failed "+ex.GetType().Name);
                // Don't allow damaged phase to pair against an unsaved baseline.
                if(finished.Phase=="baseline") {sessionId=null;vehicleHandle=0;}
            }
        }
    }
}
