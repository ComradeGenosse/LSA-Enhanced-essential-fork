using System;
using System.Collections.Generic;
using LSA.Intelligence;
using LSA.Intelligence.M9;

internal static class Program
{
    static int checks;
    static void Check(bool value,string name) {
        checks++;
        if(!value) throw new Exception("M9 native test failed: "+name);
    }
    static void Main()
    {
        var anchors=new EntityAnchors();
        bool vehicleLive=true, playerLive=true;
        var vehicle=new object();
        var player=new object();
        var va=anchors.Retain(vehicle,12,new IntPtr(101),"vehicle",null,
            ()=>vehicleLive,100);
        var pa=anchors.Retain(player,13,new IntPtr(102),"player",null,
            ()=>playerLive,100);
        Check(va!=null&&pa!=null,"retained true native anchors");
        var source=new RawSignal {
            producer="vehicle_damage",kind="vehicle_damage",
            signalId=Guid.NewGuid().ToString("D"),target=va.CaptureRef,
            gameTick=500,receivedMs=1000,
            facts=new Dictionary<string,object> {
                {"classification","collision"},{"damage",50}
            }
        };
        bool pinned=true;
        var adapter=new M9NativeDamageAdapter(anchors,s=>pinned &&
            Object.ReferenceEquals(s,source));
        M9CollisionEvidence evidence;
        Check(adapter.TryExtract(source,pa.CaptureRef,501,1100,out evidence),
            "pinned DamageTracker collision");
        Check(evidence.nativeReceiptId==source.signalId &&
            evidence.damage==50 &&
            evidence.vehicleCaptureRef==va.CaptureRef &&
            evidence.playerCaptureRef==pa.CaptureRef,
            "exact callback and capture identity");
        Check(evidence.sourceType=="damage_tracker_vehicle_collision",
            "no velocity claim");
        pinned=false;
        Check(!adapter.TryExtract(source,pa.CaptureRef,501,1100,out evidence),
            "unauthenticated callback refused");
        pinned=true;
        source.facts["classification"]="bullet";
        Check(!adapter.TryExtract(source,pa.CaptureRef,501,1100,out evidence),
            "noncollision damage refused");
        source.facts["classification"]="collision";
        source.facts["damage"]=34;
        Check(!adapter.TryExtract(source,pa.CaptureRef,501,1100,out evidence),
            "minor impact refused");
        source.facts["damage"]=50;
        Check(!adapter.TryExtract(source,pa.CaptureRef,501,5000,out evidence),
            "stale callback refused");
        Check(!adapter.TryExtract(source,pa.CaptureRef,20000,1100,out evidence),
            "stale game tick refused");
        Check(!adapter.TryExtract(source,Guid.NewGuid().ToString("D"),501,1100,out evidence),
            "no foreign unretained player");
        vehicleLive=false;
        Check(!adapter.TryExtract(source,pa.CaptureRef,501,1100,out evidence),
            "retired recycled vehicle handle refused");
        Check(anchors.Resolve(va.CaptureRef)==null,
            "invalid native anchor truly retired");
        vehicleLive=true;
        var replacement=anchors.Retain(new object(),12,new IntPtr(103),
            "vehicle",null,()=>true,200);
        Check(replacement!=null&&replacement.CaptureRef!=va.CaptureRef,
            "reused handle gets new captureRef");
        Check(!adapter.TryExtract(source,pa.CaptureRef,501,1100,out evidence),
            "old callback cannot borrow replacement handle");
        playerLive=false;
        Check(!adapter.TryExtract(source,pa.CaptureRef,501,1100,out evidence),
            "stale player fails closed");
        Console.WriteLine("M9 native: "+checks+" assertions passed");
    }
}
