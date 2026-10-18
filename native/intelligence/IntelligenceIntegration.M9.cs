#if LSA_M9_NATIVE
using System;
using System.Collections.Generic;
using System.Linq;
using LosSantosAlive.NPC;
using Rage;
using Rage.Native;
using LSA.Intelligence.M9;

namespace LSA.Intelligence
{
    // Default-off GTA event state sampler glue. Owner-fiber reads only; the sole
    // callback-thread entry is CaptureM9Collision, which reads a volatile snapshot.
    // Compiled only when the build opts in with LsaM9Native=true.
    public sealed partial class IntelligenceIntegration
    {
        // M9 GTA event state sampler. Entirely absent unless the native policy
        // requested the default-off "m9" producer; owner-fiber only except for
        // the collision staging hook, which only reads the volatile snapshot.
        sealed class M9Occupancy {public string PlayerRef,VehicleRef;public uint Tick;}
        readonly string m9NativeRun=Guid.NewGuid().ToString("D");
        M9StateSampler m9Sampler;
        M9OriginalVehicleCollisionProducer m9Collisions;
        volatile M9Occupancy m9Occupancy;
        long nextM9,nextM9Occupancy,m9Sent,m9SendFailed,m9Witnessed;
        int m9LineOfSightBudget;
        const float M9SubmergedLevel=0.75f;

        partial void InitializeM9()
        {
            if(m9Sampler!=null||stopped)return;
            m9Sampler=new M9StateSampler(anchors,()=>m9NativeRun,()=>host.HostRunId,()=>host.WorldEpoch);
            // Crash evidence exists only from the ORIGINAL DamageTracker vehicle
            // collision callback. Without that producer a crash stays unknown.
            if(producerPolicy.Allows("vehicle_damage")) {
                m9Collisions=new M9OriginalVehicleCollisionProducer(anchors,()=>m9NativeRun,()=>host.HostRunId,()=>host.WorldEpoch,VerifyM9PlayerVehicle);
                sensors.OriginalVehicleCollision=CaptureM9Collision;
            }
            LogStatus("[PS] m9_sampler_requested collisions="+(m9Collisions!=null));
        }
        partial void ResetM9()
        {
            try{m9Sampler?.Reset();m9Collisions?.Reset();}catch{}
            m9Occupancy=null;nextM9=0;nextM9Occupancy=0;
        }
        // Callback thread: reads only the volatile owner-fiber snapshot. The
        // player must have been observed in THIS exact vehicle within 250 ms
        // of the callback tick (the nearest owner-fiber evidence available).
        bool VerifyM9PlayerVehicle(RawSignal signal,string playerRef)
        {
            var snapshot=m9Occupancy;
            return snapshot!=null&&snapshot.VehicleRef!=null&&snapshot.PlayerRef==playerRef&&
                snapshot.VehicleRef==signal.target&&unchecked(signal.gameTick-snapshot.Tick)<=250;
        }
        void CaptureM9Collision(RawSignal signal)
        {
            var snapshot=m9Occupancy;var producer=m9Collisions;
            if(snapshot==null||producer==null)return;
            producer.Capture(signal,m9NativeRun,host.HostRunId,host.WorldEpoch,snapshot.PlayerRef);
        }
        partial void UpdateM9(uint tick,long now)
        {
            var sampler=m9Sampler;
            if(sampler==null||stopped)return;
            var player=Game.LocalPlayer.Character;
            if(player==null||!player.Exists()){m9Occupancy=null;return;}
            var playerAnchor=anchors.Current.FirstOrDefault(a=>a.Kind=="player"&&ReferenceEquals(a.Entity,player));
            if(playerAnchor==null||anchors.Resolve(playerAnchor.CaptureRef)==null){m9Occupancy=null;return;}
            Vehicle vehicle=null;EntityAnchor vehicleAnchor=null;
            try {
                var current=player.CurrentVehicle;
                if(current!=null&&current.Exists()&&NativeFunction.CallByName<bool>("IS_PED_IN_ANY_VEHICLE",player,false)) {
                    vehicle=current;vehicleAnchor=Retain(current,"vehicle");if(vehicleAnchor==null)vehicle=null;
                }
            } catch {vehicle=null;vehicleAnchor=null;}
            if(now>=nextM9Occupancy) {
                nextM9Occupancy=now+50;
                m9Occupancy=new M9Occupancy {PlayerRef=playerAnchor.CaptureRef,VehicleRef=vehicleAnchor?.CaptureRef,Tick=tick};
            }
            // Single use per owner pass. A receipt is re-stamped to THIS owner
            // observation tick only if the player is still in the same vehicle
            // and the callback is under 500 ms old; otherwise it stays unknown.
            M9CollisionEvidence collision=null;
            M9OriginalVehicleCollisionProducer.Occurrence taken;
            if(m9Collisions!=null&&m9Collisions.TryTake(tick,now,out taken)&&taken!=null&&taken.Collision!=null&&vehicleAnchor!=null&&
               taken.PlayerCaptureRef==playerAnchor.CaptureRef&&taken.Collision.vehicleCaptureRef==vehicleAnchor.CaptureRef&&
               now-taken.SampledAtMs<=500) {
                collision=new M9CollisionEvidence {nativeReceiptId=taken.Collision.nativeReceiptId,damage=taken.Collision.damage,
                    sourceType=taken.Collision.sourceType,vehicleCaptureRef=taken.Collision.vehicleCaptureRef,
                    playerCaptureRef=taken.Collision.playerCaptureRef,gameTick=tick,sampledAtMs=taken.Collision.sampledAtMs};
            }
            if(collision==null&&now<nextM9)return;
            nextM9=now+200;
            var read=new M9StateRead {PlayerCaptureRef=playerAnchor.CaptureRef,VehicleCaptureRef=vehicleAnchor?.CaptureRef,Collision=collision,
                BaseVerified=true};
            try {read.PlayerDead=player.IsDead;} catch {}
            try {
                int index=NativeFunction.CallByName<int>("PLAYER_ID");
                int wanted=NativeFunction.CallByName<int>("GET_PLAYER_WANTED_LEVEL",index);
                if(wanted>=0&&wanted<=5) {read.WantedLevel=wanted;read.WantedVerified=true;}
                read.PlayerBeingArrested=NativeFunction.CallByName<bool>("IS_PLAYER_BEING_ARRESTED",index,true);
            } catch {}
            if(vehicle!=null) {
                try {
                    bool airborne=NativeFunction.CallByName<bool>("IS_ENTITY_IN_AIR",vehicle);
                    bool grounded=NativeFunction.CallByName<bool>("IS_VEHICLE_ON_ALL_WHEELS",vehicle);
                    bool inWater=NativeFunction.CallByName<bool>("IS_ENTITY_IN_WATER",vehicle);
                    float submerged=NativeFunction.CallByName<float>("GET_ENTITY_SUBMERGED_LEVEL",vehicle);
                    float roll=NativeFunction.CallByName<float>("GET_ENTITY_ROLL",vehicle);
                    float speed=NativeFunction.CallByName<float>("GET_ENTITY_SPEED",vehicle);
                    if(!float.IsNaN(submerged)&&!float.IsInfinity(submerged)&&!float.IsNaN(roll)&&!float.IsInfinity(roll)&&
                       !float.IsNaN(speed)&&!float.IsInfinity(speed)) {
                        read.Airborne=airborne;read.Grounded=grounded;read.InWater=inWater;read.Submerged=submerged>=M9SubmergedLevel;
                        read.RollDegrees=Math.Min(180.0,Math.Abs((double)roll));read.SpeedKph=Math.Min(500.0,Math.Max(0.0,speed*3.6));
                        read.MotionVerified=true;
                    }
                } catch {}
            }
            m9LineOfSightBudget=8;
            Entity subject=vehicle!=null?(Entity)vehicle:player;
            var payload=sampler.Build(read,tick,now,()=>M9Witnesses(playerAnchor.CaptureRef,subject,tick),collision!=null);
            if(payload==null)return;
            if(channel?.Send("m9_sample",payload)==true) m9Sent=Math.Min(int.MaxValue,m9Sent+1);
            else m9SendFailed=Math.Min(int.MaxValue,m9SendFailed+1);
        }
        // Source-time geometry at the sample tick only; a missing or blocked
        // line is unknown/negative and is never emitted as a witness.
        List<WitnessReceipt> M9Witnesses(string playerRef,Entity subject,uint tick)
        {
            var result=new List<WitnessReceipt>();
            if(subject==null||!subject.Exists())return result;
            foreach(var observer in anchors.Current.Where(a=>a.Observer&&a.Kind=="ped"&&a.CaptureRef!=playerRef)
                .OrderBy(a=>a.Entity is Ped p?p.Position.DistanceTo(subject.Position):float.MaxValue)
                .ThenBy(a=>a.CaptureRef,StringComparer.Ordinal)) {
                if(result.Count>=M9StateSampler.MaxWitnesses||m9LineOfSightBudget<=0)break;
                var witness=observer.Entity as Ped;
                if(witness==null||!witness.Exists()||witness.Position.DistanceTo(subject.Position)>WitnessPolicy.VisualRange("m9_incident"))continue;
                var live=anchors.Resolve(observer.CaptureRef);
                if(live==null||!ReferenceEquals(live.Entity,witness))continue;
                m9LineOfSightBudget--;
                try {
                    var distance=witness.Position.DistanceTo(subject.Position);
                    bool sameInterior=NativeFunction.CallByName<int>("GET_INTERIOR_FROM_ENTITY",witness)==NativeFunction.CallByName<int>("GET_INTERIOR_FROM_ENTITY",subject);
                    bool clear=sameInterior&&NativeFunction.CallByName<bool>("HAS_ENTITY_CLEAR_LOS_TO_ENTITY_IN_FRONT",witness,subject);
                    var receipt=WitnessPolicy.Evaluate(new WitnessGeometry {EventKind="m9_incident",Observer=observer.CaptureRef,
                        SampledGameTick=tick,DistanceMeters=distance,SameInterior=sameInterior,ClearLosInFront=clear});
                    if(receipt.Status=="witnessed") {result.Add(receipt);m9Witnessed=Math.Min(int.MaxValue,m9Witnessed+1);}
                } catch {}
            }
            return result;
        }
        partial void ShutdownM9()
        {
            try{m9Collisions?.Retire();}catch{}
            sensors.OriginalVehicleCollision=null;m9Sampler=null;m9Occupancy=null;
        }
    }
}
#endif
