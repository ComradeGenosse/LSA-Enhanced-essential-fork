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

        // D02: independent CURRENT owner/player source only. K must register
        // this on the existing owner fiber and send a separately negotiated,
        // authenticated memory_current_owner_player frame. This NEVER reports
        // acceptance of a typed or STT turn and never starts a second sampler.
        public object SampleMemoryCurrentOwnerPlayer()
        {
            if(!IsReady || identity?.Owner==null || Host==null) return null;
            int epoch=Host.WorldEpoch;
            string run=Host.HostRunId;
            uint tick=unchecked((uint)Game.GameTime);
            var playerBefore=MemoryProtagonistSource.Sample(Host,tick);
            if(playerBefore==null) return null;
            var anchors=Host.Anchors.Current.Where(a=>a.Observer && a.Kind=="ped")
                .Take(17).ToArray();
            if(anchors.Length>16) return null;
            var proofs=new System.Collections.Generic.List<object>(anchors.Length);
            var aliases=new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);
            var pedIds=new System.Collections.Generic.HashSet<string>(StringComparer.Ordinal);
            foreach(var anchor in anchors)
            {
                if(!object.ReferenceEquals(Host.Anchors.Resolve(anchor.CaptureRef),anchor))
                    return null;
                if(anchor.OwnerLifetime==null) continue; // ambient != promoted
                var matches=encounters.Values.Where(e=>e.Registration!=null &&
                    e.Ped!=null && anchor.Entity is Ped &&
                    object.ReferenceEquals(anchor.Entity,e.Ped) &&
                    e.Handle==anchor.Handle && e.Address==anchor.Address &&
                    e.CaptureRef==anchor.CaptureRef &&
                    e.Registration.IncarnationId==anchor.OwnerLifetime &&
                    Alive(e)).Take(2).ToArray();
                if(matches.Length!=1)return null;
                var e=matches[0];
                if(e.Suspended || e.OwnerAlias==null ||
                   !Guid.TryParseExact(e.Id,"D",out var encounterId) ||
                   !Guid.TryParseExact(e.Registration.IncarnationId,"D",out var incarnationId))
                    return null;
                if(!identity.Owner.TryResolveCurrent(e.Ped,out var claim) ||
                   claim==null ||
                   !MemoryOwnerProofPolicy.ExactOwner(
                       e.OwnerAlias,claim.sourceKey,
                       e.Registration.IncarnationId,claim.incarnationId,
                       world,claim.worldProfileId,
                       anchor.Observer,Alive(e),
                       object.ReferenceEquals(Host.Anchors.Resolve(anchor.CaptureRef),anchor),
                       e.Registration!=null))
                    return null;
                string pedId=e.Ped.Handle.ToString();
                if(!MemoryOwnerProofPolicy.ExactActorLifetime(
                     pedId,pedId,e.CaptureRef,anchor.CaptureRef,
                     e.Registration.IncarnationId,anchor.OwnerLifetime,
                     e.Id,e.Id,
                     object.ReferenceEquals(e.Ped,anchor.Entity),
                     e.Address!=IntPtr.Zero && e.Address==anchor.Address,
                     object.ReferenceEquals(Host.Anchors.Resolve(anchor.CaptureRef),anchor),
                     Alive(e)) ||
                   !aliases.Add(e.OwnerAlias) || !pedIds.Add(pedId))
                    return null;
                proofs.Add(new {
                    observerCaptureRef=anchor.CaptureRef,
                    incarnationId=e.Registration.IncarnationId,
                    encounterId=e.Id,ownerAlias=e.OwnerAlias,
                    hostRunId=run,worldEpoch=epoch,
                    nativeActorPedId=pedId,sampledGameTick=tick
                });
            }
            var playerAfter=MemoryProtagonistSource.Sample(Host,tick);
            if(!IsReady || Host.WorldEpoch!=epoch || Host.HostRunId!=run ||
               playerAfter==null || !object.Equals(playerBefore,playerAfter))
                return null;
            // This source describes a contemporaneous native snapshot, NOT
            // the original backend's final accepted player dialogue.
            return new {
                nativeOwnerPlayerProofVersion=1,
                source="native_p2_owner_fiber_current_only",
                hostRunId=run,worldEpoch=epoch,sampledGameTick=tick,
                owners=proofs.ToArray(),protagonist=playerAfter
            };
        }

        public object SampleMemoryNativeAuthority()
        {
            if(!IsReady || identity?.Owner==null || Host==null) return null;
            int epoch=Host.WorldEpoch;
            string run=Host.HostRunId;
            uint tick=unchecked((uint)Game.GameTime);
            // Capture the actual controlled protagonist on the same owner
            // fiber both before and after the roster traversal. Anonymous
            // native source snapshots implement value equality. A switch,
            // network transition or unknown native-player source invalidates
            // the entire sample instead of mixing two player incarnations.
            var protagonistBefore=MemoryProtagonistSource.Sample(Host,tick);
            if(protagonistBefore==null) return null;
            var list=Host.Anchors.Current.Where(a=>a.Observer && a.Kind=="ped")
                .Take(17).ToArray();
            if(list.Length>16) return null; // no silently partial roster
            var result=new System.Collections.Generic.List<object>(list.Length);
            foreach(var anchor in list)
            {
                var current=Host.Anchors.Resolve(anchor.CaptureRef);
                if(!object.ReferenceEquals(current,anchor)) return null;
                // An ambient observer has no P2 owner. It must NOT be
                // attributed to a nearby promoted companion.
                if(anchor.OwnerLifetime==null) continue;
                var matches=encounters.Values.Where(e=>e.Registration!=null &&
                    e.Ped!=null && anchor.Entity is Ped &&
                    object.ReferenceEquals(anchor.Entity,e.Ped) &&
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
                       object.ReferenceEquals(Host.Anchors.Resolve(anchor.CaptureRef),anchor),
                       encounter.Registration!=null))
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
            var protagonistAfter=MemoryProtagonistSource.Sample(Host,tick);
            if(Host.WorldEpoch!=epoch || Host.HostRunId!=run || !IsReady ||
               protagonistAfter==null ||
               !object.Equals(protagonistBefore,protagonistAfter))
                return null;
            return new {
                memoryProofVersion=1,hostRunId=run,worldEpoch=epoch,
                sampledGameTick=tick,owners=result.ToArray(),
                protagonist=protagonistAfter,
                // C-01 accepted normal-player-turn native source is NOT
                // presently exposed. Director stock tickets are unrelated.
                acceptedTurns=new object[0]
            };
        }
    }
}
