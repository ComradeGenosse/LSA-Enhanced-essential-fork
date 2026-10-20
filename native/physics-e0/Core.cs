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
            var a=(surfaces??Enumerable.Empty<Sample>()).ToArray();
            var b=(walls??Enumerable.Empty<Sample>()).ToArray();
            if(a.Length<30 && b.Length<10)throw new ArgumentException("insufficient_sample_site_data");
            var all=a.Concat(b).ToArray();
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
    // Pure gate: position proximity alone never proves streamed collision.
    public static class DestinationGate
    {
        public const int SettleMs=800;
        public const int ConsecutiveFrames=3;
        public static bool Accept(bool nearby,bool collisionLoaded,long elapsedMs,int consecutiveFrames) =>
            nearby && collisionLoaded && elapsedMs>=SettleMs && consecutiveFrames>=ConsecutiveFrames;
        public static double HeadingError(double expected,double actual)
        {
            double d=Math.Abs((expected-actual)%360.0);
            return Math.Min(d,360.0-d);
        }
    }
    // The settle window starts at the first successful collision poll, not at
    // relocation. A failed poll invalidates the entire continuous window.
    public sealed class CollisionStability
    {
        long since=-1;
        public int Checks {get;private set;}
        public long LoadedMs {get;private set;}
        public bool Poll(bool nearby,bool loaded,long now)
        {
            if(!nearby||!loaded){since=-1;Checks=0;LoadedMs=0;return false;}
            if(since<0)since=now;
            Checks++;LoadedMs=Math.Max(0,now-since);
            return DestinationGate.Accept(nearby,loaded,LoadedMs,Checks);
        }
    }
    // One raw shape-test observation. No game-derived data is embedded in source.
    public struct RayObs
    {
        public bool Hit; public uint Material; public int Entity; public double X,Y,Z;
        public RayObs(bool hit,uint material,int entity,double x,double y,double z)
        {Hit=hit;Material=material;Entity=entity;X=x;Y=y;Z=z;}
        public double DistanceTo(RayObs o)=>Census.Distance(X,Y,Z,o.X,o.Y,o.Z);
    }
    // Independent classification of shape-test option variants (baseline 7 vs 0).
    // It reads only raw observations and expected values; it never reuses the
    // baseline verdict, so a baseline mismatch can be re-classified without trust.
    public static class OptionsAnalysis
    {
        public const int Baseline=7, Alternate=0;
        public const double PointToleranceM=.01, ThicknessToleranceM=.01;
        public static string MaterialOutcome(RayObs r,uint expectedIndexed)=>
            !r.Hit?"miss":r.Material==expectedIndexed?"match":"other_material";
        public static string ClassifyMaterial(RayObs o7,RayObs o0,uint expectedIndexed)
        {
            string a=MaterialOutcome(o7,expectedIndexed),b=MaterialOutcome(o0,expectedIndexed);
            if(a=="match"&&b=="match")return "MATCH_BOTH";
            if(a=="match")return "OPT7_ONLY_OPT0_SEES_"+(b=="miss"?"NOTHING":"OTHER_FIRST");
            if(b=="match")return a=="miss"?"RECOVERED_BY_OPT0_SEE_THROUGH_CLASS":"RECOVERED_BY_OPT0_OPT7_HIT_OTHER";
            if(a=="miss"&&b=="miss")return "MISS_BOTH";
            if(a=="miss")return "OPT0_HITS_OTHER_MATERIAL";
            if(b=="miss")return "OPT7_HITS_OTHER_OPT0_MISSES";
            return "OTHER_MATERIAL_BOTH";
        }
        // Outcome of one forward/reverse pair under a single option value.
        public static string PairOutcome(RayObs fwd,RayObs rev,uint expectedIndexed,double expectedThicknessM)
        {
            if(!fwd.Hit||!rev.Hit)return "MISS";
            if(fwd.Entity!=rev.Entity)return "ENTITY_SPLIT";
            if(fwd.Material!=expectedIndexed||rev.Material!=expectedIndexed)return "MATERIAL_MISMATCH";
            double t=fwd.DistanceTo(rev);
            return Math.Abs(t-expectedThicknessM)<=ThicknessToleranceM?"CONFIRMED_PAIR":"THICKNESS_MISMATCH";
        }
        public static bool SameObservation(RayObs a,RayObs b)=>
            a.Hit==b.Hit&&(!a.Hit||(a.Material==b.Material&&a.DistanceTo(b)<=PointToleranceM));
        public static string ClassifyWall(string p7,string p0,bool unchangedObservations)
        {
            if(p7=="CONFIRMED_PAIR"&&p0=="CONFIRMED_PAIR")return "MATCH_BOTH";
            if(p7=="CONFIRMED_PAIR")return "OPT0_DISTURBS_CONFIRMED_PAIR:"+p0;
            if(p0=="CONFIRMED_PAIR")return "RECOVERED_BY_OPT0";
            if(unchangedObservations)return "UNCHANGED_BY_OPTIONS:"+p7;
            return "CHANGED_BUT_UNRESOLVED:"+p7+"/"+p0;
        }
    }
    // One layer found by advance-past-hit scanning along a segment (distance from the segment start).
    public struct LayerObs
    {
        public double DistanceM; public uint Material; public int Entity;
        public LayerObs(double d,uint m,int e){DistanceM=d;Material=m;Entity=e;}
    }
    public static class LayerAnalysis
    {
        public const double AdvanceM=.02;
        public const int MaxLayers=8;
        public static int EntityChanges(IList<LayerObs> l)
        {int n=0;for(int i=1;i<l.Count;i++)if(l[i].Entity!=l[i-1].Entity)n++;return n;}
        public static int MaterialChanges(IList<LayerObs> l)
        {int n=0;for(int i=1;i<l.Count;i++)if(l[i].Material!=l[i-1].Material)n++;return n;}
        // Descriptive only: a layer table is never reported as wall thickness.
        public static string Describe(IList<LayerObs> l)
        {
            if(l==null||l.Count==0)return "NO_LAYERS";
            if(l.Count==1)return "SINGLE_SURFACE";
            int e=EntityChanges(l),m=MaterialChanges(l);
            if(e>0)return "MULTIPLE_ENTITIES";
            if(m>0)return "SAME_ENTITY_MULTI_MATERIAL";
            return "SAME_ENTITY_SAME_MATERIAL_LAYERS";
        }
    }
    // Oblique-incidence corroboration for a candidate entry/exit pair on a flat slab:
    // along a ray tilted by theta from the face normal, the path through a slab of thickness t is t/cos(theta).
    // A genuine opposite face is therefore angle-consistent; an unrelated nearby object is not.
    public static class ObliqueAnalysis
    {
        public const double ToleranceM=.02, MaxAngleDeg=60;
        public static double ExpectedPath(double thicknessM,double angleDeg)=>thicknessM/Math.Cos(angleDeg*Math.PI/180.0);
        // hit: entry point on the face; n: face normal (toward the ray origin). Returns start (outside) and end (past the expected exit).
        public static void Build(double hx,double hy,double hz,double nx,double ny,double nz,double angleDeg,
            double leadM,double expectedThicknessM,double overshootM,out double[] start,out double[] end)
        {
            if(angleDeg<0||angleDeg>MaxAngleDeg||leadM<=0||overshootM<=0)throw new ArgumentException("invalid_oblique_request");
            double nl=Math.Sqrt(nx*nx+ny*ny+nz*nz);
            if(nl<1e-6)throw new ArgumentException("degenerate_normal");
            nx/=nl;ny/=nl;nz/=nl;
            // horizontal tangent = up x n; fall back to X axis for near-vertical normals
            double tx=-ny,ty=nx,tz=0,tl=Math.Sqrt(tx*tx+ty*ty);
            if(tl<.2){tx=1;ty=0;tz=0;double dot=tx*nx+ty*ny+tz*nz;tx-=dot*nx;ty-=dot*ny;tz-=dot*nz;tl=Math.Sqrt(tx*tx+ty*ty+tz*tz);}
            tx/=tl;ty/=tl;tz/=tl;
            double c=Math.Cos(angleDeg*Math.PI/180.0),sn=Math.Sin(angleDeg*Math.PI/180.0);
            double dx=-(c*nx+sn*tx),dy=-(c*ny+sn*ty),dz=-(c*nz+sn*tz);
            double total=leadM+ExpectedPath(expectedThicknessM,angleDeg)+overshootM;
            start=new[]{hx-dx*leadM,hy-dy*leadM,hz-dz*leadM};
            end=new[]{start[0]+dx*total,start[1]+dy*total,start[2]+dz*total};
        }
    }
    // Entry/exit pair search from forward and reverse advance-past-hit scans along one segment of length segLen.
    // A candidate pair is a forward hit and a reverse hit on the SAME entity with the SAME material whose faces are
    // separated along the segment. Uses only game observations: no CodeWalker value is needed to find or corroborate a pair.
    public sealed class PairCandidate
    {
        public int Forward {get;set;} public int Reverse {get;set;} public double SeparationM {get;set;}
    }
    public static class PairSearch
    {
        public const double MinSeparationM=.005, MaxSeparationM=5.0;
        public static List<PairCandidate> Candidates(IList<LayerObs> fwd,IList<LayerObs> rev,double segLen)
        {
            var list=new List<PairCandidate>();
            if(fwd==null||rev==null)return list;
            for(int i=0;i<fwd.Count;i++)for(int j=0;j<rev.Count;j++)
            {
                if(fwd[i].Entity!=rev[j].Entity||fwd[i].Material!=rev[j].Material)continue;
                double sep=segLen-fwd[i].DistanceM-rev[j].DistanceM;
                if(sep<MinSeparationM||sep>MaxSeparationM)continue;
                list.Add(new PairCandidate{Forward=i,Reverse=j,SeparationM=sep});
            }
            return list;
        }
        public static string Describe(IList<PairCandidate> c)=>c==null||c.Count==0?"NO_PAIR":c.Count==1?"UNIQUE_PAIR":"AMBIGUOUS_PAIRS";
        public static bool MatchesExpected(PairCandidate c,double expectedM)=>
            c!=null&&Math.Abs(c.SeparationM-expectedM)<=OptionsAnalysis.ThicknessToleranceM;
        // Angle consistency of a normal-incidence candidate separation s0 at tilt angleDeg: some same-entity/same-material pair
        // must be separated by s0/cos(angle). Nearby unrelated objects do not satisfy this at every angle.
        public static string AngleConsistency(IList<PairCandidate> atAngle,double s0,double angleDeg)
        {
            if(atAngle==null||atAngle.Count==0)return "NO_PAIR";
            double want=ObliqueAnalysis.ExpectedPath(s0,angleDeg);
            foreach(var c in atAngle)if(Math.Abs(c.SeparationM-want)<=ObliqueAnalysis.ToleranceM)return "ANGLE_CONSISTENT";
            return "NO_CONSISTENT_PAIR";
        }
        // CORROBORATED only when the normal-incidence pair is unique and every tested angle is consistent.
        public static string Corroborate(string normalDescription,IList<string> angleResults)
        {
            if(normalDescription=="NO_PAIR")return "NO_THICKNESS_CLAIM:NO_PAIR";
            if(normalDescription!="UNIQUE_PAIR")return "NO_THICKNESS_CLAIM:AMBIGUOUS_NORMAL_PAIR";
            if(angleResults==null||angleResults.Count==0)return "NO_THICKNESS_CLAIM:NOT_ANGLE_TESTED";
            foreach(var r in angleResults)if(r!="ANGLE_CONSISTENT")return "NO_THICKNESS_CLAIM:ANGLE_INCONSISTENT";
            return "CORROBORATED_THICKNESS";
        }
    }
    // E0.4 passive correlation of a reported impact coordinate with the gameplay camera ray. A single impact point plus the camera
    // ray shows only that the impact is near the aim line at that instant; it is NOT an authoritative complete bullet trajectory
    // (spread, recoil, ricochet, penetration and pellets are invisible to it).
    public static class ShotCorrelation
    {
        public const double OnRayDeg=3.0, NearRayDeg=10.0, EqualEps=.001;
        // GTA convention: rotation x = pitch, z = heading; forward = (-sin(z)cos(x), cos(z)cos(x), sin(x)).
        public static double[] Direction(double pitchDeg,double headingDeg)
        {
            double p=pitchDeg*Math.PI/180.0,h=headingDeg*Math.PI/180.0;
            return new[]{-Math.Sin(h)*Math.Cos(p),Math.Cos(h)*Math.Cos(p),Math.Sin(p)};
        }
        public static double OffAxisDeg(double[] cam,double[] dir,double[] impact)
        {
            double vx=impact[0]-cam[0],vy=impact[1]-cam[1],vz=impact[2]-cam[2];
            double vl=Math.Sqrt(vx*vx+vy*vy+vz*vz),dl=Math.Sqrt(dir[0]*dir[0]+dir[1]*dir[1]+dir[2]*dir[2]);
            if(vl<1e-9||dl<1e-9)return double.NaN;
            double c=(vx*dir[0]+vy*dir[1]+vz*dir[2])/(vl*dl);
            return Math.Acos(Math.Max(-1.0,Math.Min(1.0,c)))*180.0/Math.PI;
        }
        public static string Classify(double offAxisDeg)=>double.IsNaN(offAxisDeg)?"UNDEFINED":
            offAxisDeg<=OnRayDeg?"ON_CAMERA_RAY":offAxisDeg<=NearRayDeg?"NEAR_CAMERA_RAY":"OFF_CAMERA_RAY";
        // Consecutive identical coordinates are one latched report; this is a LOWER bound on distinct impacts, never a round count.
        public static int DistinctImpactRuns(IList<double[]> impacts)
        {
            int n=0;double[] last=null;
            foreach(var p in impacts)
            {
                if(last==null||Math.Abs(p[0]-last[0])>EqualEps||Math.Abs(p[1]-last[1])>EqualEps||Math.Abs(p[2]-last[2])>EqualEps)n++;
                last=p;
            }
            return n;
        }
    }
    // E0.5 phantom-collision policy: the shape test must stop seeing a deleted lab prop within 100 ms (doc 04 routing decision).
    public static class PhantomCollision
    {
        public const long ThresholdMs=100;
        public const int MaxFrames=30, LabProps=3, LabPeds=2;
        public static string Classify(long firstClearMs,int framesObserved)
        {
            if(framesObserved<MaxFrames)return "INCOMPLETE";
            if(firstClearMs<0)return "PERSISTENT_PHANTOM_DELETED_ENTITIES_UNSOUND";
            return firstClearMs<=ThresholdMs?"CLEAR_WITHIN_THRESHOLD":"PHANTOM_OVER_THRESHOLD_DELETED_ENTITIES_MAY_BE_UNSOUND";
        }
        // Bounded lab: the experiment may only create these counts, within the configured small radius of the site.
        public static bool WithinBudget(int props,int peds,float radius)=>props>=1&&props<=LabProps&&peds>=0&&peds<=LabPeds&&radius>=0&&radius<=10;
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
