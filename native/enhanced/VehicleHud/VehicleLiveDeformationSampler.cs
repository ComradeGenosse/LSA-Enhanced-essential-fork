using System;
using System.Diagnostics;
using Rage;
using Rage.Native;

namespace LSA.Enhanced.VehicleHud
{
    // VH5 experimental live deformation. Entirely OPT-IN, no persistence.
    // No GTA reads on FrameRender: all native calls happen in the existing
    // ~5 Hz EnhancedHost game-fiber tick. No game physics writes or memory hooks.
    internal sealed class VehicleLiveDeformationSampler
    {
        const int MaxPerTick=6;
        const long MaxTickUs=2500, MaxOneCallUs=8000;
        const int MaxFailedSweeps=3, MaxSweeps=1200;
        const long ScanTimeoutMs=20000, BetweenSweepsMs=400;
        volatile bool enabled;
        volatile int vehicleHandle;
        int invalidSweeps,completedSweeps;
        string vehicleModel,captureId;
        DeformationBounds bounds;
        VehicleBodyMesh original,target;
        volatile VehicleBodyMesh current;
        DeformationCapture baseline,scan;
        Stopwatch sweepClock;
        long nextSweepAt;
        public bool Enabled => enabled;
        public VehicleBodyMesh Current => current;
        public int Handle => vehicleHandle;
        public string Status {get;private set;}="OFF";
        public void SetEnabled(bool on)
        {
            enabled=on;
            ClearVehicle();
            Status=on?"WAITING - PARK AN UNDAMAGED CAR":"OFF";
        }
        public void VehicleLost()
        {
            if(!enabled)return;
            ClearVehicle();
            Status="WAITING - VALID DRIVEN CAR";
        }
        public void ClearVehicle()
        {
            vehicleHandle=0;vehicleModel=null;captureId=null;bounds=null;
            original=null;current=null;target=null;baseline=null;scan=null;
            sweepClock=null;nextSweepAt=0;invalidSweeps=0;completedSweeps=0;
        }
        void Disable(string reason)
        {
            enabled=false;
            ClearVehicle();
            Status="DISABLED - "+reason;
            Game.LogTrivial("[VH5] live_disabled "+reason);
        }
        public void Tick(Vehicle car,VehicleBodyMesh source,bool anotherSamplerBusy,long now)
        {
            if(!enabled)return;
            if(car==null||!car.IsValid()||!car.IsCar||source==null) {
                ClearVehicle();Status="WAITING - VALID DRIVEN CAR";return;
            }
            int handle=unchecked((int)car.Handle.Value);
            if(vehicleHandle!=handle || !string.Equals(vehicleModel,source.Model,StringComparison.Ordinal)) {
                ClearVehicle();
                vehicleHandle=handle;vehicleModel=source.Model;
                original=source;bounds=source.Bounds;current=source;target=source;
                Status="WAITING - PARK AN UNDAMAGED CAR";
            }
            if(anotherSamplerBusy) {
                // Do not double native probe load when user requests a manual VH3 scan.
                scan=null;sweepClock=null;
                Status="PAUSED - MANUAL VH3 CAPTURE";return;
            }
            if(baseline==null) {
                float speed,body;
                try {
                    speed=car.Speed;
                    body=NativeFunction.CallByName<float>("GET_VEHICLE_BODY_HEALTH",handle);
                } catch {Status="WAITING - HEALTH/SPEED UNKNOWN";return;}
                if(float.IsNaN(speed)||float.IsInfinity(speed)||Math.Abs(speed)>.5f||
                    float.IsNaN(body)||body<975f || car.EngineHealth<975f) {
                    scan=null;sweepClock=null;
                    Status="WAITING - PARK UNDAMAGED VEHICLE";return;
                }
            }
            // Interpolate only on the game fiber, 5Hz. Draw thread reads snapshot.
            if(current!=null && target!=null && !object.ReferenceEquals(current,target))
                current=VehicleMeshGeometry.Blend(current,target,.38f);
            if(scan==null) {
                if(now<nextSweepAt)return;
                if(completedSweeps>=MaxSweeps) {Disable("SESSION SWEEP LIMIT");return;}
                if(baseline==null)captureId="live_"+Guid.NewGuid().ToString("N");
                float hp,bodyHp;
                try {
                    hp=car.EngineHealth;
                    bodyHp=NativeFunction.CallByName<float>("GET_VEHICLE_BODY_HEALTH",handle);
                } catch {Disable("HEALTH READ FAILED");return;}
                scan=new DeformationCapture(captureId,baseline==null?"baseline":"damaged",
                    vehicleModel,vehicleHandle,DateTime.UtcNow.ToString("o"),bounds,hp,bodyHp);
                sweepClock=Stopwatch.StartNew();
            }
            if(sweepClock!=null && sweepClock.ElapsedMilliseconds>ScanTimeoutMs) {
                Disable("SCAN TIMEOUT");return;
            }
            long batchStarted=Stopwatch.GetTimestamp();
            for(int i=0;i<MaxPerTick && scan!=null && !scan.Complete;i++) {
                var p=scan.Next;
                long start=Stopwatch.GetTimestamp();
                try {
                    var v=NativeFunction.CallByHash<Vector3>(0x4EC6CFBC7B2E9536UL,
                        handle,p.X,p.Y,p.Z);
                    scan.Record(v.X,v.Y,v.Z);
                } catch(Exception exception) {
                    scan.Record(float.NaN,float.NaN,float.NaN,
                        "native_"+exception.GetType().Name);
                }
                long nativeUs=(long)((Stopwatch.GetTimestamp()-start)*1000000d/Stopwatch.Frequency);
                if(nativeUs>MaxOneCallUs) {Disable("NATIVE CALL TOO SLOW");return;}
                long usedUs=(long)((Stopwatch.GetTimestamp()-batchStarted)*1000000d/Stopwatch.Frequency);
                if(usedUs>=MaxTickUs)break;
            }
            if(scan==null || !scan.Complete) {
                Status=baseline==null?"ACQUIRING CLEAN BASELINE":"LIVE SCANNING";
                return;
            }
            var complete=scan;
            scan=null;sweepClock=null;
            nextSweepAt=now+BetweenSweepsMs;
            if(complete.ValidCount<40) {
                if(++invalidSweeps>=MaxFailedSweeps)Disable("UNRELIABLE NATIVE PROBES");
                else Status="RETRY - INCOMPLETE SCAN";
                return;
            }
            invalidSweeps=0;completedSweeps++;
            if(baseline==null) {
                // Do not mistake an already-crushed body for a clean reference,
                // even when an external script has restored aggregate HP.
                int disturbed=0;
                foreach(var r in complete.Results)
                    if(r.Valid && r.Magnitude>=.045f)disturbed++;
                if(disturbed>=3) {
                    // Refuse a contaminated reference rather than scanning
                    // the damaged car indefinitely every ~2 seconds.
                    Disable("REFERENCE ALREADY DEFORMED");return;
                }
                baseline=complete;
                Status="LIVE ARMED - "+complete.ValidCount+"/48 REFERENCE";
                Game.LogTrivial("[VH5] baseline_acquired model="+vehicleModel+
                    " probes="+complete.ValidCount);
                return;
            }
            VehicleBodyMesh reconstructed;
            try { reconstructed=VehicleMeshGeometry.Deform(original,baseline,complete); }
            catch(Exception e) {Disable("RECONSTRUCTION "+e.GetType().Name);return;}
            target=reconstructed;
            if(completedSweeps%30==0)
                Game.LogTrivial("[VH5] live_sweep count="+completedSweeps+
                    " valid="+complete.ValidCount+" deformed="+reconstructed.ExperimentalDeformation);
            Status=reconstructed.ExperimentalDeformation?
                "LIVE - DEFORMATION TRACKED":"LIVE - NO SIGNIFICANT CHANGE";
        }
    }
}
