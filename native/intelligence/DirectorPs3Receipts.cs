using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace LSA.Intelligence
{
    // One authenticated PS pipe peer is the *original companion PS3 producer*.
    // Native verifies it against independent source signal and P2 challenge
    // records, rather than copying request-controlled ID strings into C-06.
    // This is an original PS3 producer RECEIPT, not native re-execution of PS3.
    // All methods are owner-fiber only. It has zero scheduling or GTA effects.
    internal sealed class DirectorPs3Receipts
    {
        internal sealed class Grant
        {
            public int Version,WorldEpoch,ProofRevision,SituationRevision;
            public int ObservationRevision,PolicyVersion,AgeMs;
            public string Source,Challenge,TicketId,HostRunId,SpeakerCaptureRef;
            public string PlayerCaptureRef,OwnerIncarnationId,SignalId,ObservationId,DecisionKey;
        }
        sealed class Challenge
        {
            public string Token,Host,Speaker,Owner;
            public int World,Revision,FirstSituation,LastSituation;
            public long Expires;
            public bool Redeemed;
        }
        sealed class Signal
        {
            public string Id,Observer,Host;
            public int World;
            public long Expires;
        }
        sealed class Stored
        {
            public Grant Grant;
            public long Expires;
            public bool Reserved;
        }
        internal string LastAcceptFailure {get;private set;}
        internal string LastCurrentFailure {get;private set;}
        bool RejectAccept(string reason){LastAcceptFailure=reason;return false;}
        bool RejectCurrent(string reason){LastCurrentFailure=reason;return false;}
        internal const int MaxChallenges=16,MaxSignals=256,MaxGrants=32;
        internal const long ChallengeLeaseMs=3000,SignalLeaseMs=10000,GrantLeaseMs=2000;
        readonly Func<long> clock;
        readonly Func<string> host;
        readonly Func<int> world;
        readonly Dictionary<string,Challenge> challenges=new Dictionary<string,Challenge>();
        readonly Dictionary<string,Signal> signals=new Dictionary<string,Signal>();
        readonly Dictionary<string,Stored> grants=new Dictionary<string,Stored>();
        internal DirectorPs3Receipts(Func<long> clock,Func<string> host,Func<int> world)
        {this.clock=clock??throw new ArgumentNullException(nameof(clock));this.host=host??throw new ArgumentNullException(nameof(host));this.world=world??throw new ArgumentNullException(nameof(world));}
        // A parsed receipt is caller-owned mutable data. Copy every scalar
        // before sealing it, and never return the stored object by reference.
        static Grant Copy(Grant g)=>new Grant {
            Version=g.Version,Source=g.Source,Challenge=g.Challenge,
            TicketId=g.TicketId,HostRunId=g.HostRunId,WorldEpoch=g.WorldEpoch,
            SpeakerCaptureRef=g.SpeakerCaptureRef,PlayerCaptureRef=g.PlayerCaptureRef,
            OwnerIncarnationId=g.OwnerIncarnationId,ProofRevision=g.ProofRevision,
            SituationRevision=g.SituationRevision,SignalId=g.SignalId,
            ObservationId=g.ObservationId,ObservationRevision=g.ObservationRevision,
            DecisionKey=g.DecisionKey,PolicyVersion=g.PolicyVersion,AgeMs=g.AgeMs
        };
        static bool Uuid(string s)=>s!=null && Regex.IsMatch(s,
            "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
            RegexOptions.CultureInvariant);
        static bool Key(string s)=>!string.IsNullOrWhiteSpace(s) && s.Length<=160 &&
            s.IndexOfAny(new[]{'\0','\r','\n','\t'})<0;
        void Trim()
        {
            var now=clock();
            foreach(var s in signals.Where(x=>x.Value.Expires<=now).Select(x=>x.Key).ToArray())signals.Remove(s);
            foreach(var s in challenges.Where(x=>x.Value.Expires<=now).Select(x=>x.Key).ToArray())challenges.Remove(s);
            foreach(var s in grants.Where(x=>x.Value.Expires<=now).Select(x=>x.Key).ToArray())grants.Remove(s);
        }
        // The challenge is bound to the REAL native P2 participant and
        // owner-proof revision, not to PS3/Director request assertions.
        // Repeated native situation samples with the same owner do not
        // mint an unbounded number of new challenges.
        internal string Issue(string speaker,string owner,int ownerRevision,int situationRevision)
        {
            Trim();
            if(!Uuid(speaker)||!Uuid(owner)||ownerRevision<=0||situationRevision<=0 ||
               !Uuid(host())||world()<=0)return null;
            Challenge prior;
            if(challenges.TryGetValue(speaker,out prior) && prior.Owner==owner &&
                prior.Revision==ownerRevision && prior.Host==host() && prior.World==world() &&
                !prior.Redeemed && prior.Expires>clock()) {
                prior.LastSituation=Math.Max(prior.LastSituation,situationRevision);
                return prior.Token;
            }
            challenges.Remove(speaker);
            if(challenges.Count>=MaxChallenges)return null;
            var next=new Challenge{Token=Guid.NewGuid().ToString("D"),Speaker=speaker,
                Owner=owner,Revision=ownerRevision,Host=host(),World=world(),
                FirstSituation=situationRevision,LastSituation=situationRevision,
                Expires=clock()+ChallengeLeaseMs};
            challenges.Add(speaker,next);return next.Token;
        }
        // Called ONLY after a native factual signal was actually enqueued
        // onto the existing authenticated PS outbound pipe. Each observer
        // must have an original native witness or real self-involvement.
        internal void SentSignal(string id,IEnumerable<string> witnessedObservers)
        {
            Trim();
            if(!Uuid(id)||witnessedObservers==null||signals.Count>=MaxSignals)return;
            foreach(var observer in witnessedObservers.Distinct(StringComparer.Ordinal)) {
                if(!Uuid(observer)||signals.Count>=MaxSignals)continue;
                string key=id+"|"+observer;
                if(!signals.ContainsKey(key))signals.Add(key,new Signal {
                    Id=id,Observer=observer,Host=host(),World=world(),
                    Expires=clock()+SignalLeaseMs
                });
            }
        }
        internal bool Accept(Grant grant)
        {
            // Capture expiry state before Trim removes it; do not extend leases.
            var now=clock();
            Challenge beforeChallenge;Signal beforeSignal;
            bool challengeExpired=grant!=null &&
                challenges.TryGetValue(grant.SpeakerCaptureRef??"",out beforeChallenge) &&
                beforeChallenge.Expires<=now;
            bool signalExpired=grant!=null &&
                signals.TryGetValue((grant.SignalId??"")+"|"+(grant.SpeakerCaptureRef??""),out beforeSignal) &&
                beforeSignal.Expires<=now;
            Trim();LastAcceptFailure=null;
            if(grant==null || grant.Version!=1 ||
               grant.Source!="original_companion_ps2_ps3" ||
               !Uuid(grant.Challenge)||!Uuid(grant.TicketId) ||
               !Uuid(grant.HostRunId)||!Uuid(grant.SpeakerCaptureRef)||
               !Uuid(grant.PlayerCaptureRef)||!Uuid(grant.OwnerIncarnationId)||
               !Uuid(grant.SignalId)||!Uuid(grant.ObservationId)||
               !Key(grant.DecisionKey)||grant.ProofRevision<=0||
               grant.SituationRevision<=0||grant.ObservationRevision<=0||
               grant.PolicyVersion!=1||grant.AgeMs<0||grant.AgeMs>=2000)
                return RejectAccept("grant_invalid");
            if(grant.WorldEpoch!=world()||grant.HostRunId!=host())
                return RejectAccept("grant_host_world_mismatch");
            if(grants.ContainsKey(grant.TicketId))
                return RejectAccept("grant_duplicate");
            if(grants.Count>=MaxGrants)return RejectAccept("grant_capacity");
            Challenge issued;Signal signal;
            if(!challenges.TryGetValue(grant.SpeakerCaptureRef,out issued))
                return RejectAccept(challengeExpired?"challenge_expired":"challenge_missing");
            if(!signals.TryGetValue(grant.SignalId+"|"+grant.SpeakerCaptureRef,out signal))
                return RejectAccept(signalExpired?"signal_expired":"signal_missing");
            if(issued.Redeemed)return RejectAccept("challenge_redeemed");
            if(issued.Expires<=clock())return RejectAccept("challenge_expired");
            if(signal.Expires<=clock())return RejectAccept("signal_expired");
            if(issued.Token!=grant.Challenge)return RejectAccept("challenge_token_mismatch");
            if(issued.Host!=grant.HostRunId||issued.World!=grant.WorldEpoch||
               issued.Owner!=grant.OwnerIncarnationId||issued.Revision!=grant.ProofRevision)
                return RejectAccept("challenge_owner_mismatch");
            if(grant.SituationRevision<issued.FirstSituation||
               grant.SituationRevision>issued.LastSituation)
                return RejectAccept("challenge_situation_mismatch");
            if(signal.Host!=grant.HostRunId||signal.World!=grant.WorldEpoch)
                return RejectAccept("signal_host_world_mismatch");
            // Exactly the same consumption as the original production policy.
            issued.Redeemed=true;
            signals.Remove(grant.SignalId+"|"+grant.SpeakerCaptureRef);
            grants.Add(grant.TicketId,new Stored{Grant=Copy(grant),
                Expires=Math.Min(issued.Expires,clock()+Math.Min(GrantLeaseMs,2000L-grant.AgeMs))});
            return true;
        }
        internal bool Current(DirectorAdmission.Request request)
        {
            Stored before;
            bool expired=request!=null &&
                grants.TryGetValue(request.TicketId??"",out before) &&
                before.Expires<=clock();
            Trim();LastCurrentFailure=null;
            if(request==null||!DirectorAdmission.Valid(request))
                return RejectCurrent("grant_request_invalid");
            Stored stored;
            if(!grants.TryGetValue(request.TicketId,out stored))
                return RejectCurrent(expired?"grant_expired":"grant_missing");
            if(stored.Expires<=clock())return RejectCurrent("grant_expired");
            var g=stored.Grant;
            if(g.TicketId!=request.TicketId||g.HostRunId!=host()||
               g.WorldEpoch!=world()||g.HostRunId!=request.HostRunId||
               g.WorldEpoch!=request.WorldEpoch)
                return RejectCurrent("grant_host_world_mismatch");
            if(g.SpeakerCaptureRef!=request.SpeakerCaptureRef||
               g.PlayerCaptureRef!=request.PlayerCaptureRef||
               g.OwnerIncarnationId!=request.OwnerIncarnationId||
               g.ProofRevision!=request.ProofRevision)
                return RejectCurrent("grant_owner_mismatch");
            if(g.ObservationId!=request.ObservationId||
               g.ObservationRevision!=request.ObservationRevision||
               g.DecisionKey!=request.DecisionKey||
               g.PolicyVersion!=request.PolicyVersion)
                return RejectCurrent("grant_observation_mismatch");
            if(request.AgeMs<g.AgeMs)return RejectCurrent("grant_age_regressed");
            return true;
        }
        // Read original sealed receipt, never copy proposed request fields
        // into a native approval snapshot.
        internal Grant OriginalFor(DirectorAdmission.Request request)
        {
            Stored s;
            return Current(request)&&grants.TryGetValue(request.TicketId,out s)
                ? Copy(s.Grant):null;
        }
        internal bool Reserve(DirectorAdmission.Request request)
        {
            if(!Current(request))return false;
            var grant=grants[request.TicketId];
            if(grant.Reserved)return false;
            grant.Reserved=true;return true;
        }
        internal bool IsReserved(DirectorAdmission.Request request)
        {
            Stored g;return Current(request)&&grants.TryGetValue(request.TicketId,out g)&&g.Reserved;
        }
        internal void Retire(string owner)
        {
            foreach(var k in challenges.Where(x=>x.Value.Owner==owner).Select(x=>x.Key).ToArray())challenges.Remove(k);
            foreach(var k in grants.Where(x=>x.Value.Grant.OwnerIncarnationId==owner).Select(x=>x.Key).ToArray())grants.Remove(k);
        }
        internal void ClearGrant(string ticket){if(ticket!=null)grants.Remove(ticket);}
        internal void Reset(){challenges.Clear();signals.Clear();grants.Clear();}
        internal int PendingGrants=>grants.Count;
    }
}
