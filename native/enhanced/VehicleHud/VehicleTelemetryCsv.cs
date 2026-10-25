using System;
using System.Globalization;
using System.Text;

namespace LSA.Enhanced.VehicleHud
{
    // Pure CSV serialization of sampled readings. Unknown values stay blank.
    // Never infer rim health or map RPH wheel slots to physical corners.
    public static class VehicleTelemetryCsv
    {
        public const string Header =
            "utc,kind,model,handle,engine_hp,body_hp,tank_hp,known_tires,burst_tires," +
            "wheel0,tire0,wheel1,tire1,wheel2,tire2,wheel3,tire3," +
            "deform0,deform1,deform2,deform3,event";
        static string Q(string v)
        {
            v = v ?? "";
            // Values come from in-game models and event text; protect against
            // spreadsheet formula interpretation and malformed CSV.
            if (v.Length > 0 && "=+-@\t\r\n".IndexOf(v[0]) >= 0) v = "'" + v;
            return "\"" + v.Replace("\"","\"\"") + "\"";
        }
        static string N(float v) => !float.IsNaN(v) && !float.IsInfinity(v) ?
            v.ToString("0.###",CultureInfo.InvariantCulture) : "";
        static string Known(float[] values,int mask,int index) =>
            (mask & (1 << index)) != 0 && values != null && values.Length > index ?
            N(values[index]) : "";
        public static string Row(string utc,string kind,string model,VehicleView view,string eventText = "")
        {
            var r=view?.Reading;
            if (r==null) return "";
            var fields=new string[22];
            fields[0]=Q(utc); fields[1]=Q(kind); fields[2]=Q(model);
            fields[3]=r.Handle.ToString(CultureInfo.InvariantCulture);
            fields[4]=N(r.Engine); fields[5]=N(r.Body); fields[6]=N(r.Tank);
            fields[7]=r.KnownTires.ToString(CultureInfo.InvariantCulture);
            fields[8]=r.BurstTires.ToString(CultureInfo.InvariantCulture);
            for (int i=0;i<4;i++) {
                fields[9+i*2]=Known(r.WheelHealth,r.KnownWheelHealth,i);
                fields[10+i*2]=Known(r.TireHealth,r.KnownTireHealth,i);
                fields[17+i]=Known(r.Deformation,r.KnownDeformation,i);
            }
            fields[21]=Q(eventText);
            return string.Join(",",fields);
        }
    }
}
