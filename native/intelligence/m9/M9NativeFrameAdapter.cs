using System;

namespace LSA.Intelligence.M9
{
    // Pure, owner-fiber staging contract. Does NOT call RAGE/GTA native APIs,
    // turn a state edge into a PS2 witness, or enqueue a Director turn.
    // K supplies separately source-pinned readers. Missing proof = null fields.
    public sealed class M9RawNativeRead
    {
        public string nativeRun, hostRunId, playerCaptureRef, vehicleCaptureRef;
        public long worldEpoch, sampledAtMs;
        public uint gameTick;
        public int? wantedLevel;
        public bool? airborne, grounded, inWater, submerged;
        public double? rollDegrees, speedKph;
        public M9CollisionEvidence collision;
        public M9TerminalReceipt terminal;
    }
    public sealed class M9TerminalReceipt
    {
        public string kind, nativeReceiptId, playerCaptureRef;
        public uint gameTick;
        public long sampledAtMs;
    }
    public sealed class M9FrameVehicle
    {
        public bool? airborne, grounded, inWater, submerged;
        public double? rollDegrees, speedKph;
        public M9CollisionEvidence collision;
    }
    public sealed class M9FrameSource
    {
        public bool authenticated;
        public string adapterEpoch, hostRunId, playerCaptureRef;
        public long worldEpoch;
    }
    public sealed class M9NativeFrame
    {
        public string nativeRun, hostRunId, playerCaptureRef, vehicleCaptureRef;
        public long worldEpoch, sampledAtMs;
        public uint gameTick;
        public int? wantedLevel;
        public M9FrameVehicle vehicle;
        public M9TerminalReceipt outcome;
        public M9FrameSource source;
    }

    // Trust only concrete current owner-fiber evidence, not flags that came
    // from the pipe or from a caller-controlled JSON snapshot.
    public sealed class M9NativeFrameAdapter
    {
        public const long MaxSampleAgeMs=3000;
        readonly EntityAnchors anchors;
        readonly Func<M9RawNativeRead,bool> verifyBaseRead;
        readonly Func<M9RawNativeRead,string,bool> verifyNativeField;
        readonly Func<M9CollisionEvidence,bool> verifyCollisionReceipt;
        readonly Func<M9TerminalReceipt,bool> verifyTerminalReceipt;
        readonly Func<string> currentNativeRun,currentHostRun;
        readonly Func<long> currentWorldEpoch;

        public M9NativeFrameAdapter(EntityAnchors anchors,
          Func<M9RawNativeRead,bool> verifyBaseRead,
          Func<M9RawNativeRead,string,bool> verifyNativeField,
          Func<M9CollisionEvidence,bool> verifyCollisionReceipt,
          Func<M9TerminalReceipt,bool> verifyTerminalReceipt,
          Func<string> currentNativeRun,Func<string> currentHostRun,
          Func<long> currentWorldEpoch)
        {
            this.anchors=anchors??throw new ArgumentNullException(nameof(anchors));
            this.verifyBaseRead=verifyBaseRead??throw new ArgumentNullException(nameof(verifyBaseRead));
            this.verifyNativeField=verifyNativeField??throw new ArgumentNullException(nameof(verifyNativeField));
            this.verifyCollisionReceipt=verifyCollisionReceipt??throw new ArgumentNullException(nameof(verifyCollisionReceipt));
            this.verifyTerminalReceipt=verifyTerminalReceipt??throw new ArgumentNullException(nameof(verifyTerminalReceipt));
            this.currentNativeRun=currentNativeRun??throw new ArgumentNullException(nameof(currentNativeRun));
            this.currentHostRun=currentHostRun??throw new ArgumentNullException(nameof(currentHostRun));
            this.currentWorldEpoch=currentWorldEpoch??throw new ArgumentNullException(nameof(currentWorldEpoch));
        }
        static bool Uuid(string value) {
            Guid id;
            return value!=null && Guid.TryParseExact(value,"D",out id) && id!=Guid.Empty;
        }
        static bool Safe(Func<bool> check) {try{return check();}catch{return false;}}
        static bool Motion(M9RawNativeRead r) =>
            r.airborne.HasValue && r.grounded.HasValue &&
            r.inWater.HasValue && r.submerged.HasValue &&
            r.rollDegrees.HasValue && r.rollDegrees.Value>=0 &&
            r.rollDegrees.Value<=180 && !double.IsInfinity(r.rollDegrees.Value) &&
            !double.IsNaN(r.rollDegrees.Value) &&
            r.speedKph.HasValue && r.speedKph.Value>=0 &&
            r.speedKph.Value<=500 && !double.IsNaN(r.speedKph.Value) &&
            !double.IsInfinity(r.speedKph.Value);

        public bool TryBuild(M9RawNativeRead read,long now,out M9NativeFrame frame)
        {
            frame=null;
            if(read==null || !Uuid(read.nativeRun) || !Uuid(read.hostRunId) ||
               !Uuid(read.playerCaptureRef) || read.worldEpoch<0 ||
               read.sampledAtMs<0 || now<read.sampledAtMs ||
               now-read.sampledAtMs>MaxSampleAgeMs ||
               !Safe(()=>read.nativeRun==currentNativeRun() &&
                 read.hostRunId==currentHostRun() &&
                 read.worldEpoch==currentWorldEpoch() &&
                 verifyBaseRead(read)))return false;
            var player=anchors.Resolve(read.playerCaptureRef);
            if(player==null || player.Kind!="player")return false;
            EntityAnchor vehicle=null;
            if(read.vehicleCaptureRef!=null) {
                vehicle=anchors.Resolve(read.vehicleCaptureRef);
                if(vehicle==null || vehicle.Kind!="vehicle")return false;
            }
            bool motion=vehicle!=null && Motion(read) &&
                Safe(()=>verifyNativeField(read,"vehicle_motion"));
            bool wanted=read.wantedLevel.HasValue &&
                read.wantedLevel.Value>=0 && read.wantedLevel.Value<=5 &&
                Safe(()=>verifyNativeField(read,"wanted_level"));
            M9CollisionEvidence collision=null;
            if(vehicle!=null && read.collision!=null &&
               Uuid(read.collision.nativeReceiptId) &&
               read.collision.sourceType=="damage_tracker_vehicle_collision" &&
               read.collision.damage>=35 && read.collision.damage<=100000 &&
               read.collision.playerCaptureRef==player.CaptureRef &&
               read.collision.vehicleCaptureRef==vehicle.CaptureRef &&
               read.collision.sampledAtMs>=0 && now>=read.collision.sampledAtMs &&
               now-read.collision.sampledAtMs<=MaxSampleAgeMs &&
               Safe(()=>verifyCollisionReceipt(read.collision)))
                collision=read.collision;
            M9TerminalReceipt terminal=null;
            if(read.terminal!=null && Uuid(read.terminal.nativeReceiptId) &&
               (read.terminal.kind=="wasted" || read.terminal.kind=="busted") &&
               read.terminal.playerCaptureRef==player.CaptureRef &&
               now>=read.terminal.sampledAtMs &&
               now-read.terminal.sampledAtMs<=MaxSampleAgeMs &&
               Safe(()=>verifyTerminalReceipt(read.terminal)))
                terminal=read.terminal;
            frame=new M9NativeFrame {
                nativeRun=read.nativeRun,hostRunId=read.hostRunId,
                worldEpoch=read.worldEpoch,playerCaptureRef=player.CaptureRef,
                vehicleCaptureRef=vehicle?.CaptureRef,gameTick=read.gameTick,
                sampledAtMs=read.sampledAtMs,
                wantedLevel=wanted?read.wantedLevel:null,
                vehicle=vehicle==null ? null : new M9FrameVehicle {
                    airborne=motion?read.airborne:null,grounded=motion?read.grounded:null,
                    inWater=motion?read.inWater:null,submerged=motion?read.submerged:null,
                    rollDegrees=motion?read.rollDegrees:null,speedKph=motion?read.speedKph:null,
                    collision=collision
                },
                outcome=terminal,
                // Explicitly marked as envelope only: JS must still call
                // verifySource against the live registered native session.
                source=new M9FrameSource {authenticated=true,
                    adapterEpoch=read.nativeRun,hostRunId=read.hostRunId,
                    worldEpoch=read.worldEpoch,playerCaptureRef=player.CaptureRef}
            };
            return true;
        }
    }
}
