using System;
using System.Collections.Generic;
using System.Linq;

namespace LSA.Enhanced.VehicleHud
{
    // VH3-B pure, renderer-independent prototype. Its silhouettes use native
    // model BOUNDS plus named archetype proportions: NOT extracted YFT meshes.
    // Experimental deformation must use paired, valid VH3 captures. The live
    // HUD does not consume unvalidated deformation samples.
    public sealed class BodyVertex
    {
        public readonly float X,Y; // normalized: center X=0, front Y=0, rear Y=1
        public BodyVertex(float x,float y) { X=x; Y=y; }
    }
    public sealed class VehicleBodyMesh
    {
        public readonly string Model,Archetype;
        public readonly DeformationBounds Bounds;
        public readonly BodyVertex[] Outline;
        public readonly BodyVertex[] Cabin;
        public readonly float FrontWheelY,RearWheelY;
        public readonly bool ExperimentalDeformation;
        public VehicleBodyMesh(string model,string archetype,DeformationBounds bounds,
            BodyVertex[] outline,BodyVertex[] cabin,float frontWheelY,float rearWheelY,
            bool experimental=false)
        {
            Model=model; Archetype=archetype; Bounds=bounds;
            Outline=outline; Cabin=cabin; FrontWheelY=frontWheelY; RearWheelY=rearWheelY;
            ExperimentalDeformation=experimental;
        }
    }
    public static class VehicleMeshGeometry
    {
        // Specific stock models (editable calibration table), *not* guesses
        // about unrelated add-ons; others classify by dimensions and name.
        static readonly Dictionary<string,string> Profiles =
            new Dictionary<string,string>(StringComparer.OrdinalIgnoreCase) {
                {"adder","supercar"},{"zentorno","supercar"},{"t20","supercar"},
                {"turismor","supercar"},{"entityxf","supercar"},{"infernus","supercar"},
                {"elegy2","coupe"},{"jester","coupe"},{"comet2","coupe"},
                {"futo","coupe"},{"sultan","sedan"},{"schafter2","sedan"},
                {"tailgater","sedan"},{"asea","sedan"},{"buffalo","muscle"},
                {"dominator","muscle"},{"gauntlet","muscle"},{"vigero","muscle"},
                {"dubsta","suv"},{"baller","suv"},{"granger","suv"},
                {"rebla","suv"},{"bison","pickup"},{"sandking","pickup"},
                {"rebel","pickup"},{"guardian","pickup"},{"speedo","van"},
                {"rumpo","van"},{"burrito3","van"},{"boxville","van"}
            };
        // Profile shape knobs. "specific" means archetype proportions, not
        // exact glass/bonnet panel location; all shapes remain placeholders
        // until data from actual YFT assets becomes available.
        sealed class Shape
        {
            public float Nose,Shoulder,Hip,Tail,CabinStart,CabinEnd,FrontAxle,RearAxle;
            public Shape(float nose,float shoulder,float hip,float tail,
                float cabinStart,float cabinEnd,float frontAxle,float rearAxle)
            {
                Nose=nose;Shoulder=shoulder;Hip=hip;Tail=tail;
                CabinStart=cabinStart;CabinEnd=cabinEnd;
                FrontAxle=frontAxle;RearAxle=rearAxle;
            }
        }
        static readonly Dictionary<string,Shape> Shapes=new Dictionary<string,Shape> {
            {"supercar",new Shape(.34f,.47f,.48f,.36f,.25f,.72f,.24f,.76f)},
            {"coupe",new Shape(.32f,.44f,.47f,.36f,.31f,.70f,.22f,.79f)},
            {"sedan",new Shape(.36f,.47f,.48f,.39f,.28f,.73f,.21f,.79f)},
            {"muscle",new Shape(.36f,.46f,.48f,.41f,.37f,.76f,.23f,.79f)},
            {"suv",new Shape(.41f,.49f,.49f,.43f,.22f,.81f,.20f,.81f)},
            {"pickup",new Shape(.40f,.49f,.49f,.43f,.20f,.52f,.21f,.81f)},
            {"van",new Shape(.46f,.49f,.49f,.46f,.13f,.88f,.19f,.84f)}
        };
        // Hand-tuned visual variants for individual known stock models.
        // Others use their nearest category and actual dimensions.
        static readonly Dictionary<string,Shape> ModelTuning=
            new Dictionary<string,Shape>(StringComparer.OrdinalIgnoreCase) {
                {"adder",new Shape(.33f,.48f,.48f,.36f,.22f,.72f,.24f,.75f)},
                {"zentorno",new Shape(.27f,.48f,.50f,.34f,.27f,.76f,.23f,.78f)},
                {"t20",new Shape(.31f,.45f,.47f,.35f,.29f,.68f,.26f,.76f)},
                {"elegy2",new Shape(.35f,.47f,.45f,.34f,.32f,.69f,.23f,.80f)},
                {"comet2",new Shape(.30f,.44f,.48f,.40f,.30f,.72f,.24f,.77f)},
                {"futo",new Shape(.36f,.45f,.44f,.38f,.30f,.75f,.22f,.78f)},
                {"sultan",new Shape(.38f,.46f,.48f,.42f,.29f,.77f,.22f,.81f)},
                {"dominator",new Shape(.39f,.48f,.49f,.40f,.39f,.74f,.24f,.81f)},
                {"gauntlet",new Shape(.34f,.47f,.48f,.40f,.38f,.77f,.25f,.78f)},
                {"dubsta",new Shape(.42f,.49f,.50f,.45f,.19f,.84f,.21f,.82f)},
                {"bison",new Shape(.39f,.49f,.49f,.43f,.17f,.53f,.23f,.81f)},
                {"speedo",new Shape(.46f,.49f,.49f,.47f,.10f,.89f,.18f,.84f)}
            };
        public static string Archetype(string model,DeformationBounds bounds)
        {
            if (bounds==null || !bounds.Valid) return "unavailable";
            string key=(model??"").Trim();
            if(Profiles.TryGetValue(key,out string archetype))return archetype;
            // Dimensions are evidence; these classes are conservative
            // approximations and must not claim a named GTA body type.
            float length=bounds.MaxY-bounds.MinY;
            float height=bounds.MaxZ-bounds.MinZ;
            float width=bounds.MaxX-bounds.MinX;
            if(height>2.4f && length>4.2f) return "van";
            if(height>1.85f && length>4.8f) return "suv";
            if(length>5.7f && height>1.5f) return "pickup";
            if(height<1.25f && width>1.7f) return "supercar";
            if(length>4.65f && height>1.32f) return "sedan";
            return "coupe";
        }
        public static VehicleBodyMesh Build(string model,DeformationBounds bounds)
        {
            if(bounds==null||!bounds.Valid)return null;
            string archetype=Archetype(model,bounds);
            var s=ModelTuning.TryGetValue(model??"",out Shape tuned) ? tuned : Shapes[archetype];
            // Twelve paired stations plus nose and tail: 26 ordered points.
            float[] stations={0f,.04f,.11f,.20f,.29f,.39f,.50f,.61f,.71f,.80f,.89f,.96f,1f};
            float[] widths={
                s.Nose,s.Nose+.015f,s.Shoulder*.91f,s.Shoulder,
                s.Shoulder,s.Hip*.98f,s.Hip,s.Hip,s.Hip,
                s.Hip*.99f,s.Tail+.04f,s.Tail,s.Tail
            };
            var outline=new List<BodyVertex>(stations.Length*2);
            for(int i=0;i<stations.Length;i++)
                outline.Add(new BodyVertex(-widths[i],stations[i]));
            for(int i=stations.Length-1;i>=0;i--)
                outline.Add(new BodyVertex(widths[i],stations[i]));
            float cabinWidth=Math.Min(s.Shoulder,s.Hip)*.77f;
            var cabin=new[] {
                new BodyVertex(-cabinWidth,s.CabinStart),
                new BodyVertex(-cabinWidth*.94f,s.CabinEnd),
                new BodyVertex(cabinWidth*.94f,s.CabinEnd),
                new BodyVertex(cabinWidth,s.CabinStart)
            };
            return new VehicleBodyMesh(model??"unknown",archetype,bounds,
                outline.ToArray(),cabin,s.FrontAxle,s.RearAxle);
        }
        // Strict pair integrity: never combine captures from a different car
        // or deform the HUD from body health, native tyre burst or nonfinite
        // readings. At least 36 matching samples and 3 spatially changed probes
        // are required for an offline prototype.
        public static VehicleBodyMesh Deform(VehicleBodyMesh mesh,
            DeformationCapture baseline,DeformationCapture damaged)
        {
            if(mesh==null||baseline==null||damaged==null ||
                baseline.Phase!="baseline"||damaged.Phase!="damaged"||
                !baseline.Complete||!damaged.Complete||
                baseline.Handle!=damaged.Handle||baseline.Model!=damaged.Model||
                baseline.CaptureId!=damaged.CaptureId ||
                !SameBounds(mesh.Bounds,baseline.Bounds)||
                !SameBounds(mesh.Bounds,damaged.Bounds)||
                !string.Equals(mesh.Model,baseline.Model,StringComparison.OrdinalIgnoreCase))
                return mesh;
            var a=baseline.Results;var b=damaged.Results;
            var changes=new List<Motion>();
            int comparable=0,changed=0;
            float length=mesh.Bounds.MaxY-mesh.Bounds.MinY;
            float width=mesh.Bounds.MaxX-mesh.Bounds.MinX;
            for(int i=0;i<48;i++) {
                if(a[i].Point.Index!=b[i].Point.Index ||
                    !a[i].Valid||!b[i].Valid)continue;
                comparable++;
                float dx=b[i].Dx-a[i].Dx,dy=b[i].Dy-a[i].Dy;
                float dz=b[i].Dz-a[i].Dz;
                float delta=(float)Math.Sqrt(dx*dx+dy*dy+dz*dz);
                if(!Finite(delta)||delta>2.5f)continue;
                if(delta>=.05f) changed++;
                if(delta<.035f)continue; // minimum useful displacement
                var p=a[i].Point;
                float px=p.X/width-(mesh.Bounds.MinX/width+mesh.Bounds.MaxX/width)*.5f;
                float py=(mesh.Bounds.MaxY-p.Y)/length;
                // Roof interior points have little influence on outer silhouette.
                float surface=p.Region=="roof"?.25f:1f;
                changes.Add(new Motion(px,py,dx/width,-dy/length,surface));
            }
            if(comparable<36||changed<3||changes.Count==0)return mesh;
            var outline=mesh.Outline.Select(v=>Shift(v,changes)).ToArray();
            var cabin=mesh.Cabin.Select(v=>Shift(v,changes)).ToArray();
            if(!PolygonSafe(outline))return mesh; // fail closed on folding
            return new VehicleBodyMesh(mesh.Model,mesh.Archetype,mesh.Bounds,
                outline,cabin,mesh.FrontWheelY,mesh.RearWheelY,true);
        }
        sealed class Motion
        {
            public readonly float X,Y,Dx,Dy,Scale;
            public Motion(float x,float y,float dx,float dy,float scale)
            { X=x; Y=y; Dx=dx; Dy=dy; Scale=scale; }
        }
        static BodyVertex Shift(BodyVertex v,List<Motion> motions)
        {
            float xx=0, yy=0,total=0;
            foreach(var m in motions) {
                float x=v.X-m.X,y=v.Y-m.Y;
                float r2=x*x+y*y;
                if(r2>.19f)continue; // locality: don't crush rear for front impact
                float w=(float)Math.Exp(-r2/.045f)*m.Scale;
                xx+=w*m.Dx; yy+=w*m.Dy; total+=w;
            }
            if(total<.07f)return v;
            // Damp compared with raw vectors; these are approximate, not mesh vertices.
            float weight=Math.Min(1f,total);
            float dx=Clamp((xx/total)*weight,-.095f,.095f);
            float dy=Clamp((yy/total)*weight,-.095f,.095f);
            return new BodyVertex(Clamp(v.X+dx,-.54f,.54f),
                Clamp(v.Y+dy,0f,1f));
        }
        static bool SameBounds(DeformationBounds a,DeformationBounds b)
        {
            if(a==null||b==null||!a.Valid||!b.Valid)return false;
            return Math.Abs(a.MinX-b.MinX)<.001f && Math.Abs(a.MinY-b.MinY)<.001f &&
                Math.Abs(a.MinZ-b.MinZ)<.001f && Math.Abs(a.MaxX-b.MaxX)<.001f &&
                Math.Abs(a.MaxY-b.MaxY)<.001f && Math.Abs(a.MaxZ-b.MaxZ)<.001f;
        }
        // At most one winding direction change tolerated? No. The outline
        // should never fold, even if noisy captures pass vector validity.
        static bool PolygonSafe(BodyVertex[] points)
        {
            if(points==null||points.Length<6)return false;
            for(int i=0;i<points.Length;i++) {
                var p=points[i];
                if(!Finite(p.X)||!Finite(p.Y))return false;
                if(i>0 && i<points.Length/2 && p.Y+0.001f<points[i-1].Y)return false;
                if(i>points.Length/2 && p.Y-0.001f>points[i-1].Y)return false;
            }
            return true;
        }
        static float Clamp(float v,float min,float max)=>Math.Max(min,Math.Min(max,v));
        static bool Finite(float v)=>!float.IsNaN(v)&&!float.IsInfinity(v);
    }
}
