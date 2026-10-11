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
        // Frame adaptation against same retained identities; no GTA native
        // source is claimed by this isolated verifier fixture.
        var fs=new EntityAnchors();
        bool sourceLive=true, framePlayerLive=true, frameVehicleLive=true;
        var fa=fs.Retain(new object(),40,new IntPtr(404),"player",null,
            ()=>framePlayerLive,100);
        var fv=fs.Retain(new object(),41,new IntPtr(405),"vehicle",null,
            ()=>frameVehicleLive,100);
        var nativeRun=Guid.NewGuid().ToString("D");
        var hostRun=Guid.NewGuid().ToString("D");
        bool baseProof=true, motionProof=true, wantedProof=true;
        bool collisionProof=false, terminalProof=false;
        var frames=new M9NativeFrameAdapter(fs,
            r=>baseProof && sourceLive,
            (r,field)=>field=="vehicle_motion"?motionProof:
                field=="wanted_level" && wantedProof,
            c=>collisionProof,t=>terminalProof,
            ()=>nativeRun,()=>hostRun,()=>1L);
        var data=new M9RawNativeRead {
            nativeRun=nativeRun,hostRunId=hostRun,worldEpoch=1,
            playerCaptureRef=fa.CaptureRef,vehicleCaptureRef=fv.CaptureRef,
            gameTick=400,sampledAtMs=1000,wantedLevel=2,
            airborne=false,grounded=true,inWater=false,submerged=false,
            rollDegrees=0,speedKph=95
        };
        M9NativeFrame frame;
        Check(frames.TryBuild(data,1050,out frame),
            "current source-attested M9 native frame");
        Check(frame.wantedLevel==2 && frame.vehicle.speedKph==95 &&
            frame.vehicle.grounded==true && frame.outcome==null,
            "proven wanted/motion, unknown terminal");
        wantedProof=false;motionProof=false;
        Check(frames.TryBuild(data,1050,out frame) &&
            frame.wantedLevel==null && frame.vehicle.airborne==null &&
            frame.vehicle.speedKph==null,
            "unsupported native readers stay unknown, not false edges");
        collisionProof=true;
        data.collision=new M9CollisionEvidence {
            nativeReceiptId=Guid.NewGuid().ToString("D"),damage=50,
            playerCaptureRef=fa.CaptureRef,vehicleCaptureRef=fv.CaptureRef,
            gameTick=400,sampledAtMs=1000
        };
        Check(frames.TryBuild(data,1050,out frame) &&
            frame.vehicle.collision!=null && frame.vehicle.speedKph==null,
            "pinned collision-only callback with unknown motion");
        collisionProof=false;
        Check(frames.TryBuild(data,1050,out frame) &&
            frame.vehicle.collision==null,
            "unproven collision refused");
        data.terminal=new M9TerminalReceipt {
            kind="busted",nativeReceiptId=Guid.NewGuid().ToString("D"),
            playerCaptureRef=fa.CaptureRef,gameTick=400,sampledAtMs=1000
        };
        Check(frames.TryBuild(data,1050,out frame) && frame.outcome==null,
            "unproven busted may not follow a wanted change");
        terminalProof=true;
        Check(frames.TryBuild(data,1050,out frame) &&
            frame.outcome.kind=="busted",
            "source-pinned terminal outcome fixture");
        Check(!frames.TryBuild(data,5000,out frame),
            "stale read is rejected, not replayed");
        var foreign=Guid.NewGuid().ToString("D");
        data.playerCaptureRef=foreign;
        Check(!frames.TryBuild(data,1050,out frame),
            "missing native player proof rejected");
        data.playerCaptureRef=fa.CaptureRef;
        frameVehicleLive=false;
        Check(!frames.TryBuild(data,1050,out frame),
            "retired vehicle incarnation rejected");
        frameVehicleLive=true;
        data.vehicleCaptureRef=null;
        Check(frames.TryBuild(data,1050,out frame) && frame.vehicle==null &&
            frame.outcome!=null,
            "no vehicle yields only independently pinned terminal");
        data.vehicleCaptureRef=fv.CaptureRef;
        baseProof=false;
        Check(!frames.TryBuild(data,1050,out frame),"base origin veto");
        baseProof=true;sourceLive=false;
        Check(!frames.TryBuild(data,1050,out frame),"retired host origin veto");
        sourceLive=true;
        framePlayerLive=false;
        Check(!frames.TryBuild(data,1050,out frame),"recycled player handle veto");
        framePlayerLive=true;
        data.hostRunId=foreign;
        Check(!frames.TryBuild(data,1050,out frame),"restart host fence");
        Console.WriteLine("M9 native: "+checks+" assertions passed");
    }
}
