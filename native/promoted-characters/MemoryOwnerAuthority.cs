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

        // K-21: reason codes of the owners omitted from the most recent
        // SampleMemoryCurrentOwnerPlayer frame (observability and tests only).
        // Deliberately NOT part of the frame: the D02 payload shape is exact.
        internal string[] LastCurrentOwnerOmissions { get; private set; } = new string[0];

        sealed class CurrentOwnerProof
        {
            public string Alias, PedId;
            public object Proof;
        }

        // D02: independent CURRENT owner/player source only. K must register
        // this on the existing owner fiber and send a separately negotiated,
        // authenticated memory_current_owner_player frame. This NEVER reports
        // acceptance of a typed or STT turn and never starts a second sampler.
        //
        // K-21 availability contract. FRAME-level faults still yield null:
        // host not ready, no single provable protagonist before and after the
        // traversal, a roster overflow, or a run/epoch change mid-sample. Those
        // describe the whole snapshot. OWNER-level faults omit only the failing
        // anchor, and every owner that IS emitted has passed the complete,
        // unchanged per-owner proof (live exact anchor, exactly one live
        // registered encounter, not suspended, P1 claim bound to the same
        // alias/incarnation/world, exact actor lifetime). An unverifiable NPC is
        // never guessed, repaired or carried over; it is simply not asserted.
        public object SampleMemoryCurrentOwnerPlayer()
        {
            LastCurrentOwnerOmissions=new string[0];
            if(!IsReady || identity?.Owner==null || Host==null) return null;
            int epoch=Host.WorldEpoch;
            string run=Host.HostRunId;
            uint tick=unchecked((uint)Game.GameTime);
            var playerBefore=MemoryProtagonistSource.Sample(Host,tick);
            if(playerBefore==null) return null;
            var anchors=Host.Anchors.Current.Where(a=>a.Observer && a.Kind=="ped")
                .Take(17).ToArray();
            if(anchors.Length>16) return null;
            var candidates=new System.Collections.Generic.List<CurrentOwnerProof>(anchors.Length);
            var omissions=new System.Collections.Generic.List<string>();
            foreach(var anchor in anchors)
            {
                if(anchor==null || anchor.OwnerLifetime==null) continue; // ambient != promoted
                string reason;
                CurrentOwnerProof proof=null;
                try { reason=TryProveCurrentOwner(anchor,run,epoch,tick,out proof); }
                catch { reason="proof_fault"; proof=null; } // stale native object: fail closed for THIS owner
                if(reason!=null || proof==null) omissions.Add(reason??"proof_fault");
                else candidates.Add(proof);
            }
            // The consumer rejects the entire frame on a repeated alias or
            // ped, and a duplicated identity cannot be attributed to either
            // claimant. Drop every claimant of a duplicate; keep the others.
            var proofs=new System.Collections.Generic.List<object>(candidates.Count);
            foreach(var candidate in candidates)
            {
                if(candidates.Count(c=>string.Equals(c.Alias,candidate.Alias,StringComparison.Ordinal))>1 ||
                   candidates.Count(c=>string.Equals(c.PedId,candidate.PedId,StringComparison.Ordinal))>1)
                    omissions.Add("duplicate_identity");
                else proofs.Add(candidate.Proof);
            }
            var playerAfter=MemoryProtagonistSource.Sample(Host,tick);
            if(!IsReady || Host.WorldEpoch!=epoch || Host.HostRunId!=run ||
               playerAfter==null || !object.Equals(playerBefore,playerAfter))
                return null;
            LastCurrentOwnerOmissions=omissions.ToArray();
            // This source describes a contemporaneous native snapshot, NOT
            // the original backend's final accepted player dialogue.
            return new {
                nativeOwnerPlayerProofVersion=1,
                source="native_p2_owner_fiber_current_only",
                hostRunId=run,worldEpoch=epoch,sampledGameTick=tick,
                owners=proofs.ToArray(),protagonist=playerAfter
            };
        }

        // Strict per-owner proof for one promoted observer anchor. Returns
        // null on success, otherwise the reason code for omitting this owner.
        // The checks are exactly those the all-or-nothing sampler applied.
        string TryProveCurrentOwner(EntityAnchor anchor,string run,int epoch,uint tick,out CurrentOwnerProof result)
        {
            result=null;
            if(!object.ReferenceEquals(Host.Anchors.Resolve(anchor.CaptureRef),anchor))
                return "anchor_not_current";
            var matches=encounters.Values.Where(e=>e.Registration!=null &&
                e.Ped!=null && anchor.Entity is Ped &&
                object.ReferenceEquals(anchor.Entity,e.Ped) &&
                e.Handle==anchor.Handle && e.Address==anchor.Address &&
                e.CaptureRef==anchor.CaptureRef &&
                e.Registration.IncarnationId==anchor.OwnerLifetime &&
                Alive(e)).Take(2).ToArray();
            if(matches.Length!=1) return "no_unique_encounter";
            var e=matches[0];
            if(e.Suspended) return "suspended";
            if(e.OwnerAlias==null) return "alias_missing";
            if(!Guid.TryParseExact(e.Id,"D",out var encounterId) ||
               !Guid.TryParseExact(e.Registration.IncarnationId,"D",out var incarnationId))
                return "id_invalid";
            if(!identity.Owner.TryResolveCurrent(e.Ped,out var claim) || claim==null)
                return "claim_unresolved";
            if(!MemoryOwnerProofPolicy.ExactOwner(
                   e.OwnerAlias,claim.sourceKey,
                   e.Registration.IncarnationId,claim.incarnationId,
                   world,claim.worldProfileId,
                   anchor.Observer,Alive(e),
                   object.ReferenceEquals(Host.Anchors.Resolve(anchor.CaptureRef),anchor),
                   e.Registration!=null))
                return "owner_mismatch";
            string pedId=e.Ped.Handle.ToString();
            if(!MemoryOwnerProofPolicy.ExactActorLifetime(
                 pedId,pedId,e.CaptureRef,anchor.CaptureRef,
                 e.Registration.IncarnationId,anchor.OwnerLifetime,
                 e.Id,e.Id,
                 object.ReferenceEquals(e.Ped,anchor.Entity),
                 e.Address!=IntPtr.Zero && e.Address==anchor.Address,
                 object.ReferenceEquals(Host.Anchors.Resolve(anchor.CaptureRef),anchor),
                 Alive(e)))
                return "lifetime_mismatch";
            result=new CurrentOwnerProof {
                Alias=e.OwnerAlias,PedId=pedId,
                Proof=new {
                    observerCaptureRef=anchor.CaptureRef,
                    incarnationId=e.Registration.IncarnationId,
                    encounterId=e.Id,ownerAlias=e.OwnerAlias,
                    hostRunId=run,worldEpoch=epoch,
                    nativeActorPedId=pedId,sampledGameTick=tick
                }
            };
            return null;
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
