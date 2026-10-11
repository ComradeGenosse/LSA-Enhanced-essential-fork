using System;
using System.Linq;
using Rage;
using LSA.Intelligence;

namespace LSA.PromotedCharacters
{
    // Read-only P2 owner-fiber source. Build inclusion and the single
    // IntelligenceChannel publication call belong to K; this class does NOT
    // start another sampler, fiber, transport, SQLite store or executor.
    public sealed partial class PromotedCharactersIntegration
    {
        // Called only on the existing Core owner fiber after P2/PS anchor
        // maintenance. The per-sample full snapshot revokes omitted owners.
        // There is intentionally no CharacterId field: P1 owns native alias
        // identity; the P2 SQLite profile maps that alias to CharacterId.
        public object SampleMemoryNativeAuthority()
        {
            if(!IsReady || identity?.Owner==null || Host==null) return null;
            int epoch=Host.WorldEpoch;
            string run=Host.HostRunId;
            uint tick=unchecked((uint)Game.GameTime);
            var list=Host.Anchors.Current.Where(a=>a.Observer && a.Kind=="ped")
                .Take(17).ToArray();
            if(list.Length>16) return null; // no silently partial roster
            var result=new System.Collections.Generic.List<object>(list.Length);
            foreach(var anchor in list)
            {
                var current=Host.Anchors.Resolve(anchor.CaptureRef);
                if(!Object.ReferenceEquals(current,anchor)) return null;
                // An ambient observer has no P2 owner. It must NOT be
                // attributed to a nearby promoted companion.
                if(anchor.OwnerLifetime==null) continue;
                var matches=encounters.Values.Where(e=>e.Registration!=null &&
                    e.Ped!=null && anchor.Entity is Ped &&
                    Object.ReferenceEquals(anchor.Entity,e.Ped) &&
                    e.Handle==anchor.Handle && e.Address==anchor.Address &&
                    e.Registration.IncarnationId==anchor.OwnerLifetime &&
                    Alive(e)).Take(2).ToArray();
                if(matches.Length!=1)return null;
                var encounter=matches[0];
                if(encounter.Suspended || encounter.OwnerAlias==null ||
                   !encounter.OwnerAlias.StartsWith("promoted.",StringComparison.Ordinal) ||
                   encounter.OwnerAlias.Length!=45 ||
                   !Guid.TryParseExact(encounter.Id,"D",out var encounterGuid) ||
                   !Guid.TryParseExact(encounter.Registration.IncarnationId,"D",out var incGuid))
                    return null;
                if(!identity.Owner.TryResolveCurrent(encounter.Ped,out var claim) ||
                   claim==null ||
                   !MemoryOwnerProofPolicy.ExactOwner(
                       encounter.OwnerAlias,claim.sourceKey,
                       encounter.Registration.IncarnationId,claim.incarnationId,
                       world,claim.worldProfileId,
                       anchor.Observer,Alive(encounter),
                       Object.ReferenceEquals(Host.Anchors.Resolve(anchor.CaptureRef),anchor),
                       Object.ReferenceEquals(encounter.Registration,encounter.Registration)))
                    return null;
                result.Add(new {
                    observerCaptureRef=anchor.CaptureRef,
                    ownerAlias=encounter.OwnerAlias,
                    hostRunId=run,worldEpoch=epoch,
                    incarnationId=encounter.Registration.IncarnationId,
                    encounterId=encounter.Id,sampledGameTick=tick
                });
            }
            // Never publish a mixed-epoch or partially live snapshot.
            if(Host.WorldEpoch!=epoch || !IsReady) return null;
            return new {
                memoryProofVersion=1,hostRunId=run,worldEpoch=epoch,
                sampledGameTick=tick,owners=result.ToArray(),
                protagonist=MemoryProtagonistSource.Sample(Host,tick),
                // C-01 accepted normal-player-turn native source is NOT
                // presently exposed. Director stock tickets are unrelated.
                acceptedTurns=new object[0]
            };
        }
    }
}
