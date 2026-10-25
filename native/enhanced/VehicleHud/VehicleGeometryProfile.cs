using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;

namespace LSA.Enhanced.VehicleHud
{
    // VH6 local-only geometry handoff. Parsed once per model (on vehicle change),
    // never during FrameRender. No Rockstar assets are embedded in our DLL.
    // Original proprietary YFT/GLB material must not be committed.
    public sealed class VehicleGeometryProfile
    {
        public readonly string Model;
        public readonly BodyVertex[] Contour;
        public readonly BodyVertex[][] Glass;
        // Order: LF, RF, LR, RR; in normalized HUD coordinates.
        public readonly BodyVertex[] Wheels;
        public readonly float WidthMeters,LengthMeters;
        VehicleGeometryProfile(string model,BodyVertex[] contour,BodyVertex[][] glass,
            BodyVertex[] wheels,float width,float length)
        {
            Model=model;Contour=contour;Glass=glass;Wheels=wheels;
            WidthMeters=width;LengthMeters=length;
        }
        public static bool TryParse(string json,string expectedModel,DeformationBounds gameBounds,
            out VehicleGeometryProfile result,out string reason)
        {
            result=null;reason="invalid_file";
            try {
                if(string.IsNullOrEmpty(json) ||
                    Encoding.UTF8.GetByteCount(json)>262144 ||
                    gameBounds==null || !gameBounds.Valid) return false;
                var root=(new JavaScriptSerializer {MaxJsonLength=262144,RecursionLimit=24})
                    .DeserializeObject(json) as Dictionary<string,object>;
                if(root==null || Text(root,"schemaVersion")!="vh6.vehicle-geometry.v1")
                {reason="schema_mismatch";return false;}
                string model=Text(root,"model");
                if(!string.Equals(model,expectedModel,StringComparison.OrdinalIgnoreCase))
                {reason="model_mismatch";return false;}
                var coords=Section(root,"coordinateSystem");
                if(Text(coords,"gtaFront")!="+Y" ||
                    Text(coords,"hudConvention")!="front=normalized Y 0; rear=normalized Y 1; left=negative X")
                {reason="coordinate_system_mismatch";return false;}
                var val=Section(root,"validation");
                if(Value<bool>(val,"contourSelfIntersection"))
                {reason="self_intersection";return false;}
                var dims=Section(root,"dimensions");
                float w=Number(dims,"width"), l=Number(dims,"length");
                float nativeW=gameBounds.MaxX-gameBounds.MinX;
                float nativeL=gameBounds.MaxY-gameBounds.MinY;
                if(!Finite(w)||!Finite(l)||w<.8f||w>6f||l<1.5f||l>18f ||
                    Math.Abs(w/nativeW-1f)>.32f || Math.Abs(l/nativeL-1f)>.32f)
                {reason="bounds_disagree";return false;}
                var contour=Ring(Section(root,"contour")["vertices"],64,true);
                if(contour.Length<6 || !VehicleMeshGeometry.PolygonSafe(contour))
                {reason="invalid_contour";return false;}
                var rings=new List<BodyVertex[]>();
                var glass=Section(root,"windowRegions");
                foreach(var item in Array(glass,"rings")) {
                    if(rings.Count>=8)break;
                    BodyVertex[] ring;
                    try { ring=Ring(item,96,false); }
                    catch {continue;} // Glass submeshes are supplementary only.
                    if(ring.Length>=3 && VehicleMeshGeometry.PolygonSafe(ring))
                        rings.Add(ring);
                }
                var wheels=Section(root,"wheels");
                var names=new[]{"lf","rf","lr","rr"};
                var positions=new BodyVertex[4];
                for(int i=0;i<names.Length;i++) {
                    var v=Section(Section(wheels,names[i]),"hudNormalized");
                    positions[i]=Vertex(v,false);
                }
                if(!(positions[0].X<0 && positions[2].X<0 &&
                    positions[1].X>0 && positions[3].X>0 &&
                    positions[0].Y<positions[2].Y &&
                    positions[1].Y<positions[3].Y)) {
                    reason="wheel_orientation";return false;
                }
                result=new VehicleGeometryProfile(model,contour,rings.ToArray(),positions,w,l);
                reason="ok";return true;
            } catch {
                reason="invalid_or_unsupported_json";return false;
            }
        }
        static T Value<T>(Dictionary<string,object> o,string key)
        {
            if(o==null||!o.TryGetValue(key,out object v)||!(v is T))
                throw new FormatException(key);
            return (T)v;
        }
        static Dictionary<string,object> Section(Dictionary<string,object> obj,string key)
            => Value<Dictionary<string,object>>(obj,key);
        static object[] Array(Dictionary<string,object> obj,string key)
            => Value<object[]>(obj,key);
        static string Text(Dictionary<string,object> obj,string key)
            => Value<string>(obj,key);
        static float Number(Dictionary<string,object> obj,string key)
        {
            if(!obj.TryGetValue(key,out object item))throw new FormatException(key);
            return Convert.ToSingle(item,CultureInfo.InvariantCulture);
        }
        static bool Finite(float x)=>!float.IsNaN(x)&&!float.IsInfinity(x);
        static BodyVertex Vertex(Dictionary<string,object> obj,bool allowSmallOverhang)
        {
            float x=Number(obj,"x"),y=Number(obj,"y");
            float margin=allowSmallOverhang ? .06f : 0f;
            if(!Finite(x)||!Finite(y) || x < -.6f||x>.6f ||
                y < -margin || y>1f+margin)throw new FormatException("vertex_range");
            return new BodyVertex(x,y);
        }
        static BodyVertex[] Ring(object obj,int max,bool allowSmallOverhang)
        {
            var arr=obj as object[];
            if(arr==null||arr.Length<3||arr.Length>max)
                throw new FormatException("ring_size");
            return arr.Select(item=>Vertex(item as Dictionary<string,object>
                ?? throw new FormatException("vertex"),allowSmallOverhang)).ToArray();
        }
        public VehicleBodyMesh ToMesh(DeformationBounds runtimeBounds)
        {
            // The exported 2D contour is the source of visible geometry;
            // runtime game bounds remain the VH5 local-space deformation frame.
            // The cabin placeholder is excluded when genuine glass rings exist.
            return new VehicleBodyMesh(Model,"EXTRACTED",runtimeBounds,Contour,
                Glass.Length>0?new BodyVertex[0]:new[]{
                    new BodyVertex(-.3f,.28f),new BodyVertex(-.3f,.72f),
                    new BodyVertex(.3f,.72f),new BodyVertex(.3f,.28f)},
                (Wheels[0].Y+Wheels[1].Y)/2f,
                (Wheels[2].Y+Wheels[3].Y)/2f,false,
                Glass,Wheels,true,WidthMeters/LengthMeters);
        }
    }

    internal sealed class VehicleGeometryLibrary
    {
        readonly string root;
        readonly Dictionary<string,VehicleGeometryProfile> cache=
            new Dictionary<string,VehicleGeometryProfile>(StringComparer.OrdinalIgnoreCase);
        readonly HashSet<string> missed=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        public string Status {get;private set;}="No model selected";
        public VehicleGeometryLibrary(string pluginsRoot)
        {
            root=Path.Combine(pluginsRoot??"","LSA","VehicleGeometry");
        }
        public VehicleBodyMesh LoadOrFallback(string model,DeformationBounds bounds)
        {
            var fallback=VehicleMeshGeometry.Build(model,bounds);
            if(fallback==null)return null;
            if(string.IsNullOrEmpty(model)||model.Length>32||
                model.Any(c=>!char.IsLetterOrDigit(c) && c!='_'))
            {Status="Archetype fallback: invalid model name";return fallback;}
            if(cache.TryGetValue(model,out var cached)) {
                Status="EXTRACTED "+cached.Model;
                return cached.ToMesh(bounds);
            }
            if(missed.Contains(model)) {
                Status="Archetype fallback: no validated local geometry";
                return fallback;
            }
            string path=Path.Combine(root,model.ToLowerInvariant()+".json");
            try {
                if(!File.Exists(path)) {
                    missed.Add(model);
                    Status="Archetype fallback: copy "+model.ToLowerInvariant()+".json";
                    return fallback;
                }
                var file=new FileInfo(path);
                if(file.Length<=0 || file.Length>262144)throw new InvalidDataException("file_size");
                string json=File.ReadAllText(path,Encoding.UTF8);
                if(!VehicleGeometryProfile.TryParse(json,model,bounds,out var profile,out string reason)) {
                    missed.Add(model);
                    Status="Archetype fallback: "+reason;
                    return fallback;
                }
                cache[model]=profile;
                Status="EXTRACTED "+profile.Model+" "+profile.Contour.Length+" points";
                return profile.ToMesh(bounds);
            } catch(Exception) {
                missed.Add(model);
                Status="Archetype fallback: geometry read error";
                return fallback;
            }
        }
    }
}
