using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace LSA.WPS.Lab
{
    // Pure admission, metrics and verdict policy. No Essential/LSA references.
    public static class Census
    {
        public static readonly string[] Ids = Enumerable.Range(0,13).Select(i=>"E0."+i).ToArray();
        public static readonly string[] Statuses = {"OFFLINE_READY","GTA_VERIFIED","FAILED","BLOCKED","NOT_TESTED"};
        public static bool ValidId(string id) => Array.IndexOf(Ids,id)>=0;
        public static bool ValidStatus(string value) => Array.IndexOf(Statuses,value)>=0;
        public static int Limit(string id,int requested,bool armed)
        {
            if (!ValidId(id)) throw new ArgumentException("unknown_probe");
            if (id=="E0.9" && !armed) throw new InvalidOperationException("budget_requires_arming");
            if (requested<1 || requested>(id=="E0.9"?2000:30)) throw new ArgumentOutOfRangeException("requested");
            return requested;
        }
        public static double Percentile(IEnumerable<double> samples,double fraction)
        {
            var a=samples.Where(x=>!double.IsNaN(x) && !double.IsInfinity(x) && x>=0).OrderBy(x=>x).ToArray();
            if(a.Length==0) return 0;
            double p=(a.Length-1)*fraction; int lo=(int)Math.Floor(p), hi=(int)Math.Ceiling(p);
            return a[lo]+(a[hi]-a[lo])*(p-lo);
        }
        public static double Distance(double ax,double ay,double az,double bx,double by,double bz)
            => Math.Sqrt((ax-bx)*(ax-bx)+(ay-by)*(ay-by)+(az-bz)*(az-bz));
        public static double Coverage(int rounds,int impacts) => rounds==0?0:Math.Min(1.0,(double)impacts/rounds);
        public static uint Joaat(string s)
        {
            uint hash=0;
            foreach(char c in (s??"").ToLowerInvariant()) {hash+=(byte)c;hash+=(hash<<10);hash^=(hash>>6);}
            hash+=(hash<<3);hash^=(hash>>11);hash+=(hash<<15);return hash;
        }
    }
    // Strict allowlist for unattended, read-only experiments. No gunfire, spawns or world edits.
    public static class PreShotPlan
    {
        public static readonly string[] Ids={"E0.0","E0.1","E0.2","E0.3"};
        public static bool Allows(string id)=>Array.IndexOf(Ids,id)>=0;
        public static string MissingGroundTruth(string id,int samples)
        {
            if(id=="E0.2" && samples<30)return "need_30_codewalker_ground_truth_surfaces";
            if(id=="E0.3" && samples<10)return "need_10_codewalker_measured_walls";
            return null;
        }
    }
    public sealed class Settings
    {
        public bool enabled {get;set;}
        // Only E0.0-E0.3; waits for valid story-mode free roam, never fires/spawns/changes the world.
        public bool autoRunPreShot {get;set;}
        // Independent explicit opt-in: transport the player to validated CodeWalker sample area.
        public bool autoTeleportForSamples {get;set;}
        public float x {get;set;}
        public float y {get;set;}
        public float z {get;set;}
        public string propModel {get;set;}
        public string fragModel {get;set;}
        public string pedModel {get;set;}
        public string mapModel {get;set;}
        public string ipl {get;set;}
        public float targetX {get;set;}
        public float targetY {get;set;}
        public float targetZ {get;set;}
        public float radius {get;set;}
        public int fragChild {get;set;}
        public int entityLimit {get;set;}
        public int explosionType {get;set;}
        public bool permitExplosion {get;set;}
        public bool permitBullet {get;set;}
        public bool permitIpl {get;set;}
        public bool permitHide {get;set;}
        public bool permitTimeScale {get;set;}
        public static Settings Defaults() => new Settings {enabled=false,propModel="prop_box_wood02a_pu",pedModel="a_m_m_business_01",radius=3,entityLimit=100};
        public void Validate()
        {
            if(!Finite(x)||!Finite(y)||!Finite(z)||!Finite(targetX)||!Finite(targetY)||!Finite(targetZ)||!Finite(radius))
                throw new ArgumentException("nonfinite_location");
            if(radius<0 || radius>10 || entityLimit<1 || entityLimit>2000 || fragChild<0 || fragChild>3 || explosionType<0 || explosionType>14)
                throw new ArgumentException("unsafe_probe_limits");
            foreach(var s in new[]{propModel,fragModel,pedModel,mapModel,ipl})
                if(s!=null && (s.Length>90 || s.IndexOfAny(new[]{'\r','\n','\0'})>=0))
                    throw new ArgumentException("invalid_identifier");
        }
        static bool Finite(float f)=>!float.IsNaN(f)&&!float.IsInfinity(f);
        public bool HasSite => Math.Abs(x)>0.001 || Math.Abs(y)>0.001 || Math.Abs(z)>0.001;
        public bool HasTarget => Math.Abs(targetX)>0.001 || Math.Abs(targetY)>0.001 || Math.Abs(targetZ)>0.001;
    }
    public sealed class Sample
    {
        public string label {get;set;}
        public float ax {get;set;}
        public float ay {get;set;}
        public float az {get;set;}
        public float bx {get;set;}
        public float by {get;set;}
        public float bz {get;set;}
        public string expectedMaterial {get;set;}
        public int materialIndex {get;set;}
        public double expectedThicknessM {get;set;}
        public void Validate()
        {
            if(string.IsNullOrWhiteSpace(label)||label.Length>80 ||
               new[]{ax,ay,az,bx,by,bz}.Any(x=>float.IsNaN(x)||float.IsInfinity(x)) ||
               expectedThicknessM<0 || expectedThicknessM>20 || materialIndex<0 || materialIndex>255)
                throw new ArgumentException("invalid_sample");
        }
    }
    public sealed class SampleSets
    {
        public int schemaVersion {get;set;}
        public Sample[] surfaces {get;set;}
        public Sample[] walls {get;set;}
        public void Validate()
        {
            if(schemaVersion!=1 || surfaces==null || walls==null || surfaces.Length>64 || walls.Length>64)
                throw new ArgumentException("invalid_sample_sets");
            foreach(var sample in surfaces.Concat(walls))
            {
                if(sample==null)throw new ArgumentException("null_sample");
                sample.Validate();
            }
        }
    }
    // Derived from locally loaded samples; no game-derived coordinates are embedded in source.
    public sealed class AutoSampleSite
    {
        public double x {get;private set;}
        public double y {get;private set;}
        public double z {get;private set;}
        public double spanXY {get;private set;}
        public static AutoSampleSite Build(IEnumerable<Sample> surfaces,IEnumerable<Sample> walls)
        {
            var all=(surfaces??Enumerable.Empty<Sample>()).Concat(walls??Enumerable.Empty<Sample>()).ToArray();
            if(all.Length<30)throw new ArgumentException("insufficient_sample_site_data");
            var pts=all.SelectMany(a=>new[]{new[]{(double)a.ax,a.ay,a.az},new[]{(double)a.bx,a.by,a.bz}}).ToArray();
            if(pts.Any(v=>v.Any(t=>double.IsNaN(t)||double.IsInfinity(t))))throw new ArgumentException("invalid_sample_site_coordinates");
            double minX=pts.Min(v=>v[0]),maxX=pts.Max(v=>v[0]),minY=pts.Min(v=>v[1]),maxY=pts.Max(v=>v[1]);
            double minZ=pts.Min(v=>v[2]),maxZ=pts.Max(v=>v[2]);
            if(maxX-minX>220||maxY-minY>220||maxZ-minZ>90||
                minZ<(-30)||maxZ>1100||minX<(-5000)||maxX>5000||minY<(-5000)||maxY>5000)
                throw new ArgumentException("unsafe_or_scattered_sample_site");
            return new AutoSampleSite{x=(minX+maxX)/2,y=(minY+maxY)/2,
                z=(minZ+maxZ)/2,spanXY=Math.Max(maxX-minX,maxY-minY)};
        }
        public bool IsNearby(double px,double py) =>
            Math.Sqrt((x-px)*(x-px)+(y-py)*(y-py))<=100;
        public bool AcceptSafeCoord(double sx,double sy,double sz) =>
            !double.IsNaN(sx)&&!double.IsNaN(sy)&&!double.IsNaN(sz)&&
            Math.Sqrt((x-sx)*(x-sx)+(y-sy)*(y-sy))<=90 && Math.Abs(z-sz)<=32;
    }
    public sealed class Ledger
    {
        readonly Dictionary<string,string> states=Census.Ids.ToDictionary(id=>id,id=>"NOT_TESTED");
        public string Get(string id)=>states[id];
        public void Mark(string id,string status)
        {
            if(!Census.ValidId(id)||!Census.ValidStatus(status))throw new ArgumentException("invalid_verdict");
            states[id]=status;
        }
        public IDictionary<string,string> Snapshot()=>new Dictionary<string,string>(states);
    }
    public sealed class CleanupBook
    {
        readonly HashSet<int> objects=new HashSet<int>();
        public int Count=>objects.Count;
        public void Own(int handle){if(handle>0)objects.Add(handle);}
        public int[] Drain(){var v=objects.ToArray();objects.Clear();return v;}
        public bool Owns(int handle)=>objects.Contains(handle);
        public bool Forget(int handle)=>objects.Remove(handle);
    }
}
