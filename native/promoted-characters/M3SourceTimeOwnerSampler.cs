using System;
using System.Linq;
using Rage;
using LSA.Intelligence;
using LSA.Intelligence.MemoryM3;

namespace LSA.PromotedCharacters
{
    // W02 only: authentic P2 lifetime lookup for the ORIGINAL native PS2
    // witness callback. K must call this on the existing owner fiber at the
    // same sampled game tick. It deliberately never takes JS-supplied identity.
    public sealed partial class PromotedCharactersIntegration
    {
        public SourceTimeOwner ResolveM3OwnerAtNativeSource(string observerCaptureRef)
        {
            if(!IsReady || Host==null || identity?.Owner==null ||
                String.IsNullOrEmpty(observerCaptureRef))return null;
            var epoch=Host.WorldEpoch;
            var hostRun=Host.HostRunId;
            var anchor=Host.Anchors.Resolve(observerCaptureRef);
            if(anchor==null||!anchor.Observer||anchor.Kind!="ped"||
                anchor.OwnerLifetime==null||!(anchor.Entity is Ped))return null;
            var matching=encounters.Values.Where(e=>e.Registration!=null&&e.Ped!=null&&
                Object.ReferenceEquals(e.Ped,anchor.Entity)&&
                e.Handle==anchor.Handle&&e.Address==anchor.Address&&
                e.Registration.IncarnationId==anchor.OwnerLifetime&&
                Alive(e)).Take(2).ToArray();
            if(matching.Length!=1)return null;
            var encounter=matching[0];
            if(encounter.Suspended||String.IsNullOrEmpty(encounter.OwnerAlias)||
                !encounter.OwnerAlias.StartsWith("promoted.",StringComparison.Ordinal)||
                encounter.OwnerAlias.Length!=45||
                !Guid.TryParseExact(encounter.Id,"D",out var encounterId)||
                !Guid.TryParseExact(encounter.Registration.IncarnationId,"D",out var incarnationId))
                return null;
            if(!identity.Owner.TryResolveCurrent(encounter.Ped,out var claim)||claim==null||
                !MemoryOwnerProofPolicy.ExactOwner(
                    encounter.OwnerAlias,claim.sourceKey,
                    encounter.Registration.IncarnationId,claim.incarnationId,
                    world,claim.worldProfileId,anchor.Observer,Alive(encounter),
                    Object.ReferenceEquals(Host.Anchors.Resolve(observerCaptureRef),anchor),
                    encounter.Registration!=null))
                return null;
            if(!IsReady||Host.WorldEpoch!=epoch||Host.HostRunId!=hostRun)return null;
            return new SourceTimeOwner(observerCaptureRef,encounter.OwnerAlias,
                encounter.Registration.IncarnationId,encounter.Id);
        }
    }
}
