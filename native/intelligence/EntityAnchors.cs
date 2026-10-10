using System;
using System.Collections.Generic;
using System.Linq;

namespace LSA.Intelligence
{
    public enum AnchorConsumer { PsDiscovery, PsObserver, P2Encounter, TurnActor, ActTarget }
    public enum AnchorRetirement { LifetimeMismatch, Invalid, Expired, OwnerRevoked, WorldReset, Shutdown }
    internal interface IDamageSensors : IDisposable {bool Running {get;}}
    internal sealed class ReferenceComparer<T> : IEqualityComparer<T> where T:class
    {public bool Equals(T x,T y)=>ReferenceEquals(x,y);public int GetHashCode(T value)=>System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(value);}
    // Game-path only. Native addresses never leave this retained, run-local table.
    public sealed class EntityAnchor
    {
        public readonly string CaptureRef = Guid.NewGuid().ToString("D");
        public string Kind, OwnerLifetime;
        public ulong Handle;
        public IntPtr Address;
        public object Entity;
        public Func<bool> Validate;
        public long LastSeen;
        public bool Observer;
        internal readonly HashSet<AnchorConsumer> Consumers = new HashSet<AnchorConsumer>();
    }
    public sealed class EntityAnchors
    {
        public const int Limit = 256, ObserverLimit = 16;
        readonly Dictionary<string,EntityAnchor> entries = new Dictionary<string,EntityAnchor>();
        int cleanupCursor;
        public event Action<EntityAnchor> Retired;
        public event Action<EntityAnchor,AnchorRetirement> Retirement;
        public IEnumerable<EntityAnchor> Current => entries.Values.ToArray();
        public int Count => entries.Count;
        public int RetirementNotificationFaults {get;private set;}
        public int ObserverCount => entries.Values.Count(a=>a.Observer);
        public int ConsumerCount(AnchorConsumer consumer) => entries.Values.Count(a=>a.Consumers.Contains(consumer));
        static int ConsumerLimit(AnchorConsumer consumer) => consumer==AnchorConsumer.ActTarget?32:Limit;
        static bool Valid(Func<bool> validate) {try{return validate!=null && validate();}catch{return false;}}
        // Apply a game-path priority list atomically. First item wins; old lower
        // priority anchors are demoted in place, preserving their exact lifetime.
        public void SetObserverPriority(IEnumerable<string> orderedCaptureRefs)
        {
            // Materialize before clearing flags. EnrichActor supplies a lazy
            // enumeration of the CURRENT observer set; evaluating it after
            // the demotion erased all previous observers on every P0 turn.
            var priority=(orderedCaptureRefs??Enumerable.Empty<string>()).ToArray();
            foreach(var a in entries.Values) a.Observer=false;
            var admitted=new HashSet<string>();
            foreach(var captureRef in priority) {
                if(admitted.Count>=ObserverLimit) break;
                if(captureRef==null || admitted.Contains(captureRef) || !entries.TryGetValue(captureRef,out var a) || a.Kind!="ped") continue;
                admitted.Add(captureRef);a.Observer=true;
            }
        }
        public EntityAnchor Retain(object entity, ulong handle, IntPtr address, string kind, string ownerLifetime, Func<bool> validate, long now, bool observer = false, AnchorConsumer consumer = AnchorConsumer.PsDiscovery)
        {
            if(!Enum.IsDefined(typeof(AnchorConsumer),consumer) || entity==null || address==IntPtr.Zero || !Valid(validate) || (kind!="ped" && kind!="player" && kind!="vehicle")) return null;
            // Only PS may assign observer slots. Entity retention by ACT/P2 is
            // never observer admission, including when they share an existing ref.
            if(observer && consumer!=AnchorConsumer.PsDiscovery && consumer!=AnchorConsumer.PsObserver) return null;
            // Match the retained native lifetime, not a current CharacterId binding.
            var old=entries.Values.FirstOrDefault(a=>a.Handle==handle && a.Kind==kind);
            if(old!=null && (!ReferenceEquals(old.Entity,entity) || old.Address!=address || old.OwnerLifetime!=ownerLifetime || !Valid(old.Validate))) { Retire(old.CaptureRef,AnchorRetirement.LifetimeMismatch); old=null; }
            if((old==null || !old.Consumers.Contains(consumer)) && ConsumerCount(consumer)>=ConsumerLimit(consumer)) return null;
            if(old!=null) { old.Consumers.Add(consumer); old.LastSeen=now; if(observer && !old.Observer && ObserverCount<ObserverLimit) old.Observer=true; return old; }
            if(entries.Count>=Limit || (observer && ObserverCount>=ObserverLimit)) return null;
            var anchor=new EntityAnchor {Entity=entity,Handle=handle,Address=address,Kind=kind,OwnerLifetime=ownerLifetime,Validate=validate,LastSeen=now,Observer=observer};
            anchor.Consumers.Add(consumer); entries.Add(anchor.CaptureRef,anchor); return anchor;
        }
        public EntityAnchor Resolve(string captureRef)
        {
            if(captureRef==null || !entries.TryGetValue(captureRef,out var a)) return null;
            if(!Valid(a.Validate)) { Retire(captureRef,AnchorRetirement.Invalid); return null; } return a;
        }
        public void Retire(string captureRef,AnchorRetirement reason=AnchorRetirement.Invalid) {
            if(captureRef==null || !entries.TryGetValue(captureRef,out var a)) return;
            entries.Remove(captureRef);
            // One optional consumer cannot prevent retirement fanout or leave
            // another consumer's stale index alive. Faults remain observable.
            foreach(var callback in Retired?.GetInvocationList() ?? new Delegate[0])
                try {((Action<EntityAnchor>)callback)(a);} catch {RetirementNotificationFaults=(int)Math.Min(int.MaxValue,RetirementNotificationFaults+1L);}
            foreach(var callback in Retirement?.GetInvocationList() ?? new Delegate[0])
                try {((Action<EntityAnchor,AnchorRetirement>)callback)(a,reason);} catch {RetirementNotificationFaults=(int)Math.Min(int.MaxValue,RetirementNotificationFaults+1L);}
        }
        public void ReleaseConsumer(string captureRef,AnchorConsumer consumer) { if(captureRef!=null && entries.TryGetValue(captureRef,out var a)) a.Consumers.Remove(consumer); }
        public void RevokeOwner(string ownerLifetime) { if(ownerLifetime==null) return; foreach(var a in Current.Where(a=>a.OwnerLifetime==ownerLifetime)) Retire(a.CaptureRef,AnchorRetirement.OwnerRevoked); }
        public void Cleanup(long now,int limit=256,Func<bool> remaining=null) {
            var current=Current.ToArray();
            for(int n=0;n<Math.Min(limit,current.Length);n++) {if(remaining!=null&&!remaining()) break;cleanupCursor=(cleanupCursor+1)%current.Length;var a=current[cleanupCursor];if(now-a.LastSeen>=30000) Retire(a.CaptureRef,AnchorRetirement.Expired);else if(!Valid(a.Validate)) Retire(a.CaptureRef,AnchorRetirement.Invalid);}
        }
        public void Clear(AnchorRetirement reason=AnchorRetirement.WorldReset) { foreach(var a in Current) Retire(a.CaptureRef,reason); }
    }
}
