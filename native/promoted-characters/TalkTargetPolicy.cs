using System;
using System.Collections.Generic;

namespace LSA.PromotedCharacters
{
    // Pure selection session. No Rage types: the native adapter resolves these
    // tokens back to the exact Ped it ranked, and never substitutes a new one.
    internal struct TalkCandidate
    {
        public string PedId;
        public long Address;
        public float Distance;
        public float ScreenCenterError;
        public bool OnScreen;
        public int InputOrder;
        public TalkCandidate(string pedId,long address,float distance,float error,bool onScreen,int order)
        {
            PedId = pedId; Address = address; Distance = distance; ScreenCenterError = error; OnScreen = onScreen; InputOrder = order;
        }
    }
    internal sealed class TalkTargetOptions
    {
        public float RadiusMeters = 15f, RetentionRadiusMeters = 20f;
        public int MaxCandidates = 8, CycleWindowMs = 1500, SelectionTimeoutMs = 8000;
        public bool Indicator = true;
        public static bool Valid(float radius,float retention,int max,int cycleMs,int timeoutMs) =>
            radius >= 3f && radius <= 30f && retention >= radius && retention <= 50f && !float.IsNaN(radius) && !float.IsInfinity(radius) && !float.IsNaN(retention) && !float.IsInfinity(retention)
            && max >= 1 && max <= 16 && cycleMs >= 500 && cycleMs <= 3000 && timeoutMs >= 2000 && timeoutMs <= 30000;
    }
    internal sealed class TalkTargetView
    {
        public bool Present, PttCommitted;
        public string SelectionId, PedId, Reason;
        public long Address;
        public int CycleIndex, CycleCount;
        public long ExpiresInMs;
    }
    // Display-only class of the exact committed ped. It is never an identity,
    // never an authorization, and never derived from voice, model or a name.
    internal enum TalkRecipientKind { Unknown, Promoted, Ambient }
    internal sealed class TalkRecipientFeedback
    {
        // Bounded diagnostic codes only: no alias, UUID, address or profile text.
        public readonly TalkRecipientKind Kind;
        public readonly string Evidence;
        // The P1-verified owner alias, set only on Promoted. It is a lookup key for
        // the loader's companion name request, never shown or logged: it is the same
        // alias the Current NPC snapshot already carries, and the companion alone
        // decides whether it maps to exactly one profile.
        public readonly string Alias;
        // Internal proof of the exact promoted incarnation; never serialized to the HUD.
        public readonly string IncarnationId;
        // P2 authority generation is distinct from the P1 incarnation proof.
        // Never include it in command replies, aliases or logs.
        public readonly string OwnershipToken;
        static readonly System.Text.RegularExpressions.Regex AliasShape = new System.Text.RegularExpressions.Regex("^promoted\\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$");
        TalkRecipientFeedback(TalkRecipientKind kind,string evidence,string alias = null,string incarnationId = null,string ownershipToken = null) { Kind = kind; Evidence = evidence; Alias = kind == TalkRecipientKind.Promoted && alias != null && AliasShape.IsMatch(alias) ? alias : null; IncarnationId = Alias == null ? null : incarnationId; OwnershipToken = Alias == null ? null : ownershipToken; }
        public string Token => Kind == TalkRecipientKind.Promoted ? "promoted" : Kind == TalkRecipientKind.Ambient ? "ambient" : "unknown";
        public static TalkRecipientFeedback Promoted(string evidence,string alias = null,string incarnationId = null,string ownershipToken = null) => new TalkRecipientFeedback(TalkRecipientKind.Promoted,evidence,alias,incarnationId,ownershipToken);
        public static TalkRecipientFeedback Ambient(string evidence) => new TalkRecipientFeedback(TalkRecipientKind.Ambient,evidence);
        public static TalkRecipientFeedback Unknown(string evidence) => new TalkRecipientFeedback(TalkRecipientKind.Unknown,evidence);
    }
    internal sealed class TalkTargetPolicy
    {
        struct Token { public string PedId; public long Address; }
        readonly List<Token> frozen = new List<Token>();
        string selectionId;
        int index = -1;
        long selectedAt, expiresAt, cycleUntil;
        bool committed;
        public bool HasSelection => selectionId != null;
        public bool PttCommitted => committed;
        public string SelectionId => selectionId;
        public string PedId => index >= 0 && index < frozen.Count ? frozen[index].PedId : null;
        public long Address => index >= 0 && index < frozen.Count ? frozen[index].Address : 0;
        public int Index => index;
        public int Count => frozen.Count;
        public bool CycleOpen(long now) => HasSelection && !committed && now < cycleUntil && now < expiresAt;

        public static List<TalkCandidate> Rank(IReadOnlyList<TalkCandidate> candidates,int maxCandidates)
        {
            var ranked = new List<TalkCandidate>();
            if (candidates == null || maxCandidates < 1) return ranked;
            foreach (var candidate in candidates) if (candidate.PedId != null && candidate.Address != 0) ranked.Add(candidate);
            ranked.Sort((left,right) => {
                int screen = right.OnScreen.CompareTo(left.OnScreen);
                if (screen != 0) return screen;
                int error = left.ScreenCenterError.CompareTo(right.ScreenCenterError);
                if (error != 0) return error;
                int distance = left.Distance.CompareTo(right.Distance);
                if (distance != 0) return distance;
                int ped = string.CompareOrdinal(left.PedId,right.PedId);
                if (ped != 0) return ped;
                int address = left.Address.CompareTo(right.Address);
                return address != 0 ? address : left.InputOrder.CompareTo(right.InputOrder);
            });
            if (ranked.Count > maxCandidates) ranked.RemoveRange(maxCandidates,ranked.Count - maxCandidates);
            return ranked;
        }

        public TalkTargetView SelectFirst(IReadOnlyList<TalkCandidate> candidates,long now,TalkTargetOptions options)
        {
            options = options ?? new TalkTargetOptions();
            var ranked = Rank(candidates,options.MaxCandidates);
            frozen.Clear(); index = -1; selectionId = null; committed = false;
            if (ranked.Count == 0) return Absent("no_nearby_npc");
            foreach (var candidate in ranked) frozen.Add(new Token {PedId = candidate.PedId,Address = candidate.Address});
            index = 0;
            return Touch(now,options,"first");
        }
        public TalkTargetView SelectNext(long now,TalkTargetOptions options)
        {
            options = options ?? new TalkTargetOptions();
            if (!CycleOpen(now) || frozen.Count == 0 || index < 0) return Absent(HasSelection ? "cycle_expired" : "no_selection");
            index = (index + 1) % frozen.Count;
            committed = false;
            return Touch(now,options,"cycle");
        }
        TalkTargetView Touch(long now,TalkTargetOptions options,string reason)
        {
            selectionId = Guid.NewGuid().ToString("D");
            selectedAt = now;
            expiresAt = now + options.SelectionTimeoutMs;
            cycleUntil = now + options.CycleWindowMs;
            committed = false;
            return View(now,reason);
        }
        public void Commit(string expectedSelectionId,long now)
        {
            if (selectionId == null || expectedSelectionId != selectionId) return;
            committed = true;
        }
        public void Release(long now,TalkTargetOptions options)
        {
            committed = false;
            if (selectionId == null) return;
            options = options ?? new TalkTargetOptions();
            expiresAt = now + options.SelectionTimeoutMs;
        }
        public string Problem(string pedId,long address,bool exists,bool dead,bool player,bool human,float distance,float retention,long now)
        {
            if (!HasSelection) return "lost";
            if (!committed && now >= expiresAt) return "expired";
            if (pedId != PedId || address != Address || address == 0 || !exists || dead || player || !human || float.IsNaN(distance) || distance > retention) return "lost";
            return null;
        }
        public bool Confirm(string pedId,long address,bool exists,bool dead,bool player,bool human,float distance,float retention,long now)
        {
            string problem = Problem(pedId,address,exists,dead,player,human,distance,retention,now);
            if (problem == null) return true;
            Clear(problem);
            return false;
        }
        public void Export(List<TalkCandidate> into)
        {
            into.Clear();
            foreach (var token in frozen) into.Add(new TalkCandidate {PedId = token.PedId,Address = token.Address});
        }
        public TalkTargetView Inspect(long now)
        {
            if (!HasSelection) return Absent(null);
            if (!committed && now >= expiresAt) { Clear("expired"); return Absent("expired"); }
            return View(now,null);
        }
        public void Clear(string reason)
        {
            frozen.Clear(); index = -1; selectionId = null; committed = false; selectedAt = expiresAt = cycleUntil = 0;
        }
        public void ResetForWorldChange() => Clear("world_reset");
        TalkTargetView View(long now,string reason) => new TalkTargetView {
            Present = true,SelectionId = selectionId,PedId = PedId,Address = Address,PttCommitted = committed,
            CycleIndex = index + 1,CycleCount = frozen.Count,ExpiresInMs = committed ? Math.Max(0,expiresAt - selectedAt) : Math.Max(0,expiresAt - now),Reason = reason};
        static TalkTargetView Absent(string reason) => new TalkTargetView {Reason = reason};
    }

    // Only a successfully committed, P1-verified promoted recipient may be reused.
    // This is a bounded identity lease inside UX4, not a conversation manager or
    // a Ped-handle lookup. Every microphone start must recheck the native proof.
    internal sealed class TalkRecipientContinuity
    {
        public string PedId { get; private set; }
        public long Address { get; private set; }
        public string Alias { get; private set; }
        public string IncarnationId { get; private set; }
        public string OwnershipToken { get; private set; }
        public long LastCommitAt { get; private set; }
        public bool HasRecipient => PedId != null;
        public void Remember(string pedId,long address,TalkRecipientFeedback proof,long now)
        {
            if (pedId == null || address == 0 || proof == null || proof.Kind != TalkRecipientKind.Promoted ||
                proof.Evidence != "owner_verified" || proof.Alias == null || string.IsNullOrEmpty(proof.IncarnationId) ||
                string.IsNullOrEmpty(proof.OwnershipToken))
            { Clear(); return; }
            PedId = pedId; Address = address; Alias = proof.Alias; IncarnationId = proof.IncarnationId; OwnershipToken = proof.OwnershipToken; LastCommitAt = now;
        }
        public string Problem(string pedId,long address,TalkRecipientFeedback proof,bool alive,bool sameVehicle,float distance,float radius,long now)
        {
            if (!HasRecipient) return "no_recipient";
            if (!alive || pedId != PedId || address == 0 || address != Address) return "ped_lifetime_changed";
            if (proof == null || proof.Kind != TalkRecipientKind.Promoted || proof.Evidence != "owner_verified" ||
                proof.Alias != Alias || proof.IncarnationId != IncarnationId || proof.OwnershipToken != OwnershipToken) return "owner_unverified";
            if (now < LastCommitAt) return "clock_reset";
            // Driving can keep companions in conversation longer; neither bound
            // is permanent and mere proximity cannot renew it without a turn.
            if (now - LastCommitAt > (sameVehicle ? 900000L : 180000L)) return "conversation_idle";
            if (!sameVehicle && (float.IsNaN(distance) || distance > radius)) return "out_of_range";
            return null;
        }
        public void Clear()
        {
            PedId = Alias = IncarnationId = OwnershipToken = null; Address = LastCommitAt = 0;
        }
    }
}
