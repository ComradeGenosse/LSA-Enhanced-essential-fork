using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace LSA.Enhanced.VehicleHud
{
    // Pure, RPH-free 48-probe research model. None of these points represents
    // an authenticated GTA mesh vertex, body panel or collision primitive.
    public sealed class DeformationPoint
    {
        public readonly int Index;
        public readonly string Region;
        public readonly float X,Y,Z;
        public DeformationPoint(int index,string region,float x,float y,float z)
        { Index=index; Region=region; X=x; Y=y; Z=z; }
    }
    public sealed class DeformationBounds
    {
        public readonly float MinX,MinY,MinZ,MaxX,MaxY,MaxZ;
        public DeformationBounds(float minX,float minY,float minZ,float maxX,float maxY,float maxZ)
        { MinX=minX; MinY=minY; MinZ=minZ; MaxX=maxX; MaxY=maxY; MaxZ=maxZ; }
        static bool Finite(float f) => !float.IsNaN(f) && !float.IsInfinity(f);
        public bool Valid => Finite(MinX) && Finite(MinY) && Finite(MinZ) &&
            Finite(MaxX) && Finite(MaxY) && Finite(MaxZ) &&
            MaxX-MinX >= 0.8f && MaxX-MinX <= 6f &&
            MaxY-MinY >= 1.5f && MaxY-MinY <= 18f &&
            MaxZ-MinZ >= 0.4f && MaxZ-MinZ <= 6f;
        public float X(float p) => MinX+(MaxX-MinX)*p;
        public float Y(float p) => MinY+(MaxY-MinY)*p;
        public float Z(float p) => MinZ+(MaxZ-MinZ)*p;
    }
    public static class VehicleDeformationGrid
    {
        // 9 front + 9 rear + 12 left + 12 right + 6 roof = 48 probes.
        // Extreme surface samples are shifted 4% inward to account for
        // body outline uncertainty; this does not guarantee visible contact.
        public static DeformationPoint[] Build(DeformationBounds b)
        {
            if (b == null || !b.Valid) return new DeformationPoint[0];
            var points=new List<DeformationPoint>();
            Action<string,float,float,float> add=(region,x,y,z) =>
                points.Add(new DeformationPoint(points.Count,region,x,y,z));
            for (int side=0;side<2;side++)
                for (int ix=0;ix<3;ix++)
                    for (int iz=0;iz<3;iz++)
                        add(side==0 ? "front" : "rear",b.X(0.2f+ix*0.3f),
                            b.Y(side==0 ? 0.96f : 0.04f),b.Z(0.2f+iz*0.29f));
            for (int side=0;side<2;side++)
                for (int iy=0;iy<4;iy++)
                    for (int iz=0;iz<3;iz++)
                        add(side==0 ? "left" : "right",
                            b.X(side==0 ? 0.04f : 0.96f),
                            b.Y(0.14f+iy*0.24f),b.Z(0.2f+iz*0.29f));
            for (int iy=0;iy<3;iy++)
                for (int ix=0;ix<2;ix++)
                    add("roof",b.X(ix==0 ? 0.32f : 0.68f),
                        b.Y(0.24f+iy*0.26f),b.Z(0.96f));
            return points.ToArray();
        }
    }
    public sealed class DeformationReading
    {
        public readonly DeformationPoint Point;
        public readonly bool Valid;
        public readonly float Dx,Dy,Dz,Magnitude;
        public readonly string Reason;
        public DeformationReading(DeformationPoint point,float dx,float dy,float dz,string failure=null)
        {
            Point=point;
            bool finite=!float.IsNaN(dx)&&!float.IsInfinity(dx)&&
                !float.IsNaN(dy)&&!float.IsInfinity(dy)&&!float.IsNaN(dz)&&!float.IsInfinity(dz);
            float mag=finite ? (float)Math.Sqrt(dx*dx+dy*dy+dz*dz) : float.NaN;
            Valid=failure==null && finite && !float.IsInfinity(mag) && mag<=20f;
            Dx=Valid?dx:float.NaN; Dy=Valid?dy:float.NaN; Dz=Valid?dz:float.NaN;
            Magnitude=Valid?mag:float.NaN;
            Reason=Valid ? "" : (failure ?? "invalid_vector");
        }
    }
    public sealed class DeformationCapture
    {
        public readonly string CaptureId,Phase,Model,Utc;
        public readonly int Handle;
        public readonly DeformationBounds Bounds;
        public readonly float EngineHp,BodyHp;
        public readonly DeformationPoint[] Points;
        readonly List<DeformationReading> data=new List<DeformationReading>();
        public int Count => data.Count;
        public int ValidCount => data.Count(r=>r.Valid);
        public bool Complete => data.Count==Points.Length;
        public DeformationPoint Next => Complete?null:Points[data.Count];
        public DeformationReading[] Results => data.ToArray();
        public DeformationCapture(string id,string phase,string model,int handle,string utc,
            DeformationBounds bounds,float engineHp,float bodyHp)
        {
            if (string.IsNullOrEmpty(id) || (phase!="baseline" && phase!="damaged") ||
                bounds==null || !bounds.Valid || handle<=0) throw new ArgumentException("invalid_capture");
            CaptureId=id;Phase=phase;Model=model??"unknown";Utc=utc??"";
            Handle=handle;Bounds=bounds;EngineHp=engineHp;BodyHp=bodyHp;
            Points=VehicleDeformationGrid.Build(bounds);
        }
        public void Record(float dx,float dy,float dz,string error=null)
        {
            if (Complete) throw new InvalidOperationException("capture_complete");
            data.Add(new DeformationReading(Next,dx,dy,dz,error));
        }
        public static readonly string Header=
            "utc,capture_id,phase,model,handle,engine_hp,body_hp,"+
            "min_x,min_y,min_z,max_x,max_y,max_z,"+
            "index,region,sample_x,sample_y,sample_z,dx,dy,dz,magnitude,valid,reason";
        static string F(float value) =>
            float.IsNaN(value)||float.IsInfinity(value)?"":value.ToString("0.#####",CultureInfo.InvariantCulture);
        static string S(string value)
        {
            value=value??"";
            if(value.Length>0 && "=+-@\t\r\n".IndexOf(value[0])>=0)value="'"+value;
            return "\""+value.Replace("\"","\"\"")+"\"";
        }
        public string Csv()
        {
            if(!Complete)throw new InvalidOperationException("capture_incomplete");
            var sb=new StringBuilder();
            sb.AppendLine(Header);
            foreach(var r in data) {
                var p=r.Point;
                sb.Append(S(Utc)).Append(',').Append(S(CaptureId)).Append(',')
                  .Append(S(Phase)).Append(',').Append(S(Model)).Append(',')
                  .Append(Handle.ToString(CultureInfo.InvariantCulture)).Append(',')
                  .Append(F(EngineHp)).Append(',').Append(F(BodyHp)).Append(',')
                  .Append(F(Bounds.MinX)).Append(',').Append(F(Bounds.MinY)).Append(',')
                  .Append(F(Bounds.MinZ)).Append(',').Append(F(Bounds.MaxX)).Append(',')
                  .Append(F(Bounds.MaxY)).Append(',').Append(F(Bounds.MaxZ)).Append(',')
                  .Append(p.Index.ToString(CultureInfo.InvariantCulture)).Append(',')
                  .Append(S(p.Region)).Append(',').Append(F(p.X)).Append(',')
                  .Append(F(p.Y)).Append(',').Append(F(p.Z)).Append(',')
                  .Append(F(r.Dx)).Append(',').Append(F(r.Dy)).Append(',')
                  .Append(F(r.Dz)).Append(',').Append(F(r.Magnitude)).Append(',')
                  .Append(r.Valid ? "1" : "0").Append(',').Append(S(r.Reason))
                  .AppendLine();
            }
            return sb.ToString();
        }
    }
}
