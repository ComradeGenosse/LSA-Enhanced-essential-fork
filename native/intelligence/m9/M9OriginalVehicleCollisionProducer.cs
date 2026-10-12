using System;
using System.Collections.Generic;

namespace LSA.Intelligence.M9
{
    // W08 ORIGINAL SOURCE: DamageSensors.VehicleDamage -> SensorAdapters.Damage.
    // No guessed GTA getter, polling proxy, collision velocity, or independent
    // source of actor identity. K must register Capture only at that original
    // pinned callback creation site, before the RawSignal is made observable.
    // Callback thread may stage records; TryTake runs on the game owner fiber.
    internal sealed class M9OriginalVehicleCollisionProducer
    {
        internal sealed class Occurrence
        {
            public readonly string NativeRun, HostRunId, PlayerCaptureRef;
            public readonly long WorldEpoch;
            public readonly string SourceEventId;
            public readonly uint GameTick;
            public readonly long SampledAtMs;
            public readonly M9CollisionEvidence Collision;
            internal Occurrence(Entry e,M9CollisionEvidence collision) {
                NativeRun=e.NativeRun;HostRunId=e.HostRunId;
                PlayerCaptureRef=e.PlayerCaptureRef;WorldEpoch=e.WorldEpoch;
                SourceEventId=e.SignalId;GameTick=e.GameTick;
                SampledAtMs=e.ReceivedMs;Collision=collision;
            }
        }
        internal sealed class Entry
        {
            public RawSignal Signal;
            public string NativeRun,HostRunId,PlayerCaptureRef;
            public long WorldEpoch;
            public string SignalId,Target;
            public uint GameTick;
            public long ReceivedMs;
            public int Damage;
        }
        readonly object gate=new object();
        readonly Queue<Entry> pending=new Queue<Entry>();
        readonly M9NativeDamageAdapter adapter;
        readonly Func<string> nativeRun,hostRun;
        readonly Func<long> worldEpoch;
        readonly Func<RawSignal,string,bool> verifiedPlayerVehicleAtEvent;
        bool retired;
        const int MaxPending=128;

        public M9OriginalVehicleCollisionProducer(EntityAnchors anchors,
            Func<string> currentNativeRun,Func<string> currentHostRun,
            Func<long> currentWorldEpoch,
            Func<RawSignal,string,bool> verifyPlayerVehicleAtEvent) {
            if(anchors==null||currentNativeRun==null||currentHostRun==null||
               currentWorldEpoch==null||verifyPlayerVehicleAtEvent==null)
                throw new ArgumentNullException();
            nativeRun=currentNativeRun;hostRun=currentHostRun;
            worldEpoch=currentWorldEpoch;
            verifiedPlayerVehicleAtEvent=verifyPlayerVehicleAtEvent;
            adapter=new M9NativeDamageAdapter(anchors,VerifyPendingOriginal);
        }
        static bool Uuid(string value) {
            Guid parsed;
            return value!=null&&Guid.TryParseExact(value,"D",out parsed)&&
                parsed!=Guid.Empty;
        }
        // Attest that the exact signal object has never changed after callback
        // creation. RawSignal is mutable; producer string alone proves nothing.
        static bool Same(Entry e) {
            var s=e.Signal;
            if(s==null||s.producer!="vehicle_damage"||s.kind!="vehicle_damage"||
               s.signalId!=e.SignalId||s.target!=e.Target||
               s.gameTick!=e.GameTick||s.receivedMs!=e.ReceivedMs||
               s.facts==null||!s.facts.TryGetValue("classification",out var kind)||
               !(kind is string)||(string)kind!="collision"||
               !s.facts.TryGetValue("damage",out var damage)||
               !(damage is int)||(int)damage!=e.Damage)return false;
            return true;
        }
        // Only a pinned callback must call Capture: the exact RawSignal object
        // created by SensorAdapters.Damage, not parsed wire JSON. The host and
        // player source arguments must come from native-owned context at
        // callback occurrence, never from an event candidate.
        public bool Capture(RawSignal signal,string callbackNativeRun,
            string callbackHostRun,long callbackEpoch,string callbackPlayerCaptureRef) {
            if(signal==null||signal.producer!="vehicle_damage"||
               signal.kind!="vehicle_damage"||
               !Uuid(signal.signalId)||!Uuid(signal.target)||
               !Uuid(callbackNativeRun)||!Uuid(callbackHostRun)||
               !Uuid(callbackPlayerCaptureRef)||callbackEpoch<0||
               signal.receivedMs<0||signal.facts==null||
               !signal.facts.TryGetValue("classification",out var kind)||
               !(kind is string)||(string)kind!="collision"||
               !signal.facts.TryGetValue("damage",out var damage)||
               !(damage is int)||(int)damage<35||(int)damage>100000)
                return false;
            // This callback names a vehicle, NOT its driver. A live player
            // capture ID on its own does not prove occupant/actor involvement.
            // T2/K must attest player+vehicle at this SOURCE game tick.
            bool actorProven=false;
            try {actorProven=verifiedPlayerVehicleAtEvent(signal,
                callbackPlayerCaptureRef);}catch{}
            if(!actorProven)return false;
            lock(gate) {
                if(retired||pending.Count>=MaxPending)return false;
                foreach(var e in pending)
                    if(Object.ReferenceEquals(e.Signal,signal)||
                       e.SignalId==signal.signalId)return false;
                pending.Enqueue(new Entry {
                    Signal=signal,NativeRun=callbackNativeRun,
                    HostRunId=callbackHostRun,WorldEpoch=callbackEpoch,
                    PlayerCaptureRef=callbackPlayerCaptureRef,
                    SignalId=signal.signalId,Target=signal.target,
                    GameTick=signal.gameTick,ReceivedMs=signal.receivedMs,
                    Damage=(int)damage
                });
                return true;
            }
        }
        // Strict per-call provenance: a stale, copied, mutable, or recycled
        // callback signal never becomes an M9 event. Single-use by dequeue.
        Entry active;
        bool VerifyPendingOriginal(RawSignal signal) {
            return active!=null&&Object.ReferenceEquals(active.Signal,signal)&&
                Same(active);
        }
        public bool TryTake(uint ownerGameTick,long now,out Occurrence occurrence) {
            occurrence=null;
            Entry e;
            lock(gate) {
                if(retired||pending.Count==0)return false;
                e=pending.Dequeue();
            }
            if(!Same(e)||now<e.ReceivedMs||now-e.ReceivedMs>3000)
                return false;
            try {
                if(nativeRun()!=e.NativeRun||hostRun()!=e.HostRunId||
                   worldEpoch()!=e.WorldEpoch)return false;
            }catch{return false;}
            try {
                // Only this owner-fiber call may grant the callback verifier.
                active=e;
                if(!adapter.TryExtract(e.Signal,e.PlayerCaptureRef,
                    ownerGameTick,now,out var collision))return false;
                occurrence=new Occurrence(e,collision);
                return true;
            }finally{active=null;}
        }
        public void Reset() {lock(gate){pending.Clear();active=null;}}
        public void Retire() {lock(gate){retired=true;pending.Clear();active=null;}}
        public int Pending {get{lock(gate)return pending.Count;}}
    }
}
