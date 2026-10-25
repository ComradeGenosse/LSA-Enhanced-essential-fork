using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace LSA.Enhanced.VehicleHud
{
    // VH4 opt-in flight recorder. No GTA/RPH APIs, threads, timers or disk I/O.
    // Observes ONLY already-published 5Hz HUD samples. Ring buffer is bounded.
    public sealed class VehicleCrashFlightRecorder
    {
        const int PreMs=10000, PostMs=8000, CooldownMs=12000, MaxFrames=110;
        readonly Queue<FlightFrame> recent=new Queue<FlightFrame>();
        readonly List<FlightFrame> incident=new List<FlightFrame>();
        int lastHandle,recordedIncidents,incidentSequence;
        long lastNow=-1,triggerAt,recordUntil,lastFinishedAt=-CooldownMs;
        float previousBody=float.NaN,previousEngine=float.NaN;
        int previousKnown,previousBurst;
        string trigger,incidentId,model;
        public bool Enabled {get;private set;}
        public string Status {get;private set;}="OFF";
        public int IncidentCount => recordedIncidents;
        public const int MaximumIncidents=10;
        public const string Header="incident_id,trigger,relative_ms,speed_mps,steering_degrees,lateral_mps,on_all_wheels,"+
            VehicleTelemetryCsv.Header;
        sealed class FlightFrame
        {
            public readonly long Ms;
            public readonly string Csv;
            public readonly string Motion;
            public FlightFrame(long ms,string csv,string motion) { Ms=ms; Csv=csv; Motion=motion; }
        }
        public void SetEnabled(bool enable)
        {
            Enabled=enable;
            ResetCar();
            Status=enable?"ARMED - rolling 10s / 5Hz":"OFF";
        }
        void ResetCar()
        {
            recent.Clear();incident.Clear();
            lastHandle=0;lastNow=-1;previousBody=float.NaN;
            previousEngine=float.NaN;previousKnown=0;previousBurst=0;
            trigger=null;incidentId=null;model=null;
            triggerAt=0;recordUntil=0;
        }
        public void Stop() { SetEnabled(false); }
        public void NoVehicle()
        {
            if(!Enabled)return;
            ResetCar();
            Status="ARMED - waiting for vehicle";
        }
        static bool Hp(float v) =>
            !float.IsNaN(v)&&!float.IsInfinity(v)&&v>=0f&&v<=5000f;
        static string Label(VehicleReading next,
            float prevBody,float prevEngine,int known,int burst)
        {
            if ((next.KnownTires & known & (next.BurstTires & ~burst))!=0)
                return "tire_burst";
            if (Hp(prevBody)&&Hp(next.Body)&&prevBody-next.Body>=20f)
                return "body_hp_drop";
            if (Hp(prevEngine)&&Hp(next.Engine)&&prevEngine-next.Engine>=25f)
                return "engine_hp_drop";
            return null;
        }
        static string Q(string s) => "\""+(s??"").Replace("\"","\"\"")+"\"";
        static string Motion(float f) =>
            float.IsNaN(f)||float.IsInfinity(f)?"":f.ToString("0.###",CultureInfo.InvariantCulture);
        // Returns a complete in-memory CSV only after an incident is finished.
        // The caller can save it with a strict session/disk quota.
        public string Observe(VehicleView view,string modelName,long now,string utc)
        {
            if(!Enabled || view?.Reading==null) return null;
            var r=view.Reading;
            if(r.Handle<=0)return null;
            if(lastHandle!=r.Handle || (lastNow>=0 && now<lastNow)) {
                ResetCar();
                lastHandle=r.Handle;
            }
            lastNow=now;
            string thisModel=modelName??"unavailable";
            var motion=string.Join(",",new[] {
                Motion(r.SpeedMps),Motion(r.SteeringDegrees),Motion(r.LateralSpeedMps),
                r.OnAllWheels?"1":"0"
            });
            var frame=new FlightFrame(now,
                VehicleTelemetryCsv.Row(utc,"flight",thisModel,view),motion);
            while(recent.Count>0 && now-recent.Peek().Ms>PreMs)
                recent.Dequeue();
            if(recent.Count>=MaxFrames)recent.Dequeue();
            recent.Enqueue(frame);
            string cause=Label(r,previousBody,previousEngine,previousKnown,previousBurst);
            previousBody=r.Body;previousEngine=r.Engine;
            previousKnown=r.KnownTires;previousBurst=r.BurstTires;
            if(trigger==null && cause!=null && recordedIncidents<MaximumIncidents &&
                (lastFinishedAt<0 || now-lastFinishedAt>=CooldownMs)) {
                trigger=cause;triggerAt=now;recordUntil=now+PostMs;
                model=thisModel;
                incidentId="flight_"+DateTime.UtcNow.ToString("yyyyMMddTHHmmssfff")+
                    "_"+(++incidentSequence).ToString(CultureInfo.InvariantCulture);
                incident.Clear();
                foreach(var previous in recent)incident.Add(previous);
                Status="RECORDING "+trigger;
            } else if(trigger!=null && incident.Count<MaxFrames) {
                incident.Add(frame);
            }
            if(trigger==null || now<recordUntil)return null;
            // A completed incident contains at most 110 samples (~22s at 5Hz).
            var text=new StringBuilder(Header).AppendLine();
            foreach(var sample in incident) {
                text.Append(Q(incidentId)).Append(',').Append(Q(trigger)).Append(',')
                    .Append((sample.Ms-triggerAt).ToString(CultureInfo.InvariantCulture))
                    .Append(',').Append(sample.Motion).Append(',').AppendLine(sample.Csv);
            }
            recordedIncidents++;
            lastFinishedAt=now;
            trigger=null;incident.Clear();
            Status=recordedIncidents>=MaximumIncidents ? "LIMIT - 10 incidents" :
                "ARMED - "+recordedIncidents+" incidents captured";
            return text.ToString();
        }
    }
}
