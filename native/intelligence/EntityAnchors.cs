using System;
using System.Collections.Generic;
using System.Linq;

namespace LSA.Intelligence
{
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
    }
    public sealed class EntityAnchors
    {
        public const int Limit = 256, ObserverLimit = 16;
        readonly Dictionary<string,EntityAnchor> entries = new Dictionary<string,EntityAnchor>();
        int cleanupCursor;
        public event Action<EntityAnchor> Retired;
        public IEnumerable<EntityAnchor> Current => entries.Values.ToArray();
        public int Count => entries.Count;
        public int ObserverCount => entries.Values.Count(a=>a.Observer);
        // Apply a game-path priority list atomically. First item wins; old lower
        // priority anchors are demoted in place, preserving their exact lifetime.
        public void SetObserverPriority(IEnumerable<string> orderedCaptureRefs)
        {
            foreach(var a in entries.Values) a.Observer=false;
            var admitted=new HashSet<string>();
            foreach(var captureRef in orderedCaptureRefs??Enumerable.Empty<string>()) {
                if(admitted.Count>=ObserverLimit) break;
                if(captureRef==null || admitted.Contains(captureRef) || !entries.TryGetValue(captureRef,out var a) || a.Kind!="ped") continue;
                admitted.Add(captureRef);a.Observer=true;
            }
        }
        public EntityAnchor Retain(object entity, ulong handle, IntPtr address, string kind, string ownerLifetime, Func<bool> validate, long now, bool observer = false)
        {
            if(entity==null || address==IntPtr.Zero || validate==null || !validate()) return null;
            // Match the retained native lifetime, not a current CharacterId binding.
            var old=entries.Values.FirstOrDefault(a=>a.Handle==handle && a.Kind==kind);
            if(old!=null && (!ReferenceEquals(old.Entity,entity) || old.Address!=address || old.OwnerLifetime!=ownerLifetime || !old.Validate())) { Retire(old.CaptureRef); old=null; }
            if(old!=null) { old.LastSeen=now; if(observer && !old.Observer && ObserverCount<ObserverLimit) old.Observer=true; return old; }
            if(entries.Count>=Limit || (observer && ObserverCount>=ObserverLimit)) return null;
            var anchor=new EntityAnchor {Entity=entity,Handle=handle,Address=address,Kind=kind,OwnerLifetime=ownerLifetime,Validate=validate,LastSeen=now,Observer=observer};
            entries.Add(anchor.CaptureRef,anchor); return anchor;
        }
        public EntityAnchor Resolve(string captureRef)
        {
            if(captureRef==null || !entries.TryGetValue(captureRef,out var a)) return null;
            if(!a.Validate()) { Retire(captureRef); return null; } return a;
        }
        public void Retire(string captureRef) { if(entries.TryGetValue(captureRef,out var a)) { entries.Remove(captureRef); Retired?.Invoke(a); } }
        public void RevokeOwner(string ownerLifetime) { foreach(var a in Current.Where(a=>a.OwnerLifetime==ownerLifetime)) Retire(a.CaptureRef); }
        public void Cleanup(long now,int limit=256,Func<bool> remaining=null) {
            var current=Current.ToArray();
            for(int n=0;n<Math.Min(limit,current.Length);n++) {if(remaining!=null&&!remaining()) break;var a=current[cleanupCursor++%current.Length];if(now-a.LastSeen>=30000 || !a.Validate()) Retire(a.CaptureRef);}
        }
        public void Clear() { foreach(var a in Current) Retire(a.CaptureRef); }
    }
}
