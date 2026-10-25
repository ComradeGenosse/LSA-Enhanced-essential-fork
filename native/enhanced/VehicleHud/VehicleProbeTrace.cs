using System;
using System.Globalization;

namespace LSA.Enhanced.VehicleHud
{
    // VH3 forensic sidecar: one row per native probe, in the same index order
    // as the baseline/damaged CSV. Never substitute missing values with zero.
    // This sidecar is intentionally separate so older 24-column capture tools
    // remain compatible with all previous exported captures.
    public static class VehicleProbeTrace
    {
        public const string Header=
            "utc,capture_id,phase,model,handle,probe_index,region,"+
            "sample_x,sample_y,sample_z,dx,dy,dz,valid,reason,"+
            "native_us,capture_elapsed_ms,speed_mps,world_x,world_y,world_z,"+
            "engine_hp,body_hp,game_version,rph_version";
        static string F(float value) =>
            float.IsNaN(value)||float.IsInfinity(value)?"":value.ToString("0.#####",CultureInfo.InvariantCulture);
        static string Q(string value)
        {
            value=value??"";
            if(value.Length>0 && "=+-@\t\r\n".IndexOf(value[0])>=0)value="'"+value;
            return "\""+value.Replace("\"","\"\"")+"\"";
        }
        public static string Row(DeformationCapture capture,DeformationReading reading,
            string sampleUtc,long nativeMicroseconds,long elapsedMs,
            float speed,float worldX,float worldY,float worldZ,
            string gameVersion,string rphVersion)
        {
            if(capture==null||reading==null||reading.Point==null)
                throw new ArgumentException("missing_capture_reading");
            var p=reading.Point;
            return string.Join(",",new[] {
                Q(sampleUtc),Q(capture.CaptureId),Q(capture.Phase),Q(capture.Model),
                capture.Handle.ToString(CultureInfo.InvariantCulture),
                p.Index.ToString(CultureInfo.InvariantCulture),Q(p.Region),
                F(p.X),F(p.Y),F(p.Z),
                F(reading.Dx),F(reading.Dy),F(reading.Dz),
                reading.Valid?"1":"0",Q(reading.Reason),
                Math.Max(0,nativeMicroseconds).ToString(CultureInfo.InvariantCulture),
                Math.Max(0,elapsedMs).ToString(CultureInfo.InvariantCulture),
                F(speed),F(worldX),F(worldY),F(worldZ),
                F(capture.EngineHp),F(capture.BodyHp),Q(gameVersion),Q(rphVersion)
            });
        }
    }
}
